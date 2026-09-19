#!/usr/bin/env node
import { spawn, execFileSync } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'
import { parseArgs } from 'util'

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    jobs: { type: 'string', short: 'j' },
    timeout: { type: 'string', short: 't', default: '300000' },
    'idle-timeout': { type: 'string', default: '120000' },
    retries: { type: 'string', default: '0' },
    'min-free-mb': { type: 'string', default: '1024' },
    shard: { type: 'string' },
    runtime: { type: 'string' },
    bail: { type: 'boolean', short: 'b', default: false },
    bare: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false }
  }
})

if (opts.help) {
  console.log(`brittle-jobs [globs|files...] [flags]

  -j, --jobs N          concurrent processes (default BRITTLE_JOBS or 2 x cores)
  -t, --timeout MS      hard cap per file (default 300000)
      --idle-timeout MS kill file after this long without output (default 120000)
      --retries N       rerun failed files, pass on retry = FLAKY (default 0)
      --min-free-mb N   wait for free disk on tmp root before spawning (default 1024)
      --shard i/n       run the i-th of n slices
      --runtime CMD     child command (default bare)
  -b, --bail            stop on first failure`)
  process.exit(0)
}

const GRACE_MS = 2000
const jobs = Math.max(
  1,
  Number(opts.jobs || process.env.BRITTLE_JOBS) || 2 * os.availableParallelism()
)
const timeoutMs = Number(opts.timeout)
const idleMs = Number(opts['idle-timeout'])
const retries = Number(opts.retries)
const minFree = Number(opts['min-free-mb']) * 1024 * 1024
const gha = !!process.env.GITHUB_ACTIONS
const [runtime, ...runtimeArgs] = (opts.runtime || 'bare').split(' ')

let spawnBare = null
if (!opts.runtime) {
  try {
    spawnBare = createRequire(path.join(process.cwd(), 'package.json'))('bare-runtime/spawn')
  } catch {}
}

let files = [
  ...new Set(
    fs
      .globSync(positionals.length ? positionals : ['test/*.{js,ts,mjs}'])
      .filter((f) => !/^all\./.test(path.basename(f)) && fs.statSync(f).isFile())
  )
]
  .map((f) => ({ f, size: fs.statSync(f).size }))
  .sort((a, b) => b.size - a.size || a.f.localeCompare(b.f))
  .map((x) => x.f)

if (opts.shard) {
  const [i, n] = opts.shard.split('/').map(Number)
  if (!(i >= 1 && i <= n)) die(`bad --shard ${opts.shard}`)
  files = files.filter((_, k) => k % n === i - 1)
}
if (files.length === 0) die('no test files matched')

// ponytail: tmp root keyed by cwd, two concurrent runs in one cwd wipe each other. Key by pid if that happens.
const cwdHash = crypto.createHash('sha1').update(process.cwd()).digest('hex').slice(0, 8)
const tmpRoot = path.join(fs.realpathSync(os.tmpdir()), `brittle-jobs-${cwdHash}`)
fs.rmSync(tmpRoot, { recursive: true, force: true })
fs.mkdirSync(tmpRoot, { recursive: true })

const active = new Set()
const results = []
let waiters = []
let stop = false

function die(msg) {
  console.error(`brittle-jobs: ${msg}`)
  process.exit(2)
}

function killGroup(pid, sig) {
  try {
    process.kill(-pid, sig)
  } catch {}
}

function processTree(pgid) {
  try {
    const rows = execFileSync('ps', ['-eo', 'pid,ppid,pgid,etime,command'], {
      encoding: 'utf8'
    }).split('\n')
    return [rows[0], ...rows.filter((r) => r.trim().split(/\s+/)[2] === String(pgid))].join('\n')
  } catch {
    return ''
  }
}

function shutdown(code) {
  stop = true
  for (const pid of active) killGroup(pid, 'SIGKILL')
  fs.rmSync(tmpRoot, { recursive: true, force: true })
  process.exit(code)
}
process.on('SIGINT', () => shutdown(130))
process.on('SIGTERM', () => shutdown(143))

async function diskGate() {
  while (fs.statfsSync(tmpRoot).bavail * fs.statfsSync(tmpRoot).bsize < minFree) {
    if (active.size === 0) {
      console.error(
        `brittle-jobs: free disk on ${tmpRoot} below ${opts['min-free-mb']} MB with nothing running`
      )
      shutdown(2)
    }
    await new Promise((resolve) => waiters.push(resolve))
  }
}

function runOnce(file, slot) {
  return new Promise((resolve) => {
    const tmp = fs.mkdtempSync(path.join(tmpRoot, 'bb-'))
    const started = Date.now()
    const spawnOpts = {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        TMPDIR: tmp,
        TMP: tmp,
        TEMP: tmp,
        BRITTLE_JOBS_WORKER_ID: String(slot),
        JEST_WORKER_ID: String(slot)
      }
    }
    const child = spawnBare
      ? spawnBare('bare', { ...spawnOpts, args: [file] })
      : spawn(runtime, [...runtimeArgs, file], spawnOpts)
    const pid = child.pid
    if (pid) active.add(pid)

    let output = ''
    let lastTest = ''
    let hung = ''
    let idleTimer

    const hang = (why) => {
      if (hung) return
      hung = why
      output += `\n--- process tree at kill ---\n${processTree(pid)}\n`
      killGroup(pid, 'SIGTERM')
      setTimeout(() => killGroup(pid, 'SIGKILL'), GRACE_MS)
    }
    const hardTimer = setTimeout(() => hang(`timeout ${timeoutMs}ms`), timeoutMs)
    const touch = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => hang(`no output for ${idleMs}ms`), idleMs)
    }
    const ondata = (chunk) => {
      const text = String(chunk)
      output += text
      for (const line of text.split('\n')) {
        const m = line.match(/^\s*(?:# |(?:not )?ok \d+ - )(.+)/)
        if (m) lastTest = m[1].replace(/ # time.*$/, '')
      }
      touch()
    }
    child.stdout.on('data', ondata)
    child.stderr.on('data', ondata)
    touch()

    let exit = null
    const finish = () => {
      clearTimeout(hardTimer)
      clearTimeout(idleTimer)
      active.delete(pid)
      fs.rmSync(tmp, { recursive: true, force: true })
      for (const w of waiters.splice(0)) w()
      const secs = (Date.now() - started) / 1000
      if (hung)
        return resolve({ status: 'HUNG', reason: `${hung}, last seen "${lastTest}"`, output, secs })
      if (exit.code === 0) return resolve({ status: 'PASS', output, secs })
      resolve({
        status: 'FAIL',
        reason: exit.err || `exit ${exit.code ?? exit.signal}`,
        output,
        secs
      })
    }
    child.on('error', (err) => {
      exit = { err: err.message }
      finish()
    })
    child.on('exit', (code, signal) => {
      exit = { code, signal }
      killGroup(pid, 'SIGKILL')
    })
    child.on('close', () => exit && !exit.err && finish())
  })
}

async function runFile(file, slot) {
  let res
  for (let attempt = 0; attempt <= retries && !stop; attempt++) {
    await diskGate()
    res = await runOnce(file, slot)
    if (res.status === 'PASS') {
      if (attempt > 0) res.status = 'FLAKY'
      break
    }
  }
  return res
}

function report(file, res) {
  results.push({ file, ...res })
  const ok = res.status === 'PASS' || res.status === 'FLAKY'
  const color = res.status === 'PASS' ? 32 : res.status === 'FLAKY' ? 33 : 31
  const reason = res.reason ? `: ${res.reason}` : ''
  console.log(
    `[${results.length}/${files.length}] \x1b[${color}m${res.status}\x1b[0m (${res.secs.toFixed(1)}s) ${file}${reason}`
  )
  if (ok) return
  if (gha) console.log(`::error file=${file}::${res.status}${reason}\n::group::${file} output`)
  console.log(res.output.trim())
  if (gha) console.log('::endgroup::')
  if (opts.bail) stop = true
}

const started = Date.now()
console.log(
  `brittle-jobs: ${files.length} files, ${jobs} jobs, runtime ${spawnBare ? 'bare-runtime' : runtime}`
)

let next = 0
await Promise.all(
  Array.from({ length: Math.min(jobs, files.length) }, async (_, i) => {
    while (!stop && next < files.length) {
      const file = files[next++]
      const res = await runFile(file, i + 1)
      if (res) report(file, res)
    }
  })
)

fs.rmSync(tmpRoot, { recursive: true, force: true })

const count = (s) => results.filter((r) => r.status === s).length
const bad = results.filter((r) => r.status === 'FAIL' || r.status === 'HUNG')
console.log(`\nslowest:`)
for (const r of [...results].sort((a, b) => b.secs - a.secs).slice(0, 10)) {
  console.log(`  ${r.secs.toFixed(1)}s ${r.file}`)
}
console.log(
  `\n${count('PASS')} pass, ${count('FLAKY')} flaky, ${count('FAIL')} fail, ${count('HUNG')} hung` +
    ` of ${files.length} in ${((Date.now() - started) / 1000).toFixed(1)}s`
)
for (const r of bad) console.log(` - ${r.status} ${r.file}: ${r.reason}`)
process.exit(bad.length || results.length < files.length ? 1 : 0)

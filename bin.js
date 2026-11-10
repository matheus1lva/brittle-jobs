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
    solo: { type: 'string', multiple: true },
    timings: { type: 'string' },
    runtime: { type: 'string' },
    bail: { type: 'boolean', short: 'b', default: false },
    bare: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false }
  }
})

if (opts.help) {
  console.log(`brittle-jobs [globs|files...] [flags]

  -j, --jobs N          concurrent processes (default BRITTLE_JOBS or cores)
  -t, --timeout MS      hard cap per file (default 300000)
      --idle-timeout MS kill file after this long without output (default 120000)
      --retries N       rerun failed files, pass on retry = FLAKY (default 0)
      --min-free-mb N   wait for free disk on tmp root before spawning (default 1024)
      --shard i/n       run the i-th of n slices
      --solo GLOB       run matching files alone, after the rest (repeatable)
      --timings FILE    json of file durations: orders and balances shards by it, updated after the run
      --runtime CMD     child command (default bare)
  -b, --bail            stop on first failure`)
  process.exit(0)
}

const GRACE_MS = 2000
const jobs = Math.max(1, Number(opts.jobs || process.env.BRITTLE_JOBS) || os.availableParallelism())
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

let timings = {}
if (opts.timings) {
  try {
    timings = JSON.parse(fs.readFileSync(opts.timings, 'utf8'))
  } catch {}
}
const known = Object.values(timings).sort((a, b) => a - b)
const median = known[known.length >> 1]

let files = [
  ...new Set(
    fs
      .globSync(positionals.length ? positionals : ['test/*.{js,ts,mjs}'])
      .filter((f) => !/^all\./.test(path.basename(f)) && fs.statSync(f).isFile())
  )
]
  .map((f) => ({ f, w: timings[f] ?? median ?? fs.statSync(f).size }))
  .sort((a, b) => b.w - a.w || a.f.localeCompare(b.f))

if (opts.shard) {
  const [i, n] = opts.shard.split('/').map(Number)
  if (!(i >= 1 && i <= n)) die(`bad --shard ${opts.shard}`)
  const load = Array(n).fill(0)
  files = files.filter((x) => {
    const k = load.indexOf(Math.min(...load))
    load[k] += x.w || 1
    return k === i - 1
  })
}
files = files.map((x) => x.f)
if (files.length === 0) die('no test files matched')

const soloSet = new Set(opts.solo ? fs.globSync(opts.solo) : [])
const pool = files.filter((f) => !soloSet.has(f))
const solo = files.filter((f) => soloSet.has(f))

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
    let done = false
    let closeTimer
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(hardTimer)
      clearTimeout(idleTimer)
      clearTimeout(closeTimer)
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
      closeTimer = setTimeout(() => {
        child.stdout.destroy()
        child.stderr.destroy()
        finish()
      }, GRACE_MS)
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
  if (opts.bail) {
    stop = true
    for (const pid of active) killGroup(pid, 'SIGKILL')
  }
}

const started = Date.now()
console.log(
  `brittle-jobs: ${files.length} files, ${jobs} jobs, runtime ${spawnBare ? 'bare-runtime' : runtime}`
)

let next = 0
await Promise.all(
  Array.from({ length: Math.min(jobs, pool.length) }, async (_, i) => {
    while (!stop && next < pool.length) {
      const file = pool[next++]
      const res = await runFile(file, i + 1)
      if (res && !stop) report(file, res)
    }
  })
)
for (const file of solo) {
  if (stop) break
  const res = await runFile(file, 1)
  if (res) report(file, res)
}

fs.rmSync(tmpRoot, { recursive: true, force: true })

if (opts.timings) {
  for (const r of results) if (r.status === 'PASS') timings[r.file] = Math.round(r.secs * 1000)
  fs.writeFileSync(opts.timings, JSON.stringify(timings, Object.keys(timings).sort(), 2) + '\n')
}

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

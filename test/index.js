const fs = require('fs')
const os = require('os')
const path = require('path')
const process = require('process')
const { spawn, spawnSync } = require('child_process')
const test = require('brittle')
const { stripAnsi } = require('prettytap')
const run = require('..')

const cwd = path.join(__dirname, '..')
const bin = path.join(cwd, 'bin.js')
const fixture = (name) => path.join('test', 'fixtures', name)

require('./audit-scheduler')
require('./audit-manifest')
require('./audit-child')

test('a passing file passes', async (t) => {
  const out = capture()
  const { passed, failed } = await run([fixture('pass.js')], { cwd, out })

  t.is(passed, 1)
  t.is(failed, 0)
  t.ok(out.text().includes('✓ test/fixtures/pass.js · 2 tests'))
  t.ok(out.text().includes('1/1 files passed · 2 tests'))
})

test('a failing file fails and prints its assertions', async (t) => {
  const out = capture()
  const { passed, failed } = await run([fixture('fail.js')], { cwd, out })

  t.is(passed, 0)
  t.is(failed, 1)
  t.ok(out.text().includes('✗ test/fixtures/fail.js'))
  t.ok(out.text().includes('one is not two'))
  t.ok(out.text().includes('failed: test/fixtures/fail.js'))
})

test('a file that crashes before emitting TAP fails with its stderr', async (t) => {
  const out = capture()
  const { failed } = await run([fixture('crash.js')], { cwd, out })

  t.is(failed, 1)
  t.ok(out.text().includes('boom before any test'))
  t.ok(out.text().includes('runner exited: 1'))
})

test('a passing TAP stream with a non-zero exit fails', async (t) => {
  const out = capture()
  const { failed } = await run([fixture('exit-code.js')], { cwd, out })

  t.is(failed, 1)
  t.ok(out.text().includes('runner exited: 3'))
})

test('skipped tests count as passing', async (t) => {
  const out = capture()
  const { passed, failed } = await run([fixture('skip.js')], { cwd, out })

  t.is(passed, 1)
  t.is(failed, 0)
})

test('stderr is shown only for failing files', async (t) => {
  const out = capture()
  const { passed, failed } = await run([fixture('stderr-pass.js'), fixture('stderr-fail.js')], {
    cwd,
    out,
    jobs: 1
  })

  t.is(passed, 1)
  t.is(failed, 1)
  t.ok(out.text().includes('loud stderr from a failing file'))
  t.absent(out.text().includes('loud stderr from a passing file'))
})

test('jobs caps how many files run at once', async (t) => {
  const slow = slowFiles(t, 6)
  const { passed } = await run(slow.files, { cwd, out: capture(), jobs: 2 })

  t.is(passed, 6)
  t.is(slow.intervals().length, 6, 'every file ran')
  t.is(maxConcurrency(slow.intervals()), 2)
})

test('jobs above the file count runs every file at once', async (t) => {
  const slow = slowFiles(t, 4)
  const { passed } = await run(slow.files, { cwd, out: capture(), jobs: 8 })

  t.is(passed, 4)
  t.is(maxConcurrency(slow.intervals()), 4)
})

test('jobs=1 runs files one at a time', async (t) => {
  const slow = slowFiles(t, 3)
  const { passed } = await run(slow.files, { cwd, out: capture(), jobs: 1 })

  t.is(passed, 3)
  t.is(maxConcurrency(slow.intervals()), 1)
})

test('the default job count is the machine parallelism', async (t) => {
  const out = capture()
  await run([fixture('pass.js')], { cwd, out })

  t.ok(out.text().includes(`jobs=${os.availableParallelism()}`))
})

test('files are reported as they finish, not in argument order', async (t) => {
  const slow = slowFiles(t, 1)
  const out = capture()
  await run([...slow.files, fixture('pass.js')], { cwd, out, jobs: 2 })

  const text = out.text()
  t.ok(text.indexOf('✓ test/fixtures/pass.js') < text.indexOf('✓ ' + slow.files[0]))
})

test('mixed results in parallel are all counted', async (t) => {
  const out = capture()
  const files = [fixture('pass.js'), fixture('fail.js'), fixture('crash.js'), fixture('skip.js')]
  const { passed, failed, results } = await run(files, { cwd, out, jobs: 4 })

  t.is(passed, 2)
  t.is(failed, 2)
  t.is(results.length, 4)
  t.ok(out.text().includes('2/4 files passed'))
  t.ok(out.text().includes('test/fixtures/fail.js'))
  t.ok(out.text().includes('test/fixtures/crash.js'))
})

test('bail stops scheduling after the first failing file', async (t) => {
  const out = capture()
  const { passed, failed } = await run([fixture('fail.js'), fixture('pass.js')], {
    cwd,
    out,
    jobs: 1,
    bail: true
  })

  t.is(failed, 1)
  t.is(passed, 0)
  t.ok(out.text().includes('0/2 files passed'))
})

test('bail with parallel jobs lets the running files finish', async (t) => {
  const slow = slowFiles(t, 3)
  const out = capture()
  const { passed, failed, results } = await run([fixture('fail.js'), ...slow.files], {
    cwd,
    out,
    jobs: 2,
    bail: true
  })

  t.is(failed, 1)
  t.is(passed, 1)
  t.is(results.length, 2)
  t.is(slow.intervals().length, 1, 'only the slow file already running finished')
  t.ok(out.text().includes('1/4 files passed'))
})

test('bail is passed through to brittle', async (t) => {
  const { results } = await run([fixture('two-fails.js')], { cwd, out: capture(), bail: true })

  t.is(results[0].results.expectedTests, 1, 'brittle skipped the second test')
})

test('timeout is passed through to brittle', async (t) => {
  const out = capture()
  const { failed } = await run([fixture('timeout.js')], { cwd, out, timeout: 300 })

  t.is(failed, 1)
  t.ok(out.text().includes('timed out after 300 ms'))
})

test('a runner file expands to its loaded files, honoring isBare', async (t) => {
  const out = capture()
  const { passed, failed } = await run([fixture('runner.mjs')], { cwd, out })

  t.is(passed, 1)
  t.is(failed, 0)
  t.ok(out.text().includes('1 files ·'))
})

test('a runner file may quote its paths either way', async (t) => {
  const out = capture()
  const { passed, failed } = await run([fixture('runner-quotes.mjs')], { cwd, out })

  t.is(passed, 2)
  t.is(failed, 0)
})

test('runner files and plain files combine into one queue', async (t) => {
  const out = capture()
  const { passed } = await run([fixture('runner.mjs'), fixture('skip.js')], { cwd, out })

  t.is(passed, 2)
  t.ok(out.text().includes('2 files ·'))
})

test('a runner file with no loads for this runtime runs as itself and fails with no TAP', async (t) => {
  const out = capture()
  const { passed, failed } = await run([fixture('runner-bare-only.mjs')], { cwd, out })

  t.is(passed, 0)
  t.is(failed, 1)
  t.ok(out.text().includes('no TAP output'))
  t.ok(out.text().includes('0/1 files passed · 0 tests'))
})

test('--bare runs the same runner file under bare', async (t) => {
  const out = capture()
  const { passed, failed } = await run([fixture('runner.mjs')], { cwd, out, bare: true })

  t.is(passed, 1)
  t.is(failed, 1)
  t.ok(out.text().includes('2 files · bare'))
})

test('files resolve against the cwd option', async (t) => {
  const out = capture()
  const { passed } = await run([path.join('fixtures', 'pass.js')], { cwd: __dirname, out })

  t.is(passed, 1)
  t.ok(out.text().includes('✓ fixtures/pass.js'))
})

test('SIGINT kills the running files and exits 130', async (t) => {
  const slow = slowFiles(t, 3, { ms: 5000 })
  const start = Date.now()
  const child = spawn(process.execPath, [bin, '-j', '2', ...slow.files], { cwd, env: process.env })

  let stdout = ''
  let interrupted = false
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    stdout += chunk
    if (interrupted || !stdout.includes('files ·')) return
    interrupted = true
    child.kill('SIGINT')
  })
  const code = await new Promise((resolve) => child.on('close', resolve))

  t.is(code, 130)
  t.ok(stdout.includes('0/3 files passed'), 'the summary still prints')
  t.ok(Date.now() - start < 5000, 'did not wait for the files to finish')
  t.is(slow.intervals().length, 0, 'no file got to finish')
})

test('bin exits 1 on failure and 0 on success', (t) => {
  t.is(spawnSync(process.execPath, [bin, fixture('pass.js')], { cwd }).status, 0)
  t.is(spawnSync(process.execPath, [bin, fixture('fail.js')], { cwd }).status, 1)
  t.is(spawnSync(process.execPath, [bin], { cwd }).status, 1)
  t.is(spawnSync(process.execPath, [bin, '-j', '0', fixture('pass.js')], { cwd }).status, 1)
})

function capture() {
  let buf = ''
  return {
    isTTY: false,
    write(chunk) {
      buf += chunk
    },
    text: () => stripAnsi(buf)
  }
}

function slowFiles(t, count, { ms = 600 } = {}) {
  const dir = fs.mkdtempSync(path.join(__dirname, '.tmp-'))
  t.teardown(() => fs.rmSync(dir, { recursive: true }))

  process.env.SLOW_DIR = dir
  process.env.SLOW_MS = String(ms)

  const files = []
  for (let i = 0; i < count; i++) {
    const file = path.join(dir, `slow-${i}.js`)
    fs.writeFileSync(file, "require('../fixtures/slow.js')\n")
    files.push(path.relative(cwd, file))
  }

  const intervals = () =>
    fs
      .readdirSync(dir)
      .filter((name) => !name.startsWith('slow-'))
      .map((name) => fs.readFileSync(path.join(dir, name), 'utf8').split(' ').map(Number))

  return { files, intervals }
}

function maxConcurrency(intervals) {
  const events = intervals.flatMap(([start, end]) => [
    [start, 1],
    [end, -1]
  ])
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1])

  let running = 0
  let max = 0
  for (const [, delta] of events) {
    running += delta
    max = Math.max(max, running)
  }
  return max
}

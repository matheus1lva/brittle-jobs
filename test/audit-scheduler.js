const fs = require('fs')
const path = require('path')
const process = require('process')
const { spawnSync } = require('child_process')
const test = require('brittle')
const run = require('..')

const cwd = path.join(__dirname, '..')
const bin = path.join(cwd, 'bin.js')
const fixture = (name) => path.join('test', 'fixtures', name)

for (const value of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, '2']) {
  test(`API rejects invalid jobs value ${String(value)}`, async (t) => {
    let writes = 0
    const listeners = process.listenerCount('SIGINT')
    let error
    try {
      await run([fixture('audit-scheduler-fast.js')], {
        cwd,
        jobs: value,
        out: { write: () => writes++ }
      })
    } catch (err) {
      error = err
    }

    t.ok(error instanceof TypeError)
    t.is(error && error.message, 'jobs must be a positive safe integer')
    t.is(writes, 0)
    t.is(process.listenerCount('SIGINT'), listeners)
  })
}

for (const value of ['0', '-1', 'NaN', 'Infinity', '1.5', String(Number.MAX_SAFE_INTEGER + 1)]) {
  test(`CLI rejects invalid jobs value ${value}`, (t) => {
    const result = spawnSync(
      process.execPath,
      [bin, `--jobs=${value}`, fixture('audit-scheduler-fast.js')],
      {
        cwd,
        env: {
          ...process.env,
          PATH: `${path.join(cwd, 'node_modules', '.bin')}:${process.env.PATH}`
        },
        encoding: 'utf8'
      }
    )

    t.is(result.status, 1)
    t.ok(result.stderr.includes('--jobs must be a positive safe integer'))
  })
}

for (const bare of [false, true]) {
  test(`jobs cap concurrency under ${bare ? 'bare' : 'node'}`, async (t) => {
    const slow = slowFiles(t, 5, { ms: 120 })
    const { passed } = await run(slow.files, { cwd, out: capture(), jobs: 2, bare })

    t.is(passed, 5)
    t.is(maxConcurrency(slow.intervals()), 2)
  })

  test(`bail stops scheduling under ${bare ? 'bare' : 'node'}`, async (t) => {
    const slow = slowFiles(t, 3, { ms: 120 })
    const { passed, failed, results } = await run(
      [fixture('audit-scheduler-fail.js'), ...slow.files],
      { cwd, out: capture(), jobs: 2, bare, bail: true }
    )

    t.is(passed, 1)
    t.is(failed, 1)
    t.is(results.length, 2)
    t.is(slow.intervals().length, 1)
  })
}

test('output errors reject, kill active children, and remove SIGINT listener', async (t) => {
  const dir = fs.mkdtempSync(path.join(__dirname, '.tmp-audit-output-'))
  t.teardown(() => fs.rmSync(dir, { recursive: true, force: true }))
  const wrappers = fs.mkdtempSync(path.join(__dirname, '.tmp-audit-wrappers-'))
  t.teardown(() => fs.rmSync(wrappers, { recursive: true, force: true }))
  const fast = path.join(wrappers, 'fast.js')
  const slow = path.join(wrappers, 'slow.js')
  fs.writeFileSync(fast, `require('../fixtures/audit-scheduler-fast.js')\n`)
  fs.writeFileSync(slow, `require('../fixtures/audit-scheduler-slow.js')\n`)
  const oldDir = process.env.AUDIT_SCHEDULER_DIR
  const oldMs = process.env.AUDIT_SCHEDULER_MS
  process.env.AUDIT_SCHEDULER_DIR = dir
  process.env.AUDIT_SCHEDULER_MS = '5000'
  t.teardown(() => {
    if (oldDir === undefined) delete process.env.AUDIT_SCHEDULER_DIR
    else process.env.AUDIT_SCHEDULER_DIR = oldDir
    if (oldMs === undefined) delete process.env.AUDIT_SCHEDULER_MS
    else process.env.AUDIT_SCHEDULER_MS = oldMs
  })

  let writes = 0
  const listeners = process.listenerCount('SIGINT')
  let error
  try {
    await run([path.relative(cwd, fast), path.relative(cwd, slow), path.relative(cwd, slow)], {
      cwd,
      jobs: 2,
      out: {
        write() {
          writes++
          if (writes === 2) throw new Error('output failed')
        }
      }
    })
  } catch (err) {
    error = err
  }

  t.is(error && error.message, 'output failed')
  t.is(process.listenerCount('SIGINT'), listeners)
  const markers = fs.readdirSync(dir)
  const pids = markers
    .filter((name) => name.endsWith('.start'))
    .map((name) => Number(path.basename(name, '.start')))
  t.is(pids.length, 2)
  for (const pid of pids) {
    let alive = false
    try {
      process.kill(pid, 0)
      alive = true
    } catch {}
    t.is(alive, false, `child ${pid} was reaped after output failure`)
  }
})

test('header output errors clean up SIGINT listener', async (t) => {
  const listeners = process.listenerCount('SIGINT')
  let error
  try {
    await run([fixture('audit-scheduler-fast.js')], {
      cwd,
      out: {
        write: () => {
          throw new Error('header failed')
        }
      }
    })
  } catch (err) {
    error = err
  }

  t.is(error && error.message, 'header failed')
  t.is(process.listenerCount('SIGINT'), listeners)
})

function capture() {
  return { isTTY: false, write() {} }
}

function slowFiles(t, count, { ms }) {
  const dir = fs.mkdtempSync(path.join(__dirname, '.tmp-audit-slow-'))
  t.teardown(() => fs.rmSync(dir, { recursive: true, force: true }))
  const oldDir = process.env.AUDIT_SCHEDULER_DIR
  const oldMs = process.env.AUDIT_SCHEDULER_MS
  process.env.AUDIT_SCHEDULER_DIR = dir
  process.env.AUDIT_SCHEDULER_MS = String(ms)
  t.teardown(() => {
    if (oldDir === undefined) delete process.env.AUDIT_SCHEDULER_DIR
    else process.env.AUDIT_SCHEDULER_DIR = oldDir
    if (oldMs === undefined) delete process.env.AUDIT_SCHEDULER_MS
    else process.env.AUDIT_SCHEDULER_MS = oldMs
  })

  const files = []
  for (let i = 0; i < count; i++) {
    const file = path.join(dir, `slow-${i}.js`)
    fs.writeFileSync(file, "require('../fixtures/audit-scheduler-slow.js')\n")
    files.push(path.relative(cwd, file))
  }
  return { files, intervals: () => intervals(dir) }
}

function intervals(dir) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.done'))
    .map((name) => fs.readFileSync(path.join(dir, name), 'utf8').split(' ').map(Number))
}

function maxConcurrency(values) {
  const events = values.flatMap(([start, end]) => [
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

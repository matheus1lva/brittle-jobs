const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('brittle')
const runFile = require('../lib/child')

const cwd = path.join(__dirname, '..')
const brittleCmd = require.resolve('brittle/cmd.js')

test('child requires a complete TAP plan on Node and Bare', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '.tmp-child-'))
  t.teardown(() => fs.rmSync(dir, { recursive: true }))

  const cases = [
    {
      name: 'complete stream',
      tap: 'TAP version 13\nok 1 - pass\n1..1\n',
      failed: false
    },
    {
      name: 'prelude before TAP header',
      tap: 'ok setup message\nTAP version 13\nok 1 - pass\n1..1\n',
      failed: false
    },
    {
      name: 'skipped test',
      tap: 'TAP version 13\nok 1 - skipped # SKIP\n1..1\n',
      failed: false
    },
    {
      name: 'zero tests',
      tap: 'TAP version 13\n1..0\n',
      failed: false
    },
    {
      name: 'multiple assertions in one test',
      tap: 'TAP version 13\n    ok 1 - first assertion\n    ok 2 - second assertion\nok 1 - test\n1..1\n',
      failed: false
    },
    {
      name: 'stealth test without assertion lines',
      tap: 'TAP version 13\nok 1 - stealth test\n1..1\n',
      failed: false
    },
    {
      name: 'premature exit before plan',
      tap: 'TAP version 13\nok 1 - pass\n',
      failed: true
    },
    {
      name: 'header without plan',
      tap: 'TAP version 13\n',
      failed: true
    },
    {
      name: 'plan count is too small',
      tap: 'TAP version 13\nok 1 - first\nok 2 - extra\n1..1\n',
      failed: true
    },
    {
      name: 'plan before extra result',
      tap: 'TAP version 13\n1..1\nok 1 - first\nok 2 - extra\n',
      failed: true
    },
    {
      name: 'plan count is too large',
      tap: 'TAP version 13\nok 1 - only result\n1..2\n',
      failed: true
    },
    {
      name: 'multiple plans',
      tap: 'TAP version 13\nok 1 - pass\n1..1\n1..1\n',
      failed: true
    }
  ]

  for (const runtime of [process.execPath, 'bare']) {
    for (const entry of cases) {
      const file = path.join(dir, `${runtime === 'bare' ? 'bare' : 'node'}-${entry.name}.js`)
      fs.writeFileSync(file, `console.log(${JSON.stringify(entry.tap)})\n`)

      const result = await runFile(file, { runtime, args: [], cwd }).promise
      t.is(result.failed, entry.failed, `${runtime}: ${entry.name}`)
      if (entry.failed) t.ok(result.results.validationError, `${runtime}: explains invalid TAP`)
    }
  }
})

test('child accepts nested and stealth brittle output on Node and Bare', async (t) => {
  for (const runtime of [process.execPath, 'bare']) {
    for (const name of ['audit-nested.js', 'audit-stealth.js']) {
      const result = await runFile(path.join(cwd, 'test/fixtures', name), {
        runtime,
        args: [brittleCmd],
        cwd
      }).promise

      t.absent(result.failed, `${runtime}: ${name}`)
      t.is(result.results.expectedTests, 1, `${runtime}: ${name} has one top-level test`)
    }
  }
})

test('child settles spawn errors on close', async (t) => {
  const result = await runFile(path.join(cwd, 'test/fixtures/pass.js'), {
    runtime: path.join(cwd, 'test/fixtures/no-such-runtime'),
    args: [],
    cwd
  }).promise

  t.is(result.code, -2)
  t.is(result.signal, null)
  t.ok(result.failed)
  t.ok(result.stderr.includes('ENOENT'))
})

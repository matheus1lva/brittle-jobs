const path = require('path')
const test = require('brittle')
const run = require('..')
const expand = require('../lib/manifest')

const cwd = path.join(__dirname, '..')
const fixture = (name) => path.join('test', 'fixtures', name)
const absolute = (name) => path.join(cwd, 'test', 'fixtures', name)

test('recognized generated runners expand relative loads for node and bare', (t) => {
  const file = absolute('runner.mjs')
  t.alike(expand(file, { bare: false }), [absolute('pass.js')])
  t.alike(expand(file, { bare: true }), [absolute('pass.js'), absolute('fail.js')])
})

test('relative import resolution preserves URL encoding', (t) => {
  t.alike(expand(absolute('manifest-audit-url.mjs'), { bare: false }), [
    absolute('manifest audit-loaded.js')
  ])
})

test('configured generated runners remain intact', (t) => {
  const file = absolute('manifest-audit-configured.mjs')
  t.alike(expand(file, { bare: false }), [file])
  t.alike(expand(file, { bare: true }), [file])
})

test('a local import keeps the runner intact', (t) => {
  const file = absolute('manifest-audit-local-import.mjs')
  t.alike(expand(file, { bare: false }), [file])
})

for (const bare of [false, true]) {
  test(`setup and inline tests stay intact on ${bare ? 'bare' : 'node'}`, async (t) => {
    const out = capture()
    const result = await run([fixture('manifest-audit-setup-inline.mjs')], { cwd, out, bare })

    t.is(result.passed, 1)
    t.is(result.failed, 0)
    t.is(result.results[0].results.expectedTests, 3)
  })

  test(`block guards stay intact on ${bare ? 'bare' : 'node'}`, async (t) => {
    const out = capture()
    const result = await run([fixture('manifest-audit-guarded-block.mjs')], { cwd, out, bare })

    t.is(result.passed, bare ? 0 : 1)
    t.is(result.failed, bare ? 1 : 0)
  })

  test(`commented loads stay intact on ${bare ? 'bare' : 'node'}`, async (t) => {
    const out = capture()
    const result = await run([fixture('manifest-audit-commented-load.mjs')], { cwd, out, bare })

    t.is(result.passed, 1)
    t.is(result.failed, 0)
    t.is(result.results[0].results.expectedTests, 2)
  })
}

function capture() {
  let buf = ''
  return {
    isTTY: false,
    write(chunk) {
      buf += chunk
    },
    text: () => buf
  }
}

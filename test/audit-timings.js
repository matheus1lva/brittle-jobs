const fs = require('fs')
const path = require('path')
const test = require('brittle')
const run = require('..')
const timings = require('../lib/timings')

const cwd = path.join(__dirname, '..')
const fixture = (name) => path.join('test', 'fixtures', name)

function reset(t) {
  const file = timings.cache(cwd)
  const before = fs.existsSync(file) ? fs.readFileSync(file) : null
  t.teardown(() => {
    if (before === null) fs.rmSync(file, { force: true })
    else fs.writeFileSync(file, before)
  })
  return file
}

function seed(file, ms) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(ms))
}

test('a run records how long each file took', async (t) => {
  const file = reset(t)
  fs.rmSync(file, { force: true })
  await run([fixture('pass.js')], { cwd, out: capture() })

  const ms = JSON.parse(fs.readFileSync(file, 'utf8'))
  t.ok(ms[fixture('pass.js')] > 0)
})

test('recorded files are scheduled longest first', async (t) => {
  const file = reset(t)
  seed(file, { [fixture('pass.js')]: 10, [fixture('skip.js')]: 5000 })

  const out = capture()
  await run([fixture('pass.js'), fixture('skip.js')], { cwd, out, jobs: 1 })

  const text = out.text()
  t.ok(text.indexOf('✓ ' + fixture('skip.js')) < text.indexOf('✓ ' + fixture('pass.js')))
})

test('files with no recorded time are scheduled before recorded ones', async (t) => {
  const file = reset(t)
  seed(file, { [fixture('pass.js')]: 5000 })

  const out = capture()
  await run([fixture('pass.js'), fixture('skip.js')], { cwd, out, jobs: 1 })

  const text = out.text()
  t.ok(text.indexOf('✓ ' + fixture('skip.js')) < text.indexOf('✓ ' + fixture('pass.js')))
})

test('bail keeps the argument order', async (t) => {
  const file = reset(t)
  seed(file, { [fixture('fail.js')]: 5000, [fixture('pass.js')]: 10 })

  const out = capture()
  const { failed } = await run([fixture('pass.js'), fixture('fail.js')], {
    cwd,
    out,
    jobs: 1,
    bail: true
  })

  t.is(failed, 1)
  t.ok(
    out.text().indexOf('✓ ' + fixture('pass.js')) < out.text().indexOf('✗ ' + fixture('fail.js'))
  )
})

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

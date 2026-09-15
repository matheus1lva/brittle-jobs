const fs = require(typeof Bare === 'undefined' ? 'fs' : 'bare-fs')
const path = require(typeof Bare === 'undefined' ? 'path' : 'bare-path')
const process = require(typeof Bare === 'undefined' ? 'process' : 'bare-process')
const test = require('brittle')

test('records scheduler completion', async (t) => {
  const dir = process.env.AUDIT_SCHEDULER_DIR
  const now = Date.now()
  fs.writeFileSync(path.join(dir, `${process.pid}.start`), String(now))
  const deadline = Date.now() + 1000
  while (Date.now() < deadline) {
    if (fs.readdirSync(dir).filter((name) => name.endsWith('.start')).length >= 2) break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  fs.writeFileSync(path.join(dir, `${process.pid}.done`), String(now))
  t.pass()
})

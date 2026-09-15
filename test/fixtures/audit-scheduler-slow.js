const fs = require(typeof Bare === 'undefined' ? 'fs' : 'bare-fs')
const path = require(typeof Bare === 'undefined' ? 'path' : 'bare-path')
const process = require(typeof Bare === 'undefined' ? 'process' : 'bare-process')
const test = require('brittle')

test('records scheduler timing', async (t) => {
  const dir = process.env.AUDIT_SCHEDULER_DIR
  const start = Date.now()
  fs.writeFileSync(path.join(dir, `${process.pid}.start`), String(start))
  await new Promise((resolve) => setTimeout(resolve, Number(process.env.AUDIT_SCHEDULER_MS ?? 200)))
  fs.writeFileSync(path.join(dir, `${process.pid}.done`), `${start} ${Date.now()}`)
  t.pass()
})

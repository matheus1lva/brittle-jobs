const fs = require('fs')
const path = require('path')
const process = require('process')
const test = require('brittle')

test('records when it ran', async (t) => {
  const start = Date.now()
  await new Promise((resolve) => setTimeout(resolve, Number(process.env.SLOW_MS ?? 500)))
  fs.writeFileSync(path.join(process.env.SLOW_DIR, String(process.pid)), `${start} ${Date.now()}`)
  t.pass()
})

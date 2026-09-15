const process = require('process')
const test = require('brittle')

process.exitCode = 3

test('passes but the process exits 3', (t) => {
  t.pass()
})

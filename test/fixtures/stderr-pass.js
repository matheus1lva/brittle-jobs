const test = require('brittle')

console.error('loud stderr from a passing file')

test('passes', (t) => {
  t.pass()
})

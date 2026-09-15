const test = require('brittle')

console.error('loud stderr from a failing file')

test('fails', (t) => {
  t.fail('nope')
})

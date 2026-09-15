const test = require('brittle')
test('a', (t) => {
  t.is(1, 2)
})
test('b', (t) => {
  t.is(1, 3)
})

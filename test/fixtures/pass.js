const test = require('brittle')

test('passes', (t) => {
  t.pass()
})

test('also passes', (t) => {
  t.is(1, 1)
})

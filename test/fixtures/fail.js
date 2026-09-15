const test = require('brittle')

test('fails', (t) => {
  t.is(1, 2, 'one is not two')
})

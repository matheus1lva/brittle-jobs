const test = require('brittle')

test('fails for bail scheduling audit', (t) => {
  t.fail('intentional scheduler audit failure')
})

const test = require('brittle')

test('parent test', async (t) => {
  await t.test('nested test', (t) => {
    t.pass()
    t.pass()
  })
})

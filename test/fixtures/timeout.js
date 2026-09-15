const test = require('brittle')

test('never settles', async (t) => {
  await new Promise((resolve) => setTimeout(resolve, 10000))
  t.pass()
})

await runTests()

async function runTests() {
  const test = (await import('brittle')).default

  test.pause()

  const isBare = typeof Bare !== 'undefined'

  await test.load(import.meta.resolve('./pass.js'))
  if (isBare) await test.load(import.meta.resolve('./fail.js'))

  test.resume()
}

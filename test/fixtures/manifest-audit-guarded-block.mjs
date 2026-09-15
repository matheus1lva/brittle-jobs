await runTests()

async function runTests() {
  const test = (await import('brittle')).default

  test.pause()

  const isBare = typeof Bare !== 'undefined'
  if (isBare) {
    await test.load(import.meta.resolve('./fail.js'))
  }
  await test.load(import.meta.resolve('./pass.js'))

  test.resume()
}

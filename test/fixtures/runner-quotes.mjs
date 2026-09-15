await runTests()

async function runTests() {
  const test = (await import('brittle')).default

  test.pause()

  await test.load(import.meta.resolve('./pass.js'))
  await test.load(import.meta.resolve('./skip.js'))

  test.resume()
}

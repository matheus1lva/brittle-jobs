await runTests()

async function runTests() {
  const test = (await import('brittle')).default

  test.pause()

  globalThis.BRITTLE_JOBS_MANIFEST_AUDIT = 'set by runner'
  await test.load(import.meta.resolve('./pass.js'))
  test('inline test and setup survive expansion audit', (t) => {
    t.is(globalThis.BRITTLE_JOBS_MANIFEST_AUDIT, 'set by runner')
  })

  test.resume()
}

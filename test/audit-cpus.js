const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('brittle')
const cpus = require('../lib/cpus')
const resolveJobs = require('../lib/jobs')

function root(t, files) {
  const dir = fs.mkdtempSync(path.join(__dirname, '.tmp-cgroup-'))
  t.teardown(() => fs.rmSync(dir, { recursive: true, force: true }))
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    fs.writeFileSync(path.join(dir, name), body)
  }
  return dir
}

function withoutEnv(t) {
  const before = process.env.BRITTLE_JOBS
  delete process.env.BRITTLE_JOBS
  t.teardown(() => {
    if (before === undefined) delete process.env.BRITTLE_JOBS
    else process.env.BRITTLE_JOBS = before
  })
}

test('the fallback is exactly the machine parallelism', (t) => {
  withoutEnv(t)
  t.is(cpus(root(t, {})), os.availableParallelism())
})

test('a cgroup v2 quota does not cap the fallback', (t) => {
  withoutEnv(t)
  t.is(cpus(root(t, { 'cpu.max': '200000 100000\n' })), os.availableParallelism())
})

test('a cgroup v1 quota does not cap the fallback', (t) => {
  withoutEnv(t)
  t.is(
    cpus(
      root(t, {
        'cpu/cpu.cfs_quota_us': '300000\n',
        'cpu/cpu.cfs_period_us': '100000\n'
      })
    ),
    os.availableParallelism()
  )
})

test('BRITTLE_JOBS overrides the CPU fallback', (t) => {
  const before = process.env.BRITTLE_JOBS
  process.env.BRITTLE_JOBS = '3'
  t.teardown(() => {
    if (before === undefined) delete process.env.BRITTLE_JOBS
    else process.env.BRITTLE_JOBS = before
  })
  t.is(resolveJobs(), 3)
})

test('an invalid BRITTLE_JOBS falls back to CPU parallelism', (t) => {
  const before = process.env.BRITTLE_JOBS
  process.env.BRITTLE_JOBS = 'not-a-number'
  t.teardown(() => {
    if (before === undefined) delete process.env.BRITTLE_JOBS
    else process.env.BRITTLE_JOBS = before
  })

  t.is(resolveJobs(), os.availableParallelism())
})

test('an explicit API value overrides BRITTLE_JOBS and may exceed CPUs', (t) => {
  const before = process.env.BRITTLE_JOBS
  process.env.BRITTLE_JOBS = '3'
  t.teardown(() => {
    if (before === undefined) delete process.env.BRITTLE_JOBS
    else process.env.BRITTLE_JOBS = before
  })

  const jobs = os.availableParallelism() + 1
  t.is(resolveJobs(jobs), jobs)
})

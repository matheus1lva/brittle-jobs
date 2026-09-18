#!/usr/bin/env node
const process = require('process')
const paparam = require('paparam')
const run = require('./index')

const cmd = paparam
  .command(
    'brittle-jobs',
    paparam.flag('--bare', 'Run test files with bare instead of node'),
    paparam.flag(
      '--jobs|-j <n>',
      'Concurrent test-file workers (default: available CPU parallelism)'
    ),
    paparam.flag('--bail|-b', 'Bail on first assert failure and stop scheduling files'),
    paparam.flag('--timeout|-t <ms>', 'Per-test timeout passed to brittle'),
    paparam.rest('<files>'),
    paparam.bail((bail) => {
      console.error(bail.reason)
      console.error(bail.command.usage())
      process.exit(1)
    })
  )
  .parse()

if (!cmd) process.exit(0)
if (cmd.rest.length === 0) {
  console.error('Error: No test files were specified')
  process.exit(1)
}

const { bare, jobs, bail, timeout } = cmd.flags
let parsedJobs
if (jobs !== undefined) {
  parsedJobs = Number(jobs)
  try {
    run.validateJobs(parsedJobs)
  } catch {
    console.error(`Error: --jobs must be a positive safe integer`)
    process.exit(1)
  }
}

run(cmd.rest, {
  bare,
  bail,
  jobs: parsedJobs,
  timeout: timeout ? Number(timeout) : undefined
})
  .then(({ failed }) => {
    if (failed && !process.exitCode) process.exitCode = 1
  })
  .catch((err) => {
    console.error(`Error: ${err.message}`)
    process.exitCode = 1
  })

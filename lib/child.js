const path = require('path')
const { spawn } = require('child_process')
const { Parser } = require('prettytap')

const planLine = /^1\.\.(\d+)$/
const resultLine = /^(?:not )?ok\b/

function validateTap(results) {
  // An empty stream is handled by the existing "no TAP output" report. Do not
  // turn that into a second, less useful validation error.
  if (!results.foundTapData) return null

  const header = results.lines.findIndex((line) => /^TAP version \d+$/.test(line))
  const tapLines = results.lines.slice(header + 1)
  const plans = tapLines.map((line) => line.match(planLine)).filter(Boolean)
  if (plans.length === 0) return 'missing TAP plan'
  if (plans.length > 1) return 'multiple TAP plans'

  const expectedTests = Number(plans[0][1])
  if (!Number.isSafeInteger(expectedTests)) return 'invalid TAP plan count'
  const observedTests = tapLines.filter((line) => resultLine.test(line)).length
  if (observedTests !== expectedTests) {
    return `TAP plan expected ${expectedTests} tests but observed ${observedTests}`
  }

  return null
}

module.exports = function runFile(file, { runtime, args, cwd }) {
  const start = Date.now()
  const child = spawn(runtime, [...args, path.relative(cwd, file)], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const parser = new Parser()
  let stderr = ''

  child.stdout.setEncoding('utf8').on('data', (chunk) => parser.write(chunk))
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    stderr += chunk
  })

  const promise = new Promise((resolve) => {
    let settled = false
    const done = (code, signal) => {
      if (settled) return
      settled = true
      parser.end()
      const results = parser.results
      const validationError = validateTap(results)
      if (validationError !== null) {
        results.validationError = validationError
        stderr += `TAP validation failed: ${validationError}\n`
      }
      const failed =
        !results.isPassing() || validationError !== null || code !== 0 || signal !== null
      resolve({ file, results, code, signal, stderr, failed, ms: Date.now() - start })
    }
    child.on('error', (err) => {
      stderr += err.message + '\n'
    })
    child.on('close', done)
  })

  return { promise, kill: () => child.kill() }
}

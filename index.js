const fs = require('fs')
const path = require('path')
const expand = require('./lib/manifest')
const runFile = require('./lib/child')
const report = require('./lib/report')
const timings = require('./lib/timings')
const resolveJobs = require('./lib/jobs')

module.exports = async function run(files, opts = {}) {
  const cwd = opts.cwd ?? process.cwd()
  const out = opts.out ?? process.stdout
  const bare = !!opts.bare
  const jobs = resolveJobs(opts.jobs)
  validateJobs(jobs)
  const runtime = bare ? bareRuntime(cwd) : process.execPath

  const args = [require.resolve('brittle/cmd.js', { paths: [cwd] })]
  if (opts.bail) args.push('--bail')
  if (opts.timeout) args.push('--timeout', String(opts.timeout))

  const expanded = files.flatMap((file) => expand(path.resolve(cwd, file), { bare }))
  // Bailing asks for the first failure, not the shortest run. Keep the order
  // that was asked for so the file that fails is the file that was listed first.
  const queue = opts.bail ? expanded : timings.order(expanded, cwd)
  const total = queue.length
  const results = []
  const running = new Set()
  const start = Date.now()
  let stop = false
  let bar = report.progress({}, total)

  const abort = () => {
    stop = true
    for (const r of running) {
      try {
        r.kill()
      } catch {}
    }
    process.exitCode = 130
  }
  let listenerInstalled = false

  try {
    process.once('SIGINT', abort)
    listenerInstalled = true

    out.write(report.header({ total, runtime, jobs }))
    bar = report.progress(out, total)
    const tick = () =>
      bar.update(
        results.length,
        [...running].map((r) => path.relative(cwd, r.file))
      )

    await new Promise((resolve, reject) => {
      let settled = false

      const stopWithError = (err) => {
        if (settled) return
        stop = true
        const pending = []
        for (const r of running) {
          try {
            r.kill()
          } catch {}
          pending.push(Promise.resolve(r.promise).catch(() => {}))
        }
        settled = true
        Promise.all(pending).then(() => {
          running.clear()
          reject(err)
        })
      }

      const next = () => {
        if (settled) return
        if (running.size === 0 && (stop || queue.length === 0)) {
          settled = true
          resolve()
          return
        }
        while (!stop && running.size < jobs && queue.length > 0) {
          let r
          try {
            r = runFile(queue.shift(), { runtime, args, cwd })
          } catch (err) {
            stopWithError(err)
            return
          }
          running.add(r)
          Promise.resolve(r.promise).then((res) => {
            if (settled) return
            bar.clear()
            running.delete(r)
            try {
              results.push(res)
              out.write(report.line(res, cwd))
              if (res.failed) {
                out.write(report.detail(res))
                if (opts.bail) stop = true
              }
            } catch (err) {
              stopWithError(err)
              return
            }
            next()
          }, stopWithError)
        }
        tick()
      }

      next()
    })

    out.write(report.summary(results, { total, ms: Date.now() - start, cwd }))
    timings.write(cwd, results)
  } finally {
    bar.stop()
    if (listenerInstalled) process.off('SIGINT', abort)
  }

  const failed = results.filter((r) => r.failed).length
  return { passed: results.length - failed, failed, results }
}

// The launcher on PATH is whichever Bare the shell found, often an older
// global one, and node_modules/.bin/bare is a Node process that only spawns the
// real binary. Both cost a process per file. Take the binary the project
// installed, and only fall back to the launcher when there is none.
function bareRuntime(cwd) {
  let bin
  try {
    bin = require(require.resolve('bare-runtime', { paths: [cwd] }))('bare')
  } catch {
    return 'bare'
  }
  try {
    fs.accessSync(bin, fs.constants.X_OK)
  } catch {
    fs.chmodSync(bin, 0o755)
  }
  return bin
}

function validateJobs(jobs) {
  if (typeof jobs !== 'number' || !Number.isSafeInteger(jobs) || jobs < 1) {
    throw new TypeError('jobs must be a positive safe integer')
  }
}

module.exports.validateJobs = validateJobs

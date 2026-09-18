const fs = require('fs')
const path = require('path')

// Unknown files are scheduled first: a file with no recorded time may be the
// long one, and starting it last is what leaves a single process owning the
// tail of the run.
const UNKNOWN = Number.MAX_SAFE_INTEGER

const cache = (cwd) => path.join(cwd, 'node_modules', '.cache', 'brittle-jobs.json')

function read(cwd) {
  try {
    return JSON.parse(fs.readFileSync(cache(cwd), 'utf8'))
  } catch {
    return {}
  }
}

// Longest processing time first. The makespan of a greedy queue is bounded by
// 4/3 of the optimum in this order, against no bound at all in runner order.
function order(queue, cwd) {
  const ms = read(cwd)
  const of = (file) => ms[path.relative(cwd, file)] ?? UNKNOWN
  return queue
    .map((file, index) => ({ file, index, ms: of(file) }))
    .sort((a, b) => b.ms - a.ms || a.index - b.index)
    .map((entry) => entry.file)
}

function write(cwd, results) {
  if (results.length === 0) return
  const ms = read(cwd)
  for (const res of results) ms[path.relative(cwd, res.file)] = res.ms
  try {
    fs.mkdirSync(path.dirname(cache(cwd)), { recursive: true })
    fs.writeFileSync(cache(cwd), JSON.stringify(ms))
  } catch {
    // A read-only or absent node_modules costs the next run its ordering, not
    // this run its results.
  }
}

module.exports = { order, write, cache }

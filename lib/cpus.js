// Kept as a compatibility alias for callers that used the old internal name.
// Job sizing no longer reads cgroup quota files: CPU parallelism is only the
// fallback when neither the API nor BRITTLE_JOBS specifies a worker count.
const resolveJobs = require('./jobs')

function cpus() {
  return resolveJobs()
}

module.exports = cpus
module.exports.resolve = resolveJobs

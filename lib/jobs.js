const os = require('os')

// An explicit API/CLI value is authoritative. Otherwise let CI choose a
// worker count without tying it to the host's CPU count, and use the host
// parallelism only when neither setting is present.
function resolveJobs(explicit) {
  if (explicit !== undefined && explicit !== null) return explicit

  const fromEnv = Number(process.env.BRITTLE_JOBS)
  if (Number.isSafeInteger(fromEnv) && fromEnv > 0) return fromEnv

  return os.availableParallelism()
}

module.exports = resolveJobs
module.exports.resolve = resolveJobs

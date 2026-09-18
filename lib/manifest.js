const fs = require('fs')
const { fileURLToPath, pathToFileURL } = require('url')

const LOAD = /^(if \(isBare\) )?await test\.load\(import\.meta\.resolve\((['"])([^'"]+)\2\)\);?$/
const IMPORT = /^import\s+[^'"]+\sfrom\s*(['"])([^'"]+)\1;?$/

const PATTERNS = {
  call: /^await runTests\(\);?$/,
  wrapper: /^async\s+function runTests\s*\(\s*\)\s*\{$/,
  brittle: /^const test = \(await import\((['"])brittle\1\)\)\.default;?$/,
  pause: /^test\.pause\(\);?$/,
  resume: /^test\.resume\(\);?$/,
  isBare: /^const isBare = typeof Bare !== (['"])undefined\1;?$/,
  jobs: /^test\.configure\(\{\s*jobs:[^{}]*\}\);?$/,
  comment: /^\/\//,
  close: /^\}$/
}
const REQUIRED = ['call', 'wrapper', 'brittle', 'pause', 'resume']

module.exports = function expand(file, { bare }) {
  const specifiers = parse(fs.readFileSync(file, 'utf8'))
  if (specifiers === null) return [file]

  const files = []
  for (const { guarded, specifier } of specifiers) {
    if (guarded && !bare) continue
    const resolved = resolve(file, specifier)
    if (resolved === null) return [file]
    files.push(resolved)
  }
  return files.length > 0 ? files : [file]
}

// Recognize only the small declarative wrapper emitted by brittle-make-test,
// plus the two edits it survives in practice: package imports and a jobs
// configuration, both of which this runner replaces with one process per file.
// Any other statement must run as the original file so setup and inline tests
// remain in the same process and unsupported control flow is never guessed at.
function parse(source) {
  const seen = new Set()
  const loads = []

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') continue

    const load = LOAD.exec(line)
    if (load) {
      loads.push({ guarded: !!load[1], specifier: load[3] })
      continue
    }

    const imported = IMPORT.exec(line)
    if (imported) {
      // A package import cannot be observed once the loads are split out. A
      // relative one is local setup, so keep the file whole.
      if (/^[./]/.test(imported[2])) return null
      continue
    }

    const name = Object.keys(PATTERNS).find((key) => PATTERNS[key].test(line))
    if (name === undefined) return null
    seen.add(name)
  }

  if (!REQUIRED.every((key) => seen.has(key))) return null
  if (loads.some((load) => load.guarded) && !seen.has('isBare')) return null
  return loads
}

function resolve(file, specifier) {
  // Keep the accepted subset equivalent to import.meta.resolve for relative
  // file specifiers. A process can only be started with a filesystem path.
  // The recognizer intentionally does not decode JavaScript string escapes.
  // Reject them rather than resolving a different path from the runner.
  if (
    specifier.includes('\\') ||
    (specifier !== '.' &&
      specifier !== '..' &&
      !specifier.startsWith('./') &&
      !specifier.startsWith('../'))
  ) {
    return null
  }

  try {
    const url = new URL(specifier, pathToFileURL(file))
    if (url.protocol !== 'file:' || url.hostname || url.search || url.hash) return null
    return fileURLToPath(url)
  } catch {
    return null
  }
}

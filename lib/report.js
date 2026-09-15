const path = require('path')
const { SpecFormatter, bold, faint, green, red } = require('prettytap')

const secs = (ms) => (ms / 1000).toFixed(1) + 's'
const indent = (text) =>
  text
    .split('\n')
    .map((line) => (line ? '    ' + line : line))
    .join('\n')

function header({ total, runtime, jobs }) {
  return faint(`${total} files · ${path.basename(runtime)} · jobs=${jobs}`) + '\n\n'
}

function line(res, cwd) {
  const name = path.relative(cwd, res.file)
  if (res.failed) return `${red('✗')} ${bold(name)} ${faint('· ' + secs(res.ms))}\n`
  return `${green('✓')} ${name} ${faint(`· ${res.results.expectedTests} tests · ${secs(res.ms)}`)}\n`
}

function detail(res) {
  let out = ''
  if (res.results.foundTapData) {
    const spec = new SpecFormatter()
    out += spec.formatToString(res.results) + spec.summaryToString()
  }
  out += res.stderr
  if (!res.results.foundTapData) out += red('no TAP output') + '\n'
  if (res.code !== 0) out += red(`runner exited: ${res.signal ?? res.code}`) + '\n'
  return indent(out.trimEnd()) + '\n\n'
}

function summary(results, { total, ms, cwd }) {
  const failed = results.filter((r) => r.failed)
  const tests = results.reduce((n, r) => n + Math.max(r.results.expectedTests, 0), 0)
  const color = failed.length ? red : green
  const out = `\n${color(bold(`${results.length - failed.length}/${total} files passed`))} ${faint(`· ${tests} tests · ${secs(ms)}`)}\n`
  if (failed.length === 0) return out
  return out + red('failed: ') + failed.map((r) => path.relative(cwd, r.file)).join(', ') + '\n'
}

module.exports = { header, line, detail, summary }

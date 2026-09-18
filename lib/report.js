const path = require('path')
const { SpecFormatter, bold, faint, green, red } = require('prettytap')

const secs = (ms) => (ms / 1000).toFixed(1) + 's'
const indent = (text) =>
  text
    .split('\n')
    .map((line) => (line ? '    ' + line : line))
    .join('\n')

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const ERASE = '\x1b[2K\x1b[1G'

// A long file keeps a terminal silent for minutes. Repaint a single line so the
// run is visibly alive and says which files it is waiting on.
function progress(out, total) {
  if (!out.isTTY) return { update() {}, clear() {}, stop() {} }

  const start = Date.now()
  let frame = 0
  let done = 0
  let running = []
  let shown = false

  const paint = () => {
    const names = running.slice(0, 3).join(' ')
    const more = running.length > 3 ? ` +${running.length - 3}` : ''
    const line = `${SPINNER[frame]} ${done}/${total} · ${names}${more} · ${secs(Date.now() - start)}`
    out.write((shown ? ERASE : '') + faint(line.slice(0, (out.columns || 80) - 1)))
    shown = true
  }
  const clear = () => {
    if (!shown) return
    out.write(ERASE)
    shown = false
  }

  const timer = setInterval(() => {
    frame = (frame + 1) % SPINNER.length
    paint()
  }, 100)
  if (timer.unref) timer.unref()

  return {
    update(nextDone, nextRunning) {
      done = nextDone
      running = nextRunning
      paint()
    },
    clear,
    stop() {
      clearInterval(timer)
      clear()
    }
  }
}

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

module.exports = { header, line, detail, summary, progress }

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

const bin = path.join(import.meta.dirname, '..', 'bin.js')
const fx = (name) => path.join('test', 'fixtures', name)
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-selftest-'))
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }))

function run(args, out = 'out') {
  const outFile = path.join(scratch, out)
  const r = spawnSync(process.execPath, [bin, '--runtime', process.execPath, ...args], {
    cwd: path.join(import.meta.dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, BB_TEST_OUT: outFile, GITHUB_ACTIONS: '' }
  })
  return { ...r, outFile }
}

test('pass and fail are reported, exit code follows', () => {
  const ok = run([fx('pass.js')])
  assert.equal(ok.status, 0)
  assert.match(ok.stdout, /PASS.*pass\.js/)

  const bad = run([fx('pass.js'), fx('fail.js')])
  assert.equal(bad.status, 1)
  assert.match(bad.stdout, /FAIL.*fail\.js: exit 1/)
  assert.match(bad.stdout, /not ok 1 - failing/)
})

test('hung file is killed with its grandchild and names the test', () => {
  const r = run([fx('hang-with-grandchild.js'), '--idle-timeout', '500'], 'gcpid')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /HUNG.*no output for 500ms, last seen "stuck test"/)
  const pid = Number(fs.readFileSync(r.outFile, 'utf8'))
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
})

test('tmp files leaked by a test are wiped', () => {
  const r = run([fx('tmp-leak.js')], 'leakpath')
  assert.equal(r.status, 0)
  const leaked = fs.readFileSync(r.outFile, 'utf8')
  assert.match(leaked, /brittle-jobs-/)
  assert.equal(fs.existsSync(leaked), false)
})

test('retry turns a second-try pass into FLAKY, exit 0', () => {
  const r = run([fx('flaky.js'), '--retries', '1'], 'marker')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /FLAKY.*flaky\.js/)
})

test('shards cover every file exactly once', () => {
  const all = [fx('pass.js'), fx('fail.js'), fx('tmp-leak.js')]
  const seen = ['1/2', '2/2'].flatMap((s) =>
    [...run([...all, '--shard', s], 'shard').stdout.matchAll(/\] \S+ \(\S+\) (\S+\.js)/g)].map(
      (m) => m[1]
    )
  )
  assert.deepEqual(seen.sort(), [...all].sort())
})

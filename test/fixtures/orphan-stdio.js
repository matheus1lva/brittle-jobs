import { spawn } from 'child_process'
import fs from 'fs'
const gc = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 8000)'], {
  detached: true,
  stdio: ['ignore', 'inherit', 'inherit']
})
fs.writeFileSync(process.env.BB_TEST_OUT, String(gc.pid))
gc.unref()

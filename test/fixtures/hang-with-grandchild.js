import { spawn } from 'child_process'
import fs from 'fs'
const gc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
fs.writeFileSync(process.env.BB_TEST_OUT, String(gc.pid))
console.log('# stuck test')
setInterval(() => {}, 1000)

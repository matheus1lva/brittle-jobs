import fs from 'fs'
import os from 'os'
import path from 'path'
const leaked = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'leak-')), 'big.bin')
fs.writeFileSync(leaked, 'x')
fs.writeFileSync(process.env.BB_TEST_OUT, leaked)
console.log('ok 1 - leaked')

import fs from 'fs'
const log = (e) =>
  fs.appendFileSync(process.env.BB_TEST_OUT, `${process.argv[1]} ${e} ${Date.now()}\n`)
log('start')
setTimeout(() => log('end'), 300)

import fs from 'fs'
if (!fs.existsSync(process.env.BB_TEST_OUT)) {
  fs.writeFileSync(process.env.BB_TEST_OUT, '1')
  process.exit(1)
}
console.log('ok 1 - second try')

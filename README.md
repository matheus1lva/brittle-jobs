# brittle-jobs

Run [brittle](https://github.com/holepunchto/brittle) test files concurrently, one process per file, on Node or Bare.

## Installation

```bash
npm install --save-dev brittle-jobs
```

`brittle` is a peer dependency: the consumer's install is what runs each file.

## Usage

```bash
brittle-jobs test/*.js
brittle-jobs --bare -j 4 test/all.ts
```

```
brittle-jobs [flags] <files...>

  --bare              run test files with bare instead of node
  --jobs|-j <n>       test files to run concurrently (positive integer; default: all cores)
  --bail|-b           bail on first assert failure and stop scheduling files
  --timeout|-t <ms>   per-test timeout passed to brittle
```

Each file runs as `<node|bare> brittle/cmd.js [--bail] [--timeout ms] <file>`, exactly what
`brittle-node`/`brittle-bare` do, so per-file semantics are unchanged. `bare` is resolved on `PATH`
(npm and bun scripts put `node_modules/.bin` there).

Output is one line per file as it finishes, the full spec-formatted TAP for any file that fails, and a
summary. Exit code is 1 when any file fails its TAP or exits non-zero.

```
200 files · bare · jobs=10

✓ test/basic/chat.ts · 12 tests · 3.2s
✗ test/basic/boot.ts · 4.1s
    ...
198/200 files passed · 1840 tests · 61.3s
failed: test/basic/boot.ts, test/api/mesh.ts
```

### Runner files

A generated runner containing only the declarative wrapper emitted by `brittle-make-test` is expanded
into the files it loads instead of being run as one process. A line prefixed with `if (isBare)` is
skipped when running on node:

```js
const isBare = typeof Bare !== 'undefined'

await test.load(import.meta.resolve('./basic/chat.ts'))
if (isBare) await test.load(import.meta.resolve('./tui/keys.ts'))
```

The runner file stays a valid brittle entrypoint, so `bare test/all.ts` still works serially. A file
with setup, inline tests, comments, unsupported guards, or other unrecognized source runs as one
process so its behavior stays intact. A runner with no applicable loads also runs as one process; a
file that emits incomplete or no TAP counts as failed.

`--jobs` limits the number of test file processes running at once. The default is the available CPU
parallelism, and each process uses the selected runtime (`node` or `bare`).

## API

```js
const run = require('brittle-jobs')

const { passed, failed, results } = await run(['test/all.ts'], {
  bare: false,
  jobs: 4,
  bail: false,
  timeout: 30000,
  cwd: process.cwd(),
  out: process.stdout
})
```

`results` holds one entry per file: `{ file, results, code, signal, stderr, failed, ms }`, where
`results` is a [prettytap](https://www.npmjs.com/package/prettytap) `Results`.

## License

MIT

# brittle-jobs

Run [brittle](https://github.com/holepunchto/brittle) test files concurrently, one isolated process per file.

- A hung file costs one file, not the run: idle and hard timeouts kill the whole process group, grandchildren included.
- Every file gets its own `TMPDIR`, wiped by the runner on exit or kill, so leaked tmp data cannot starve the disk.
- Pool size defaults to the core count. Oversubscribing made a CPU-bound suite slower, so raise `-j` only for
  wait-bound suites.

## Installation

```bash
npm install --save-dev brittle-jobs
```

The runner needs Node >= 22. Test files run on `bare` by default, or on anything passed to `--runtime`.

## Usage

```bash
brittle-jobs                          # test/*.{js,ts,mjs}, minus all.*
brittle-jobs 'test/**/*.ts' --jobs 8
brittle-jobs test/*.js --runtime node
```

```
brittle-jobs [globs|files...] [flags]

  -j, --jobs N          concurrent processes (default BRITTLE_JOBS or cores)
  -t, --timeout MS      hard cap per file (default 300000)
      --idle-timeout MS kill file after this long without output (default 120000)
      --retries N       rerun failed files, pass on retry = FLAKY (default 0)
      --min-free-mb N   wait for free disk on tmp root before spawning (default 1024)
      --shard i/n       run the i-th of n slices
      --solo GLOB       run matching files alone, after the rest (repeatable)
      --timings FILE    json of file durations: orders and balances shards by it, updated after the run
      --runtime CMD     child command (default bare)
  -b, --bail            stop on first failure
```

Each file runs as `<runtime> <file>`; a brittle test file runs itself. `bare` is spawned through the project's own
`bare-runtime/spawn`, then from `PATH`. Pin `bare-runtime` exactly: that API is not covered by semver.

Output is one line per file as it finishes, the full output of any file that fails, the ten slowest files, and a
summary. Exit code is 1 when any file fails or hangs.

```
[98/99] PASS (3.5s) test/harness.ts
[99/99] HUNG (120.4s) test/exec.ts: no output for 120000ms, last seen "python create package table"

98 pass, 0 flaky, 0 fail, 1 hung of 99 in 120.4s
```

A `HUNG` report includes the process tree of the file at the moment it was killed. On GitHub Actions, failures emit
`::error file=...::` annotations and their output is grouped.

### Isolation

- `TMPDIR`, `TMP`, `TEMP` point at a per-file directory under `os.tmpdir()/brittle-jobs-<cwd hash>`. It is removed
  when the file ends, however it ends. A stale root from a killed runner is removed at startup.
- `BRITTLE_JOBS_WORKER_ID` and `JEST_WORKER_ID` hold the pool slot (`1..jobs`), for namespacing ports or databases.
- Files start heaviest first. `--shard i/n` assigns each file, in that order, to the lightest shard so far.
- Weight is the file size, or its duration with `--timings`. A file missing from the timings gets the median.
- Every shard must read the same timings file, or shards drop and repeat files. Commit it; do not restore it from
  a per-job cache. Each run merges the durations of passing files back into it.
- `--solo` files run one at a time once the pool is empty, for files that starve each other under concurrency.

### Limits

- POSIX only: process groups are not available on Windows.
- A grandchild that calls `setsid` escapes the group kill. If it holds the file's stdout, the runner stops waiting
  2s after the file exits.
- Two concurrent runs from the same working directory share a tmp root and wipe each other.

## Migrating from 0.1

- The runner is a CLI only; the `require('brittle-jobs')` API is gone.
- Default runtime is `bare`. `--bare` is accepted and ignored; use `--runtime node` for Node.
- Generated `all.*` runner files are skipped, not expanded. Pass the test files or a glob.
- `--timeout` is now a per-file cap enforced by the runner, not brittle's per-test timeout.
- No implicit timing cache; files are ordered by size unless `--timings` is passed.

## License

MIT

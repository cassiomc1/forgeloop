# Repository Index benchmarks

This directory contains reproducible query inputs for the ForgeLoop Repository
Index. It is an observational benchmark suite, not a release gate based on a
universal speed target.

Measure at least:

- first-use setup and search;
- warm server-backed selective query;
- warm indexed selective query;
- query after a file mutation;
- high-match query;
- low-match/no-match query.

The hot-path runner also performs 100 repeated low-match queries by default
for raw `tgrep`, the ForgeLoop search service, and `rg`. It reports total,
mean, median, and p95 milliseconds for each series. Set
`FORGELOOP_BENCHMARK_ITERATIONS` only when a different bounded sample size is
needed.

For every result, record the repository identifier and commit, platform,
architecture, Node.js version, pinned tgrep version, query id, mode, duration,
and observed match count. A result should have this shape:

```json
{
  "schemaVersion": 1,
  "repository": "local-fixture",
  "commit": "working-tree",
  "platform": "darwin",
  "arch": "arm64",
  "nodeVersion": "v26.8.1",
  "tgrepVersion": "1.0.3",
  "query": "selective-literal",
  "mode": "warm",
  "durationMs": 12,
  "matches": 1
}
```

An optional `rg` comparison is a test oracle only. It is never a runtime
fallback and must not change the ForgeLoop search contract. Publish measured
results with the fixture, command, and platform context; do not claim that
indexed search is always faster or that search metrics imply token, cost, or
agent-quality improvements.

Run the hot-path benchmark against the exact native binary used by CI or the
host:

```bash
FORGELOOP_TGREP_BINARY=/absolute/path/to/tgrep \
  node benchmarks/repository-index/run-hot-path.mjs
```

The runner reports first-use, warm, post-mutation, and repeated low-match
timings. It is observational and does not replace correctness, lifecycle, or
cross-platform CI checks. `rg` is benchmark-only; it is never a ForgeLoop
runtime fallback.

The persistent-host benchmark compares the direct API, the user-scoped
persistent transport, a fresh CLI process, raw tgrep, and optional `rg` over
the same low-match workload. It records cold and warm timings, p95 values, and
the separate Node process-startup component:

```bash
FORGELOOP_TGREP_BINARY=/absolute/path/to/tgrep \
  node benchmarks/repository-index/run-persistent-transport.mjs
```

The benchmark starts an isolated host under a temporary user home and removes
it after the run. A missing `rg` is reported as unavailable rather than being
treated as a ForgeLoop failure.

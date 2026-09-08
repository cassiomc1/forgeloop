# Repository Index benchmarks

This directory contains reproducible query inputs for the ForgeLoop Repository
Index. It is an observational benchmark suite, not a release gate based on a
universal speed target.

Measure at least:

- cold initial index build;
- warm server startup;
- warm indexed selective query;
- query after a file mutation;
- high-match query;
- low-match/no-match query.

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

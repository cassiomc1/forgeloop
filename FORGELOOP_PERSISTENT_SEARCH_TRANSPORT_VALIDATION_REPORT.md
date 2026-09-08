# ForgeLoop Persistent Search Transport Validation Report

## Scope and tested revision

- Exact tested repository commit (base): `13c6c15b6cb5a2c592a1ceb5df21d50eac670cd0`.
- Implementation branch: `codex/persistent-search-transport`.
- The implementation was validated as a working-tree change based on that commit in a disposable worktree before publication; validation did not modify PR #156.
- ForgeLoop CLI/package version: `1.10.2`.
- ForgeLoop preflight: `READY` after the implementation gate was refreshed through the canonical gate API.
- Activated guides: `clean`, `test`, `documentation`, `performance`, `security`.

## Environment

- Host: macOS Darwin, Apple Silicon (`darwin arm64`).
- Node.js: `v26.8.1`.
- npm: `11.19.0`.
- Managed tgrep binary: `1.0.3`, supplied through `FORGELOOP_TGREP_BINARY` from the existing local managed-engine cache.
- Benchmark fixture: the repository-index sample repository, 100 iterations per warm path.
- `npm ci` used the repository lockfile and completed with zero reported vulnerabilities. The repository-declared MCP dependencies were then installed by the authorized `npm run mcp:setup` command in this disposable worktree; no package manifest or lockfile changes were made.

## Implemented architecture

The new `src/persistent-transport/` runtime provides a user-scoped, on-demand host shared by CLI searches. It keeps the existing `searchRepository` implementation as the canonical Repository Index path and reuses the existing managed-tgrep setup, readiness, checksum, watcher, and mutation behavior.

- `client.js`: bounded connect, handshake, request/response validation, nonblocking startup-lock coordination, reuse, stale/incompatible recovery, and one bounded retry.
- `server.js`: local IPC host, per-repository readiness, same-repository serialization, cross-repository concurrency, status, shutdown, idle expiry, and cleanup.
- `protocol.js` and `framing.js`: versioned JSON messages with a four-byte big-endian length prefix, strict method/parameter validation and query projection, bounded frames, and stable errors.
- `lifecycle.js`, `ownership.js`, `state.js`, and `paths.js`: user-scoped state, endpoint derivation, verified PID/entrypoint/scope ownership, safe termination, and nonce-conditional cleanup.
- CLI `search --json` routes through the host; direct MCP and Integration API calls remain direct and do not spawn a second ForgeLoop process.
- The host never invokes `rg` or another ForgeLoop CLI as a runtime fallback.

On POSIX, the endpoint is a Unix-domain socket with restrictive permissions. On Windows, the endpoint is a named pipe. Authoritative state remains under the user ForgeLoop directory; no TCP/LAN listener is created.

## Transport protocol

Protocol version and schema version are both `1`. Each request and response has an ID and a bounded JSON envelope. The supported methods are:

- `handshake`
- `repository.search`
- `transport.status`
- `transport.shutdown`

The search payload carries an absolute canonical repository root and the provider-neutral Repository Index query object. Responses are either `{ protocolVersion, id, ok: true, result }` or `{ protocolVersion, id, ok: false, error }`. Invalid JSON, truncated frames, unknown methods, mismatched IDs, unsupported protocol versions, oversized messages, and malformed search parameters fail with stable transport errors.

Limits are explicit: 1 MiB requests, 16 MiB responses, 4,096-character patterns, 15-second startup, 120-second requests, and a 10-minute idle timeout by default.

## Security, ownership, and privacy

- No network listener is exposed; communication is local IPC only.
- Child processes are spawned with `shell: false`; no shell interpolation is used.
- Transport search parameters use a closed allowlist and are projected before reaching the canonical search implementation; binary paths, environments, timeouts, and package roots cannot be supplied over IPC.
- POSIX socket permissions are set to owner-only (`0600`). Windows uses the named-pipe endpoint supplied by the local OS transport.
- A host is reusable only when its state, protocol/version, scope, endpoint, PID, entrypoint, and ownership identity agree. POSIX uses the verified process command line; Windows uses an authenticated state-bound endpoint handshake when process inspection is unavailable. Termination refuses unverified or unrelated processes.
- State cleanup is nonce-conditional and does not remove an unowned live host.
- Existing managed-tgrep resolution and checksum verification remain unchanged.
- Transport state is operational runtime state, not Repository Index evidence, lifecycle authority, completion proof, or historical state.
- Public search and doctor responses do not expose machine-specific endpoint paths, host PIDs, or local process command lines. Internal state contains only the user-scoped runtime metadata needed for ownership and recovery; repository roots are carried only in the local request and are not persisted as transport state.

## Test results

Passed checks:

- `npm ci` — completed; 133 packages added, 0 vulnerabilities reported.
- `npm run lint -- --quiet` — passed.
- `npm test` — 1,613 tests, 1,604 passed, 9 skipped, 0 failed.
- `npm run coverage` — passed; 85.63% lines/statements, 83.78% functions, and 76.18% branches against thresholds of 80%/75%/70%.
- Explicit managed transport/native/server suite (`tests/persistent-transport.test.js`, `tests/persistent-transport-native.test.js`, and `tests/repository-index-server.test.js`) — 12 passed, 0 failed.
- Focused transport/platform/server suite — 14 passed, 0 failed.
- `npm run mcp:test` — 69 passed, 0 failed.
- `npm run mcp:pack:check` — passed; core and MCP tarball integrity plus consumer smoke passed.
- Direct API versus persistent transport vector parity — passed for 9 literal, rare, regex, zero-match, case, word, glob, type, context, and max-count query vectors; run-variable timing/byte counters were excluded from the comparison.
- `npm run docs:generate` — passed.
- `npm run docs:generated:check` — passed.
- `npm run docs:check` — passed.
- `npm run complexity:check` — passed with no regressions.
- `npm run dependency:policy` — passed.
- `npm run repository-index:manifest` — passed for tgrep `1.0.3` and four managed assets.
- `npm run performance:check` — passed; CLI startup median `186.5 ms`, budget `1,000 ms`.
- `npm run pack:check` — 9 passed.
- `npm run pack:smoke` and `npm pack --dry-run --json` — passed.
- Python loop, Markdown, and secret validators — passed; `pytest` 50 passed and 15 subtests passed.
- `npm run poc:evidence:verify`, PoC tests, benchmark profile validation, changelog, completions, and generated summary checks — passed.
- `git diff --check` — passed.

Not verified:

- The full suite's environment-gated native test is skipped without an engine override; the explicit managed-engine native set above passed.

## Platform results

- macOS: native persistent transport passed, including 50 concurrent cold searches, warm reuse, multiple repositories, shutdown/restart recovery, and CLI cold/warm behavior.
- Linux: the exact-head GitHub workflow passed the native persistent transport test on Ubuntu.
- Windows: the exact-head GitHub workflow passed the native persistent transport test, including named-pipe code paths.
- The required exact-head GitHub matrix passed, including Windows Node 20 and Node 24 CLI portability, documentation quality, package smoke, audit, dependency review, CodeQL, and Repository Index checks.

## Performance measurements

The benchmark was run on the environment above with 100 iterations. Values are milliseconds.

| Path | Cold | Min | Mean | Median | Max | p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Persistent transport host start | 108 | — | — | — | — | — |
| Fresh CLI | 188 | — | — | — | — | — |
| Direct Integration API | — | 4 | 4 | 4 | 5 | 5 |
| Warm persistent transport | — | 4 | 5 | 5 | 28 | 5 |
| Warm CLI through persistent transport | — | 103 | 106 | 106 | 111 | 108 |
| Raw tgrep | — | 4 | 4 | 4 | 5 | 4 |
| `rg` | — | 4 | 5 | 6 | 7 | 6 |

The ten-query agent workload produced identical match-count vectors for direct API, persistent transport, and CLI. Totals were 48 ms for direct API (mean 5 ms/query), 51 ms for persistent transport (mean 5 ms/query), and 1,056 ms for the CLI (mean 106 ms/query). The workload therefore adds approximately 0.3 ms/query over the direct API in this run, with no meaningful direct-API regression. The warm `rg` baseline was 5 ms/query on the same fixture; the benchmark's explicit ten-query section measured the API, persistent, and CLI paths, while `rg` was measured in the separate 100-iteration baseline.

The standalone Node process-start measurement was 31 ms. Full CLI timings also include CLI module loading, argument parsing, host connection, response formatting, and process teardown, so 31 ms is a component rather than an explanation of the 106 ms full CLI path.

Resource usage was bounded by the implementation's frame, timeout, concurrency, and idle limits. Peak RSS and CPU were not instrumented by this benchmark and are therefore not claimed as measured results. Same-repository requests are serialized to protect readiness state; different repositories can progress concurrently.

## Recovery and correctness

- Concurrent cold-start coverage passed with 50 clients and one reusable host.
- Try-only startup-lock acquisition still reclaims a verified dead owner without serializing active waiters.
- Stale/unowned ownership behavior passed without terminating an unrelated live process.
- Shutdown, cleanup, restart, and mutation-after-reuse passed on the native macOS path.
- Existing live, differential, migration, recovery, and native CLI tests passed in the managed-engine set.
- The persistent and direct paths returned identical match-count vectors for the ten-query workload. No result divergence from the existing `rg` differential/oracle coverage was observed.
- A separate 9-vector direct-versus-persistent comparison returned identical matches, contexts, files, ignored events, and stable match statistics; timing and byte counters are intentionally run-variable.
- Repository Index readiness and managed-tgrep integrity continue to be controlled by the existing canonical services.

## Issues by priority

- P0: none observed.
- P1: none observed.
- P2: the full resource benchmark does not yet capture peak RSS/CPU.
- P3: a native launcher could be revisited if a stricter end-to-end CLI SLA is required, but current evidence does not establish that it is necessary.

## Limitations and recommended follow-ups

1. Add process RSS/CPU sampling to the benchmark if resource budgets become release criteria.
2. If CLI latency remains a product blocker after transport adoption, perform a separate native-launcher experiment with equivalent protocol, ownership, packaging, and cross-platform tests. The current measurements do not justify adding that maintenance surface solely for this change.

## Required questions

1. Persistent transport reduces repeated host setup/readiness overhead after the first request and provides bounded reuse. It does not make the complete fresh CLI process cheap by itself.
2. No. In this fixture, the CLI-through-host agent workload averaged 106 ms/query, while warm `rg` averaged 5 ms/query. The persistent transport is intended to remove repeated service startup, not to outperform a direct process-level `rg` invocation.
3. Bare Node startup measured 31 ms. The remaining full CLI latency also includes ForgeLoop startup, argument handling, transport exchange, result formatting, and process teardown.
4. The measured persistent path added approximately 0.3 ms/query over the direct Integration API in the ten-query workload; rounded warm means were equal at 5 ms/query.
5. No meaningful Integration API regression was observed: direct API mean was 4 ms warm and 5 ms/query in the ten-query workload.
6. No search result difference was observed. The ten-query match-count vectors and the separate 9-vector semantic comparison were identical, and existing differential/oracle coverage passed.
7. Yes: local-only IPC, strict framing and parameter validation, owner-only POSIX socket permissions, verified process ownership, safe cleanup, managed-tgrep integrity, and public privacy boundaries were preserved locally and confirmed by the exact-head cross-platform CI matrix.
8. Not on the current evidence. Node startup is measurable, but a native launcher would add packaging and maintenance complexity; it should be considered only after a product-level CLI latency requirement and cross-platform measurements justify it.

PASS WITH FOLLOW-UPS

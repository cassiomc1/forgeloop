# Astra implementation record

This document maps the nineteen findings in the historical [Astra audit](../astra.md) to the implementation on `codex/astra-improvements`. The audit baseline is commit `fe13c597b3ba669dab93dc72d3d8e6d099dd129b`. The historical audit and the pre-existing release-evidence edit are preserved.

## Current plan execution checkpoint — 2026-09-11

The actionable plan added on 2026-09-10 has been executed as additive,
validator-backed increments in an isolated worktree. Existing CLI/API
contracts remain the source of truth; no publication, deployment, installation,
or external cleanup was performed.

| Plan item | Delivered surface | Evidence and boundary |
| --- | --- | --- |
| IMP-01 | `src/core/contract-presets.js`, `task-create --preset/--preview`, first-task docs | Four deterministic schema-valid presets; preview validates scope and writes no task namespace; release retains a typed publication criterion. |
| IMP-02 | `src/core/next-explanation.js`, `next --explain` | Opt-in bounded explanation is derived from canonical reason codes and safe artifact references; compact output is unchanged without the flag. |
| IMP-03 | Command-input validation decomposition | Policy, task creation, profile/usage, output, selector, and check validation are separated without changing rejection order; completion/phase decomposition remains a later independent slice. |
| IMP-04 | `conformance/adapter-test-kit.mjs`, refreshed conformance instructions | Public API kit reports `PASS`, `FAIL`, and explicit `UNAVAILABLE`; historical release identities remain untouched. |
| IMP-05 | `task-list --phase/--active/--limit/--offset`, benchmark script | Ordering and bounds are deterministic; discovery benchmark records cold/warm timing in disposable fixtures; no cache or history deletion was introduced. |
| IMP-06 | .NET/ASP.NET Core structural detector and `dotnet` guide | SDK-style projects, scoped shared files, solution membership, negative cases, router reasons, schemas, registry, docs, and mixed-monorepo isolation are covered. |

The adapter kit intentionally reports policy-drift and interrupted-transaction
scenarios as `UNAVAILABLE` because a public adapter must not fabricate durable
policy or transaction artifacts. Their canonical fixtures remain the authority
for those cases. Local checks run for this checkpoint are recorded in the task
receipt and final delivery; unavailable environment checks remain
`NOT_VERIFIED` rather than inferred as passed.

## Changes by finding

| Finding | Implementation | Verification |
| --- | --- | --- |
| A01 | Transactions carry the physical project root. Nested transactions and direct artifact consumers reject a different project even when task IDs match; filesystem aliases of the same project remain valid. | `tests/astra-correctness.test.js`, existing transaction and artifact suites. |
| A02 | Profile selection walks structured and nested obligations and recognizes requirement types. Constraints and stop conditions are excluded from obligation scanning; explicit route risks remain authoritative. | String/object/nested publication, type-only publication, exclusions, and explicit-risk regressions. |
| A03 | `COMMITTED`, `ROLLED_BACK`, and staging-only `ABORTED` are terminal. Recovery acquires the original task lock. Doctor recomputes incomplete transactions after recovery. | Recovery, aborted staging, repeated doctor, and transaction regressions. |
| A04 | Runtime version export and missing declarations now agree. Provider types accept observe-only providers. A packed TypeScript consumer checks every runtime export and rejects invalid provider/identity inputs. | `tests/integration-types.test.js`; TypeScript is an exact development dependency. |
| A05 | `next` provides `clear-state` and `preflight` guidance only for pre-execution checkpoints with a valid ledger, a last blocked preflight, and routing bound to the revised contract. Existing post-execution barriers remain intact. | Public integration route → blocked preflight → contract revision → route → next → clear-state → READY regression; existing reactivation tests now use the sanctioned clear command. |
| A06 | ESLint covers `.js` runners and MCP source, bins, and tests, while excluding nested dependencies. Newly exposed unused imports were removed and standard Node web globals declared. | Lint and config-coverage assertions. |
| A07 | Receipt CI explicitly reports `NOT_VERIFIED` when no receipt is supplied. Supplied scoped receipts are validated for identity and audited individually using `--task`; failed audits fail the job. | No/one/multiple receipt tests, explicit command assertions, failed-audit propagation. |
| A08 | Documentation validation runs once on Node 24. The full-suite matrix retains Linux 20/22/24 and macOS/Windows 20/24 without duplicate pairs in the PR workflow. Package assertions share one pack listing; full-suite jobs no longer rerun that same package test separately. | Semantic YAML coverage/uniqueness assertions and package tests. Seven PR full-suite executions replace nine; the separately triggered Windows main-branch workflow remains intentional. |
| A09 | Planning, verification, review, diagnosis/correction, and pending-action decisions have dedicated modules. Common identity, freshness, gate, and chronology checks retain their ordering. Complexity warnings remain enabled and a committed ratchet rejects increases or new hotspots. | Next-action, executability, policy, phase, and complexity-ratchet regressions. |
| A10 | Removed unused required-check evaluators and unused gate-path projection. Canonical evidence and task-path services remain authoritative. | Repository consumer search, lint, API parity, and lifecycle regressions. |
| A11 | Executable decision/workflow examples and the gate fixture builder moved to `tests/helpers`. Tests consume the canonical command registry directly. Four historical source locations contain only reference comments and are excluded from the tarball; they preserve links in the unchanged audit. They contain no executable implementation. | Package exclusions, runtime dependency boundary, documentation conformance, and example tests. Dynamic action and provider modules remain in production. |
| A12 | Removed identical decision inputs with different narrative labels; retained distinct flags and added precedence, malformed input, `local:false`, and irreversible cases. | Decision and workflow example tests. |
| A13 | Filename-existence tests became checks against development-only runtime imports. Public facades and the Sentrux adapter boundary remain tested. Workflow tests parse YAML and assert provenance permissions, supported versions, and unique platform/version pairs rather than a particular action revision or matrix spelling. | Boundary and semantic package tests; YAML is an exact development dependency. |
| A14 | Removed automatic command-to-manual conversion from fixtures. Call sites declare manual evidence explicitly or invoke a separately named fake-installer execution helper. Provenance and authority rejection tests still exercise real execution artifacts. | Authority, stale-receipt, completion, resume, and full lifecycle suites. |
| A15 | The three duplicate cleanup retry implementations now use the shared Windows-tolerant `removeTempTree` helper. | Completion-recovery, receipt-epoch, and preflight-reactivation tests. |
| A16 | Main test discovery is recursive and excludes fixture/helper/dependency trees. File/directory selection and approved Node test filtering options are forwarded; unknown options and empty selections fail. MCP and PoC keep separate entry points. | Discovery and argument-selection tests, focused `npm test` invocation. |
| A17 | Critical coverage now includes transactions, completion, preflight, events, installation authority, and trusted authority. Thresholds were selected from a fresh isolated baseline. New transaction fault, recovery, lock, and profile regressions cover the observed failures. | Baseline-to-fixed defect tests, full coverage, critical thresholds, and maintenance fault cases. |
| A18 | Explicit maintenance previews or compacts old terminal transaction stage/backup payloads under task locks. It preserves manifests and ledgers, recent and ambiguous transactions, invalid identities, locked tasks, and unsafe paths. | Dry-run/apply, byte counts, retained history, lock contention, ambiguity, recent transactions, and symlink safety tests. |
| A19 | MCP server/client versions are exact and the adapter lockfile is committed. Setup and packed smoke use `npm ci`, substitute local tarballs offline, verify locked dependency versions, and report lock/tarball digests and resolved versions. Core runtime dependencies remain empty. | MCP suite and packed core+MCP stdio smoke. |

## Verification and measurements

The isolated baseline coverage run passed on Node 26.8.1/macOS: lines/statements 86.79%, functions 85.93%, branches 76.89%. It used the audit commit in a detached worktree and the pre-existing development toolchain.

Final local validation on Node 26.8.1/macOS:

| Check | Result |
| --- | --- |
| Full core suite and c8 aggregate thresholds | Passed through ForgeLoop `run-check`; exit 0, 514.594 seconds. |
| Line/statements coverage | 86.87% (baseline 86.79%). |
| Function coverage | 85.93% (baseline 85.93%). |
| Branch coverage | 77.00% (baseline 76.89%). |
| Critical-module thresholds | Passed, including the newly added lifecycle/authority modules. |
| MCP suite | 69 passed, zero failures or skips. |
| Python unit suite | 50 passed. |
| Core package smoke and packed MCP stdio smoke | Passed. |
| Lint | Zero errors; 116 complexity warnings remain visible. |
| Complexity ratchet and dependency policy | Passed. |
| Documentation, Markdown, protocol and repository-content checks | Passed. |
| CLI startup | Median 91.2 ms, seven samples, 1,000 ms budget. |
| Synthetic transaction compaction | 1,000 transactions; 4,096,000 payload bytes reclaimed; all 1,000 manifests retained. Enumeration 41.8 ms; compaction 81.34 seconds during concurrent test load. |

The primary lifecycle resolver decreased from complexity 148 to 51. The separate verification and review resolvers measure 27 and 28; remaining architectural debt is visible in the ratchet rather than hidden by disabling warnings.

Initial regression probes reproduced A01, A02, and A03 before their fixes. During broader verification, an evidence-fixture spread overrode its explicit manual kind and two workflow tests still expected the former YAML spelling. Those tests were corrected, followed by a fresh complete coverage run that passed. No failed run is represented as passing evidence.

The successful full-suite execution is `exec-e6da0aec-e09d-42c0-a103-e86a652cdafb` in task `astra-improvements-20260904`. ForgeLoop bounded its captured stdout to 65,536 bytes; the process exit status and generated coverage summary were available, but this record does not claim an exact final core test count from truncated output.

The MCP lock SHA-256 is `b209a0c1a4e805434e770857f83ebd4e56fba7bf54dee420516de67e1c9f7562`; server, client, and core SDK packages resolved to 2.0.0. Tarball digests are emitted for each smoke run because they change with source contents.

These measurements describe the local implementation checkpoint before PR delivery. Windows/Linux and Node 20/22/24 execution is covered separately by the configured CI matrix. No package publication or production deployment is included in this work. The isolated baseline worktree was removed after preserving its measurements.

## Operation and limits

- Focused tests: `npm test -- tests/transaction.test.js`; filter names with `npm test -- --test-name-pattern='transaction' tests/transaction.test.js`.
- Additional accepted options: `--test-skip-pattern`, `--test-concurrency`, and `--test-timeout`, each with a value. Selectors identify existing test files or directories, not shell glob expressions.
- Complexity: `npm run complexity:check`. Its descending per-file hotspot limits tolerate source movement within a file, reject growth, and require explicit review when boundaries change. It is a maintenance budget, not proof of architectural quality.
- Maintenance preview: `npm run transactions:compact -- --path /path/to/project --retain-days 7`.
- Maintenance application: add `--apply`. Retention must be at least one day. Compaction preserves diagnostic manifests and all event history; manifest enumeration therefore remains linear in historical transaction count. The report distinguishes eligible payload bytes, compacted transactions, and skipped records.
- MCP setup: `npm run mcp:setup`, then `npm run mcp:test` and `npm run mcp:pack:check`. Updating MCP dependencies is an intentional lockfile update; verification does not select floating SDK versions.
- Source-example comments at historical paths are repository link compatibility only. Tests/examples do not authorize questions or enforce runtime decision policy.
- The route/profile change classifies declared obligations; it does not infer authorization from arbitrary prose or cancel explicit risk flags.
- Receipt CI requires an independently supplied receipt to verify a lifecycle. A checkout with no receipt reports that absence instead of creating synthetic evidence.

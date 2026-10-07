# SQLite storage measurements

`macos-discovery-322.json` records complete discovery against the clean original
plan baseline (`ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5`) and native SQLite.
The harness rejects unequal outputs and invalid ownership. Fixtures are seeded
outside measurement, use deterministic task IDs and a fixed timestamp, and
represent RECEIVED tasks without event/action load.

Run on Node 24.19.0 with authentic project dependencies available in both checkouts:

```sh
node scripts/benchmark-storage-sqlite.mjs --sizes=10,100,250,1000,5000 --repeats=20 --baseline-root=/absolute/path/to/clean/baseline
```

On macOS ARM64 / Apple M2, the 5,000-task p95 changed from 6,850.547 ms to
1,391.746 ms (4.922×). All five sizes retained identical discovery output and
valid ownership. Samples include opening/closing the native connection and
warm filesystem caches. SQLite reported WAL and synchronous=FULL (2).

This is discovery evidence for this fixture only. Indexed row queries are
reported separately. Idempotency, equal-durability state/event commits, event
and action volume, cold CLI, persistent integration, writer concurrency, peak
RSS, filesystem operations, lock waits, database/WAL bytes and event-loop delay
remain separate required measurements. `releaseThresholdsVerified: false`
prevents this file from representing complete original-plan acceptance.

## Idempotency lookup

```sh
node scripts/benchmark-storage-idempotency.mjs --sizes=10,1000,5000 --repeats=20 --baseline-root=/absolute/path/to/clean/baseline
```

For a separate instrumented idempotency run, add `--resources=true`. This records raw CPU, asynchronous Node filesystem requests, RSS endpoints, process-lifetime peak RSS, event-loop probes and database/WAL endpoints using the shared resource helper. Instrumented latency includes hook overhead and must remain separate from the published uninstrumented samples. OS block counters and async request counts do not measure all SQLite filesystem I/O; RSS endpoints are not operation peaks. The fixture contains synthetic schema-valid proposed actions and tests found-key lookup with missing-key parity outside measurement. It does not establish representative approval/execution/history or warm MCP acceptance. The added mode passes a two-sample, ten-action plumbing run with found/missing parity and resource samples for both backends. That run is not a release comparison; representative resource publication remains pending.

The optional `--fixture=public-approvals` mode instead creates the canonical diagnosis lifecycle through supported commands, then uses public action proposal, approval request and approval resolution APIs for each action. Decisions alternate approved/rejected; no external action executes. Before measurement, both backends validate identical exported ledgers, and complete approval lists must match. Fixture creation/export/validation time is reported separately. `--warmup=2` discards two samples per backend; the default remains zero for historical synthetic-run compatibility. Instrumented and uninstrumented two-action plumbing checks pass with output, approval and ledger parity. Frozen 10/1,000-action resource and uninstrumented runs are published below; this mode still does not cover action execution, recovery mutations, claim contention or warm MCP transport.

```sh
node scripts/benchmark-storage-idempotency.mjs --fixture=public-approvals --sizes=10,1000 --repeats=20 --warmup=2 --resources=true --baseline-root=/absolute/path/to/clean/baseline
```

`macos-action-approval-resources-431.json` publishes the frozen430 instrumented run: 20 measured samples and two discarded warm-ups per backend, Apple M2/macOS ARM64, Node24.19.0/SQLite3.53.3 with WAL/FULL and foreign keys. All2470 frozen source hashes matched after completion. Both exported ledgers validate and match; complete approval lists and found/missing action results match. The 10-action fixture contains10 approvals and59 events; the 1,000-action fixture contains1,000 approvals and3,029 events. Supported setup/export/parity costs were898.14ms and31,760.52ms respectively, outside lookup timers. No other local test or benchmark ran concurrently; desktop activity and filesystem cache state were uncontrolled.

| Actions and approvals | Native instrumented p95 | Filesystem instrumented p95 | Native/baseline async FS request p95 | Native/baseline user CPU p95 |
| --- | --- | --- | --- | --- |
| 10 each | 4.360ms | 4.307ms | 93 /129 | 3,677 /3,618µs |
| 1,000 each | 3.032ms | 233.967ms | 93 /12,009 | 1,884 /117,336µs |

These are instrumented found-key lookup results on valid lifecycle/action/approval evidence, not timings for full ledger validation, approval listing, mutation or external execution. The native public API includes per-call connection/topology admission; filesystem request counts exclude SQLite internal and synchronous I/O. RSS endpoints and process-lifetime peaks include substantial fixture setup and prior samples, so they do not establish an operation memory budget. Scheduled timer lateness p95 was1.151/0.918ms native/baseline for10 actions and0.837/1.039ms for1,000; those probes include scheduler noise and do not establish MCP/HTTP responsiveness. `macos-action-approval-latency-432.json` publishes the separate uninstrumented run with the same20 measured/two warm-up samples, parity requirements and unchanged frozen2470-file source. At10 actions, native/filesystem p95 is1.916/2.066ms; at1,000 it is2.953/223.735ms (75.756×). This satisfies the proposed large-workspace idempotency lookup target and shows no small-workspace lookup regression on these fixtures. Setup/export/parity cost remains separate:901.621ms and31,669.695ms. Full original performance acceptance remains open for the other named operations, resource budgets, contention and persistent integrations.

`macos-idempotency-328.json` includes all raw samples. One canonical task holds
valid proposed actions with deterministic IDs and fingerprints. Both public
APIs must return the same found action and null for a missing key. Measurement
order alternates, and native calls open/close their connection. Synthetic setup
and portable export are excluded from samples. No publication action executes.

At 5,000 actions, warm-cache public API p95 changed from 1,096.056 ms to 3.027 ms
(362.138×); at 1,000, 222.271 ms to 2.805 ms (79.227×). At 10, 2.211 ms to 2.039 ms
(1.084×). These values establish only this lookup fixture's target, with no
claim about execution, approvals, durability commits, full audit or contention.

## Complete approval listing on valid lifecycle fixtures

The same fixture supports `--operation=approvals --fixture=public-approvals`. This measures the public complete approval list, including per-record validation and sorting; both backends must return identical full arrays. `macos-approval-list-resources-434.json` and `macos-approval-list-latency-434.json` publish separate instrumented and uninstrumented runs on frozen433. Each uses20 measured samples and two discarded warm-ups for10 and1,000 approvals, with59 and3,029 valid ledger events respectively. All2472 source hashes matched after both sequential runs. Hardware, runtime, durability and accounting limits match the action431/432 runs; local suites/benchmarks did not overlap, and filesystem cache/desktop activity were uncontrolled.

| Approvals | Native uninstrumented p95 | Filesystem uninstrumented p95 | Native instrumented p95 | Filesystem instrumented p95 |
| --- | --- | --- | --- | --- |
| 10 | 1.997ms | 2.115ms | 4.326ms | 4.402ms |
| 1,000 | 7.246ms | 223.659ms | 8.206ms | 232.946ms |

At1,000 approvals, uninstrumented listing is30.866× faster on this fixture; the small fixture does not regress. Instrumented native/baseline async filesystem request p95 is93/129 at10 and93/12,009 at1,000; user CPU p95 is4,252/5,425µs and6,025/114,964µs. These counters exclude synchronous/native SQLite I/O. Scheduled timer lateness p95 is1.012/1.071ms at10 and5.513/1.146ms at1,000, indicating native synchronous work remains relevant despite lower total latency. This is a warm direct API result, not MCP/HTTP responsiveness or a writer/lock-wait measurement. Complete result arrays remain output-proportional; RSS endpoints/process-lifetime peaks do not prove a bounded operation peak. Full ledger/approval parity checks and31.6–31.9s large-fixture setup are outside listing timers. Full audit, recovery, execution, persistent integration and code-size acceptance remain open.

```sh
node scripts/benchmark-storage-idempotency.mjs --operation=approvals --fixture=public-approvals --sizes=10,1000 --repeats=20 --warmup=2 --resources=true --baseline-root=/absolute/path/to/clean/baseline
# Repeat separately with --resources=false for latency comparison.
```

## Supported protocol validation: regression requires investigation

`protocol-validation-profile-448.json` refines iteration caller attribution after the446 owned-source change. Claim task-ID eligibility and repair-marker eligibility/lookup remain full-scan callers. Increment449 routes three exact event-type predicates through the existing typed summary, preserving first-marker identity and repair-phase requirements. The foreign-task scan remains unchanged because the pure projection can receive mixed IDs and caller-supplied validity flags. Focused checks pass47/47 and legacy repair/hardening/migration checks pass88/88; lint has zero errors and one existing complexity warning. `macos-protocol-validation-latency-450.json` publishes the frozen449 repetition with20 measured/two discarded warm-up samples, complete VALID result parity and all2480 terminal source hashes unchanged. At59 events native/filesystem p95 is33.300/27.206ms; at3,029 it is260.350/154.967ms. Large native latency improves versus447's313.242ms, but remains approximately1.68× slower than its current baseline; the small regression remains6.094ms, above5ms. Uncontrolled background activity limits causal interpretation and performance acceptance remains open. No integrity rule or revision observation is removed.

Frozen446 keeps one owned ledger audit around the validator's artifact/preflight/final projection. Its complete final ledger proof is reused only within that immutable call; nested preflight audits still run their domain rules and share the source. There is no cross-request validation cache. Protocol/CLI/ledger controls pass29/29. Lint reports zero errors and one complexity warning in the existing large callback. `macos-protocol-validation-latency-447.json` publishes20 measured/two discarded warm-up samples with full VALID result parity and all2479 terminal source hashes unchanged. Native/filesystem p95 is33.935/27.792ms at59 events and313.242/148.281ms at3,029. The large native result improves versus444's339.132ms but remains approximately2.11× slower; the small regression remains6.143ms, exceeding5ms. Uncontrolled background activity limits causal interpretation. Correctness is retained and the performance gate remains unresolved.

`protocol-validation-profile-442.json` records call-only inspector sampling on the1,000-action/3,029-event fixture, with two native and two baseline calls. Setup is excluded; profiler start/stop overhead appears in samples, so these diagnostic timings do not replace the published latency comparison. Native row iteration and JSON decoding are prominent sampled CPU costs, while canonical hashing and schema validation remain substantial for both backends. Use `--profile-dir=<new-output-directory>` to capture each call separately; keep profiling out of release comparisons.

The first profile-driven correction routes state/ledger coherence's four milestone types through the existing typed event selector. It retains complete ledger schema/hash validation before indexed selection, array fallback, task filtering and relative review/verification ordering. Focused protocol/transition/ledger tests pass24/24. `macos-protocol-validation-latency-444.json` publishes the frozen443 uninstrumented repetition:20 measured/two discarded warm-ups, complete VALID result parity and all2478 terminal source hashes unchanged. Native/filesystem p95 is35.653/28.931ms at59 events and339.132/150.234ms at3,029. Native large-fixture p95 is lower than440's378.161ms, but remains approximately2.26× slower than its current baseline; the small regression remains6.722ms, exceeding5ms. Background activity is uncontrolled across repetitions, so the reduction is an observed result, not an isolated causal estimate. Profiling and performance acceptance remain open. Public fixture commands use real wall-clock timestamps and generated execution IDs, despite deterministic action/approval IDs and repeatable construction; the historical `timestamp` field describes the synthetic mode, not a frozen clock for public fixtures.

The `--operation=protocol --fixture=public-approvals` comparison executes each backend's canonical command runtime and compares the complete `validate-protocol` result. Both must return successful `VALID` results with no errors. Closed disposable SQLite/portable fixtures are switched at the same project path outside measurement, preserving execution project-root provenance without rewriting receipts. Frozen439 includes the canonical loader and committed snapshot correction described in the migration matrix. `macos-protocol-validation-resources-440.json` and `macos-protocol-validation-latency-440.json` publish20 measured/two discarded warm-up samples at59 and3,029 events, with10 and1,000 actions/approvals respectively. All2475 terminal source hashes match; setup/export/parity remain outside timers. Runtime, durability, hardware and uncontrolled filesystem/desktop conditions match the prior resource runs; local suites/benchmarks did not overlap.

| Ledger events | Native uninstrumented p95 | Filesystem uninstrumented p95 | Native instrumented p95 | Filesystem instrumented p95 |
| --- | --- | --- | --- | --- |
| 59 | 35.985ms | 28.563ms | 38.591ms | 30.150ms |
| 3,029 | 378.161ms | 150.875ms | 370.476ms | 151.362ms |

The small native fixture regresses7.422ms, exceeding the proposed5ms allowance; the large native validator is approximately2.51× slower. This is an acceptance gap requiring profiling and a release decision, not a successful performance result. Instrumented native/baseline user CPU p95 is28,444/15,786µs at59 events and353,318/158,961µs at3,029. Scheduled timer lateness p95 is9.320/0.980ms and190.242/27.968ms respectively; native synchronous work remains a responsiveness concern. Async filesystem request p95 falls from633/648 baseline to257 native, demonstrating that fewer Node requests do not imply lower CPU or latency. Counters still exclude SQLite internal and synchronous I/O. RSS endpoints/process-lifetime peaks do not establish operation memory budgets. These results cover the supported protocol validator, not every action/task audit, recovery operation or MCP transport. Correctness and provenance validation remain mandatory while investigating the regression.

```sh
node scripts/benchmark-storage-idempotency.mjs --operation=protocol --fixture=public-approvals --sizes=10,1000 --repeats=20 --warmup=2 --resources=true --baseline-root=/absolute/path/to/clean/baseline
# Repeat separately with --resources=false for latency comparison.
```

## READY-preflight typed lookup repetition

Increment453 replaces exact lifecycle-type scans in READY-preflight consistency with the existing typed selector: contract/route observations retain their task-ID predicates, gate observations retain their revision and gate predicates, and the latest contract revision retains source ordering. SQL selection remains conditional on the complete ledger/index proof; portable arrays retain their semantics. The foreign-task eligibility scan remains unchanged. Focused preflight, reactivation, bootstrap, typed-collection, native audit and protocol checks pass69/69. Lint reports zero errors and two complexity warnings in the touched module.

`macos-protocol-validation-latency-453.json` records20 measured/two discarded warm-up samples from frozen453, with complete VALID result parity and all2482 terminal source hashes unchanged. Native/filesystem p95 is33.850/28.073ms at59 events and253.197/150.039ms at3,029 events. The small regression remains5.777ms, exceeding the5ms allowance, and the large native result remains approximately1.69 times slower. This repetition does not establish performance acceptance or isolate causality from uncontrolled desktop/cache activity. No local suite or benchmark overlapped measurement.

## Warm persistent canonical integration

Use `--persistent=true` with the supported protocol operation to measure a warm integration runtime. Each native backend batch owns one `createForgeLoopContext({ persistentStorage: true })`; connection identity is checked before and after every call outside measurement, and closure is checked before switching the disposable fixture at its provenance-bound project path. Each backend runs its own warmups and measured batch. Backend order reverses between dataset sizes, rather than alternating individual calls, so an open SQLite handle is never moved during a fixture switch. The filesystem baseline remains a warm module/process runtime with its original per-call file reads. This is canonical integration measurement, not stdio/HTTP MCP transport or fresh CLI latency.

```sh
node scripts/benchmark-storage-idempotency.mjs --operation=protocol --fixture=public-approvals --sizes=10,1000 --repeats=20 --warmup=2 --persistent=true --resources=false --baseline-root=/absolute/path/to/clean/baseline
# Run separately with --resources=true for instrumented resource samples.
```

Frozen454 publishes20 measured/two discarded warmup samples per backend/size in `macos-persistent-protocol-latency-454.json` and `macos-persistent-protocol-resources-454.json`. Complete successful VALID results match with no errors, and all2483 source hashes remain unchanged after both terminal exits0. The harness also passes small control runs for both grouped backend orders and the default alternating per-call mode; ESLint reports no errors or warnings. No local suite or other benchmark overlaps these runs; desktop activity and filesystem caches remain uncontrolled.

| Ledger events | Native latency p95 | Filesystem latency p95 | Native instrumented p95 | Filesystem instrumented p95 |
| --- | --- | --- | --- | --- |
| 59 | 32.336ms | 29.497ms | 34.074ms | 29.889ms |
| 3,029 | 245.239ms | 145.256ms | 246.942ms | 147.663ms |

The small uninstrumented difference is2.839ms, within the5ms allowance for this warm runtime. Large native validation remains approximately1.69 times slower. Instrumented user CPU p95 native/filesystem is24,741/16,761µs at59 events and242,522/141,833µs at3,029; Node async FS request p95 is259/633 and259/648 respectively. Scheduled timer lateness p95 is8.653/1.526ms and123.310/25.150ms. This confirms that connection reuse does not eliminate the synchronous full-proof responsiveness cost. WAL endpoints are zero for these read-only calls, not evidence of peak WAL behavior under writers. RSS endpoints and process-lifetime peaks still do not establish operation memory budgets; total I/O, lock waits, recovery workloads and real MCP responsiveness remain open.

## State-plus-event commit: large fixture target failed

```sh
node scripts/benchmark-storage-commit.mjs --events=10,1000,100000 --repeats=20 --baseline-root=/absolute/path/to/clean/baseline
```

`macos-commit-331.json` retains all raw samples and exact returned/persisted
state/event parity. One RECEIVED task has zero write claims and deterministic
TASK_RECEIVED observations. Native seed/export and the baseline's normal
chain-head cache are created outside measurement. Each measured operation uses
the public transaction, CAS state mutation and event append. Order alternates.
SQLite reports WAL/FULL; the pinned baseline fsync implementation is unchanged.
Separate power-loss evidence is still required for durability equivalence.

At 10 prior events, native/baseline p95 was 9.314/125.613 ms; at 1,000,
19.540/119.742 ms. At 100,000, it regressed to 403.018/138.448 ms—about 2.91×
the baseline latency. The large-fixture 30% improvement target failed.
Do not aggregate the smaller improvements into an overall success claim.
Native commit recomputes claim projection through full ledger validation, even
for this zero-claim task; this is a diagnosis lead, not permission to bypass
ownership or integrity validation. Bounded full-audit/claim projection and
representative nonempty-claim/concurrency fixtures remain required.


## Nonempty claim reservations: large fixture target still failed

```sh
node scripts/benchmark-storage-commit.mjs --events=10,1000,100000 --repeats=20 --claims=4 --baseline-root=/absolute/path/to/clean/baseline
```

`macos-commit-claims-341.json` retains20 alternating samples per size, four
actual reserved native claims, strict returned/persisted state-event parity,
and exact post-commit ACTIVE reservation rows. Small-fixture full ownership
classification matches the pinned baseline. Native/baseline p95 milliseconds
are9.245/127.037 at10events,17.682/125.073 at1,000, and423.655/138.972 at100,000.
The largest commit remains3.048 times slower; the30% target still fails.

At100,000events the pinned baseline's unchanged public full ownership audit
refuses its2MiB JSON limit, classifies ownership INCONSISTENT and retains all
four claims. Native ownership remains valid. That row explicitly records
`ownershipClassificationParity: false` and the baseline refusal; equal timed
transaction results do not establish full audit parity. No production limit,
ownership assertion or durability setting was relaxed. These synthetic
RECEIVED observations do not replace complete lifecycle, power-loss, memory
or1/2/4/8-process acceptance.


## Conservative reservation retention correction

`macos-commit-retention-346.json` records the final correction with four actual
claim reservations, 20 alternating samples per size, and no concurrent local
verification jobs. Native/baseline p95 milliseconds are 8.828/120.851 at 10
events, 11.409/121.078 at 1,000, and 93.029/140.916 at 100,000. The large fixture
shows a 33.983 percent reduction, meeting the scoped 30 percent commit target.
This result does not establish complete original-plan performance acceptance.

Commit's reservation projection retains ACTIVE for noncompleted tasks without
a recovery artifact. It grants no mutation authority. Completion, recovery,
malformed historical JSON and bootstrap-repair histories still invoke full
proof. The SQL admission scan uses canonical JSON rather than trusting the
event-type index. Full ownership readers and authorization guards still
validate the complete ledger; their bounded-memory work remains unfinished.

Canonical timed return values, persisted state/tail and native reservations
are checked strictly. Baseline full ownership audit still refuses the 100,000
event fixture at its unchanged 2 MiB limit, so that row records ownership
parity as false. All earlier failed measurements remain available. Separate
power-loss, full lifecycle, cold CLI, warm MCP and process-contention evidence
remains required.


## Independent-process state/event contention

```sh
node scripts/benchmark-storage-contention.mjs --baseline-root=/absolute/path/to/clean/baseline --processes=1,2,4,8 --operations=20 --events=1000 --repeats=3
```

`macos-contention-351.json` contains 12 matched runs on Node 24.19.0, macOS
ARM64/Apple M2. Each independent persistent Node worker performs 20 public
state/event transactions on one task with a real claim and 1,000 seeded valid
events. All runs preserve exact final state, event bytes/hashes, ownership and
ACTIVE reservations. A readiness barrier excludes harness startup from commit
timing; alternating backend order limits fixed-order bias. This is a persistent
API process fixture, rather than a CLI or MCP startup measurement.

| Processes | Native pooled commit p95 ms | Baseline pooled commit p95 ms | Native median commits/s | Baseline median commits/s | Native retries | Baseline retries |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 4.757 | 130.638 | 199.655 | 8.641 | 0 | 0 |
| 2 | 14.948 | 137.324 | 224.099 | 8.410 | 30 | 0 |
| 4 | 54.351 | 1593.714 | 260.238 | 8.341 | 151 | 2 |
| 8 | 96.100 | 4289.179 | 294.617 | 8.710 | 542 | 23 |

P95 pools all commit samples from three runs at each process count. Throughput
is the median of the three complete barrier-to-terminal runs. Retry counts
include only bounded rollback-only CAS/lock/busy retries; their delay is included
in latency. Benchmark callbacks perform deterministic storage operations and
never replay external effects. Per-worker raw RSS and event-loop delay are
retained; maximum native worker RSS ranges from 76,992 to 78,832 KiB across
these process counts. These values are not full-audit memory measurements.

Database/WAL byte sizes are measured after final connection close; they are
not peak WAL pressure. Direct lock-wait duration, Node filesystem operations,
SQLite internal I/O, actual CLI/MCP startup, power-loss equivalence and a larger
lifecycle/artifact fixture remain separate work. Release acceptance remains
`releaseThresholdsVerified: false`.


## Conservative persistence LOC inventory: target not met

```sh
node scripts/benchmark-storage-loc.mjs --baseline-root=/absolute/path/to/clean/baseline
```

`persistence-loc-354.json` publishes every included and omitted production
module, both source hashes and counts, and the inclusion reasons. The union
includes direct persistence/file-I/O signals in either version, all storage
modules (including importer/exporter/maintenance), and every changed or new
production module. Whole modules use the same scope on both sides. Counting
uses nonblank physical lines including comments and excludes tests, scripts
and package metadata. This conservative candidate still requires semantic
scope review; it is not an approved denominator or a release acceptance claim.

The 246 included modules contain 40,103 baseline lines and 46,474 current
lines: growth of 6,371 lines (15.886 percent), failing the candidate 25 percent
reduction target. The complete new storage layer contributes 6,067 lines;
other included src modules change 39,501 to 39,790 and included MCP modules
602 to 617. New storage/import/export/maintenance code is not hidden from the
count. This snapshot predates the subsequent direct receipt admission fix.

## Fresh CLI startup, increments 356–357

Thirty alternating samples per backend and operation use a fresh Node 24.19.0
process with warm filesystem caches on Apple M2/macOS ARM64. The pinned baseline
is ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5. Each version output matches its
package manifest; empty task lists have identical JSON output and allocate no
storage. Raw before/after data: `macos-cli-startup-356.json` and
`macos-cli-startup-357.json`.

Before correction, version and empty-list native p95 regressions were 19.192
and 20.131 ms, exceeding their 10-percent-or-5-ms tolerances. Eager command
formatter and executor imports resolved 401 source modules, including 40 storage
modules, for version output. Lazy implementation loading reduces that to 16
source modules and zero storage modules while retaining the public registries
and canonical admission wrapper. After correction, baseline/native p95 are
125.273/42.619 ms for version and 119.831/69.985 ms for empty task-list. Both
meet the scoped small-workspace target.

This does not establish populated CLI, persistent MCP, filesystem-cold startup,
full-audit memory, or the full release thresholds.

## Ledger memory before indexed collection, increment 363

`macos-ledger-memory-363.json` retains the complete raw report from
`scripts/benchmark-ledger-memory.mjs --events=10,1000,100000 --repeats=3
--warmup=1 --payload-bytes=1024`. Seed42, Node24.19.0, Apple M2/macOS ARM64;
SQLite WAL/FULL. Setup is excluded; each operation/size has a fresh worker,
one warmup and three warm domain samples. No forced GC or cache eviction.
The valid chain contains TASK_RECEIVED followed by deterministic OBSERVATION
payloads. This is not a representative action/approval/recovery matrix.

At100000events native iterator/full-audit/export peak RSS is
115408/611808/139536KiB; native p95 is1917.156/1998.333/2605.482ms.
Every successful iterator/audit/export preserves the complete event count,
last hash and canonical byte digest. Pinned filesystem iterator/audit refuse
their unchanged JSON size limit, so no large full-audit parity or speedup is
claimed. Public export has no baseline-equivalent timing. Full audit still
materializes events; the observed memory deficit is retained as the correction
baseline. This report does not prove bounded full audit or release acceptance.


## Callback snapshot audit, increments 366–367

`macos-ledger-memory-367.json` records the same seeded 10/1,000/100,000
observation fixture on frozen source (2,447 files, every post-run SHA-256
unchanged). The harness now reports native `audit` through
`withEventLedgerAudit` and native `audit-array` through the retained public
array API, in separate fresh workers. Both perform canonical ledger and
semantic artifact validation and consume the full canonical count/head/byte
digest. Node24.19.0, SQLite3.53.3, Apple M2/macOS ARM64, WAL/FULL, seed42,
1KiB payloads, one warmup and three samples; setup excluded, no forced GC or
filesystem cache eviction. The callback audit includes a detached read-only
SQLite backup so awaited artifact reads share the same immutable view.

At100,000events callback/array peakRSS is184,720/623,248KiB (70.36% lower
for this fixture); p95 is6,769.910/1,924.039ms. At1,000events callback/array
p95 is75.901/28.522ms versus pinned filesystem19.123ms. At10events it is
5.680/1.026ms versus filesystem1.225ms. Snapshot copying plus repeated
canonical decoder/proof scans explain added latency; this requires further
optimization and release evaluation, not a performance pass. Large pinned
filesystem readers still refuse unchanged JSON limits, so no equivalent
large baseline audit speedup is claimed.

This establishes a measured callback audit path, not bounded memory for all
relation histories or all CLI/MCP consumers. Public array APIs, prepared
mutation overlays, and other internal consumers still materialize ledgers.
Observation-only payloads do not prove action/approval/recovery scale. Writer
waits, physical disk fault behavior, and full release acceptance remain open.
The unfrozen diagnostic366 report remains at /tmp/sqlite-ledger-memory366.json;
it is excluded from final-source acceptance.


## Verified typed selection and scratch relation backing, increments 368–370

`macos-ledger-memory-370.json` repeats the same frozen observation fixture:
2,451 source files, post-measurement hashes unchanged, seed42,1KiB payloads,
10/1,000/100,000events, one warmup/three samples in fresh workers. The complete
canonical scan still precedes indexed typed proof selection. Existing
`events_type_idx` is selected explicitly after EXPLAIN showed the planner
otherwise chose the primary sequence index. Tests reject indexed type
mismatches before this optimization becomes available. No integrity limit,
hash/details/schema check or authority gate was removed.

Handoff/legacy-migration/semantic-decision relation metadata has owned scratch
backing after128entries or64KiB serialized metadata per map. Only primitives
and canonical source positions are stored; proof payloads are re-read from
the immutable source, preserving private positional identity. Scratch SQLite
uses a1MiB cache and file-backed temporary sorting. Its private computation
transaction never holds the live operational writer and is discarded at owner
exit. Canonical storage remains WAL/FULL. Real native2,000handoff events plus
duplicate rejection and array parity cover relation spill; this is not a
representative action/approval/recovery benchmark.

Native100k callback/array p95 is3,392.667/2,013.827ms and peakRSS is
182,288/570,528KiB. The callback p95 is lower than367's6,769.910ms, but remains
slower than the public array audit. At1,000events callback/array/filesystem p95
is44.125/26.721/20.978ms; at10events4.440/1.083/2.141ms. Count/head/full-byte
parity holds for all successful rows; pinned large filesystem readers refuse
unchanged JSON limits. Repeated schema/decoder/observation scans and snapshot
copying still need investigation, alongside remaining relation arrays and
consumer/platform acceptance. No full bounded-memory or performance-release
claim follows from this observation-only report.


## Combined canonical scan, increment 371

`macos-ledger-memory-371.json` repeats the same observation-only experiment on
2,452 frozen files, post-measurement hashes unchanged, seed42/1KiB payloads,
one warmup/three fresh-worker samples per operation/size. First source scan
now combines schema/details validation and canonical observation digest with
full hash/chronology/proof validation. Partial/schema-failed scans remain
incomplete CAS observations; later immutable reads still decode and compare
indexed fields. Native100k callback p95 is2,979.771ms and peakRSS162,480KiB,
versus array1,944.354ms/627,072KiB. Successful count/head/byte parity remains.
Native1,000callback/array/filesystem p95 is39.657/27.734/21.441ms; latency
still needs investigation and release evaluation. This report precedes372
recovery-summary changes and is not representative relation/platform/full
release acceptance.


### Preliminary discovery regression after snapshot guards (increment 383)

`macos-discovery-383-before.json` measures frozen382 source against the clean plan-pinned baseline, five warm-cache API repetitions per variant/size on Node24.19.0/SQLite3.53.3/macOSARM64/AppleM2. Reproduce with `node scripts/benchmark-storage-sqlite.mjs --sizes=10,100,250,1000 --repeats=5 --baseline-root=<clean-pinned-checkout>`. Both paths return identical complete discovery outputs and validate ownership; direct SQL lookup is a separate measurement, not end-to-end acceptance. Synthetic tasks have RECEIVED states and empty logical ledgers, so this does not close representative history/action/recovery scales.

Native/baseline p95 milliseconds at10/100/250/1000tasks:976.843/586.636,1073.527/238.769,787.805/317.339,6814.438/1338.299. Five samples and large first/small-scale variance are preliminary, not release acceptance. The observed native path is slower at every measured size; earlier322 discovery gains do not establish current acceptance. Source review finds a detached whole-database backup for each task audit. Investigate sharing one immutable project snapshot while retaining full per-task validation, output parity, expiry/cleanup and parent CAS. No durability or integrity gate may be weakened to recover latency. All2455frozen source hashes were unchanged after restoring two accidentally edited documentation files from the verified source archive; runtime sources were untouched.


### Shared project snapshot discovery (increment 384)

`macos-discovery-384.json` repeats the equal-output comparison20times per size at10/100/250/1000/5000tasks against the same clean pinned baseline. Reproduce with `node scripts/benchmark-storage-sqlite.mjs --sizes=10,100,250,1000,5000 --repeats=20 --baseline-root=<clean-pinned-checkout>`. Hardware/runtime/durability and synthetic empty-ledger semantics remain as recorded above. Native discovery now creates one owned readonly project copy, shares it across full task audits and keeps catalog/artifact projection coherent; prepared overlays preserve their original path. All2458candidate hashes unchanged. Candidate predates the separately added direct core-task lookup admission fix; no complete final-source acceptance claim.

Native/baseline p95ms at10/100/250/1000/5000tasks:31.608/16.140,119.223/174.109,283.533/416.267,911.554/1421.918,4686.786/6528.505. Current paired baseline speedups1.460/1.468/1.560/1.393at100+tasks miss the proposed2xlarge-workspace threshold. The10-task native overhead15.468ms exceeds the small-workspace tolerance and remains under investigation. The earlier before/after runs use different repetition counts, so do not treat their ratio as a paired release speedup. Full per-task schema/hash/ownership validation remains enabled; profile repeated row reads, artifact validation and semantic bindings before another optimization. Representative ledgers/actions/approvals/recovery, populated CLI/warm integration, memory/FS/lock/WAL/event-loop measurements remain open.


### Discovery diagnostic CPU profile (increment388)

`macos-discovery-profile-388.json` records sampled self time from frozen385 synthetic native discovery (1,000empty-ledger tasks,20reads), with pinned runtime/source manifest. Raw profile is `/tmp/sqlite-discovery388.cpuprofile`; setup is included, so this is diagnostic rather than acceptance timing. Typed ledger iteration and repeated task-row queries dominate samples. Increment389 avoids range/index queries for an empty owned range while preserving full-scan digest completion and expiry checks. A query-count control proves0range queries versus2on the previous source. Post-correction latency acceptance remains open: an unrelated Xcode build was CPU-active during follow-up checks, and no timing comparison is treated as quiet-machine evidence.


### Empty-range query correction discovery comparison (increment391)

`macos-discovery-391.json` repeats all five task sizes20times against the same clean pinned pre-migration baseline. Reproduce with `node scripts/benchmark-storage-sqlite.mjs --sizes=10,100,250,1000,5000 --repeats=20 --baseline-root=<clean-pinned-checkout>`. Frozen391candidate2462source hashes are unchanged after measurement. This source includes389empty-range query correction plus390/391API/read consistency changes; it predates392decision discovery changes. No ForgeLoop test suite overlapped measurement; ordinary macOS/GUI background activity was not disabled. Both variants use warm-cache API calls, with baseline then native batches; no filesystem-cold claim. Native WAL/FULL and complete per-task integrity/ownership validation remain enabled.

Native/baseline p95ms at10/100/250/1000/5000tasks:9.559/13.464,45.213/128.437,120.884/322.834,352.860/1199.395,1897.509/6473.841. Equal-output discovery speedups2.841/2.671/3.399/3.412at100+tasks;10-task native path is faster and no small-workspace regression is observed in this fixture. Large2x and small-tolerance targets are met for these synthetic empty-ledger fixtures. Overall release thresholds remain unverified: representative valid histories/actions/approvals/recovery, populated CLI/warm integration and full resource/LOC/platform acceptance still require evidence. These are paired native/baseline comparisons, not a cross-run before/after speedup attribution.


### Current inclusive code-size investigation (increment402)

`persistence-loc-402.json` refreshes the conservative same-module union against clean pinned baseline ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5. Reproduce with `node scripts/benchmark-storage-loc.mjs --baseline-root=<clean-pinned-checkout>`.267included modules:43098baseline and50372current nonblank physical production lines including comments; net growth7274lines/+16.8788%. Tests/scripts/package manifests excluded equally; every new storage/import/export/maintenance module included. Semantic denominator review remains incomplete; this is an inclusive candidate measurement, not approved release scope or target success. No latency benchmark ran alongside the full suite.

New storage modules contribute6437lines. Largest additions: unit-of-work455, importer444, repository409, migration-candidate342, connection314, exporter284, task-guards283, migration-source249, ledger-relations200, project-restore195, schema177. These represent required transaction/CAS/integrity, migration and interchange ownership rather than optional features that can be dropped to improve the count. The proposed25% reduction target is missed. Remaining investigation must review overlap/obsolete normal-operation paths and architectural simplification while retaining safety and explicit legacy import/export. This attribution is an investigation input; no hidden exclusion is claimed.

The same recorded inventory attributes the increase as follows. These are whole-module counts in the inclusive candidate scope, not a semantic classification of each line.

| Scope | Baseline lines | Candidate lines | Net change |
| --- | ---: | ---: | ---: |
| Complete `src/storage/` ownership | 0 | 6,437 | +6,437 |
| Included `src/core/` modules | 33,094 | 33,760 | +666 |
| Included `src/commands/` modules | 5,851 | 6,081 | +230 |
| Included MCP modules | 602 | 617 | +15 |
| Other included production modules | 3,551 | 3,477 | -74 |
| Total | 43,098 | 50,372 | +7,274 |

The storage layer accounts for 88.49% of net growth. Existing transaction, task-migration, task-lock and transaction-maintenance modules together shrink from 1,114 to 362 lines, a reduction of 752 lines, but this does not offset the new implementation. The union also includes unchanged domain and repository code (for example, project detection); removing unrelated unchanged code from both sides would make the relative increase larger, so a narrower denominator alone cannot establish the reduction target.

At this denominator, meeting the proposed 25% reduction requires at most 32,323 counted lines, or 18,049 fewer than the current candidate. That is an architectural gap, not a formatting opportunity. Do not remove required migration/export/restore functionality, integrity checks or ownership validation to satisfy it. Review persistence-specific responsibility overlap and obsolete runtime branches before approving a semantic denominator and remeasuring. The current release decision is to retain the code-size acceptance gap: this candidate is not accepted as meeting the original plan. This decision does not establish migration completion or authorize publication.


### Genuine canonical diagnosis command comparison (increment404)

`macos-diagnosis-404.json` records20measured/two discarded warmup samples per backend at1/10tasks, each selected task with29actual events from supported canonical failure/diagnosis setup. Both backends perform a non-idempotent diagnosis and advance state revision/event exactly once; postcommand ledger validation is outside timing. Pinned clean ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5 filesystem command operates on a separately exported portable fixture; native command uses an already-open canonical database. Fixture/export/session setup costs are reported separately. The old harness filesystem label pointed at the current command and is not accepted as a backend comparison.

On Apple M2/macOSARM64, Node24.19.0/SQLite3.53.3, native/basep95ms4.962/143.996 at1task and5.264/154.712 at10tasks; medians4.598/125.480 and4.629/137.476. WAL/FULL/foreign keys remain enabled. All2467postmeasurement frozen hashes unchanged; exact source-file hashes included. Checkout HEAD is the original base, not a committed implementation identity. Reproduce from matching source with `node --import=./scripts/test-semantic-provider-loader.mjs scripts/benchmark-diagnosis-parity.mjs --baseline-root=<clean-pinned-baseline> --tasks=1,10 --measured=20 --warmup=2 --out=<output-directory>`.

No ForgeLoop suite/other benchmark overlapped. Ordinary macOS/GUI background activity was not controlled. Backend order alternates by scenario; samples are warm domain calls, not cold CLI/FS-cold. This fixture supports a scoped diagnosis speedup and no small-task regression; it does not establish large-ledger/history/action/recovery/resource or full release acceptance.

### Supplemental diagnosis resource mode (increments410–413)

The diagnosis harness accepts `--resources=true` for a separate instrumented run on the same canonical fixtures and pinned filesystem baseline. Reproduce with:

```sh
node --import=./scripts/test-semantic-provider-loader.mjs \
  scripts/benchmark-diagnosis-parity.mjs \
  --baseline-root=<clean-pinned-checkout> \
  --tasks=1,10 --measured=20 --warmup=2 --resources=true --out=<output-dir>
```

Each real timed mutation reports CPU deltas, process filesystem block counters, Node asynchronous filesystem request counts, RSS endpoints and process-lifetime peak RSS, event-loop utilization/delay, and database/WAL byte sizes before and after the command while its connection remains open. Post-mutation ledger validation remains outside both timing and operation resource counters. Raw samples and explicit measurement limits accompany the result.

This mode does not measure total filesystem operations, SQLite internal I/O, direct lock waits, operation peak RSS, peak live WAL, or MCP/HTTP event-loop behavior. Process-lifetime peak RSS includes fixture/import work and earlier samples, and the event-loop histogram includes a short timer drain outside command latency. Instrumented latency must be compared separately from the published uninstrumented404 result. The repeated macOS run is now published below; its limited counters do not establish whole-plan resource acceptance. Platform405 source is frozen before this harness extension; its core/MCP/package results cannot validate this extension.


`macos-diagnosis-resources-413.json` contains 20 measured samples plus two discarded warmups per backend for 1/10 tasks and the exact 2,468-file frozen-source hashes, verified unchanged after terminal exit0. Canonical selected histories contain29 events; each measured command advances revision and publishes a diagnosis, and both ledgers validate afterward. Runtime: Node24.19.0, SQLite3.53.3, AppleM2/macOSARM64; WAL/FULL/foreign-keys durability retained. The remote Windows/Linux suites used another host; no local ForgeLoop suite or other benchmark overlapped this run. Desktop background activity and periodic WinRM observation were not controlled.

| Tasks | Backend | Instrumented command p95 ms | User CPU p95 microseconds | System CPU p95 microseconds | Node async FS requests p95 | Timer maximum-lateness p95 ms |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | Pinned filesystem | 142.366 | 24,790 | 20,931 | 760 | 1.126 |
| 1 | Native SQLite | 4.726 | 4,475 | 355 | 0 | 3.784 |
| 10 | Pinned filesystem | 165.816 | 33,869 | 31,744 | 760 | 2.576 |
| 10 | Native SQLite | 4.734 | 4,971 | 324 | 0 | 3.795 |

The scheduled probe captures native synchronous blocking despite lower overall command latency. This is a canonical domain-command observation, not MCP/HTTP responsiveness evidence. Native WAL endpoint maxima are32,992/20,632bytes at1/10tasks, with database sizes208,896/229,376bytes; these are endpoint maxima across samples, not peak live WAL. All OS filesystem block counters were zero, so no disk-operation conclusion is accepted. Native zero Node async FS requests excludes SQLite internal and synchronous I/O. RSS endpoints and process-lifetime peak remain raw context, not an accepted operation-memory comparison because fixture/import work and previous samples share the process. Broader representative workloads, operation peak RSS, total I/O, direct lock waits and persistent integration behavior remain open. Release thresholds remain unverified.


### Owned immutable audit proof investigation, increments462–465

Pure ledger proof reuse is confined to one module-owned read-only SQLite backup callback. Its private identity is not caller-supplied `auditSource` metadata. Only successful pure proofs are remembered, keyed separately by both legacy-tolerance flags; returned result/errors objects are fresh. Semantic decision artifact bindings are rechecked. The initial462 implementation checked SQLite `data_version` before/after proof and binding work. SQL writes, including write-and-restore, invalidate that scope. A raw filesystem tamper later exposed a counter-only gap; correction469 also checks the private regular file identity, size and nanosecond modification/change metadata. The following462–467 measurements predate that correction and cannot establish its cost. The private entry is deleted before callback expiry. No public-array cache, invalid-error cache, persisted validation cursor or cross-request trust is added. Native typed marker queries retain the foreign-task checks and use indexed fields only after their full schema/index proof.

Focused audit/protocol/decision checks pass27/27, both legacy-tolerance directions and repair hardening pass104/104, and typed-marker/repair/audit/protocol checks pass107/107. The owned-copy write-and-restore control fails on frozen461 and passes on the candidate. Caller-mutated proof results, forged sources and expired sources retain fail-closed behavior. Fast verification passes; changed-file lint has no errors and four existing complexity warnings. These scoped checks do not establish full current-source/platform acceptance.

All comparisons below retain full VALID result parity, twenty measured repetitions and two warmups on valid public action/approval lifecycle fixtures, at59 and3029 events. Frozen complete source manifests and terminal hash checks are embedded. Hardware is Apple M2/macOSARM64, Node24.19.0/SQLite3.53.3 with WAL/FULL/foreign keys. No other local suite or benchmark ran concurrently; desktop activity and filesystem cache were not controlled. Warm persistent mode is canonical integration API connection reuse, not MCP transport.

| Published comparison | Native / filesystem p95 at59 events | Native / filesystem p95 at3029 events |
| --- | ---: | ---: |
| Per-call proof462 | 34.198 / 30.851ms | 217.935 / 165.853ms |
| Warm persistent proof463 | 33.848 / 31.811ms | 199.737 / 180.615ms |
| Instrumented persistent proof463 | 33.317 / 31.769ms | 274.369 / 163.871ms |
| Per-call typed-marker464 | 31.828 / 29.181ms | 255.049 / 179.317ms |

The small uninstrumented comparisons stay within the proposed five-millisecond allowance, but larger protocol validation remains slower than the equally validated filesystem result. Cross-run variance prevents attributing the marker change to a speedup from these separate runs alone. The native-variant diagnostic mode compares named immutable candidates against the same native fixture, alternating order each repetition: add `--native-comparison-root=<previous-native-checkout>` in per-call `--operation=protocol` mode. That mode labels the measured comparison as DIAGNOSTIC_NATIVE_VARIANTS; its pinned filesystem checkout still validates portable fixture parity outside measurement and is not the measured comparison. It cannot be used as the release filesystem baseline. A two-sample plumbing run preserves complete VALID output parity.

Instrumented CPU/async-filesystem/RSS-endpoint/timer/database-WAL samples retain the existing limits: they do not measure operation peak RSS, all SQLite filesystem I/O, direct lock waits, peak live WAL or MCP transport. Resource budgets, larger validation regression, inclusive code-size acceptance and full original-plan closure remain unresolved. No release success is claimed.

### Same-run native controls466–467 and guard469

Published diagnostic files `macos-native-variant-protocol-466.json` and `macos-native-variant-protocol-467.json` include both complete frozen source manifests, independently checked after terminal exit0. They retain twenty measured repetitions, two warmups, alternate candidate order and validate the complete result on the same native fixture. The pinned filesystem checkout validates portable fixture parity outside measurement; it is not the timed comparison.

| Diagnostic comparison | Candidate / previous native p95 at59 events | Candidate / previous native p95 at3029 events |
| --- | ---: | ---: |
| Typed-marker466 versus owned-proof462 | 30.865 / 31.908ms | 196.841 / 188.481ms |
| Owned-proof+marker466 versus uncached461 | 32.637 / 35.960ms | 194.012 / 256.594ms |

The paired control does not establish a marker speedup. Combined proof reuse reduces large-fixture p95 by24.39% versus uncached native461 in this run. This does not meet the filesystem release target and predates file-metadata guard469. Guard469 passes114 scoped checks on each of Mac, Windows and Docker Linux, including actual raw payload tampering with an unchanged SQLite counter. Its release comparison471 is recorded below. Resource, inclusive code-size and whole-plan acceptance remain open.

The guard470 diagnostic uses the same native fixture versus pre-guard466. At59 events p95 is32.702/32.936ms; at3029 it is206.809/314.325ms, but the previous candidate has two large outliers (314/324ms). Raw samples must be reviewed; this does not establish a guard speedup. The separate release comparison471 against the pinned filesystem baseline retains complete VALID output parity; see `macos-private-file-guard-filesystem-471.json` for raw samples and exact frozen source.

Guarded release comparison471 records native/filesystem p95 of34.167/30.267ms at59 events and214.612/160.706ms at3029 events. The small allowance is met, while the larger validation investigation remains open. Full Mac472 and Linux472 verify that snapshot. Windows472 failed fixture cleanup; corrected Windows480 subsequently exposed a raw-file integrity guard gap. These passes do not establish current-source acceptance.

### Linux operation-window RSS accounting475

On Linux, append `--resources=true --linux-peak-rss=true` to the canonical public-action/approval protocol harness. The opt-in mode resets this process's `VmHWM` via `/proc/self/clear_refs=5` immediately before each operation and reads the kernel high-water counter before the post-command timer drain. Unsupported platforms, denied procfs access and overlapping opt-in windows reject instead of reporting a substitute number. Default measurements remain unchanged. The lifetime-peak field is null in reset mode to avoid mislabeling reset high-water accounting.

This follows the [kernel procfs documentation](https://cdn.kernel.org/doc/html/latest/filesystems/proc.html). It is a kernel RSS estimate over the operation window, including retained fixture memory and instrumentation; it is not precise page-by-page accounting or incremental memory attributed solely to the command. The isolated container control475 excludes the previous149929984-byte high-water mark: reset RSS50872320bytes, operation-window peak59289600bytes. Exception and nested-window cleanup controls pass. The exact module SHA256 is included in `linux-operation-rss-control-475.json`.

The control overlaps full host suites and measures a synthetic allocation, so it establishes instrumentation behavior only. Representative full-domain Linux resource comparisons must run after those suites terminate. Total filesystem operations, direct lock waits, peak live WAL and warm MCP transport still require separate evidence; no complete resource-budget acceptance is claimed.

### Representative Linux persistent resource run477

`linux-persistent-operation-rss-477.json` retains complete VALID output parity, twenty measured/two warmup samples per backend at59/3029 events, exact2494-file frozen source hashes verified before/after execution, locked dependency equality and terminal Docker identity. Native and pinned filesystem results use the same provenance path in closed backend batches; native connections are reused within each batch. The container starts after Windows472 and Linux472 full suites terminate, and corrected Windows480 starts after this resource container exits. Other host background activity, watcher polling and surrounding staging/dependency setup are not controlled. This is an instrumented warm API comparison, not uninstrumented latency, filesystem-cold or MCP transport acceptance.

| Events | Native / filesystem instrumented p95 ms | Native / filesystem operation-window RSS p95 bytes | Native / filesystem timer maximum-lateness p95 ms |
| ---: | ---: | ---: | ---: |
| 59 | 163.966 / 163.251 | 138252288 / 162959360 | 45.864 / 10.300 |
| 3029 | 620.119 / 399.245 | 368173056 / 316424192 | 364.546 / 76.319 |

RSS is the reset kernel high-water estimate and includes the warmed process, retained fixture/import/previous-backend memory and window instrumentation. The larger native window is higher, so these samples do not prove lower native memory or explain the difference causally. Group order reverses between dataset sizes; no forced GC or independent fresh process per backend is used. The large latency/timer results remain acceptance gaps requiring investigation. Raw counters retain their stated scope: no total SQLite/filesystem operation count, direct lock-wait duration, peak live WAL or actual MCP transport responsiveness is established. The raw `timestamp` is a fixture seed date; `fixtureTimestamp` and container start/finish fields distinguish seed and execution identity.

### Audit observation lifetime and Windows content guard483

Control482 demonstrated that private snapshot mutation during a valid asynchronous callback could escape after validation. Current code captures initial validity, awaits the callback once, and checks the owned proof again before returning its result. Caller mutation of `audit.valid` cannot disable the final check. Initially invalid results and callback exceptions retain existing behavior.

Windows480 full core verification failed the raw-file mutation assertion even though the historical469 focused run passed. An independent connection read changed private bytes, but the owned file metadata and SQLite counter did not invalidate the proof. Current483 adds Windows-only bounded-memory SHA-256 hashing of readable snapshot bytes to the file identity. This extra filesystem I/O and CPU is absent from all published462–477 measurements. Those results must not be used as a current Windows resource budget or integrity acceptance claim. Current Mac focused audit20/20 and fast verification pass; Windows483 passes20/20 in each of three consecutive runs; Linux483 also passes20/20 with all2494 source hashes unchanged before/after; final platform/resource gates remain open.

### Inventoried old-client exclusion drill497

`old-client-exclusion-497.json` publishes the actual pinned filesystem CLI/lock operational drill on Mac, Windows and Docker Linux, including raw refusal results, observed process shutdown, captured source digests, archival, current native post-cutover write and terminal three-task validation. Remote source admission covers2496 files; Linux checks all before/after, Windows checks the2494 base files and four changed/new file hashes after completion. See the [operator procedure and privilege limits](../../docs/SQLITE_OLD_CLIENT_EXCLUSION.md). This is correctness/exclusion evidence, not a latency/resource benchmark or proof that unknown privileged installations cannot write a production project.

### Inclusive current-source LOC503

`persistence-loc-503.json` refreshes the same conservative whole-module union against clean pinned filesystem baseline `ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5`, including the501 quality observation correction.267 included production modules count43098 baseline versus50487 current nonblank physical lines including comments: net growth7389/+17.1446%. Every new storage/import/export/maintenance module is included; the artifact also lists all499 inspected production modules and hashes, including omissions. Tests, scripts and package manifests are excluded equally. The semantic denominator review remains PENDING, and the25% net-reduction target remains missed. This updates the count; it does not approve release, alter the original threshold or justify dropping integrity/interchange work.

### Persistence responsibility review504

`persistence-responsibility-review-504.json` records source-hash-bound review of four retained modules: transaction facade/legacy inspector, retired compaction refusal, singleton migration dry-run/refusal, and doctor installation/native diagnostics. Current normal mutations delegate to the SQLite unit of work. Legacy manifest scans occur only for explicit source admission and doctor without a selected native store; native doctor skips them. Doctor fix writes shipped templates and installation manifests, not task/event authority. These modules remain counted. No denominator change, code deletion, whole-consumer closure or release approval is inferred. The remaining included and omitted production modules still require semantic scope review.

### Unused persistence helper cleanup505

`persistence-cleanup-505.json` records removal of the unreferenced internal workspace-binding capture helper. Active guard assertions remain. Focused tests pass13/13 and fast verification passes. `persistence-loc-505.json` retains the same267-module denominator:43098 baseline versus50439 current nonblank production lines, a17.03% increase. The original25% reduction target and whole-consumer semantic review remain unresolved; this cleanup does not authorize release.

### Mac fresh CLI startup506

`macos-cli-startup-506.json` alternates30 fresh processes per backend and operation against the pinned filesystem baseline. Version p95 is129.35ms baseline/53.82ms native; empty-task-list p95 is122.66ms/71.92ms. Both satisfy the named small-workspace allowance, with exact output and no storage allocation verified. Filesystem caches are warm. This measures empty-workspace startup only; populated CLI, persistent MCP, memory, SQLite I/O, lock wait and release acceptance remain open. Remote full499 correctness tests ran on a different host; no same-Mac full suite overlapped this startup run.

### Windows full snapshot499 terminal506

`windows-full-snapshot499-terminal-506.json` retains raw core/MCP/package output and all2500 source hashes independently checked after exit0. Core passes2710/2723 with13 skips and0 failures; MCP73/73 and core/MCP package smoke pass. This validates snapshot499, including the Windows483 raw-file guard correction. It predates quality501 and cleanup505; final current-source acceptance remains pending. Linux499 is still running.

### Checkpoint conflict propagation508–511

`checkpoint-conflict-propagation-508.json` retains the failing deterministic control and local29/29 tests. Native revision conflicts now propagate unchanged from contract classification to existing concurrency reconciliation; malformed data handling remains. `checkpoint-conflict-platform-511.json` records29/29 each Windows and Docker Linux, with2501 source hashes unchanged before/after. Initial Windows510 lacked the repository semantic-provider test loader and failed7 authentication-dependent cases; corrected511 uses the normal loader with unchanged source and assertions. This is scoped verification; final full current-source suites and whole-plan acceptance remain open.

### Adjacent classification conflict513–514

`classification-conflict-propagation-513.json` retains two failing prechange controls and fixed31/31 Mac tests. Required-artifact and state classification now preserve native revision conflicts unchanged. `classification-conflict-platform-514.json` records31/31 each Windows and Docker Linux, with2501 source hashes checked before/after. Caller review identifies checkpoint, status and protocol validation use; whole combined status and protocol artifact coherence remain unverified. Final full-source platform acceptance and the original migration requirements remain open.

### State classification snapshot515–516

`state-classification-snapshot-516.json` retains an independent-write negative control: atomically replacing a coherent state/contract pair between classifier reads previously returned MISMATCH. The complete direct classification and status entrypoints now use the existing native read snapshot helper; prepared transactions keep their staged observations. Fixed focused tests pass32/32, including malformed data, concurrency, immutable pair and prepared-conflict controls. The SQL pair control is not a domain-valid lifecycle transition or proof of a false public PASS. Exhaustive combined status projections, remote516 and final full-source acceptance remain pending. Protocol validation already has the complete snapshot wrapper and is unchanged.

### Stronger state/status oracle517

`state-status-snapshot-oracle-517.json` verifies that direct classification and public status retain the original pending-step list during independent coherent pair replacement, and the next call sees the replacement marker. Both pass. Removing only the outer status wrapper also passes these checks because nested classification keeps its snapshot. Thus this oracle supports the state/contract payload only; whole recovery/claim/continuity coherence remains unproven. This does not advance the full consumer checkpoint or final current-source acceptance.

### Combined status and continuity oracle518

`status-continuity-snapshot-518.json` adds typed continuity to the independent atomic state/contract replacement. Removing only the outer status wrapper now fails: pending steps come from the old view while continuity comes from the new commit. Current status retains both original views; the next call sees both replacement markers. Current focused regression passes33/33 with the repository test provider loader. This is a coherent lowlevel replacement control, not a domain-valid transition or false public PASS. Complete recovery/claim projection coverage and remote/current-full acceptance remain open.

### Status snapshot platform519

`status-snapshot-platform-519.json` records33/33 focused checkpoint/state/combined state-continuity tests on Windows and Docker Linux, matching Mac518. All2502 admitted source hashes remain unchanged before/after each remote run. These probes include516 production snapshots and518 stronger continuity oracle. The original checkout retains36 files with no hash drift. This scoped evidence does not close exhaustive recovery/claim consumers, final full-source suites, resources, LOC release acceptance or changed GitHub workflow execution.

### Maintenance coverage520

`maintenance-coverage-520.json` maps all eight original safe-migration requirements and ongoing backup/restore boundaries to source hashes and named tests. Current Mac31/31 focused source/candidate/attachment/project-backup/public-restore cases pass. [Coverage and gaps](../../docs/SQLITE_MAINTENANCE_COVERAGE.md) preserves the interruption/platform and rollback/downgrade requirements. It does not close the whole maintenance checkpoint.

### Exact reverse-export compatibility525

`reverse-export-compatibility-525.json` records Mac disposable exact-target reverse export after a canonical native task write: native and pinned old validation both VALID at the same project path; new native task preserved; old CLI accepts a subsequent legacy task; current client refuses legacy mutation without allocating a database. Retained native logical state is unchanged. Relocation correctly fails execution-root provenance, and an incomplete fixture remains incomplete on both readers. [Boundary and limits](../../docs/SQLITE_REVERSE_EXPORT_BOUNDARY.md) retains Windows/Linux, attachments, pre-write rollback and full maintenance acceptance gaps.

### Exact reverse-export platform526

`reverse-export-platform-526.json` records the same portable drill on Mac, Windows and Docker Linux. Each native and pinned legacy canonical task validates VALID; accepted native task data is preserved; legacy write succeeds; current client refuses legacy mutation without database allocation; retained native logical state stays unchanged. Windows and Linux2503 source hashes are checked after the run; Linux additionally checks all admitted hashes before the run, uses locked cached dependencies and disables network. Git/workspace, old-target attachments, pre-write rollback, interruptions and whole maintenance acceptance remain pending. No production conversion or timing/resource acceptance is claimed.

### Git-bound exact reverse-export platform529

`reverse-export-git-platform-529.json` extends the pinned same-path compatibility drill to a real regular Git checkout and a task bound through the canonical workspace command. All three hosts pass native/old VALID validation, existing binding recognition, accepted native task retention, legacy write, native refusal without allocation and unchanged retained native state. Remote2503 source hashes are verified; the default non-Git control and21 focused protocol/audit cases pass, as does fast verification. Linked Git worktrees, old-target attachments, pre-write rollback, interruption consolidation and whole release acceptance remain open.

### Populated fresh CLI harness607

`scripts/benchmark-storage-populated-cli.mjs` compares complete paginated task-list and bounded history output against clean pinned baseline `ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5`. Only a validated history snapshot wall-clock capture timestamp is omitted from equality; task/claim/ownership, chronology, hashes, integrity and all other fields remain compared. Fixtures are synthetic valid RECEIVED tasks with disjoint claims and deterministic hash-chained observations. Setup and portable export are excluded from samples.

```sh
node scripts/benchmark-storage-populated-cli.mjs --baseline-root=/absolute/clean-baseline --sizes=10,1000 --events=10 --selected-events=1000 --repeats=20
node scripts/benchmark-storage-populated-cli.mjs --baseline-root=/absolute/clean-baseline --sizes=10,100,1000 --events=10 --selected-events=1000 --validate-only
```

Run latency sampling after full verification/other benchmarks on that host terminate. Fresh CLI processes and backend order alternate; filesystem caches are warm, not controlled filesystem-cold. Validation-only emits no latency samples. CLI entrypoint hashes alone are not complete source identity: bind release measurements to the admitted frozen source manifest. Persistent MCP, filesystem/SQLite I/O counts, lock waits, peak RSS/WAL and event-loop acceptance remain separate requirements.

### Actual persistent MCP populated reads (624)

Run `node scripts/benchmark-storage-mcp.mjs --baseline-root=<clean-ee9ce111-checkout> --sizes=10,1000 --repeats=20 --output=<latency.json>` from a frozen current source checkout. Run a separate invocation with `--resources=true` for instrumentation;do not mix its elapsed samples with uninstrumented latency. `--validate-only --repeats=2` validates fixtures/response parity without release timing claims. Both backends use the same current MCP adapter and pre-existing external dependencies;module resolution selects pinned/current core explicitly.

Seeds are defined in the script:valid task descriptors,active disjoint claims,andten chained observation events pertask. Fixture timestamp is fixed for reproducibility. Each backend runs a fresh worker andone persistent in-memory MCP server/client pair,withtwo warmup requests peroperation andtwenty measured calls. Tool/resource envelopes mustmatch exceptdeclared packageVersionmetadata,whichmustmatch eachbackendmanifest. Framing overstdio/HTTP isexcluded;handler output serialization isincluded.

AppleM2/macOS/Node24.19 results are in `macos-mcp-latency-624.json` and `macos-mcp-resources-624.json`. Large p95 meets2x in thisdiscoveryprofile,butnative large-worker peakRSS451.59MiB vs237.81MiB baseline remainsunderinvestigation. Fresh worker peak excludesfixtureconstruction butincludesstartup;it isnot anoperationpeakwindow. EndpointWAL0 doesnotprovepeakWAL. Whole release/performance acceptance remainsopen.

### Current-source writer contention629

Frozen candidate624 completes12 runs (1/2/4/8 independent writer processes,three repetitions,20 commits per process,1000 initial events),900 commits per backend. Every run proves complete state/event parity,valid event chains and active claim ownership. At8writers native throughput230.54–236.71commits/s versus7.96–8.33baseline;native p95 transaction latency91.30–100.95ms versus2840.96–4893.27ms. Highest worker lifetimeRSS77.11MiB native versus87.13MiB baseline excludes parent seeding but includes worker startup. Retry counts are disclosed;direct lock waits and peak liveWAL are not measured. All2669 control hashes match. Evidence: `benchmarks/storage-sqlite/macos-contention-629.json`. This verifies the named synthetic public-transaction workload,not universal or MCP mixed-load acceptance. Progress55%;checkpoint18 remainsPARTIAL.

### Instrumented writer resources630

Opt-in `--resources=true` adds per-worker CPU, BEGIN IMMEDIATE entry durations, and independent2ms parent WAL sampling to the public transaction harness. A two-writer pilot proves parity;lint/fast pass. Frozen630 completes12 instrumented1/2/4/8-writer runs,900commits per backend,with full state/event/ownership parity and2669 unchangedsource hashes. At8writers BEGIN entry p95 is9.85–19.39ms and maximum450.66ms. Largest sampled liveWAL2945832bytes (~2.81MiB). BEGIN timing includes SQL overhead and excludes pre-BEGIN optimistic retries;WAL maximum is periodically observed,not an instantaneous bound. These instrumented timings do not replace uninstrumented629 latency. Production runtime unchanged. Evidence: `benchmarks/storage-sqlite/macos-contention-resources-630.json`. MixedMCP reader/writer and larger-workload resource acceptance remainopen;progress55%.

### Actual mixed MCP trace reads631

New `scripts/benchmark-storage-mcp-mixed.mjs` runs one persistent realMCP server/client against an independent canonical task writer. Trace assertions match state revision,ledger tail,event count,all event sequences and per-write revision details. A corrected20-read pilot passes;lint/fast pass. Frozen631 completes100reads while83writer revisions commit;reads observe0–82 including intermediate committed states. Final state revision,event count and entire rawledger validation pass. All2670 frozenhashes match. Reader lifetime peakRSS179.97MiB includes seed/server startup and isnot isolated operationpeak. This one-task/one-reader/one-writer synthetic native workload hasno baseline comparison,stdio/HTTP framing,universal memory bound or largeworkspace scaling proof. Evidence: `benchmarks/storage-sqlite/macos-mcp-mixed-631.json`. Progress55%;whole resource acceptance remainsPARTIAL.

### Mixed MCP scaling failure632

Harness now supports1–1000tasks and1/2/4concurrentcalls,plus complete unchanged task/event/claim row digests. Ten-task4-call80-read pilot passes;lint/fast pass before measurement. Frozen1000-task20-batch run fails writer-progress assertion. A longer100-batch diagnostic also fails:writer finishes1000commits in8779.24ms;first4trace calls return after9073.23–9090.53ms,andall400reads see revision1000. Consistent snapshots alone do not prove mixed overlap. No PASS or performance acceptance is claimed. Longer-rundiagnostic uses current source,not frozen632;production runtime isunchanged. Evidence: `benchmarks/storage-sqlite/macos-mcp-mixed-scaling-failed-632.json`. Investigate first-read admission/backup behavior and distinguish cold from warmed access before another experiment. Progress55%;whole acceptance incomplete.

### Native backup starvation correction633

Diagnostic instrumentation localizes initial1000-task read delay to backup:four calls begin nearrevision1 andcomplete after8822–8840ms nearrevision1000,matching8772mswriter duration. Node24.19 docs explain restart after other-connection writes. Isolated single-step variant passes14snapshot tests andmixedoverlap. New deterministic500-task (>100page) regression injects independentwrites between unfinished native backup steps;old codefails after exhausting3restartopportunities. Production `withStorageSnapshot` now uses supported backup rate0x7fffffff to copy in one native step,retaining owned readonly copies and all validation. Focused snapshot/eventaudit35tests,lint andfast pass. Frozen633 natural1000-task4-call80-read run passes snapshot/event/unchanged-row assertions while301writer revisions commit;reads observe1–289. All2670 frozenhashes match. Peak readerRSS261.80MiB includes seed/startup;this isnot matched release latency or universal memory evidence. Evidence: `benchmarks/storage-sqlite/snapshot-backup-correction-633.json`. FullMac620 and remote612/617 evidence is nowhistorical;newproduction fullMac/Windows/Linux and release measurements pending. Progress55%;whole acceptance incomplete.

### Snapshot-corrected MCP latency635

After fullMac634 terminal completion,20-repetition uninstrumented actualMCP discovery runs preserve complete cross-backend output parity. Ten-task native/baseline p95 task-list11.568/14.952ms,projectresource10.359/12.984ms. At1000tasks task-list634.826/1239.047ms (1.952x,below2x inthisrun),projectresource569.083/1238.178ms (2.176x). Prior6242.070xtool result remains variance evidence,not substituted fornewsource. All2682 frozenhashes match. Evidence: `benchmarks/storage-sqlite/macos-mcp-latency-635.json`. Separate currentresource measurement remainsneeded;whole performance acceptance and progress55% unchanged.

### Snapshot-corrected MCP resources636

Separate20-repetition instrumented actualMCP discovery preserves output parity andall2682 frozen634hashes. At1000tasks native medianCPU user+system609773/588029us(tool/resource) versus1325158.5/1310250baseline;maximumasyncFSrequests101/97 versus66006/66002. Nativeworker lifetimeRSS peaks443.30MiB versus249.08baseline. ResourceRSS endpoints428.61→435.81MiB;task-list297.08→428.02MiB. These fresh workers excludeseed butinclude startup/prioroperations;endpoint samples are not per-operationpeak. WALendpoint0 isnot livepeakproof. HighernativeRSS remainsmaterial,not waivedby lowerCPU/FS. Evidence: `benchmarks/storage-sqlite/macos-mcp-resources-636.json`. Earlier200-request plateau628 is historicalbefore633productionchange;current run supplies20-requestresource evidence only. Whole performance/resourceacceptance remainsPARTIAL;progress55%.

### Current-source state/event commits637

Twenty matched publictransaction samples with3claims use frozen634production,WAL/FULL and unchanged pinned filefsync. State/event and persistedtail parity pass. Native/baseline p95:10events10.966/129.308ms (91.52%lower),1000events15.252/121.924ms (87.49%lower),100000events166.268/136.965ms (21.39%slower). Fullownership matches10/1000;baseline100000audit refusesJSON_LIMIT_EXCEEDED andretainsclaims,nativeownershipvalid. Baseline audit byteslimit is2MiB;mandatory100000hashes plus99999prevHash64hexstrings alone are12799936bytes,so trimmingevent details cannotrestorefullaudit parity. Do notreplaceoriginal100000-realistic-eventscope withsmallerfixture orchangebaseline limits. All2682 frozenhashes match. Evidence: `benchmarks/storage-sqlite/macos-state-event-commit-637.json`. Largecommit performance remainsfailed/unproven underrequired acceptance;profile its nativeoperation stages without weakeningvalidation. Progress55%;checkpoint18 remainsPARTIAL.

### Large commit stage diagnosis638

Isolated20-sample100000-event3-claim stage instrumentation preserves committedstate/event/tail checks. Native medians entry2.963ms,state mutation0.468ms,eventappend0.388ms,finalcommit155.596ms;baseline finalcommit59.062ms. A second SQL probe measures20 reservation guard scans:median159.521ms within161.050ms finalcommit. Source `resolveStoreReservationState` compares canonical JSON against indexed task/sequence/hash/previousHash/time/type fields for everyhistoricalrow. These diagnostic timings are not release latency. Corrected installedJevgrep syntax returns75relevantfiles,terminal0. All2682 frozenhashes unchanged. Evidence: `benchmarks/storage-sqlite/large-commit-stage-diagnostic-638.json`. Nextoptimization must retain scalarSQL semantics,BLOB/error parity,corrupt/repair fullproof fallback and freshhistorical checks;no validationcache or reducedfixture. Progress55%;whole acceptance incomplete.

### Rejected reservation SQL variants639

Isolated materialized andstreaming JSONBparse-once variants eachpass11guard/reservation tests,includingexpanded87-case scalarSQL/duplicate-key/numeric/BLOB-column/BLOB-payload oracle. Initial parityharnessGitmetadata omission wasdiagnosed andcorrectedbefore successfulruns. Twenty100000-event3-claim diagnostic samples preserve commitparity butscanmedians352.568ms(materialized) and229.611ms(streaming) exceedaccepted159.521msprobe638. Bothvariants rejected;productionSQLunchanged. Expanded87-case oracle isretained inmaintainedtests andpassescurrent11-test suite pluslint. All2682 frozencontrolhashes remainunchanged. Evidence: `benchmarks/storage-sqlite/reservation-jsonb-rejected-639.json`. Diagnosticmemory includesseed/priorbackend anddoesnotprove operationbudget. Originalfullperformance/LOC/remote/workflow/publicwriter gates remainopen;progress55%.

### Rejected grouped-field reservation variants640

Isolated streaming canonical-field extraction andexact-group-match/historicalpredicate fallback eachpass11guard/reservation tests andexpanded87-case oracle. Expected indexedcolumns remaintypedSQL;BLOBserialization isguarded beforegroupcomparison andedgecases retainoriginalpredicate. Twenty100000-event3-claim diagnostic runs preservecommitparity:guard medians247.995ms(streaming) and157.273ms(exact/fallback) versusaccepted159.521ms638probe. Streamingworsenscost;exactfallback hasno meaningfulgain anddoesnot resolve30%largecommit target. Neither adopted;productionSQLunchanged. All2682 frozencontrolhashes match. Evidence: `benchmarks/storage-sqlite/reservation-field-variants-rejected-640.json`. Resume remainingpersistence-scope audit;retainlargecommit acceptance asopen,withoutweakeningfreshhistorical/indexed validation. Progress55%.

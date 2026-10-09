# SQLite migration consumer matrix

Current checkpoint progress: [SQLite migration progress](SQLITE_PROGRESS.md).

## Current local acceptance evidence

Full Node 24.19.0 prepush at `4b196d3` passed with 2,958 core tests:
2,947 passed, zero failed, and 11 skipped. Clean packaged MCP passed 77 tests;
PoC67, package12, Python56, coverage, documentation, policy, and remaining
prepush gates passed. All 3,090 tracked source hashes matched the before-start
manifest. Evidence: `benchmarks/storage-sqlite/prepush-4b196d3-success.json`.
These results supersede the historical unexecuted-regression descriptions
below; they do not establish current cross-platform or whole-consumer closure.

The actual MCP suites now cover native activation, evaluation and accepted
handoff resources, and full/maintenance portable bundle tools with exact API
response parity and exported-file size/digest checks. Core validation includes
selected-task continuity, foreign-task bundle rejection, and public
run-action/native and adapter run-check transaction-boundary regressions.

The durability helper preserves tolerated directory-sync errors and strict
publication open/close errors. The startup module-boundary regression found
by full validation was corrected through lazy maintenance-handoff loading,
without widening the admission-module allow-list. Immutable task-row caching
is bounded to 64 rows; deferred task observations retain the revision and
full-row conflict fingerprint. This structural bound is not an RSS claim.

Matched 1,000-task MCP pilots at `9f7cc66` and `589c565` retain 25 samples per
backend/operation, response parity, unchanged before-start source hashes,
closed workers, parent completion, and fixture cleanup. At `589c565`, native
project/tasks p95 was 507.17 ms versus 1,278.75 ms for baseline, but native
endpoint RSS remained higher. Resource acceptance remains open. See
`benchmarks/storage-sqlite/mcp-pilot-589c565.json`.

The inclusive function scope at production `8927208` is closed with zero
unresolved membership, but its 25,732 → 32,538 selected-line comparison fails
the unchanged 25% reduction target. All storage, importer/exporter,
compatibility, and maintenance code remains included. Later production
changes require a refreshed measurement. See
`benchmarks/storage-sqlite/persistence-loc-c98186c-closed.json`.

GitHub core run `37993768913` is validating pushed revision `aa03451`.
Current expanded platform results, resource/LOC acceptance, sole-writer and
whole-consumer closure, and official validator-backed completion remain open.
No PR or package publication has been performed.

## Verified retirement and read-only scope corrections

Full local prepush on `2a3429e` passes: 2,938 core tests pass, 11 are skipped,
and MCP73, PoC67, package12 and remaining gates pass. The retained record is
`benchmarks/storage-sqlite/post927-prepush-complete.json`. Commit `00a276d`
adds actual MCP activation coverage: the current-source clean MCP suite passes
74 tests, including response/session-row/active-pointer identity and absence
of live session-file mirrors. This is local coverage, not platform closure.

Commit `ee9addd` removes the retired compaction script, maintenance module,
package command and unused recovery wrapper. Read-only incomplete-transaction
inspection remains for migration admission and doctor diagnosis. All 27 focused
transaction/doctor/migration tests and fast verification pass. This retirement
removes 21 nonblank maintained source/script lines, not the required 25% total.

Commit `57b91bd` prevents read-only scopes and detached snapshots from staging
or committing mutations, including on a physically writable connection. Pure
read-only discovery releases detached commit observations; writable parents
retain freshness checks. All 47 focused snapshot, owner and bootstrap tests
pass. Measured RSS improvement and final-source acceptance remain unverified.

## Terminal resource comparison927 and continuity corrections

GitHub run `37922435146`, job `113793330871`, completed successfully on
`20aca2ba332ed86323722ef91812925ad9dadb83`. Artifact `11634220092` retains
four matched operation results, 200 latency/resource samples per backend and
operation, unchanged 3,057 tracked source records, four closed workers, parent
completion and fixture cleanup. The runner returned idle. The retained analysis
is `benchmarks/storage-sqlite/mcp-resources927-complete.json`.

Observed MCP p95 speedup is 3.95–4.06×. At 5,000 tasks native RSS endpoints reach
682.48 MiB versus 254.36 MiB for the baseline; finite samples do not establish
bounded long-lived memory or close resource acceptance. Full-plan completion,
LOC reduction and protocol closure remain open.

Runtime regressions reproduced selected-task continuity being ignored and a
portable bundle accepting foreign-task continuity after manifest rebinding.
Production now forwards the selected task through continuity retrieval and
response paths, and rejects bundle continuity with a different task identity.
The bundle suites pass 13 cases; focused and broader continuity suites pass
26 cases. `verify:fast` passes. Earlier preparation sections below describe
historical checkpoints and do not override these correction results.

## Historical preparation and bounded filesystem review943

At that historical checkpoint, five test files contained unexecuted regressions for selected-task continuity
retrieval and response paths, foreign-task continuity in portable bundles,
public task-scope lease/claim rejection, and exact retained legacy sidecar bytes.
Production corrections have not been applied. These cases must run against the
unchanged implementation before correction and then pass afterward; their
presence does not establish acceptance.

Commit `f88d2f9` also prepares public run-action and native run-check tests that
pause a real child process and observe the active SQLite store, plus a separate
run-check adapter callback test. Syntax and ESLint checks pass; test bodies have
not run. Task-scope Git inspection still lacks an equivalent observation.

The external `persistence-loc922-scope-review.json` identifies unrelated domain
code included by the conservative whole-module inventory. Its published totals
remain retained. The prepared function-scope analyzer and manifest preserve the
25% threshold, include every storage module, and reject unresolved membership;
they have not produced an acceptance measurement.

The external binding review reconciles all 42 indexed filesystem escape leads
and all 54 statically resolved `writeFileAtomic` call sites against current
source hashes. The reports distinguish portable/configuration output,
maintenance journals, immutable attachment bytes, installation metadata and
advisory transport/index state from canonical operational records. Numeric
open/access flags are not callable filesystem capabilities. This closes the
finite inventory reconciliation, not interprocedural or whole-repository
sole-writer proof. Other filesystem APIs, wrapper propagation and public
consumer behavior retain their separate obligations.

Ordinary backup is intentionally online: SQLite backup produces a retained
snapshot, and attachment copying follows that snapshot's immutable references.
Migration and active replacement retain separate quiescence requirements.
Direct backup callers supply the database/source-root association; this source
review does not independently validate arbitrary supplied handles.

External records are retained under `/Users/cassio/.codex/verification`:
`regressions939-preparation.json`, `filesystem-escapes942-reconciliation.json`,
`filesystem-atomic943-reconciliation.json`, and their referenced reports.
The portable scoped review is retained in
`benchmarks/storage-sqlite/filesystem-authority944-review.json`, including
call-site descriptions, source hashes, coverage leads and explicit limits.
The natural resource job was still measuring at the 14:50 UTC observation;
tests remain deferred until terminal status and cleanup. The inclusive LOC
target remains unmet, protocol state remains `CORRECTING`, and no PR exists.

## Current production and validation933

The semantic revision-conflict correction919 is now covered by full local prepush920, Windows926, Core931 (all17 jobs), package932 (MCP73 on each of three hosts) and expanded compatibility933 (all7 jobs). Source-bound terminal records are retained under `benchmarks/storage-sqlite`. Local commits since pushed `20aca2b` retain unchanged production and add the unexecuted regressions described above. Natural resource comparison37922435146 is running against that validated production revision; it is not yet acceptance. Complete consumer/maintenance authority, resource/LOC gates and protocol closure remain open.

## Quality consumer reconciliation934

`quality-baseline` enters native task mutation; its direct service commits the baseline artifact and event together after rechecking canonical bindings. `quality-status` reads through the owned native snapshot when no prepared writes exist. Evaluation enumeration selects operational names; canonical artifact reads/writes select SQLite and portable output refuses canonical namespaces. Current source and the three relevant test files exactly match full prepush920. Its retained log proves five named controls: consistent independently replaced state/contract observation, baseline immutability, artifact/event rollback, stale binding rejection without provider replay, and concurrent native attempt allocation. Hashes, exact results and limits are in `benchmarks/storage-sqlite/quality-consumers934-review.json`.

This resolves the specified quality persistence boundaries, not every transitive dependency or public projection. The historical quality rows below remain partial until those remaining obligations are reconciled; no sole-writer capability is enabled by this review.

## Continuity writer and deletion reconciliation935

`record-continuity` and `clear-continuity` use native task mutation wrappers. Canonical recording delegates to SQLite artifact staging; clearing requires an exact task/path and stages only continuity deletion in a task transaction. Current source and four conformance test files exactly match full prepush920. Its retained log proves recording, command input parsing, state-preserving deletion, refusal of authority fields, and fresh/stale non-evidence classification. Source hashes and six exact results are retained in `benchmarks/storage-sqlite/continuity-consumers935-review.json`.

Direct callers can supply state/contract/repository options. That compatibility boundary does not make supplied data lifecycle evidence; direct-call freshness/race scenarios and reconciliation/context consumers remain separate review obligations. This review does not close the whole continuity family or universal transitive consumer checkpoint.

## Current storage entry-point review921

The original per-file table predates these public entry points. Rollback commands use inline executors rather than dedicated command files. This review identifies current admission and conformance sources; it does not establish complete transitive authority or final platform acceptance.

| Command | Implementation | Persisted or exported data | Admission and ownership | Conformance source | Remaining acceptance |
| --- | --- | --- | --- | --- | --- |
| `storage-migrate` | `src/commands/storage-migrate.js` | Retained source capture and SQLite cutover | Explicit destination/quiescence; owner-bound migration service | `tests/storage-migrate-command.test.js` | Migration publication and old-client exclusion; current full-source/platform and transitive reconciliation remain required |
| `storage-migration-resume` | `src/commands/storage-migration-resume.js` | Retained cutover journal and candidate | Exact dead owner/quiescence; owner continuity; preserve accepted native state | `tests/storage-migration-resume.test.js` | Per-checkpoint process termination and terminal validation; current full-source/platform and transitive reconciliation remain required |
| `storage-migration-status` | `src/commands/storage-migration-status.js` | Layout and bounded maintenance-owner metadata | Read-only exception; lstat and contained owner reads; no liveness/database validation claim | `tests/storage-migration-source.test.js` | Noncreating public status while ordinary dispatch is excluded; current full-source/platform and transitive reconciliation remain required |
| `storage-restore` | `src/commands/storage-restore.js` | Verified backup into fresh or explicitly replaced active project | Quiescence; exact maintenance owner; outgoing retention for active replacement | `tests/storage-restore-command.test.js` | Fresh and active replacement branch coverage; current full-source/platform and transitive reconciliation remain required |
| `storage-restore-resume` | `src/commands/storage-restore-resume.js` | Recorded fresh/active replacement publication | Explicit operation and owner; recorded continuity; quiescence; terminal current-state validation | `tests/storage-project-restore.test.js` | All current public recovery/platform checkpoints; current full-source/platform and transitive reconciliation remain required |
| `storage-backup` | `src/commands/storage-backup.js` | SQLite backup; optional referenced attachment bytes | Canonical read-only project admission; safe destination; committed independent backup; no overwrite | `tests/storage-project-backup.test.js` | Database-only and attachment-inclusive CLI/API behavior; current full-source/platform and transitive reconciliation remain required |
| `storage-rollback` | `src/core/command-executors.js` | Conditional restoration to supported legacy release | Inline executor; operator requires excluded writers/native writes; pinned clean target; validation-backed release | `tests/storage-rollback-command.test.js` | Actual pinned legacy CLI plus supported rollback boundaries; current full-source/platform and transitive reconciliation remain required |
| `storage-rollback-resume` | `src/core/command-executors.js` | Recorded conditional source restoration | Inline executor; exact owner; excluded writers/native writes; clean pinned target; continuity | `tests/storage-rollback-command.test.js` | Public recovery checkpoints and retained native/binary preservation; current full-source/platform and transitive reconciliation remain required |

Evidence: `benchmarks/storage-sqlite/maintenance-matrix921-review.json`. All nine service source hashes in the earlier admission mapping622 still match current source. Filename matching is discovery only; the six missing dedicated command rows and two inline rollback executors do not imply missing implementation.

## Current dispatch and literal-file review (849)

The package exposes CLI and `./integration`; 115 command definitions have exactly 115 executors, with no missing or extra entries, and the integration registry declares 25 resources. CLI, programmatic API and MCP tools share the executor boundary. MCP resource calls share the integration-resource boundary. Ordinary project dispatch selects SQLite admission; explicit maintenance/conversion exceptions retain dedicated admission. Missing read-only state is noncreating; writable fresh state bootstraps SQLite and retained legacy state requires explicit migration.

All 103 literal filesystem module roles are reconciled in `benchmarks/storage-sqlite/raw-file-role-reconciliation847.json`. This closes literal module-role coverage, not complete transitive parameter conformance. The supplied-fingerprint route correction848 was pending platform verification at this historical checkpoint; reconciliation896 confirms its production source is included in the later passing platform snapshots. Current public dispatch, authority, resource snapshot and CLI parity regressions pass 47 tests without failures or skips. Source hashes and exact limits are in `benchmarks/storage-sqlite/public-dispatch-boundary849.json`.

Historical entries below retain their original source and unresolved findings. They must not override newer implementation evidence or be treated as current completion claims. Remaining acceptance includes transitive reader/writer conformance, current maintenance/platform coverage, original performance/resource/code-reduction gates and validator-backed completion.

## Resource accounting475–477 and context cleanup479

The benchmark harness now supports opt-in `--resources=true --linux-peak-rss=true` on Linux. Requested unsupported/denied procfs access and overlapping windows reject. The exact-module Linux control verifies high-water reset excludes earlier allocations and releases the measurement scope after exceptions/nested attempts. Mac default measurement, non-Linux refusal and a35-event complete-VALID public-fixture plumbing comparison pass. Fast verification and changed-file lint pass. This establishes instrumentation behavior only; resource477 terminates exit0/no OOM after both full472 host suites finish, using an immutable2494-file candidate and a clean pinned filesystem baseline. Complete VALID parity holds in20measured/2warmup samples per backend at59/3029 events. Native/filesystem instrumented p95 is163.966/163.251ms and620.119/399.245ms; operation-window RSS p95 is138252288/162959360bytes and368173056/316424192bytes. The large native latency/RSS/timer results retain acceptance gaps; process warming/retained fixtures and uncontrolled background/staging preclude causal memory attribution. Corrected Windows480 starts afterward and is confirmed live as PID10632.

Windows472's single failure is transient fixture cleanup `EBUSY`, not a failing authority assertion. Correction479 uses bounded retries and preserves all evaluation-context assertions. Mac4/4 and Windows12/12 scoped controls pass. Full corrected Windows acceptance is still pending. These benchmark and fixture changes do not modify production authority or durability.

## Full canonical Mac472 acceptance

The full current-source `verify:prepush` passes through canonical ForgeLoop run-check, execution `exec-9c63cd36-1698-4109-8a67-ac5c259fe0d4`. Core2722 tests:2711 passed,0 failed,11 skipped; all remaining gates including isolated current-core MCP/package checks pass. All2493 working-source and frozen-source hashes match at terminal verification. The original checkout's36 retained dirty files remain unchanged. This snapshot includes private-file metadata guard469. Windows/Linux472 are separately launched against the same2493-file archive SHA256 `f50eea000c831f20ae5aabd51017b9cc3ac809aede1fda81af40de2da9a6ab37`; their terminal results remain pending. Windows472 terminated exit1:2722 core tests,2708 passed,1 failed,13 skipped. The final stack identifies `EBUSY` at fixture-root removal after the actor-controlled evaluation-context assertions. Correction479 adds bounded fs.rm retries to that fixture only. All four Mac context cases pass, and three hash-checked Windows context runs pass12/12, preserving positive host-context and negative actor-input assertions. A full corrected Windows run remains required; Linux472 terminates exit0/no OOM:2722 core tests,2710 passed,0 failed,12 skipped; MCP73/73 and both package checks pass. Its terminal source hashes are pending independent recheck.

Guarded release comparison471 preserves full VALID output parity at59/3029 events: native/filesystem p95 is34.167/30.267ms and214.612/160.706ms. The small comparison stays inside5ms; the larger validation cost remains an acceptance investigation. Full current remote/GitHub execution, resource budgets, inclusive net-LOC acceptance and transitive consumer closure remain unresolved. ForgeLoop full-plan completion is not validator-verified; no PR or publication exists.

## Full remote464 acceptance and private-copy correction469

Windows full464 terminates with exit0:2721 core tests,2708 passed,0 failed,13 skipped; isolated current-package MCP73/73 and both core/MCP package checks pass. Docker Linux full464 terminates with exit0/no OOM:2721 core tests,2709 passed,0 failed,12 skipped; isolated current-package MCP73/73 and both package checks pass. These runs use the separately staged2488-file source and archive SHA256 `a62e025b38a9640aa63c2a55554aee8aa43e722500dd998b2aaa836080552d81`. Their terminal logs/exit receipts were collected. All2488 source hashes match after termination on Windows and in an independently copied terminal Docker container source. They predate correction469.

A new negative control exposed a hole in counter-only owned-proof reuse: a raw file write changed a private backup's event hash while SQLite's data-version counter stayed unchanged. The old implementation incorrectly returned a valid audit. Correction469 additionally checks the private regular file's device, inode, size, nanosecond modification/change metadata before reuse and after validation. The private callback registry remains authoritative; no caller metadata, invalid results or cross-request proofs are trusted. A one-byte in-place tamper is independently observed through a separate read-only connection, rejects the current private scope with `E_STATE_REVISION_CONFLICT`, and leaves the original project and next snapshot valid.

Corrected scoped checks pass114/114 on Mac,114/114 on Windows,114/114 on Docker Linux. Remote probes apply only two old/new-hash-verified files to disposable copies of full464. Mac's canonical raw-tamper check and fast verification pass. This is correction evidence; full current-source platform/package acceptance, guard performance, actual changed GitHub workflow execution and original-plan resource/net-LOC/transitive-consumer closure remain pending. No PR or publication exists.

## Full canonical Mac461 acceptance

The corrected frozen461 source passes the complete `verify:prepush` pipeline through canonical ForgeLoop `runCheck`: execution `exec-06327cc0-42ca-4d74-8345-7a259536fa8d`, exit0,411559ms, `FORGELOOP_EXECUTED`, no output truncation. Raw stdout334806bytes and stderr8238bytes are retained. Core2719 tests:2708 passed,0 failed,11 skipped; PoC67/67; isolated current-package MCP73/73; package checks12/12; all remaining validation stages pass. All2485 current-source and frozen-source hashes match the pre-run manifest at terminal verification. The original checkout's36 dirty file hashes remain unchanged. Ownership/recovery/atomicity regressions pass138/138 before the full run.

This establishes Mac source/package acceptance for frozen461, not Windows/Linux, changed GitHub workflow execution, performance/resource budgets, inclusive code-size acceptance or full original-plan closure. Subsequent Windows and Docker Linux464 acceptance is recorded above. No PR or publication exists.

## Canonical Mac failure459 and correction460

The full Mac459 prepush check has validator-owned execution provenance and complete raw logs, with no capture truncation. Coverage stopped with 2719 tests: 2696 passed,12 failed,11 skipped. Ten failures came from the test worker's native connection proxy: accessing `DatabaseSync.isTransaction` through a proxy receiver throws `TypeError: Illegal invocation`, preventing independent mutation workers from reaching their crash barriers. The worker now invokes native getters on the actual database receiver. The other two failures exposed preparation revision conflicts caught by claim-evidence collection and mislabeled as inconsistent ownership. Canonical record-reader catches now propagate `E_STATE_REVISION_CONFLICT`; stable malformed records still produce the original ownership errors. No provider replay, claim relaxation, receipt relaxation or production fault-injection seam was added.

The focused decision-race, independent-process and interruption suite passes19/19 after both corrections. ESLint passes with no errors or warnings for the two changed files. Frozen459's 2485 source files remain hash-identical; its Windows and Docker Linux full runs are separate, unchanged-source observations. Full corrected-source platform acceptance, original-plan performance/resource and net-LOC targets, transitive consumer closure and actual changed GitHub workflow execution remain unproven.

## Platform failures and corrections456–458

Frozen452 Windows terminated with exit1:2718 core tests,2704 passed, one failed,13 skipped. The duplicate/overlapping-claim test failed only at fixture removal with `EBUSY` after SQLite closure. Frozen452 Linux terminated with exit1/no OOM:2718 core tests,2705 passed, one failed,12 skipped. Concurrent quality publication raised `E_EVIDENCE_COVERAGE_INVALID` while checking the receipt/state relationship. Both full pipelines stopped before MCP/package checks. A separate Linux control using the normal offline semantic-provider loader reproduced the relationship failure on attempt4; an earlier control omitted that loader and failed with `E_DECISION_ENGINE_AUTH_REQUIRED`, so that run is not correctness evidence.

Native preparation now compares repeated observed rows against their initial fingerprints while no SQLite transaction is held. A changed row raises its existing specialized conflict code or `E_STATE_REVISION_CONFLICT` before mixed versions reach domain validation. Atomic application retains its original complete read-set check under `BEGIN IMMEDIATE` and may read its own writes. The deterministic control preserves an unchanged domain error, rejects interleaved reads before the domain check, and preserves the competing update without new events. It fails on frozen455's old implementation and passes with the correction. No provider replay or weaker receipt/ledger rule is introduced. Bootstrap fixture cleanup now retries bounded transient removal failures after closing the database.

The concurrency fixture now waits until both provider observations overlap before either can persist. Without that barrier, a later call may legitimately reconcile an unprojected evaluation and return the same attempt rather than take a second observation. Attempts1/2, final check projection, convergence and the exact baseline-plus-two provider call count remain asserted. Scoped local checks pass43/43, source/audit/connection/task-scope regressions26/26, and orphan projection/source-drift/artifact regressions10/10. The corrected derived Windows probe passes43/43. The derived Linux probe passes12 consecutive overlapping-observation runs plus35 bootstrap/record-check atomicity checks, terminal exit0/no OOM. These probes apply four hash-checked files to disposable copies of frozen452; they are scoped correction evidence, not a complete current-source platform run.

Canonical Mac run-check455 terminated with a failed `mcp:test` check and `FORGELOOP_EXECUTED` provenance. Its captured34-byte stderr hash exactly matches `FAIL mcp:test: exit=1 signal=none`; bounded stdout capture does not retain complete test logs. All2485 working-source hashes match the pre-run manifest. The shared MCP dependency resolves to the original checkout's installed core, which lacks `src/storage/unit-of-work.js`. Prepush/release tiers now use the existing `mcp:test:clean` pack-and-isolated-install runner, preserving shared dependencies and exercising current core/package bytes. Validation-tier/workflow checks pass11/11. Final full current-source platform and GitHub execution remain required.

## Frozen451 Mac verification and follow-up453

The detached frozen451 `verify:prepush` run terminated with exit0. Core reports2718 tests:2707 passed, zero failed,11 skipped. Clean MCP reports73/73; PoC evidence tests67/67 and package checks12/12 also pass, alongside the repository verification gates. All2482 frozen source hashes match after termination. This is local Mac evidence for frozen451, not proof of later edits or completed Windows/Linux/GitHub workflow acceptance. Increment453's preflight lookup correction has separate69/69 focused coverage and a published latency repetition; it requires final full acceptance after source consolidation.

Direct gate-path review confirms `gate-record` admits evidence artifacts through project-relative containment, regular-file/no-symlink checks and a4MiB bound before hashing. `gate-revalidate` rehashes those admitted external files; gate records themselves use canonical `persistGate` and the guarded task mutation. These external file consumers therefore do not require an operational JSON mirror. This scoped source review does not settle all consumer rows below.

Generated discovery: `node scripts/inventory-operational-storage.mjs /tmp/sqlite-operational-inventory.json`. Source reads and parity tests must settle each row before closure. Static dependency reachability over-approximates consumers; dynamic imports and external scripts require explicit review.

| Operation/resource | Rule owners | Records read/written | Transaction boundary | SQLite status | Parity/error tests | Integration coverage | Legacy dependency | Removal status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `integrations/mcp/src/capability-policy.js` | Immutable MCP launch policy | Risk metadata and capability booleans only | No persistence transaction | No operational persistence | Capability/authority controls; clean candidate MCP73/73 | macOS scoped proof; current Windows/Linux full acceptance pending | No legacy storage owner | Retain policy boundary |
| `integrations/mcp/src/error-mapping.js` | Canonical error/output policy | Envelope serialization and bounded error metadata | No persistence transaction | No operational persistence | Bounded output and public code controls; clean candidate MCP73/73 | macOS scoped proof; current Windows/Linux full acceptance pending | No legacy storage owner | Retain transport mapping |
| `integrations/mcp/src/error-sanitization.js` | MCP client error sanitation | Error strings only | No persistence transaction | No operational persistence | Secret/stack controls; clean candidate MCP73/73 | macOS scoped proof; current Windows/Linux full acceptance pending | No legacy storage owner | Retain sanitation boundary |
| `integrations/mcp/src/execution-policy.js` | MCP execution policy | Timeout argument validation only | No persistence transaction | No operational persistence | Clean MCP73/73 increment225; timeout policy controls | macOS verified; full platform acceptance pending | No legacy storage owner | Retain policy boundary |
| `integrations/mcp/src/http.js` | MCP transport admission and canonical integration context | Delegated commands/resources only; HTTP bytes are transport data | Shared persistent project connection context; closes on HTTP handler shutdown | Partial: no direct operational filesystem writer | MCP transport/connection controls; current full platform acceptance pending | Frozen native source reviewed in318; current MCP run pending | No legacy storage owner | Retain loopback transport |
| `integrations/mcp/src/input-policy.js` | Canonical INTEGRATION_LIMITS | Structured input byte bound only | No persistence transaction | No operational persistence | Clean MCP73/73 increment225; exact input bounds | macOS verified; full platform acceptance pending | No legacy storage owner | Retain input boundary |
| `integrations/mcp/src/logging.js` | MCP diagnostic logger | Diagnostic stderr only; no operational records | No persistence transaction | No operational persistence | Real stdio package smoke increment225; stdout reserved for protocol | macOS verified; full platform acceptance pending | No legacy storage owner | Retain diagnostics |
| `integrations/mcp/src/output-policy.js` | Canonical INTEGRATION_LIMITS | Serialized output byte bound only | No persistence transaction | No operational persistence | Clean MCP73/73 increment225; oversized output refusal | macOS verified; full platform acceptance pending | No legacy storage owner | Retain output boundary |
| `integrations/mcp/src/project-context.js` | Canonical project-root resolver | Pinned root metadata only | Startup resolution; no lifecycle transaction | No operational persistence | Clean MCP73/73 increment225; canonical project-root matrix | macOS verified; full platform acceptance pending | Filesystem root metadata is intentional | Retain root admission |
| `integrations/mcp/src/resource-registry.js` | readForgeLoopIntegrationResource | Delegates task/project resources; bounded serialization | Canonical integration read scope | Partial: canonical task catalog now defines all21 task templates; individual action remains two-ID | MCP73; advertised templates asserted over transport; decision read shares readonly snapshot654 | macOS scoped proof; current Windows/Linux full acceptance pending | No direct filesystem operational reader; complete core consumers pending | Retain canonical dispatcher |
| `integrations/mcp/src/schema-adapter.js` | Canonical CLI option definitions | Generated bounded command schemas only | No persistence transaction | No operational persistence | Schema/authority controls; clean candidate MCP73/73 | macOS scoped proof; current Windows/Linux full acceptance pending | No legacy storage owner | Retain schema adapter |
| `integrations/mcp/src/server.js` | Immutable launch policy and canonical integration dispatcher | Package metadata read; delegated commands/resources | Owns persistent context for stdio; HTTP injects shared context; closes owned context | Partial: no direct operational filesystem writer | MCP root/authority/connection controls; current full platform acceptance pending | Frozen native source reviewed in318; current MCP run pending | readFileSync reads package.json only | Retain server and admission boundary |
| `integrations/mcp/src/tool-registry.js` | executeForgeLoopCommand and immutable launch policy | Delegates canonical commands; strips actor authority/runtime context | Canonical command mutation scope | Partial: adapter delegation reviewed | Authority/input/tool controls; clean candidate MCP73/73 | macOS scoped proof; current Windows/Linux full acceptance pending | No direct filesystem operational writer; core consumers pending | Retain canonical dispatcher |
| `src/commands/action-authorize.js` | authorizeAction and trusted host capability/approval policy | Native action authorization and bound policy/approval event | Outer guarded native task transaction; canonical authorization service | Partial: native source boundary reviewed358 | Host authority remains out-of-band; actor arguments never confer authority; current frozen prepush pending | Direct API/CLI adapters; full transitive/MCP/platform acceptance pending | Portable action/approval readers remain read-only; native selection precedes reads | Operational writes require stageText in active native transaction; transitive audit pending |
| `src/commands/action-propose.js` | proposeAction, canonicalActionFingerprint and withTaskMutation | Native action artifact, unique idempotency lookup and ACTION_PROPOSED event | Outer guarded native task transaction; nested domain transaction joins overlay | Partial: native source boundary reviewed358 | Immutable action identity, same-key idempotency/conflict and caller provenance retained; current frozen prepush pending | Direct API/CLI adapters; full transitive/MCP/platform acceptance pending | Portable action/approval readers remain read-only; native selection precedes reads | Operational writes require stageText in active native transaction; transitive audit pending |
| `src/commands/action-reconcile.js` | reconcileAction and transitionAction | Native reconciliation state and reconciliation/commit events | Outer guarded native task transaction; nested transition joins overlay | Partial: native source boundary reviewed358 | Unknown commit recovery records reconciliation without replaying external effects; current frozen prepush pending | Direct API/CLI adapters; full transitive/MCP/platform acceptance pending | Portable action/approval readers remain read-only; native selection precedes reads | Operational writes require stageText in active native transaction; transitive audit pending |
| `src/commands/action-record.js` | transitionAction and generic transition state allow-list | Native action revision and outcome event | Outer guarded native task transaction; nested transition joins overlay | Partial: native source boundary reviewed358 | Caller cannot mint AUTHORIZED/VERIFIED; provenance, expected revision and fingerprint checks retained; current frozen prepush pending | Direct API/CLI adapters; full transitive/MCP/platform acceptance pending | Portable action/approval readers remain read-only; native selection precedes reads | Operational writes require stageText in active native transaction; transitive audit pending |
| `src/commands/action-show.js` | resolveTaskContext and readAction/validateActionArtifact | Selected native action artifact | Existing read-only action scope; no command writer | Partial: native source boundary reviewed358 | Missing action and immutable artifact validation retained; multi-read snapshot review pending; current frozen prepush pending | Direct API/CLI adapters; full transitive/MCP/platform acceptance pending | Portable action/approval readers remain read-only; native selection precedes reads | Operational writes require stageText in active native transaction; transitive audit pending |
| `src/commands/action-verify.js` | verifyAction and independent postcondition evidence validators | Native verified action, evidence binding and ACTION_VERIFIED event | Outer guarded native task transaction; canonical verification service | Partial: native source boundary reviewed358 | Canonical evidence and independent postcondition rules retained; current frozen prepush pending | Direct API/CLI adapters; full transitive/MCP/platform acceptance pending | Portable action/approval readers remain read-only; native selection precedes reads | Operational writes require stageText in active native transaction; transitive audit pending |
| `src/commands/activate.js` | activateSession/writeJsonArtifact and withTaskTransaction | Native sessions table and active_session_id; stable virtual session marker paths | Session and active-session pointer staged in one canonical native transaction | Partial: source boundary reviewed383 | Reactivation/native lease/workspace/policy group83/83 passed; frozen382 full Mac passed; complete current session adapter/platform acceptance pending | Direct API/CLI lifecycle covered; full MCP/platform row acceptance pending | Transport/bootstrap endpoints remain files; canonical activation markers resolve through storage | Filesystem session writes retired; no dual operational writer |
| `src/commands/advance.js` | advanceWorkState, task mutation guard, lifecycle prerequisites | Task phase/state, receipt, phase events and commit witness | Command guarded transaction and direct API transaction with canonical inferred task identity | Partial: native direct/command path; phase788 canonical identity corrected | 22 focused and57 caller tests; exact rollback for receipt/event faults; full Mac789 passes22 gates | Mac79622gates passes on89a2959; Windows796 has one recovery failure | Portable references resolve through canonical boundary; no operational file writer | Retain lifecycle authority; exhaustive transitive closure pending |
| `src/commands/approval-request.js` | requestApproval, loadPolicyIdentity and evaluateActionCapability | Native approval immutable binding and APPROVAL_REQUESTED event | Outer guarded native task transaction; nested approval transaction joins overlay | Partial: native source boundary reviewed358 | DENY/REQUIRE_AUTHORITY cannot be overridden by approval; valid task policy epoch required; current frozen prepush pending | Direct API/CLI adapters; full transitive/MCP/platform acceptance pending | Portable action/approval readers remain read-only; native selection precedes reads | Operational writes require stageText in active native transaction; transitive audit pending |
| `src/commands/approval-resolve.js` | resolveApproval and trusted host authority context | Native approval resolution and APPROVAL_RESOLVED event | Outer guarded native task transaction; nested approval transaction joins overlay | Partial: native source boundary reviewed358 | Pending-only resolution; HOST_ATTESTED context/grant matching, CALLER_ACKNOWLEDGED limits retained; current frozen prepush pending | Direct API/CLI adapters; full transitive/MCP/platform acceptance pending | Portable action/approval readers remain read-only; native selection precedes reads | Operational writes require stageText in active native transaction; transitive audit pending |
| `src/commands/attestation-create.js` | `src/core/actions.js`, `src/core/approvals.js`, `src/core/completion-artifacts.js`, `src/core/task-command.js`, `src/core/transaction.js`, `src/core/work-state.js` | Current/history statement artifacts and ATTESTATION_STATEMENT_CREATED event; completion/manifest bindings | Native task transaction includes terminal-safe guard, workspace binding, validation, versioned artifact writes and event | Partial: native boundary source-reviewed386; snapshot/transitive closure pending | Version history/repeated-cycle refusal and native e2e chain; prior frozen382 suite green; current full385 pending | Current MCP/package/platform acceptance pending | Portable compatibility readers remain; external content/bundles intentional | Retain authority/cryptographic boundaries; no sole-writer claim |
| `src/commands/attestation-status.js` | `src/core/actions.js`, `src/core/approvals.js`, `src/core/completion-artifacts.js`, `src/core/task-command.js`, `src/core/transaction.js`, `src/core/work-state.js` | Config, statement, manifest, receipt/ledger bindings; external content/signature observations | One owned committed native project snapshot across catalog/artifacts/bindings; prepared overlays retained; external content/signature observations separate | Partial: native snapshot corrected387; full transitive/performance closure pending | Concurrent deletion controls3/3; previous source fails all3; attestation/discovery/audit30/30; fast PASS | Current packed MCP73/73; full current source/platform/package acceptance pending | Portable compatibility readers remain; external content/bundles intentional | Retain authority/cryptographic boundaries; no sole-writer claim |
| `src/commands/attestation-verify-range.js` | `src/core/actions.js`, `src/core/approvals.js`, `src/core/completion-artifacts.js`, `src/core/task-command.js`, `src/core/transaction.js`, `src/core/work-state.js` | Discovered task statements/manifests, derived revision coverage and overlap sets | One owned committed native project snapshot across catalog/artifacts/bindings; prepared overlays retained; external content/signature observations separate | Partial: native snapshot corrected387; full transitive/performance closure pending | Concurrent deletion controls3/3; previous source fails all3; attestation/discovery/audit30/30; fast PASS | Current packed MCP73/73; full current source/platform/package acceptance pending | Portable compatibility readers remain; external content/bundles intentional | Retain authority/cryptographic boundaries; no sole-writer claim |
| `src/commands/attestation-verify.js` | `src/core/actions.js`, `src/core/approvals.js`, `src/core/completion-artifacts.js`, `src/core/task-command.js`, `src/core/transaction.js`, `src/core/work-state.js` | Statement/manifest and receipt/ledger bindings; external revision content/signature bundle | One owned committed native project snapshot across catalog/artifacts/bindings; prepared overlays retained; external content/signature observations separate | Partial: native snapshot corrected387; full transitive/performance closure pending | Concurrent deletion controls3/3; previous source fails all3; attestation/discovery/audit30/30; fast PASS | Current packed MCP73/73; full current source/platform/package acceptance pending | Portable compatibility readers remain; external content/bundles intentional | Retain authority/cryptographic boundaries; no sole-writer claim |
| `src/commands/audit.js` | `src/core/audit.js`, `src/storage/project-read-snapshot.js`, completion/attestation/action projections | Read-only native operational proofs | One owned committed snapshot across completion, ownership, receipt, preflight and related projections; external files/Git remain external | Partial | Native receipt-deletion snapshot control; regression4/4; old397 audit differs | Public result arrays and representative resource/final platform acceptance pending | Complete audit read-owner boundary reviewed | Manifest and source files retain plan authority |
| `src/commands/baseline.js` | `src/core/policy-engine.js`, `src/core/task-discovery.js`, `src/storage/project-read-snapshot.js` | Task policy snapshots are native; baseline and lock remain reviewable files by original plan | Active-task discovery and policy proof share one snapshot; file inputs remain validated and fingerprinted | Partial | Native deletion control and policy68/68 pass; original implementation wrongly allows reset | Full transitive/public/resource acceptance pending | Plan Keep as files boundary confirmed | Baseline and policy.lock retained intentionally |
| `src/commands/bundle.js` | exportTaskBundle and canonical artifact/claim/attachment owners | Native state, ledger, actions, executions and optional bound artifacts; portable output manifest and byte digests | Committed owned SQLite snapshot isolates source; portable output remains file-owned and has no operational transaction | Partial: native export and raw-output destinations reviewed407 | Bundle/signing/sole-writer controls21/21; portable output cannot overwrite operational namespace or storage metadata | Direct API/CLI source reviewed; final platform/MCP acceptance pending | Explicit legacy read/export compatibility remains; native export reads snapshot SQL ledger rather than legacy event file | Fixed portable bundle namespace retained; source/output boundary reviewed, full transitive/fault/resource acceptance pending |
| `src/commands/checkpoint-revalidate.js` | `src/storage/project-read-snapshot.js`, `src/core/transaction.js`, `src/core/work-state.js` | Native state and adjacent revalidation/commit events | Eligibility uses one committed snapshot; mutation rechecks prepared observations and preserves CAS loser no-op policy | Partial | Checkpoint20/20 plus admission/bootstrap/workspace77/77; concurrent route-deletion control | Transitive/public ledger materialization and representative scale acceptance pending | Ownership/route/contract/repository-only drift guards retained | Portable compatibility retained |
| `src/commands/clear-continuity.js` | Canonical task authority and clearContinuity | Selected native continuity artifact | Native task mutation and staged delete with CAS; custom/portable clear paths rejected | Partial: direct source boundary reviewed375 | Work-state/continuity/lock37529/29; previous full prepush372 green predates375 | Local direct/CLI controls; final platform/MCP acceptance pending | No unlink fallback for operational continuity | Filesystem clearing retired; preserve other artifacts |
| `src/commands/clear-state.js` | Canonical task authority and clearWorkState | Selected native work-state row | Native task mutation and staged delete with CAS; custom/portable clear paths rejected | Partial: direct source boundary reviewed375 | Work-state/continuity/lock37529/29; previous full prepush372 green predates375 | Local direct/CLI controls; final platform/MCP acceptance pending | No unlink fallback for operational state | Filesystem clearing retired; preserve other artifacts |
| `src/commands/complete.js` | Completion validator, task ownership and domain transaction | Canonical state, receipt, coverage and ledger | Native task mutation; identity/authority rejection rolls back; authorized evidence recovery persists atomically | Partial: success, rejection integrity and second verification cycle reviewed | Completion/preflight/gate/next group129/129 in259; bootstrap review in258 | Direct API macOS; full CLI/MCP/platform acceptance pending | Transitive consumers still require full inventory | Filesystem transaction writer retired; compatibility reads pending review |
| `src/commands/context-plan.js` | `src/core/decision/service.js`, `src/storage/project-read-snapshot.js`, `src/core/transaction.js` | Native decision artifacts and bound ledger event | Existing-only writable root retains observations through provider work; cached bindings/proofs use one owned snapshot; persistence is CAS atomic | Partial | Native provider-change rejection and cache-proof deletion controls pass; pure readOnly projection retained | Current-source owner8/8 and decision/admission22/22; broader transitive/performance acceptance pending | Decision/task bindings and ledger validation reviewed | Portable compatibility retained |
| `src/commands/continuity.js` | Task selection and continuity reconciliation/lint | Native continuity/state/contract plus repository paths and diagnostic context | Existing read admission and callback-owned artifact/ledger snapshot; prepared overlays retained | Partial: context payload arrays/grouping replaced377 | Final context/continuity authority26/26 and owner11/11;1000 hypothesis/intervention metadata spill parity | Local native macOS; final platform/MCP and representative performance pending | Portable context remains operational-only; public reflection/trace and per-cycle failure metadata remain | No direct writer; context statuses/count/cycle maps spill primitives; full relation acceptance unresolved |
| `src/commands/contract-create.js` | Contract validation, resumability and task mutation | Native contract, state and validated history | Native task mutation; selected-store presence precedes portable input | Partial: canonical reconstruction and portable-input comparison reviewed | Bootstrap88 plus next-action77 pass165/165 in258 | Direct API and parser/executor macOS; full CLI/MCP/platform acceptance pending | Transitive consumers still require full inventory | Singleton writer retired; portable contract input retained |
| `src/commands/contract-revise.js` | Contract schema/fingerprint, phase/ownership/route/repair and revision proof | Contract/state/route/gates/check resets and CONTRACT_REVISED event | withTaskMutation native transaction; state CAS and event/artifact writes atomic | Partial: direct source boundary reviewed380 | Eligibility/phase/repair/rollback controls;380 matrix regression41/41 | Local native macOS; final platform/MCP/scale acceptance pending | Mutation eligibility retains array ledger; full revision-event public output retained | No alternate operational filesystem writer in adapter; transitive memory/performance review remains |
| `src/commands/decision-show.js` | Decision artifact schema and canonical artifact reader | Native immutable semantic-decision artifact by task/decision ID | Existing project read-only scope in readJsonArtifact | Partial: reader/selector path reviewed340 | Required selectors and canonical schema checks retained; full tamper/CLI/MCP row acceptance pending | Direct reader shares native artifact seam; all integrations not yet settled | Filesystem branch only for compatibility discovery/refusal | No command writer; shared legacy branch review pending |
| `src/commands/decision-status.js` | Decision policy normalization and provider health adapter | Portable configuration and credential-presence booleans; optional health request | No operational persistence transaction | No operational persistence: direct source review340 | Configuration error policy retained; no provider health certification | Configuration/API command; optional network health remains explicit | Portable config deliberately retained | No operational writer to retire |
| `src/commands/discover.js` | Canonical task mutation and initial lifecycle/hash validators | Task-create/discovery ledger and state ownership | Native task preparation/read-set and atomic event commit | Partial: direct source boundary reviewed380 | Initial canonical history, malformed ownership and idempotency controls;380 matrix regression41/41 | Local native macOS; final platform/MCP/scale acceptance pending | Prepared mutation retains public event arrays; initial positions assume that contract | No alternate operational filesystem writer in adapter; transitive memory/performance review remains |
| `src/commands/doctor.js` | `src/core/transaction.js`, `src/storage/connection.js` | Metadata, canonical event/artifact/reference integrity; configuration and legacy recovery observations | Selected store read-only unless fix explicitly requested | Partial: existing-store selection and binding integrity | Operational bootstrap: valid/tampered store and older-schema byte preservation; full fix parity pending | API selection covered; complete MCP/platform audit pending | Filesystem fallback and recovery retained | Pending sole-writer removal |
| `src/commands/efficiency.js` | `src/core/actions.js`, `src/core/approvals.js`, `src/core/task-command.js`, `src/core/transaction.js`, `src/core/work-state.js` | Trace/reflection/usage/action readiness and contract fingerprint; external Git/baseline metadata | Committed native metrics+contract share one owned immutable project snapshot; readonly report | Partial: native read/commit snapshot corrected391; full transitive/performance closure pending | Concurrent contract deletion retains fingerprint; next report seesmissing; command adapter preserves unknown usage and no ledger mutation; owner10/10, final trajectory/atomicity/discovery18/18; old source fails2/2 | Current packed MCP73/73 and fast PASS; final full/platform/package pending | Public history arrays remain; external baseline/Git/scenario are intentional inputs | Retain canonical projections/authority; final release audit pending |
| `src/commands/eval.js` | `src/core/actions.js`, `src/core/approvals.js`, `src/core/task-command.js`, `src/core/transaction.js`, `src/core/work-state.js` | Snapshot trace/metrics, derived evaluation artifact and TRAJECTORY_EVALUATED event | Existing native writable scope retains snapshot observations through CAS; artifact/event commit together, concurrentledger change rejects | Partial: native read/commit snapshot corrected391; full transitive/performance closure pending | Concurrent append rejects with no evaluation/event; cleanretry succeeds; command/direct adapters and local scenario boundary preserved; owner10/10, final trajectory/atomicity/discovery18/18; old source fails2/2 | Current packed MCP73/73 and fast PASS; final full/platform/package pending | Public history arrays remain; external baseline/Git/scenario are intentional inputs | Retain canonical projections/authority; final release audit pending |
| `src/commands/gate-record.js` | `src/core/gate-artifact.js`, native task mutation, schema/route/epoch/claim validators | Gate provenance/fingerprints/evidence refs and current-epoch GATE_SATISFIED | withTaskMutation stages gate+event; external regular-file evidence/hash input intentional | Partial: shared external file-handle boundary corrected813; complete consumer/platform closure pending | Deterministic symlink swap rejection preserves gate/state/events; focused gate81316/16 plus fast/lint/complexity PASS | Full Mac817 passes corrected7b020c3; current remote execution pending; four symlink controls skip Windows | Legacy writers retired at native selection; retained readonly compatibility | Retain protocol guards; final sole-writer audit pending |
| `src/commands/gate-revalidate.js` | `src/core/gate-artifact.js`, native task mutation, schema/route/epoch/claim validators | Refreshed gate fingerprint, stale path references, GATE_REVALIDATED and commit witness | withTaskMutation stages gate+event after stale acknowledgement and hash checks; external files intentional | Partial: shared external file-handle boundary corrected813; complete consumer/platform closure pending | Deterministic symlink swap rejection preserves gate/state/events; focused gate81316/16 plus fast/lint/complexity PASS | Full Mac817 passes corrected7b020c3; current remote execution pending; four symlink controls skip Windows | Legacy writers retired at native selection; retained readonly compatibility | Retain protocol guards; final sole-writer audit pending |
| `src/commands/handoff-accept.js` | Canonical digest, ledger/chronology and consumer authorization | Native handoff and HANDOFF_ACCEPTED event | Canonical task transaction and atomic accept event; idempotency retained | Partial: direct source boundary reviewed380 | Acceptance/tamper/idempotency/CLI controls;380 matrix regression41/41 | Local native macOS; final platform/MCP/scale acceptance pending | Mutation audit retains public array ledger; no claim-transfer authority | No alternate operational filesystem writer in adapter; transitive memory/performance review remains |
| `src/commands/handoff-create.js` | Envelope schema/digest, workspace/task authority and immutable artifact guard | Native handoff artifact and HANDOFF_CREATED event | Canonical task transaction with recordCommitEvent; artifact/event commit together | Partial: direct source boundary reviewed380 | Digest/immutability/envelope/CLI controls;380 matrix regression41/41 | Local native macOS; final platform/MCP/scale acceptance pending | Native artifact presence/listing selected; public handoff snapshot/result remains output-proportional | No alternate operational filesystem writer in adapter; transitive memory/performance review remains |
| `src/commands/handoff-list.js` | Canonical handoff and acceptance-ledger validators | Native handoff collection, binding artifacts and full event ledger | Entire catalog/acceptance projection owns one committed project read snapshot (647); prepared observations preserved | Partial: scoped snapshot regression verified647; full dependency closure pending | Independent writer commits between envelope and ledger reads; projection stays consistent; existing CLI/tamper suites retained | Seven focused tests, clean MCP73 and fast checks passed647; current full platforms pending | Native collection listing replaces directory enumeration; explicit compatibility read retained | No command writer; complete shared dependency authority audit pending |
| `src/commands/handoff-show.js` | Canonical envelope/path ID and acceptance-ledger validators | Native handoff, binding artifacts and full event ledger | Entire envelope/acceptance projection owns one committed project read snapshot (647); prepared observations preserved | Partial: scoped snapshot regression verified647; full dependency closure pending | Envelope ID/digest and fail-closed checks retained; independent writer cross-read regression passes | Seven focused tests, clean MCP73 and fast checks passed647; current full platforms pending | Portable presentation path retained; no operational file writer | No command writer; complete shared dependency authority audit pending |
| `src/commands/history.js` | `src/core/actions.js`, `src/core/transaction.js`, `src/core/work-state.js` | Audit records via inventory | Native task authority; full transitive audit pending | Partial: native scoped regression evidence | Diagnostic/observability group77/77 in283; task inspect isolation1/1 in284 | Direct API/command evidence on macOS; full CLI/MCP/platform acceptance pending | 26 reachable consumers | Retained |
| `src/commands/index-rebuild.js` | rebuildRepositoryIndex and searchRepository | Derived index, engine state and smoke search output | Repository-index operation lock; independent cache lifecycle | Source boundary reviewed358: separate derived cache, not task authority | Repository-index CLI/process/privacy/integration suites; current frozen prepush pending | Public CLI and canonical adapter; current full-platform acceptance pending | .forgeloop/repository-index and user-scoped persistent-search metadata intentionally file-owned | Retain cache/process ownership guards; no lifecycle writer |
| `src/commands/index-setup.js` | setupRepositoryIndex and safe root/binary admission | Derived tgrep index and engine process metadata | Repository-index operation lock; independent cache lifecycle | Source boundary reviewed358: separate derived cache, not task authority | Repository-index CLI/process/privacy/integration suites; current frozen prepush pending | Public CLI and canonical adapter; current full-platform acceptance pending | .forgeloop/repository-index and user-scoped persistent-search metadata intentionally file-owned | Retain cache/process ownership guards; no lifecycle writer |
| `src/commands/index-start.js` | startRepositoryIndexServer and verified process ownership | Derived tgrep index and owned server PID/readiness metadata | Repository-index operation lock; independent cache lifecycle | Source boundary reviewed358: separate derived cache, not task authority | Repository-index CLI/process/privacy/integration suites; current frozen prepush pending | Public CLI and canonical adapter; current full-platform acceptance pending | .forgeloop/repository-index and user-scoped persistent-search metadata intentionally file-owned | Retain cache/process ownership guards; no lifecycle writer |
| `src/commands/index-status.js` | getRepositoryIndexStatus and sanitizeRepositoryIndexStatus | Derived index metadata and live process health | Read-only index/process inspection | Source boundary reviewed358: separate derived cache, not task authority | Repository-index CLI/process/privacy/integration suites; current frozen prepush pending | Public CLI and canonical adapter; current full-platform acceptance pending | .forgeloop/repository-index and user-scoped persistent-search metadata intentionally file-owned | Retain cache/process ownership guards; no lifecycle writer |
| `src/commands/index-stop.js` | stopRepositoryIndexServer and verified process ownership | Owned tgrep server state; no task lifecycle records | Repository-index operation lock; independent cache lifecycle | Source boundary reviewed358: separate derived cache, not task authority | Repository-index CLI/process/privacy/integration suites; current frozen prepush pending | Public CLI and canonical adapter; current full-platform acceptance pending | .forgeloop/repository-index and user-scoped persistent-search metadata intentionally file-owned | Retain cache/process ownership guards; no lifecycle writer |
| `src/commands/init.js` | `src/core/templates.js`, `src/core/manifest.js`, project policy and repository-index helpers | Install assets, manifest and reviewable policy inputs remain files | Verify policy before manifest authority; generated ignore rules cover SQLite and sidecars/marker | Partial | Init17/17; real Git check-ignore excludes runtime but retains policy/manifest | Full package/current-platform acceptance pending | Installation boundary and native ignore rules reviewed | Install metadata and project inputs retained intentionally |
| `src/commands/inspect.js` | `src/core/actions.js`, `src/core/approvals.js`, `src/core/completion-artifacts.js`, `src/core/task-command.js`, `src/core/transaction.js`, `src/core/work-state.js` | Audit records via inventory | Native task authority; full transitive audit pending | Partial: native scoped regression evidence | Diagnostic/observability group77/77 in283; task inspect isolation1/1 in284 | Direct API/command evidence on macOS; full CLI/MCP/platform acceptance pending | 64 reachable consumers | Retained |
| `src/commands/metrics.js` | buildTrajectoryMetrics, trace/reflection, action readiness and readTaskUsage | Canonical trace, action trust, route and usage; optional trusted runtime usage provider | Read-only projections; separate provider observation has no operational write | Partial: source boundary reviewed362 | Unknown usage retained; trusted action counts use canonical readiness rather than raw VERIFIED labels; current full regression running | Direct API/CLI; complete transitive/MCP/platform acceptance pending | Profile/configuration/provider observations intentionally independent; canonical artifacts use native readers | No filesystem operational writer; retain projection and trust rules |
| `src/commands/migrate-protocol.js` | `src/core/task-storage-migration.js`, `src/storage/migration.js`, candidate/parity/publication validators | Validated singleton/project state, retained source, canonical task/artifact/event records | Explicit excluded-writer maintenance; unpublished atomic import and verified publication | Implemented; scoped verified | `tests/task-cli.test.js`, `tests/task-migration.test.js`, `tests/storage-singleton-import.test.js`; final increment20218/18 and increment20313/13 | CLI apply/dry-run/refusal verified; worktree MCP option schemas checked; hosted/platform checks pending | Read-only legacy detection/planning; old filesystem apply refuses | Old filesystem task-migration writer removed; complete project retirement pending |
| `src/commands/model-route.js` | `src/core/transaction.js`, `src/core/work-state.js` | Canonical task bindings, logical semantic decision artifact and validated ledger proof | One owned native readonly snapshot across bindings/decision validation; pure advisory fallback without task | Partial: native semantic resolution corrected392; full transitive/platform closure pending | Automatic SQLite-only discovery and explicit-ID race control; stale canonical task digest rejects; current native4/4 and broader62/62 | Current packed MCP73/73 and fast PASS; final full/platform/package pending | Portable decision directory reads retained only when native authority absent | No native filesystem artifact enumeration; advisory/evidence/lifecycle boundaries retained |
| `src/commands/next.js` | Next-action phase rules, task selection and recovery classifier | Canonical lifecycle, ledger, receipts, checks, route profile and policy | Entire direct API and command/compact projection owns one committed project snapshot649; no bootstrap; prepared observations retained | Partial: direct selection and cross-read snapshot proof649; complete dependency closure pending | Independent route write preserves full direct/command/compact response; broader next/recovery124 tests pass | Clean MCP73 and fast checks pass649; current full platforms pending | Transitive consumers still require full inventory; shared snapshot overhead requires proportional review | Singleton writes retired; explicit legacy read compatibility retained |
| `src/commands/policy-diff.js` | diffPolicies and readTaskPolicySnapshot/readPolicyInput | Canonical native snapshot or explicit portable JSON; project effective rules/baseline | Existing read-only native scope for canonical explicit paths; portable inputs independent | Partial: direct canonical file-path defect corrected361 | Native path regression passes relative/absolute/reversed/missing/mixed-layout/portable cases;62policy checks pass before final unsupported-path guard; final path1pass | Direct API/CLI; full MCP/platform acceptance pending | Explicit portable policy inputs remain files; canonical native paths never fall back to unsupported physical files | No filesystem task writer; retain policy domain rules and configuration |
| `src/commands/policy-discover.js` | discoverPolicy and computePersistedPolicyLockData | Project discovery and lock; source manifests | Optional project policy configuration publication | Source boundary reviewed361: project inputs intentionally file-owned | Discovery/lock/hardening group62pass before final guard; current full-platform checks pending | Direct API/CLI; full MCP/platform acceptance pending | Project rules, discovery, baseline and lock remain policy inputs; task snapshot separate | No filesystem task writer; retain policy domain rules and configuration |
| `src/commands/policy-status.js` | evaluateTargetPolicy and native task snapshot reader | Project effective rules/baseline/lock and canonical task policy snapshot | Read-only project policy evaluation; selected native task artifact read | Partial: source boundary reviewed361 | Policy epoch, drift and invalid lock rules retained; full transitive/integration acceptance pending | Direct API/CLI; full MCP/platform acceptance pending | Project policy inputs remain file-owned; canonical task snapshot reader selects existing native authority | No filesystem task writer; retain policy domain rules and configuration |
| `src/commands/policy.js` | getPolicy/validatePolicy, createConfig/writeConfig | Project config and policy-pack selection | Configuration writer; no task transaction | Source boundary reviewed361: project configuration intentionally file-owned | Policy pack/schema tests; current final full-platform checks pending | Direct API/CLI; full MCP/platform acceptance pending | Local versioned policy definitions and .forgeloop/config.json remain files | No filesystem task writer; retain policy domain rules and configuration |
| `src/commands/preflight.js` | Contract, route, gate, chronology and ownership validators | Native contract, route, state, gates, ledger and preflight | Native task mutation; gate optional reader selects existing readonly authority | Partial: ready/blocked activation, malformed/mixed-task refusal and idempotent lifecycle reviewed | Completion/preflight/gate/next group129/129 in259; direct gate empty-project no-allocation control | Direct API macOS; full CLI/MCP/platform acceptance pending | Transitive consumers still require full inventory | Singleton writers retired; portable gate artifact references retained |
| `src/commands/prepare-completion.js` | `src/core/completion-artifacts.js`, `src/core/task-command.js`, `src/core/transaction.js` | Native receipt and transaction witness | Direct task-bound API wraps complete preparation in one task transaction; command reuses existing outer transaction | Partial | Direct/command witness fault rollback controls; preparation/check/ergonomics23/23 and completion/ownership/admission29/29 | Remaining public projections/representative resource/final platform acceptance pending | CAS bindings and whole preparation rollback reviewed | Untargeted compatibility/error path retained |
| `src/commands/profile-interview.js` | discoverPolicy in policy-discovery.js | Directory entries and package manifest; advisory detected policy | Read-only repository source discovery | Source boundary reviewed358: no operational persistence | Documentation conformance/read-only policy; current frozen prepush pending | Public CLI and canonical adapter; current full-platform acceptance pending | Repository source and manifests intentionally file-owned | No operational writer; retain discovery rules |
| `src/commands/progress.js` | Canonical progress, diagnostic selection and information-gain rules | State plus full validated ledger; typed diagnostic/verification selections | Native callback snapshot; prepared overlays preserve existing transaction reads | Partial: native collection adapter and interval streaming reviewed376 | Array/collection gain/stall parity and 10000 unrelated payload control;24 scoped checks; native corrupted-ledger rejection | Direct native macOS; final CLI/MCP/platform and relation scale pending | Arrays keep compatibility sorting; unordered collection fallback explicit | Full event/interval arrays removed for ordered native source; gain output/failure metadata and repeated relation scans still require bounded/performance review |
| `src/commands/protocol-info.js` | Pure canonical registries and getStorageCapabilities | Package metadata and declared protocol/schema/storage capabilities | No project storage open or persistence transaction | No operational persistence | protocol-info controls included in375 matrix20/20; capability sole-writer flag remains conservative pending final writer audit | CLI/schema registry parity; current platform/MCP acceptance pending | No filesystem operational reader or writer | Retain pure metadata presentation |
| `src/commands/quality-baseline.js` | `src/core/actions.js`, `src/core/approvals.js`, `src/core/completion-artifacts.js`, `src/core/task-command.js`, `src/core/transaction.js`, `src/core/work-state.js` | Audit records via inventory | Native task authority; transitive audit pending | Partial | Native scoped parity reviewed; full acceptance pending | Current CLI/MCP/platform coverage pending | 50 reachable consumers | Retained |
| `src/commands/quality-status.js` | `src/core/actions.js`, `src/core/approvals.js`, `src/core/completion-artifacts.js`, `src/core/task-command.js`, `src/core/transaction.js`, `src/core/work-state.js` | Audit records via inventory | Native task authority; transitive audit pending | Partial | Native scoped parity reviewed; full acceptance pending | Current CLI/MCP/platform coverage pending | 49 reachable consumers | Retained |
| `src/commands/quality-verify.js` | Structural-quality service, task mutation and native unit-of-work | Evaluation attempt, structural check, receipt and events | Captured provider observation; native optimistic persistence with bounded conflict retry | Partial: native concurrency verified locally | Lifecycle8/8; native allocation/check/convergence and provider-call count increment232 | Public CLI/MCP and remote corrected coverage pending | Legacy fixture transaction/lock remains retained | Retirement pending |
| `src/commands/reconcile-closure.js` | `src/core/reconcile-closure.js`, `src/core/execution.js`, `src/core/transaction.js` | Native execution record, reconciliation event, rebound state/receipt | Direct service now stages whole reconciliation in one task transaction; command reuses prepared outer transaction | Partial | Reconciliation14/14 and ownership/rebind/admission6/6; fault rollback control fails old397 | External effects/crash reservation and representative resources/final acceptance not fully verified | Reconciliation atomic database changes and validation guards reviewed | External command effects remain outside database rollback |
| `src/commands/reconcile-continuity.js` | Task selection and continuity reconciliation/lint | Native continuity/state/contract plus repository paths and diagnostic context | Existing read admission and callback-owned artifact/ledger snapshot; prepared overlays retained | Partial: context payload arrays/grouping replaced377 | Final context/continuity authority26/26 and owner11/11;1000 hypothesis/intervention metadata spill parity | Local native macOS; final platform/MCP and representative performance pending | Portable context remains operational-only; public reflection/trace and per-cycle failure metadata remain | No direct writer; context statuses/count/cycle maps spill primitives; full relation acceptance unresolved |
| `src/commands/record-check.js` | `src/core/actions.js`, `src/core/approvals.js`, `src/core/completion-artifacts.js`, `src/core/task-command.js`, `src/core/transaction.js`, `src/core/work-state.js` | State revision/check evidence, execution receipt, VERIFICATION_RECORDED and commit witness | Command mutation wrapper and task-scoped direct recordCheck API own one native transaction; nested callers reuse it; validation precedes admission | Partial: command/direct API atomicity corrected390; complete transitive closure pending | Receipt/event staging fault controls4/4; previous direct API fails2/2; final owner/run-check23/23; broader completion/quality/admission63/63 | Current packed MCP73/73 and fast PASS; final full/platform/package pending | Legacy writers retired at native selection; retained readonly compatibility | Retain protocol guards; final sole-writer audit pending |
| `src/commands/record-continuity.js` | Continuity schema/semantics and task authority | Native task continuity with state/contract/repository fingerprints | withTaskMutation and canonical writeContinuity artifact transaction; dry-run preserved | Partial: native writer delegation reviewed375 | Work-state/continuity/lock37529/29 | Local direct/CLI controls; final platform/MCP acceptance pending | Portable context remains operational-only and has no verification authority | Filesystem writer retired; reconciliation diagnostics still need bounded event review |
| `src/commands/record-decision-criterion.js` | `src/core/task-command.js`, `src/core/transaction.js`, `src/core/work-state.js` | Audit records via inventory | Native task authority; full transitive audit pending | Partial: native scoped regression evidence | Diagnostic/observability group77/77 in283; task inspect isolation1/1 in284 | Direct API/command evidence on macOS; full CLI/MCP/platform acceptance pending | 27 reachable consumers | Retained |
| `src/commands/record-diagnosis.js` | `src/core/diagnosis.js`, `src/core/task-command.js`, `src/core/transaction.js`, `src/core/work-state.js` | Audit records via inventory | Native task authority; full transitive audit pending | Partial: native scoped regression evidence | Diagnostic/observability group77/77 in283; task inspect isolation1/1 in284 | Direct API/command evidence on macOS; full CLI/MCP/platform acceptance pending | 32 reachable consumers | Retained |
| `src/commands/record-hypothesis-disposition.js` | Diagnostic projection and transition rules, task transaction | Hypothesis disposition and canonical audit event | Command mutation joins direct API transaction; validation and ledger read-set guarded | Partial: stale terminal transition corrected791 | 18 focused/caller tests; independent terminal commit preserved; stale write and retry refused | Mac79622gates passes on89a2959; Windows796 has one recovery failure | No direct operational file reader/writer in disposition API | Retain transition/evidence rules; complete consumer closure pending |
| `src/commands/record-intervention.js` | Diagnostic case references, semantic fingerprint, task transaction | Intervention and canonical audit event | Command mutation joins direct API transaction; state/ledger validation guarded | Partial: stale semantic repetition corrected795 | 28 focused/caller tests; independent intervention preserved; retry reports repetition with effectiveness PENDING | Mac79622gates passes; Windows796 fails PUBLICATION_READY owner-liveness recovery | Explicit intervention file is import input; operational event uses canonical store | Retain diagnostic semantics; complete consumer closure pending |
| `src/commands/record-terminal-result.js` | `src/core/actions.js`, `src/core/approvals.js`, `src/core/completion-artifacts.js`, `src/core/task-command.js`, `src/core/transaction.js`, `src/core/work-state.js` | Audit records via inventory | Native task authority; transitive audit pending | Partial | Native scoped parity reviewed; full acceptance pending | Current CLI/MCP/platform coverage pending | 50 reachable consumers | Retained |
| `src/commands/reflect.js` | `src/core/actions.js`, `src/core/transaction.js`, `src/core/work-state.js` | Audit records via inventory | Native task authority; full transitive audit pending | Partial: native scoped regression evidence | Diagnostic/observability group77/77 in283; task inspect isolation1/1 in284 | Direct API/command evidence on macOS; full CLI/MCP/platform acceptance pending | 27 reachable consumers | Retained |
| `src/commands/report.js` | evaluateReport/evaluateAudit and profileStatus | Native completion/evidence/ledger via audit; intentional profile source file | Read-only audit and profile inspection; no command writer | Partial: source boundary reviewed362 | INVALID/incomplete verdict and evidence/publication/readiness boundaries retained; current full regression running | Direct API/CLI; complete transitive/MCP/platform acceptance pending | Profile/configuration/provider observations intentionally independent; canonical artifacts use native readers | No filesystem operational writer; retain projection and trust rules |
| `src/commands/repository-index.js` | `src/repository-index`, `src/persistent-transport` | Engine index, process ownership and transport files; original plan excludes them from SQLite | Search engine retains its private filesystem namespace and process locks; no operational task-state writer identified | Partial | Scoped engine ownership/privacy/search/transport20pass1native skip | Native binary migration skipped without explicit binary; current final platforms pending | Original Keep as files exclusion reviewed | Engine-owned files retained intentionally |
| `src/commands/responsibility-set.js` | Responsibility schema, scope/frozen-input validators and task authority | Native immutable responsibility artifact, state/contract/route/claims and RESPONSIBILITY_SET event | Canonical task transaction with atomic artifact/event commit; existence checks use native records | Partial: fixed native immutability guard375 | Native public set/read/status/no-mirror/replacement rollback1/1; responsibility/completion/runtime30/30 | Local macOS; final platform/MCP acceptance pending | Portable read compatibility explicit; no operational mirror required | Filesystem existence assumption removed; broader current-snapshot performance pending |
| `src/commands/responsibility-status.js` | Responsibility scope/frozen-input/check validators | Responsibility, contract, route, state, claims and repository changed paths | Existing native read admission and callback-owned audit scope; prepared overlays preserved | Partial: fixed native artifact visibility375 | Public native status and immutable replacement control1/1; responsibility/completion/runtime30/30 | Local macOS; final platform/MCP acceptance pending | Filesystem only for portable artifacts and repository paths | No native operational filesystem reader; external Git path evidence remains explicit |
| `src/commands/route.js` | Canonical route/state services and task mutation guard | Routing artifact, state, route witness; semantic decisions commit separately | Command guarded native mutation; direct persistRoute owns native transaction | Partial: direct route artifact/state atomicity corrected765 | 21 focused and343 callers765; full Mac792 includes correction | Mac79622gates passes on89a2959; Windows796 has one recovery failure | Portable route references remain; singleton operational writer refused | Retain provider observation separation and routing authority; transitive closure pending |
| `src/commands/rule-verify.js` | loadEffectiveRules/verifyRuleMutation and policy adapters | Human project policy/discovery files plus built-in rules; in-memory synthetic mutation fixtures | Read-only rules/schema loading; adapters receive non-mutating content overrides | Partial: source boundary reviewed383 | Policy hardening/autonomy plus lease/workspace group83/83 passed; checker failures return UNPROVEN, missing adapters UNSUPPORTED | Direct core adapter coverage; full CLI/MCP/platform row acceptance pending | Policy inputs intentionally stay files under original migration scope | No canonical operational writer |
| `src/commands/run-action.js` | `src/core/action-execution.js`, `src/core/actions.js`, `src/core/task-command.js` | Native action states, authorization and execution proof | Short prepare/guard transaction, durable proposal/authorization/STARTED before external launch, explicit outcome commit; task lease retained | Partial | Action hardening/chains/security and check/recovery scoped suite48/48 | Full SIGKILL/recovery/resource/current platform acceptance pending | Ordering and COMMIT_UNKNOWN uncertainty policy reviewed | External effects require reconciliation, never blind replay |
| `src/commands/run-check.js` | `src/core/execution.js`, `src/core/completion-artifacts.js`, `src/core/task-command.js` | Native execution record and bound check/state/receipt/event | Guard/lease before external verification, execution artifact then atomic recordCheck; final witness | Partial | Scoped action/check/recovery48/48 plus prior direct recordCheck fault controls | External check interruption and full representative resources/current platform acceptance pending | Scope/authority/binding/atomic check commit reviewed | Public command execution remains exact argv |
| `src/commands/search.js` | searchRepository and searchViaPersistentTransport | Source search results, derived index and search transport metadata | Independent search process/cache lifecycle | Source boundary reviewed358: separate derived cache, not task authority | Repository-index CLI/process/privacy/integration suites; current frozen prepush pending | Public CLI and canonical adapter; current full-platform acceptance pending | .forgeloop/repository-index and user-scoped persistent-search metadata intentionally file-owned | Retain cache/process ownership guards; no lifecycle writer |
| `src/commands/semantic-plan.js` | `src/core/transaction.js`, `src/core/work-state.js` | Canonical task bindings, logical decision artifact/proof; deterministic projection vocabulary | One owned native readonly snapshot; canonical choice tokens mapped explicitly to existing labels; unknown stays advisory | Partial: native semantic resolution corrected392; full transitive/platform closure pending | Native diagnosis/failure/review/unknown and deletion/CAS controls4/4; old catalog/snapshot controls fail3/3; broader62/62 | Current packed MCP73/73 and fast PASS; final full/platform/package pending | Portable decision directory reads retained only when native authority absent | No native filesystem artifact enumeration; advisory/evidence/lifecycle boundaries retained |
| `src/commands/status.js` | readAndClassifyWorkState, reconcileContinuity and findTaskById | Native state/continuity and ownership/recovery projection; package schema health | Read-only selected task and schema inspection; no command writer | Partial: source boundary reviewed362 | Historical/effective claims, mutation allowance, ownership errors and continuity authority envelope retained; current full regression running | Direct API/CLI; complete transitive/MCP/platform acceptance pending | Profile/configuration/provider observations intentionally independent; canonical artifacts use native readers | No filesystem operational writer; retain projection and trust rules |
| `src/commands/task-abandon.js` | `src/core/transaction.js`, `src/core/work-state.js` | TASK_ABANDONED plus recovery artifact and released claim projection | Claims reservation; task transaction rereads identity/ownership/conflict snapshot and refuses changed preconditions | Partial: native transaction source reviewed388; complete transitive closure pending | Acknowledgement/inconsistent/COMPLETE/concurrent callers/replacement controls; current mutation group15/15 | Full frozen385 green; current final MCP/package/platform acceptance pending | Legacy writers retired at native selection; retained readonly compatibility | Retain protocol guards; final sole-writer audit pending |
| `src/commands/task-create.js` | `src/core/transaction.js`, `src/core/work-state.js` | Descriptor, optional contract, TASK_RECEIVED and commit witness | Claims inputs observed before short native CAS/claim commit; recheck identity/scope; descriptor/contract/event stage in one task transaction | Partial: native transaction source reviewed388; complete transitive closure pending | Full frozen385 task creation/preview/claim controls passed; command-specific fault matrix still partial | Full frozen385 green; current final MCP/package/platform acceptance pending | Legacy writers retired at native selection; retained readonly compatibility | Retain protocol guards; final sole-writer audit pending |
| `src/commands/task-list.js` | discoverTasks, canonical descriptor/state/lease readers and full ownership proof | Native task catalog/artifacts and validated ledger/claim projections | One owned readonly project copy shared by all per-task audits; prepared overlays retain transaction reads | Partial: project-wide snapshot and direct lookup corrected384 | Regression63/63 and owner/lookup3/3; frozen39120repeat equal-output discovery native/base p95 at1000=352.860/1199.395ms,5000=1897.509/6473.841ms | API/CLI and packed MCP; final current platform/package/GitHub acceptance pending | Portable descriptorless namespace compatibility retained; full public result arrays remain proportional | No operational filesystem writer; synthetic large2x and small-tolerance targets met391; representative/full resource acceptance pending |
| `src/commands/task-lock-status.js` | resolveTaskContext/readLockInfo/readOperationalLease | Native operationLease/current artifact | Existing read-only selection; single lease row validates identity/fingerprint/byte digest | Partial: source boundary reviewed383 | Native lock identity/staleness tests in83/83 and task CLI26/26 scoped group passed; corrupt lock remains explicit | Direct API/CLI; full MCP/current platform acceptance pending | Portable lease inspection remains read-only compatibility | No writer |
| `src/commands/task-migrate-contract-bootstrap-repair.js` | Strict marker validation and official legacy-marker migration | Native historical ledger, current contract/route/state and lease | Native domain transaction; historical marker bytes preserved | Partial: historical marker migration and idempotency reviewed | Bootstrap88 plus next-action77 pass165/165 in258; malformed/misbound controls | Direct API and parser/executor macOS; current-platform acceptance pending | Explicit legacy marker payload compatibility remains required | Filesystem writer retired; semantic marker compatibility retained |
| `src/commands/task-migrate.js` | `src/core/task-storage-migration.js`, `src/storage/migration.js`, candidate/parity/publication validators | Validated singleton/project state, retained source, canonical task/artifact/event records | Explicit excluded-writer maintenance; unpublished atomic import and verified publication | Implemented; scoped verified | `tests/task-cli.test.js`, `tests/task-migration.test.js`, `tests/storage-singleton-import.test.js`; final increment20218/18 and increment20313/13 | CLI apply/dry-run/refusal verified; worktree MCP option schemas checked; hosted/platform checks pending | Read-only legacy detection/planning; old filesystem apply refuses | Old filesystem task-migration writer removed; complete project retirement pending |
| `src/commands/task-recover.js` | `src/core/transaction.js`, `src/core/work-state.js` | Audit records via inventory | Native task authority; transitive audit pending | Partial | Native scoped parity reviewed; full acceptance pending | Current CLI/MCP/platform coverage pending | 25 reachable consumers | Retained |
| `src/commands/task-repair-contract-bootstrap.js` | Exact defect recognition, immutable repair anchors, claim ownership and lease CAS | Native contract, route, state, ledger and lease | Native domain transaction with canonical claim lock | Partial: narrow repair and post-repair consistency reviewed | Bootstrap88 plus next-action77 pass165/165 in258; live/stale/replaced/corrupt lease controls | Direct API and parser/executor macOS; current-platform acceptance pending | Transitive consumers still require full inventory | Filesystem lock/transaction writer retired |
| `src/commands/task-repair-legacy-recovery.js` | `src/core/task-lock.js`, `src/core/transaction.js`, `src/core/task-recovery.js` | Native migration marker and recovery artifact/event | Project preparation retains observations; transaction revalidates tail candidate and commits recovery plus marker/witness | Partial | Legacy migration included in scoped boundary48/48; existing tamper/acknowledgement/idempotency guards | Full fault/public path/resource/final platform audit pending | Narrow tolerated legacy ledger boundary and post-commit validation reviewed | Fresh explicit acknowledgement remains required |
| `src/commands/task-resume.js` | `src/core/transaction.js`, `src/core/work-state.js` | Audit records via inventory | Native task authority; transitive audit pending | Partial | Native scoped parity reviewed; full acceptance pending | Current CLI/MCP/platform coverage pending | 26 reachable consumers | Retained |
| `src/commands/task-scope.js` | runResolvedTaskScope/claim inspection and descriptor staging | Native descriptor/state/claim reservation and validated ledger | Read-only callback snapshot; mutation rereads descriptor inside claims/lease scope before native CAS commit | Partial: descriptor race corrected383 | Scope/CLI/recovery26/26 and new snapshot/race2/2 pass; both controls fail against frozen382 command; guard/collision/transitive acceptance pending | Direct API/CLI; full MCP/current platform acceptance pending | Virtual task path retained; Git cleanliness intentionally source-owned | No operational filesystem writer; public prepared audit arrays still require scale review |
| `src/commands/task-show.js` | runTaskShow/projectTaskShow and resolveTaskClaimState | Native descriptor/state, claims, lock, contract/route and artifact presence | One immutable audit callback for full/compact projections; portable compatibility retained | Partial: concurrent snapshot gap corrected382 | History/trace/owner/scope29/29 plus task CLI/claims/tamper group31/31 pass; concurrent writer control proves old snapshot then new read, parent CAS refuses stale commit | Direct API and CLI tested; full MCP/current platform acceptance pending | Virtual artifact paths retained; filesystem profile/config inputs remain intentional | No writer; callback source expires after projection |
| `src/commands/task-unlock.js` | forceUnlockTask/releaseOperationalLeaseIfUnchanged | Native operationLease/current artifact | Force/stale-only semantics use short conditional lease deletion and identity/observed-row comparison | Partial: source boundary reviewed383 | Native lock core83/83 group and CLI26/26 group passed; live/change/corruption/stale refusal preserved | Direct API/CLI; full MCP/current platform acceptance pending | No standalone filesystem lease writer; portable inspection only | Filesystem lock removal retired; deletion is bound to observed native lease |
| `src/commands/test-inventory.js` | inventoryTests/filesUnder and deterministic test-unit extraction | Repository test source files, intentionally outside operational storage | Read-only repository scan; no operational store cutover required | Partial: source boundary reviewed382 | Stable IDs/order and pure utility protection controls passed in31/31 group; public output remains proportional to source inventory | Direct core adapter coverage; full CLI/MCP/platform acceptance pending | Source tests and package/framework inputs stay files under original plan | No operational writer |
| `src/commands/test-prune-plan.js` | readTestUtility/buildPrunePlan and protected-class decision rules | Selected native canonical testUtility artifact | Existing read-only artifact admission validates schema and canonical fingerprint; no writer | Partial: source boundary reviewed382 | Native pruning fixtures and protected/unknown classification refusal passed in31/31 group; deletionAuthority remains false | Direct core adapter coverage; full CLI/MCP/platform acceptance pending | Portable input compatibility retained by canonical artifact reader | No operational writer or deletion authority |
| `src/commands/test-prune-probe.js` | buildPrunePlan/runPruneProbe | Native utility input and isolated temporary source copy | Protected/unknown test IDs refused before workspace creation; probe only edits its temporary source | Partial: source boundary reviewed382 | Pruning native fixtures/control group passed31/31; unsupported/failed probes retain inconclusive/blocked results; actual platform probe breadth pending | Direct core adapter coverage; full CLI/MCP/platform acceptance pending | Temporary test source/dependencies intentionally files; cleanup in finally | No canonical operational writer; live source deletion is never authorized |
| `src/commands/test-utility.js` | inventoryTests/ensureSemanticDecision and withTaskMutation/writeJsonArtifact | Canonical testUtility artifact and semantic decision artifacts/events; repository source inventory | Semantic decisions bind candidate fingerprints; accepted utility artifact uses guarded native task mutation | Partial: source boundary reviewed382 | Pure protection/unknown utility controls and native pruning artifact fixtures passed in31/31 group; provider and transitive write acceptance still pending | Direct core artifact coverage; complete CLI/MCP/platform/provider acceptance pending | Inventory source remains filesystem-owned; canonical utility read selects native artifact | No direct operational filesystem writer; generic native stageText/commit and schema checks retained |
| `src/commands/trace.js` | buildTaskTrace/withTaskSnapshot and action/diagnostic projections | Native state, full validated ledger, actions and diagnostic chronology | Native callback-owned immutable audit; portable/custom state retains before/after anchors | Partial: snapshot/trace owner reviewed381 | Public snapshot arrays and fingerprints preserved; trace avoids initial full source copy. Scoped history/trace/owner21/21 pass; output and phase/relation metadata remain proportional and scale acceptance pending | Direct API/CLI; complete transitive/MCP/platform acceptance pending | Profile/configuration/provider observations intentionally independent; canonical artifacts use native readers | No filesystem operational writer; retain projection and trust rules |
| `src/commands/update.js` | `src/core/templates.js`, `src/core/manifest.js`, `src/repository-index` | Install metadata and templates; no native operational writer | Plan writes and conflict checks before manifest authority; index files retain engine boundary | Partial | CLI/install56/56 before template edit; current fast checks pending at review | Native tgrep migration test skipped without binary; final acceptance pending | Template-only output/cleanup and profile preservation reviewed | Managed source assets and install manifest retained intentionally |
| `src/commands/usage-record.js` | normalizeUsage/writeTaskUsage and withTaskMutation | Native usage artifact and USAGE_RECORDED event | Guarded native task transaction stages usage and event together | Partial: source boundary reviewed362 | Caller source ACTOR_REPORTED only; host/provider usage remains separate trusted integration input; current full regression running | Direct API/CLI; complete transitive/MCP/platform acceptance pending | Profile/configuration/provider observations intentionally independent; canonical artifacts use native readers | No filesystem operational writer; retain projection and trust rules |
| `src/commands/validate-protocol.js` | `src/core/actions.js`, `src/core/approvals.js`, `src/core/completion-artifacts.js`, `src/core/task-command.js`, `src/core/transaction.js`, `src/core/work-state.js` | Audit records via inventory | Native event/artifact callback snapshot366–367; pre-audit loaders and other consumers still require full bounded-memory review | Partial | Scoped protocol/authority and immutable artifact/CAS/cleanup tests pass; frozen full prepush367 running | Direct API/CLI path uses callback collection; full platform/MCP and relation scale pending | 55 reachable consumers | Public arrays and prepared overlays preserved; callback events expire with owner |
| `src/commands/validate-receipt.js` | Receipt schema/semantics, task selector and canonical text reader | Native receipt for canonical task paths; explicit portable receipt input stays filesystem-owned | Existing read-only project scope for default/operational paths; portable input independent | Partial: direct API admission defect corrected355 | Receipt/direct-artifact/retired-seam/dispatch39/39 pass; direct no-ambient read, mixed-layout refusal, explicit portable input and native fingerprint tamper covered | Direct API and CLI; current full-platform/MCP row acceptance pending | Explicit portable file and legacy inspection input; canonical path never substitutes contradictory file | No writer; transitive scope review remains pending |
| `src/commands/validate-state.js` | READ task selector and work-state schema/semantics | Selected task canonical native state | Task resolution and existing read-only state scope | Partial: direct source review355 | Missing-state warning and error envelope preserved; new-cli/scope/workspace scoped group passed; full transitive acceptance pending | API/CLI state checks; all integrations not settled | Portable path label retained as virtual identity | No command writer; transitive state reader review pending |
| `src/commands/verify-scope.js` | Scope resolution, task ownership and workspace binding | Native scope artifact, state/contract/route inputs and scope/commit events | withTaskTransaction wraps authority checks, scope resolution, artifact and event publication | Partial: native transaction/guard chain reviewed355 | Scope/workspace/new-cli group passes7/7; guard assertions unchanged | Direct API and CLI share captureVerificationScope | Human checker configuration remains file-owned; logical scope path virtual | No filesystem operational writer; complete transitive review pending |
| `src/commands/workspace-bind.js` | bindTaskWorkspace/captureWorkspaceIdentity and withTaskTransaction | Canonical workspaceBinding artifact plus WORKSPACE_BOUND event | Guarded task mutation captures Git identity, validates immutable binding and stages event/artifact together | Partial: source boundary reviewed383 | Workspace core/CLI/mutation and policy/lease group83/83 passed; mismatch and unrestricted rebind refusal retained | Direct API/CLI; full MCP/current platform acceptance pending | Git metadata stays filesystem-owned; accepted binding is native canonical artifact | No operational filesystem writer; short commit/CAS retains external Git capture outside SQL write transaction |
| `src/commands/workspace-status.js` | Canonical binding reader and live Git identity provider | Native binding artifact; current repository/workspace identity | Native artifact read-only selection; Git capture performs no operational write | Partial: direct read/error path reviewed355 | UNBOUND/INVALID/UNAVAILABLE/MATCH/MISMATCH envelope preserved; scope/workspace/new-cli group passes7/7 | Direct API and CLI; no provider identity simulation | Live Git and portable binding path label retained | No command writer; transitive binding review pending |

## Cross-cutting unresolved consumers

- CI, portable bundles, exports, attachment digests, old client refusal, storage marker, doctor and backup/restore require new-format coverage.
- Required operational artifact byte digests and optional structural-quality reads must be modeled before their prerequisite evidence can be accepted without filesystem access.
- Temporary diagnosis persistence capability is retired: `assertCanonicalPersistence` rejects supplied capabilities before storage allocation; current regression709 passes. Duplicated guard selection and complete transitive consumer closure remain review milestones.
- Human configuration/policy, package assets, source/Git, large attachments and tgrep data remain files intentionally.

## Shared boundary evidence (partial existing-store production selection)

The shared operational preparation scope now exercises canonical task creation,
discovery, contract, route, preflight, activation, advance, receipt preparation,
run-check, record-check, diagnosis, abandonment/resume and completion. Action
and approval services use indexed records in this context. This is evidence for
shared domain persistence, not proof that every listed public surface has been
migrated. Existing SQLite stores are selected at public CLI/API/MCP and resource
boundaries. Current `withProjectStorage` admission bootstraps fresh writable projects in SQLite, requires explicit migration for legacy operational state, and leaves read-only missing-store dispatch noncreating. These rules supersede the early filesystem-default behavior documented in the historical increment105 review below. Native backup,
registered attachment backup/restore drills, canonical statement materialization
for Sigstore and portable export/import now have focused local coverage. Full
transport/platform, direct-consumer, signature-reference and production restore
activation audits remain pending. Neither these tests nor this matrix prove the
sole-writer or full original-plan definition of done.

## Current cutover boundary audit (increment 105)

Refreshed discovery: `node scripts/inventory-operational-storage.mjs /tmp/sqlite-operational-inventory-increment105.json` reports 224 source files with persistence signals and 127 command/MCP source surfaces. These are static discovery counts, not proof of parity. The earlier table has 121 rows and predates the six storage commands below. External package imports are not resolved by this script; MCP rows with zero reachable consumers must not be interpreted as having no storage dependencies.

| Surface | Verified implementation boundary | Remaining acceptance |
| --- | --- | --- |
| storage-backup | Command uses read-only project selection; native snapshot service binds attachments | Full installed transport/platform coverage |
| storage-migrate | Maintenance service bypasses ordinary selection | Every native publication/owner-handoff window |
| storage-migration-resume | Exact operation owner recovery bypasses ordinary selection | Every interrupted handoff/native window |
| storage-migration-status | Inspects layout without ordinary store opening | Platform/package matrix |
| storage-restore | Fresh-project maintenance service bypasses ordinary selection | Active-project replacement and native windows |
| storage-restore-resume | Exact retained operation/owner recovery | Every native intent/publication/handoff window |

Direct source review of `src/core/command-executors.js` and `src/core/integration-resources.js` confirms ordinary commands/resources select storage through `withProjectStorage`. `src/storage/project-boundary.js` still invokes the callback without a store for a missing unmarked database. Thus ordinary dispatch still permits filesystem operational writes; explicit migrated-store coverage does not establish sole-writer cutover. Read-only commands must remain non-migrating in the final cutover.

Direct review of `src/core/activation.js` confirms SQLite session writes are prepared in a task transaction when a store is selected, while the no-store branch still writes two files and suppresses active-marker write failure. Final removal must delete that writable legacy branch and adapt legacy compatibility to explicit import/export. Existing native adapter/session discovery requirements still require complete review before marker files can be retired.

## Selected policy snapshot boundary (increment 116)

Fresh ordinary writable dispatch now bootstraps SQLite; legacy mutation requires explicit migration. This supersedes the missing-database writable default described in the increment105 audit above. Read-only and dry-run dispatch remain noncreating. It does not remove direct no-store filesystem branches.

| Consumer | Identity and selected records | Verified boundary | Remaining acceptance |
| --- | --- | --- | --- |
| src/core/policy-engine.js: readTaskPolicySnapshot/writeTaskPolicySnapshot | Explicit taskId resolves taskArtifactPath(taskId, policySnapshot); selected task_artifacts policySnapshot/current record | Writes bind task identity; reads consult selected artifact presence and canonical schema validation. Integration authority/context9/9 and preflight snapshot/conflict2/2 pass locally on Node24.19/macOS | Remove writable no-store branch; full consumer/installed transport/platform matrix and final whole-suite regression |

The integration checks cover host approval, authorization and reconciliation, actor authority rejection, and completion/audit/report context propagation. These scoped checks do not certify the entire action or policy subsystem.

## Task inspection and revision boundary (increment 117)

| Consumer | Identity and selected records | Verified boundary | Remaining acceptance |
| --- | --- | --- | --- |
| src/commands/task-show.js | Resolved taskId/key; taskArtifactPath for contract, route, state, preflight, receipt, continuity, events and recovery | Artifact existence consults selected storage before physical files. Public CLI discovery/contract-create/task-show retains idempotent state and exposes canonical route progress | Full installed resource/platform coverage, large-ledger inspection memory, direct filesystem branch removal |
| Public contract-revise and route executors | Explicit migrated task, contract/route fingerprints, indexed state revision, CONTRACT_REVISED and commit ledger witnesses | Migrated public revision clears derived gate authorization, preserves ownership, and produces an executable stale-route recovery command; contract-revise suite15/15 passes locally | All task phases/consumer transport combinations on final source and platform acceptance |

## Canonical diagnosis/advance retirement boundary (increments119–144)

| Consumer | Canonical records and selection | Verified boundary | Remaining acceptance |
| --- | --- | --- | --- |
| src/commands/record-diagnosis.js and src/commands/advance.js | Project-selected operational scope; shared domain state/artifacts/ledger; conditional revision commit | Retired capabilities reject before allocation. Public migrated diagnosis/correction, idempotent witness semantics, missing/corrupt evidence, recovery and native abort/retry checks pass. Private persistence-seam, diagnosis-transition, phase-transition and commit-event modules have no source/test/script consumers and are removed | No-store filesystem writer removal; all lifecycle/consumer combinations; final stable whole-suite and installed/platform checks |
| tests/helpers/storage-worker.mjs (verification fixture) | Explicitly migrated canonical database; separate OS processes; actual native writer transaction | Interruption5/5; post-removal multiprocess/correction7/7. Matching preparation revisions have an explicit barrier and conflict asserts E_STATE_REVISION_CONFLICT. Busy timeout remains distinct and leaves no partial write | Full original process matrix, power-loss and native handoff windows across supported platforms |

These rows record scoped evidence and module retirement. They do not mark every original inventory row verified or establish sole-writer, net persistence LOC, reverse export/downgrade, memory/performance or release acceptance. Details and revision-specific logs remain in SQLITE_MIGRATION_PROGRESS.md.

## Public artifact location registry (increment209)

`src/core/artifact-registry.js` preserves historical `path` aliases and declares
`logicalPath`, `canonicalStorage` and `exportPath` for every registered artifact.
Task/session payloads identify the actual SQLite table (and state/descriptor
column or shared-artifact kind); project inputs identify their filesystem
location and have no database export path. Signature bundles identify immutable
attachment objects with SQLite references and portable catalog bindings.

Generated ARTIFACT_REFERENCE and AGENT_PROTOCOL_SUMMARY tables distinguish these
locations. Targeted registry/protocol/documentation checks pass25/25, including
validation of declared tables and columns against an actual current database.
This verifies registry metadata; every direct consumer still requires its own
behavioral evidence and retirement review.

## Maintenance owner handoff (increment210)

`src/storage/maintenance.js` and `maintenance-handoff.js` use immutable,
source-bound successor claims and non-replacing prior-owner archives. Owner
promotion scratch is outside the admission exclusion. Native SIGKILL tests
cover claim publication and both sides of owner promotion; independent-process
contention accepts one callback, and live/tampered/foreign/cyclic claims refuse
recovery. This replaces new unbound handoff locks; legacy unbound handoffs remain
refused. Initial admission windows, power-loss and full OS acceptance remain
separate unfinished requirements.

## Direct transaction dispatch (increment213)

`withTaskTransaction` selects the canonical project storage boundary for an
existing SQLite database or marker when called without a prior operational
scope. Scoped bootstrap/transaction controls pass19/19, including native commit,
rollback, no filesystem staging and missing-database refusal before callback.
Legacy-only writer implementation and other unscoped persistence entry points
remain separate retirement requirements; this is not sole-writer acceptance.

## Direct artifact authority and singleton writer refusal (increment214)

Direct JSON artifacts, task descriptors, work-state reads/writes/clears and
continuity clears select existing native storage before filesystem fallback.
Native work-state writes infer a task-scoped path from the payload identity.
Writable singleton/invalid operational namespaces and generic database/marker
writes refuse, including normalized/case/Windows-alias variants; configuration
remains filesystem-owned. Orphan WAL/SHM evidence refuses selection fallback.
Native task mutation requires a resolved task; route no longer publishes a
singleton when no task exists. Final direct/legacy compatibility controls39/39,
selected native controls29/29 and task-bound route CLI controls4/4 pass. Broader
native80/80 and migration24/24 passed before final namespace/task-selection
strengthening; full matrix and platform acceptance are separate requirements.

## Existing-project admission (increment215)

Direct existing-project callers set the internal existingOnly boundary constraint,
including across persistent-owner admission. A database lost between initial
selection and boundary inspection refuses both read-only and writable callbacks,
without fresh bootstrap or new filesystem publication. Dedicated unmarked
SQLite loss controls and bootstrap/connection-owner controls pass22/22. Later
file replacement/driver-opening and power-loss windows remain separate work.

## Native writer boundary source review (increment 324)

The current canonical dispatcher (`src/core/command-executors.js`) selects
`withProjectStorage` for ordinary commands, derives read-only/dry-run admission
from canonical command definitions, and leaves explicit migration/restore
operations to their dedicated maintenance boundaries. Integration resource
reads use the same project boundary with `readOnly: true`. MCP server and HTTP
transport delegate to those integration APIs rather than constructing their
own operational writer. Authentic frozen MCP324 passes73/73.

Direct `writeJsonArtifact` selects native authority for operational namespaces
before writing and rejects operational schemas at custom portable paths.
`assertNativeWritePath` rejects writable singleton/database aliases. The
remaining `writeFileAtomic` branch writes explicit portable/configuration JSON;
`writePortableJsonArtifact` rejects operational namespaces and active
operational transactions. `withTaskTransaction` always selects native project
storage; its legacy transaction discovery is read-only, and legacy recovery
and compaction entry points are refusal-only. `writeWorkState` uses canonical
native transactions. `readLockInfo` preserves explicit legacy read compatibility,
while native contexts read indexed leases.

This source review plus scoped sole-writer tests supports these named entry
points. It does not settle every transitive consumer row, public file-path
compatibility contract, maintenance topology or performance/LOC gate. Native
full audit still materializes the ledger and needs bounded-memory correction
without relaxing repair, gate, revision or decision backlinks.

Increment374 source review: task conflict inspection uses callback-owned claim evidence and computes latest meaningful activity without an event payload array/sort. Early-history positions use canonical collection access. READY preflight consistency reads its state and ledger within the audit callback and reduces READY matches without a filtered array. Public assertPreflightPersistenceSafety still returns an array ledger to mutation callers; prepared transaction read sets/overlays intentionally retain their current contract. This is partial consumer coverage, not full bounded-memory acceptance. validate-protocol pre-audit loaders, discovery supplied-artifact coherence, remaining pending rows and representative action/approval/recovery scales remain unresolved.

Increment375 discovery review: per-task native descriptor/state/lease/presence and claim projection now share an immutable audit callback; the initial indexed identity is validated and never substitutes for payload/schema/proof validation. The current set of tasks is still output-proportional and catalog-wide snapshot consistency is not established. Public mutation overlays retain their existing read-set/CAS behavior.

Increment376 progress review: latest structured diagnostic retains priority over legacy diagnosis and compares sequence with stable equal-sequence selection; public arrays keep their original sorting path. Native gain source checks ordered finite sequences before streaming, with array sorting fallback for unordered/malformed pure inputs. Interval and hypothesis-elimination dimensions are finalized before classification. Continuity reflection, failure/intervention metadata growth and diagnostic-output materialization remain unresolved.41Pending plusPartial remain.

Increment377: continuity diagnostic callback returns present:false for invalid/unavailable authority; rejection is awaited inside its safe reader catch. Open-hypothesis context retains statuses instead of historical disposition payloads, while public full hypothesis projection remains unchanged. Intervention repeat groups retain primitive counts/latest finite cycles and invalid-cycle membership. Per-cycle failure sets, public trace/reflection results and representative context scale/performance remain unfinished.40Pending plusPartial remain.

Increment378 internal progress retains only the latest finalized gain entry through summarizeInformationGain; the public full array API still collects the generator. Per-cycle failure metadata and repeated interval/intervention scans remain performance/space gaps; no full bounded acceptance claim.

Increment380: context failed requirement surfaces now use the same primitive grouped indexed membership as gain analysis. State-check contributions and sorted cycle comparisons retain parity across spill. Reviewed four additional adapter transaction boundaries;36Pending plusPartial remain. Prepared mutation array audits and public handoff/revision outputs remain explicit unresolved scale limits.

Increment381: native snapshot anchors/state/ledger share one immutable audit callback and summary fingerprint streams the canonical sorted-key representation. Public snapshot events remain arrays; trace consumes the owned source until all asynchronous action projections finish. Portable/custom-state and prepared fallback retain compatibility. Trace output, phase maps and remaining consumers still require representative memory/performance acceptance.36Pending plusPartial remain.

Increment382: ordered trace phase reconstruction emits one phase step at a time; unordered/duplicate sequence fallback retains last-write behavior. Native task-show multi-read projection now shares one immutable audit owner, with concurrent writer and parent CAS controls. Four test-intelligence rows distinguish source/temp filesystem ownership from guarded canonical utility/semantic artifacts.31Pending plusPartial remain; all rows still require full transitive/current platform/MCP acceptance.

Increment383: read-only task-scope now shares an immutable audit snapshot; mutations reread the descriptor after claims-scope admission. Controls demonstrate old command snapshot failure and lost concurrent createdAt update, both corrected without changing recovery/scope-freeze refusal. Session activation, workspace binding, lease status/unlock and rule verification boundaries source-reviewed. Current matrix25Pending and70Partial across108command rows; no full row closure claim.

Increment384: discovery catalog and all committed task projections share one immutable project backup. Nested snapshots reuse only live module-owned readonly handles. Nested observation queries follow the current parent db for CAS after intermediate owners close. Direct native findTaskById selects indexed authority before discovery; empty/missing lookup never scans the project catalog. Current20repeat discovery gains remain below2x and10task overhead exceeds tolerance; performance acceptance stays open.25Pending70Partial command rows remain.

## Full acceptance audit after initial command review (increment401)

All108 command rows have initial boundary review;95 remain Partial. Static inventory benchmarks/storage-sqlite/consumer-inventory-401.json is discovery only, not writer or completion proof. Frozen full401 includes398audit/399reconciliation and400template correction; its result remains pending.

| Original requirement | Current evidence | Remaining authoritative proof |
| --- | --- | --- |
| Sole SQLite operational writer | Native writer guards and direct-writer tests; capability deliberately false | Review every current transitive/API/MCP writer and attempted filesystem I/O; classify compatibility reads/config/export/attachment exclusions; only then enable capability |
| Related state/event transactions | Native task transactions; direct check/preparation/reconciliation fault controls | Complete all mutation/public error-path fault coverage, independent writer CAS and real process termination before/during/after commit |
| Public authority and path contracts | Existing provider/receipt/ownership tests and native snapshots | Current full source suites and final public CLI/API/MCP path evidence; every accepted export boundary documented |
| Migration and rollback | Dedicated importer/publication/resume/archive/attachment/backup/restore tests | Consolidate current results and retained-backup/downgrade/old-client-exclusion checks on supported hosts |
| Remove obsolete storage code | Runtime SQLite cutover; legacy writes refuse | Review remaining action/approval directory compatibility readers, incomplete legacy transaction inspector and maintenance aliases; remove obsolete normal-operation paths without breaking explicit import/export |
| Performance | Published synthetic discovery391targets met; idempotency328/commit346/contention351 scoped results | Representative valid history/action/approval/recovery and audit/export fixtures; RSS/FS operations/lock wait/WAL/event-loop; fresh CLI and warm integration comparison |
| Persistence code size | Published354 scope shows increase; denominator review incomplete | Refresh exact current production scope including store/import/export/maintenance; explain increase and perform original target investigation/release decision without hiding modules |
| Package/platform parity | Historical382 Mac/Windows/Linux core green; current packed MCP scoped green | Final exact source core/package/integration on Mac and remote Windows/Linux Docker, matching hashes, actual GitHub host execution |
| Runtime compatibility | Node>=24.19.0 and breaking2.0 metadata, local runtime review | Exact admitted platform runtime/filesystem and documented WAL/local-host constraints; final tarball startup proof |
| Delivery | Worktree branch and self-hosted workflow changes prepared | Validator-backed COMPLETE/VALID, then authorized PR creation and attachment; no merge/publication authorization |

Power-loss certification is not substituted for the plan's process-termination checks. Proposed target misses require investigation and release decision; correctness and durability remain fixed. Matrix review count does not redefine the original goal or imply95Partial rows complete.

### Process-termination evidence refinement (increment403)

Current `tests/storage-interruption.test.js` uses a real canonical diagnosis task and command-runtime `record-diagnosis` worker, not synthetic lifecycle edits. It terminates after conditional state update/before event insert, immediately before COMMIT, and after durable commit acknowledgement. Reopen checks SQLite integrity, domain ledger validation, complete original/committed logical snapshot, contiguous sequences and event hashes. Later writer recovery and concurrent correction checks also pass. Combined interruption/contention/attachment suite8/8,0fail/skip; `/tmp/sqlite-crash403.log`.

This proves the plan's process termination behavior for the tested diagnosis transaction and attachment conflict path on this Mac. It does not prove every public mutator, external effect exactly-once, physical power loss or final remote source acceptance. Earlier checklist language about missing process proof should now distinguish these observed boundaries from remaining mutation families.

## Kit and installation manifest writer boundary (increment419)

Direct source review of `init`, `update`, `doctor`, `readTemplateEntries` and `writeManifest` identifies file-owned installation/configuration writes. The shipped kit has93 entries; current and legacy destination paths are derived from that fixed template list, not arbitrary manifest keys. A read-only executable probe checks both path forms against `isOperationalArtifactPath` and database/marker names and finds zero operational destinations. Init validates all current destinations before writes; doctor restores template entries; update plans template-owned writes and retains ownership checks for legacy cleanup. The installation manifest writer has the fixed destination `.forgeloop/manifest.json`. These files remain reviewable installation metadata under the original plan, not canonical task/state/event authority.

The package export map exposes the CLI and canonical integration API, not the internal filesystem writer module. This export boundary does not replace domain admission or claim validation, and it does not prove every dynamic maintenance/export path. The raw portable bundle and signing writers have separate reviewed ownership boundaries; storage migration/restore publication journals and attachment paths still require their own source and fault evidence. Existing init/update/doctor regression and package tests retain their path/symlink, ownership and configuration assertions. No production behavior was changed by this review, and sole-writer completion remains unclaimed.

## Persistent search transport file boundary (increment420)

The original plan explicitly retains transport sockets/endpoint discovery and tgrep engine lifecycle files. `persistent-transport/state.js` writes only the user-scoped discovery record derived by `getPersistentTransportPaths`: schema version, PID, package/protocol version, scope, nonce, endpoint, entrypoint and activity timestamps. It does not store task state, claims, canonical sessions or ledger events. The server's fixed dispatch supports only handshake, repository search, transport status and nonce-bound shutdown; there is no lifecycle mutation method. Files are under the user's `.forgeloop/persistent-search`, with a temporary Unix socket or Windows named pipe, rather than a project task-state namespace.

The unchanged framing/protocol/ownership/status/shutdown controls pass8/8 on the current Mac. This includes endpoint-authenticated shutdown, nonce checks, bounded frames and refusal to claim an unrelated live process. These tests cover the existing search transport; they do not establish warm MCP/HTTP responsiveness, every engine-provider path or sole SQLite writer completion. The existing search transport is retained under the original file exceptions; no SQLite daemon or new background service was introduced by this review.

## Windows integration and package verification corrections (increments425–427)

Windows416 and423 connection-reuse instrumentation compared synchronous short `ADMINI~1` paths with the connection owner's asynchronously expanded `Administrator` paths. A separate Windows executable probe reproduced these distinct strings for the same file; native synchronous realpath resolves both to the expanded path. The test now uses native realpath at both comparison sites. Its one canonical connection, three detached snapshots, readonly flags and handle-closure assertions remain unchanged. Frozen425 locked MCP tests pass73/73 on Windows and Mac; all2470 Windows source hashes were checked before installation.

Windows425 then reached package smoke and failed because Node's `--import` argument received an absolute drive path instead of a file URL. The correction applies `pathToFileURL` to that argument, retaining deterministic provider injection and all package assertions. Frozen427 Windows MCP73/73, package smoke and MCP package smoke all exit0 after this correction; all2470 source hashes were checked before locked installation. Linux418's full core/MCP/package sequence exited0 without OOM: core2704pass/12skip/0fail out of2716 and MCP73/73, followed by both package smoke commands. Its archive digest, container label, image and readonly input mount agree, and all2469 terminal source hashes match the frozen manifest. Linux418 predates the attachment alias guard422. Mac424 ended without a terminal receipt and is not accepted; the current frozen425 full Mac rerun426 has a separate PID and durable exit receipt. None of these scoped results establishes final platform parity or closes the original performance, code-size, transitive consumer and delivery requirements.

## Protocol validator canonical loader (increments435–439)

The representative protocol benchmark first rejected relocated exported execution records because their project root remained bound to the original fixture path. This is an expected authority boundary. Protocol comparisons now switch two closed disposable fixtures at that exact path outside measurement; execution records and fingerprints are never rewritten. Each backend uses its canonical programmatic command runtime and must return an identical successful protocol result.

That comparison then exposed a production loader gap: `validate-protocol` still read route/state/receipt through filesystem existence and byte reads even under the native command runtime. The loader now selects recognized canonical SQLite payloads while retaining byte/JSON limits, semantic validators and file-owned explicit inputs. The command wraps its operational projection in the existing committed project snapshot helper, retaining staged transaction observation behavior and immutable nested snapshot reuse. No filesystem mirrors are created. A new public runtime/CLI regression verifies `VALID`, identical results, unchanged database bytes and absent task-state files; the same test fails against frozen433 with the former missing route/state/receipt errors. Current CLI/protocol/ledger focused checks pass29/29; lint and diff checks pass. Instrumented two-action/35-event protocol parity passes with both backends `VALID`; the frozen439 10/1,000-action protocol runs finish with identical VALID results and all2475 source hashes unchanged. Published uninstrumented p95 is35.985/28.563ms native/filesystem at59 events and378.161/150.875ms at3,029; the small regression exceeds5ms and requires profiling. This is a performance acceptance gap, not a target pass. These controls do not establish every public path consumer, all fault boundaries or final platform acceptance.

## Audit lifetime and Windows file identity corrections482–483

The independent-writer callback control482 initially exited1 because a valid audit callback could read modified private snapshot rows and return successfully. The audit now captures initial validity before caller mutation, awaits the callback once, and rechecks the private proof before returning an initially valid observation. Callback exceptions still propagate; initially invalid audits retain their existing result semantics. Mac focused event-audit20/20 passes, including the control without nested validation. Linux483 passes20/20 with2494 admitted source hashes unchanged before/after.

Full Windows480 exited1 after2722 core tests:2708 passed,1 failed,13 skipped. The only failure was the raw private-file mutation test: an independent connection read changed bytes while nested validation still returned valid. MCP/package checks were not reached. Metadata identity and SQLite data-version alone are insufficient on this host. Correction483 adds a Windows-only SHA-256 identity over readable snapshot bytes, streamed through a64KiB buffer. This adds filesystem I/O and CPU cost that must be measured before accepting resource budgets. Three consecutive Windows483 event-audit runs now pass20/20 each, including the actual raw modification and callback-lifetime controls. Final full platform verification remains required; historical platform passes do not cover these changes.

## Old-client operational exclusion controls485–488

The [reproducible drill and operator procedure](SQLITE_OLD_CLIENT_EXCLUSION.md) uses the actual pinned filesystem CLI and lock implementation. Docker Linux485 passes with a separate legacy UID65534 denied project write access after stop; Mac488 passes with the temporary old installation disabled. Both verify actual PID termination, refusal of the real legacy lock, retained dead-owner adoption, source archival/inventory preservation and a current native post-cutover write. Mac488 also validates the resulting three-task current project. Windows and the final portable Linux script remain pending. Shared dependency links are removed before installation ACL propagation; only disposable fixtures are modified. This is an operational procedure for inventoried clients, not a marker capable of stopping unknown or privileged old processes.

Final portable497 passes on all three requested platforms. Windows ordinary old-client subprocesses remove backup/restore privileges before Node starts; independent source-read probes return EPERM both before and after cutover, while the privileged native controller proves the pinned source is still present byte-for-byte. Exact main-entrypoint MODULE_NOT_FOUND masking is accepted only with those independent controls; missing dependency errors remain rejected. Docker Linux497 verifies2496 source hashes before/after. Every final drill validates the three-task current native project after a new write and unchanged retained source. [Raw results and source admission](../benchmarks/storage-sqlite/old-client-exclusion-497.json) cover this named operational boundary. Whole migration acceptance remains open.

## Current Mac499 and structural-quality context501

Canonical Mac499 prepush passes with execution `exec-c0cd07a3-9824-4ee0-ae9e-9cec7472a247`:2723 core tests,2712 passed,0 failures,11 skips; PoC67, isolated current-core MCP73 and package12 pass. All2500 frozen source hashes match at terminal. Windows499 PID2284 and Linux499 container `5341fcffe42b45997d07119e4f629a78566ca189bd6b72237bbddd9b7cb5f448` remain independent frozen499 runs, not coverage of the subsequent501 correction.

The independent-writer control500 showed structural-quality context returning an old state contract fingerprint with a newer contract after an atomically committed pair replacement. Initial and newer committed pairs are internally coherent; only the returned observation fails. This control proves read coherence, not a valid domain transition or a demonstrated false public quality PASS. Correction501 wraps committed structural-quality context and whole status projection in an existing owned read-only SQLite backup. Prepared mutation overlays and their optimistic checks remain intact; external providers do not hold a live SQLite write transaction. The owned backup can be reused by nested reads.

The exact negative control now passes. Local lifecycle/artifact12/12 and the meaningful concurrent-pair regression1/1 pass; the regression verifies original snapshot consistency and the newer pair on the next direct API call. All structural-quality tests plus the regression pass41/41; fast verification, Markdown and hygiene checks pass. Scoped remote502 quality checks now pass41/41 on Windows and41/41 on Docker Linux with2501 source hashes unchanged; final full-source/platform acceptance remains open. No sole-writer/full authority completion is claimed.

Current inclusive LOC503 is published:267 included modules,43098 baseline/50487 current nonblank physical production lines, +7389/+17.1446%. All499 inspected modules/hashes and omissions are retained; semantic denominator review remains PENDING. The original25% reduction target is missed, with no release acceptance inferred.

## Increment 604 — canonical versus portable ledger reading

- `src/core/events.js`: normal operational `readEvents`, `iterateEvents`, and `readEventTail` refuse existing unselected legacy ledger bytes. Native store selection and schema/model validation remain intact; missing operational ledgers return empty without storage allocation. Non-operational interchange paths remain readable.
- `readPortableEvents`, `readPortableEventTail`, and `validatePortableEventLedger` explicitly inspect read-only legacy/import/export bytes without selecting native authority. Ledger validation retains hash/chronology and semantic artifact binding checks.
- `src/storage/singleton-import.js` and `src/core/task-migration-validation.js` use explicit portable source inspection. `src/core/task-claim-state.js` uses it only without active or existing native authority; native direct calls admit the existing SQLite store.
- Dead filesystem transaction checkpoint/readText branches are removed. Legacy100000-line bounded tail controls now use the explicit portable reader; native100000valid-chain controls retain their behavior.
- Local67 claim/discovery/receipt/event-audit checks pass, including retained legacy refusal, portable tamper/schema/containment checks and no database allocation. Full current-source/platform acceptance and complete transitive inventory remain open. Evidence: `benchmarks/storage-sqlite/operational-portable-ledger-boundary-604.json`.

## Increment 605 — execution lookup scan retirement

- `src/core/execution.js`: canonical execution references resolve their task using indexed SQLite identity; ambiguous IDs require an explicit task selector. Missing references no longer scan legacy task directories or attempt singleton artifact fallback. Portable identity construction is separate from actual authority admission.
- Direct artifact/run-check/run-action/isolation45/45 controls pass; new controls preserve canonical lookup, cross-task ambiguity refusal, explicit selector, malformed references and retained legacy file bytes without database allocation.
- Mac immutable603 full prepush passes22gates with2609sourcehashes unchanged after termination. It precedes ledger604/execution605 production changes and does not close final-current-source/platform or workflow acceptance. Evidence: `benchmarks/storage-sqlite/execution-directory-scan-retirement-605.json`, `benchmarks/storage-sqlite/full-macos-snapshot603-terminal-605.json`.

## Increment 606 — CI receipt consumer

- `scripts/audit-receipts.mjs` previously discovered only legacy files and missed native receipts. It now selects canonical current receipt IDs from an owned read-only snapshot, validates schemas/identity, and closes snapshot ownership before launching each strict child CLI audit. Malformed legacy shadows cannot change native discovery.
- Legacy receipt discovery remains explicit read-only inspection without native authority; missing/orphan native authority fails closed without allocation. Default child CLI is resolved from the installed script source rather than assuming a duplicate CLI in the target checkout.
- Receipt/audit/task-resolution25/25 controls pass, including real strict CLI rejection of incomplete native tasks, cross-task payload mismatch, audit child failure, native shadow precedence and retained orphan bytes. Full/platform and transitive consumer acceptance remain open. Evidence: `benchmarks/storage-sqlite/canonical-receipt-ci-consumer-606.json`.

### Binding-aware writer discovery and corrected Mac verification (increment612)

Corrected source611b passes all22 Mac pre-push gates:2814 core tests,2803
passed,11 skipped,zero failed;MCP73,PoC67 and package12 also pass. All2638
frozen source hashes are unchanged. [Terminal evidence](../benchmarks/storage-sqlite/full-macos-snapshot611b-terminal-612.json)
records the source-specific result;Windows612 remains running and Linux612
is queued sequentially on the same remote host.

[Binding-aware discovery](../benchmarks/storage-sqlite/writer-binding-discovery-612.json)
parses all504 production JavaScript modules with Espree and eslint-scope,
with no parse errors. It records219 import-bound filesystem calls,22
receiver-write review leads,325 literal dynamic imports and one require
(the native SQLite loader). Synchronous calls and imported aliases are included.
The declaration-only src/integration.d.ts is outside the executable inventory.
Jevgrep returned200 relevant files with a byte-truncated context; its output
is discovery only and does not establish exhaustive coverage.

Direct source review resolves several receiver-write leads:filesystem.js writes
and synchronizes its atomic temporary file;repository-index/lock.js writes
exclusive search lock metadata;maintenance-handoff.js,maintenance.js and
storage-marker.js publish explicit maintenance ownership/selection metadata.
Socket/stdin/stderr writes carry transport messages. ledger-relations.js private
write methods issue SQL against a bounded temporary relations database created
under os.tmpdir(),which is removed when the owner closes. These findings do
not turn metadata,transport or temporary files into canonical task authority.

Native artifacts still stage through task transactions;the portable JSON
writer rejects operational namespaces and active operational transactions.
Signing bundle preparation creates a private temporary external-signer bridge,
rechecks canonical statement bytes and stages immutable attachment bytes into
the prepared transaction. Bundle ledger writes are explicit exports.

This audit remains PARTIAL:assigned aliases,file-handle provenance,dependency
internals,all public callers and runtime dispatch need transitive review and
behavioral refusal evidence. Static parsing alone cannot close the sole-writer
checkpoint. The original performance,LOC,maintenance and workflow requirements
remain in scope.

The corrected-source [twenty-repetition CLI timing](../benchmarks/storage-sqlite/populated-cli-macos-612.json)
passes output parity for all four small/large discovery/history profiles. Large
discovery p95 is1494.224ms for the pinned filesystem baseline and741.170ms
for native SQLite (2.016x);this individual profile meets the2x target. Small
discovery improves158.718→126.075ms;small history150.777→159.143ms is within
its15.078ms tolerance. No performance optimization was introduced in612. The
prior609 measurement was1.972x,so this close threshold crossing must retain
that variance evidence. Commit,idempotency,startup,persistent-MCP and resource
acceptance are still open;the whole performance checkpoint remains PARTIAL.
All2638 frozen source hashes remain unchanged after timing.

### Public bundle authority boundary (increment613)

The actual public integration command API is exercised by two new native
bundle controls:successful export preserves primary database bytes,creates
a task-bound portable manifest/ledger and creates no singleton contract mirror;
a symlinked destination is refused,preserving database bytes and creating no
redirected bundle manifest. Both controls pass on Mac,and the combined bundle
and event-export regression passes7/7.
[Evidence](../benchmarks/storage-sqlite/public-bundle-authority-boundary-613.json)
retains the source hash and bounded assertions. No production code changes.
The new controls still require Windows/Linux execution;they do not establish
whole transitive authority or power-loss proof. The611b full platform runs
continue against their immutable source.

### Corrected Windows result and sequential performance refresh (increment614)

[Windows612 terminal evidence](../benchmarks/storage-sqlite/full-windows-snapshot612-terminal-614.json)
confirms exit0,absent worker PID1936,2814 core tests (2801 passed,13 skipped,
zero failed),MCP73/73 and both package checks. All2638 frozen source hashes
match. Only after this verified terminal result was Linux612 launched on the
same host against the same archive;its terminal acceptance remains pending.

Sequential quiescent Mac refreshes preserve the corrected611b source unchanged:

- [Startup](../benchmarks/storage-sqlite/macos-cli-startup-614.json):30 alternating
  fresh-process repetitions;version p95 native42.325ms/baseline122.121ms;empty
  task-list73.462/122.858ms. Both small-workspace profiles meet tolerance and
  empty startup allocates no storage. These are current measurements,not a new
  optimization;earlier results remain retained.
- [State/event commits](../benchmarks/storage-sqlite/macos-state-event-commit-614.json):
 20 alternating warm-API repetitions with3 claims. At10/1000 initial events,
  native p95 is9.395/12.842ms vs127.435/117.464ms baseline:92.63%/89.07%
  reductions with state,event and ownership parity. At100000 events,native
 166.144ms vs148.049ms regresses12.22%;the baseline ownership audit refuses
  JSON_LIMIT_EXCEEDED while native validates ownership. Committed state/tail
  match,but this large profile does not prove equal-guarantee acceptance. Native
  WAL/FULL and the unchanged pinned fsync filesystem implementation are retained;
  this timing does not establish physical power-loss equivalence.
- [Idempotency](../benchmarks/storage-sqlite/macos-idempotency-614.json):20
  repetitions;1000/5000 actions produce75.84x/276.12x lower p95;10 actions
  native2.122ms/baseline2.242ms. These are synthetic equal-output lookup
  profiles,not public approval-volume or persistent-MCP resource acceptance.

Whole performance remains PARTIAL:large commit validation-cost investigation,
persistent integration,resource budgets and required contention profiles stay
open. No durability or integrity check was weakened to meet a target.

[Supplemental instrumented idempotency observations](../benchmarks/storage-sqlite/macos-idempotency-resources-614.json)
cover the same10/1000/5000-action fixtures with20 repetitions per backend.
Output and missing-key parity pass. The artifact preserves raw CPU,async
filesystem request,RSS endpoint,process-lifetime high-water mark,event-loop
and database/WAL endpoint measurements. It explicitly excludes operation peak
RSS,peak live WAL,SQLite internal I/O,direct lock waits and persistent-MCP
transport proof;no resource budget is marked passed from these observations.
Instrumentation timing is separate from the uninstrumented latency comparison.

### Large state/event commit diagnosis (increment615)

[CPU and isolated SQL diagnostics](../benchmarks/storage-sqlite/state-event-commit-cpu-diagnostic-615.json)
identify the reservation projection payload-binding query inside the writer as
the dominant sampled cost:169ms in SQLite statement get beneath
resolveStoreReservationState in one instrumented100000-event transaction.
This scan compares canonical JSON task,sequence,hash,previous-hash,timestamp
and event fields with indexed columns,and routes malformed or repair history
to full classification. ACTIVE reservation does not grant mutation authority.

A20-repetition synthetic in-memory query experiment compares original scalar
checks (127.189ms p95),a grouped extraction with original scalar fallback
(109.198ms),and a JSONB variant (126.804ms). These are query diagnostics,
not release timings;the grouped prototype has not proved exact error-path
parity or a30% end-to-end improvement. It is not promoted to production.
All2638 frozen source hashes remain unchanged. The required large-commit
validation-cost investigation remains open;integrity and durability are retained.

### Grouped-query rejection and retained error-parity controls (increment616)

[Expanded reservation controls](../benchmarks/storage-sqlite/reservation-query-error-parity-616.json)
compare74 canonical-payload variations and five indexed BLOB-column cases
against the independent pre-optimization scalar predicate. The grouped query
passes the payload controls but fails BLOB tampering:ERR_SQLITE_ERROR
(malformed JSON) replaces E_STORAGE_PAYLOAD_MISMATCH. The optimization is
reverted;the retained expanded guard/classification/multiprocess suite passes
19/19. All inventoried production source files
match the previously verified611b bytes. New test controls still need remote
execution.

The [candidate commit measurement](../benchmarks/storage-sqlite/rejected-grouped-query-commit-616.json)
ran before full verification and is preserved as rejected-candidate evidence:
100000-event native p95 is163.655ms vs138.551ms filesystem baseline,and
10/1000-event matched ownership profiles retain their large reductions. It
does not establish the required large improvement,and this source cannot be
released due to error-parity failure. A subsequent native A/B diagnostic
overlapped full verification due to a scheduling error;all its timing samples
are invalidated. Full verification of the rejected immutable candidate was
terminated with exit143,with logs/source retained;it is not a passing gate.
Linux612 continues against the accepted611b production source.

### Current platform checkpoint closure (scope617, collected increment616)

[Current-source platform evidence](../benchmarks/storage-sqlite/current-platform-closure-617.json)
closes checkpoint15. Accepted611b full Mac/Windows/Linux runs pass2814 core
tests per host (2803/2801/2802 passed and11/13/12 platform skips,zero failures),
MCP73 per host and package checks. Each full source verifies2638 hashes;Linux
verification independently copies the actual terminated working layer.

All newly retained bundle and reservation controls pass26/26 on each host.
Windows verifies2639 staged hashes before/after;Linux verifies them before/after
and an independent copy of its terminated working layer has no hash drift.
The current production,schema,package and workflow bytes match the full
accepted source. Snapshot differences are five documentation/evidence/test
files plus added benchmark evidence and the new bundle test. Scope counts
overlap the full suites and must not be added together.

The initial Windows scoped request exceeds the command-line limit before
execution;compressed transport reduces it to5797 characters. No failed
request is interpreted as an admitted test run. The rejected SQL candidate
and invalid overlapped A/B timings remain explicitly excluded from acceptance.

Progress is60% (12/20):six checkpoints remain PARTIAL and two PENDING.
Whole transitive authority/consumer closure,maintenance mapping,performance
and resource budgets,inclusive LOC,actual changed workflow execution and
validator-backed completion/PR still remain in scope.

### Public integration and receiver review619

The integration AST inventory contains106 exports and matches the loaded namespace exactly. `acceptCanonicalHandoff` is the direct public canonical writer outside command dispatch; it enters `withTaskTransaction`, selects `withProjectStorage` when no operational store exists, and records `HANDOFF_ACCEPTED` in the native transaction. Existing handoff tests now import the supported public integration module and assert the accepted SQLite row and absence of writable legacy task/ledger/transaction paths. Mac focused handoff, sole-writer and catalogue suite passes21/21.

All504 production hashes in binding inventory612 remain unchanged. The22 recorded receiver-write leads are classified by current receiver provenance: sockets/stdio, excluded index locking, disposable SQLite validation relations, owner-bound coordination markers, and the atomic file primitive. This closes those specific unresolved receiver leads, not the whole transitive writer proof. Atomic primitive callers, assigned aliases, dynamic imports, external callbacks and dependency effects remain review obligations. Evidence: `public-integration-surface-review-619.json` and `writer-receiver-review-619.json` under `benchmarks/storage-sqlite/`. Linux/Windows verification of the changed handoff test remains pending.

### Atomic file primitive caller review621

All54 import-bound writeFileAtomic call sites in28 modules from inventory612 have unchanged caller-source hashes and explicit file-role classification. Generic JSON is guarded portable output (including620 retired .txn fix);bundles are explicit exports from native snapshots;init/update/doctor and manifests own distributed installation assets/human inputs;signing materialization is disposable scratch;tgrep lifecycle and transport discovery remain plan-approved files. Storage callers emit retained migration,backup,restore,rollback or cutover records. Internal exportTask/exportDatabase are not package export surfaces;production callers materialize parity output under migration candidate directories. Per-call maintenance ownership,assigned aliases/dependencies and complete transitive proof remain open. Evidence: `benchmarks/storage-sqlite/atomic-writer-caller-review-621.json`.

### Legacy bundle platform reconciliation622

The remote legacy bundle gap from601 is closed for accepted snapshot611b: selected617 runs explicitly include `tests/bundle.test.js` on Mac,Windows andDockerLinux,with26/26 passing andzero skips on each host. Current bundle test and implementation hashes equal601. The cases preserve2MiB attachment bytes/size andnonempty action payload,refuse renamed action identity,and refuse symlinked signature bytes. Source hashes before/after remainunchanged;Linux terminal working layer is independently copied andverified. This reconciles existing authoritative evidence without a duplicate test run. Current620 namespace correction still requires remoteverification;forward-repair andcomplete maintenance ownership/transitive acceptance remainopen. Evidence:`benchmarks/storage-sqlite/legacy-bundle-platform-reconciliation-622.json`.

### Native forward rebuild and fullMac terminal623

Public backup/restore commands rebuild native authority from a latest verified snapshot after new task andbinary-reference writes. The drill compares all canonical logical tables/metadata before andafter,compares binary bytes,and verifies exact archived outgoing database digest. An older snapshot differs andis notused. General replace-active restore is not a freshness guard:lossless recovery requires operator writer exclusion andexplicit latest-snapshot equality. This demonstrates healthy native rebuild,not arbitrary corruption repair. Initial fixture failed because the backup parent was absent;creating the retained parent corrected the fixture without production changes. Evidence:`benchmarks/storage-sqlite/native-forward-rebuild-623.json`. Currentremote drill remains pending.

Frozen620 fullMac terminatesexit0 with22prepushgates:2819core tests,2808passed,11skipped,zero failures;PoC67,MCP73,package12pass. All2661 admittedsourcehashes remainunchanged;all inventoried runtimefiles matchcurrentworktree. An unused baseline benchmark script outside the admittedmanifest is disclosed,not promoted ascurrent-source evidence. The newforward drill was addedafterfreeze andhasseparate scopedverification. Evidence:`benchmarks/storage-sqlite/full-macos-snapshot620-terminal-623.json`. Progress remains55% untilcurrentremote/platform andotherwholeacceptancegates close.

### Actual persistent MCP measurement624

New benchmark uses actual MCP client/server in-memory transport andthe samecurrent adapter,with module resolution selectingcurrent orclean pinnedfilesystemcore. Functional2/10/1000-task pilots pass;comparison allows only declared packageVersionmetadata to differ,verifiedagainst eachbackendmanifest. Fixtures havevalid claims andten observation events pertask;they do notcoverevery lifecycle/action workload.

Twenty-repetition uninstrumentedp95:10-task tool11.801ms vs14.525ms baseline,resource9.683ms vs13.234ms;1000-task tool614.402ms vs1272.061ms (2.070x),resource567.759ms vs1233.961ms (2.173x). Separateinstrumented resource runs preserveparity andshowlowerCPU/asyncFSrequests,butnative large-worker peakRSS451.59MiB vs237.81MiB baseline requiresinvestigation. Fresh workers excludefixtureseeding;their lifetimepeak isnot a per-operation measurement. EndpointWAL0 doesnotprovepeakWAL. All2669 frozen sourcehashes remainunchanged. Evidence:`macos-mcp-latency-624.json`,`macos-mcp-resources-624.json`,`mcp-benchmark-staging-624.json` underbenchmarks/storage-sqlite. Performance/resourcecheckpoint remainsPARTIAL;progress55%.

### MCP memory diagnostic625

An isolated two-repetition, 1000-task forced-GC diagnostic preserves MCP output parity and all2669 frozen source hashes. Native retained JavaScript heap is33.67–36.08MiB versus35.96–36.42MiB baseline, while native RSS after collection remains319.30–320.42MiB versus174.44–176.34MiB baseline. Collection timing alone does not explain away the RSS difference. These modified execution conditions are diagnostic only: they prove neither natural bounded memory nor release latency. No production runtime change was made. Evidence: `benchmarks/storage-sqlite/mcp-memory-diagnostic-625.json`. Whole acceptance remains incomplete;progress55%.

### SQL statement memory diagnostic626

An isolated count/point prepared-statement reuse variant completes20 measured requests per MCP operation with cross-backend output parity. Native RSS growth remains;this experiment does not resolve resource acceptance or justify adopting the variant. Production source is unchanged;all2669 frozen control hashes match. Evidence: `benchmarks/storage-sqlite/mcp-statement-diagnostic-626.json`. Progress remains55%;whole acceptance incomplete.

### Range SQL memory diagnostic627

An isolated statement-reuse variant protects nested live range cursors and passes10 ledger snapshot tests. Twenty measured requests per MCP operation preserve output parity, but native worker peakRSS426.83MiB versus249.86MiB baseline and continuing endpoint growth leave resource acceptance open. No forced collection or production change;all2669 frozen control hashes match. Evidence: `benchmarks/storage-sqlite/mcp-range-diagnostic-627.json`. Progress remains55%;whole acceptance incomplete.

### Natural MCP memory lifetime628

Unchanged frozen production code completes100 measured task-list tool requests followed by100 project-task resource requests, with within-backend response stability and no forced collection. NativeRSS peaks442.16MiB;resource first/last20 averages434.67/434.54MiB and final20 range432.00–437.97MiB show an observed plateau in this workload. This weakens sustained per-request growth as the primary hypothesis;it does not prove universal bounds, concurrency or larger-data acceptance. Higher footprint versus earlier baseline remains material. All2669 control hashes match. Evidence: `benchmarks/storage-sqlite/mcp-memory-lifetime-628.json`. Progress55%;resource acceptance remainsPARTIAL.

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

### Current-source full Mac verification634

Full `verify:prepush` exits0 withall22gates. Core2821tests:2810passed,11skipped,zero failures;PoC67,MCP73,package12pass. All2682 admitted workingcheckout hashes equal the pre-run frozencontrol after terminal completion;control hashes also unchanged. Actual executionroot isisolated workingcheckout,not frozen634;this launch-location mistake isdisclosed and compensated by source reconciliation,not hidden. Production633 snapshot backup correction iscovered. Evidence: `benchmarks/storage-sqlite/full-macos634-terminal.json`. CurrentWindows/Linux and changedGitHubworkflows remainunverified;checkpoint15 remainsPARTIAL and progress55%.

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

### Current dynamic import surface review641

Current AST reparse coversall504production modules;no additionalproductionmodule outsidebindinginventory612. Exactly325dynamicimports have literal specifiers:316resolveinsideproject and9arebuiltins;zero unresolvedspecifier. Onlyexisting-project-scope620 andsnapshot633 hashes differfrom612;currenthashes recorded. Fivefs/promises sites were source-reviewed:humanpolicy,packageversionmetadata andexplicitcase/interventioninputs usecontainedreadonlyreads. Native node:sqlite require isruntime/capability guarded. Cryptoimports arecomputation;preparedprocess spawn remains external execution governedby its separateauthority boundary andisnot a solewriter proof. Evidence: `benchmarks/storage-sqlite/dynamic-import-surface-review-641.json`. This closescurrentdynamic-specifier resolution discovery,not importedbehavior/assignedalias/dependency/per-callmaintenance/publicnamespace closure. Progress55%;wholeacceptance incomplete.

### Increment 642 — file handles and pruning containment

Reviewed 37 direct imported open/openSync/createWriteStream/writeFile calls across 24 modules. Read access and directory/staged-file sync are distinguished from writes; this does not establish complete caller authority. The three writable streams stage verified attachment bytes or retained migration capture. The excluded repository-index download remains file-backed.

A persisted test-utility candidate could select an absolute/traversal path or copied symlink outside the disposable prune workspace. The probe now validates both its source path and copied candidate with `assertSafePath`. All five pruning tests pass, including rejected absolute, traversal and symlink candidates with external file bytes unchanged. See `benchmarks/storage-sqlite/file-handle-surface-review-642.json`. No deletion authority is granted. Concurrent hostile path replacement is outside this scoped regression proof.

Progress remains **55% (11/20 done)**. Alias/transitive effects, full public writer authority, current platform verification, performance/LOC gates, actual changed workflow execution and validator-backed closure remain incomplete. Full Mac increment 634 predates this production correction and is not current-code proof. No PR or publication has occurred.

### Increment 643 — scope-resolved alias discovery

Current Espree/eslint-scope discovery parsed all 504 production modules without failures and propagated imported filesystem bindings through identifier assignment and object destructuring. It recorded five dynamic-import destructurings (all readFile), 416 direct calls, 16 member accesses, 12 object-property references, two bound stat hooks, and seven remaining references reviewed in their adapter/default-callback context. The browser adapter receives temporary-directory creation/read/cleanup hooks; OpenSrc search and default file-validation callbacks are read-only. See `benchmarks/storage-sqlite/writer-alias-discovery-643.json`.

This is static discovery plus scoped source review, not whole writer authority: function-parameter propagation, reflective/computed assignments, module reexports, dependency internals and subprocess effects require separate evidence. The browser temporary-root boundary is lexical and does not prove physical symlink exclusion. No production change was made in this increment; progress remains **55% (11/20 done)**.

### Increment 644 — physical adapter temporary paths

Browser and emulated-service adapters previously checked temporary paths lexically, allowing an external symlink to resolve into the verification target. Rejected returned paths could also reach recursive cleanup. Both now resolve existing ancestors of roots and targets, validate the physical returned directory before granting process/cleanup authority, and use the validated canonical directory. Rejected directories are not recursively removed. The shared resolver accommodates configured targets not created yet and uses the existing transient Windows realpath retry boundary.

All 18 selected browser/provider/process/integration and emulated-service tests pass. Regression cases reject symlinked roots before creating/spawning and rejected returned directories without cleanup, preserving target entries. The initial emulated-service expectation was corrected to compare canonical macOS temporary paths. See `benchmarks/storage-sqlite/adapter-physical-temp-boundary-644.json`. Concurrent hostile directory replacement and third-party subprocess effects outside their configured cwd are not proven excluded. Current full Mac/Windows/Linux verification after this correction remains pending. Progress remains **55% (11/20 done)**, with no PR or publication.

### Increments 645–646 — full Mac terminal reconciliation and subprocess scope

The existing full Mac644 run completed with exit0 after 555.43 seconds: all 22 verify:prepush gates passed; core 2825 tests/2814 passed/11 skipped/0 failed, PoC67, clean MCP73 and package12. All 2694 admitted working-checkout files remained unchanged between launch and terminal observation. This was the actual working checkout, not a frozen clone. `benchmarks/storage-sqlite/full-macos644-terminal.json` records the terminal result and gate list. The run covers the current pruning and physical adapter path corrections.

Reviewed 14 subprocess import modules against the original plan boundary: external commands are explicitly supported outside short SQLite transactions; their intent/outcome must enter canonical storage. Temporary signer output, copied test/browser/service workspaces, explicit legacy downgrade validation and excluded repository-index effects are distinguished from migrated operational records. See `subprocess-surface-review-645.json`. A direct installed-package scan covered SDK0.6.0 (2 JS files), smol-toml1.8.0 (10), MCP server2.0.0 (26); no direct fs/child_process imports were found. This is not a transitive or reflective-effect proof.

Live GitHub inventory confirms all three requested self-hosted runners online and idle (Mac21, Windows22, Linux23). Recent inspected workflows used baseline/dependabot heads, not this candidate: registration remains distinct from changed workflow execution. See `runner-live-inventory-646.json`. Current Windows/Linux checks, full public writer/maintenance closure, original performance/resource/LOC gates and validator-backed PR delivery remain incomplete. Progress remains **55% (11/20 done)**; no PR or publication.

### Increment 647 — handoff public read consistency

Handoff-show and handoff-list previously composed the canonical handoff/catalog and acceptance ledger as separate component reads. Both now establish one committed project read snapshot around the entire projection. The public task/handoffs resource delegates to the same list projection, preserving its response shape and removing duplicated acceptance mapping. Existing snapshot policy retains staged records for prepared operations and does not hold a live database read lock across asynchronous work.

Seven focused handoff tests passed, including show/list/public-resource regressions where an independent connection commits a changed ledger row after envelope bytes are read. All three continue to project their original committed snapshot. `benchmarks/storage-sqlite/handoff-read-snapshot-647.json` records the three production deltas from the full Mac644 admitted manifest. Mac644 remains valid historical proof but predates this correction; current full Mac/Windows/Linux checks remain pending. Whole public-path/sole-writer closure, performance/LOC/workflow gates and PR delivery remain open. Progress stays **55% (11/20 done)**.

### Increment 648 — shared task-resource snapshot boundary

The public resource dispatcher now establishes one committed project read snapshot for every URI in its 21-entry task-resource allow-list, inside existing read-only project admission. This closes catalog/payload composition gaps such as task/decisions. Existing nested snapshot ownership reuses the same copy, and prepared-operation policy retains staged observations without committing them. Non-task resources retain their existing paths.

All 16 selected integration-resource/handoff tests pass. An independent connection deletes a listed decision between enumeration and payload reads; the response preserves the complete original payload set. A second regression verifies staged decision visibility while an independent DB observer sees no committed row until the outer operation commits. The initial expected-set assertion omitted lifecycle fixture profile decisions and was corrected using independent stored payloads. Jevgrep648 returned incomplete retrieval (exit2); exact source review and runtime checks are the verification evidence. See `benchmarks/storage-sqlite/task-resource-snapshot-648.json`. This is shared boundary proof, not exhaustive per-resource domain or public-path/sole-writer closure. Full platforms and proportional resource overhead verification remain open; progress stays **55% (11/20 done)**, with no PR or publication.

### Increment 649 — next projection and compact profile consistency

Direct getNextAction now owns one committed project read snapshot around its complete projection, including task selection and further recovery/approval observations. The next command owns the outer projection so its optional compact route profile comes from the same history. Existing owned copies are reused and prepared records retain their established behavior. The former separate existing-project scope branch is subsumed by snapshot admission. Progress already reads state and ledger inside withEventLedgerAudit and was left unchanged.

Thirteen selected tests passed, including full-response comparisons during independent route payload writes for direct API, ordinary command and compact output. The broader next/recovery suite passed 124 tests with zero failures; clean MCP73 and fast checks passed. See `benchmarks/storage-sqlite/next-read-snapshot-649.json`. Read-only metadata alone is insufficient for blanket dispatch changes: context-plan can request persisted semantic records, while model-route/semantic-plan have scoped behavior. Their complete authority review remains open. Current full platforms and proportional snapshot overhead, original performance/LOC targets, complete public authority closure, actual workflow execution and PR delivery remain pending. Progress stays **55% (11/20 done)**.

### Increment 650 — semantic command persistence authority review

The public context-plan executor passes no candidates. Its dynamic question-set builder rejects that empty input with E_DECISION_REQUEST_INVALID before provider evaluation or persistence. An offline provider counter observed zero calls; the native fixture retained all eight artifacts and 29 events. Thus the earlier metadata concern does not demonstrate a write through the current public CLI path. The direct task-bound API remains intentionally semantic-capable, with provider work outside the SQLite transaction and optimistic validation before committing. Model-route and semantic-plan resolve existing decisions rather than generating them.

All 15 semantic enforcement/native resolution tests passed, including concurrent canonical changes, provider non-replay and cached snapshot consistency. See benchmarks/storage-sqlite/semantic-command-authority-review-650.json. No production behavior changed. The empty-input CLI error and broader metadata/API design remain distinct unresolved issues; this audit does not authorize deterministic fallback or a blanket read-only rewrite. Current full platforms, proportional snapshot overhead, complete persistence authority closure, original performance/LOC gates, actual workflow execution and PR delivery remain open. Progress stays **55% (11/20 done)**.

### Increment 652 — current full Mac verification and isolated guard-index experiment

Owned full Mac651 prepush session91818 terminated exit0 after552.23 seconds. All22 gates passed, with2833 core tests (2822 passed,11 skipped,zero failures),PoC67,MCP73 and package12. All2705 admitted file hashes were unchanged. This covers production647–649 snapshot corrections. Evidence: benchmarks/storage-sqlite/full-macos651-terminal.json. CurrentWindows/Linux and changedworkflow execution remain open.

After verification terminated, an isolated disposable partial index using the unchanged canonical mismatch/repair CASE predicate passed three existing reservation test groups, including the87-case scalar/BLOB oracle with the historical comparison scan forced NOT INDEXED. An independent connection changed canonical event bytes and the indexed query detected the mismatch. Twenty-repetition guard-only p95 at100000 events was202.441ms without the index and0.001875ms with it; one-time index build159.177ms. This is a new performance candidate, not a full transaction result or release-target proof. No production schema/query changed. SQLite documentation supports partial predicate matching: https://www.sqlite.org/partialindex.html.

Evidence: benchmarks/storage-sqlite/reservation-partial-index-probe-652.json. Next evaluate equal-work commit/index maintenance and schema upgrade/corruption assumptions before adoption; do not trust an independently writable validation flag. Complete persistence scope, original performance/resource/LOC acceptance, currentremote platforms, workflow execution,VALID and PR delivery remain open. Progress stays **55% (11/20 done)**.

### Increment 653 — optional reservation index and full commit measurement

The production reservation query and optional index now share the unchanged canonical mismatch/repair CASE predicate. Writable public admission installs the index without changing schema version 5 or its marker; read-only and retained no-upgrade opens do not create it. Missing or ineligible altered definitions retain the original scan and error behavior. Full mutation authority still requires complete ledger validation. Required schema-6 migration was rejected during admission review because current cutover markers intentionally bind the exact schema and ordinary dispatch cannot upgrade that pair.

All 92 selected guard/store/protocol/connection/backup/restore tests passed, including the 87-case historical oracle forced NOT INDEXED, independent writes, missing/altered indexes, marker-bound public admission and preservation of malformed historical event bytes. Fast verification and clean MCP73 passed. Full Mac651 remains historical and predates this four-module production correction.

Twenty-repetition matched public state-plus-event commits with three claims measured native/baseline p95 of 9.132/117.093ms at 10 events, 8.229/120.044ms at 1000, and 5.010/145.020ms at 100000 (92.20%, 93.14%, 96.55% reductions). The measured commit target is met on these fixtures, replacing the prior large-commit regression. Complete state/event/tail parity holds. The pinned 100000-event full ownership audit still refuses its 2MiB byte limit; it retains claims and native full ownership remains valid. This does not prove complete release acceptance, power-loss equivalence or the broader resource/performance matrix. See benchmarks/storage-sqlite/commit-optional-index-653.json.

Current full platforms, complete public authority/maintenance coverage, original resource and inclusive LOC targets, actual changed workflow execution, validator-backed completion and PR delivery remain open. Progress stays **55% (11/20 done)**.

### Increment 654 — contention resources, MCP catalog correction, and snapshot cost

Current optional-index production passed 12 instrumented contention runs at 1/2/4/8 independent writers, three repetitions and 20 commits per writer. All 900 commits per backend preserve complete state, ledger and ownership parity. At eight writers native throughput was 363.8–409.4 commits/s versus 8.9–9.4 for the pinned writer; native commit p95 55.7–74.2ms versus 2354.7–4417.9ms. Native BEGIN-entry p95 was 3.38ms; maximum observed WAL828152 bytes; maximum individual native-worker RSS75.63MiB. These are instrumented measurements, sampled WAL rather than instantaneous peak, and individual-process RSS rather than concurrent aggregate memory. Evidence: benchmarks/storage-sqlite/contention-optional-index-654.json.

The first actual MCP task-resource overhead probe failed before measurement because the advertised task/decisions URI was unregistered. Five canonical task kinds were absent from the adapter's manually maintained template list: audit-view, decisions, context-plan, model-route and test-utility. Task templates now derive from the canonical TASK catalog; action retains its two-ID template. Clean MCP73 passed, including actual template completeness and a decision-resource read with owned readonly snapshot closure. Fast verification passed. This is a transport catalog correction, not a new lifecycle authority.

The corrected actual MCP adapter was used for both current source and frozen634 before647–649/653. All2682 frozen control hashes matched before and after. Twenty warm-cache repetitions preserve complete response parity. At10 tasks decision-resource p95 current/control5.797/2.637ms and next38.045/31.024ms. At1000 tasks decision-resource67.232/3.316ms and next69.483/76.002ms. The whole-project snapshot imposes visible decision-list cost; this compares native implementations, not the original pinned baseline, and does not establish original small-workspace acceptance. Evidence: benchmarks/storage-sqlite/task-snapshot-overhead-654.json.

Current full Mac/platform checks now also need the one-module MCP catalog correction; fullMac651 predates653/654 production. Complete persistence authority/maintenance scope, original full resource/LOC and performance matrix, current remote platforms, actual changed workflows,VALID and PR delivery remain open. Progress stays **55% (11/20 done)**.

### Increment 656 — consolidated current Mac verification

Owned full Mac655 prepush session56643 terminated exit0 after618.56 seconds. All22 gates passed: core2836 tests (2825 passed,11 skipped,zero failures),PoC67,MCP73 and package12. All2710 admitted file hashes were unchanged before/after execution. This verifies current optional-index653 and MCP catalog654 production, including backup/restore, lifecycle, package and transport checks. Evidence: benchmarks/storage-sqlite/full-macos655-terminal.json. No production code changed in this reconciliation.

Current Windows/Linux and actual changed workflows remain unverified. The retained LOC inventory604 is above its reduction target and scope review remains pending; commit gains do not settle that requirement. Snapshot decision-list cost at1000 tasks remains visible in654 evidence. Future optimizations must retain consistent projections, original artifact validation/errors, prepared-operation visibility and observation rechecks, while keeping external work outside native transactions. Whole persistence authority/maintenance coverage, original performance/resource/LOC acceptance, current remote platforms,VALID and PR delivery remain open. Progress stays **55% (11/20 done)**.

## Continuity freshness reconciliation936

Current native reconciliation enters the detached ledger/operational read snapshot and compares the stored continuity state fingerprint, task, phase and contract against current bindings. Four current-source-matched full prepush920 controls verify fresh classification, state/repository drift, task/contract mismatch and phase drift. Conformance retains no evidence authority. `benchmarks/storage-sqlite/continuity-freshness936-review.json` retains exact results and hashes. Independent-writer direct recording and complete diagnostic/lint/handoff dependency coverage remain open; no new tests were run during resource measurement.

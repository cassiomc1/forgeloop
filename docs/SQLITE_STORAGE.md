# SQLite Storage Migration

ForgeLoop is migrating machine-managed operational state from a hand-written
filesystem transaction layer to a single SQLite database per project state
root. This document records the implemented storage layer, its verified
behavior, and the boundaries that are deliberately **not** migrated yet.

## Status

The original plan in `SQLITE_MIGRATION_PLAN.md` remains authoritative. Public
command and resource boundaries select canonical SQLite. Fresh writable projects
bootstrap a journaled SQLite store; fresh read-only and dry-run commands do not
allocate one. Existing legacy operational state requires explicit migration
before ordinary mutation. A real selected
SQLite lifecycle fixture reaches validator-backed completion. This does not
establish a released sole writer: complete crash-window cutover recovery, consumer audit,
attachment recovery, obsolete-code removal and the original performance,
platform and LOC gates remain unfinished. See `SQLITE_MIGRATION_PROGRESS.md`
for implementation-specific verification results.

The sections below retain incremental design and verification notes. Statements
about unfinished transitions describe their historical checkpoint unless
explicitly identified as current. Current release acceptance is still incomplete: native full audit
materializes the ledger, the 100,000-event commit target failed, the reviewed
persistence-specific LOC target is unproved, consumer inventory remains partial,
and current remote/CI and validator-backed closure evidence is outstanding.

| Area | State |
| --- | --- |
| Schema and migrations | Implemented, versioned |
| Connection, durability defaults, pragma verification | Implemented |
| Synchronous transaction helper | Implemented, hardened |
| Indexed task/claim/event/action/approval/execution/artifact queries | Implemented |
| Filesystem importer | Unpublished project transaction; shared schema/domain, identity, ledger and ownership validation |
| Deterministic exporter | Implemented, round-trips |
| Canonical diagnosis and correction | Shared domain commands on selected SQLite; temporary private transitions removed |
| Public CLI/API/resource selection | Fresh writable SQLite bootstrap and existing-store selection; mixed legacy state refused |
| Public backup and doctor | Native database or referenced-attachment-inclusive backup; read-only integrity findings |
| Active-project replacement | Explicit CLI/API initial replacement and resume available; native process-kill controls and owner-bound handoff checkpoints pass; earliest intent, legacy unbound handoff and full platform acceptance pending |
| Controlled legacy cutover | Public initial migration, recorded-stage recovery and owner-bound handoff recovery; unrecorded windows and legacy unbound handoffs remain unresolved |
| Legacy transaction writer/locks/compaction | Writer, filesystem locks and compaction retired; minimal discovery/refusal compatibility remains |

## Canonical diagnosis and correction

Public `record-diagnosis` and `advance` execute their shared domain commands
through project-selected operational storage. The temporary capability,
private diagnosis/phase transitions and private commit helper have been removed.
Caller-supplied retired capabilities reject before public storage allocation.

Diagnosis preserves the same domain details, revision and canonical event hash
across direct API and public dispatch on independent native copies of the same lifecycle seed, after
normalizing the new event timestamp. Each accepted command also appends its
canonical transaction witness. An idempotent diagnosis retains its original
event while advancing state and adding only the command witness.

Preparation, domain validation and external observations occur outside the
short synchronous writer transaction. Commit rechecks recorded observations
and performs conditional state/artifact writes and event persistence atomically.
Controlled native SQL aborts and separate-process kills verify the tested
rollback/commit boundaries; they do not establish power-loss or platform gates.

Checkpoint revalidation reconciles a losing optimistic revision conflict only
after rechecking current eligibility, ownership, ledger and repository identity.
If a concurrent writer already established a fresh checkpoint, the loser returns
a no-op without replaying mutation or appending a transaction witness. Nested
transaction conflicts and checkpoints that remain stale still fail.

### Transaction hardening

`runInTransaction` now:

- rejects a declared `async` callback before invoking it, and still rejects a
  returned thenable;
- marks a transaction rollback-only after any nested failure, so an outer
  `catch` that swallows a nested error still cannot commit partial work;
- publishes its handle through `AsyncLocalStorage`, and every repository writer
  calls `assertWritableContext`, so a write from a continuation that resumed
  after the transaction closed is rejected (`E_STORAGE_TRANSACTION_EXPIRED`)
  instead of silently committing;
- refuses to join a transaction bound to a different project identity.

This closes a real gap in the Phase 1 implementation, where a rejected async
callback still ran its synchronous prefix and a late continuation could write
outside any transaction.

## Runtime requirement

The store uses the single built-in `node:sqlite` driver and admits Node 24.19.0
or newer. Core and MCP package engines and root lockfile metadata now declare
`>=24.19.0`. The minimum CI job pins 24.19.0, and the expanded matrix includes
that exact runtime on Windows, macOS and Linux, with native store/bootstrap tests.
These workflow definitions are not evidence of hosted platform success.

The minimum was locally tested on Node 24.19.0 / SQLite 3.53.3 / macOS arm64.
Earlier development checks also used Node 26.10.0 / SQLite 3.53.4. Later-version
admission does not certify every runtime. The exact runtime API and SQLite fix review is recorded in
`SQLITE_RUNTIME_REVIEW.md`. Breaking major release metadata, startup
measurements and hosted platform acceptance remain unfinished; nothing has
been published.

## Location and durability

One database per state root, at `.forgeloop/state.sqlite`. Connection defaults
are applied and then **verified**, because a filesystem that silently refuses a
setting would otherwise degrade durability invisibly:

- `journal_mode = WAL`
- `foreign_keys = ON`
- `synchronous = FULL` — matches the fsync-before-rename durability the
  previous filesystem transaction implementation provided
- `busy_timeout = 5000` — matches the previous 5s transaction wait

Extension loading is never enabled and every statement binds its parameters.

WAL supports concurrent readers with a single writer, but it is not a
multi-host network filesystem. Successful pragma checks do not establish filesystem suitability. Enforced
detection of known unsupported network configurations and platform acceptance
remain unfinished.

## Schema

Ten tables: `storage_meta`, `tasks`, `claims`, `events`, `actions`,
`approvals`, `executions`, `task_artifacts`, `sessions`, and
`attachment_references`.

Identity, ordering, and lookup fields are indexed relational columns; nested
protocol structures are stored as canonical JSON payloads rather than being
normalized table by table. Extracted columns and payloads are always written in
a single statement so the two representations cannot drift.

Constraints that the protocol actually requires are enforced by the database:

- `events` primary key `(task_id, seq)` plus `(task_id, event_type, seq)`
- a partial unique index on `(task_id, idempotency_key)`, so a duplicate
  task-local idempotency key cannot create two accepted actions
- foreign keys to `tasks` for owned records

`claims` deliberately does **not** use exact-path uniqueness as a conflict
rule. Directory, wildcard, and ancestor/descendant overlaps cannot be expressed
that way; callers must still evaluate `claimsOverlap()` over the candidate rows
returned by `findOverlappingClaims()`.

The optional `events_reservation_proof_idx` indexes histories that require full
reservation proof using the exact canonical JSON mismatch/repair predicate.
It changes neither schema version 5 nor its cutover marker. Writable public
admission may install it; read-only and retained no-upgrade opens do not.
A missing or ineligible index falls back to the same scan. The index never
releases claims or grants mutation authority; full ledger validation remains
required for those decisions. Existing event bytes are preserved.

## Audit guarantees

Imported events are stored exactly as found. The store never rehashes,
rewrites, or reorders historical evidence, and a query that finds a task does
not by itself authorize a write, mark completion valid, or replace the
protocol's evidence validation. Fingerprints are computed with the existing
`canonicalFingerprint()` so parity with current evidence checks is exact.

## Transactions

`runInTransaction(db, callback)` runs a synchronous callback under
`BEGIN IMMEDIATE`, reusing the active transaction when nested and rolling back
on any thrown error. A callback that returns a Promise is rejected with
`E_STORAGE_ASYNC_TRANSACTION` rather than awaited, because `DatabaseSync` would
already have committed by the time an async continuation ran.

A transaction must never be held open across a checker, browser, network
request, signing provider, or child process. For external work, persist
intent, commit, perform the operation, then record the observed outcome in a
second transaction. `commitTaskMutation()` performs the conditional revision
update **before** appending its audit event, so a rejected revision cannot
leave a committed event describing a change that never happened.

## Migration and rollback

Import is an explicit maintenance operation and is never triggered by a
read-only command. It aborts, without publishing a store, when any task ledger
fails validation, when a descriptor's `taskKey` disagrees with its directory, or
when a required relationship is missing. Nothing is silently repaired; the
error carries a `report` with the specific findings.

The unpublished import database uses one project transaction, including
sessions. A rejected later namespace rolls back earlier rows. Task directories
without descriptors, substituted descriptor/state identities and symlinked
ledger paths are refused. Shared domain ledger and ownership validators run
before commit; proven completed/recovered claims become `RELEASED`, and
overlapping active ancestor/descendant claims abort conversion. Sources are
retained. An aborted empty database may remain at the private destination;
this is not an active layout or a completed cutover.

These checks do not provide writer quiescence, old-client exclusion, crash
resumption, complete attachment inventory or publication of the active store.

### Retained source capture and maintenance exclusion

The internal `captureLegacySource` preparation helper requires an explicit
operator assertion that all legacy writers have stopped and are excluded. It
refuses retained task/project locks and incomplete transactions. The helper
captures named operational roots, legacy singleton artifacts, sessions,
transaction history, portable session bindings and `.forgeloop/attachments`
into an exclusive retained directory. Files stream through copying and hashing;
copied files are synchronized, and membership/digests are rechecked before a
`CAPTURED` manifest is written. Existing captures are never overwritten or
automatically removed. This is not a full repository backup, and custom
attachment paths outside these roots require the remaining reference audit.

`verifyLegacySourceCapture` refuses incomplete captures and changed copied
bytes or membership. The manifest binds included bytes; it is not an external
authenticity proof. Capture does not publish an active database.

Version-aware public command/resource boundaries and native task lease
admission refuse `.forgeloop/.storage-maintenance`. Retained legacy task/claim
locks require explicit reconciliation and are never displaced by native admission. Maintenance work
joins only its current owner and closed asynchronous contexts cannot reuse the
exclusion. A killed process leaves the marker in place; ordinary commands do
not infer stale ownership or remove it. Public `storage-migration-status`
inspects bootstrap layout and bounded owner metadata even while ordinary
commands are excluded. It reports incomplete/malformed records, exposes no
unrecognized owner fields, and never opens or validates the database. Owner
liveness and publication remain unverified. It also reports a retained owner
handoff marker or owner-bound handoff claim. The internal
`resumeStorageMaintenance` helper can adopt an exact identified dead local owner
after explicit writer quiescence. It archives the prior owner bytes without
replacement, checks ownership again during handoff and keeps ordinary dispatch
excluded throughout recovery. New handoffs publish complete immutable claims
and follow only a bounded chain of dead local claimants; live claimants,
source-binding mismatches, cycles and unbound/remote identities are refused.
Legacy interrupted handoff directories remain refused because their creator is
not bound to a durable owner record. Recovery failure retains the new exclusion.
An older marker without host identity cannot be automatically adopted. Public
resume continues verified publication stages; unrecorded capture and unbound
candidate files remain unfinished. Older
binaries must be stopped and operationally excluded; this marker cannot make
an older implementation recognize a new rule.

A safe operator procedure is: quiesce all writers, preserve an intact source
backup, import into a temporary database, review the report, run
`checkStorageIntegrity()` (`integrity_check` and `foreign_key_check`), and only
then publish. Restoring the source snapshot is safe only before the new
database has accepted writes; unconditional downgrade support is not claimed.

## Measured results

Two harnesses, deliberately kept separate.

### Domain-command benchmark harness

`node scripts/benchmark-diagnosis-parity.mjs --tasks=1,10 --measured=30 --warmup=5`

Both backends now run the same guarded canonical `runRecordDiagnosis` command.
The SQLite fixture explicitly migrates before timing and selects its canonical
connection. Each timed sample must perform a real mutation. Valid lifecycle
fixtures and actual unrelated tasks are built outside timing; warmup is
excluded and backend order alternates by scenario.

The output records raw operation samples, actual selected ledger lengths,
requested padding, native SQLite version and separate fixture/session setup
costs. A requested ledger shorter than the valid lifecycle seed is reported as
that seed's actual length. Connections close before fixture removal. Scope is a
warm domain-command comparison, not cold CLI or persistent-runtime acceptance.

The converted harness has only smoke evidence for one and two tasks, thirty
selected events and one sample per backend. It establishes harness operation,
not a median/p95 speedup or acceptance threshold. Earlier private-transition
measurements (including the historical 125.1x/205.7x ratios) measured the retired
path and are not evidence for the current guarded command. Full original-plan
task/event/process sizes, throughput, memory, file operations, lock wait, WAL
and event-loop measurements remain required.

Machine-readable samples and metadata are written to the `--out` directory
(`meta.json`, `summary.json`).

### Equal-output discovery and separate indexed queries

`node scripts/benchmark-storage-sqlite.mjs --sizes=10,100,250,1000,5000 --repeats=20 --baseline-root=/absolute/path/to/clean/baseline`
requires the baseline checkout to be clean at the plan-pinned commit
`ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5`. It runs that release's complete
discovery API against an explicit portable export and compares it with native
discovery, requiring identical output and valid ownership. Omitting
`--baseline-root` uses the retained legacy read compatibility path instead.

The fixed-timestamp fixtures represent RECEIVED tasks. Synthetic database
seeding is excluded from every sample and cannot establish state/event commit
performance. Samples include per-call native connection open/close and warm
filesystem caches; they are neither cold CLI nor persistent MCP measurements.
Indexed row query timings are reported separately. The output intentionally
keeps `releaseThresholdsVerified: false`: this discovery fixture alone cannot
satisfy the plan's complete performance, contention and memory matrix.

The previously reported 104–116x comparison mixed validated discovery and
unvalidated indexed reads. That speedup claim remains retracted. Query-plan
assertions establish access paths only; they cannot prove end-to-end speed or
constant total validation work.

## Verification

Frozen macOS core run 321 completed 2,632 tests: 2,621 passed, 0 failed, 11 skipped
on Node 24.19.0. All 2,419 source hashes remained unchanged after termination.
Detailed source/result evidence is in `docs/SQLITE_MIGRATION_PROGRESS.md`.
This scoped run does not establish full-plan acceptance or current remote
platform, MCP and packaging results. The individual counts below describe
historical focused runs and do not replace current regression evidence.


`node --test tests/storage-store.test.js` — 16 tests covering durability
settings, schema versioning, indexed lookup, optimistic concurrency conflicts,
claim reservation, idempotency uniqueness, event ordering and hash
preservation, canonical fingerprints, rollback, nesting, async rejection,
fail-closed import, and an exact export/import round trip.

`node --test tests/storage-diagnosis-differential.test.js` — 20 tests covering
the migrated transition against the filesystem path: identical canonical hash and
result, atomic state-plus-event commit, the idempotent path, rejection cases
matched by public error code, a tampered ledger failing closed, crash-before-event
and crash-before-commit leaving no partial state, sequential mutations without
lost update, stale-revision conditional updates, rollback-only nested failure,
late async continuation rejection, and export/re-import identity.

`node --test tests/storage-validation-failclosed.test.js` — 8 tests for
mandatory validation. Covers the four outcomes separately: not applicable,
applicable and passed, applicable and failed, and applicable but unavailable.
Each rejection compares the complete logical snapshot before and after.

`node --test tests/storage-multiprocess.test.js` — 6 tests using genuinely
separate OS processes with independent connections: competing revisions with an
explicit readiness barrier, a fresh-connection reopen, the idempotent branch
across processes, a coherent independent reader, a busy timeout reported as
`E_STORAGE_BUSY` rather than a revision conflict, and no partial write after a
timeout.

`node --test tests/storage-interruption.test.js` — 5 tests terminating a child
writer at controlled boundaries: before commit, after the state update but before
the event insert, after a confirmed commit but before the response is delivered,
recovery by a later writer, and structural plus domain validation after reopen.

All 55 storage tests pass. `npm run verify:fast` passes, and the pre-existing
diagnosis, event-ledger, work-state, and transaction suites continue to pass.

## Canonical dispatch and verification boundaries

The supported write path is public command dispatch, project storage selection,
the shared domain command and the operational preparation/commit scope. There
is no alternate command persistence capability or private single-edge writer.
Source/test/script consumers of those removed modules have been converted.

The current integration suite covers canonical envelopes, input rejection,
actor authority boundaries, idempotency, mixed legacy refusal, corrupt indexed
state, recovery evidence and missing correction prerequisites. Selected evidence
readers retain full schema, ledger, artifact binding and ownership validation.
Corruption may reject at the ownership boundary before diagnosis-specific rules;
no narrower error ordering is promised by the retired private API.

Filesystem attempt observers retain caught-read and transient-write controls.
Exact-root metadata probes used for coexistence and containment admission are
allowed; legacy payload reads, scans, mutation locks, transaction staging and
mirrors are prohibited during the tested canonical commands. Fresh read-only
discovery neither allocates SQLite nor resolves its driver, with an explicit
driver-import positive control.

Native SQL faults roll back state, events and native witness rows, and the same
command succeeds after the trigger is removed. Independent-process contention
uses a preparation barrier to establish matching read revisions; exactly one
mutation commits and the other receives a revision conflict. Busy timeout is
verified separately and leaves no partial mutation. Controlled process-kill
coverage includes before-event, before-COMMIT and confirmed-after-COMMIT windows.
These scoped results do not prove every native/portable handoff, power-loss
window or supported platform.

Current evidence is recorded per increment in `SQLITE_MIGRATION_PROGRESS.md`.
Complete consumer auditing, legacy filesystem writer removal, reverse export
and supported downgrade, active-project restore replacement, net persistence
LOC reduction, measured memory/performance, release/platform matrices and
final stable whole-plan verification remain unfinished. No full migration
completion or sole-writer release claim follows from the focused suites.

## Diagnosis to correction continuity

Canonical project selection routes `record-diagnosis` and lifecycle `advance`
to their shared domain implementations. The tested diagnosis-to-correction
sequence uses public migration and dispatch without a persistence capability.
Full consumer/edge acceptance remains subject to the original migration matrix.

`tests/helpers/canonical-diagnosis-fixture.js` creates its seed using actual task,
discovery, contract, route, preflight, activation, advance, receipt, and failing
check commands. Ledger/state coherence is checked at each boundary. No synthetic
milestone or suppressed preflight failure establishes this fixture.

The sequence now shares the filesystem execution-prerequisite evaluator,
preflight loaders, diagnosis prerequisite, claim-state classifier, receipt
preparation, and canonical event builder. External observations occur before the
short synchronous write transaction. Store state/artifact/event fingerprints,
revision, ownership, and workspace binding are rechecked inside it.

Each accepted dispatch appends its canonical `TRANSACTION_COMMITTED` witness.
The correction edge does not invent a `PHASE_ADVANCED` milestone. Shared receipt
preparation preserves filesystem behavior.

### Observed checks

- Complete valid filesystem/store sequence comparison covers normalized state,
  receipt and event semantics; timestamps, chain hashes and random transaction
  IDs are compared through separate chain validation rather than literal equality.
- Missing preflight and actual canonical recovery reject both continuations
  without mutation. Missing diagnosis keeps the shared rejection ordering.
- Injected failures after state and event writes roll back correction while
  retaining the committed diagnosis.
- Two independent workers accept exactly one correction, leaving one revision
  increment and one command commit witness.
- Attempted-I/O observation finds no operational task-state, lock, transaction,
  or session access over diagnosis/advance when legacy records are absent or
  contradictory. Positive controls establish that observation is active.
- Semantic decision binding validation reads the selected store, including
  missing, malformed and altered artifact cases.

The Node 24.19.0/macOS storage suite passed 104 tests with four test processes.
A previous unbounded-concurrency run timed out waiting for a worker readiness
marker; isolated contention passed. Readiness now reports an early worker exit
with captured diagnostics. The timeout's exact cause has not been established.

### Artifact bytes and portable export

Schema version 2 introduced accepted original JSON bytes and their SHA-256 digest
beside canonical payload/fingerprint evidence. Byte-bound legacy references are
resolved against this retained source, and byte/payload disagreement fails
integrity checks and export. Storage format remains version 1; future schema or
incompatible metadata is rejected without downgrading it.

Exports use the built-in SQLite backup API to create a private read-only
snapshot. Filesystem writing does not retain a live WAL reader transaction.
Ledger serialization streams ordered rows instead of constructing a full ledger
string. Task manifests bind every included file's size and SHA-256 digest.
Shared safe-path checks reject symlink destinations, and stored identities cannot
escape the portable layout. Source transactions must be committed before export.

The latest focused Node 24 store run passed 22 tests, including committed WAL
content, an independent writer after snapshot capture, read-only snapshot
behavior, manifest digests, and export containment. Large-workload memory and
snapshot cost measurements, cancellation under continuous writes, attachment
coverage, public backup/restore commands and complete importer/exporter parity
remain required.

### Remaining migration scope

Full invalid prerequisite parity, optional structural-quality readers, every
lifecycle edge, claims/actions/approvals/executions and public CLI/API/MCP
consumers remain in scope. Explicit safe cutover, legacy-writer exclusion,
backup/restore, platform checks, equal-work performance, code removal, and net
LOC reduction are not complete. These checks do not establish full-plan
completion or authorize a release.

## Shared operational preparation scope

`src/storage/unit-of-work.js` now adapts the existing domain transaction API to
SQLite for internal differential tests. Domain schema/lifecycle/authority rules
remain in their existing services. Proposed records and observations are held
outside the database transaction; commit rechecks the read set under a short
synchronous writer reservation. A changed task catalogue refreshes shared claim
validation without replaying the mutation callback or external operation.

Canonical task creation, direct indexed lookup, contracts, routes, preflight,
activation, phase transitions, receipts, actions, approvals, execution records,
recovery/resume and completion have been exercised through this shared scope.
The ten-test operational suite includes a complete correction/recovery cycle
ending in validator-backed fixture completion without legacy task/session files,
independent-process overlap/non-overlap reservations, indexed idempotency,
single-decision approvals, tampered columns and durable external reservations.

Schema 3 adds the active-session reference. External checker/action wrappers
reserve semantic ownership in the store while allowing other tasks to commit;
SQLite transactions do not span process execution. Stale cleanup compares the
observed lease before deleting it, and malformed ownership stays fail closed.
Full action-launch crash/reconciliation coverage and long-running lease renewal
remain required.

Production CLI, API and MCP boundaries select an existing SQLite store; fresh
and legacy projects still use the filesystem adapter. Remaining direct path consumers, public maintenance,
legacy exclusion/cutover, platform validation, deletion of filesystem staging
and original performance/code-size acceptance remain unfinished.

`storage-backup` opens the source store read-only even though it writes a new
destination. `doctor` also opens the store read-only unless `--fix` is explicitly
true. Both inspection paths refuse an older schema without upgrading it;
command mutation classification alone does not authorize a source migration.

Private migration candidate preparation captures retained sources, imports them,
validates domain schemas and lifecycle evidence, checks source/export parity and
reimports the export to compare canonical rows. Source manifest version 2 records
directory membership, including empty namespaces. The importer
refuses unsupported entries at the task namespace root rather than silently
dropping directories or stray files. Candidate manifest version 2
stores compact summaries and a separate digest-bound task inventory. Verification
regenerates that inventory, independently imports retained sources and repeats
export parity checks. These internal helpers never publish the active database;
`publicationReady` remains false. Attachment reference validation and complete
crash-resumable cutover remain required. Full ledger audits still materialize
arrays and are not evidence of bounded audit memory.

`attachment-files.js` provides an internal publication primitive: stream bytes
into a private file, synchronize it, publish exclusively at its SHA-256 object
path, verify path/size/digest and synchronize parent directories before returning
the reference. Existing objects are verified rather than overwritten. Stream
failure removes only the unpublished temporary directory. Callers must publish
before the database write transaction. Schema 5 adds task-bound immutable
attachment references. `registerAttachment` publishes and verifies the object
before a short transaction inserts its binding; changing an existing identity
is refused. Portable database export requires an attachment source root when
references exist, copies verified objects and records their bindings; import
verifies bytes and inserts bindings within its unpublished project transaction.
Domain consumer integration remains unfinished.
These helpers do not automatically delete
unreferenced published objects.

`storage-backup --destination <new-directory> --include-attachments` creates a
retained native database snapshot plus every canonically referenced object.
An independently bound NDJSON inventory is checked against snapshot references;
verification checks database integrity and attachment bytes. Internal restore
drills copy a verified bundle into a fresh directory and verify it again. They
never activate it or overwrite an existing directory. Failed/interrupted bundles
remain retained and cannot be accepted as ready; retention is manual and no
automatic deletion occurs. This includes registered references only: migration
of legacy attachment references, all domain consumers, project activation and
production restore orchestration remain required. Without the flag, backup
continues to report `DATABASE_ONLY` with attachments excluded.

Sigstore's external process now receives a private temporary statement file when
the selected statement comes from SQLite. The canonical bytes are materialized
without creating a legacy operational mirror, checked again after the process,
and the private file is removed after success or failure. External signing and
verification refuse an active SQLite transaction. Filesystem-backed statement
paths keep their existing behavior. Signature-object registration and migration
of legacy signature references remain required; these checks do not establish
cryptographic validity without an actual configured signer.

Storage integrity also validates canonical attachment-reference identity, path,
safe byte size and SHA-256 format independently of SQLite page/foreign-key checks.
Malformed bindings produce bounded `attachmentErrors` findings and refuse native
backup publication. This synchronous database audit does not read external object
bytes; attachment-inclusive backup and its verifier perform that separate check.

Internal publication staging revalidates the candidate under maintenance
exclusion, requires complete attachment-reference coverage and builds an
independent native backup bundle in the retained capture. Its operation journal
binds source inventory, candidate bytes and staged database/inventory digests.
Verification checks canonical rows against the revalidated candidate, so changing
both bundle and journal digests cannot authorize different task data. Incomplete
stages are retained and refused. `STAGED` still has `publicationReady: false`:
activation is performed by the subsequent owner-bound cutover stages described
below. Crash-resumable public orchestration remains unfinished. Staging never
replaces the retained candidate or changes the active operational layout.

Source-partition inspection verifies actual retained source bytes and directory
membership across active and archive locations. Each known source root must be
intact in exactly one location, or absent only when absent from the capture.
Empty directories remain meaningful. Duplicate, missing, changed and unexpected
archive entries are refused; no journal claim substitutes for these checks. This
read-only primitive can recognize a completed rename before a journal update,
and is used by archival and activation. It alone does not move roots or complete
crash recovery.

Internal archival now moves verified legacy roots into the retained publication
archive under the exact live maintenance owner. It revalidates staged canonical
rows, synchronizes rename parents and derives already moved roots from actual
source partitions before continuing. Immutable attachment object paths remain
active. An `ARCHIVED` journal is refused if operational roots still remain active.
The helper must stay inside the owner's complete cutover/recovery callback;
the public initial migration command now supplies that callback. The archival
helper is not a standalone migration command.
The disposable archival test retains maintenance exclusion after archival instead
of releasing a project with neither active legacy state nor an active database.

The bounded, UTF-8-validated `.forgeloop/storage-version.json` marker binds the
storage format/version, database schema, cutover identity and retained source
inventory. Its pending writer requires the exact live maintenance owner and
publishes exclusively; conflicting existing markers are preserved and refused.
Public storage selection refuses `CUTOVER_PENDING` even without maintenance
exclusion and refuses filesystem fallback when an `ACTIVE` marker has no database.
Malformed markers remain untouched and fail closed. Public marker recovery
remains unfinished; the pending-marker primitive does
not activate or migrate a live project.

Internal activation joins the maintenance owner, requires verified archival,
publishes an independent native database copy exclusively, checks canonical-row
parity and activates the marker before finalizing the publication journal. A
pending publication with an existing database is revalidated rather than replaced.
The active-marker/before-journal window can be reconciled only while database rows
still match the staged snapshot; accepted new writes cause refusal, never rewind.
Archival writes the pending marker before moving roots, so early exclusion release
cannot restore filesystem fallback. This is local internal cutover coverage, not
complete public migration/recovery or killed-process/power-loss acceptance.

Marked public dispatch opens one connection with schema upgrades disabled, then
checks marker/schema/format agreement before invoking the command. An older
marked database cannot be implicitly upgraded through ordinary mutation dispatch.
The earlier separate probe connection has been removed. Persistent connection
reuse and measured latency/throughput acceptance remain required.

Internal terminal-publication verification joins the maintenance owner and
validates a consistent snapshot of current SQLite state. It checks the active
marker against retained cutover evidence, preserves imported task identity and
event history, applies shared domain validators and verifies referenced object
bytes. Newly created tasks need not equal the original snapshot. It does not
restore or overwrite current state. Published source-partition validation allows
new immutable objects only at canonical SHA-256 paths whose bytes match the name.
Captured attachment files/directories must remain intact, and unmanaged additions
are refused. Unreferenced content-addressed objects are retained, consistent with
the no-automatic-deletion policy. Full crash recovery coverage and bounded large-ledger audit memory remain
unfinished.


The public `storage-migrate --destination <new-directory> --writers-quiesced`
command runs initial preparation, staging, archival, activation and terminal
verification under one maintenance owner. The destination is project-relative
and must be new, with an existing parent. The flag asserts that the operator has
stopped all writers, including old clients; it does not stop those processes.
Success returns `PUBLISHED` and `currentStateVerified` and releases exclusion.
Failures retain exclusion and original/captured evidence. Resume is available
only for the verified publication stages described below; retrying the initial
command is not a recovery procedure.
This initial command does not establish the full migration plan's acceptance.


`storage-migration-resume --destination <retained-directory> --expected-owner
<uuid> --writers-quiesced` adopts only the exact retained dead local owner,
archives its original bytes and preserves exclusion throughout recovery. It
revalidates retained candidate, source partitions and publication bundle before
continuing STAGED/ARCHIVING archival or ARCHIVED activation. For PUBLISHED it
verifies current state without restoring or rewinding accepted writes. Success
releases exclusion; refusal retains the newly adopted owner, which must be
inspected before any further recovery. Unrecorded capture and interrupted owner handoffs still require future recovery
work. SIGKILL fixture coverage proves durable STAGED, ARCHIVED and PUBLISHED
boundaries on macOS/Node 24, not every write window or power-loss/platform behavior.


Resume also handles a verified PREPARED candidate before publication begins,
an empty publication directory left by its allocation, and identified STAGING or
FAILED publication attempts bound to that candidate. It first requires unchanged
active sources, complete attachment coverage and the absence of both a storage
marker and active database. Existing partial stage bytes are moved intact into
an exclusively allocated `publication-history/<uuid>/publication` directory;
a fresh stage is then constructed from the verified candidate. A missing journal
in a nonempty publication directory, an unsupported identity, changed bindings,
failed source validation or evidence of cutover prevents rebuilding. Recorded incomplete capture can resume only while its original inventory is unchanged. Tests construct partial stage layouts
and kill their actual owner; they do not yet inject a crash during every native
backup or atomic journal-write window.


Candidate recovery now begins from a completely verified CAPTURED source,
including a capture completed before candidate preparation starts. PREPARING or
FAILED candidate attempts must match that capture's source fingerprint, with no
publication stage, storage marker or active database. Before moving files it
persists `candidate-recovery.json`, listing the exact candidate files and an
owned history UUID. Resume derives each file's active/history location, refuses
missing or duplicate locations and unexpected history entries, and continues
interrupted moves. Original candidate/sidecar/parity/inventory bytes remain under
`candidate-history/<uuid>/`; the intent becomes a retained recovery receipt
before fresh candidate construction. The existing shared schemas, domain
validators, integrity, source parity and independent round-trip checks must pass
again. Unbound candidate files are refused. SIGKILL fixtures cover a complete
capture, constructed PREPARING state and a partially completed recovery move;
full native import interruption and all atomic-write windows remain unverified.


Recorded CAPTURING/FAILED source capture now resumes before candidate recovery.
The recorded files/directories must equal the current active source inventory,
and idle legacy locks/transactions, candidate publication and storage markers are
checked before copying. Existing valid copies are reused; missing files are
copied exclusively; mismatched partial copies are moved intact into an exclusive
`source-history/<uuid>/partial/...` path before copying from the unchanged source.
The prior manifest is retained with that history attempt. Missing copies left
by an interrupted recovery are completed on the next attempt. Unrecorded partial
entries are refused, including entries outside the known source roots, which
completed-capture verification now also detects. Final source and capture
inventories must both match before CAPTURED is published. Manifest reads require
regular UTF-8 JSON, are capped at 64 MiB/500,000 array entries and retain the
standard depth/string/object bounds; this ceiling does not establish the full
large-scale performance or memory acceptance. A capture without its recorded
inventory is still refused. SIGKILL fixtures use constructed missing/partial
capture layouts; every copy/write window and power-loss behavior remain unverified.


SQLite work now admits a candidate minimum of Node 24.19.0, selected from the
locally tested Node 24.19.0 / SQLite 3.53.3 / macOS arm64 runtime. Earlier Node
versions are rejected with `E_STORAGE_UNSUPPORTED_RUNTIME` before driver loading
or storage-file creation. The single built-in driver loads lazily and requires
both `DatabaseSync` and native `backup`; module import does not open or require
SQLite. Snapshot and database backup use the same admission boundary. Version
comparison admits later versions, but does not certify every admitted release.
Package engines and minimum platform workflow definitions are now aligned.
Breaking-release metadata, hosted platform results, SQLite fix review, package
startup measurement and release acceptance remain unfinished. The official runtime documentation fetch was unavailable during this
increment; no external SQLite-fix coverage claim follows from these local checks.


`protocol-info --json` and integration/MCP capabilities now share the versioned
`features.operationalStorage` declaration. It reports SQLite format/version,
schema/version, canonical path, built-in driver and candidate minimum Node, plus
explicit migration/quiescence/recorded-inventory requirements and database or
referenced-attachment backup support. This is package capability metadata, not a
probe of the current project or proof of platform compatibility. It explicitly
reports `defaultBackend: sqlite` for ordinary fresh writable dispatch while
retaining `soleSQLiteWriter: false` until remaining direct filesystem writers
and temporary adapters are removed. Metadata reads do not load SQLite, open a
project database or mutate project state; each caller receives an independent
object. Existing human `protocol-info` output remains unchanged.

Fresh mutating dispatch publishes an empty database through the verified restore
journal and retains its independent seed for recovery. Read-only and dry-run
dispatch never bootstrap a missing database. Existing legacy operational state
requires explicit migration before ordinary mutation; it is not converted during
command dispatch. The retained seed and journal are maintenance evidence, not a
writable mirror of later operational records. Bootstrap does not yet prove the
full old-client exclusion or platform interruption matrix required by the plan.


Persistent core hosts can use `createForgeLoopContext({ persistentStorage: true })`
and pass that same context out-of-band to commands and integration resource reads.
They must await `runtimeContext.close()` at host shutdown. The context lazily owns
one connection per canonical real project path. Compatible consecutive operations
reuse the handle; changing read-only/writable mode closes and reopens it. Leases
serialize callbacks for that project, retaining physical read-only enforcement
and preventing mode races, while every command gets a fresh operational scope.
They hold no SQLite transaction between commands. Other projects and independent
processes remain outside that queue. Warm single-process command concurrency and
external-action latency must still be measured against the original acceptance.

Before every lease, normal maintenance/marker/mixed-layout checks run; database
inode/device and current storage metadata are revalidated before reuse. Missing
previously selected storage cannot fall back to filesystem writes. A callback
that leaks a native transaction fails and its connection is closed. Shutdown
rejects new work, drains admitted leases and closes handles; calling shutdown from
inside a lease is refused to avoid deadlock. CLI and callers without the option
retain their per-command open/close behavior.

MCP tools and resources share a default server-owned storage context, closed by
server shutdown. Stateless HTTP product instances share one handler-owned context,
closed by handler shutdown, without sharing session authority. A supplied storage
context must have NONE authority; trusted MCP authority still enters exclusively
through `authorityContextProvider`. Embedded MCP tests instrument native opens to
prove tool/resource handle reuse and shutdown closure. These tests do not prove
packed-core/stdio startup or all platform/transport lifetime behavior.


Connection ownership resolves the real project path before selecting its cache
entry, so allowed parent-path aliases share one handle and queue. Requests are
registered as admitted before asynchronous resolution; shutdown waits for those
requests as well as established leases. Live owner scopes reject nested ownership
and in-lease shutdown, while completed scopes no longer appear live to delayed
shutdown callbacks. The existing prohibition on a symlink project root remains
unchanged; canonical ownership does not relax filesystem containment checks.


A lightweight core registry now defers importing the connection-owner
implementation until a persistent context actually starts work. Context creation
and the default legacy command path do not load that implementation. Admission
is tracked during both lazy initialization and canonical path resolution; shutdown
drains both phases and still refuses an active in-lease close. The strict legacy
import-boundary regression remains enabled without adding a module exemption.


Candidate attachment coverage now derives from canonical `attachment_references`
rows after import. Every reference must match a captured object's exact path,
size and SHA-256; publication coverage is VERIFIED only when every captured
attachment file is covered by those bindings. Portable export-index references
therefore survive import, cutover and referenced-attachment backup/restore.
Unmapped captured objects or legacy raw signature files remain retained and
NOT_VERIFIED, preventing publication until their references are explicitly
mapped. No blob is deleted to satisfy coverage. This implements canonical
portable-reference coverage, not the remaining legacy signature/path-consumer
migration or production restore activation.


Prepared SQLite mutations now expose `transaction.stageAttachment({ referenceId,
readable })`. It publishes and verifies immutable bytes outside the native writer,
binds the reference to the transaction's task ID, and stages its canonical row.
That row commits with other task artifacts/events in the same short transaction.
A conflicting immutable identity rolls all database mutations back; published
unreferenced bytes are retained. Duplicate staged identities cannot name different
bytes. Expired asynchronous preparation cannot insert a late reference. This is
the atomic integration primitive for signing; Sigstore command wiring and legacy
signature reference migration are still unfinished.

## Metadata read limits

Portable import and signature candidate preparation read `export-index.json`
through a shared regular-file reader. It checks the open file's size before
allocating content, caps streamed growth at 64 MiB, requires valid UTF-8 and
applies JSON structure limits (including at most 500,000 entries per array).
Oversized catalogs are refused rather than truncated or partially imported.
Import reports the rejection through `E_STORAGE_IMPORT_ABORTED`, preserving the
underlying `JSON_LIMIT_EXCEEDED` diagnostic and source bytes. The exclusive
unpublished destination remains empty when this prevalidation fails.

Backup verification and fresh backup-directory restore use the same reader with
the ordinary 2 MiB JSON limit for their small manifests. Invalid metadata cannot
allocate a restore destination. These caps bound these metadata reads; they do
not establish streaming task inventories, export catalogs or ledger validation,
and fresh backup-directory restore does not activate a production project.

Source and archived-source inventory discovery now iterate directory entries
instead of loading each directory's complete name list. Each recorded entry
reserves encoded bytes plus serialization overhead against the 64 MiB manifest
budget, and each array has the same 500,000-entry ceiling. Limits are enforced
before retaining an entry; the final arrays are sorted for deterministic capture
and comparison. Source-manifest reopening uses the bounded open-file reader too.
Discovery still retains the bounded inventory arrays, and these limits do not
replace the required large-workload memory/performance measurements.

Portable project export iterates task IDs and retains only each task's small
catalog entry, rather than retaining every exported task manifest. Catalog entry
arrays and encoded bytes have the importer's limits; export checks the final
serialized catalog before publishing `export-index.json`. Refused exports retain
partial output for diagnosis and do not mutate canonical source storage. The
returned catalog remains a bounded in-memory object; fully streaming exports and
large-workload RSS acceptance remain unverified.

## Fresh-project restore activation

The storage API `restoreProjectStorageToFreshProject(source, target,
{ writersQuiesced: true })` verifies a referenced-attachment backup, takes owned
maintenance exclusion and retains an independent snapshot under
`.forgeloop/storage-restores/<operation-id>/snapshot`. It refuses any existing operational
SQLite/legacy state or storage marker. Shared domain/schema validation, an
independent database backup, verified attachment publication and canonical parity
checks precede activation through the storage-version marker. Normal project
dispatch can then read the restored SQLite tasks. Source backup verification is
repeated after staging; changed manifest bindings or canonical rows are refused.

This API restores into an operationally fresh project. It does not replace an
active project or complete interrupted-restore
recovery. Failure retains maintenance exclusion and snapshot evidence; ordinary
dispatch remains blocked rather than falling back over partial publication.
The original backup and retained snapshot are not automatically deleted.

Each restore operation retains `restore-journal.json` beside its snapshot. The
journal records the operation/maintenance-owner identity, source path and
manifest fingerprint before snapshot creation (`PREPARING`). After source
rechecking and shared validation it records the snapshot fingerprint and marker
binding (`READY`), then records publication intent (`PUBLISHING`) before the
pending marker. It records `ACTIVE` only after activation. Failed preparation
does not receive an activation binding. These records establish recovery
identity; automatic resume and process-termination coverage remain unfinished.

`verifyProjectRestoreJournal(target, operationId, { expectedOwnerId })` reads only
the explicitly selected UUID and uses bounded metadata reads. It rejects invalid
owner/source/phase fields, preparation records with activation bindings,
phase/marker disagreement and mismatched operation/schema/inventory bindings.
For validated phases it independently verifies the retained snapshot manifest,
database and referenced attachment bytes. `snapshotVerified: false` for
PREPARING explicitly distinguishes retained evidence from validated state.
Restore invokes verification before publication and after ACTIVE journaling.
This verifier does not adopt an owner, resume publication or verify all current
post-restore state; automatic recovery remains pending.

`resumeReadyProjectStorageRestore(target, { operationId, expectedOwnerId,
writersQuiesced: true })` now supports the validated READY checkpoint before
publication. It independently verifies the selected journal/snapshot, refuses
existing active operational state and uses maintenance's exact dead-local-owner
adoption. The journal is rechecked after adoption, bound to the new owner and
published through the same validated activation path as a fresh restore. A live
owner cannot be adopted. PREPARING, PUBLISHING and ACTIVE checkpoints remain
refused by this resume API; publication-window reconciliation is unfinished.
The SIGKILL fixture constructs a READY checkpoint with real snapshot/domain
APIs and then kills that owned worker. It does not kill inside a native backup,
object write or marker publication.

The general `resumeProjectStorageRestore` API additionally reconciles a validated
PUBLISHING journal. It verifies that live attachment membership contains only
objects bound to the retained snapshot, verifies every present object's bytes,
and refuses any legacy operational state. An existing database must have exact
canonical parity with the retained snapshot; it is never overwritten. Missing
database creation is allowed before ACTIVE only. An already ACTIVE marker
requires its database and verified live attachments, so missing published state
is not recreated from an older snapshot. Changed accepted state is refused and
retained rather than rewound. Private incomplete-copy evidence is retained.

Owned SIGKILL fixtures cover pending marker, completed object/database
publication and ACTIVE marker before terminal journaling, plus refusal of
unbound objects and a later canonical reference. These fixtures construct
checkpoints using actual publication APIs; they do not establish every native
write/fsync/power-loss window. PREPARING and terminal ACTIVE journal recovery,
active-project replacement and PREPARING recovery remain unfinished.

Terminal ACTIVE journal recovery now verifies current state rather than
republishing the retained snapshot. `verifyActiveProjectRestore` makes an
independent native snapshot of current SQLite state, validates shared domain
schemas/ledger evidence and verifies every current referenced object's bytes.
It requires all original task identities, exact original event-history prefixes
and immutable attachment bindings to remain present. Valid later tasks,
mutations and references are permitted; the result reports `restored: false`.
The same continuity helper now strengthens terminal migration validation too.

General restore resume supports ACTIVE journals through confirmed dead-owner
adoption followed by this verifier. It changes owner bookkeeping and releases
maintenance after successful verification, without replacing database/object
bytes. A constructed terminal SIGKILL fixture retains a later accepted
reference, and removal of an original reference is refused. PREPARING recovery,
all native publication/handoff windows, active-project replacement and CLI
integration remain unfinished.

Fresh-project restore is now available through `storage-restore --source <backup>
--writers-quiesced`, using `--path` to select the target project. Source paths may
be absolute or relative to the target. CLI and shared command dispatch use the
same storage service, canonical input validation and maintenance risk class.
Ordinary project-store selection is bypassed for this explicit maintenance
command, so existing operational state is diagnosed by restore's refusal rules.
Generated CLI help/options and shell completions include the command.
Active-project replacement and PREPARING recovery remain pending.

`storage-restore-resume --operation <restore-uuid> --expected-owner <owner-uuid>
--writers-quiesced` now exposes validated READY/PUBLISHING/ACTIVE recovery
through CLI and shared dispatch. It bypasses ordinary store selection only for
this explicit maintenance command, so retained exclusion can be reconciled by
the owner-aware service. Canonical input validation requires both UUIDs and
writer exclusion; integration policy treats the command as maintenance.
Preterminal publication and terminal verification results explicitly report
currentStateVerified after their checks. Tests exercise actual CLI/shared
recovery following owned SIGKILL, plus live-owner and missing-input refusals.
Incomplete PREPARING recovery and active-project replacement are still unsupported.

Completed retained backups in PREPARING can now be resumed. After exact
dead-owner adoption, recovery verifies the original source backup against the
journal's source fingerprint, compares canonical source/snapshot rows and runs
shared domain validation before recording READY and its activation binding.
Changed or unavailable source evidence is refused; no marker is published and
the independent retained snapshot survives. Incomplete or missing snapshot
backups are still refused rather than overwritten. Constructed owned SIGKILL
tests cover completed preparation and changed-source refusal; rebuild recovery
for interrupted snapshot creation remains unfinished.

Focused embedded MCP checks against the worktree's current core verify restore
command maintenance exposure: both commands are hidden in readonly/safe/full
without explicit maintenance enablement, and full maintenance handlers retain
canonical UUID/writer-exclusion input gates. Actor-supplied authority fields do
not make malformed requests allocate project storage. Existing authority,
capability, storage-context isolation and readonly handle-reuse tests also pass.
These checks use a local core resolver and do not prove packed or stdio behavior.

Initial missing/incomplete restore snapshots can now be rebuilt from their
verified recorded source. Recovery persists a UUID-bound RETAINING intent
before moving a partial snapshot into snapshot-history/<uuid>, then records
RETAINED before allocating a new snapshot. It reconciles either side of the
rename and refuses ambiguous duplicate/missing membership. Original partial
bytes are retained rather than deleted or reused as authoritative input.
Source and domain/parity validation still precede READY. If rebuilding itself
is interrupted and leaves another incomplete replacement snapshot, recovery
currently refuses further automatic rebuild; repeated-cycle retention and all
native write/owner-handoff windows remain unfinished. Constructed owned SIGKILL
tests cover initial partial/missing snapshots and both rename-intent locations.

Interrupted replacement snapshots can now start another retained rebuild cycle.
Recovery exclusively publishes the completed prior intent as a small record
under snapshot-intents/<uuid>.json, checks an existing record for exact agreement,
and records a new history UUID before moving the replacement tree. Both original
partial trees survive; the live journal keeps only the current intent rather
than an accumulated history array. Record publication uses synced temporary
bytes and an exclusive hard link, so a final record is never overwritten or
published partially. Conflicting records are refused without altering them.
Constructed owned SIGKILL tests cover repeated-cycle retention/conflict refusal;
native write/fsync/power-loss and all owner-handoff windows remain unverified.

Native integrity diagnostics now consume PRAGMA results incrementally, retaining
at most 100 integrity and 100 foreign-key findings. When native output exceeds
that limit, `truncatedFindings` reports total and retained counts; all returned
rows are consumed and any violation still rejects integrity. A native fixture
with 257 foreign-key violations verifies the bounded report and exact count.
This limits diagnostic retention only; full ledger/export memory acceptance
remains pending.

Task export now consumes artifacts, actions, approvals and executions through
native ordered iterators, decoding one requested payload at a time. Existing
list APIs remain array-returning wrappers for callers that need that contract.
Ledger output already streams. Export still retains manifest/catalog identities;
this change does not prove the original whole-operation RSS budget.

Task export also iterates claims into the manifest under the same 64 MiB
metadata and 500,000-entry limits used for storage catalogs. File entries reserve
budget before publication, and the final manifest is validated before writing.
Oversized identity metadata rejects export with JSON_LIMIT_EXCEEDED; source
state remains unchanged. These limits bound retained metadata, not total RSS or
the maximum size of one decoded artifact payload.

### Active-project replacement preparation

The internal replacement preparation boundary requires explicit writer
quiescence, a live maintenance owner, an ACTIVE storage marker, current schema,
valid outgoing domain evidence, and no retained operation reservations or mixed
legacy operational roots. It retains an independent database/attachment backup
and binds it to the outgoing logical snapshot, closed database bytes, marker,
and attachment inventory, including unreferenced objects that must be preserved
by later archival. Open SQLite connections prevent READY preparation.

Before any later archival, the outgoing active layout must still match these
bindings and its referenced attachment bytes must verify. Preparation does
not archive, overwrite or activate replacement state. A subsequent internal
archival stage validates the incoming snapshot, binds both datasets, and moves
the exact outgoing marker, attachments and database into retained archival
paths. Actual SIGKILL tests cover each rename and terminal archival; recovery
checks physical membership and refuses duplication or changed bytes. Admission
exclusion remains held even when archival returns or fails, until a terminal
publication validator permits release.

`storage-restore --source <backup> --replace-active --writers-quiesced --json`
explicitly selects active replacement. The default restore still requires an
operationally fresh target. Stop all writers, including older clients, and close
their SQLite connections before asserting writer quiescence. Outgoing authority
is independently backed up and archived before incoming publication. Retained
evidence remains under `.forgeloop/storage-restores/<operation-uuid>`.

`storage-restore-resume --operation <uuid> --expected-owner <uuid>
--replace-active --writers-quiesced --json` selects the exact replacement and
delegates to its recorded preparation or publication stage. It verifies owner
history, incoming snapshot bindings and retained outgoing evidence. Conflicting
evidence, live owners and retained handoff locks are refused. Native SIGKILL
controls establish selected local process recovery windows; earliest intent,
handoff-lock, power-loss and hosted platform acceptance remain incomplete.


## Owner-bound maintenance handoff (increment210)

A resume archives the already durable owner marker by a non-replacing hard link.
It writes and syncs a complete new owner intent under
`.forgeloop/storage-maintenance-history/handoff-intents/<owner-id>.json`, then
atomically links that intent to `handoffs/<predecessor-owner-id>.json`. The claim
binds the exact original owner bytes by SHA-256. Two contenders cannot create
that same immutable successor. A live claimant blocks adoption; a dead local
claimant permits following its exact successor identity, bounded to64 entries.
Claims are never removed and recycled during contention.

Owner promotion is staged under the history's `handoff-promotions/` directory
and renamed into `.forgeloop/.storage-maintenance/owner.json`. A process kill
before promotion leaves the original owner and a complete recoverable claim;
a kill after promotion leaves the new owner and its predecessor archive.
Promotion scratch stays outside the exclusion directory. Histories, unused
intents and interrupted promotion files are retained as evidence rather than
being automatically deleted. Filesystem hard-link/rename support is required;
there is no weaker copy or lock-removal fallback.

Native macOS SIGKILL checks pass at claim publication, immediately before owner
promotion and immediately after promotion. They verify retained exclusion and
exact subsequent dead-owner recovery. Independent-process contention accepts
exactly one callback; live claimants and tampered/foreign/cyclic records refuse
recovery while preserving source owner and evidence bytes. These checks do not
prove power-loss durability, initial exclusion creation windows or all supported
platforms. Unbound legacy handoff directories still require explicit operator
reconciliation.

### Direct task transaction entry point

A direct `withTaskTransaction` call on an existing SQLite project now opens the
canonical project storage boundary when no operational scope is already active.
It therefore uses the same marker, maintenance, containment and legacy-coexistence
checks as command dispatch, and publishes through the native unit of work.
Rollback preserves the previous canonical records; no filesystem `.txn` staging
is allocated. A retained marker with a missing database refuses the callback
instead of selecting filesystem persistence. This does not retire the remaining
legacy-only fixture/reconciliation writer implementation.

### Direct artifact access on existing native projects

Direct JSON artifact, task descriptor and work-state access now opens existing
native authority through the canonical project boundary when no scope is active.
Work-state and continuity clears do the same. Work-state writes infer the
canonical task path from the state task identity when no path is supplied.
Dry-run writes use a read-only connection and retain current records.

Native projects reject writable singleton aliases, unrecognized task/session
namespace paths and generic attempts to overwrite the database, sidecars or
storage marker, including normalized path variants. Configuration and sources
remain filesystem-owned. Missing databases with retained markers, and orphan
WAL/SHM evidence, refuse filesystem fallback. These entry points do not bootstrap
fresh projects or implicitly migrate legacy data. Other direct readers/writers
and legacy implementation retirement still need separate review.

Native task mutations now require a resolved task. In particular, routing on an
empty native project refuses with `E_TASK_REQUIRED` instead of publishing a
singleton routing-result file. Task selection retains explicit/environment and
unambiguous-existing-task behavior; no task is created implicitly.

Existing-project access carries an internal `existingOnly` admission constraint.
If an unmarked database disappears after selection but before the project
boundary checks it, read-only and writable access both refuse before invoking the
callback. They cannot reinterpret that loss as fresh-project bootstrap. Ordinary
fresh command dispatch retains explicit bootstrap behavior. This covers that
selection-to-admission gap; it is not evidence for all file replacement or
power-loss windows during driver opening.


## Current known unsupported topology admission

Before opening SQLite or bootstrapping a fresh writable store, the runtime
rejects Windows UNC network-share paths, including extended UNC forms, and
known Linux network filesystem types reported by statfs: NFS, SMB/CIFS/SMB2,
AFS, Coda, Ceph and 9P. Linux type identifiers come from the
[Linux UAPI magic.h](https://github.com/torvalds/linux/blob/master/include/uapi/linux/magic.h).
A missing database is inspected through its nearest existing ancestor; that
inspection does not create directories, database files or sidecars. There is
no actor-supplied override and no automatic journal-mode fallback.

This deny-list does not certify every other filesystem. FUSE may wrap remote
storage, Windows mapped drives may hide a network share, and Darwin filesystem
IDs are dynamically assigned. Their supported topology needs independent
mount/runtime evidence; Linux numeric identifiers must not be applied to macOS.
Actual network-mount, mapped-drive and crash/power-loss acceptance remains
unverified. Successful WAL/FULL pragma checks alone do not establish suitability.

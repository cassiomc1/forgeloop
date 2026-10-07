# ForgeLoop SQLite Migration Plan

**Goal:** improve performance and reduce maintained persistence code by moving machine-managed operational data into SQLite.

**Repository:** [cassiomc1/forgeloop](https://github.com/cassiomc1/forgeloop)\
**Analysis baseline:** `ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5` (`main`, package version `1.14.0`)\
**Prepared:** September 30, 2026\
**Status:** proposed implementation plan, based on static source inspection. No migration, benchmark, or implementation has been performed. Reconcile this plan against the implementation checkout before starting.

## 1. Recommended decision

Use one authoritative SQLite database at `.forgeloop/state.sqlite` per existing ForgeLoop project-state root. Move task state, event history, claims, actions, approvals, execution records, and other machine-managed task artifacts into it. Keep human-edited project configuration and policy inputs as files. Preserve JSON/NDJSON as versioned import/export formats.

The primary architectural benefit is committing related operational records together while removing the custom filesystem transaction machinery. Indexed reads should improve discovery and lookup workloads; actual gains must be measured with existing validation semantics enabled.

The final design should have one production storage implementation. A filesystem reader is needed for migration and compatibility tooling, but a permanent pair of interchangeable writable backends would undermine the code-reduction goal.

### Decisions to carry into implementation

| Topic | Recommended choice | Reason |
| --- | --- | --- |
| Database boundary | One database per current state root | Enables atomic task/claim/event operations without cross-database coordination |
| Runtime | A breaking release targeting a tested Node 24-or-newer baseline and built-in `node:sqlite` | Avoids adding a native addon, its packaging, and a second driver path |
| Compatibility exception | If Node 20 support is mandatory, choose one compatible driver instead | The current package declares Node `>=20`; changing that is a release decision, not a transparent optimization |
| Query layer | Small, explicit storage modules with prepared SQL | Avoids ORM models and a generic repository framework |
| Data representation | Indexed relational fields plus schema-validated JSON payloads | Preserves protocol structure without normalizing every nested object |
| Transactions | Short synchronous database transactions | Fits `DatabaseSync` and avoids holding locks across external work |
| Evidence interchange | Deterministic, explicit JSON/NDJSON exports | Keeps external audit and integration workflows portable |
| Rollout | Temporary development adapter, one controlled production cutover | Enables parity checks without permanent dual writes |

Select the exact minimum Node patch and bundled SQLite version during the compatibility spike. Verify the APIs used, supported operating systems, and applicable SQLite fixes against that exact runtime. Do not select a runtime merely because `node:sqlite` is present.

## 2. Source findings that motivate the work

1. **Task lookup expands into project-wide discovery.** `findTaskById()` in `src/core/task-discovery.js` calls `discoverTasks()`, which traverses task directories and loads descriptors, work state, locks, continuity/receipt presence, and claim projections. `collectTaskClaimEvidence()` in `src/core/task-claim-state.js` validates each task's event ledger.
2. **Idempotency lookup scans action files.** `findActionByIdempotencyKey()` in `src/core/actions.js` enumerates and reads task actions before searching the resulting array. Approval listing uses a similar filesystem pattern.
3. **The project maintains a database-like transaction implementation.** `src/core/transaction.js` implements staging, manifests, backups, append rollback, ordered publication, and incomplete-transaction recovery. `src/core/transaction-maintenance.js` adds cleanup and compaction.
4. **Optimistic concurrency is already part of the domain.** `mutateWorkState()` checks `expectedRevision`; actions also have revision checks. Preserve these semantics with conditional SQL updates.
5. **The event tail already has an optimization.** `readEventTail()` and the checkpoint index reduce tail-read work. `tests/scale-ledger.test.js` exercises a 100,000-event tail. This is evidence of existing coverage, not a benchmark proving the whole ledger scales cheaply.
6. **Files are part of the public protocol surface.** `src/core/artifact-registry.js` declares artifact paths, ownership, mutability, and trust roles. Moving persistence requires an explicit storage-format compatibility boundary.
7. **The decision cache is currently in memory.** `src/core/decision/cache.js` uses a `Map`. Making it persistent would be a new feature, not a file-to-database migration; defer it unless measured reuse justifies it.

## 3. Migration scope

### Move into SQLite

Paths below are relative to a task's current `.forgeloop/task-state/<task-key>/` directory unless otherwise specified.

| Current data | Proposed storage | Priority and treatment |
| --- | --- | --- |
| `task.json`, `work-state.json` | `tasks` and task artifact records | First: direct lookup, phase filtering, revision checks |
| Write claims and `recovery.json` | `claims`, recovery artifact, canonical events | First: conflict checking and ownership updates in the same transaction |
| `events.ndjson` | `events` | First, together with state; preserve every event and its chain |
| `events.ndjson.index.json` | Indexed event ordering/head lookup | Remove the sidecar after cutover |
| `actions/*.json` | `actions` | First: indexed idempotency and state transitions |
| `approvals/*.json` | `approvals` | First: action binding and single-decision semantics |
| `executions/*.json` | `executions` | Next: direct lookup and filtering by task/check/cycle |
| `contract.json`, `routing-result.json`, `preflight.json`, gates, policy snapshots | `task_artifacts` | Store accepted canonical versions; keep explicit import/export and revision commands |
| `continuity.json`, workspace binding, responsibility, verification scope | `task_artifacts` | Preserve their distinct authority and mutability rules |
| Receipts, handoffs, evaluations, semantic decisions, structural-quality records, attestations | `task_artifacts` | Store small structured payloads, fingerprints, and immutable identities |
| `usage.json`, `test-utility.json` | `task_artifacts`, with narrow indexes only if needed | Avoid a separate telemetry subsystem in the first release |
| Session activation markers under `.forgeloop/sessions/` | `sessions`, if all readers are migrated | Audit adapter dependencies before removing marker files |
| `.forgeloop/.txn` metadata | SQLite transaction handling | Delete normal-path staging, backups, manifests, recovery scans, and compaction |

Move related state and its audit event as one unit. Moving only `work-state.json` while leaving the canonical ledger writable on disk would retain the hardest consistency problem.

### Keep as files

| Data | Why it stays outside the database |
| --- | --- |
| `config.json`, project policy rules/capabilities, baseline, `policy.lock`, source registry | Human-editable or reviewable project inputs; continue validating and fingerprinting them |
| Guides, templates, JSON schemas, package/install manifests | Distributed source assets and installation metadata |
| Source code and Git metadata | Remain owned by the repository and revision provider |
| Screenshots, large logs, recordings, binary attachments | Store file references, sizes, and digests in SQLite; avoid unnecessary database growth |
| Exported receipts, bundles, statements, signatures, NDJSON ledgers | Deliberate interchange artifacts generated from a consistent snapshot |
| tgrep index and engine lifecycle files | Owned by the existing search engine integration; a separate migration would expand scope |
| Transport sockets, endpoint files, bootstrap/migration exclusion markers | Some consumers must discover or coordinate before a database connection exists |

For accepted contracts and similar structured input, use the database as the canonical operational copy. An exported or edited file changes protocol state only through an explicit command that validates and imports it. Update any existing direct-file-edit workflow accordingly.

## 4. Storage design that minimizes code

Introduce a small `src/storage/` package. Suggested responsibilities are connection/schema management, transaction handling, task/claim queries, event queries, action/approval/execution queries, and generic artifact import/export. Organize by cohesive responsibilities; do not create a class or file for every table.

Domain services continue to own lifecycle transitions, authority, schema checks, fingerprinting, and evidence validation. Storage owns persistence, constraints, ordering, and atomicity. Reuse existing canonical JSON and fingerprint functions.

### Logical schema

| Table | Essential identity and fields | Required access paths |
| --- | --- | --- |
| `storage_meta` | Storage version, protocol compatibility, project identity, import provenance | Singleton |
| `tasks` | `task_id`, unique `task_key`, phase, revision, timestamps, descriptor/state payloads | Primary key; phase/update ordering |
| `claims` | Task, normalized claim, reservation state | Task index; appropriate candidate filtering for overlap checks |
| `events` | Task, sequence, type, timestamp, previous hash, hash, original event JSON | Primary key `(task_id, seq)`; `(task_id, event_type, seq)` |
| `actions` | Task, action ID, idempotency key, status, revision, payload | Primary key `(task_id, action_id)`; task-local idempotency uniqueness; status index |
| `approvals` | Task, approval ID, action binding, decision, payload | Primary key; task/action lookup |
| `executions` | Task, execution ID, check ID, verification cycle, payload | Primary key; task/check/cycle lookup |
| `task_artifacts` | Task, artifact kind, stable artifact ID, payload, fingerprint | Primary key `(task_id, kind, artifact_id)` |
| `sessions` | Session ID, task association if defined, activation payload | Primary key; task lookup where applicable |

Use fixed artifact IDs for replaceable current snapshots and distinct IDs for immutable history. Do not invent revisions for artifacts whose protocol does not define them. Optional artifacts remain absent until created.

Additional indexes require a real query and an `EXPLAIN QUERY PLAN` check. Avoid indexing every payload field. Keep canonical payloads and extracted columns synchronized in one storage operation, and validate their agreement during import and audit. Never allow callers to update the two representations independently.

Use foreign keys for relationships that are mandatory in the actual protocol. Do not fabricate missing task descriptors to satisfy a foreign key during legacy import. Model genuinely supported legacy namespaces explicitly or require the existing repair path before migration. Avoid cascade deletion of audit history.

### Small transaction boundary

The storage transaction helper should execute a synchronous callback, reuse the active connection when nested, and reject a returned Promise. Use `BEGIN IMMEDIATE` for read/check/write operations that must reserve the writer before examining mutable state.

A lifecycle mutation should:

1. Validate inputs and gather external observations before entering the transaction.
2. Recheck the current database revision, ownership, and relevant bindings inside it.
3. Perform a conditional update such as `UPDATE ... WHERE revision = ?`; require exactly one changed row.
4. Insert associated artifacts and the next hash-chained event in that same transaction.
5. Commit; otherwise roll back and preserve the existing domain error semantics.

Do not keep a transaction open while running a checker, browser, network request, signing provider, or child process. For external actions, persist intent/start, commit, perform the operation, then record its observed outcome in another transaction. Preserve `COMMIT_UNKNOWN` and explicit reconciliation; database atomicity does not make external effects exactly-once.

## 5. Concurrency, ownership, and integrity

SQLite serializes database writes. It does not replace the concept of task ownership or a long-running operation reservation.

- Replace short filesystem write locks with database transactions once their protected data is entirely inside SQLite.
- Preserve `claimsOverlap()` semantics. Exact-path uniqueness cannot detect directory, wildcard, or ancestor/descendant conflicts. Check candidate overlaps and reserve claims under the same write transaction.
- Retain operation tokens or leases only for long-running work that requires exclusive ownership outside a transaction. Preserve stale-owner and recovery rules; database connection closure alone must not release a semantic claim.
- Keep database scope aligned with existing project/worktree identity. Do not merge different worktree state roots as an incidental optimization.
- Preserve fail-closed behavior for inconsistent ownership, invalid recoveries, malformed records, stale approvals, and revision conflicts.

### Do not trade away audit guarantees for a faster query

SQLite checksums, foreign keys, and transactions are not replacements for ForgeLoop's event hashes or evidence semantics. Preserve the existing canonical serialization, sequence, hashes, event details, artifact bindings, and chronology. Imported events must not be rehashed or rewritten.

An indexed task summary can accelerate non-authoritative discovery. It must not grant write ownership, mark completion valid, or authorize an action without the validations required by the protocol. If full-ledger validation remains necessary for an operation, keep it and measure its cost honestly.

Incremental validation is a separate optimization with its own threat-model review. A validation cursor stored in the same editable database is not an independent trust anchor. Do not silently trust it after external modification. Preserve tamper tests, including modifications through another SQLite connection. Local hash chains also do not establish protection against a party able to rewrite all local data and hashes; retain existing external attestation boundaries.

### Connection and durability defaults

For a supported local filesystem, begin with WAL mode, foreign keys enabled, `synchronous=FULL`, and a bounded busy timeout consistent with the current five-second transaction wait. Verify effective settings. Keep extension loading disabled and SQL parameters bound.

WAL supports concurrent readers and a writer, but only one writer at a time and not a multi-host network filesystem. Document the supported storage topology and reject known unsupported configurations. If network filesystem support is a product requirement, test a separate supported mode explicitly rather than silently enabling WAL there.

Reuse a connection per project in persistent runtimes; open lazily and close normally for CLI invocations. Start without a pool or a new daemon. Measure event-loop blocking in MCP/HTTP paths before considering a worker boundary. Do not introduce another background service solely for SQLite.

Keep large audit reads bounded in memory. Avoid long reader transactions that unnecessarily delay WAL checkpoints. Preserve filesystem containment and symlink protections for the database, sidecar files, attachments, and exports.

## 6. Public compatibility and exported evidence

Preserve public command output and error meaning wherever possible. Add a storage capability/version to `protocol-info`. Filesystem paths in the artifact registry require an explicit update: distinguish logical artifact identity, canonical storage location, and export-relative path.

Audit every path consumer, including CLI, integration API, MCP resources, validators, bundle generation, CI workflows, examples, conformance fixtures, and documentation. A resource should load its canonical payload through storage rather than assume a JSON file exists.

Preserve existing path strings inside hashed historical payloads as logical legacy references. Resolve them through the storage boundary; do not rewrite history to point at SQLite. New output can expose stable artifact identifiers through a versioned contract.

Export a task or bundle from a consistent read snapshot, with deterministic event ordering and a manifest binding included artifacts. Emit the current portable directory layout where required. Export failure must be reported independently of a successful state mutation. Do not regenerate a complete directory tree after every mutation.

SQLite and attachment files cannot participate in one ordinary atomic transaction. When a new attachment must be committed, write and verify an immutable file first, then commit its database reference. A failed transaction may leave an unreferenced file for explicit maintenance; it must never leave a committed reference to bytes that were not durably published. Do not add automatic deletion in the first release.

## 7. Implementation sequence

### Phase 0 — Establish baselines and compatibility boundaries

- Rebase the source inventory against the chosen implementation commit.
- Inventory filesystem reads/writes and direct artifact-path consumers.
- Run `scripts/benchmark-task-discovery.mjs`, the transaction-maintenance benchmark, CLI startup benchmark, and relevant scale tests.
- Extend workload fixtures with valid historical ledgers, action/approval histories, recovery states, and concurrent clients.
- Establish the Node/SQLite platform matrix and package startup cost.
- Record production persistence LOC and complexity for the modules targeted for replacement.

**Exit:** reproducible baseline results, a compatibility inventory, and a confirmed driver/runtime choice. Do not claim speedups from the static analysis.

### Phase 1 — Add the minimal store and importer

- Add schema migrations, connection settings, prepared statements, and transaction helper.
- Implement import into a temporary database and deterministic export.
- Add a temporary adapter around existing storage entry points for differential tests.
- Validate schema constraints, event ordering, payload/fingerprint parity, and rollback on failure.

**Exit:** representative filesystem fixtures import and export without semantic changes; all malformed fixtures retain the intended rejection behavior.

### Phase 2 — Move the transactional core together

- Move tasks, state, claims, recovery, events, actions, and approvals.
- Replace global discovery for direct task reads with indexed lookup.
- Replace action idempotency scans with indexed lookup and matching uniqueness constraints.
- Commit revisions, action/approval changes, and events atomically.
- Preserve required ownership and evidence validation; benchmark it separately from query time.

**Exit:** domain conformance, concurrent claims, revisions, idempotency, and crash-recovery tests pass on SQLite.

### Phase 3 — Move remaining operational artifacts and integrations

- Move executions and small structured task artifacts through the shared artifact store.
- Adapt receipts, completion, audit/history/trace, handoffs, attestations, and structural-quality flows.
- Route CLI, integration API, and MCP reads through the same implementation.
- Replace session files only after all consumers are covered.
- Add storage doctor, backup, export, and migration-status operations to the existing command model where appropriate.

**Exit:** complete task lifecycles and portable evidence exports work across supported integrations.

### Phase 4 — Cut over and delete obsolete code

- Make SQLite the only writable operational store in the new release.
- Remove the temporary writable filesystem adapter.
- Delete filesystem transaction staging/rollback/recovery and `.txn` compaction from normal operation.
- Delete event sidecar indexes, action/approval directory scans, and per-artifact atomic-write wrappers replaced by storage.
- Simplify short-duration task/project write locks; retain proven long-operation coordination only.
- Keep atomic file writing for configuration, exports, installation, and attachments.
- Update docs, generated references, completion metadata, compatibility declarations, and package checks.

**Exit:** measurable net persistence-code reduction and performance gates pass, with no permanent dual-write path.

### Phase 5 — Optional optimizations supported by measurements

Consider aggregate telemetry indexes, materialized read projections, or persistent decision reuse only after profiling. Each must include invalidation, trust, storage-growth, and deletion costs. Skip features that increase maintained code without solving a demonstrated workload.

## 8. Safe migration and rollback

The migration is an explicit maintenance operation. Never trigger a destructive storage conversion during a read-only command.

1. Run doctor/audit and reconcile incomplete legacy transactions through supported ForgeLoop commands. Refuse an ambiguous source state.
2. Quiesce all writers. A new database lock cannot stop older binaries that only understand file locks; the upgrade procedure must stop and exclude those writers too.
3. Preserve an intact source backup and inventory of counts, identities, revisions, event heads, and fingerprints.
4. Import into a temporary database using the shared validators. Abort on collisions, invalid chains, broken required relationships, or unsupported schema versions. Produce a diagnostic report; do not silently repair evidence.
5. Check logical parity, `integrity_check`, and `foreign_key_check`; export representative tasks and compare with the source.
6. Publish only a fully closed, checkpointed database with no required unshipped WAL contents. Use a small, crash-resumable cutover procedure and an explicit storage-version marker. Define restart behavior at every publication step.
7. Prevent old clients from writing legacy state after cutover. Version-aware refusal is preferred; clients without that capability must be operationally excluded and the old writable layout archived outside the active location.
8. Keep the backup according to an explicit retention policy. Do not delete it automatically on migration success.

Before new writes, rollback can restore the preserved source snapshot. After SQLite has accepted new writes, restoring that snapshot would lose work: use a verified reverse export compatible with the target version or perform a forward repair. Do not advertise unconditional downgrade support.

For ongoing backups, use a supported SQLite snapshot/backup mechanism. Copying only a live `.sqlite` file in WAL mode can omit committed data. Restore drills must include external attachments and their digests.

## 9. Verification and performance acceptance

### Correctness and resilience gates

- Lifecycle, claim ownership, recovery, completion, evidence, and authority semantics remain equivalent.
- Conflicting path claims cannot both succeed; non-conflicting work is not accidentally serialized for its entire external execution.
- Competing revisions produce the existing conflict behavior.
- Duplicate idempotency keys cannot create distinct accepted actions in the same task scope.
- Process termination before, during, and after commit never exposes half of a logical mutation.
- Tampered events, payloads, extracted columns, and artifact bindings remain detectable under the declared threat model.
- Busy, disk-full, read-only, corrupt-database, and interrupted-migration conditions produce explicit recoverable errors.
- Large-ledger reads and exports stay within measured memory budgets.
- Export/import round trips preserve semantic identity and fingerprints.
- Supported Windows, macOS, and Linux combinations pass package and integration checks.

Reuse current transaction, task-lock, project-claims, state-revision, action/approval, scale-ledger, migration, and conformance tests. Preserve their behavioral assertions while replacing tests tied solely to removed implementation details. Follow the repository's required validation tiers for the eventual implementation and PR.

### Benchmark matrix

| Dimension | Suggested coverage |
| --- | --- |
| Tasks | 10, 100, 250, 1,000, and 5,000 |
| Events per selected task | 10, 1,000, and 100,000 with valid chain and realistic event payloads |
| Action volume | Small tasks and tasks with thousands of actions/approvals |
| Operations | Direct lookup, paginated task list, claim reservation, idempotency lookup, state/event commit, history tail, full audit, export |
| Runtime | Fresh CLI process and warm persistent integration |
| Concurrency | 1, 2, 4, and 8 independent processes |
| Measurements | p50/p95 latency, throughput, peak RSS, filesystem operations, lock waits, database/WAL bytes, event-loop delay |

Use representative combinations rather than an unnecessarily huge Cartesian product. Publish seeds, dataset sizes, hardware, runtime version, durability settings, and repetition counts. Compare equal output and validation guarantees. Report cold-process and warm-process results separately; do not call a run filesystem-cold without controlling that condition.

### Proposed release thresholds

These are design targets to approve before measurement, not observed results:

- At least **2x lower p95 latency** for task discovery and action-idempotency lookup on the agreed large-workspace fixtures, or a documented explanation of the remaining validation cost.
- At least **30% lower p95 latency** for representative state-plus-event commits at equal durability.
- No unexplained small-workspace regression beyond **10% or 5 ms, whichever is larger**, including CLI startup.
- At least **25% net reduction in production persistence-related LOC**, counting the new store, retained importer/exporter, compatibility helpers, and maintenance code in the same scope.
- Zero correctness regressions; bounded memory and acceptable writer contention on the agreed concurrency fixtures.

Failing a target triggers investigation and a release decision. It does not justify lowering durability, skipping integrity checks, hiding importer code from the LOC count, or retaining both write backends indefinitely.

## 10. Definition of done

- [ ] SQLite is the sole authoritative operational writer in the migrated release.
- [ ] All related state/event mutations share a database transaction.
- [ ] Protocol validation and public authority boundaries are preserved.
- [ ] Every public file-path dependency has been migrated or explicitly supported through export.
- [ ] Migration, recovery, backup, restore, and supported downgrade boundaries are documented and tested.
- [ ] Legacy write clients cannot operate on the migrated active state layout.
- [ ] Obsolete transaction, index, directory-scan, and compaction code is removed.
- [ ] Performance and code-size comparisons are published with reproducible inputs.
- [ ] CLI, MCP, API, packaging, and platform checks pass.
- [ ] SQLite/runtime compatibility and storage format are advertised explicitly.

## 11. References

Repository sources are pinned to the analyzed commit:

- [Task discovery](https://github.com/cassiomc1/forgeloop/blob/ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5/src/core/task-discovery.js)
- [Claim evidence and ownership](https://github.com/cassiomc1/forgeloop/blob/ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5/src/core/task-claim-state.js)
- [Claim overlap semantics](https://github.com/cassiomc1/forgeloop/blob/ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5/src/core/task-scope.js)
- [Filesystem transactions](https://github.com/cassiomc1/forgeloop/blob/ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5/src/core/transaction.js)
- [Transaction maintenance](https://github.com/cassiomc1/forgeloop/blob/ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5/src/core/transaction-maintenance.js)
- [Task and project locks](https://github.com/cassiomc1/forgeloop/blob/ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5/src/core/task-lock.js)
- [Events and validation](https://github.com/cassiomc1/forgeloop/blob/ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5/src/core/events.js)
- [Work-state revisions](https://github.com/cassiomc1/forgeloop/blob/ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5/src/core/work-state.js)
- [Actions](https://github.com/cassiomc1/forgeloop/blob/ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5/src/core/actions.js)
- [Approvals](https://github.com/cassiomc1/forgeloop/blob/ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5/src/core/approvals.js)
- [Artifact registry](https://github.com/cassiomc1/forgeloop/blob/ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5/src/core/artifact-registry.js)
- [Task discovery benchmark](https://github.com/cassiomc1/forgeloop/blob/ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5/scripts/benchmark-task-discovery.mjs)
- [Ledger scale tests](https://github.com/cassiomc1/forgeloop/blob/ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5/tests/scale-ledger.test.js)
- [Package and runtime declaration](https://github.com/cassiomc1/forgeloop/blob/ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5/package.json)

Primary technical references:

- [Node.js SQLite API and version history](https://nodejs.org/docs/latest-v24.x/api/sqlite.html): built-in API availability and synchronous execution model. Pin implementation decisions to the selected runtime version.
- [SQLite WAL](https://www.sqlite.org/wal.html): reader/writer behavior, filesystem limitations, checkpointing, and durability tradeoffs.
- [SQLite pragmas](https://www.sqlite.org/pragma.html): connection settings, integrity checks, foreign keys, and synchronization.
- [SQLite backup API](https://www.sqlite.org/backup.html): consistent database backup mechanisms.

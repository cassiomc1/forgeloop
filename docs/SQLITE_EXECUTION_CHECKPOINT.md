# SQLite migration execution checkpoint

## Active checkpoint — 2026-10-10

Current platform receipts bind to `000503459f7344b7edb62bd3c1eccd9f8533b07c`. Production remains equivalent to `482ca55`; subsequent changes are tests, benchmark harnesses, workflows and evidence. The official task remains `CORRECTING` with `nextAction=RECONCILE_CLOSURE`. This is partially verified implementation, not validator-backed completion.

- Package/MCP run `38068997930` passed Linux, macOS, Windows Node 24.19.0 and Windows Node 24.21.0. Every package lane passed 88 MCP tests, zero failures or skips, package checks and observed cleanup. Raw logs and terminal receipts are retained under `benchmarks/storage-sqlite/package-0005034-*`.
- Expanded compatibility run `38069000333` passed all seven jobs. Each ran 80 quick and 82 storage tests without failures or skips, plus CLI help and protocol-info. Actual versions include minimum 24.19.0, Windows current 24.21.0 and Linux 26.10.0. This is targeted compatibility, not a full regression or performance result.
- Full prepush on frozen `0005034` failed the first coverage stage: 3,070 tests, 3,052 passed, two failed and 16 skipped; all 3,414 tracked hashes remained unchanged. Both failures asserted the prior package matrix or multiline compatibility command layout. Corrected assertions preserve the expanded matrix and require each command to have its own failure-reporting step. All 19 focused package/workflow tests and fast verification pass. Fresh full prepush remains required.
- The five previously missing same-fixture MCP parity cases now cover task discovery, ownership, handoffs, evaluations and decisions. The passing platform package runs include these strict comparisons. The earlier masked Windows failure remains historical failure evidence, not a passing result.
- Public rollback run `38069883516` is active on `0005034`; inspect terminal logs, artifacts and cleanup before acceptance. Dedicated old-client execution remains pending. No timed benchmark is active at this checkpoint.
- Current inclusive persistence LOC remains 32,908 against baseline 25,732 and the unchanged ceiling 19,299. Scope membership is closed; all storage/import/export/maintenance code remains counted. The 25% target is not achieved. Structural proposals remain unapplied and uncredited until validated and measured.
- Public-domain benchmark fixture and resource evidence still do not establish the full original performance matrix. Baseline 2 MiB refusals remain explicitly non-comparable; preserve dimensions, validation, source manifests, worker/parent completion and cleanup. Prepared external benchmark corrections require review and execution before timing acceptance.
- Complete original Phases 0–4, current consumer/platform/runtime/package and performance/LOC gates, and official `complete=VALID` before opening a PR. No PR, merge, publication or live-state conversion has occurred. Preserve the original checkout and dependency symlinks; do not use Jevgrep.

The entries below are historical checkpoints and must not be treated as current acceptance evidence.

Historical production `eb3a318` validates task and record payload/index identity, projects validated task-list entries, and removes three unused private adapters. All 22 local prepush stages passed on frozen source: 2,976 core tests, 2,965 passed, zero failed, 11 skipped; all 3,131 tracked hashes remained unchanged. The earlier complexity failure at `68cbda9` is retained, and the corrected source passes complexity. Evidence: `benchmarks/storage-sqlite/prepush-eb3a318-success.json` and `benchmarks/storage-sqlite/task-export-projection-eb3a318.json`. Current platform and resource acceptance remain pending. The original complete plan, 25% inclusive LOC target, memory/performance gates and validator-backed closure remain required.

The refreshed inclusive LOC inventory includes the projection enum explicitly and has zero unresolved membership: 25,732 baseline lines versus 32,406 current lines, against the unchanged 19,299 ceiling. The reduction gate fails by 13,107 lines. All storage/import/export/maintenance modules remain included. See `benchmarks/storage-sqlite/persistence-loc-eb3a318-closed.json`; older totals below are historical.

Nested pure-reader scope reuse is now implemented: only a module-owned immutable snapshot with no future commit observations reuses its active operational scope. Writable ancestors retain separate observation scopes. Seventeen focused and nine public-reader tests, fast verification and complexity pass. Memory benefit is unmeasured, and existing full-prepush/platform evidence predates this production change. See `benchmarks/storage-sqlite/nested-read-scope-reuse.json`.

Canonical policy snapshot reads now reject unselected legacy authority and linked paths through the shared artifact reader. Two red controls reproduced the defects; 70 focused tests, fast verification and complexity pass after correction. Missing snapshots remain null and portable inspection preserves bytes. Full prepush `288a563` passed all 22 stages (2,968 core passed, zero failed, 11 skipped) before this correction. Refreshed LOC membership is closed but the original reduction target still fails. See `benchmarks/storage-sqlite/policy-snapshot-authority-correction.json` and `benchmarks/storage-sqlite/prepush-288a563-success.json`.

## Scope and authority

Implement the original `SQLITE_MIGRATION_PLAN.md` through Phases 0–4 and open a PR after all steps pass. Phase 5 optimizations require measured justification. No release publication or live-state conversion is authorized or performed.

Source baseline: `ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5`.
Worktree: `/Users/cassio/.codex/worktrees/sqlite-end-to-end/forgeloop`.
Branch: `codex/sqlite-end-to-end`.
Task: `sqlite-end-to-end-20260930`.
Existing 36 changed files were copied from the original checkout, with hashes preserved in `/tmp/sqlite-original-work-manifest.json`. Original task state was not copied or mutated.

## Threat boundary and design decisions

Treat database contents, imports, paths, exported files, and external observations as untrusted. Reuse schema, hash-chain, artifact-binding, ownership, claim overlap, revision, and authority validators. SQLite constraints supplement domain validation. Bind SQL values and keep extension loading disabled. Verify WAL, foreign keys, FULL synchronization and bounded busy timeout. Never hold transactions across asynchronous external effects. Reject stale revisions, partial evidence and unsupported storage formats. Publish verified immutable attachments before committing references. Migration runs only explicitly, against disposable or specifically authorized projects, with quiesced writers, verified backups, checkpointed publication and interruption recovery. Exclude old writers after cutover. Preserve historical event hashes and legacy logical paths. No independent writable filesystem mirror in the new format.

## Historical verified state

The following retained evidence describes production at `bd2000c`. The [consumer matrix](SQLITE_MIGRATION_MATRIX.md)
separates current boundaries from retained historical evidence. No original
whole-plan definition-of-done item is inferred complete from these results.

- Full local prepush at `5dbb2a2` passed all 22 stages: 2,983 core tests,
  2,972 passed, zero failed, 11 skipped. It predates the bounded legacy reader
  and finite-page collector. Its source observation began during execution;
  tracked files were clean at launch and unchanged from that observation to
  completion. See `benchmarks/storage-sqlite/prepush-5dbb2a2-success.json`.
- Full local prepush at `ab2ea79` failed the fresh read-only module-admission
  control; 2,984 tests, 2,972 passed, one failed, 11 skipped. All 3,152 tracked
  hashes matched the starting manifest. Lazy-import correction `bd2000c` passes
  26 affected tests and fast checks; whole corrected-source validation remains
  required. See `benchmarks/storage-sqlite/prepush-ab2ea79-failure.json`.
- Core CI `38011468995` and expanded Node `38011473602` passed all 17 and seven
  jobs respectively on older `a5faa02`; these do not cover current production.
- Windows full `38011471452` on `a5faa02` failed one historical owner-liveness
  check. Failure-only owner-chain diagnostics were added. Focused Windows
  `38013623698` on `e8273a6` passes 37 tests, zero failures or skips. The earlier
  failure cause remains unproven; full current Windows acceptance remains open.
- The legacy transaction reader now uses the existing 64 MiB catalog limit.
  Oversized retained manifests stay visible as malformed and block migration;
  legacy bytes are unchanged. The correction passes 31 affected controls,
  followed by 26 lazy-import controls. This is not a throughput/RSS result.
- Finite task-list pages retain only the required projected entries while
  auditing every task and preserving totals, ordering, corrupt entries and
  writable-parent CAS. Seventeen affected tests and complexity checks pass;
  current resource acceptance remains unmeasured.
- Inclusive LOC is 25,732 baseline versus 32,423 current, zero unresolved
  membership, against the unchanged 19,299 ceiling. All storage, import/export,
  maintenance and compatibility code remains included. The 25% target fails.
- Original MCP resource benchmark `37922435146` completed on `20aca2b` with
  response parity and retained worker/parent/cleanup evidence. Resource
  acceptance remains false; later production requires fresh paired measurement.
- The task remains `CORRECTING`; official `next` requests `RECONCILE_CLOSURE`.
  Whole-consumer, performance, memory, LOC, platform and validator-backed
  closure remain open. No PR or publication has occurred.
- Do not use Jevgrep. Preserve the worktree, dependency symlinks and original
  checkout changes, and keep the full original plan as the acceptance scope.

## Next actions

1. Consolidate duplicated persistence mechanics without changing error precedence, durability, authority, ownership, snapshot, or CAS semantics; validate each change before committing it.
2. Measure the task-summary projection with matched MCP fixtures and preserve raw parity, memory, sample, source, and cleanup evidence.
3. Close the original LOC target through actual production architecture changes; retain conservative scope membership and all new storage/compatibility code.
4. Run current complete regression, consumer, runtime/package/platform, migration/restore, and performance gates. Reconcile the full original plan against current evidence, obtain official validator-backed closure, then open the PR.

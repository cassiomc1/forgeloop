# SQLite migration execution checkpoint

Current production `eb3a318` validates task and record payload/index identity, projects validated task-list entries, and removes three unused private adapters. All 22 local prepush stages passed on frozen source: 2,976 core tests, 2,965 passed, zero failed, 11 skipped; all 3,131 tracked hashes remained unchanged. The earlier complexity failure at `68cbda9` is retained, and the corrected source passes complexity. Evidence: `benchmarks/storage-sqlite/prepush-eb3a318-success.json` and `benchmarks/storage-sqlite/task-export-projection-eb3a318.json`. Current platform and resource acceptance remain pending. The original complete plan, 25% inclusive LOC target, memory/performance gates and validator-backed closure remain required.

The refreshed inclusive LOC inventory includes the projection enum explicitly and has zero unresolved membership: 25,732 baseline lines versus 32,406 current lines, against the unchanged 19,299 ceiling. The reduction gate fails by 13,107 lines. All storage/import/export/maintenance modules remain included. See `benchmarks/storage-sqlite/persistence-loc-eb3a318-closed.json`; older totals below are historical.

Nested pure-reader scope reuse is now implemented: only a module-owned immutable snapshot with no future commit observations reuses its active operational scope. Writable ancestors retain separate observation scopes. Seventeen focused and nine public-reader tests, fast verification and complexity pass. Memory benefit is unmeasured, and existing full-prepush/platform evidence predates this production change. See `benchmarks/storage-sqlite/nested-read-scope-reuse.json`.

## Scope and authority

Implement the original `SQLITE_MIGRATION_PLAN.md` through Phases 0–4 and open a PR after all steps pass. Phase 5 optimizations require measured justification. No release publication or live-state conversion is authorized or performed.

Source baseline: `ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5`.
Worktree: `/Users/cassio/.codex/worktrees/sqlite-end-to-end/forgeloop`.
Branch: `codex/sqlite-end-to-end`.
Task: `sqlite-end-to-end-20260930`.
Existing 36 changed files were copied from the original checkout, with hashes preserved in `/tmp/sqlite-original-work-manifest.json`. Original task state was not copied or mutated.

## Threat boundary and design decisions

Treat database contents, imports, paths, exported files, and external observations as untrusted. Reuse schema, hash-chain, artifact-binding, ownership, claim overlap, revision, and authority validators. SQLite constraints supplement domain validation. Bind SQL values and keep extension loading disabled. Verify WAL, foreign keys, FULL synchronization and bounded busy timeout. Never hold transactions across asynchronous external effects. Reject stale revisions, partial evidence and unsupported storage formats. Publish verified immutable attachments before committing references. Migration runs only explicitly, against disposable or specifically authorized projects, with quiesced writers, verified backups, checkpointed publication and interruption recovery. Exclude old writers after cutover. Preserve historical event hashes and legacy logical paths. No independent writable filesystem mirror in the new format.

## Current verified state

This checkpoint supersedes the initial foundation-only snapshot; it does not mark any original definition-of-done item complete.

- Node 24.19.0 full prepush at `40328bf` passed all 22 stages: 2,964 core tests, 2,953 passed, zero failed, 11 skipped; clean packed MCP77, PoC67, package12 and Python56 passed. All 3,122 tracked hashes matched the before-start manifest through terminal completion. See `benchmarks/storage-sqlite/prepush-40328bf-success.json`. Three new continuity tests were added afterward with separate focused/fast validation; final whole-source validation remains required.
- Windows run `37998312872` failed on preceding `c89a9db` when a historical owner liveness check refused post-adoption rollback validation. A real killed owner plus simulated post-adoption PID reuse reproduced that mechanism locally. Production `cea6fc2` binds the private death observation to exact archived bytes and the current live adoption scope; changed bytes and expired inherited contexts reject. All 33 focused controls and full local prepush pass. The original Windows cause is not independently observed; corrected-source Windows validation is still required.
- Core `37998303671` passed all 17 jobs and package `37998309000` passed all four jobs on `c89a9db`. Expanded Node run `37998306683` ended with six passing jobs and one macOS 24.19 failure: retained logs show a checkout DNS stall followed by cancellation at the job deadline. No test assertion failure was observed. These older results do not cover the current correction.
- Snapshot consolidation `d8949b0` replaces duplicate discovery and structural-quality admission logic with the existing shared committed-read snapshot boundary. All 38 focused tests, fast verification and full local prepush `40328bf` pass. Current platform validation remains required.
- Commit `47ed1c9` adds three direct continuity controls. Supplied state/contract bindings remain advisory and cannot replace canonical authority or classify as fresh; foreign-task input rejects without changing any table. All 20 focused continuity tests and fast verification pass. Production code is unchanged. This closes the named supplied-context boundary, not complete transitive consumer coverage.
- The inclusive static LOC scope has zero unresolved membership and includes all storage, import/export, maintenance, migration, backup, restore, and attachment modules. Baseline 25,732 lines became 32,507 at `d8949b0`, against the unchanged ceiling of 19,299. The 25% reduction gate fails, with 13,208 lines still to remove. See `benchmarks/storage-sqlite/persistence-loc-d8949b0-closed.json`; the earlier conservative whole-module inventory remains retained separately.
- Runtime `38006398759` and package `38006401000` on `050e501` passed minimum scope only; their platform matrices were skipped because inputs were omitted. Expanded runtime `38007031832` is dispatched with `expanded=true`; full package `38007325350` is dispatched with `full_matrix=true` on `40328bf`. Windows full `38006393854` passed 2,964 tests: 2,940 passed, zero failed, 24 skipped; both adoption controls executed. Core `38006396309` remains nonterminal on older `050e501`. Current full-source/platform acceptance remains open.
- GitHub benchmark run `37922435146`, job `113793330871`, completed successfully on source `20aca2ba332ed86323722ef91812925ad9dadb83`. Its retained parity, sample, worker, parent, and cleanup evidence was inspected. Resource acceptance remains false; newer production revisions require fresh measurement.
- Task-summary projection is implemented with snapshot/CAS and output-parity coverage. Its RSS benefit has not yet been measured.
- The task remains `CORRECTING`; official `next` requests `RECONCILE_CLOSURE` for repository changes. Whole-plan closure is not proven, and no PR has been opened.
- The user explicitly prohibited Jevgrep. Continue with direct source reads and exact searches.

## Next actions

1. Consolidate duplicated persistence mechanics without changing error precedence, durability, authority, ownership, snapshot, or CAS semantics; validate each change before committing it.
2. Measure the task-summary projection with matched MCP fixtures and preserve raw parity, memory, sample, source, and cleanup evidence.
3. Close the original LOC target through actual production architecture changes; retain conservative scope membership and all new storage/compatibility code.
4. Run current complete regression, consumer, runtime/package/platform, migration/restore, and performance gates. Reconcile the full original plan against current evidence, obtain official validator-backed closure, then open the PR.

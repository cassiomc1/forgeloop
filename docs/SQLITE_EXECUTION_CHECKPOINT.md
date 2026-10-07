# SQLite migration execution checkpoint

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

- Foundation and limited diagnosis/advance dispatch exist in the copied work.
- The six existing continuity tests pass on Node 26.10.0/macOS; this does not prove full filesystem parity or the complete migration.
- Existing fixture synthesizes milestone events and suppresses preflight errors. Replace it with a supported-command lifecycle before claiming Phase 2C closure.
- Node 24 compatibility, Linux/Windows, full writer cutover, migration/restore and LOC/performance targets remain unverified.
- Jevgrep discovery reached its bounded request limit; direct source reads are used for verification.

## Next actions

1. Build a real diagnosis fixture with task-create, discovery, contract-create, route, preflight, activation, phase commands and a deterministic failed check.
2. Compare complete filesystem and SQLite prerequisites; close Phase 2C parity, rollback/contention and attempted-I/O gates.
3. Inventory every operational consumer in a migration matrix, then migrate in dependency order through sole-writer cutover and removal.
4. Verify runtime/package/platform, migration/restore, benchmarks and net LOC; complete protocol and open the PR only after the full checklist is evidenced.

# SQLite reverse-export compatibility boundary

The original plan requires preserving accepted work after SQLite writes. Restoring the pre-migration source after such writes would discard work. A current verified reverse export is a different boundary from that source rollback.

## Exact tested target

Portable drill526 passes on Mac, Windows and Docker Linux and uses the clean legacy commit `ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5` and a disposable non-Git canonical fixture. Native protocol validation reports VALID. A real canonical task-create adds a native task before export. The exported layout is switched offline at the same disposable project path, while the complete native layout is retained separately throughout the drill. The pinned old CLI lists the native-created task, reads status and reports VALID for the canonical task. It then creates a new legacy task. The current CLI refuses mutation of this legacy layout with `E_STORAGE_MIGRATION_REQUIRED` and allocates no database. The retained native logical snapshot remains unchanged and contains no legacy-only task.

A relocated export fails old protocol validation because execution artifacts bind the original project root. This is an expected provenance boundary, not permission to rewrite receipts. An incomplete fixture also remains incomplete on both readers; missing evidence is never synthesized to pass compatibility checks.

Git variant529 also passes on all three hosts. It initializes a regular Git checkout before the lifecycle, creates the workspace binding through the canonical command and verifies that the pinned old client recognizes the existing binding at the unchanged project path. Native/old validation, preserved accepted tasks, old writes, current-client refusal and retained native state checks all pass. Linked-worktree topology and attachment-specific boundaries remain separate.

## Reproduce the disposable drill

```sh
node --import=./scripts/test-semantic-provider-loader.mjs scripts/drill-storage-reverse-export-compatibility.mjs --legacy-root=/absolute/path/to/clean/pinned/legacy/checkout --git=true
```

Omit `--git=true` for the separately verified non-Git variant.

The helper only creates disposable fixtures and exports. It does not accept an existing project as its conversion target. It cleans up its own temporary data after checking the retained native snapshot. The legacy checkout is read-only input and must match the pinned commit with no tracked modifications.

## Remaining acceptance and operator limits

This tests one target version and the state/task/provenance boundary on all three requested hosts. Linked Git worktrees, old-target attachment coverage, pre-write source rollback and complete interruption-stage acceptance remain open. It does not establish unrestricted downgrade or support for arbitrary old versions. Production activation requires authority, writer quiescence and operational exclusion of the inactive client generation. Retain the original and current native backups under the explicit manual retention policy. Do not replace accepted native work with the older captured source. Do not run both generations as writers against the same active project, and require explicit migration before reactivating the native client on a legacy export.

Raw commands, negative controls and source hashes: [reverse-export compatibility525](../benchmarks/storage-sqlite/reverse-export-compatibility-525.json) [platform526](../benchmarks/storage-sqlite/reverse-export-platform-526.json) and [Git platform529](../benchmarks/storage-sqlite/reverse-export-git-platform-529.json).

### Binary attachment preservation (checkpoint 530)

The disposable Git-bound drill passed on Mac with `--attachments=true`. It checks the immutable reference against the export catalog and verifies identical binary bytes in the exported, active legacy, and retained native layouts after a legacy task write. See `benchmarks/storage-sqlite/reverse-export-attachments-530.json`. This is preservation evidence; legacy attachment API access and reimport after legacy writes remain unverified. Windows and Docker Linux subsequently passed the identical attachment case at checkpoint 531, with 2,503 source files verified before and after. See `benchmarks/storage-sqlite/reverse-export-attachments-platform-531.json`.

### Linked worktree drill (checkpoint 534)

The linked Git worktree case passes on Mac with attachments. Windows passed the compatibility assertions but failed during Git worktree cleanup; it is not a passing terminal run. Cleanup now removes only the owned disposable worktree with bounded filesystem retries, then prunes its owned repository metadata. The corrected Windows run and Docker Linux linked-worktree case remain pending. Evidence: `benchmarks/storage-sqlite/reverse-export-linked-worktree-534.json`.

Checkpoint 535 reran the corrected cleanup on Windows and Docker Linux. Both runs exited successfully; the workspace binding, legacy protocol validation and task write, binary attachment preservation, retained native logical fingerprint and 2,503-file source identity checks passed. Mac passed the same corrected cleanup at checkpoint 534. See `benchmarks/storage-sqlite/reverse-export-linked-platform-535.json`.

### Reimport after legacy writes (checkpoint 546)

The new `--reimport=true` drill carries the portable `export-index.json` into the active legacy layout so attachment references remain available. Actual migration reimport currently fails: pinned legacy `workspace-bind` appends an event while the per-task `export-manifest.json` retains the earlier event count and digest. The current ledger has 32 events versus the summary’s 31, and migration rejects source/export summary parity. This is a verified compatibility gap, not a passing round trip. The correction must retain historical source metadata and continue to compare the complete current canonical ledger; removing the ledger comparison would weaken acceptance. Evidence: `benchmarks/storage-sqlite/reverse-export-reimport-failure-546.json`.

### Historical summary admission correction (checkpoint 549)

Mac reimport now passes after the legacy workspace binding and task write, preserving the new task and exact binary attachment references/bytes with `VALID` protocol validation. Migration validates the per-task summary’s identity and membership shape, then proves its recorded event count, size and digest describe a complete prefix of the current source ledger. The original summary remains byte-for-byte in the retained source; current task artifacts and the entire current ledger still undergo canonical source/export parity. This treatment applies only to the per-task root `export-manifest.json`, not arbitrary files with that name. Four controls exercise a valid historical prefix and reject altered identity, prefix digest and membership; 14 focused migration tests pass. Windows/Linux correction and reimport remain pending. Evidence: `benchmarks/storage-sqlite/historical-export-reimport-549.json`.

Checkpoint 550 verifies the same correction on Windows and Docker Linux: 14/14 focused tests on each host and successful linked-worktree legacy-write reimport, with the legacy-created task and exact attachment references/bytes preserved and `VALID` protocol state. All 2,505 admitted source files remain unchanged before/after. Together with Mac549 this closes the named reimport drill on all requested hosts. It does not establish universal downgrade or final release acceptance. Evidence: `benchmarks/storage-sqlite/historical-export-reimport-platform-550.json`.

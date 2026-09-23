# Test pruning safety

`test-prune-plan` can return `KEEP`, `REWRITE`, `PROBE_REMOVAL`, or `BLOCKED`.
`PROBE_REMOVAL` requires both protected-test policy and sufficient deterministic
and semantic evidence. Unknown utility is `BLOCKED`.

The safe candidate boundary is an unprotected, high-confidence
`REDUNDANT_CANDIDATE`. Protected tests and low-confidence or ambiguous
recommendations remain `KEEP`/`BLOCKED`. The isolated probe is
non-destructive: it records an observation without editing the live worktree
or authorizing deletion.

`test-prune-probe` is fail-closed and must use an isolated disposable workspace.
No command in this feature deletes or edits a test in the live working tree.

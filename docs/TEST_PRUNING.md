# Test pruning safety

`test-prune-plan` can return `KEEP`, `REWRITE`, `PROBE_REMOVAL`, or `BLOCKED`.
`PROBE_REMOVAL` requires both protected-test policy and sufficient deterministic
and semantic evidence. Unknown utility is `BLOCKED`.

`test-prune-probe` is fail-closed and must use an isolated disposable workspace.
No command in this feature deletes or edits a test in the live working tree.

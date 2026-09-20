# Stale gate revalidation

ForgeLoop keeps `gate-record` phase-frozen. Once execution has started, a
changed gate artifact cannot be silently rewritten or recorded as a new
pre-execution approval.

When a satisfied gate becomes stale during `EXECUTING`, `VERIFYING`,
`DIAGNOSING`, `CORRECTING`, or `REVIEWING`, `next` exposes the canonical repair
command:

```text
forgeloop gate-revalidate --task <task-id> --gate <gate> --acknowledge-stale --json
```

The command is fail-closed. It requires a healthy active task claim, coherent
current contract/route/state identity, an existing satisfied gate, and every
changed gate artifact inside the task's effective write claims. It refreshes
the gate artifact in the same task transaction and appends `GATE_REVALIDATED`
followed immediately by `TRANSACTION_COMMITTED(operation="gate-revalidate")`.

The previous gate event remains in the append-only ledger. After revalidation,
run `preflight` again so ForgeLoop can append a fresh readiness boundary before
continuing the normal verification and completion lifecycle.

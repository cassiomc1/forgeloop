# Delegation protocol

`ForgeLoop` defines coordination contracts but does not schedule agents or
provide a multi-agent runtime. A compatible harness may execute a validated
brief through native subagents; a harness without that capability executes the
same brief inline and reports the degraded mode.

## Task brief

A delegated task is self-contained and versioned:

```json
{
  "schemaVersion": 1,
  "protocolVersion": 1,
  "taskId": "child-1",
  "parentTaskId": "parent-1",
  "objective": "One independently verifiable objective.",
  "allowedPaths": ["src/feature.js"],
  "readOnlyPaths": ["README.md"],
  "dependencies": [],
  "constraints": [],
  "requiredGuides": ["clean", "test"],
  "verification": ["npm test"],
  "authority": ["write only allowed paths"],
  "deliverables": ["code and test result"],
  "executionMode": "delegated"
}
```

`allowedPaths` are write ownership. `readOnlyPaths` may be inspected but not
changed. Absolute paths, traversal, duplicate paths, and allowed/read-only
overlap are invalid. Two briefs with exact or parent/child write overlap must
be serialized or assigned to one integration owner. Dependencies are explicit
and cycles are rejected.

Resource access is classified explicitly:

```text
WRITE / WRITE → conflict
WRITE / READ  → SERIAL_REQUIRED
READ  / READ  → safe
```

The parent task owns integration. `validateDelegationSet` rejects duplicate
task IDs, self-dependencies, unknown dependency references, cycles, invalid
guide/path boundaries, missing verification, missing authority, and secret
material. It returns `PARALLEL_SAFE`, `SERIAL_REQUIRED`, or `INVALID` with
stable conflict/error records.

Parallel work is eligible only when shared files, shared state, ordering
dependencies, and external resources have been checked. A database migration
and code that depends on its new shape are not independent tasks.

## Result normalization

Every delegated result uses:

```text
STATUS
CHANGES
VERIFICATION
OPEN FINDINGS
LIMITATIONS
```

Valid statuses are `complete`, `complete-with-concerns`, `needs-context`, and
`blocked`. Results are serializable, secret-free, and validated against
`schemas/delegated-result.schema.json`.
Complete results also require structured observed or inferred verification
evidence.

A delegated result is the delegate's account, not proof. The delegator verifies
the delivery against the brief with
`forgeloop evidence-verify --base <rev> --head <rev> --brief <task-brief.json>`:
it fails unless the delegate's evidence bundle is intact, stays inside
`allowedPaths` and out of `readOnlyPaths`, and binds a passing check for every
brief `verification` item (predicate schema version 2). Add `--min-assurance`
and `--require-signature` to also require who ran the checks and a signature.
See `docs/PROTOCOL_SPEC.md` Section 8.

Canonical handoff acceptance is not delegation acceptance. A handoff envelope
and its `HANDOFF_ACCEPTED` operational receipt do not create a delegated task,
approve a brief, transfer claims, or establish reviewer authority. Delegation
authority remains in this canonical delegation contract and its validated task
brief/result relationships.

## Review and integration

An independent reviewer receives the approved brief, resulting diff,
verification evidence, and known risks. A review is independent only when the
reviewer identity differs from the implementer and the result explicitly uses
`reviewType: "independent"`; a second pass by the same identity is self-review.

The parent agent integrates in dependency order:

1. validate each result against its brief;
2. detect overlapping changes and unresolved findings;
3. integrate non-overlapping results in dependency order;
4. run targeted checks and combined regression;
5. perform final specification and quality review.

If subagents, worktrees, or parallel tools are unavailable, use
`executionMode: "inline"`. This preserves the task contract but cannot claim
parallelism or independent review. Missing capabilities are limitations, not
silent successes.

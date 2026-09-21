# Execution state and resume protocol

> Looking for a practical resume tutorial? See [`docs/CROSS_HARNESS_CONTINUITY.md`](./docs/CROSS_HARNESS_CONTINUITY.md).
> Looking for artifact field definitions? See [`docs/ARTIFACT_REFERENCE.md`](./docs/ARTIFACT_REFERENCE.md).
> Looking for stale-state recovery? See [`docs/TROUBLESHOOTING.md`](./docs/TROUBLESHOOTING.md).

Compatible agents may persist a handoff checkpoint at:

```text
.forgeloop/task-state/<taskKey>/work-state.json
```

Claim-release recovery has a separate current-state artifact:

```text
.forgeloop/task-state/<taskKey>/recovery.json
```

`work-state.json` remains the lifecycle authority. `recovery.json` records a
request to suspend ordinary mutation and release effective claims; it does not
change the phase, refresh repository evidence, erase failures, or imply
completion. Its `recoveryId`, event sequence, previous revision, released
claims, repository fingerprint, classification, and authority kind are bound
to the append-only recovery event. Claims are released only after the canonical
resolver validates that complete relationship. An unresolved recovery event
with a missing tombstone, or a tombstone without its matching event, is
`INCONSISTENT`, retains historical claims, and disables mutation. The same
fail-closed rule applies to completion: `phase: COMPLETE` alone never releases
claims — the canonical completion ownership proof (validated ledger with the
task-bound `COMPLETION_VALIDATED` event and coherent state) is required, and a
forged or unproven COMPLETE state is `INCONSISTENT` with historical claims
retained.

For an intentional active-task stop, use the explicit canonical command:

```bash
forgeloop task-abandon --task <id> --acknowledge-abandonment --json
```

It appends `TASK_ABANDONED`, writes a matching recovery boundary classified
`ABANDONED`, keeps the current phase unchanged, and resolves ownership to
`RELEASED_BY_RECOVERY`. It never emits `COMPLETION_VALIDATED` and never grants
publication authority. `clear-state` only clears a checkpoint and must not be
used to release claims.

The file is local, ignored by Git, schema-versioned, and never a replacement
for the manifest or the target project profile (installed as
`.forgeloop/kit/PROJECT_PROFILE.md`). It contains no secrets and is untrusted
on read.

## Shape

```json
{
  "schemaVersion": 1,
  "protocolVersion": 1,
  "taskId": "task-123",
  "contractFingerprint": "lowercase-sha256",
  "repositoryFingerprint": { "branch": "main", "head": "commit-sha" },
  "phase": "VERIFYING",
  "selectedGuides": ["clean", "test"],
  "completedSteps": ["discovery", "implementation"],
  "pendingSteps": ["verification", "review"],
  "requiredArtifacts": [
    { "path": "src/api/auth.js", "sha256": "lowercase-sha256" }
  ],
  "checks": [],
  "failures": [],
  "blockers": [],
  "verificationEvidence": [],
  "lastUpdated": "2026-08-11T12:00:00.000Z"
}
```

The CLI validates the protocol version, phase enum, guide IDs, fingerprints,
transition, status-specific evidence, bounded strings, and secret-free shape.
`COMPLETE` requires verification evidence. `BLOCKED` requires a blocker
category and evidence. `CORRECTING` requires a diagnosed hypothesis.

## Atomicity and stale state

State writes validate the complete JSON value, write a unique temporary file,
and rename it into place. The host filesystem's rename guarantee is the
atomicity boundary; no database or remote state is involved. A truncated,
malformed, or secret-bearing file is invalid and is never resumed silently.

Lifecycle mutations that change more than one artifact use a task transaction
under `.forgeloop/.txn/<transactionId>/`. The transaction records every staged
replacement and append. Ledger appends validate a bounded tail checkpoint and
stage only the new NDJSON suffix; if publication is interrupted, recovery
truncates that suffix to its recorded pre-append size. A stale checkpoint never
authorizes a new sequence number: ForgeLoop rebuilds it from the ledger before
continuing.

Before resuming, compare:

- the task contract fingerprint;
- the Git branch and HEAD when the target is a Git checkout;
- the protocol version;
- required artifacts and assumptions recorded by the task.

If validated recovery state is active, ordinary lifecycle mutation fails with
`E_TASK_RECOVERED`. If recovery ownership is inconsistent, mutation fails with
`E_TASK_CLAIM_OWNERSHIP_INCONSISTENT`. Resume claim ownership explicitly:

```bash
forgeloop task-resume --task <id> --json
```

Optional repeatable `--claim <path>` arguments replace the historical claim set
only after normal overlap and clean-checkout enforcement succeeds. Recovery
state deletion, any descriptor update, and `TASK_RECOVERY_RESUMED` are staged
transactionally. `TASK_RECOVERY_RESUMED` counts as meaningful activity. A
missing artifact returns `E_TASK_NOT_RECOVERED` only when the ledger also proves
there is no unresolved recovery; otherwise it is an ownership inconsistency.

Never create, delete, or edit `recovery.json` manually. Never remove recovery
state to resume a task. Never interpret `recovery.json` without validating its
ledger binding.

Any material difference produces `REVALIDATION_REQUIRED`. A non-Git target
reports that branch/HEAD drift is not verifiable. Cheap checks may be rerun,
but a completed destructive or publication action is never rerun automatically.

When `workspace-binding.json` is present, it is an additional execution-safety
boundary: the binding records the derived repository/worktree identity, and
both task mutations and `run-check` validate the current checkout against it.
A matching branch name or HEAD alone is not sufficient. When the optional
artifact is absent, workspace binding is not applicable; it must not be
invented from continuity notes, handoff prose, or actor input.

The current contract is compared when resolving the target task:

```bash
forgeloop status --task <id> --json
```

Without that file, contract comparison is `NOT_VERIFIED`; the status does not
claim full freshness. Required artifact hashes report missing or changed files.
An optional age threshold may recommend cheap verification with
`CHECKPOINT_OLD` without changing a fresh result.

Protocol validation can be run against the task artifacts:

```bash
forgeloop validate-protocol \
  --task <id> \
  --json
```

When delegation is in scope, repeat `--task-brief <path>` and
`--delegated-result <path>` for the matching handoff artifacts. If those inputs
are omitted, `validate-protocol` reports `INCOMPLETE` because delegation
conformance was not supplied; this is distinct from a local `complete` result.

`validate-protocol` reports `STALE` when the current repository fingerprint,
contract, or required-artifact fingerprints require revalidation. Its JSON
result exposes the comparison values, reasons, and warnings; the human output
shows the same evidence. The persisted work-state file remains schema-compatible
and never stores derived `status`, `stale`, or `fresh` fields.

State reports use the shared evidence kinds `OBSERVED`, `INFERRED`,
`NOT_VERIFIED`, and `BLOCKED`. A parse failure is structured as `INVALID` and
is never resumed silently.

## Commands

```bash
forgeloop status
forgeloop status --json
forgeloop validate-state
forgeloop validate-state --json
forgeloop clear-state
```

`status` explains whether state is absent, fresh, or requires revalidation.
`validate-state` performs schema and semantic checks without mutation.
`clear-state` affects only `work-state.json` for the target task and prints the exact
relative path it removed; it never deletes the directory, manifest, or project
files.

## Execution continuity companion

`work-state.json` under `.forgeloop/task-state/<taskKey>/` remains the canonical checkpoint and owns phase,
`completedSteps`, `pendingSteps`, failures, blockers, verification cycles, and
required artifact fingerprints. `continuity.json` under `.forgeloop/task-state/<taskKey>/` is an optional
companion containing only granular implementation-resume context. It is bound
to the current task, contract fingerprint, work-state fingerprint, phase, and
repository context and is always operational context rather than evidence.

## Resume decision table

| Work State | Continuity | Repository HEAD | Action |
| --- | --- | --- | --- |
| Valid / Fresh | Fresh | Matches | Continue execution directly via `forgeloop next` |
| Valid / Fresh | Missing | Matches | Continue from work-state checkpoint (continuity is optional) |
| Valid / Fresh | Stale | Matches / Drifted | Run `forgeloop reconcile-continuity --json`, inspect diff, continue |
| Stale | Any | Changed | Run `forgeloop route` and `forgeloop preflight` to revalidate |
| Invalid / Corrupted | Any | Any | Fail closed; inspect errors via `forgeloop doctor --json` |
| Different Task ID | Present | Any | Do not merge contexts; clear or finish previous task first |

## Durable actions are a separate external-state checkpoint

Action artifacts under `actions/` describe side-effect intent and its canonical
state; they do not replace `work-state.json`. Approval artifacts bind a single
decision to the exact action fingerprint, contract fingerprint, task revision,
and capability. Capability policy is configuration, not host authority.

`FORGELOOP_EXECUTED` means ForgeLoop launched exact argv through `run-action`;
`HOST_REPORTED` means an external host performed the operation; and
`EXTERNAL_OBSERVED` means a later observation supplied reconciliation evidence.
If the external outcome is uncertain, the action is `COMMIT_UNKNOWN`. It must
not be retried or used to satisfy required completion until
`forgeloop action-reconcile` records `COMMITTED`, `NOT_COMMITTED`, or
`UNKNOWN`. ForgeLoop does not claim universal exactly-once execution.

`metrics` and `eval` read the canonical trace, reflection, action artifacts, and
ledger events. They never mutate lifecycle truth, invent usage/cost data, or
create a second execution history; reference efficiency is emitted only when a
project-local scenario provides comparable steps.

# Repository Assessment

`forgeloop assess` starts an improvement review of a repository that already
exists. It collects deterministic facts, routes the ForgeLoop engineering
guides per area, lists candidate checks, and reports observed gaps. A host
agent then reviews the code and records evidence-backed findings, and each
accepted finding becomes its own ForgeLoop task.

```bash
forgeloop assess --json
forgeloop assess --path ../existing-app
```

## Boundaries

- **Read-only.** It writes no files, creates no lifecycle state, and does not
  bootstrap `.forgeloop/` storage.
- **Nothing executed.** It never runs the target repository's tests, linters,
  builds, or scripts. Candidate checks are emitted with status `NOT_EXECUTED`;
  run them inside a task with `forgeloop run-check`.
- **No semantic decision.** It does not call the decision plane.
- **Discovery only.** The result has `authority: "DISCOVERY_ONLY"` and
  `evidenceAuthority: "NONE"`. It is not verification evidence and grants no
  scope.
- **Deterministic.** Output uses sorted values and repository-relative POSIX
  paths. It contains no timestamps and no absolute target path.

## Output

| Field | Meaning |
|---|---|
| `facts.stack` | Project detection result. `NOT_DETERMINED` when detection finds no project or exhausts its traversal budget; this is never reported as "no stack". |
| `facts.areas` | `backend`, `database`, `frontend`, `infrastructure`, `mobile`, each with the signals that selected it. Frontend and backend come from known dependencies and detected frameworks. |
| `facts.policy` | Languages and the test and lint commands from policy discovery. |
| `facts.tests` | Deterministic test inventory totals. |
| `facts.repository` | CI configuration, container files, and lockfiles present. |
| `reviewPlan.areas[].guides` | Guides routed for the area, with their `ENG/*.md` paths. |
| `reviewPlan.candidateChecks` | Deduplicated check argv, purpose, and source signal, all `NOT_EXECUTED`. |
| `reviewPlan.gaps` | Observed advisory gaps, for example `TESTS_NOT_DETECTED`, `LINT_COMMAND_NOT_DETECTED`, `TYPECHECK_COMMAND_NOT_DETECTED`, `CI_NOT_DETECTED`, `LOCKFILE_NOT_DETECTED`, `STACK_NOT_DETERMINED`. |
| `reviewPlan.findingContract` | The fields and rules every finding must satisfy. |

## Finding contract

Each finding records:

- `id`, `area`, `category`, `severity`, `title`;
- `location` (file and line);
- `evidence` (`OBSERVED` or `INFERRED`, with its source);
- `guide`, `recommendation`, `suggestedClaims`, `suggestedVerification`.

`OBSERVED` evidence must be reproducible: a quoted excerpt, or the argv and
output of an executed check. `INFERRED` findings rank below `OBSERVED` findings
of the same severity and are never `critical`.

## Workflow

1. Run `forgeloop assess` and read the routed guides for each area.
2. Review each area without editing code and record findings that satisfy the
   contract.
3. Prioritize by severity and evidence kind.
4. For each accepted finding, create a task with
   `forgeloop task-create --claim <path>` and follow the normal lifecycle to
   `COMPLETE`.

Persisted findings, a dedicated read-only assessment task, creating tasks from
findings, and semantic triage are not part of this version.

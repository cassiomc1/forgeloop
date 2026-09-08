# ForgeLoop Troubleshooting Guide

This guide provides symptom-first recovery procedures for common ForgeLoop protocol, state, and verification issues.

---

## Quick Symptom Index

- [`preflight` is `BLOCKED`](#symptom-preflight-is-blocked)
- [`forgeloop next` returns `RESOLVE_BLOCKER`](#symptom-forgeloop-next-returns-resolve_blocker)
- [`forgeloop next` returns `RECORD_DIAGNOSIS`](#symptom-forgeloop-next-returns-record_diagnosis)
- [Progress is `STALLED` or `forgeloop next` returns `CHANGE_STRATEGY`](#symptom-progress-is-stalled)
- [Protocol state or contract is `STALE`](#symptom-state-or-contract-is-stale)
- [Execution continuity is `STALE`](#symptom-continuity-is-stale)
- [Multiple tasks ambiguous (`E_TASK_AMBIGUOUS`)](#symptom-multiple-tasks-ambiguous)
- [Verification tool is missing (`E_VERIFICATION_TOOL_UNAVAILABLE`)](#symptom-verification-tool-is-missing)
- [Installation authority required (`E_INSTALLATION_AUTHORITY_REQUIRED`)](#symptom-installation-authority-required)
- [Execution reference invalid (`E_EXECUTION_REF_INVALID`)](#symptom-execution-reference-invalid)
- [`forgeloop complete` returns `INCOMPLETE`](#symptom-forgeloop-complete-returns-incomplete)
- [`forgeloop complete` returns `INVALID`](#symptom-forgeloop-complete-returns-invalid)
- [Policy lock mismatch (`E_POLICY_LOCK_MISMATCH`)](#symptom-policy-lock-mismatch)
- [Capability policy epoch drift (`E_ACTION_POLICY_DRIFT`)](#symptom-capability-policy-epoch-drift)
- [Invalid policy artifacts fail closed (`E_POLICY_INVALID`)](#symptom-invalid-policy-artifacts-fail-closed)
- [Policy weakening detected (`E_POLICY_WEAKENING`)](#symptom-policy-weakening-detected)
- [Baseline re-record blocked during active task (`E_BASELINE_RECORD_DURING_ACTIVE_TASK`)](#symptom-baseline-re-record-blocked-during-active-task)
- [Mutation checker execution error (`E_CHECK_MUTATION_EXECUTION_ERROR`)](#symptom-mutation-checker-execution-error)
- [Workspace binding mismatch or invalid identity](#symptom-workspace-binding-mismatch-or-invalid-identity)
- [Handoff is invalid or tampered](#symptom-handoff-is-invalid-or-tampered)
- [Responsibility contract rejects a pass](#symptom-responsibility-contract-rejects-a-pass)
- [Verification scope is stale or unresolved](#symptom-verification-scope-is-stale-or-unresolved)
- [Attestation or revision coverage is invalid](#symptom-attestation-or-revision-coverage-is-invalid)
- [Structural-quality evidence is missing or blocked](#symptom-structural-quality-evidence-is-missing-or-blocked)
- [Structural-quality verification reports a regression](#symptom-structural-quality-verification-reports-a-regression)
- [Structural-quality provider is unavailable or invalid](#symptom-structural-quality-provider-is-unavailable-or-invalid)
- [Structural-quality evidence is stale or incomparable](#symptom-structural-quality-evidence-is-stale-or-incomparable)
- [Repository Index is not ready](#symptom-repository-index-is-not-ready)
- [Repository search fails](#symptom-repository-search-fails)
- [Persistent search host is unavailable](#symptom-persistent-search-host-is-unavailable)
- [Persistent search host ownership is unverified or stale](#symptom-persistent-search-host-ownership-is-unverified-or-stale)
- [Another harness cannot resume the task](#symptom-another-harness-cannot-resume)
- [Task claim conflict or recovered task](#symptom-task-creation-blocked-by-a-write-claim-conflict-e_task_scope_conflict)
- [Stable Error & Reason Code Reference](#stable-error-and-reason-codes)

---

## Symptoms and Recovery

Confirm the local CLI's public metadata before diagnosing a harness/version
mismatch. This check does not create or mutate task state.

<!-- FORGELOOP EXAMPLE: troubleshooting:protocol-info | exit=0 | json.errors.0.code=E_ACTION_APPROVAL_NOT_REQUIRED -->
```bash
forgeloop protocol-info --json
```
<!-- END FORGELOOP EXAMPLE -->

### Symptom: `preflight` is `BLOCKED`

#### What it means

Pre-implementation gates (e.g. `design`, `threat-boundary`) are unsatisfied, missing, or referencing stale files, or the contract contains unresolved blocking decisions. ForgeLoop preserves specific preflight error codes (`E_CONTRACT_UNRESOLVED_DECISION`, `E_CONTRACT_STALE`, `E_ROUTE_STALE`, `E_GATE_UNVERIFIED`) in `reasons` instead of reducing them to generic readiness errors.

#### Likely causes

1. A gate required by an activated guide has no corresponding `.forgeloop/task-state/<taskKey>/gates/<gate>.json` file (`E_GATE_UNVERIFIED`).
2. The gate artifact references files whose SHA-256 hashes changed after the gate was satisfied (`E_GATE_STALE`).
3. Contract `unresolvedDecisions` contains blocking decisions (`E_CONTRACT_UNRESOLVED_DECISION`).

#### Inspect

```bash
forgeloop task-show --task <id> --json
forgeloop preflight --task <id> --json
forgeloop next --task <id> --json
```

#### Safe recovery

1. If a gate is missing, satisfy required gates or create the gate artifact with status `"satisfied"`.
2. If an artifact hash changed, update the artifact SHA-256 in the gate file.
3. If `unresolvedDecisions` contains blocking items:
   - Record settlement guidance with `forgeloop record-decision-criterion --decision="..." --settled-by="..."` to provide context.
   - Resolve or remove the blocking decision in `contract.json`.
4. Re-run `forgeloop preflight --task <id> --json`.

#### Do not

Do not bypass preflight by manually editing `work-state.json`.

---

### Symptom: `forgeloop next` returns `RESOLVE_BLOCKER`

#### What it means

The protocol has encountered a condition that prevents automatic progression until an explicit blocker is resolved.

#### Likely causes

1. Task `work-state.json` was deleted or is out of sync with `contract.json`.
2. A verification check failed and no diagnostic hypothesis was recorded.
3. A required gate is unsatisfied.

#### Inspect

```bash
forgeloop status --task <id> --json
forgeloop next --task <id> --json
```

#### Safe recovery

1. Check the `reasons` field in the `forgeloop next --json` output.
2. Follow the suggested command in `commands` or `commandSpecs`.
3. If in `VERIFYING` after a failure, advance to `DIAGNOSING`, record a diagnosis with `forgeloop record-diagnosis`, and advance to `CORRECTING`.

---

### Symptom: `forgeloop next` returns `RECORD_DIAGNOSIS`

#### What it means

The task is in `DIAGNOSING` phase following a verification failure, but no append-only diagnosis event (`DIAGNOSIS_RECORDED`) has been recorded for the active verification cycle (`E_DIAGNOSIS_REQUIRED`).

#### Likely causes

1. A check failed in `VERIFYING` and the phase was advanced to `DIAGNOSING` without calling `record-diagnosis`.
2. An attempt was made to advance directly to `CORRECTING` without recording an evidence-backed root cause hypothesis.

#### Inspect

```bash
forgeloop status --task <id> --json
forgeloop next --task <id> --json
```

#### Safe recovery

Record an append-only diagnosis referencing at least one failed or blocked check from the current verification cycle:

```bash
forgeloop record-diagnosis --task <id> \
  --hypothesis="Root cause explanation" \
  --failure-class="VERIFICATION_FAILURE" \
  --evidence-ref="failed-check-id" \
  --settled-by="Observable condition that settles the hypothesis" \
  --next-safe-action="Smallest safe action to address the hypothesis"
```

Then advance to `CORRECTING`:

```bash
forgeloop advance --task <id> --to CORRECTING
```

---

### Symptom: Progress is `STALLED`

#### What it means

Deterministic progress evaluation detected that iterative correction cycles are not advancing (`E_PROGRESS_STALLED`). The latest diagnosis produced `informationGain: NONE` (signal `NO_DIAGNOSTIC_INFORMATION_GAIN`), or a specific contract requirement failed across 3+ verification cycles with an identical diagnosis (`REPEATED_FAILURE_WITH_SAME_DIAGNOSIS`).

#### Likely causes

1. A recorded diagnosis in a new cycle repeated the previous hypothesis with the exact same evidence references (`informationGain: NONE`). Note: technical retries within the *same* cycle are idempotent and do not cause stalls, but repeating in a *new* cycle does.
2. The same requirement has repeatedly failed across 3 or more verification cycles with unchanged diagnostic hypotheses.
3. Minor cosmetic changes were made to `settledBy` or `nextSafeAction` without changing the root hypothesis or evidence references.

#### Inspect

```bash
forgeloop progress --task <id> --json
forgeloop next --task <id> --json
```

#### Safe recovery

1. When stalled, `forgeloop next` returns `nextAction: "CHANGE_STRATEGY"` with error code `E_PROGRESS_STALLED`.
2. Do not repeat the same retry or correction action.
3. Re-examine the failure evidence from a new angle or gather fresh diagnostic evidence.
4. Formulate a genuinely new root-cause hypothesis with new evidence references and record it with `forgeloop record-diagnosis`.
5. Once a diagnosis with positive information gain (`NEW_HYPOTHESIS`, `NEW_EVIDENCE`, `NEW_HYPOTHESIS_AND_EVIDENCE`) is recorded, `forgeloop next` returns `CORRECT` and status returns to `ADVANCING`.

---

### Symptom: State or Contract is `STALE`

#### What it means

An upstream artifact was modified, invalidating downstream cryptographic fingerprint bindings.

#### Likely causes

1. `contract.json` was edited after `work-state.json` or `routing-result.json` was created (`E_CONTRACT_STALE`).
2. Git `HEAD` changed (commit or checkout) while in `EXECUTING` or `VERIFYING`.

#### Inspect

```bash
forgeloop task-show --task <id> --json
forgeloop status --task <id> --json
```

#### Safe recovery

1. If the contract changed intentionally:

   ```bash
   forgeloop route --task <id> --work <type> [options] --json
   forgeloop preflight --task <id> --json
   ```

2. Re-validate state:

   ```bash
   forgeloop validate-protocol --task <id> --json
   ```

If a checkpoint must be recreated after `clear-state` (or loss), `preflight`
rebuilds a resumable checkpoint from the preserved contract and route artifacts.
The resume phase is derived from the validated ledger chronology: a ledger that
already records `EXECUTION_STARTED` (or a later verification milestone) resumes
at the phase that chronology supports instead of restarting at `ROUTED`, so no
duplicate non-repeatable lifecycle milestone is ever appended.

A `PREFLIGHT_READY` that was superseded by a later `PREFLIGHT_BLOCKED` outcome
(contract evolution, added gate requirement) does not block re-readiness: once
the blocked preflight is resolved, `preflight` appends a fresh
`PREFLIGHT_READY` bound to the current contract and route. A READY refresh whose
details differ *without* an intervening BLOCKED outcome is still refused with
`E_PHASE_CHRONOLOGY_INVALID`.

---

### Symptom: `EXECUTING`/`VERIFYING` task is stale because the repository moved (`E_REPOSITORY_CHANGED`)

#### What it means

A task entered `EXECUTING` at an older checkout and the repository HEAD changed (commit, merge, or checkout). The work-state checkpoint fingerprint no longer matches, so transitions and completion are fail-closed with `E_REPOSITORY_CHANGED` / `E_STATE_REVALIDATION_REQUIRED`. This is intentional: execution must not silently continue against different code.

If the task's objective is already satisfied by the current repository (for example, the work was merged by another change), the checkpoint can be reconciled with executed evidence:

```bash
forgeloop reconcile-closure --task <id> --id <verification-id> \
  --requirement "<exact contract verification text>" -- <command>
```

`reconcile-closure` requires:

1. The task is `EXECUTING`, `VERIFYING`, or `REVIEWING`. A `REVIEWING` task additionally requires authorized completion recovery (a persisted evidence-only rejection bound to the current checkpoint), or a rejection snapshot that can be rebound (see below).
2. The only drift is `REPOSITORY_CHANGED` (contract or required-artifact drift stays blocked).
3. The append-only event ledger is valid.
4. `--id` and `--requirement` exactly match a `VERIFICATION` item of the task contract, and the executed command exits 0, proving the objective is present in the current repository.

It then appends a `CHECKPOINT_RECONCILED` ledger event (previous/current repository fingerprints plus the evidence) and refreshes the work-state repository fingerprint. Closure still goes through the canonical pipeline:

```bash
forgeloop advance --task <id> --to VERIFYING
forgeloop prepare-completion --task <id>
forgeloop run-check --task <id> --id <id> --requirement "<text>" -- <command>
forgeloop advance --task <id> --to REVIEWING
forgeloop complete --task <id>
```

#### Drifted completion-rejection snapshots (`E_COMPLETION_REJECTION_STATE_FINGERPRINT_MISMATCH`)

A `REVIEWING` task with a persisted evidence-only completion rejection can lose
its snapshot binding when the checkpoint is mutated after the rejection (for
example by a recovery/resume cycle or a repository move). Both sanctioned
closure paths — `reconcile-closure` from `REVIEWING` and the
`REVIEWING -> VERIFYING` recovery transition — then fail with
`E_COMPLETION_REJECTION_STATE_FINGERPRINT_MISMATCH`, while `complete` cannot
persist a fresh snapshot because it deduplicates logically identical rejections.
This deadlocks the task.

ForgeLoop resolves this with an append-only **rejection rebind**: when the only
authorization failures are state/receipt fingerprint mismatches and the
rejection's logical fields (`verificationCycle`, sorted `reasonCodes`, sorted
`missingRequirementIds`) are still identical between work-state and the latest
matching ledger rejection, the recovery surfaces automatically append a rebound
`COMPLETION_REJECTED` event carrying the current fingerprints (referencing the
snapshot it supersedes via `reboundFromStateFingerprint`) and re-bind the
execution receipt. The original rejection is never modified, any logical
difference is still refused, and closure must still produce fresh observed
evidence in the current repository.

Write claims release only when completion is validator-backed (`COMPLETE`).
A `phase: COMPLETE` that was never produced by the official completion pipeline
is not sufficient: the ownership resolver requires canonical lifecycle proof (a
validated ledger containing the task-bound `COMPLETION_VALIDATED` event with
coherent state). Unproven completion reports
`E_COMPLETION_OWNERSHIP_UNPROVEN` / `E_TASK_CLAIM_OWNERSHIP_INCONSISTENT`,
retains historical claims, and blocks mutation and overlapping acquisition.
Re-run the official completion pipeline or restore the canonical completion
event; never edit `work-state.json` by hand.

---

### Symptom: Continuity is `STALE`

#### What it means

`.forgeloop/task-state/<taskKey>/continuity.json` references a previous `work-state.json` fingerprint or older checkout state.

#### Likely causes

Another harness or developer committed changes or advanced lifecycle phases without updating continuity.

#### Inspect

```bash
forgeloop continuity --task <id> --json
```

#### Safe recovery

1. Reconcile continuity with current state:

   ```bash
   forgeloop reconcile-continuity --task <id> --json
   ```

2. If continuity is obsolete, clear it:

   ```bash
   forgeloop clear-continuity --task <id>
   ```

   *Note: Clearing continuity does not lose lifecycle state; `work-state.json` remains intact.*

---

### Symptom: Multiple Tasks Ambiguous

#### Error Code: `E_TASK_AMBIGUOUS`

#### What it means

Multiple active tasks exist in `.forgeloop/task-state/`, but the command was run without an explicit `--task` flag or `FORGELOOP_TASK` environment variable.

#### Inspect

```bash
forgeloop task-list --json
```

#### Safe recovery

Specify the task ID explicitly using the `--task` flag:

```bash
forgeloop status --task <task-id> --json
forgeloop next --task <task-id> --json
```

Or set the environment variable for your shell session:

```bash
export FORGELOOP_TASK="<task-id>"
```

---

### Symptom: Task Creation Blocked by a Write-Claim Conflict (`E_TASK_SCOPE_CONFLICT`)

#### What it means

Another non-`COMPLETE` task already holds a write claim that overlaps the claims you requested. ForgeLoop inspects the conflicting task automatically before failing and attaches a deterministic classification to the error.

#### Inspect

The conflict error carries machine-readable fields directly on each
`error.conflicts[]` entry, plus the full nested `inspection`:

- `classification`: one of `ACTIVE`, `RECOVERABLE`, `STALE`, `ABANDONED`, `INCONSISTENT`, `RECOVERED`, or `COMPLETE`;
- `reasonCodes`: the deterministic evidence codes behind the classification;
- `nextAction`: the deterministic recovery or wait action;
- `commandSpecs`: direct-process command metadata and required inputs;
- `inspection`: the complete classification evidence.

Classification is derived from machine state only: the validated relationship
between descriptor, work state, recovery artifact, and complete recovery
history; lock/lease,
checkpoint freshness, drift kinds, ledger validity, all recorded check statuses,
verification evidence, meaningful ledger activity, and idle time. Lock state
distinguishes `NONE`, `LIVE`, `STALE`, `UNKNOWN`, and `CORRUPT`; unknown,
corrupt, or unreadable evidence fails closed as `INCONSISTENT`. A `REVIEWING`
phase plus an old timestamp alone is never `STALE`; post-execution tasks whose
only drift is `REPOSITORY_CHANGED` remain `RECOVERABLE`.

#### Safe recovery

Follow the classification:

```bash
# RECOVERABLE: reconcile through the official pipeline first
forgeloop reconcile-closure --task <task-id> --id <verification-id> \
  --requirement "<exact contract verification text>" -- <command>

# STALE / ABANDONED only: caller-acknowledged claim release
forgeloop task-recover --task <task-id> --acknowledge-recovery --json

# RECOVERED: reacquire claims through normal ownership checks
forgeloop task-resume --task <task-id> --json

# INCONSISTENT: diagnose; do not force claim release
forgeloop validate-protocol --task <task-id> --json
```

`task-recover` uses an explicit allowlist: only `STALE` and `ABANDONED` are
accepted. It refuses `ACTIVE`, `RECOVERABLE`, `INCONSISTENT`, `RECOVERED`,
`COMPLETE`, and unknown future classifications. A stale task lock is released
only if its lock ID, heartbeat, and owner instance still match the observation;
recovery then revalidates phase, revision, ledger sequence, and classification
under project-claims and task locks.

The command writes durable `recovery.json` and a linked append-only recovery
event in one transaction. For PR #66 compatibility, the writer retains the
event name `OPERATOR_RECOVERY_RECORDED`, but records
`authorityKind: CALLER_ACKNOWLEDGED`; readers also accept
`TASK_RECOVERY_RECORDED`. Recovery does not refresh `work-state.json`, change
phase, erase evidence, alter policy/continuity, or fabricate completion.
Historical descriptor claims remain visible, while canonical effective claims
are empty only when that relationship validates; ordinary mutations then fail
with `E_TASK_RECOVERED`. Fake, missing, corrupt, deleted, or mismatched recovery
evidence is `INCONSISTENT`, keeps historical claims effective, disables
mutation, and routes `next` to `RESOLVE_RECOVERY_INCONSISTENCY`.

`--acknowledge-recovery` is a caller declaration, not host-attested authority.
The deprecated `--operator-authorized` alias has the same limited meaning.
Only `task-resume` can transactionally remove recovery state and reacquire
claims. If another task owns an overlapping path, resume returns
`E_TASK_SCOPE_CONFLICT` and leaves the recovered task suspended.

Never create, delete, or edit `recovery.json` manually. Never remove task
recovery state to resume a task. Never interpret `recovery.json` without
validating its ledger binding. Direct changes bypass locks, transactions,
expected revisions, and the append-only ledger.

If `.forgeloop/.claims.lock` is stale, ForgeLoop quarantines and removes it only
when `lockId`, `heartbeatAt`, and `ownerInstanceId` still match. A live lock
returns `E_TASK_LOCKED`; unknown, corrupt, or concurrently replaced ownership
returns `E_PROJECT_CLAIMS_LOCK_INCONSISTENT`. Do not force-delete unknown lock
ownership.

A project containing active task recovery state requires ForgeLoop 1.4.0 or
newer. An older reader that cannot advertise validated claim projection must
fail closed instead of inferring ownership from the descriptor or tombstone.

---

### Symptom: Verification Tool is Missing

#### Error Code: `E_VERIFICATION_TOOL_UNAVAILABLE`

#### What it means

A verification check requires an executable or tool that is not installed in the local environment.

#### Likely causes

1. The toolchain is missing a package or global binary (e.g. `linter`, `test runner`).
2. Running in an isolated or sandboxed environment without network access.

#### Safe recovery

1. Use an already available local equivalent (e.g. `node scripts/run-tests.js` instead of an external runner).
2. If an authorized host authority grant is available, install the tool.
3. If no equivalent exists and installation is unauthorized, record the check as `NOT_VERIFIED` or `BLOCKED`.

#### Do not

**Do not run ad-hoc install commands (e.g. `npm i -g tool` or `npx tool`) without explicit operator authority.**

---

### Symptom: Verification Reports Contradictory Isolation Metadata

#### Error Code: `E_VERIFICATION_EXECUTION_INVALID`

#### What it means

The trusted verification execution adapter returned isolation metadata that contradicts itself, for example `NATIVE_PROJECT` claiming `isolated=true`, an isolated mode claiming `liveProjectWritable=true`, or `SYSTEM_ISOLATED` claiming `networkPolicy=INHERITED`. The execution artifact is rejected before evidence persistence.

#### Likely causes

1. A custom execution adapter hard-coded isolation fields instead of reporting what the host actually enforced.
2. A disposable-copy workspace reported itself as system isolated, or claimed the live project is not writable when no filesystem boundary enforces it.

#### Safe recovery

1. Repair the adapter so each isolation mode reports its canonical guarantees: `NATIVE_PROJECT` (`isolated=false`, `liveProjectWritable=true`), `PROJECT_ISOLATED` (`isolated=true`, `liveProjectWritable=false`), `SYSTEM_ISOLATED` (`isolated=true`, `liveProjectWritable=false`, `networkPolicy=DENIED`).
2. `liveProjectWritable` is an enforced host guarantee, not a claim implied by a different working directory; a disposable copy alone is insufficient.
3. Rerun verification after the adapter reports truthful metadata.

#### Do not

**Do not weaken the required isolation policy to bypass contradictory metadata, and do not persist execution evidence that claims guarantees the host does not enforce.**

---

### Symptom: Installation Authority Required

#### Error Code: `E_INSTALLATION_AUTHORITY_REQUIRED`

#### What it means

ForgeLoop intercepted a command that attempted to install software or fetch remote packages without a verified host authority grant.

#### Likely causes

Running `npx`, `npm install`, `yarn add`, or `pnpm add` during `run-check` or `record-check`.

#### Safe recovery

Use non-installing execution equivalents (e.g. `npm test`, `node <script>`, `./node_modules/.bin/<tool>`).

---

### Symptom: Execution Reference Invalid

#### Error Code: `E_EXECUTION_REF_INVALID`

#### What it means

A check was claimed with a reference to an execution ID that does not exist in `.forgeloop/task-state/<taskKey>/executions/`.

#### Safe recovery

Execute the check through ForgeLoop CLI so that execution provenance is attested:

```bash
forgeloop run-check --task <id> --id <check-id> --requirement <requirement-id> -- <command...>
```

---

### Symptom: `forgeloop complete` returns `INCOMPLETE`

#### What it means

One or more contract success criteria have not been covered by passing verification checks.

#### Inspect

```bash
forgeloop audit --task <id> --json
```

Inspect the `coverage` array to find items with status `"NOT_VERIFIED"` or `"FAILED"`.

#### Safe recovery

1. Advance to `VERIFYING` if not already there:

   ```bash
   forgeloop advance --task <id> --to VERIFYING
   ```

2. Execute the missing check:

   ```bash
   forgeloop run-check --task <id> --id <id> --requirement <uncovered-requirement> -- <command...>
   ```

3. Advance to `REVIEWING` and retry `forgeloop complete --task <id> --json`.

---

### Symptom: `forgeloop complete` returns `INVALID`

#### What it means

Protocol integrity checks failed (e.g. ledger sequence error, missing contract deliverable, or hash mismatch).

#### Inspect

```bash
forgeloop validate-protocol --task <id> --json
```

#### Safe recovery

Inspect the specific error reported in `errors[]` and correct the inconsistent artifact.

---

### Symptom: Policy Lock Mismatch

#### Error Code: `E_POLICY_LOCK_MISMATCH`

#### What it means

The persisted `.forgeloop/policy/policy.lock` digest or required subdigests (`rulesDigest`, `baselineDigest`, `algorithm`) do not match current effective rules or baseline.

#### Inspect

```bash
forgeloop policy-status --json
```

#### Safe recovery

1. If rules or baseline were legitimately modified, re-evaluate and update the lock via discovery/baseline commands:

   ```bash
   forgeloop policy-discover --write --json
   forgeloop baseline --update --json
   ```

2. If modifications were unintentional, restore the previous `.forgeloop/policy/rules.json` or `.forgeloop/policy/baseline.json`.

3. Follow `forgeloop next --json` if returned recovery action is `RESTORE_POLICY`.

---

### Symptom: Capability Policy Epoch Drift

#### Error Code: `E_ACTION_POLICY_DRIFT`

#### What it means

The current capability-policy artifact no longer matches the policy lock or
the task-scoped policy snapshot. The same guard is enforced by
`action-authorize`, `next`, and `approval-request`.

#### Safe recovery

ForgeLoop fails closed before authorization guidance or approval creation. Do
not create an approval manually or retry `action-authorize` against the
modified file. Restore the policy epoch recorded at task activation, or use
the supported policy update flow to create a new lock and task snapshot, then
rerun:

```bash
forgeloop next --task <id> --json
```

Changing `capabilities.json` alone is not a valid policy update.

---

### Symptom: Invalid Policy Artifacts Fail Closed

#### Error Code: `E_POLICY_INVALID`

#### What it means

One or more executable policy artifacts (`.forgeloop/policy/rules.json`, `.forgeloop/policy/baseline.json`, `.forgeloop/policy/discovery.json`, or `.forgeloop/policy/policy.lock`) is present but malformed or fails schema validation. ForgeLoop does not silently ignore corrupt policy: preflight and completion fail closed.

#### Inspect

```bash
forgeloop policy-status --json
```

#### Safe recovery

1. Validate each policy artifact against its schema and repair the malformed JSON or invalid fields.

2. Re-run preflight:

   ```bash
   forgeloop preflight --task <id> --json
   ```

3. Follow `forgeloop next --task <id> --json` if the returned recovery action is `REPAIR_POLICY`.

---

### Symptom: Policy Weakening Detected

#### Error Code: `E_POLICY_WEAKENING`

#### What it means

Policy rules were relaxed or baseline debt expanded after the task policy snapshot was captured during preflight.

#### Safe recovery

1. Inspect the policy diff:

   ```bash
   forgeloop policy-diff --task <id> --json
   ```

2. Restore the original policy configuration captured in `.forgeloop/task-state/<taskKey>/policy-snapshot.json`.

3. Re-query `forgeloop next --task <id> --json` (returns `RESTORE_POLICY`).

---

### Symptom: Baseline Re-Record Blocked During Active Task

#### Error Code: `E_BASELINE_RECORD_DURING_ACTIVE_TASK`

#### What it means

`forgeloop baseline --record` was executed during an active task bound to a preflight policy snapshot. Re-recording during active tasks is blocked to prevent converting new violations into accepted debt.

#### Safe recovery

1. Fix newly introduced violations instead of recording them into baseline debt.

2. If resolving legacy debt, use monotonic ratchet-down:

   ```bash
   forgeloop baseline --update --json
   ```

3. If an intentional full baseline re-recording is authorized by an operator, supply the explicit authority flag:

   ```bash
   forgeloop baseline --record --policy-reset-authorized --json
   ```

---

### Symptom: Mutation Checker Execution Error

#### Error Code: `E_CHECK_MUTATION_EXECUTION_ERROR`

#### What it means

A policy rule checker threw an unhandled exception while evaluating its synthetic mutation fixture during `rule-verify`. A crashing checker cannot prove its mutation detection efficacy.

#### Safe recovery

1. Inspect the checker error stack and adapter implementation:

   ```bash
   forgeloop rule-verify --rule <rule-id> --json
   ```

2. Repair the unhandled exception path in the checker adapter.

3. Re-run `forgeloop rule-verify --rule <rule-id> --json` until the mutation is proven (`PROVEN`).

---

### Symptom: Workspace Binding Mismatch or Invalid Identity

#### Error Codes: `E_WORKSPACE_BINDING_MISMATCH`, `E_WORKSPACE_IDENTITY_UNAVAILABLE`, `E_WORKSPACE_BINDING_INVALID`

#### What it means

The task's optional workspace binding does not match the current repository or
worktree, or the identity cannot be derived or parsed. A branch name or HEAD
alone is not a complete workspace identity.

#### Safe recovery

Inspect the derived result and current task before changing anything:

```bash
forgeloop workspace-status --task <id> --json
forgeloop status --task <id> --json
forgeloop inspect --task <id> --json
```

Return to the bound checkout or create a deliberate new task/worktree. Do not
edit `workspace-binding.json` manually or bypass the boundary. Rebinding is an
explicit operation only when the task's scope permits it.

---

### Symptom: Advisory Context Recall Is Unavailable or Rejected

#### Error Codes: `E_ADVISORY_CONTEXT_PROVIDER_INVALID`, `E_ADVISORY_CONTEXT_PROVIDER_UNAVAILABLE`, `E_ADVISORY_CONTEXT_QUERY_INVALID`, `E_ADVISORY_CONTEXT_REQUEST_INVALID`, `E_ADVISORY_CONTEXT_RESULT_INVALID`, `E_ADVISORY_CONTEXT_TIMEOUT`, `E_ADVISORY_CONTEXT_OUTPUT_LIMIT`, `E_PORTABLE_CONTEXT_INVALID`

#### What it means

The host's optional advisory provider is missing, malformed, unavailable, too
slow, or returned content outside the bounded portable-context contract. These
failures never become lifecycle, evidence, completion, or next-action failures.

#### Safe recovery

Inspect provider registration and normalize the request before retrying through
the Integration API. Reduce query, item, total-output, and timeout values to the
documented budgets, remove secrets/control characters, and ensure the provider
returns only allowlisted item fields. If advisory context is unavailable,
continue from canonical task state; do not fabricate a provider or execute its
text.

### Symptom: Continuity Lint Reports a Contradictory Hint

Continuity lint is diagnostic only. Its findings do not change reconciliation,
state, evidence, authority, or completion:

| Finding | Meaning | Safe response |
| --- | --- | --- |
| `CONTINUITY_REMAINING_ALREADY_COMPLETED` | A remaining-work item is already recorded as completed. | Refresh the operational note; do not change canonical completion evidence. |
| `CONTINUITY_FOCUS_ALREADY_COMPLETED` | The current focus ID is already completed. | Choose a current inspection focus or clear the hint. |
| `CONTINUITY_ITEM_ROLE_CONFLICT` | An item appears in both remaining work and known issues. | Remove the contradictory hint through `record-continuity`. |
| `CONTINUITY_INSPECT_PATH_MISSING` | An `inspectFirst` path is not present in the current target. | Reconcile the checkout and update the path hint. |
| `CONTINUITY_EMPTY_HINT_SET` | No operational hint was supplied. | Treat the result as informational and follow canonical `next`. |

### Symptom: Handoff Is Invalid or Tampered

#### Error Codes: `E_HANDOFF_INVALID`, `E_HANDOFF_STATE_UNAVAILABLE`, `E_HANDOFF_TAMPERED`, `E_HANDOFF_NOT_FOUND`, `E_HANDOFF_STALE`, `E_HANDOFF_ALREADY_ACCEPTED`, `E_HANDOFF_ACCEPTANCE_INCONSISTENT`

#### What it means

The immutable handoff envelope is malformed, its state is unavailable, its
digest no longer matches, or the requested snapshot does not exist. A handoff
note is not delegation, authority, independent review evidence, or completion
evidence. Acceptance is exactly-once operational receipt only. The current
repository branch and HEAD are checked directly, so clean committed checkout
drift can make a handoff stale even when changed paths are empty.

#### Safe recovery

```bash
forgeloop handoff-list --task <id> --json
forgeloop handoff-show --task <id> --id <handoffId> --json
forgeloop continuity --task <id> --json
forgeloop reconcile-continuity --task <id> --json
```

If `handoff-list` or `handoff-show` reports `INCONSISTENT`, inspect the
`reasonCodes` field. The commands validate the event ledger before projecting
acceptance and never turn an unreadable or invalid ledger into an empty ledger.
Repair the named ledger through the canonical protocol workflow; do not edit
`events.ndjson` by hand.

Use the last valid handoff or continuity only to focus inspection, then trust
the canonical task state and checkout. Never repair a handoff by editing or
deleting its JSON file.

---

### Symptom: Responsibility Contract Rejects a Pass

#### Error Codes: `E_RESPONSIBILITY_INVALID`, `E_RESPONSIBILITY_SCOPE_VIOLATION`, `E_RESPONSIBILITY_FROZEN_INPUT_DRIFT`, `E_RESPONSIBILITY_REQUIRED_CHECK_MISSING`

#### What it means

An optional responsibility contract is malformed, a changed path is outside
the allowed boundary, a frozen contract/route/claims input drifted, or a
required check is missing. Its label is descriptive and does not represent a
coder, reviewer, or cleaner role.

#### Safe recovery

```bash
forgeloop responsibility-status --task <id> --json
forgeloop inspect --task <id> --json
forgeloop next --task <id> --json
```

Restore the declared scope or create a new explicit responsibility decision
through `responsibility-set`. Do not widen the JSON artifact manually and do
not relabel the pass to bypass enforcement.

---

### Symptom: Verification Scope Is Stale or Unresolved

#### Error Codes: `E_VERIFICATION_SCOPE_INVALID`, `E_VERIFICATION_SCOPE_STALE`, `E_VERIFICATION_SCOPE_UNRESOLVED`

#### What it means

The scope is malformed or no longer matches the task's cycle, claims, contract,
repository fingerprint, changed paths, or checker capability. `CHANGED` and
`CLAIMED` require a trusted scoped checker; `AUTO` uses those modes only when
they can be proved and otherwise resolves to `FULL`. There is no heuristic
`IMPACTED` mode.

#### Safe recovery

```bash
forgeloop verify-scope --task <id> --mode AUTO --json
forgeloop run-check --task <id> --id <checkId> \
  --requirement "<requirement>" \
  --scope-ref .forgeloop/task-state/<taskKey>/verification-scope.json \
  -- <exact-argv-prefix-and-paths>
```

If no trusted scoped checker is configured, run a full check or record the
scope as unresolved. An exact argv or selected-path mismatch is rejected before
launch; do not retry with guessed paths or edit the scope artifact.

---

### Symptom: Attestation or Revision Coverage Is Invalid

#### Error Codes: `E_ATTESTATION_MANIFEST_INVALID`, `E_ATTESTATION_MANIFEST_STALE`, `E_ATTESTATION_STATEMENT_INVALID`, `E_ATTESTATION_UNSIGNED`, `E_ATTESTATION_SIGNATURE_INVALID`, `E_ATTESTATION_SIGNER_UNAVAILABLE`, `E_ATTESTATION_IDENTITY_UNTRUSTED`, `E_ATTESTATION_ISSUER_UNTRUSTED`, `E_ATTESTATION_COVERAGE_GAP`, `E_ATTESTATION_COVERAGE_CONFLICT`, `E_REVISION_PROVIDER_UNAVAILABLE`, `E_REVISION_CONTENT_UNAVAILABLE`

#### What it means

The exact source-content manifest, completion/ledger binding, in-toto
statement, signer policy, revision provider, or range coverage is missing,
stale, invalid, unavailable, or conflicting. `PROCESSED` is not `VERIFIED`,
and `VERIFIED` is not `ATTESTED` without a valid external signature.

#### Safe recovery

Use read-only inspection first:

```bash
forgeloop attestation-status --task <id> --json
forgeloop attestation-verify --task <id> --ref HEAD --json
forgeloop attestation-verify-range --revision-provider git \
  --base origin/main --head HEAD --require-complete-coverage --json
```

Correct the named source or provider boundary through its canonical lifecycle.
Uncovered paths and conflicting task digests fail closed; an unavailable signer
does not become a valid signature. Never edit a manifest, statement, receipt,
ledger, or signature bundle manually, and never persist credentials in them.

---

### Symptom: Another Harness Cannot Resume

#### Likely causes

1. The new harness started by creating a new contract instead of discovering existing tasks via `task-list` or `status`.
2. State is locked in a terminal or blocked condition.

#### Safe recovery

In the new harness:

```bash
# 1. Discover existing state
forgeloop task-list --json
forgeloop status --task <id> --json

# 2. Reconcile continuity
forgeloop reconcile-continuity --task <id> --json

# 3. Ask for next action
forgeloop next --task <id> --json
```

---

### Symptom: Structural-quality evidence is missing or blocked

#### Error Codes: `E_STRUCTURAL_QUALITY_BASELINE_MISSING`, `E_STRUCTURAL_QUALITY_BASELINE_PHASE_INVALID`, `E_STRUCTURAL_QUALITY_PROVIDER_UNAVAILABLE`

This applies when structural quality is configured in `gate` mode but a valid
baseline or current provider observation is unavailable. `preflight` can be
ready before the baseline exists, but `PLANNED` cannot enter `EXECUTING` until
the baseline is captured. A missing provider is a visible limitation in
`observe` mode and a blocker in `gate` mode.

Inspect the persisted projection without launching a provider:

```bash
forgeloop quality-status --task <id> --json
forgeloop next --task <id> --json
```

Capture the baseline only in `PLANNED` after a valid preflight:

```bash
forgeloop quality-baseline --task <id> --json
```

Do not replace a baseline after execution begins. Install or upgrade Sentrux
only through a separately authorized, user-managed process.

### Symptom: Structural-quality verification reports a regression

#### Error Code: `E_STRUCTURAL_QUALITY_REGRESSION`

The current observation violated the configured aggregate, dimension, cycle, or
minimum policy. An improving aggregate can still fail when a dimension budget
or cycle rule fails. Inspect the evidence and follow the normal diagnosis and
correction lifecycle. Use the evaluation artifact reference returned by
`quality-verify` as evidence when recording the diagnosis.

```bash
forgeloop quality-status --task <id> --json
forgeloop next --task <id> --json
```

The evaluation's bottleneck, root-cause deltas, failed conditions, and artifact
reference are evidence. ForgeLoop does not auto-create a diagnosis and does not
accept a repeated hypothesis without new information.

### Symptom: Structural-quality provider is unavailable or invalid

#### Error Codes: `E_STRUCTURAL_QUALITY_PROVIDER_INVALID`, `E_STRUCTURAL_QUALITY_PROVIDER_VERSION_UNSUPPORTED`, `E_STRUCTURAL_QUALITY_PROVIDER_PROTOCOL_INVALID`, `E_STRUCTURAL_QUALITY_SCAN_FAILED`, `E_STRUCTURAL_QUALITY_TIMEOUT`, `E_STRUCTURAL_QUALITY_OUTPUT_LIMIT`

The provider boundary failed closed because detection, version, MCP protocol,
scan, timeout, or output limits were not satisfied. Raw MCP streams are never
persisted and partial provider output is never a passing observation.

Use the configured mode's semantics: `observe` records `NOT_OBSERVED`, while
`gate` records `BLOCKED` and keeps completion unavailable. Check the provider's
own installation and logs, then rerun the same ForgeLoop command after the
cause is understood. The project configuration cannot select an executable,
shell, arbitrary arguments, or a score override.

### Symptom: Structural-quality evidence is stale or incomparable

#### Error Codes: `E_STRUCTURAL_QUALITY_BASELINE_BINDING_MISMATCH`, `E_STRUCTURAL_QUALITY_EVALUATION_INCOMPARABLE`, `E_STRUCTURAL_QUALITY_EVIDENCE_STALE`, `E_STRUCTURAL_QUALITY_SOURCE_FINGERPRINT_UNAVAILABLE`

The baseline and current evaluation no longer describe the same task inputs.
Provider ID or version, policy, route, contract, scan scope, or
`.sentrux/rules.toml` drift makes the comparison incomparable. A prior-cycle
pass cannot satisfy a current-cycle gate. If source material cannot be read
or contains an unsafe symlink, ForgeLoop returns
`E_STRUCTURAL_QUALITY_SOURCE_FINGERPRINT_UNAVAILABLE` and does not persist a
passing observation.

Inspect the bound artifacts and current projection:

```bash
forgeloop quality-status --task <id> --json
forgeloop audit --task <id> --json
```

Resolve the legitimate drift through the normal task lifecycle. Do not edit a
baseline or evaluation by hand, and do not use a bundle as a reason to bypass
current-cycle validation.

### Symptom: Repository Index is not ready

#### What it means

`forgeloop index-status` did not report `READY`. For a Git repository the
engine is mandatory, so `doctor` and repository-wide search remain unhealthy
until the pinned binary, derived index, and ForgeLoop-owned watcher are
verified.

#### Inspect

```bash
forgeloop index-status --json
forgeloop doctor --json
```

#### Safe recovery

1. Run `forgeloop index-start --json` when the index is complete but the
   watcher is down.
2. Run `forgeloop index-setup --asset /absolute/path/to/pinned-asset.tar.gz`
   for a missing engine or an air-gapped host.
3. Run `forgeloop index-rebuild --json` after corruption or a confirmed stale
   index.

Never delete the whole `.forgeloop` directory and never stop a process by
executable name. A status of `DEFERRED` for a non-Git protocol fixture is
intentional and is not evidence that a real repository is healthy.

### Symptom: Repository search fails

#### What it means

The provider-neutral search service rejected the request, could not verify the
managed engine, or received an invalid native result. Search never falls back
silently to `rg`, `grep`, or an arbitrary `PATH` executable.

#### Inspect

```bash
forgeloop search "pattern" --json
forgeloop index-status --json
```

Correct request bounds such as the pattern, filters, context, or `max-count`
when the error is `E_REPOSITORY_INDEX_REQUEST_INVALID`. For
`E_REPOSITORY_INDEX_OUTPUT_INVALID`, preserve the bounded diagnostic and
rebuild; repeated malformed output indicates a pinned-engine regression.
Native exit code `1` means no matches and is normalized to a successful empty
ForgeLoop result. Native exit code `2` is an actual search failure.

### Symptom: Persistent search host is unavailable

#### What it means

The CLI-only local transport could not connect to or start its user-scoped
ForgeLoop host within the bounded startup/request timeout. This is a transport
failure, not permission to bypass the mandatory Repository Index or switch to
`rg`, `grep`, or an arbitrary executable.

#### Inspect

```bash
forgeloop doctor --json
forgeloop index-status --json
forgeloop search "pattern" --json
```

#### Safe recovery

Retry the search once after confirming that the current package is complete
and the managed Repository Index reports `READY`. The client performs at most
one bounded transport recovery attempt. If it still fails, preserve the
structured error and follow the Repository Index recovery procedure above;
transport recovery does not rebuild task state or completion evidence.

`E_PERSISTENT_TRANSPORT_UNAVAILABLE`,
`E_PERSISTENT_TRANSPORT_TIMEOUT`, and
`E_PERSISTENT_TRANSPORT_START_FAILED` identify the local transport boundary.
The canonical search error, if one is returned after a successful connection,
must be diagnosed as a Repository Index or request error instead.

### Symptom: Persistent search host ownership is unverified or stale

#### What it means

The local state or endpoint does not prove that the live process is the expected
ForgeLoop persistent host. Common causes include a host from another package
version, a process that exited while state remained, endpoint substitution, or
PID reuse. A PID or process name alone is never sufficient ownership evidence.

#### Inspect

```bash
forgeloop doctor --json
forgeloop search "pattern" --json
```

The sanitized `persistentTransport` status reports only its public schema,
state, running/owned flags, and protocol/package versions. It intentionally
does not print endpoint, home, lock, repository, index, binary, or entrypoint
paths.

#### Safe recovery

Allow the CLI's bounded recovery path to reconcile a stale or incompatible
transport state. Explicit shutdown also requires a verified endpoint and nonce.
If the status remains `OWNERSHIP_UNVERIFIED`, do not kill a PID or delete a
whole `.forgeloop` directory; inspect the structured error and use the normal
package/process recovery boundary. The relevant stable codes are
`E_PERSISTENT_TRANSPORT_OWNERSHIP_UNVERIFIED`,
`E_PERSISTENT_TRANSPORT_HOST_STALE`, and
`E_PERSISTENT_TRANSPORT_PROTOCOL_MISMATCH`.

## Stable Error and Reason Codes

<!-- BEGIN FORGELOOP GENERATED: public-error-codes -->

| Code | Meaning | Safe Resolution |
| --- | --- | --- |
| `E_ACTION_APPROVAL_NOT_REQUIRED` | The current capability policy allows the action without an approval artifact. | Do not create an approval; authorize the action through the current policy path. |
| `E_ACTION_APPROVAL_REQUIRED` | Policy requires a current fingerprint-bound approval before this action may proceed. | Request approval with forgeloop approval-request and resolve it via forgeloop approval-resolve, then rerun the action. |
| `E_ACTION_AUTHORITY_REQUIRED` | Policy requires host-attested authority that was not supplied through a host trust boundary. | Perform the action through a host integration that supplies trusted authority context; standalone CLI cannot mint it. |
| `E_ACTION_AUTHORIZATION_INVALID` | Action authorization evidence is missing, incomplete, or was not produced by the canonical authorization service. | Authorize the action through forgeloop run-action or a trusted embedding host; caller surfaces can never mint AUTHORIZED. |
| `E_ACTION_CAPABILITY_DENIED` | Capability policy denies this capability. | Obtain an operator policy change outside the task, or do not perform the action. |
| `E_ACTION_CAPABILITY_UNKNOWN` | Action capability is not part of the canonical capability vocabulary. | Use a documented capability from forgeloop protocol-info; unknown capabilities fail closed. |
| `E_ACTION_COMMIT_UNKNOWN` | External commit state of a started action cannot be proven. | Do not retry; reconcile the observed external state with forgeloop action-reconcile. |
| `E_ACTION_EVIDENCE_INVALID` | Evidence supplied for verification or reconciliation is missing, malformed, or unbounded. | Supply bounded evidence references appropriate to the action type; do not paste raw external output into the ledger. |
| `E_ACTION_IDEMPOTENCY_CONFLICT` | The idempotency key already binds to a different canonical action fingerprint in this task. | Use a new idempotency key with a new actionId, or reuse the existing logical action unchanged; never relabel an executed effect. |
| `E_ACTION_IDEMPOTENCY_REQUIRED` | Side-effecting action class requires an idempotency key. | Supply a stable --idempotency-key that identifies the logical external action. |
| `E_ACTION_INVALID` | Durable action artifact or parameters are malformed or schema-invalid. | Correct the action fields reported by the structured error, then retry through forgeloop action-propose or run-action. |
| `E_ACTION_NOT_FOUND` | Referenced durable action ID does not exist for the task. | List actions with forgeloop action-show or propose the action first. |
| `E_ACTION_POLICY_DRIFT` | The current capability policy does not match the policy lock or task policy snapshot binding this task. | Restore the policy epoch recorded at task activation or create a new valid lock and snapshot before side effects. |
| `E_ACTION_POLICY_LOCK_REQUIRED` | A capability policy is present but no valid policy lock exists to bind authorization identity. | Record a valid policy lock (forgeloop baseline or policy-discover --write) before authorizing durable actions. |
| `E_ACTION_RECONCILIATION_AUTHORITY_REQUIRED` | Settling COMMIT_UNKNOWN external state requires trusted host attestation that was not supplied out-of-band. | Reconcile through a trusted embedding host boundary; actor-supplied observations may only record UNKNOWN. |
| `E_ACTION_RECONCILIATION_EVIDENCE_INVALID` | Settling reconciliation requires at least one bounded evidence reference binding the observation to the action. | Supply bounded external-state evidence references alongside trusted authority before settling ambiguity. |
| `E_ACTION_RECONCILIATION_REQUIRED` | An action is COMMIT_UNKNOWN and blocks progress until explicitly reconciled. | Observe the external system and run forgeloop action-reconcile --outcome COMMITTED\|NOT_COMMITTED\|UNKNOWN with evidence references. |
| `E_ACTION_STATE_MISMATCH` | Requested durable action transition is not part of the canonical state machine. | Inspect current action state with forgeloop action-show and use a legal transition; never edit action artifacts by hand. |
| `E_ACTION_VERIFICATION_INVALID` | Verification evidence does not resolve to a canonical passed ForgeLoop artifact bound to this task and action. | Supply a canonical execution or check reference produced by run-check for this task; arbitrary strings fail closed. |
| `E_ACTION_VERIFICATION_REQUIRED` | The action cannot reach VERIFIED through this surface; canonical independent postcondition evidence is required. | Run an independent verification check, then record it with forgeloop action-verify; exit code 0 alone is not verification. |
| `E_ADVISORY_CONTEXT_OUTPUT_LIMIT` | Advisory context output exceeded the configured character or item limit. | Reduce query scope, limit items, or truncate oversized summaries at the provider. |
| `E_ADVISORY_CONTEXT_PROVIDER_INVALID` | Advisory context provider configuration or interface implementation is invalid. | Use a provider implementing id, recall(input) with bounded query parameters; advisory context is optional. |
| `E_ADVISORY_CONTEXT_PROVIDER_UNAVAILABLE` | Requested advisory context provider is not registered in runtime context. | Register the provider in runtime context before recall, or proceed without advisory context; provider failure never blocks canonical lifecycle. |
| `E_ADVISORY_CONTEXT_QUERY_INVALID` | Advisory context query failed portable-context validation or exceeded budget. | Provide a bounded query free of control characters and secret-like values. |
| `E_ADVISORY_CONTEXT_REQUEST_INVALID` | Advisory context recall budgets are not finite integer values within the supported request contract. | Provide finite integer limit, maxItemChars, maxTotalChars, and timeoutMs values; oversized valid values are clamped to documented maxima. |
| `E_ADVISORY_CONTEXT_RESULT_INVALID` | Advisory context provider returned an invalid result structure. | Ensure provider returns items with string summary and optional title, sourceRef, observedAt, confidence. |
| `E_ADVISORY_CONTEXT_TIMEOUT` | Advisory context recall exceeded its execution timeout. | Use a responsive provider or increase timeout within limits; advisory context is optional. |
| `E_APPROVAL_ALREADY_RESOLVED` | Approval is one-time resolvable and has already been approved or rejected. | Request a new approval if another decision is required. |
| `E_APPROVAL_INVALID` | Approval artifact is malformed or does not bind the required fingerprint tuple. | Request a new approval with forgeloop approval-request; never hand-edit approval artifacts. |
| `E_APPROVAL_STALE` | Approval no longer matches the current action fingerprint, contract fingerprint, task revision, or capability. | Request and resolve a fresh approval against the current action revision. |
| `E_ATTESTATION_CONFIGURATION_INVALID` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_ATTESTATION_CONTENT_MISMATCH` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_ATTESTATION_CONTRACT_MISMATCH` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_ATTESTATION_COVERAGE_CONFLICT` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_ATTESTATION_COVERAGE_GAP` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_ATTESTATION_DISABLED` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_ATTESTATION_GIT_REQUIRED` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_ATTESTATION_IDENTITY_UNTRUSTED` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_ATTESTATION_INVALID` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_ATTESTATION_ISSUER_UNTRUSTED` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_ATTESTATION_LEDGER_MISMATCH` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_ATTESTATION_MANIFEST_INVALID` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_ATTESTATION_MANIFEST_MISSING` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_ATTESTATION_MANIFEST_STALE` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_ATTESTATION_RECEIPT_MISMATCH` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_ATTESTATION_ROUTE_MISMATCH` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_ATTESTATION_SCOPE_MISMATCH` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_ATTESTATION_SIGNATURE_INVALID` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_ATTESTATION_SIGNER_UNAVAILABLE` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_ATTESTATION_STATEMENT_INVALID` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_ATTESTATION_STATEMENT_MISSING` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_ATTESTATION_STATE_MISMATCH` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_ATTESTATION_SUBJECT_MISMATCH` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_ATTESTATION_TARGET_REF_INVALID` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_ATTESTATION_UNSIGNED` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_AUTHORITY_INVALID` | Authority grant file is malformed or expired. | Obtain a valid authority grant from host operator. |
| `E_AUTHORITY_SCOPE_MISMATCH` | Authority grant does not cover the requested package. | Request updated authority scope. |
| `E_AUTHORITY_UNTRUSTED_SOURCE` | Authority file placed inside untrusted project tree. | Place authority file in host-managed trusted location. |
| `E_BASELINE_EXPANSION` | Attempted unauthorized addition of new violations to brownfield baseline. | Resolve new violations rather than expanding the baseline. |
| `E_BASELINE_RECORD_DURING_ACTIVE_TASK` | Cannot re-record baseline during an active task with policy snapshot. | Resolve new violations or use monotonic baseline --update. |
| `E_CHECK_INERT` | An enabled check has no effective scope or target files. | Provide an applicable target scope, configure matching files, or mark the rule unsupported. |
| `E_CHECK_INVALID` | Check structure or required parameters are invalid. | Provide valid check ID, requirement, and parameters. |
| `E_CHECK_MUTATION_EXECUTION_ERROR` | A policy checker threw an unhandled exception while evaluating its mutation fixture. | Repair the checker execution path and rerun rule verification. |
| `E_CHECK_MUTATION_NOT_DETECTED` | A blocking rule checker failed to detect an intentional mutation fixture. | Fix checker logic to properly identify target violations. |
| `E_CHECK_STATUS_CONTRADICTION` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_CIRCULAR_COMPLETION_REQUIREMENT` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_CLI_INVOCATION_INVALID` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_COMMAND_RESOLUTION_AMBIGUOUS` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_COMPLETION_OWNERSHIP_UNPROVEN` | Work-state claims COMPLETE but the canonical lifecycle/ledger completion proof is missing or invalid, so historical claims stay reserved. | Restore the canonical completion event and a valid ledger, or re-run the official completion pipeline; phase=COMPLETE alone never releases claims. |
| `E_COMPLETION_RECOVERY_UNAUTHORIZED` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_COMPLETION_REJECTED` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_COMPLETION_REJECTION_LEDGER_MISMATCH` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_COMPLETION_REJECTION_RECEIPT_FINGERPRINT_MISMATCH` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_COMPLETION_REJECTION_STATE_FINGERPRINT_MISMATCH` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_CONTINUITY_CONTRACT_MISMATCH` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_CONTINUITY_INVALID` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_CONTINUITY_PHASE_MISMATCH` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_CONTINUITY_RECONCILIATION_REQUIRED` | Continuity context has drifted from work state. | Run forgeloop reconcile-continuity --json. |
| `E_CONTINUITY_SCHEMA_UNSUPPORTED` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_CONTINUITY_STATE_MISSING` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_CONTINUITY_TASK_MISMATCH` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_CONTRACT_INVALID` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_CONTRACT_MISSING` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_CONTRACT_STALE` | Contract modified after downstream artifacts were generated. | Re-run forgeloop route and forgeloop preflight. |
| `E_CONTRACT_UNRESOLVED_DECISION` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_CONTRIBUTOR_INVALID` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_CONTRIBUTOR_REFERENCE_INVALID` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_DECISION_CRITERION_INVALID` | Decision settlement criterion details or parameters are malformed. | Provide non-empty decision text and settledBy criterion. |
| `E_DECISION_NOT_UNRESOLVED` | A settlement criterion referenced a decision not present in current unresolvedDecisions. | Use the exact current unresolved decision text or update the contract first. |
| `E_DIAGNOSIS_CYCLE_MISMATCH` | Diagnosis verification cycle does not match the active work state verification cycle. | Record diagnosis for the current active verification cycle. |
| `E_DIAGNOSIS_EVIDENCE_INVALID` | Referenced diagnosis evidence is missing or has no failed checks in the current cycle. | Reference at least one failed or blocked check ID from the active verification cycle. |
| `E_DIAGNOSIS_INVALID` | Diagnosis record details or parameters are malformed. | Provide valid failureClass, hypothesis, evidenceRefs, settledBy, and nextSafeAction. |
| `E_DIAGNOSIS_NO_NEW_INFORMATION` | The proposed retry repeats the previous hypothesis with the same evidence. | Change the hypothesis, collect independent evidence, or change strategy. |
| `E_DIAGNOSIS_REQUIRED` | Current correction cycle has no append-only diagnosis record. | Run forgeloop record-diagnosis with current failed evidence before correcting. |
| `E_DIAGNOSTIC_CASE_CYCLE_MISMATCH` | Diagnostic case verification cycle does not match the active work state verification cycle. | Record the diagnostic case for the current active verification cycle. |
| `E_DIAGNOSTIC_CASE_EVIDENCE_INVALID` | A diagnostic case evidence reference does not match any check from the active verification cycle. | Reference check IDs recorded during the active verification cycle. |
| `E_DIAGNOSTIC_CASE_INVALID` | Structured diagnostic case details or parameters are malformed. | Provide valid observations, contributors, hypotheses with settlement criteria, and nextSafeAction. |
| `E_EFFICIENCY_BASELINE_INVALID` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_EVIDENCE_COVERAGE_INVALID` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_EVIDENCE_COVERAGE_PARTIAL` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_EVIDENCE_INVALID` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_EVIDENCE_KIND_INVALID` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_EVIDENCE_PARTIAL` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_EVIDENCE_REQUIRED` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_EVIDENCE_STALE` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_EXECUTION_PROFILE_INCONSISTENT` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_EXECUTION_PROFILE_INVALID` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_EXECUTION_PROFILE_SAFETY_FLOOR_INVALID` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_EXECUTION_REF_INVALID` | Referenced execution ID does not exist. | Re-run check via forgeloop run-check. |
| `E_FAILURE_SIGNATURE_INVALID` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_FUTURE_LIFECYCLE_EVIDENCE` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_FUTURE_TERMINAL_EVIDENCE` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_GATE_REQUIRED` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_GATE_STALE` | Referenced gate artifact changed after approval. | Update artifact SHA-256 in gate file. |
| `E_GATE_UNVERIFIED` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_HANDOFF_ACCEPTANCE_INCONSISTENT` | Handoff acceptance disagrees with task event ledger history. | Verify ledger integrity and require a preceding valid HANDOFF_CREATED event. |
| `E_HANDOFF_ACCEPTANCE_UNBOUND` | Handoff snapshot lacks required workStateFingerprint binding. | Create a fresh handoff from the current ForgeLoop version before accepting it. |
| `E_HANDOFF_ALREADY_ACCEPTED` | Handoff was already accepted by a different consumer. | Create a new handoff for the new consumer; do not manually edit acceptance events. |
| `E_HANDOFF_INVALID` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_HANDOFF_NOT_FOUND` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_HANDOFF_STALE` | Handoff snapshot has drifted from the current canonical task state or repository. | Create a new fresh handoff from the current task state instead of accepting a stale snapshot. |
| `E_HANDOFF_STATE_UNAVAILABLE` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_HANDOFF_TAMPERED` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_HYPOTHESIS_DISPOSITION_EVIDENCE_INVALID` | Hypothesis disposition evidence references do not resolve to checks of the active cycle. | Reference at least one check ID recorded in the active verification cycle. |
| `E_HYPOTHESIS_DISPOSITION_INVALID` | Hypothesis disposition is malformed or references an unknown hypothesis or disallowed transition. | Record a disposition for a known hypothesis using an allowed status transition. |
| `E_HYPOTHESIS_INVALID` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_HYPOTHESIS_SETTLEMENT_MISSING` | An open hypothesis lacks a falsifiable settlement condition. | Provide a structured settledBy predicate, check status, or observation binding. |
| `E_INIT_KIT_CONFLICT` | A canonical ForgeLoop kit destination already exists with content that does not match the shipped canonical template. | Inspect the conflicting `.forgeloop/kit/...` file. If it is stale or partial ForgeLoop output, remove or restore it and rerun `forgeloop init`. Do not overwrite unknown content automatically. |
| `E_INSTALLATION_AUTHORITY_REQUIRED` | Attempted software installation without host authority grant. | Use local non-installing binaries or request host authority grant. |
| `E_INTERVENTION_HYPOTHESIS_MISSING` | Intervention does not bind to any hypothesis. | Bind the intervention to at least one recorded hypothesis. |
| `E_INTERVENTION_INVALID` | Intervention record is malformed. | Provide id, kind, statement, and at least one bound hypothesisRef. |
| `E_INTERVENTION_REFERENCE_INVALID` | Intervention references an unknown hypothesis. | Record the diagnostic case containing the hypothesis before recording the intervention. |
| `E_LEGACY_RECOVERY_MIGRATION_INVALID` | The legacy recovery-event repair was refused because the ledger does not match the exact known legacy defect signature, has incompatible later activity, holds a live lock, or is otherwise ambiguous. | Inspect the structured plan/errors; ambiguous or tampered ledgers stay INCONSISTENT and are never migrated. |
| `E_MIGRATION_INCOMPLETE` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_MIGRATION_WRITE_VERIFY` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_MIXED_TERMINAL_REQUIREMENT` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_NATIVE_ADAPTER_STALE` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_NATIVE_ADAPTER_TARGET_MISSING` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_NEW_POLICY_VIOLATION` | New executable policy violation detected that is not present in brownfield baseline. | Fix the violation before completing the task. |
| `E_OBSERVATION_INVALID` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_PERSISTENT_TRANSPORT_FRAME_INVALID` | The local persistent-search byte stream did not contain a complete valid JSON frame. | Retry the bounded local request; inspect the host only if malformed frames recur. |
| `E_PERSISTENT_TRANSPORT_FRAME_TOO_LARGE` | A persistent-search request or response exceeded its bounded frame limit. | Narrow the search request or inspect the host resource boundary; oversized frames are rejected. |
| `E_PERSISTENT_TRANSPORT_HOST_STALE` | Persistent-search state points to a host process that is no longer running. | Retry the CLI search so ForgeLoop can remove only the verified stale host state and restart it. |
| `E_PERSISTENT_TRANSPORT_INVALID_REQUEST` | A local persistent-search request is outside the versioned transport contract. | Use the supported ForgeLoop search command or update the compatible client and host together. |
| `E_PERSISTENT_TRANSPORT_INVALID_RESPONSE` | The persistent-search host returned a response outside the versioned transport contract. | Retry once through the bounded recovery path; do not consume an unvalidated response. |
| `E_PERSISTENT_TRANSPORT_OWNERSHIP_UNVERIFIED` | ForgeLoop could not prove that the process or endpoint belongs to its user-scoped persistent-search host. | Do not terminate the process; inspect the endpoint and retry after resolving the ownership conflict. |
| `E_PERSISTENT_TRANSPORT_PROTOCOL_MISMATCH` | The persistent-search client and host do not agree on the supported protocol version. | ForgeLoop may replace only a verified compatible host; otherwise update the installed package and retry. |
| `E_PERSISTENT_TRANSPORT_START_FAILED` | The user-scoped persistent-search host could not start or become ready within its bounded startup window. | Inspect the structured diagnostics and retry; direct integration APIs remain available without this optimization. |
| `E_PERSISTENT_TRANSPORT_TIMEOUT` | A persistent-search connection, handshake, or request exceeded its bounded timeout. | Retry once through the ownership-checked recovery path and inspect host/index health if it persists. |
| `E_PERSISTENT_TRANSPORT_UNAVAILABLE` | The user-scoped persistent-search endpoint was not reachable. | ForgeLoop starts one verified local host and retries once; persistent failure is reported without an rg fallback. |
| `E_PHASE_CHRONOLOGY_INVALID` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_PHASE_PREREQUISITE_MISSING` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_PHASE_TRANSITION_INVALID` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_POLICY_DRIFT` | Active policy lock does not match the policy snapshot captured at task activation. | Re-verify affected checks or restore original policy. |
| `E_POLICY_DRIFT_UNKNOWN` | Task policy drift was detected but baseline snapshot details are unavailable. | Re-verify the task under the current policy state. |
| `E_POLICY_EVALUATION_FAILED` | Policy evaluation threw an unexpected error during execution. | Inspect policy configuration and checker adapters for unhandled errors. |
| `E_POLICY_INITIALIZATION_FAILED` | Executable policy bootstrap could not complete during initialization. | Repair the reported filesystem/schema error and rerun `forgeloop init`. Initialization is restartable while no committed manifest exists. |
| `E_POLICY_INVALID` | Policy artifact is malformed, corrupt, or schema-invalid. | Validate and repair rules.json, baseline.json, or discovery.json against schema. |
| `E_POLICY_LOCK_INVALID` | Policy lockfile is missing, malformed, or corrupt. | Run forgeloop policy-status or regenerate policy.lock. |
| `E_POLICY_LOCK_MISMATCH` | Persisted policy lock digest does not match current effective policy state. | Re-evaluate effective rules and update policy.lock or restore modified rules. |
| `E_POLICY_PROOF_STALE` | Mutation verification proof is stale due to checker or fixture modifications. | Re-run forgeloop rule-verify to refresh mutation proof. |
| `E_POLICY_SNAPSHOT_WRITE_FAILED` | Failed to persist task policy snapshot during preflight. | Ensure the target task directory is writable and repair filesystem permissions. |
| `E_POLICY_WEAKENING` | Policy rules were weakened during task execution without explicit authority. | Restore the original policy configuration. |
| `E_PORTABLE_CONTEXT_INVALID` | Text or object failed portable-context safety, character, or secret limits. | Ensure text is bounded, contains no control characters, and contains no secret-like values. |
| `E_PREFLIGHT_EVENT_MISSING` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_PREFLIGHT_GATES_STALE` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_PREFLIGHT_GATE_EVENT_MISSING` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_PREFLIGHT_NOT_READY` | Preflight gates or contract validations are incomplete. | Satisfy required gates and check preflight output. |
| `E_PREFLIGHT_READY_EVENT_MISMATCH` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_PREFLIGHT_READY_EVENT_MISSING` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_PRODUCTION_READINESS_UNVERIFIED` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_PRODUCTION_REQUIREMENT_PENDING` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_PROFILE_SOURCE_MISCLASSIFIED` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_PROFILE_SOURCE_MISSING` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_PROFILE_SOURCE_UNKNOWN` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_PROFILE_UNVERIFIED` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_PROGRESS_STALLED` | Persisted correction history shows no new diagnostic information. | Use an independent check, revisit assumptions, or record a materially different diagnosis. |
| `E_PROJECT_CLAIMS_LOCK_INCONSISTENT` | The project-wide claim reservation lock has unknown, corrupt, or concurrently changed ownership metadata. | Inspect .forgeloop/.claims.lock and retry only after its lease and owner identity can be validated; never force-delete unknown ownership. |
| `E_PROTOCOL_MIGRATION_TARGET_UNSUPPORTED` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_PUBLICATION_CLAIM_UNVERIFIED` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_PUBLICATION_REQUIREMENT_PENDING` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_RECEIPT_CONTRACT_MISMATCH` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_RECEIPT_CYCLE_MISMATCH` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_RECEIPT_INVALID` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_RECEIPT_MISSING` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_RECEIPT_PATH_MISMATCH` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_RECEIPT_ROUTE_MISMATCH` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_RECEIPT_STATE_MISMATCH` | Receipt does not match current state cycle or work state. | Run forgeloop prepare-completion --json. |
| `E_RECEIPT_TASK_MISMATCH` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_RECONCILE_EVIDENCE_FAILED` | The executed objective-satisfaction evidence command did not pass. | Inspect the execution artifact; reconciliation is refused until evidence passes in the current repository. |
| `E_RECONCILE_LEDGER_INVALID` | The append-only event ledger is not valid, so reconciliation cannot be recorded. | Inspect the ledger errors and repair before reconciling. |
| `E_RECONCILE_NOT_STALE` | reconcile-closure was invoked for a work-state checkpoint that is already fresh. | No reconciliation is required; continue the normal lifecycle. |
| `E_RECONCILE_PHASE_INVALID` | reconcile-closure was invoked for a task that is not EXECUTING or VERIFYING. | reconcile-closure supports EXECUTING or VERIFYING tasks whose objective is already satisfied. |
| `E_RECONCILE_REQUIREMENT_UNKNOWN` | The supplied check id and requirement text do not exactly match a contract verification item of type VERIFICATION. | Supply the exact id and requirement text of an existing contract verification item. |
| `E_RECONCILE_UNSUPPORTED_DRIFT` | Work-state drift includes kinds other than REPOSITORY_CHANGED (contract or required-artifact drift). | Resolve contract or artifact drift through their dedicated recovery surfaces; reconcile-closure only refreshes repository fingerprint drift. |
| `E_REPOSITORY_CHANGED` | The repository fingerprint (branch or HEAD) moved after the work-state checkpoint was recorded. | If the task objective is already satisfied in the current repository, run forgeloop reconcile-closure; otherwise resume from a checkpoint that matches the current repository. |
| `E_REPOSITORY_INDEX_ENGINE_BINARY_CHECKSUM_MISMATCH` | The extracted or managed tgrep executable bytes do not match the pinned binary SHA-256 digest. | Run forgeloop index-setup or index-rebuild to repair the managed binary; do not run a mismatched executable. |
| `E_REPOSITORY_INDEX_ENGINE_CHECKSUM_MISMATCH` | The tgrep archive or executable bytes do not match the pinned manifest SHA-256 digest. | Obtain the exact manifest asset and retry; do not install a checksum mismatch. |
| `E_REPOSITORY_INDEX_ENGINE_DOWNLOAD_FAILED` | The pinned tgrep release asset could not be downloaded or read. | Retry with network access or preload the exact manifest archive; never bypass provisioning verification. |
| `E_REPOSITORY_INDEX_ENGINE_EXECUTION_FAILED` | A managed tgrep process could not be launched, completed, or stayed within its execution boundary. | Inspect the structured error and index status, then retry with the verified managed engine. |
| `E_REPOSITORY_INDEX_ENGINE_EXTRACTION_FAILED` | The tgrep archive is malformed, unsafe, or could not be extracted to a temporary directory. | Use the exact supported archive and retry; unsafe paths and links are rejected. |
| `E_REPOSITORY_INDEX_ENGINE_MISSING` | The managed tgrep executable is absent, unreadable, or has not been provisioned. | Run forgeloop index-setup or preload the exact manifest archive with --asset. |
| `E_REPOSITORY_INDEX_ENGINE_VERSION_MISMATCH` | The executable reports a version different from the ForgeLoop-pinned tgrep version. | Provision the manifest-pinned tgrep release and retry; do not use an unpinned binary. |
| `E_REPOSITORY_INDEX_INDEXING` | The repository index is still being built or reconciled and is not ready for the requested operation. | Wait for index-status to report READY, or use index-rebuild if the operation remains stuck. |
| `E_REPOSITORY_INDEX_LOCK_UNSAFE` | A Repository Index operation lock is malformed, conflicting, or cannot be safely acquired. | Wait for a concurrent operation to finish and retry; use status or rebuild for a persistent lock failure. |
| `E_REPOSITORY_INDEX_NOT_INITIALIZED` | The repository index has no complete derived index available for the requested operation. | Run forgeloop index-setup or forgeloop index-rebuild for the selected repository. |
| `E_REPOSITORY_INDEX_OUTPUT_INVALID` | Native tgrep output did not match the bounded provider-neutral JSON contract. | Treat the result as unusable, inspect the engine, and rebuild or provision the pinned release. |
| `E_REPOSITORY_INDEX_OUTPUT_LIMIT` | Managed tgrep output exceeded ForgeLoop's bounded process-output limit. | Narrow the search or resource policy and retry; oversized output is never promoted to a result. |
| `E_REPOSITORY_INDEX_PLATFORM_UNSUPPORTED` | The current operating-system and architecture pair has no pinned tgrep release asset. | Use a supported platform or add a separately reviewed manifest asset; do not substitute a PATH executable. |
| `E_REPOSITORY_INDEX_REBUILD_FAILED` | The derived repository index could not be rebuilt successfully. | Inspect the structured failure, resource policy, and repository paths, then retry index-rebuild. |
| `E_REPOSITORY_INDEX_REQUEST_INVALID` | Repository Index command input is outside the bounded provider-neutral request contract. | Correct the pattern, path filters, context, or lifecycle options and retry the canonical command. |
| `E_REPOSITORY_INDEX_SEARCH_FAILED` | The native tgrep search failed with an execution or provider error; no-match is not an error. | Inspect index-status and retry the query or rebuild the derived index; ForgeLoop does not fall back silently. |
| `E_REPOSITORY_INDEX_SERVER_START_FAILED` | The ForgeLoop-owned tgrep watcher could not be started or did not become healthy. | Run index-status, inspect the structured reason, and retry index-start or index-rebuild. |
| `E_REPOSITORY_INDEX_SERVER_STOP_FAILED` | The ForgeLoop-owned tgrep watcher could not be stopped or its ownership could not be proven. | Use index-status and retry the canonical stop operation; never terminate processes by name or PID alone. |
| `E_REPOSITORY_INDEX_SERVER_UNHEALTHY` | Repository Index server, metadata, process identity, or index readiness validation failed. | Run index-status, then use index-rebuild after resolving the reported boundary. |
| `E_RESPONSIBILITY_FROZEN_INPUT_DRIFT` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_RESPONSIBILITY_INVALID` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_RESPONSIBILITY_REQUIRED_CHECK_MISSING` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_RESPONSIBILITY_SCOPE_VIOLATION` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_REVISION_CONTENT_UNAVAILABLE` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_REVISION_NOT_FOUND` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_REVISION_PROVIDER_AMBIGUOUS` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_REVISION_PROVIDER_INVALID` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_REVISION_PROVIDER_UNAVAILABLE` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_ROUTE_GUIDE_MISMATCH` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_ROUTE_INVALID` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_ROUTE_MISSING` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_ROUTE_REASON_MISSING` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_ROUTE_STALE` | Routing result does not match the active contract fingerprint. | Re-run forgeloop route. |
| `E_STATE_LEDGER_DIVERGENCE` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_STATE_MISSING` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_STATE_MISSING_AFTER_PREFLIGHT_READY` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_STATE_REVALIDATION_REQUIRED` | The work-state checkpoint must be revalidated before the lifecycle can continue. | Run forgeloop reconcile-closure for externally satisfied EXECUTING tasks, or inspect the freshness reasons for other drift. |
| `E_STATE_TASK_MISMATCH` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_STRATEGY_OSCILLATION` | Correction history oscillates between previously exhausted strategies without new information. | Gather a genuinely new observation or test a materially different falsifiable hypothesis. |
| `E_STRUCTURAL_QUALITY_BASELINE_BINDING_MISMATCH` | Structural-quality evidence did not satisfy its provider, artifact, comparison, or lifecycle boundary. | Reconcile contract, route, policy, scope, provider, or rules drift before using the baseline. |
| `E_STRUCTURAL_QUALITY_BASELINE_EXISTS` | Structural-quality evidence did not satisfy its provider, artifact, comparison, or lifecycle boundary. | Use the existing immutable baseline or request --replace while the task is still before EXECUTING. |
| `E_STRUCTURAL_QUALITY_BASELINE_MISSING` | Structural-quality evidence did not satisfy its provider, artifact, comparison, or lifecycle boundary. | Run forgeloop quality-baseline --task <id> after PLANNED and before EXECUTING. |
| `E_STRUCTURAL_QUALITY_BASELINE_PHASE_INVALID` | Structural-quality evidence did not satisfy its provider, artifact, comparison, or lifecycle boundary. | Baseline replacement is forbidden after EXECUTING; repair the current task against its original baseline. |
| `E_STRUCTURAL_QUALITY_CONFIGURATION_INVALID` | Structural-quality evidence did not satisfy its provider, artifact, comparison, or lifecycle boundary. | Correct structuralQuality mode, provider ID, budgets, floors, or optimization limits in .forgeloop/config.json. |
| `E_STRUCTURAL_QUALITY_EVALUATION_INCOMPARABLE` | Structural-quality evidence did not satisfy its provider, artifact, comparison, or lifecycle boundary. | Restore the baseline provider/version/rules/policy/scope bindings and rerun quality-verify. |
| `E_STRUCTURAL_QUALITY_EVIDENCE_STALE` | Structural-quality evidence did not satisfy its provider, artifact, comparison, or lifecycle boundary. | Rerun quality-verify in the active verification cycle and refresh completion through the canonical receipt pipeline. |
| `E_STRUCTURAL_QUALITY_MEASUREMENT_MODEL_MISMATCH` | Structural-quality evidence did not satisfy its provider, artifact, comparison, or lifecycle boundary. | Use a compatible measurement model and provider across baseline and evaluation observations. |
| `E_STRUCTURAL_QUALITY_OBSERVATION_EPOCH_STALE` | Structural-quality evidence did not satisfy its provider, artifact, comparison, or lifecycle boundary. | Rerun quality-verify under the active task epoch without concurrent state mutations. |
| `E_STRUCTURAL_QUALITY_OUTPUT_LIMIT` | Structural-quality evidence did not satisfy its provider, artifact, comparison, or lifecycle boundary. | Reduce provider output or diagnostics; the 2 MiB combined process-output limit is fail-closed. |
| `E_STRUCTURAL_QUALITY_PROJECTION_INCOMPLETE` | Structural-quality evidence did not satisfy its provider, artifact, comparison, or lifecycle boundary. | Rerun quality-verify to reconcile and project the canonical check from the existing evaluation artifact. |
| `E_STRUCTURAL_QUALITY_PROVIDER_INVALID` | Structural-quality evidence did not satisfy its provider, artifact, comparison, or lifecycle boundary. | Use a provider implementing id, detect(input), and scan(input) with the documented normalized boundary. |
| `E_STRUCTURAL_QUALITY_PROVIDER_PROTOCOL_INVALID` | Structural-quality evidence did not satisfy its provider, artifact, comparison, or lifecycle boundary. | Repair the provider MCP handshake or response shape; malformed external data cannot become evidence. |
| `E_STRUCTURAL_QUALITY_PROVIDER_TOOL_CONTRACT_INVALID` | Structural-quality evidence did not satisfy its provider, artifact, comparison, or lifecycle boundary. | Ensure the provider exposes the required scan and health tool argument schemas. |
| `E_STRUCTURAL_QUALITY_PROVIDER_UNAVAILABLE` | Structural-quality evidence did not satisfy its provider, artifact, comparison, or lifecycle boundary. | Install or expose the requested provider outside ForgeLoop, or use observe mode and record the limitation; ForgeLoop never auto-installs it. |
| `E_STRUCTURAL_QUALITY_PROVIDER_VERSION_UNSUPPORTED` | Structural-quality evidence did not satisfy its provider, artifact, comparison, or lifecycle boundary. | Use a verified Sentrux version (0.5.5, 0.5.6, or 0.5.7), or select a compatible provider through trusted runtime context. |
| `E_STRUCTURAL_QUALITY_REGRESSION` | Structural-quality evidence did not satisfy its provider, artifact, comparison, or lifecycle boundary. | Use the bottleneck and root-cause deltas to record an evidence-backed diagnosis, correct within scope, and verify a new cycle. |
| `E_STRUCTURAL_QUALITY_SCAN_FAILED` | Structural-quality evidence did not satisfy its provider, artifact, comparison, or lifecycle boundary. | Inspect the provider failure and rerun quality-baseline or quality-verify after the external analyzer is healthy. |
| `E_STRUCTURAL_QUALITY_SOURCE_DRIFT` | Structural-quality evidence did not satisfy its provider, artifact, comparison, or lifecycle boundary. | Ensure the worktree is not mutated during provider observation and rerun quality-baseline or quality-verify. |
| `E_STRUCTURAL_QUALITY_SOURCE_FINGERPRINT_UNAVAILABLE` | Structural-quality evidence did not satisfy its provider, artifact, comparison, or lifecycle boundary. | Repair unreadable or unsafe source material before structural-quality evidence can be trusted. |
| `E_STRUCTURAL_QUALITY_TIMEOUT` | Structural-quality evidence did not satisfy its provider, artifact, comparison, or lifecycle boundary. | Use a responsive provider or a bounded timeout within the supported limit; never promote a timed-out scan. |
| `E_TASK_ALREADY_EXISTS` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_TASK_ALREADY_RECOVERED` | The task already has active durable recovered state. | Inspect the existing recovery metadata; use task-resume to reacquire claims or leave the task recovered. |
| `E_TASK_AMBIGUOUS` | Multiple tasks exist in the project but no task selector was provided. | Select a task explicitly using --task <id> or FORGELOOP_TASK=<id>. |
| `E_TASK_CHANGE_ATTRIBUTION_UNAVAILABLE` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_TASK_CHANGE_OUTSIDE_SCOPE` | Modified paths in repository exceed the declared task write claims. | Update write claims with forgeloop task-scope or revert out-of-scope modifications. |
| `E_TASK_CLAIM_OWNERSHIP_INCONSISTENT` | ForgeLoop cannot prove whether a task still owns its historical write claims. | Repair and validate the task descriptor, recovery artifact, and complete event ledger before acquiring overlapping claims or mutating the task. |
| `E_TASK_COMPLETE` | A validator-backed COMPLETE task is terminal and cannot be mutated. | Create or select a non-terminal task for further work; do not modify terminal task state. |
| `E_TASK_CONTEXT_MISMATCH` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_TASK_DESCRIPTOR_INVALID` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_TASK_KEY_MISMATCH` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_TASK_LAYOUT_LEGACY` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_TASK_LOCKED` | Task mutation is currently locked by another concurrent process or run-check. | Wait for the active mutation to complete or inspect the lock with forgeloop task-show. |
| `E_TASK_LOCK_INVALID` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_TASK_MIGRATION_IDENTITY_MISMATCH` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_TASK_MIGRATION_INVALID` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_TASK_NOT_FOUND` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_TASK_NOT_RECOVERED` | task-resume was requested for a task without active recovered state. | Inspect the task with forgeloop task-show; task-resume is only valid while recovery.json is active. |
| `E_TASK_RECOVERED` | The task released its write claims through recovery and ordinary mutation is suspended. | Run forgeloop task-resume --task <id> to reacquire the released claims before mutating the task. |
| `E_TASK_RECOVERY_AUTHORITY_INVALID` | Recovery authority metadata is invalid or claims host attestation without a host-owned grant reference. | Use caller acknowledgement, or provide a host-attested recovery grant through a trusted host integration. |
| `E_TASK_RECOVERY_AUTHORIZATION_REQUIRED` | task-recover requires explicit caller acknowledgement; this is not host-attested authority. | Re-run with --acknowledge-recovery only when evidence shows the task is STALE or ABANDONED; --operator-authorized remains a deprecated alias. |
| `E_TASK_RECOVERY_INCONSISTENT` | Claim-release recovery was refused because the task state, recovery artifact, lock, or event ledger is inconsistent. | Repair the underlying artifact through its dedicated recovery surface; do not force-complete an unreadable task. |
| `E_TASK_RECOVERY_OFFICIAL_PATH_AVAILABLE` | Claim-release recovery was refused because canonical lifecycle reconciliation is available. | Use forgeloop reconcile-closure and the normal verification/completion pipeline instead of task-recover. |
| `E_TASK_RECOVERY_UNSAFE` | Claim-release recovery was refused because the conflicting task is active, inconsistent, already complete, or holds a live lease. | Resolve the reported classification first; live leases must expire or be released by their owner before recovery. |
| `E_TASK_REQUIRED` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_TASK_SCOPE_CONFLICT` | Task write claims overlap with another non-complete task in the same checkout. | Inspect the conflicting task classification reported in error.conflicts, then reconcile or recover it through its reported official recovery commands before retrying task creation. |
| `E_TASK_SCOPE_DIRTY` | Claimed paths contain pre-existing uncommitted changes. | Commit or stash changes in claimed paths before defining or adopting the scope. |
| `E_TASK_SCOPE_FROZEN` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_TASK_SCOPE_REQUIRED` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_TASK_SELECTOR_CONFLICT` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_TERMINAL_REQUIREMENT_NOT_TERMINAL` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_TERMINAL_REQUIREMENT_PENDING` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_TERMINAL_REQUIREMENT_TYPE_MISMATCH` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_TERMINAL_REQUIREMENT_UNKNOWN` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_TERMINAL_STATUS_REGRESSION` | A ForgeLoop protocol validation or lifecycle condition was not satisfied. | Inspect the structured command result, correct the named artifact or prerequisite, then run forgeloop next --json. |
| `E_TRACE_SNAPSHOT_INCONSISTENT` | Task artifacts changed while the execution trace was being read. | Rerun the read-only projection to obtain a consistent view. |
| `E_TRAJECTORY_REFERENCE_REQUIRED` | Comparative efficiency requires a reference scenario with positive comparableSteps. | Provide --scenario with reference.comparableSteps, or omit efficiency from the result. |
| `E_TRAJECTORY_SCENARIO_INVALID` | Trajectory scenario file is missing required fields or schema-invalid. | Correct the scenario JSON against schemas/trajectory-scenario.schema.json. |
| `E_USAGE_INVALID` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_USAGE_SOURCE_INVALID` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_VERIFICATION_EXECUTION_INVALID` | The trusted verification execution adapter returned incomplete or invalid execution metadata. | Repair the adapter contract and rerun verification; do not promote incomplete execution evidence. |
| `E_VERIFICATION_ISOLATION_UNAVAILABLE` | Verification cannot run because the required disposable or system isolation boundary is unavailable. | Use a trusted ForgeLoop execution adapter with the required isolation mode; never run the check in the live project. |
| `E_VERIFICATION_SCOPE_INVALID` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_VERIFICATION_SCOPE_STALE` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_VERIFICATION_SCOPE_UNRESOLVED` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_VERIFICATION_TOOL_UNAVAILABLE` | Required verification executable is missing in environment. | Use local equivalent, obtain host authority, or record NOT_VERIFIED. |
| `E_WORKSPACE_BINDING_INVALID` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_WORKSPACE_BINDING_MISMATCH` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |
| `E_WORKSPACE_IDENTITY_UNAVAILABLE` | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. | Inspect the structured command result, correct the named boundary or artifact, then retry the canonical command. |

<!-- END FORGELOOP GENERATED: public-error-codes -->

## Revised contract after a blocked preflight

Before execution starts, a revised contract and route can leave the old
checkpoint stale. Run `forgeloop next --task <id> --json`. When the validated
history ends in a blocked preflight and the new route binds the revised
contract, it offers `clear-state` followed by `preflight`. Execute those in
that order, satisfy any remaining gates, and require `READY` again.

This recovery guidance is unavailable after execution has started, for an
invalid ledger, or when the new route does not match the contract. Preserve
those barriers and follow the task's canonical recovery guidance.

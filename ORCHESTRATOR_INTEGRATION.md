# Orchestrator integration contract

`ForgeLoop` is a portable protocol, not an orchestrator. A compatible harness
may map these serializable contracts to its own state machine, worker pool, or
review primitive without adding that framework to the package.

## Canonical workflow diagram

```text
RECEIVED → DISCOVERING → CONTRACT_READY → ROUTED
                                       ├→ DESIGNING → PLANNED
                                       └→ PLANNED
PLANNED → EXECUTING → VERIFYING
VERIFYING ├→ DIAGNOSING → CORRECTING → VERIFYING
          └→ REVIEWING ──────────────→ COMPLETE
                ├→ VERIFYING   evidence-only completion recovery
                └→ CORRECTING  implementation/review correction required
Any non-terminal state → BLOCKED when a genuine blocker is evidenced
```

## Phase names

- `RECEIVED`
- `DISCOVERING`
- `CONTRACT_READY`
- `ROUTED`
- `DESIGNING`
- `PLANNED`
- `EXECUTING`
- `VERIFYING`
- `DIAGNOSING`
- `CORRECTING`
- `REVIEWING`
- `COMPLETE`
- `BLOCKED`

## Repository Index readiness

For Git repositories, the mandatory Repository Index is an operational
readiness dependency, not a second workflow state machine. An orchestrator
should surface `index-status` health and route repair through the canonical
`index-setup`, `index-start`, `index-stop`, and `index-rebuild` commands. An
index failure must not rewrite historical completion, task claims, receipts,
or verification evidence; discovery remains non-authoritative cache/state.

## Canonical transition table

| From | Condition | To |
| --- | --- | --- |
| `RECEIVED` | context is required | `DISCOVERING` |
| `DISCOVERING` | sufficient sourced context | `CONTRACT_READY` |
| `CONTRACT_READY` | route is resolved | `ROUTED` |
| `ROUTED` | design decision is required | `DESIGNING` |
| `ROUTED` | no design gate is required | `PLANNED` |
| `DESIGNING` | design is approved | `PLANNED` |
| `PLANNED` | task work begins | `EXECUTING` |
| `EXECUTING` | targeted check is ready | `VERIFYING` |
| `VERIFYING` | a check fails | `DIAGNOSING` |
| `DIAGNOSING` | a fix hypothesis exists | `CORRECTING` |
| `CORRECTING` | the fix is applied | `VERIFYING` |
| `VERIFYING` | checks pass | `REVIEWING` |
| `REVIEWING` | completion is rejected only for evidence | `VERIFYING` |
| `REVIEWING` | an implementation or review finding requires correction | `CORRECTING` |
| `REVIEWING` | contract and quality are accepted | `COMPLETE` |
| `Any non-terminal state` | a genuine external blocker is evidenced | `BLOCKED` |

`BLOCKED` is additionally reachable from any non-terminal, non-`BLOCKED`
phase when the blocker invariant is satisfied. `WORK_TRANSITIONS` alone is
therefore not the entire executable transition model; the special `BLOCKED`
edge is part of the canonical machine semantics.

The exact edge inventory below is generated from the runtime
(`WORK_PHASES`/`WORK_TRANSITIONS` in `src/core/protocol.js`) and must not be
edited by hand.

<!-- BEGIN FORGELOOP GENERATED: work-transitions -->

| From | To |
| --- | --- |
| `RECEIVED` | `DISCOVERING` |
| `DISCOVERING` | `CONTRACT_READY` |
| `CONTRACT_READY` | `ROUTED` |
| `ROUTED` | `DESIGNING` |
| `ROUTED` | `PLANNED` |
| `DESIGNING` | `PLANNED` |
| `PLANNED` | `EXECUTING` |
| `EXECUTING` | `VERIFYING` |
| `VERIFYING` | `DIAGNOSING` |
| `VERIFYING` | `REVIEWING` |
| `DIAGNOSING` | `CORRECTING` |
| `CORRECTING` | `VERIFYING` |
| `REVIEWING` | `COMPLETE` |
| `REVIEWING` | `CORRECTING` |
| `REVIEWING` | `VERIFYING` |

<!-- END FORGELOOP GENERATED: work-transitions -->

## Profile-aware host behavior

The host may adapt context and presentation depth after reading the resolved
`executionProfile` from the persisted route or a compact task projection.
`light` uses targeted guide sections, a compact plan, focused checks, and
bounded lifecycle output; `balanced` keeps the normal relevant context; `full`
permits broader risk and dependency context. The host must not reinterpret the
profile or use it to skip lifecycle phases, required gates, verification
requirements, authority checks, provenance, or completion validation.

Hosts can consume the canonical `task/context` projection from the universal
integration API (or `forgeloop://task/{taskId}/context` through MCP). It
provides the objective, deliverables, constraints, selected guide IDs, next
action, verification requirements, and the profile-specific presentation
policy. A phase may be absent only when the canonical protocol says it is not
applicable; `light` is never a reason to omit it.

The profile changes context depth only. Required phases and gates, evidence and
verification truth, authority and provenance, the safety floor, and
validator-backed completion remain invariant.

The canonical integration capability is `executionProfileContext`, and the
host-facing `task/context` projection is the default input for profile-aware
presentation. A host that cannot read that resource falls back to balanced
compatibility behavior. It must consume `executionProfile.resolved`, preserve
the safety floor, and pass missing context or usage as unavailable rather than
estimating it.

The profile is orthogonal to `complianceMode`. CLI requests take precedence
over project configuration only as requests, while the deterministic safety
floor always wins. Historical routes without the optional profile field remain
readable and project to `balanced` compatibility behavior. The first release
does not add a lifecycle fast path.

Optional reflection, evaluation, handoff, responsibility, attestation,
benchmark, and continuity artifacts are lazy. Create them only when required
by policy, requested by the user or host, or needed for recovery.

The host may skip proportional phases, but it must preserve the state
invariants and record why a skipped phase was not applicable.

## State invariants

- `COMPLETE` requires verification evidence current to the task.
- `BLOCKED` requires blocker evidence, a category, and a safe next action.
- `CORRECTING` requires a diagnosed hypothesis recorded in the event ledger (`DIAGNOSIS_RECORDED`) with non-zero information gain (`informationGain !== "NONE"`).
- `REVIEWING` cannot claim independent review when reviewer and implementer
  identities are equal.
- `REVIEWING → VERIFYING` requires a persisted evidence-only completion
  rejection and starts a new `verificationCycle`.
- A retry requires new evidence or a changed hypothesis; repeating the same diagnosis produces `informationGain: NONE` and stalls progression (`CHANGE_STRATEGY`).
- `forgeloop progress` deterministically evaluates task progress across cycles as `ADVANCING`, `WATCH`, or `STALLED`.
- `forgeloop record-decision-criterion` attaches contract-bound guidance to unresolved decisions without breaking the schema.

## Optional serializable boundaries

An external orchestrator may expose the following optional protocol artifacts
without changing the lifecycle or adding a graph runtime:

| Boundary | Serializable view | Required host behavior |
| --- | --- | --- |
| Workspace identity | `workspace-binding.json` | Preserve the current checkout and surface a mismatch before mutation or verification launch |
| Handoff | Immutable handoff envelope | Carry protocol-derived state and any descriptive note without treating it as delegation, authority, or evidence |
| Responsibility | Allowed/read-only paths, required checks, and frozen-input fingerprints | Enforce the declared boundary and report scope drift |
| Verification scope | `AUTO`, `CHANGED`, `CLAIMED`, or `FULL` plus scope fingerprint | Consume the canonical result and exact scoped argv; do not infer an `IMPACTED` mode |
| Attestation | Code manifest, in-toto Statement v1, optional signature, and range result | Preserve `PROCESSED`, `VERIFIED`, and `ATTESTED` distinctions and keep verification read-only |

The host owns scheduling, workers, model calls, checkout selection, transport,
and platform presentation. ForgeLoop owns schema validation, fingerprints,
claims, lifecycle transitions, evidence binding, completion, and fail-closed
trust decisions. Workspace binding, responsibility, narrow verification,
signing, and MCP are not prerequisites for basic protocol compatibility.

Handoff acceptance is orthogonal to the lifecycle transition graph. An
orchestrator may call `handoff-accept` only after the receiving harness has
actually consumed the immutable snapshot. The resulting `HANDOFF_ACCEPTED`
event is an exactly-once operational receipt; it does not accept delegation,
transfer claims, create evidence, authenticate `consumerId` or `harness`, or
grant lifecycle or review authority. Advisory context is likewise optional,
lazy, and Integration-API-only; it must not be loaded automatically or used as
an executable instruction source.

Focused visual fallbacks are maintained in the [Verification Trust
Flow](./docs/REVISION_PROVIDERS.md#differential-verification-scope) and [Code
Attestation Chain](./docs/CODE_ATTESTATION.md#completion-flow).

## Serializable interfaces

The following JSON Schemas define the boundaries a host may implement:

- `schemas/routing-input.schema.json` and
  `schemas/routing-result.schema.json` define deterministic guide selection
  after semantic signals are declared.
- `schemas/work-state.schema.json` defines local checkpoint/resume data.
- `schemas/execution-receipt.schema.json` defines structured evidence and
  explicit publication state.
- `schemas/task-brief.schema.json` and
  `schemas/delegated-result.schema.json` define optional delegation.
- `schemas/evidence.schema.json` defines the shared evidence vocabulary.
- `schemas/current-contract.schema.json`, `schemas/gate.schema.json`,
  `schemas/preflight.schema.json`, and `schemas/source-registry.schema.json`
  define preparation and provenance artifacts.
- `schemas/check.schema.json` and `schemas/evidence-coverage.schema.json`
  define observed verification and load-bearing success coverage.
- `schemas/event.schema.json`, `schemas/activation.schema.json`,
  `schemas/config.schema.json`, `schemas/policy.schema.json`, and
  `schemas/task-bundle.schema.json` define chronology, mode, policy, and
  handoff boundaries.

`src/core/conformance.js` validates relationships that individual schemas
cannot express: route/state protocol versions, route/state guide sets,
state/receipt contract fingerprints, and delegated-result/task-brief IDs. Its
statuses are `VALID`, `INCOMPLETE`, `STALE`, `INCONSISTENT`, and `INVALID`.
`forgeloop validate-protocol` is read-only and reports the exact failed
invariant.

The preparation and completion commands are also local validators:
`preflight` must be `READY` before executable work, `audit` is a consistency
report, and `complete` returns `VALID` only after current evidence, coverage,
receipt relationships, and ledger chronology pass. None of these commands
execute a project command or a model.

Every artifact is JSON-compatible, carries `schemaVersion: 1` and
`protocolVersion: 1`, and contains no executable callbacks, provider-specific
tool objects, credentials, hidden prompts, or remote database references.

## Host responsibilities

The compatible harness owns model execution, tool execution, scheduling,
parallelism, lifecycle, isolation, and any remote services. It must pass
validated inputs to the protocol, preserve file ownership, report unavailable
capabilities, and never turn local success into an unverified publication
claim.

## No-runtime boundary

The protocol does not provide a graph runtime.
The protocol does not provide a provider adapter.
The protocol does not provide a scheduler.
No runtime required: inline execution is the valid fallback when the host has
no subagents or worktrees. A future host may add those capabilities outside the
package, but must preserve the serialized contracts and explicit limitations.

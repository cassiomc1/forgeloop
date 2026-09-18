# ForgeLoop Artifact Reference

This reference documents the canonical artifacts persisted in the `.forgeloop/` directory.

All artifact schemas are defined in `schemas/*.schema.json`. Persisted artifact shapes are strictly bound to these schemas and validated during protocol transitions.

---

## 1. Artifact Registry Summary

<!-- BEGIN FORGELOOP GENERATED: artifact-registry -->

| Artifact File | Schema | Ownership | Mutability | Trust Role |
| --- | --- | --- | --- | --- |
| `task-state/<task-key>/task.json` | `task-descriptor` | Protocol Managed | Mutable Before Execution | Task Descriptor |
| `task-state/<task-key>/contract.json` | `current-contract` | Agent Authored | Mutable Before Execution | Operational Specification |
| `task-state/<task-key>/routing-result.json` | `routing-result` | Protocol Generated | Mutable On Reroute | Guide Routing Specification |
| `task-state/<task-key>/preflight.json` | `preflight` | Protocol Generated | Overwritten On Preflight | Readiness Attestation |
| `sources.json` | `source-registry` | Operator Or Agent | Mutable On Discovery | Source Attestation |
| `task-state/<task-key>/events.ndjson` | `event` | Protocol Appended | Append Only | Audit Ledger |
| `sessions/<session-id>.json` | `activation` | Protocol Generated | Overwritten On Activate | Session Marker |
| `config.json` | `config` | Operator Or Agent | Mutable Configuration | Project Configuration |
| `task-state/<task-key>/gates/<gate>.json` | `gate` | Agent Authored Or Reviewer | Overwritten On Gate Satisfaction | Gate Approval Attestation |
| `task-state/<task-key>/work-state.json` | `work-state` | Protocol Managed | Atomic State Transitions | Canonical Lifecycle State |
| `task-state/<task-key>/continuity.json` | `continuity` | Agent Or Harness | Mutable Handoff Notes | Non Evidence Handoff |
| `task-state/<task-key>/execution-receipt.json` | `execution-receipt` | Protocol Compiled | Atomic Compilation | Evidence Compilation |
| `task-state/<task-key>/executions/exec-<id>.json` | `execution` | Protocol Executed | Immutable Once Written | Execution Provenance |
| `policy/rules.json` | `policy-rules` | Operator Or Agent | Mutable Configuration | Policy Specification |
| `policy/discovery.json` | `policy-discovery` | Protocol Generated | Mutable On Discovery | Discovered Policy Specification |
| `policy/baseline.json` | `policy-baseline` | Protocol Generated Or Operator | Monotonic Ratchet Down | Brownfield Baseline |
| `policy/policy.lock` | `policy-lock` | Protocol Generated | Atomic Digest Compilation | Policy Integrity Lock |
| `task-state/<task-key>/policy-snapshot.json` | `policy-snapshot` | Protocol Generated | Mutable Before Execution | Task Policy Attestation |
| `task-state/<task-key>/recovery.json` | `task-recovery` | Protocol Generated | Recovery State Transitions | Task Recovery State |
| `task-state/<task-key>/actions/action-<id>.json` | `action` | Protocol Managed | State Machine Transitions | External Action Provenance |
| `task-state/<task-key>/approvals/approval-<id>.json` | `approval` | Protocol Managed | Append Decision Once | Action Approval Attestation |
| `policy/capabilities.json` | `capability-policy` | Operator Or Agent | Mutable Configuration | Capability Policy Specification |
| `task-state/<task-key>/evaluations/eval-<id>.json` | `trajectory-evaluation` | Protocol Compiled | Immutable Once Written | Trajectory Evaluation |
| `task-state/<task-key>/structural-quality/baseline.json` | `structural-quality` | Protocol Compiled | Baseline Immutable After Execution | Structural Quality Evidence |
| `task-state/<task-key>/usage.json` | `usage` | Actor Or Trusted Host | Overwritten On Usage Record | Informational Usage Telemetry |
| `task-state/<task-key>/workspace-binding.json` | `workspace-binding` | Protocol Generated | Immutable After Bind | Workspace Identity Binding |
| `task-state/<task-key>/handoffs/handoff-<id>.json` | `handoff-envelope` | Protocol Compiled | Immutable Once Written | Canonical Handoff Snapshot |
| `task-state/<task-key>/responsibility.json` | `responsibility` | Agent Or Harness Constrained | Immutable During Pass | Responsibility Constraint |
| `task-state/<task-key>/verification-scope.json` | `verification-scope` | Protocol Compiled | Recomputed On Scope Change | Verification Scope Plan |
| `task-state/<task-key>/attestations/code-manifest.json` | `code-manifest` | Protocol Generated | Immutable Once Written | Content Integrity Snapshot |
| `task-state/<task-key>/attestations/statement.json` | `in-toto-statement` | Protocol Compiled | Immutable Once Written | Code Attestation Statement |
| `task-state/<task-key>/attestations/statement.sigstore.json` | `null` | External Signing Provider | External Immutable | External Signature Bundle |

<!-- END FORGELOOP GENERATED: artifact-registry -->

---

## 2. Canonical Artifact Specifications

### 2.1 `task-state/<taskKey>/contract.json`

<!-- forgeloop-doc: schema=current-contract artifact=.forgeloop/task-state/<task-key>/contract.json -->

The operational task specification authored before execution begins.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:current-contract -->

- `schemaVersion` *(number, required, const: 1)*
- `protocolVersion` *(number, required, const: 1)*
- `taskId` *(string, required, minLength: 1)*
- `objective` *(string, required, minLength: 1)*
- `assumptions` *(array<object>, optional)*
  - `value` *(string, required, minLength: 1)*
  - `reason` *(string, required, minLength: 1)*
  - `scope` *(string, required, minLength: 1)*
  - `reversible` *(boolean, required, const: true)*
  - `source` *(string, required, const: `agent-default`)*
- `deliverables` *(array<string>, required)*
- `constraints` *(array<string>, required)*
- `risks` *(array<string>, required)*
- `verification` *(array<string or requirement>, required)*
  *requirement items:*
  - `id` *(string, optional, minLength: 1)*
  - `text` *(string, required, minLength: 1)*
  - `type` *(string, optional, enum: `PRODUCT`, `VERIFICATION`, `LIFECYCLE`, `PUBLICATION`, `PRODUCTION_READINESS`)*
  - `operator` *(string, optional, enum: `SINGLE`, `ALL`)*
  - `requiredEvidenceKind` *(string, optional, enum: `OBSERVED`, `INFERRED`, `NOT_VERIFIED`, `BLOCKED`, `HYPOTHESIS`)*
  - `lifecycleOwned` *(boolean, optional)*
  - `terminalOwned` *(boolean, optional)*
  - `mixedTerminal` *(boolean, optional)*
  - `requiredPublicationStatus` *(string, optional, enum: `committed`, `pushed`, `published`, `deployed`)*
  - `requirements` *(array<string or requirement>, optional)*
- `successCriteria` *(array<string or requirement>, required)*
  *requirement items:*
  - `id` *(string, optional, minLength: 1)*
  - `text` *(string, required, minLength: 1)*
  - `type` *(string, optional, enum: `PRODUCT`, `VERIFICATION`, `LIFECYCLE`, `PUBLICATION`, `PRODUCTION_READINESS`)*
  - `operator` *(string, optional, enum: `SINGLE`, `ALL`)*
  - `requiredEvidenceKind` *(string, optional, enum: `OBSERVED`, `INFERRED`, `NOT_VERIFIED`, `BLOCKED`, `HYPOTHESIS`)*
  - `lifecycleOwned` *(boolean, optional)*
  - `terminalOwned` *(boolean, optional)*
  - `mixedTerminal` *(boolean, optional)*
  - `requiredPublicationStatus` *(string, optional, enum: `committed`, `pushed`, `published`, `deployed`)*
  - `requirements` *(array<string or requirement>, optional)*
- `stopConditions` *(array<string>, required)*
- `unresolvedDecisions` *(array<string>, required)*
- `sourceRefs` *(array<string>, required)*

<!-- END FORGELOOP GENERATED: schema:current-contract -->

---

### 2.2 `task-state/<taskKey>/routing-result.json`

<!-- forgeloop-doc: schema=routing-result artifact=.forgeloop/task-state/<task-key>/routing-result.json -->

The deterministic result of routing task signals against the engineering guide router.

New routes include a deterministic `executionProfile`. It is separate from
the project `complianceMode`: the profile controls context/process depth while
compliance controls enforcement. The persisted route is authoritative for the
resolved profile and is included in route fingerprints. Historical protocol-v1
routes may omit this optional field and remain readable; consumers project
missing profile metadata to `balanced` compatibility behavior without rewriting
the historical artifact.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:routing-result -->

- `schemaVersion` *(number, required, const: 1)*
- `protocolVersion` *(number, required, const: 1)*
- `contractFingerprint` *(string, optional, pattern: `^[a-f0-9]{64}$`)*
- `executionProfile` *(object, optional)*
  - `requested` *(string, required, enum: `auto`, `light`, `balanced`, `full`)*
  - `floor` *(string, required, enum: `light`, `balanced`, `full`)*
  - `resolved` *(string, required, enum: `light`, `balanced`, `full`)*
  - `reasons` *(array<string>, required, minItems: 1)*
  - `escalated` *(boolean, required)*
- `input` *(object, required)*
- `primary` *(string or null, required)*
- `guides` *(array<string>, required)*
- `reasons` *(object, required)*
- `excluded` *(object, required)*

<!-- END FORGELOOP GENERATED: schema:routing-result -->

---

### 2.3 `task-state/<taskKey>/preflight.json`

<!-- forgeloop-doc: schema=preflight artifact=.forgeloop/task-state/<task-key>/preflight.json -->

Readiness attestation evaluated prior to implementation.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:preflight -->

- `schemaVersion` *(number, required, const: 1)*
- `protocolVersion` *(number, required, const: 1)*
- `taskId` *(string, required, minLength: 1)*
- `status` *(string, required, enum: `READY`, `BLOCKED`)*
- `profile` *(object, required)*
- `contract` *(object, required)*
- `routing` *(object, required)*
- `requiredGates` *(array<string>, required)*
- `satisfiedGates` *(array<string>, required)*
- `errors` *(array<object>, required)*
- `fingerprints` *(object, optional)*
- `sources` *(object, optional)*
- `policy` *(object, optional)*
- `structuralQuality` *(object, optional)*

<!-- END FORGELOOP GENERATED: schema:preflight -->

---

### 2.4 `sources.json`

<!-- forgeloop-doc: schema=source-registry artifact=.forgeloop/sources.json -->

Discovered repository facts, platforms, runtimes, and dependencies.

Built-in `contract-preset:documentation`, `contract-preset:bug`,
`contract-preset:feature`, and `contract-preset:release` references are
ForgeLoop-owned provenance and do not require an entry in this registry. Every
other contract source reference still requires a valid registry entry.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:source-registry -->

- `schemaVersion` *(number, required, const: 1)*
- `protocolVersion` *(number, required, const: 1)*
- `sources` *(object, required)*

<!-- END FORGELOOP GENERATED: schema:source-registry -->

---

### 2.5 `task-state/<taskKey>/events.ndjson`

<!-- forgeloop-doc: schema=event artifact=.forgeloop/task-state/<task-key>/events.ndjson -->

The append-only cryptographic event ledger. Each line is a single JSON event object. Records authoritative chronological events including lifecycle milestones (`TASK_RECEIVED`, `CONTRACT_VALIDATED`, `ROUTE_VALIDATED`, `PREFLIGHT_READY`, `EXECUTION_STARTED`, `VERIFICATION_STARTED`), evidence-backed diagnoses (`DIAGNOSIS_RECORDED`), and decision settlement criteria (`DECISION_CRITERION_RECORDED`).

#### Canonical Line Fields

<!-- BEGIN FORGELOOP GENERATED: schema:event -->

- `seq` *(integer, required, minimum: 1)*
- `schemaVersion` *(number, required, const: 1)*
- `protocolVersion` *(number, required, const: 1)*
- `taskId` *(string, required, minLength: 1)*
- `event` *(string, required, minLength: 1)*
- `at` *(string, required, minLength: 1)*
- `fingerprint` *(string, optional, pattern: `^[a-f0-9]{64}$`)*
- `previousHash` *(string or null, required)*
- `hash` *(string, optional, pattern: `^[a-f0-9]{64}$`)*
- `details` *(object, optional)*

<!-- END FORGELOOP GENERATED: schema:event -->

---

### 2.6 `sessions/<sessionId>.json`

<!-- forgeloop-doc: schema=activation artifact=.forgeloop/sessions/<session-id>.json -->

The active harness session marker created by `forgeloop activate`.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:activation -->

- `schemaVersion` *(number, required, const: 1)*
- `protocolVersion` *(number, required, const: 1)*
- `sessionId` *(string, required, minLength: 1)*
- `activationMarker` *(string, required, minLength: 1)*
- `createdAt` *(string, required, minLength: 1)*

<!-- END FORGELOOP GENERATED: schema:activation -->

---

### 2.7 `config.json`

<!-- forgeloop-doc: schema=config artifact=.forgeloop/config.json -->

Local ForgeLoop configuration settings and policy bindings.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:config -->

- `schemaVersion` *(number, required, const: 1)*
- `protocolVersion` *(number, required, const: 1)*
- `complianceMode` *(string, required, enum: `advisory`, `standard`, `strict`)*
- `executionProfile` *(string, optional, enum: `auto`, `light`, `balanced`, `full`)*
- `policy` *(string, optional, minLength: 1)*
- `requiredGates` *(array<string>, optional)*
- `requiredEvidence` *(array<string>, optional)*
- `structuralQuality` *(object, optional)*
  - `mode` *(string, optional, enum: `off`, `observe`, `gate`)*
  - `provider` *(string, optional, pattern: `^[a-z][a-z0-9-]{0,63}$`)*
  - `maxRegressionPoints` *(integer, optional, minimum: 0, maximum: 10000)*
  - `dimensionBudgets` *(dimensionMap, optional)*
    - `modularity` *(integer or null, optional)*
    - `acyclicity` *(integer or null, optional)*
    - `depth` *(integer or null, optional)*
    - `equality` *(integer or null, optional)*
    - `redundancy` *(integer or null, optional)*
  - `forbidNewCycles` *(boolean, optional)*
  - `minQualitySignal` *(integer or null, optional)*
  - `minimums` *(minimumMap, optional)*
    - `modularity` *(integer, optional, minimum: 0, maximum: 10000)*
    - `acyclicity` *(integer, optional, minimum: 0, maximum: 10000)*
    - `depth` *(integer, optional, minimum: 0, maximum: 10000)*
    - `equality` *(integer, optional, minimum: 0, maximum: 10000)*
    - `redundancy` *(integer, optional, minimum: 0, maximum: 10000)*
  - `optimization` *(object, optional)*
    - `mode` *(string, optional, enum: `off`, `bounded`)*
    - `maxExtraEvaluations` *(integer, optional, minimum: 0, maximum: 2)*
    - `minGainPoints` *(integer, optional, minimum: 1, maximum: 10000)*
- `verification` *(object, optional)*
  - `checkers` *(array<object>, required)*
    - `checkId` *(string, required, minLength: 1)*
    - `scopeMode` *(string, required, const: `PATH_ARGUMENTS`)*
    - `argvPrefix` *(array<string>, required, minItems: 1)*
    - `pathInsertion` *(string, required, const: `APPEND`)*
- `attestation` *(object, optional)*
  - `mode` *(string, required, enum: `off`, `optional`, `required`)*
  - `revisionProvider` *(string, required, minLength: 1)*
  - `requireCompleteCoverage` *(boolean, required)*
  - `coverage` *(object, required)*
    - `exclude` *(array<string>, required)*
  - `signing` *(object, required)*
    - `provider` *(string, required, enum: `none`, `sigstore`)*
    - `required` *(boolean, required)*
    - `policy` *(object, required)*
      - `issuer` *(string, optional)*
      - `identities` *(array<string>, required)*
      - `requireTransparencyLog` *(boolean, required)*

<!-- END FORGELOOP GENERATED: schema:config -->

---

### 2.8 `task-state/<taskKey>/gates/<gate>.json`

<!-- forgeloop-doc: schema=gate artifact=.forgeloop/task-state/<task-key>/gates/<gate>.json -->

Pre-implementation gate approval artifact recording decisions, bound artifact hashes, and evidence.

Use `node src/cli.js gate-record` to create or replace this artifact. The
command computes SHA-256 values from project-relative regular files; callers
must not provide digests or edit gate JSON manually. Preflight checks these
hashes for staleness, and gate mutation is available only before execution.
Caller-recorded evidence is descriptive local input, not host attestation,
ForgeLoop execution evidence, or remote authority.

`requiredBy` records only the provenance that actually requires the gate:
guides whose metadata declares it, plus the stable `config.requiredGates`
marker when `config.requiredGates` requires it. Programmatic gate-record
inputs are bounded (32 repeatable entries, 2000-character strings, 4 MiB
per bound artifact, 64 KiB per evidence file) and refuse stale routes when
the persisted route, work state, or current contract fingerprints no longer
agree, before any gate is written.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:gate -->

- `schemaVersion` *(number, required, const: 1)*
- `protocolVersion` *(number, required, const: 1)*
- `taskId` *(string, required, minLength: 1)*
- `gate` *(string, required, minLength: 1)*
- `status` *(string, required, enum: `satisfied`, `unverified`, `blocked`)*
- `requiredBy` *(array<string>, required)*
- `artifacts` *(array<object>, required)*
  - `path` *(string, required, minLength: 1)*
  - `sha256` *(string, required, pattern: `^[a-f0-9]{64}$`)*
- `decisions` *(array<string>, required)*
- `unknowns` *(array<string>, required)*
- `approvedAssumptions` *(array<string>, required)*
- `evidence` *(array<object>, required)*

<!-- END FORGELOOP GENERATED: schema:gate -->

---

### 2.9 `task-state/<taskKey>/work-state.json`

<!-- forgeloop-doc: schema=work-state artifact=.forgeloop/task-state/<task-key>/work-state.json -->

The canonical, authoritative lifecycle work state. Represents current checkpoint and resume state (`phase`, `checks`, `verificationCycle`, `lastUpdated`). Note: `diagnosedHypothesis` is maintained as a backward-compatibility projection of the latest diagnosis from `events.ndjson`.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:work-state -->

- `schemaVersion` *(number, required, const: 1)*
- `protocolVersion` *(number, required, const: 1)*
- `taskId` *(string, required, minLength: 1)*
- `contractFingerprint` *(string, required, pattern: `^[a-f0-9]{64}$`)*
- `routeFingerprint` *(string, optional, pattern: `^[a-f0-9]{64}$`)*
- `repositoryFingerprint` *(object, required)*
  - `branch` *(string or null, required)*
  - `head` *(string or null, required)*
- `phase` *(string, required, enum: `RECEIVED`, `DISCOVERING`, `CONTRACT_READY`, `ROUTED`, `DESIGNING`, `PLANNED`, `EXECUTING`, `VERIFYING`, `DIAGNOSING`, `CORRECTING`, `REVIEWING`, `COMPLETE`, `BLOCKED`)*
- `selectedGuides` *(array<string>, required)*
- `requiredGates` *(array<string>, optional)*
- `satisfiedGates` *(array<string>, optional)*
- `complianceMode` *(string, optional, enum: `advisory`, `standard`, `strict`)*
- `completedSteps` *(array<string>, required)*
- `pendingSteps` *(array<string>, required)*
- `requiredArtifacts` *(array<object>, optional)*
  - `path` *(string, required, minLength: 1)*
  - `sha256` *(string, required, pattern: `^[a-f0-9]{64}$`)*
- `checks` *(array<object>, required)*
- `failures` *(array<object>, required)*
- `blockers` *(array<object>, required)*
- `lastUpdated` *(string, required, minLength: 1)*
- `revision` *(integer, optional, minimum: 0)*
- `previousPhase` *(string, optional)*
- `diagnosedHypothesis` *(string, optional, minLength: 1)*
- `verificationEvidence` *(array<object>, optional)*
- `evidenceCoverage` *(array<object>, optional)*
- `publicationStatus` *(string, optional, enum: `not-published`, `local-only`, `committed`, `pushed`, `published`, `deployed`)*
- `verificationCycle` *(integer, optional, minimum: 1)*
- `lastCompletionAttempt` *(object, optional)*
  - `status` *(string, required, const: `REJECTED`)*
  - `reasonCodes` *(array<string>, required)*
  - `missingRequirementIds` *(array<string>, required)*
  - `verificationCycle` *(integer, required, minimum: 1)*
  - `stateFingerprint` *(string, optional, pattern: `^[a-f0-9]{64}$`)*
  - `receiptFingerprint` *(string or null, optional)*
  - `timestamp` *(string, required, minLength: 1)*

<!-- END FORGELOOP GENERATED: schema:work-state -->

---

### 2.10 `task-state/<taskKey>/continuity.json`

<!-- forgeloop-doc: schema=continuity artifact=.forgeloop/task-state/<task-key>/continuity.json -->

Cross-harness non-evidence handoff notes.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:continuity -->

- `schemaVersion` *(number, required, const: 1)*
- `protocolVersion` *(number, required, const: 1)*
- `taskId` *(string, required, minLength: 1, maxLength: 128)*
- `workStateFingerprint` *(string, required, pattern: `^[a-f0-9]{64}$`)*
- `contractFingerprint` *(string, required, pattern: `^[a-f0-9]{64}$`)*
- `phase` *(string, required, minLength: 1)*
- `verificationCycle` *(integer, optional, minimum: 1)*
- `repositoryFingerprint` *(object, required)*
  - `branch` *(string or null, required)*
  - `head` *(string or null, required)*
- `updatedAt` *(string, required, minLength: 1)*
- `currentFocus` *(workItem, optional)*
  - `id` *(string, required, minLength: 1, maxLength: 128)*
  - `summary` *(string, required, minLength: 1, maxLength: 1000)*
- `remainingWork` *(array<workItem>, required, maxItems: 40)*
  - `id` *(string, required, minLength: 1, maxLength: 128)*
  - `summary` *(string, required, minLength: 1, maxLength: 1000)*
- `knownIssues` *(array<workItem>, required, maxItems: 40)*
  - `id` *(string, required, minLength: 1, maxLength: 128)*
  - `summary` *(string, required, minLength: 1, maxLength: 1000)*
- `changedAreas` *(array<string>, required, maxItems: 80)*
- `inspectFirst` *(array<string>, required, maxItems: 40)*
- `resumeNote` *(string, optional, minLength: 1, maxLength: 2000)*

<!-- END FORGELOOP GENERATED: schema:continuity -->

---

### 2.11 `task-state/<taskKey>/execution-receipt.json`

<!-- forgeloop-doc: schema=execution-receipt artifact=.forgeloop/task-state/<task-key>/execution-receipt.json -->

The cryptographically compiled verification receipt required for task completion.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:execution-receipt -->

- `schemaVersion` *(number, required, const: 1)*
- `protocolVersion` *(number, required, const: 1)*
- `taskId` *(string, required, minLength: 1)*
- `contractFingerprint` *(string, required, pattern: `^[a-f0-9]{64}$`)*
- `routeFingerprint` *(string, optional, pattern: `^[a-f0-9]{64}$`)*
- `stateFingerprint` *(string, optional, pattern: `^[a-f0-9]{64}$`)*
- `verificationCycle` *(integer, optional, minimum: 1)*
- `status` *(string, optional, enum: `in-progress`, `complete`, `blocked`, `complete-with-concerns`)*
- `taskStatus` *(string, optional, enum: `in-progress`, `complete`, `blocked`, `incomplete`)*
- `verificationStatus` *(string, optional, enum: `valid`, `invalid`, `not-verified`, `blocked`)*
- `publicationStatus` *(string, optional, enum: `not-published`, `local-only`, `committed`, `pushed`, `published`, `deployed`)*
- `productionReadiness` *(string, optional, enum: `ready`, `not-verified`, `blocked`)*
- `selectedGuides` *(array<string>, required)*
- `changedPaths` *(array<string>, required)*
- `checks` *(array<object>, required)*
- `actions` *(object, optional)*
  - `count` *(integer, required, minimum: 0)*
  - `required` *(integer, required, minimum: 0)*
  - `verified` *(integer, required, minimum: 0)*
  - `trustedSatisfied` *(integer, optional, minimum: 0)*
  - `unresolvedRequired` *(integer, optional, minimum: 0)*
  - `failed` *(integer, required, minimum: 0)*
  - `ambiguous` *(integer, required, minimum: 0)*
  - `pending` *(integer, required, minimum: 0)*
  - `actionRefs` *(array<string>, required)*
- `evidence` *(array<object>, optional)*
  - `schemaVersion` *(number, optional, const: 1)*
  - `kind` *(string, required, enum: `OBSERVED`, `INFERRED`, `NOT_VERIFIED`, `BLOCKED`)*
  - `source` *(string, required, minLength: 1)*
  - `result` *(string, required, minLength: 1)*
  - `verificationCycle` *(integer, optional, minimum: 1)*
  - `details` *(object, optional)*
- `evidenceCoverage` *(array<object>, optional)*
- `review` *(object, required)*
- `limitations` *(array<string>, required)*
- `publication` *(object, required)*
  - `committed` *(boolean, required)*
  - `pushed` *(boolean, required)*
  - `pullRequest` *(string or null, required)*
  - `deployed` *(boolean, required)*

<!-- END FORGELOOP GENERATED: schema:execution-receipt -->

---

### 2.12 `task-state/<taskKey>/executions/exec-<id>.json`

<!-- forgeloop-doc: schema=execution artifact=.forgeloop/task-state/<task-key>/executions/exec-<id>.json -->

Attested command execution provenance artifact generated by `forgeloop run-check`.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:execution -->

- `schemaVersion` *(number, required, const: 1)*
- `protocolVersion` *(number, required, const: 1)*
- `executionId` *(string, required, minLength: 1)*
- `taskId` *(string, required, minLength: 1)*
- `checkId` *(string, required, minLength: 1)*
- `requirement` *(string, required, minLength: 1)*
- `verificationCycle` *(integer, required, minimum: 1)*
- `kind` *(string, required, const: `COMMAND_EXECUTION`)*
- `executionKind` *(string, optional, enum: `VERIFICATION`, `DURABLE_ACTION`)*
- `argv` *(array<string>, required, minItems: 1)*
- `protocolProjectRoot` *(string, optional, minLength: 1)*
- `cwd` *(string, required, minLength: 1)*
- `executionIsolation` *(string, optional, enum: `NATIVE_PROJECT`, `PROJECT_ISOLATED`, `SYSTEM_ISOLATED`)*
- `isolation` *(object, optional)*
  - `mode` *(string, required, enum: `NATIVE_PROJECT`, `PROJECT_ISOLATED`, `SYSTEM_ISOLATED`)*
  - `isolated` *(boolean, required)*
  - `liveProjectWritable` *(boolean, required)*
  - `networkPolicy` *(string, required, minLength: 1)*
  - `environmentPolicy` *(string, required, minLength: 1)*
- `resolution` *(object, required)*
  - `resolutionMode` *(string, required, minLength: 1)*
  - `mayInstall` *(boolean, required)*
  - `installer` *(string or null, required)*
  - `tool` *(string or null, required)*
- `dispatch` *(object, optional)*
  - `kind` *(string, optional, minLength: 1)*
  - `scriptName` *(string, optional, minLength: 1)*
- `startedAt` *(string, required, minLength: 1)*
- `finishedAt` *(string, required, minLength: 1)*
- `status` *(string, required, enum: `passed`, `failed`)*
- `exitCode` *(integer or null, required)*
- `durationMs` *(integer, optional, minimum: 0)*
- `termination` *(string, optional, enum: `exit`, `signal`, `timeout`, `spawn-error`)*
- `signal` *(string or null, optional)*
- `stdoutSha256` *(string, optional, pattern: `^[a-f0-9]{64}$`)*
- `stderrSha256` *(string, optional, pattern: `^[a-f0-9]{64}$`)*
- `stdoutBytes` *(integer, optional, minimum: 0)*
- `stderrBytes` *(integer, optional, minimum: 0)*
- `outputTruncated` *(boolean, optional)*
- `timeoutMs` *(integer, optional, minimum: 1)*
- `terminationGraceMs` *(integer, optional, minimum: 1)*

<!-- END FORGELOOP GENERATED: schema:execution -->

Isolation metadata must be intrinsically truthful. `liveProjectWritable` is an
enforced host guarantee reported by the trusted execution adapter, not a claim
implied by a different working directory; a disposable copy alone is
insufficient. Canonical combinations are `NATIVE_PROJECT` (`isolated=false`,
`liveProjectWritable=true`), `PROJECT_ISOLATED` (`isolated=true`,
`liveProjectWritable=false`), and `SYSTEM_ISOLATED` (`isolated=true`,
`liveProjectWritable=false`, `networkPolicy=DENIED`). Contradictory metadata is
rejected with `E_VERIFICATION_EXECUTION_INVALID` before the execution artifact
is persisted, even when the required isolation policy would be `NONE`.

---

### 2.13 `task-state/<taskKey>/task.json`

<!-- forgeloop-doc: schema=task-descriptor artifact=.forgeloop/task-state/<task-key>/task.json -->

Canonical task descriptor declaring task identity, key, timestamps, and write claims.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:task-descriptor -->

- `schemaVersion` *(integer, required, const: 1)*
- `protocolVersion` *(integer, required, const: 1)*
- `taskId` *(string, required, minLength: 1)*
- `taskKey` *(string, required, pattern: `^[a-f0-9]{64}$`)*
- `createdAt` *(string, required)*
- `updatedAt` *(string, required)*
- `writeClaims` *(array<string>, required)*

<!-- END FORGELOOP GENERATED: schema:task-descriptor -->

---

### 2.14 `policy/rules.json`

<!-- forgeloop-doc: schema=policy-rules artifact=.forgeloop/policy/rules.json -->

Repository-level executable policy rules declaring verification constraints.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:policy-rules -->

- `schemaVersion` *(number, required, const: 1)*
- `rules` *(array<object>, required)*
  - `id` *(string, required, minLength: 1)*
  - `severity` *(string, required, enum: `HIGH`, `MEDIUM`, `LOW`, `INFO`)*
  - `source` *(string, required, enum: `builtin`, `discovered`, `project`)*
  - `blocking` *(boolean, required)*
  - `why` *(string, required, minLength: 1)*
  - `fix` *(string, required, minLength: 1)*
  - `confidence` *(string, optional, enum: `HIGH`, `MEDIUM`, `LOW`, `UNKNOWN`)*
  - `scope` *(object, optional)*
    - `includes` *(array<string>, optional)*
    - `excludes` *(array<string>, optional)*
  - `check` *(object, required)*
    - `type` *(string, required, minLength: 1)*
    - `adapter` *(string, optional)*
    - `command` *(array<string>, optional)*
    - `threshold` *(number, optional)*
    - `parameters` *(object, optional)*

<!-- END FORGELOOP GENERATED: schema:policy-rules -->

---

### 2.15 `policy/discovery.json`

<!-- forgeloop-doc: schema=policy-discovery artifact=.forgeloop/policy/discovery.json -->

Automated non-interactive discovery report recording inferred architecture, conventions, and confidence scores.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:policy-discovery -->

- `schemaVersion` *(number, required, const: 1)*
- `languages` *(array<string>, required)*
- `testing` *(object, required)*
  - `detected` *(boolean, required)*
  - `command` *(array<string>, optional)*
  - `framework` *(string, optional)*
  - `confidence` *(string, required, enum: `HIGH`, `MEDIUM`, `LOW`, `UNKNOWN`)*
- `linting` *(object, required)*
  - `detected` *(boolean, required)*
  - `command` *(array<string>, optional)*
  - `tool` *(string, optional)*
  - `confidence` *(string, required, enum: `HIGH`, `MEDIUM`, `LOW`, `UNKNOWN`)*
- `architecture` *(object, required)*
  - `value` *(string,null, optional)*
  - `confidence` *(string, required, enum: `HIGH`, `MEDIUM`, `LOW`, `UNKNOWN`)*
  - `enforcement` *(string, required, enum: `BLOCKING`, `ADVISORY`, `NONE`)*
- `discoveredRules` *(array<object>, required)*

<!-- END FORGELOOP GENERATED: schema:policy-discovery -->

---

### 2.16 `policy/baseline.json`

<!-- forgeloop-doc: schema=policy-baseline artifact=.forgeloop/policy/baseline.json -->

Brownfield policy baseline recording tolerated legacy violations by cryptographic fingerprint.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:policy-baseline -->

- `schemaVersion` *(number, required, const: 1)*
- `createdAt` *(string, required, minLength: 1)*
- `entries` *(array<object>, required)*
  - `ruleId` *(string, required, minLength: 1)*
  - `fingerprints` *(array<string>, required)*
  - `reviewBy` *(string, optional)*
  - `details` *(array<object>, optional)*

<!-- END FORGELOOP GENERATED: schema:policy-baseline -->

---

### 2.17 `policy/policy.lock`

<!-- forgeloop-doc: schema=policy-lock artifact=.forgeloop/policy/policy.lock -->

Cryptographic policy digest lock securing effective rules and baseline state.

The lock protects the **effective policy** — built-in rules plus discovered
rules plus project rules/overrides, combined with the baseline. `algorithm`,
`digest`, `rulesDigest`, and `baselineDigest` all participate in lock integrity
validation; a disagreement with the current effective policy produces
`E_POLICY_LOCK_MISMATCH`. `capturedAt` is informational metadata only — it is
not part of semantic policy identity, and changing it alone does not represent
a policy change. A missing or malformed lock fails closed rather than being
silently ignored.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:policy-lock -->

- `schemaVersion` *(number, required, const: 1)*
- `algorithm` *(string, required, const: `sha256`)*
- `digest` *(string, required, minLength: 1)*
- `rulesDigest` *(string, required)*
- `baselineDigest` *(string, required)*
- `capabilityPolicyDigest` *(string, optional, pattern: `^sha256:[a-f0-9]{64}$`)*
- `capturedAt` *(string, optional)*

<!-- END FORGELOOP GENERATED: schema:policy-lock -->

---

### 2.18 `task-state/<taskKey>/policy-snapshot.json`

<!-- forgeloop-doc: schema=policy-snapshot artifact=.forgeloop/task-state/<task-key>/policy-snapshot.json -->

Task-scoped immutable snapshot of effective policy captured during preflight to detect policy drift.

A snapshot binds the task to the policy that was authorized at activation:
`policyDigest`, the effective `rules`, semantic `baseline` entries, and
`baselineDigest`. Later policy changes are classified by semantic diff as
`TIGHTEN`, `NEUTRAL`, `WEAKEN`, or `UNKNOWN`. Modern snapshots carry the full
semantic baseline; legacy snapshots without baseline state leave baseline
comparison explicitly `UNKNOWN` rather than assuming an empty baseline.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:policy-snapshot -->

- `schemaVersion` *(number, required, const: 1)*
- `policyDigest` *(string, required, minLength: 1)*
- `rules` *(array<string,object>, required)*
- `baseline` *(object, optional)*
- `baselineDigest` *(string, optional)*
- `capabilityPolicyDigest` *(string, optional, pattern: `^sha256:[a-f0-9]{64}$`)*
- `capabilityPolicyFingerprint` *(string, optional, pattern: `^[a-f0-9]{64}$`)*
- `capturedAt` *(string, optional)*

<!-- END FORGELOOP GENERATED: schema:policy-snapshot -->

---

### 2.19 `task-state/<taskKey>/recovery.json`

<!-- forgeloop-doc: schema=task-recovery artifact=.forgeloop/task-state/<task-key>/recovery.json -->

Durable current-state input for claim-release recovery. It records the
classification and exact claims released while leaving lifecycle work state,
receipts, failures, policy, and continuity unchanged. Structural validity alone
does not release claims: ForgeLoop must also validate the descriptor, work
state, full ledger, referenced recovery event, and absence of a later matching
resume. A mismatch is `INCONSISTENT`, preserves historical claims, and suspends
ordinary mutation until the protocol-owned evidence is repaired.

`CALLER_ACKNOWLEDGED` is not host attestation. `HOST_ATTESTED` requires a
host-owned `grantRef`; the standalone CLI does not self-issue that authority.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:task-recovery -->

- `schemaVersion` *(number, required, const: 1)*
- `protocolVersion` *(number, required, const: 1)*
- `taskId` *(string, required, minLength: 1)*
- `status` *(string, required, const: `RECOVERED`)*
- `recoveredAt` *(string, required)*
- `recoveryId` *(string, required, pattern: `^recovery-[A-Za-z0-9-]+$`)*
- `recoveryEventSeq` *(integer, required, minimum: 1)*
- `classificationAtRecovery` *(string, required, enum: `STALE`, `ABANDONED`, `LEGACY_BOUNDARY_MIGRATED`)*
- `reasonCodes` *(array<string>, required)*
- `releasedClaims` *(array<string>, required)*
- `previousPhase` *(string, required, minLength: 1)*
- `previousRevision` *(integer, required, minimum: 0)*
- `repositoryFingerprint` *(object, required)*
  - `branch` *(string,null, required)*
  - `head` *(string,null, required)*
- `authority` *(object, required)*
  - `kind` *(string, required, enum: `CALLER_ACKNOWLEDGED`, `HOST_ATTESTED`)*
  - `grantRef` *(string, optional, minLength: 1)*

<!-- END FORGELOOP GENERATED: schema:task-recovery -->

---

### 2.20 `task-state/<taskKey>/actions/action-<id>.json`

<!-- forgeloop-doc: schema=action artifact=.forgeloop/task-state/<task-key>/actions/action-<id>.json -->

Durable external action artifact recording intent, capability policy binding,
authority, execution provenance, ambiguity, and reconciliation state for a
side-effecting operation. The `actionFingerprint` covers immutable identity
fields only; mutable state lives in `state` and `revision`.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:action -->

- `schemaVersion` *(number, required, const: 1)*
- `taskId` *(string, required, minLength: 1, maxLength: 256)*
- `actionId` *(string, required, pattern: `^action-[A-Za-z0-9_-]+$`)*
- `actionFingerprint` *(string, required, pattern: `^[a-f0-9]{64}$`)*
- `effectClass` *(string, required, enum: `READ_ONLY`, `REVERSIBLE_WRITE`, `IRREVERSIBLE_WRITE`, `EXTERNAL_PUBLICATION`, `DESTRUCTIVE`)*
- `capability` *(string, required, enum: `filesystem.read`, `filesystem.write`, `process.execute`, `dependency.install`, `network.read`, `network.write`, `repository.commit`, `repository.push`, `repository.pull_request`, `external.publish`, `external.delete`, `deployment.execute`)*
- `operation` *(string, required, minLength: 1, maxLength: 512)*
- `target` *(string, required, minLength: 1, maxLength: 512)*
- `idempotencyKey` *(string or null, required)*
- `requiredForCompletion` *(boolean, required)*
- `requirement` *(string or null, required)*
- `provenance` *(string, required, enum: `FORGELOOP_EXECUTED`, `HOST_ATTESTED`, `CALLER_REPORTED`, `HOST_REPORTED`, `EXTERNAL_OBSERVED`)*
- `state` *(string, required, enum: `PROPOSED`, `AUTHORIZED`, `STARTED`, `COMMITTED`, `VERIFIED`, `FAILED`, `COMMIT_UNKNOWN`, `CANCELLED`)*
- `revision` *(integer, required, minimum: 0)*
- `createdAt` *(string, required, minLength: 1)*
- `updatedAt` *(string, required, minLength: 1)*
- `lastEvidenceRef` *(string or null, optional)*
- `lastReconciliationAt` *(string or null, optional)*
- `commitResultCode` *(object or null, optional)*

<!-- END FORGELOOP GENERATED: schema:action -->

---

### 2.21 `task-state/<taskKey>/approvals/approval-<id>.json`

<!-- forgeloop-doc: schema=approval artifact=.forgeloop/task-state/<task-key>/approvals/approval-<id>.json -->

Crash-safe durable approval request cryptographically bound to the exact action
fingerprint, contract fingerprint, task revision, and capability. Any drift
makes the approval stale. Resolution is one-time; approvals persist across
process and harness boundaries.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:approval -->

- `schemaVersion` *(number, required, const: 1)*
- `taskId` *(string, required, minLength: 1, maxLength: 256)*
- `approvalId` *(string, required, pattern: `^approval-[A-Za-z0-9_-]+$`)*
- `actionId` *(string, required, pattern: `^action-[A-Za-z0-9_-]+$`)*
- `actionFingerprint` *(string, required, pattern: `^[a-f0-9]{64}$`)*
- `contractFingerprint` *(string, required, pattern: `^[a-f0-9]{64}$`)*
- `taskRevision` *(integer, required, minimum: 0)*
- `capability` *(string, required, enum: `filesystem.read`, `filesystem.write`, `process.execute`, `dependency.install`, `network.read`, `network.write`, `repository.commit`, `repository.push`, `repository.pull_request`, `external.publish`, `external.delete`, `deployment.execute`)*
- `status` *(string, required, enum: `PENDING`, `APPROVED`, `REJECTED`)*
- `requestedAt` *(string, required, minLength: 1)*
- `reason` *(string or null, optional)*
- `decision` *(string, optional, enum: `APPROVED`, `REJECTED`)*
- `resolvedAt` *(string or null, optional)*
- `authorityKind` *(string, optional, enum: `CALLER_ACKNOWLEDGED`, `HOST_ATTESTED`)*
- `hostGrantRef` *(string or null, optional)*

<!-- END FORGELOOP GENERATED: schema:approval -->

---

### 2.22 `policy/capabilities.json`

<!-- forgeloop-doc: schema=capability-policy artifact=.forgeloop/policy/capabilities.json -->

Project-local machine-readable capability policy mapping canonical capability
values to ALLOW, DENY, REQUIRE_AUTHORITY, or REQUIRE_APPROVAL decisions. This
artifact is policy specification only; it can never mint host authority.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:capability-policy -->

- `schemaVersion` *(number, required, const: 1)*
- `defaultDecision` *(string, required, enum: `ALLOW`, `DENY`)*
- `rules` *(array<object>, required)*
  - `capability` *(string, required, enum: `filesystem.read`, `filesystem.write`, `process.execute`, `dependency.install`, `network.read`, `network.write`, `repository.commit`, `repository.push`, `repository.pull_request`, `external.publish`, `external.delete`, `deployment.execute`)*
  - `decision` *(string, required, enum: `ALLOW`, `DENY`, `REQUIRE_AUTHORITY`, `REQUIRE_APPROVAL`)*

<!-- END FORGELOOP GENERATED: schema:capability-policy -->

---

### 2.23 `task-state/<taskKey>/evaluations/eval-<id>.json`

<!-- forgeloop-doc: schema=trajectory-evaluation artifact=.forgeloop/task-state/<task-key>/evaluations/eval-<id>.json -->

Immutable trajectory evaluation result compiled from the canonical trace against
a project-local reference scenario. Evaluations are projections over canonical
evidence and never override lifecycle validation.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:trajectory-evaluation -->

- `schemaVersion` *(number, required, const: 1)*
- `evaluationId` *(string, required, pattern: `^eval-[A-Za-z0-9_-]+$`)*
- `scenarioId` *(string, required, minLength: 1, maxLength: 128)*
- `scenarioFingerprint` *(string, optional, pattern: `^[a-f0-9]{64}$`)*
- `taskId` *(string, required, minLength: 1, maxLength: 256)*
- `result` *(string, required, enum: `PASS`, `FAIL`)*
- `completionValid` *(boolean, required)*
- `safetyValid` *(boolean, required)*
- `missingMilestones` *(array<string>, optional)*
- `limits` *(object, optional)*
- `efficiency` *(object or null, optional)*
- `computedAt` *(string, optional, minLength: 1)*
- `source` *(string, optional, enum: `PROJECT_LOCAL_REFERENCE`)*
- `evaluationFingerprint` *(string, required, pattern: `^[a-f0-9]{64}$`)*

<!-- END FORGELOOP GENERATED: schema:trajectory-evaluation -->

### 2.24 `task-state/<taskKey>/usage.json`

<!-- forgeloop-doc: schema=usage artifact=.forgeloop/task-state/<task-key>/usage.json -->

Optional task-scoped usage telemetry. Provider and host reports cross the
trusted runtime boundary; the CLI fallback remains explicitly
`ACTOR_REPORTED`. Usage is informational and never acts as verification
evidence.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:usage -->

- `schemaVersion` *(number, required, const: 1)*
- `protocolVersion` *(number, required, const: 1)*
- `taskId` *(string, required, minLength: 1)*
- `recordedAt` *(string, required, minLength: 1)*
- `usage` *(object, required)*
  - `inputTokens` *(integer,null, required, minimum: 0)*
  - `outputTokens` *(integer,null, required, minimum: 0)*
  - `cacheReadTokens` *(integer,null, required, minimum: 0)*
  - `cacheWriteTokens` *(integer,null, required, minimum: 0)*
  - `totalTokens` *(integer,null, required, minimum: 0)*
  - `costUsd` *(number,null, required, minimum: 0)*
  - `model` *(string,null, required)*
  - `provider` *(string,null, required)*
  - `source` *(string, required, enum: `PROVIDER_REPORTED`, `HOST_REPORTED`, `ACTOR_REPORTED`, `UNKNOWN`)*

<!-- END FORGELOOP GENERATED: schema:usage -->

### 2.25 `task-state/<taskKey>/workspace-binding.json`

<!-- forgeloop-doc: schema=workspace-binding artifact=.forgeloop/task-state/<task-key>/workspace-binding.json -->

Optional immutable binding between a task and the exact Git repository/worktree
identity used for protocol mutations. A binding is enforced when present; it
does not fabricate a binding when absent.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:workspace-binding -->

- `schemaVersion` *(number, required, const: 1)*
- `protocolVersion` *(number, required, const: 1)*
- `taskId` *(string, required, minLength: 1)*
- `mode` *(string, required, const: `GIT_WORKTREE`)*
- `repositoryIdentity` *(string, required, pattern: `^[a-f0-9]{64}$`)*
- `workspaceIdentity` *(string, required, pattern: `^[a-f0-9]{64}$`)*
- `branchAtBind` *(string or null, required)*
- `headAtBind` *(string or null, required)*
- `boundAt` *(string, required, minLength: 1)*
- `metadata` *(object, optional)*

<!-- END FORGELOOP GENERATED: schema:workspace-binding -->

### 2.26 `task-state/<taskKey>/handoffs/handoff-<id>.json`

<!-- forgeloop-doc: schema=handoff-envelope artifact=.forgeloop/task-state/<task-key>/handoffs/handoff-<id>.json -->

Immutable protocol-derived handoff snapshot. The caller may provide only
recipient intent; lifecycle state, evidence, continuity, and the artifact
digest are derived by ForgeLoop. A handoff is not delegation, review,
completion, or authority evidence.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:handoff-envelope -->

- `schemaVersion` *(number, required, const: 1)*
- `protocolVersion` *(number, required, const: 1)*
- `handoffId` *(string, required, pattern: `^handoff-[A-Za-z0-9_-]+$`)*
- `taskId` *(string, required, minLength: 1)*
- `createdAt` *(string, required, minLength: 1)*
- `intent` *(object, required)*
  - `recipientHint` *(string, optional, minLength: 1)*
  - `note` *(string, optional, minLength: 1)*
- `state` *(object, required)*
  - `phase` *(string, required, minLength: 1)*
  - `revision` *(integer, required, minimum: 0)*
  - `verificationCycle` *(integer, required, minimum: 1)*
  - `workStateFingerprint` *(string, optional, pattern: `^[a-f0-9]{64}$`)*
  - `contractFingerprint` *(string, required, pattern: `^[a-f0-9]{64}$`)*
  - `routeFingerprint` *(string or null, required)*
  - `repositoryFingerprint` *(object, required)*
  - `writeClaims` *(array<string>, required)*
  - `changedPaths` *(array<string>, required)*
- `evidence` *(object, required)*
  - `executionRefs` *(array<string>, required)*
  - `checkIds` *(array<string>, required)*
- `continuity` *(object, required)*
  - `ref` *(string, required, minLength: 1)*
  - `fingerprint` *(string or null, required)*
- `artifactDigest` *(string, required, pattern: `^[a-f0-9]{64}$`)*

<!-- END FORGELOOP GENERATED: schema:handoff-envelope -->

The handoff `state` binds the immutable snapshot to the exact
`workStateFingerprint`, contract identity, route identity, selected-guide
context, repository branch/HEAD fingerprint, changed paths, and historical
write claims observed at creation. `HANDOFF_CREATED` records the envelope's
relationship to the task ledger. A later `HANDOFF_ACCEPTED` event records only
that one consumer operationally consumed the unchanged snapshot; it does not
transfer claims, create evidence, or grant authority.

Acceptance status is a derived projection from the immutable handoff, its
digest, and the validated event ledger. Acceptance fields are intentionally not
stored in the handoff JSON itself. Invalid or mismatched ledger history
projects `INCONSISTENT`, never a successful acceptance.

### 2.27 `task-state/<taskKey>/responsibility.json`

<!-- forgeloop-doc: schema=responsibility artifact=.forgeloop/task-state/<task-key>/responsibility.json -->

Optional immutable pass constraints for allowed paths, read-only paths, frozen
inputs, and required checks. The constraints are checked at mutation, audit,
and completion boundaries.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:responsibility -->

- `schemaVersion` *(number, required, const: 1)*
- `protocolVersion` *(number, required, const: 1)*
- `taskId` *(string, required, minLength: 1)*
- `label` *(string, required, minLength: 1)*
- `createdAt` *(string, required, minLength: 1)*
- `allowedPaths` *(array<string>, required)*
- `readOnlyPaths` *(array<string>, required)*
- `requiredCheckIds` *(array<string>, required)*
- `frozenInputs` *(object, required)*
  - `contract` *(boolean, optional)*
  - `route` *(boolean, optional)*
  - `claims` *(boolean, optional)*
- `baseline` *(object, required)*
  - `contractFingerprint` *(string, required, pattern: `^[a-f0-9]{64}$`)*
  - `routeFingerprint` *(string or null, required)*
  - `claimsFingerprint` *(string, required, pattern: `^[a-f0-9]{64}$`)*

<!-- END FORGELOOP GENERATED: schema:responsibility -->

### 2.28 `task-state/<taskKey>/verification-scope.json`

<!-- forgeloop-doc: schema=verification-scope artifact=.forgeloop/task-state/<task-key>/verification-scope.json -->

Read-only verification planning artifact. `AUTO` resolves to `CHANGED` or
`CLAIMED` only when a trusted scoped-checker capability is available;
otherwise it resolves to `FULL`. ForgeLoop does not publish a heuristic
`IMPACTED` mode.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:verification-scope -->

- `schemaVersion` *(number, required, const: 1)*
- `protocolVersion` *(number, required, const: 1)*
- `taskId` *(string, required, minLength: 1)*
- `requestedMode` *(string, required, enum: `AUTO`, `CHANGED`, `CLAIMED`, `FULL`)*
- `resolvedMode` *(string, required, enum: `CHANGED`, `CLAIMED`, `FULL`, `UNRESOLVED`)*
- `verificationCycle` *(integer, required, minimum: 1)*
- `changedPaths` *(array<string>, required)*
- `claimedPaths` *(array<string>, required)*
- `selectedPaths` *(array<string>, required)*
- `reasons` *(array<string>, required)*
- `fallback` *(null or object, required)*
- `contractFingerprint` *(string, required, pattern: `^[a-f0-9]{64}$`)*
- `repositoryFingerprint` *(object, required)*
- `claimsFingerprint` *(string, required, pattern: `^[a-f0-9]{64}$`)*
- `checkerCapabilityFingerprint` *(string, optional, pattern: `^[a-f0-9]{64}$`)*
- `createdAt` *(string, required, minLength: 1)*

<!-- END FORGELOOP GENERATED: schema:verification-scope -->

### 2.29 `task-state/<taskKey>/attestations/code-manifest.json`

<!-- forgeloop-doc: schema=code-manifest artifact=.forgeloop/task-state/<task-key>/attestations/code-manifest.json -->

Deterministic raw-byte source-content manifest. Entries are sorted by safe
slash-separated paths, symlinks are represented by link bytes, Git links are
represented by provider identities, and `.forgeloop/**` is excluded.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:code-manifest -->

- `schemaVersion` *(number, required, const: 1)*
- `protocolVersion` *(number, required, const: 1)*
- `taskId` *(string, required, minLength: 1)*
- `verificationCycle` *(integer, required, minimum: 1)*
- `capture` *(object, required)*
  - `mode` *(string, required, enum: `WORKTREE`, `INDEX`, `COMMIT`)*
  - `revisionProvider` *(string, required, minLength: 1)*
  - `baseRevision` *(string or null, required)*
  - `observedRevision` *(string, required, minLength: 1)*
  - `providerMetadata` *(object, required)*
- `bindings` *(object, required)*
  - `contractFingerprint` *(string, required, pattern: `^[a-f0-9]{64}$`)*
  - `routeFingerprint` *(string or null, required)*
  - `stateFingerprint` *(string, required, pattern: `^[a-f0-9]{64}$`)*
  - `receiptFingerprint` *(string, required, pattern: `^[a-f0-9]{64}$`)*
  - `ledgerSeq` *(integer, required, minimum: 1)*
  - `ledgerHash` *(string, required, pattern: `^[a-f0-9]{64}$`)*
- `entries` *(array<object>, required)*
  - `path` *(string, required, minLength: 1)*
  - `sourcePath` *(string, optional, minLength: 1)*
  - `operation` *(string, required, enum: `ADDED`, `MODIFIED`, `DELETED`, `RENAMED`, `COPIED`, `TYPE_CHANGED`)*
  - `kind` *(string, required, enum: `FILE`, `SYMLINK`, `GITLINK`, `DELETED`)*
  - `sha256` *(string, optional, pattern: `^[a-f0-9]{64}$`)*
  - `providerContentId` *(string, optional, minLength: 1)*
  - `providerMetadata` *(object, optional)*
- `contentDigest` *(string, required, pattern: `^[a-f0-9]{64}$`)*

<!-- END FORGELOOP GENERATED: schema:code-manifest -->

### 2.30 `task-state/<taskKey>/attestations/statement.json`

<!-- forgeloop-doc: schema=in-toto-statement artifact=.forgeloop/task-state/<task-key>/attestations/statement.json -->

Deterministic in-toto Statement v1 binding a code-manifest digest to the
completed ForgeLoop evidence tuple. The statement is immutable and does not
back-reference itself from the execution receipt.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:in-toto-statement -->

- `schemaVersion` *(number, required, const: 1)*
- `_type` *(string, required, const: `https://in-toto.io/Statement/v1`)*
- `subject` *(array<object>, required, minItems: 1)*
  - `name` *(string, required, minLength: 1)*
  - `digest` *(object, required)*
    - `sha256` *(string, required, pattern: `^[a-f0-9]{64}$`)*
- `predicateType` *(string, required, const: `https://forgeloop.dev/attestation/v1`)*
- `predicate` *(object, required)*

<!-- END FORGELOOP GENERATED: schema:in-toto-statement -->

### 2.31 `task-state/<taskKey>/attestations/statement.sigstore.json`

<!-- forgeloop-doc: external-artifact=.forgeloop/task-state/<task-key>/attestations/statement.sigstore.json -->

Optional external signing-provider bundle. Its presence is not proof of a
valid signature; verification must be performed by the configured signing
provider with the requested identity and issuer policy.

### 2.32 `task-state/<taskKey>/structural-quality/`

<!-- forgeloop-doc: schema=structural-quality artifact=.forgeloop/task-state/<task-key>/structural-quality/baseline.json -->

Task-owned provider-neutral structural-quality evidence. The directory contains
one immutable `baseline.json` and zero or more typed evaluations under
`evaluations/cycle-<cycle>-attempt-<attempt>.json`. There is deliberately no
`latest.json`; readers derive the latest evaluation by numeric cycle and
attempt ordering.

The baseline is captured before execution and cannot be replaced after
`EXECUTING` begins. Evaluations bind the current verification cycle to the
baseline, contract, route, policy, scope, provider identity, and persisted
check projection. Portable bundles include the evidence needed for audit and
validate it without starting the provider.

#### Canonical Fields

<!-- BEGIN FORGELOOP GENERATED: schema:structural-quality -->

- `schemaVersion` *(number, required, const: 1)*
- `protocolVersion` *(number, required, const: 1)*
- `role` *(string, required, enum: `BASELINE`, `EVALUATION`)*
- `taskId` *(string, required, minLength: 1)*
- `capturedAt` *(string, required, minLength: 1)*
- `verificationCycle` *(integer or null, required)*
- `attempt` *(integer, required, minimum: 1)*
- `status` *(string, required, enum: `PASS`, `FAIL`, `BLOCKED`, `NOT_OBSERVED`)*
- `reasonCodes` *(array<string>, required)*
- `errorCode` *(string or null, optional)*
- `baselineSignal` *(integer or null, optional)*
- `currentSignal` *(integer or null, optional)*
- `bindings` *(object, required)*
  - `contractFingerprint` *(string, required, pattern: `^[a-f0-9]{64}$`)*
  - `routeFingerprint` *(string, required, pattern: `^[a-f0-9]{64}$`)*
  - `policyFingerprint` *(string, required, pattern: `^[a-f0-9]{64}$`)*
  - `scopeFingerprint` *(string, required, pattern: `^[a-f0-9]{64}$`)*
  - `baselineFingerprint` *(string or null, optional)*
  - `sourceMaterialFingerprint` *(string or null, optional)*
  - `stateRevision` *(integer, optional, minimum: 0)*
- `sourceObservation` *(object, optional)*
  - `beforeFingerprint` *(string, required, pattern: `^[a-f0-9]{64}$`)*
  - `afterFingerprint` *(string, required, pattern: `^[a-f0-9]{64}$`)*
  - `stable` *(boolean, required)*
- `provider` *(object, required)*
  - `id` *(string, required, minLength: 1)*
  - `version` *(string or null, required)*
  - `transport` *(string, required, minLength: 1)*
  - `executionMode` *(string, required, minLength: 1)*
  - `measurementModel` *(string, optional, minLength: 1)*
  - `compatibilityKey` *(string or null, optional)*
- `detection` *(object, optional)*
  - `available` *(boolean, required)*
  - `providerId` *(string, required, minLength: 1)*
  - `providerVersion` *(string or null, optional)*
  - `transport` *(string, required, minLength: 1)*
  - `measurementModel` *(string, optional, minLength: 1)*
  - `compatibilityKey` *(string or null, optional)*
  - `reasonCode` *(string or null, required)*
- `scope` *(object, required)*
  - `kind` *(string, required, const: `PROJECT`)*
  - `projectRoot` *(string, required, const: `.`)*
  - `providerConfigFingerprint` *(string or null, optional)*
  - `architectureRulesFingerprint` *(string, optional, pattern: `^[a-f0-9]{64}$`)*
- `snapshot` *(snapshot, optional)*
  - `qualitySignal` *(integer, required, minimum: 0, maximum: 10000)*
  - `bottleneck` *(string, required, enum: `modularity`, `acyclicity`, `depth`, `equality`, `redundancy`)*
  - `rootCauses` *(object, required)*
    - `modularity` *(rootCause, required)*
      - `score` *(integer, required, minimum: 0, maximum: 10000)*
      - `raw` *(number, required)*
    - `acyclicity` *(rootCause, required)*
      - `score` *(integer, required, minimum: 0, maximum: 10000)*
      - `raw` *(number, required)*
    - `depth` *(rootCause, required)*
      - `score` *(integer, required, minimum: 0, maximum: 10000)*
      - `raw` *(number, required)*
    - `equality` *(rootCause, required)*
      - `score` *(integer, required, minimum: 0, maximum: 10000)*
      - `raw` *(number, required)*
    - `redundancy` *(rootCause, required)*
      - `score` *(integer, required, minimum: 0, maximum: 10000)*
      - `raw` *(number, required)*
  - `statistics` *(object, required)*
    - `files` *(integer or null, required)*
    - `lines` *(integer or null, required)*
    - `importEdges` *(integer or null, required)*
    - `crossModuleEdges` *(integer or null, required)*
  - `diagnostics` *(object or null, required)*
- `comparison` *(comparison, optional)*
  - `comparable` *(boolean, required)*
  - `qualityDelta` *(integer or null, required)*
  - `rootCauseDeltas` *(object, required)*
  - `failedConditions` *(array<string>, optional)*
  - `status` *(string, required, enum: `PASS`, `FAIL`, `BLOCKED`, `NOT_OBSERVED`)*
  - `reasonCodes` *(array<string>, required)*

<!-- END FORGELOOP GENERATED: schema:structural-quality -->

For `BASELINE` artifacts and `PASS`/`FAIL` evaluations, `sourceMaterialFingerprint`
and stable `sourceObservation` are conditionally required; their before and after
fingerprints must equal the bound source fingerprint. `BLOCKED` and
`NOT_OBSERVED` artifacts may omit these observed-source fields.

## Transaction diagnostics and retention

`.forgeloop/.txn/<transactionId>/manifest.json` records transaction identity,
status, staged writes, and recovery diagnostics. `COMMITTED`, `ROLLED_BACK`,
and `ABORTED` are terminal; an aborted staging callback did not publish its
staged writes. A successful recovery is not reported as incomplete on the next
doctor inspection. The transaction lock still protects recovery from live
writers.

The repository maintenance command described in
[CONTRIBUTING.md](../CONTRIBUTING.md#focused-verification-and-maintenance)
compacts eligible stage/backup payloads only. It retains manifests and ledgers,
so historical manifest enumeration remains linear. These diagnostics are not
substitutes for a valid execution receipt or external-action reconciliation.

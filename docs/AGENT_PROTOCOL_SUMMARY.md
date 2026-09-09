# ForgeLoop Agent Protocol Summary

> Generated from the ForgeLoop protocol registries. This file is a concise navigation aid; the normative documents, schemas, and CLI implementation remain authoritative.

## Scope

ForgeLoop is a portable protocol and support CLI for verifiable engineering workflows. It records and validates task state, contracts, routing, checks, evidence, continuity, and optional code attestations. It does not become an agent scheduler, delegation service, source-control authority, or secret manager.

Protocol version: 1
Package version: 1.11.0

## Canonical loop

1. Discover existing work with forgeloop task-list --json.
2. Select or create one task, then run forgeloop next --task <id> --json.
3. Persist the contract, route, gates, and source registry; require forgeloop preflight to return READY.
4. Execute bounded checks through the canonical CLI and preserve execution provenance.
5. Reconcile continuity, inspect evidence, and advance through VERIFYING and REVIEWING.
6. Run forgeloop complete; accept completion only when the validator returns VALID.
7. Run forgeloop next again and follow the returned lifecycle action to a terminal state or an explicit blocker.

## Adaptive execution profiles

`complianceMode` controls how strongly project policy is enforced. The
orthogonal `executionProfile` controls process and context depth: `auto`
resolves deterministically to `light`, `balanced`, or `full` from route,
contract, and task metadata. CLI requests take precedence over project
configuration, but a safety floor always wins. Profiles never remove required
contracts, gates, verification, provenance, lifecycle phases, or validated
completion. Protocol-v1 routes without the field project to `balanced` for
compatibility without rewriting historical artifacts.

For `light` tasks, hosts should use `next --compact` or `task-show --compact`,
load only relevant guide sections, keep plans concise, and avoid optional
reflection, trajectory evaluation, handoff, attestation, and continuity
artifacts unless requested, required, or needed for recovery. The lifecycle
chronology remains unchanged.

The read-only `task/context` integration resource provides the canonical
profile-aware projection: objective, deliverables, constraints, selected guide
IDs, phase, next action, verification requirements, and context policy. A
profile changes presentation and optional context only; it never permits a
phase or required gate to be skipped.

Usage telemetry is provider or host reported when available, actor-reported
only through the explicit `usage-record` fallback, and `UNKNOWN` otherwise.
ForgeLoop never estimates tokens or treats usage as verification evidence.
`efficiency --task` is read-only and returns `NOT_COMPARABLE` unless a
project-local baseline has matching metadata.

Measured execution-profile benchmarks are observational. The reproducible
runner accepts provider or host usage, records actual timing, requires PASS
verification and matching metadata for comparisons, and reports `NOT_MEASURED`
or `NOT_COMPARABLE` when evidence is absent or incompatible. See
`docs/EXECUTION_PROFILE_BENCHMARKS.md` for the runner and schemas.

## Authority boundaries

- Protocol-derived facts outrank actor-provided labels, free-form summaries, and guessed identities.
- Optional artifacts are reported as NOT_APPLICABLE when absent; malformed active security artifacts fail closed.
- Workspace binding confirms an explicit Git worktree identity but is not a portability requirement for attestation.
- Handoff envelopes record immutable intent and state snapshots; they do not delegate work or grant completion authority.
- Responsibility contracts constrain paths, checks, and frozen inputs; they do not prove identity or authorship.
- Verification scope describes planned verification breadth. Attestation coverage proves content for a concrete revision. These are separate claims.
- Attestation manifests exclude ForgeLoop protocol metadata and bind to the completion receipt and append-only ledger without circular references.
- Verification commands are read-only. Signing is external; private keys and credentials are never persisted by ForgeLoop.

## Lifecycle

Phases: RECEIVED, DISCOVERING, CONTRACT_READY, ROUTED, DESIGNING, PLANNED, EXECUTING, VERIFYING, DIAGNOSING, CORRECTING, REVIEWING, COMPLETE, BLOCKED

## Feature registry

| Feature | Version | Supported |
| --- | --- | --- |
| adaptiveExecutionProfiles | 1 | yes |
| advisoryContextProviders | 1 | yes |
| canonicalHandoffs | 2 | yes |
| capabilityPolicy | 1 | yes |
| codeAttestation | 1 | yes |
| compactLifecycleOutput | 1 | yes |
| contextUsageObservability | 1 | yes |
| diagnostics | n/a | yes |
| differentialVerificationScope | 1 | yes |
| durableActions | 1 | yes |
| durableApprovals | 1 | yes |
| efficiencyMetrics | 1 | yes |
| executionHistory | 1 | yes |
| executionProfileContext | 1 | yes |
| integrationApi | 1 | yes |
| observabilityStability | n/a | yes |
| reflection | 1 | yes |
| repositoryIndex | 1 | yes |
| responsibilityConstraints | 1 | yes |
| structuralQuality | 1 | yes |
| structuredTrace | 1 | yes |
| taskClaimRecovery | 1 | yes |
| taskInspection | 1 | yes |
| trajectoryEvaluation | 1 | yes |
| trajectoryMetrics | 1 | yes |
| usageTelemetry | 1 | yes |
| verificationExecutionIsolation | 1 | yes |
| workspaceBinding | 1 | yes |

## Capability contracts

- `canonicalHandoffs` v2: immutable, supported, and
  ledger-backed for exactly-once operational acceptance through
  `handoff-accept`. Acceptance statuses are
  `OPEN` / `ACCEPTED` / `UNBOUND` / `INCONSISTENT`; it creates no claims,
  evidence, or lifecycle authority.
- `advisoryContextProviders` v1: provider-neutral,
  Integration-API-only, lazy, and opt-in. Provider results are not persisted by
  ForgeLoop and are never lifecycle state, evidence, authority, or executable
  instructions.

Protocol v1, schema v1, and Integration API v1 remain independent of these
capability-family versions.

## Public artifact registry

| Key | Scope | Path | Schema | Trust role |
| --- | --- | --- | --- | --- |
| actions | TASK | .forgeloop/task-state/<task-key>/actions/action-<id>.json | action | EXTERNAL_ACTION_PROVENANCE |
| approvals | TASK | .forgeloop/task-state/<task-key>/approvals/approval-<id>.json | approval | ACTION_APPROVAL_ATTESTATION |
| attestationBundle | TASK | .forgeloop/task-state/<task-key>/attestations/statement.sigstore.json | n/a | EXTERNAL_SIGNATURE_BUNDLE |
| attestationStatement | TASK | .forgeloop/task-state/<task-key>/attestations/statement.json | in-toto-statement | CODE_ATTESTATION_STATEMENT |
| capabilityPolicy | PROJECT | .forgeloop/policy/capabilities.json | capability-policy | CAPABILITY_POLICY_SPECIFICATION |
| codeManifest | TASK | .forgeloop/task-state/<task-key>/attestations/code-manifest.json | code-manifest | CONTENT_INTEGRITY_SNAPSHOT |
| config | PROJECT | .forgeloop/config.json | config | PROJECT_CONFIGURATION |
| continuity | TASK | .forgeloop/task-state/<task-key>/continuity.json | continuity | NON_EVIDENCE_HANDOFF |
| contract | TASK | .forgeloop/task-state/<task-key>/contract.json | current-contract | OPERATIONAL_SPECIFICATION |
| descriptor | TASK | .forgeloop/task-state/<task-key>/task.json | task-descriptor | TASK_DESCRIPTOR |
| evaluations | TASK | .forgeloop/task-state/<task-key>/evaluations/eval-<id>.json | trajectory-evaluation | TRAJECTORY_EVALUATION |
| events | TASK | .forgeloop/task-state/<task-key>/events.ndjson | event | AUDIT_LEDGER |
| executions | TASK | .forgeloop/task-state/<task-key>/executions/exec-<id>.json | execution | EXECUTION_PROVENANCE |
| gates | TASK | .forgeloop/task-state/<task-key>/gates/<gate>.json | gate | GATE_APPROVAL_ATTESTATION |
| handoffs | TASK | .forgeloop/task-state/<task-key>/handoffs/handoff-<id>.json | handoff-envelope | CANONICAL_HANDOFF_SNAPSHOT |
| policyBaseline | PROJECT | .forgeloop/policy/baseline.json | policy-baseline | BROWNFIELD_BASELINE |
| policyDiscovery | PROJECT | .forgeloop/policy/discovery.json | policy-discovery | DISCOVERED_POLICY_SPECIFICATION |
| policyLock | PROJECT | .forgeloop/policy/policy.lock | policy-lock | POLICY_INTEGRITY_LOCK |
| policyRules | PROJECT | .forgeloop/policy/rules.json | policy-rules | POLICY_SPECIFICATION |
| policySnapshot | TASK | .forgeloop/task-state/<task-key>/policy-snapshot.json | policy-snapshot | TASK_POLICY_ATTESTATION |
| preflight | TASK | .forgeloop/task-state/<task-key>/preflight.json | preflight | READINESS_ATTESTATION |
| receipt | TASK | .forgeloop/task-state/<task-key>/execution-receipt.json | execution-receipt | EVIDENCE_COMPILATION |
| recovery | TASK | .forgeloop/task-state/<task-key>/recovery.json | task-recovery | TASK_RECOVERY_STATE |
| responsibility | TASK | .forgeloop/task-state/<task-key>/responsibility.json | responsibility | RESPONSIBILITY_CONSTRAINT |
| route | TASK | .forgeloop/task-state/<task-key>/routing-result.json | routing-result | GUIDE_ROUTING_SPECIFICATION |
| session | SESSION | .forgeloop/sessions/<session-id>.json | activation | SESSION_MARKER |
| sources | PROJECT | .forgeloop/sources.json | source-registry | SOURCE_ATTESTATION |
| state | TASK | .forgeloop/task-state/<task-key>/work-state.json | work-state | CANONICAL_LIFECYCLE_STATE |
| structuralQuality | TASK | .forgeloop/task-state/<task-key>/structural-quality/baseline.json | structural-quality | STRUCTURAL_QUALITY_EVIDENCE |
| usage | TASK | .forgeloop/task-state/<task-key>/usage.json | usage | INFORMATIONAL_USAGE_TELEMETRY |
| verificationScope | TASK | .forgeloop/task-state/<task-key>/verification-scope.json | verification-scope | VERIFICATION_SCOPE_PLAN |
| workspaceBinding | TASK | .forgeloop/task-state/<task-key>/workspace-binding.json | workspace-binding | WORKSPACE_IDENTITY_BINDING |

## Command catalog

### actions

| Command | Mutation | Purpose |
| --- | --- | --- |
| action-authorize | MUTATING | Authorizes one PROPOSED durable action through the canonical capability-policy and approval service. |
| action-propose | MUTATING | Proposes a caller-reported durable action without executing it. |
| action-reconcile | MUTATING | Reconciles a COMMIT_UNKNOWN action from externally observed evidence without retrying it. |
| action-record | MUTATING | Records a caller-reported or externally observed non-authority action transition. |
| action-show | READ_ONLY | Reads one canonical durable action artifact. |
| action-verify | MUTATING | Verifies a COMMITTED action against independent canonical evidence; caller claims can never verify. |
| approval-request | MUTATING | Creates a durable fingerprint-bound approval request. |
| approval-resolve | MUTATING | Resolves one durable approval exactly once. |
| run-action | EXTERNAL_EXECUTION | Executes one policy-authorized durable action using exact argv and shell:false semantics. |

### attestation

| Command | Mutation | Purpose |
| --- | --- | --- |
| attestation-create | MUTATING | Builds a deterministic in-toto ForgeLoop statement from a valid completed task manifest. |
| attestation-status | READ_ONLY | Reports local ForgeLoop attestation status and trust level without network access. |
| attestation-verify | READ_ONLY | Verifies a task attestation and current revision without mutating task state. |
| attestation-verify-range | READ_ONLY | Verifies complete attestation coverage for an opaque revision range through a provider-neutral contract. |

### continuity

| Command | Mutation | Purpose |
| --- | --- | --- |
| clear-continuity | MUTATING | Removes continuity.json for the active task without affecting lifecycle work state. |
| continuity | READ_ONLY | Reads and displays current cross-harness continuity handoff notes. |
| handoff-create | MUTATING | Creates an immutable protocol-derived handoff snapshot without delegation or review side effects. |
| handoff-list | READ_ONLY | Lists immutable handoff snapshots for a task. |
| handoff-show | READ_ONLY | Reads and verifies one immutable handoff snapshot. |
| reconcile-continuity | READ_ONLY | Reconciles continuity handoff notes with active work state and checkout state. |
| record-continuity | MUTATING | Persists cross-harness operational continuity handoff notes bound to current state fingerprints. |

### diagnostics

| Command | Mutation | Purpose |
| --- | --- | --- |
| doctor | MUTATING | Diagnoses project health, discovers adapters, and optionally repairs missing template files. |
| efficiency | READ_ONLY | Projects usage and timing efficiency, comparing only against a metadata-compatible local baseline. |
| eval | MUTATING | Evaluates the current trajectory against a validated project-local reference scenario. |
| history | READ_ONLY | Shows chronological protocol history reconstructed from canonical ForgeLoop state. |
| index-status | READ_ONLY | Reports provider-neutral repository-index health, metadata, and owned-server status. |
| inspect | READ_ONLY | Inspects target repository health, dirty files, active branch, and artifact freshness. |
| metrics | READ_ONLY | Projects trajectory, action, execution, timing, and known usage metrics without mutating state. |
| profile-interview | READ_ONLY | Optional interactive or dry-run interview to refine project profile facts. |
| progress | READ_ONLY | Evaluates task progress across verification cycles and detects stalls deterministically. |
| protocol-info | READ_ONLY | Reports versioning, lifecycle, command, guide, and public error compatibility metadata for external harnesses. |
| reflect | READ_ONLY | Analyzes diagnostic and correction history deterministically for information gain, repeated failures, ineffective interventions, and oscillation. |
| search | READ_ONLY | Searches the ForgeLoop repository index through the provider-neutral search contract. |
| status | READ_ONLY | Displays current lifecycle phase, active checks, blockers, and artifact freshness bindings. |
| trace | READ_ONLY | Emits detailed structured task trace with provenance and artifact relationships. |
| usage-record | MUTATING | Records actor-reported usage telemetry without treating it as verification evidence. |
| validate-protocol | READ_ONLY | Validates end-to-end cryptographic freshness, fingerprint bindings, and ledger integrity. |
| validate-state | READ_ONLY | Validates schema adherence and internal consistency of work-state.json. |

### lifecycle

| Command | Mutation | Purpose |
| --- | --- | --- |
| activate | MUTATING | Emits an active session marker recording sessionId and activationMarker. |
| advance | MUTATING | Transitions the canonical lifecycle work state to an allowed target phase. |
| clear-state | MUTATING | Removes work-state.json for the active task only, preserving sibling contract, routing, and ledger files. |
| complete | MUTATING | Evaluates verification receipt coverage, gates, and ledger integrity to authorize task completion. |
| next | READ_ONLY | Returns deterministic next-action guidance and command recommendations based on active state. |
| preflight | MUTATING | Evaluates pre-implementation contract, routing, and gates; synchronizes work state when READY. |
| reconcile-closure | MUTATING | Refreshes the work-state checkpoint of an EXECUTING task whose objective is already satisfied in the current repository, after contract-bound executed evidence, so canonical completion can proceed. |
| record-decision-criterion | MUTATING | Records an append-only decision settlement criterion bound to the active contract fingerprint. |
| record-diagnosis | MUTATING | Records an append-only diagnosis event or structured diagnostic case in the lifecycle event ledger. |
| record-hypothesis-disposition | MUTATING | Records an evidence-bound hypothesis disposition update in the lifecycle event ledger. |
| record-intervention | MUTATING | Records an append-only intervention bound to hypotheses; the described change is never executed by ForgeLoop. |
| route | MUTATING | Evaluates task characteristics and deterministically routes required engineering guides. |
| task-create | MUTATING | Creates a new task descriptor and initializes its isolated task state namespace. |
| task-list | READ_ONLY | Lists all discovered task descriptors and their current lifecycle phases. |
| task-lock-status | READ_ONLY | Reports a task lock record and its lease-based stale-lock classification. |
| task-scope | MUTATING | Updates or inspects write claims for a task before execution. |
| task-show | READ_ONLY | Shows details of a specific task descriptor and its scoped artifacts. |

### policy-audit

| Command | Mutation | Purpose |
| --- | --- | --- |
| baseline | MUTATING | Manages brownfield policy baseline violations with monotonic downward ratcheting. |
| bundle | MUTATING | Exports current task artifacts into a portable task bundle archive. |
| policy | READ_ONLY | Evaluates active task state against named enterprise policy packs. |
| policy-diff | READ_ONLY | Performs semantic diffing between policy versions to detect tightening or weakening. |
| policy-discover | MUTATING | Discovers repository policy facts and candidate rules deterministically. |
| policy-status | READ_ONLY | Evaluates repository and task state against effective policy rules and baseline. |
| rule-verify | READ_ONLY | Verifies policy rules against mutation fixtures to prove detector efficacy. |

### project-maintenance

| Command | Mutation | Purpose |
| --- | --- | --- |
| index-rebuild | MUTATING | Atomically rebuilds the repository index and restarts its owned watcher. |
| index-setup | MUTATING | Provisions the pinned tgrep engine, builds the repository index, and starts its owned watcher. |
| index-start | MUTATING | Starts the owned tgrep repository-index watcher after an index has been built. |
| index-stop | MUTATING | Stops only a tgrep server whose process identity is provably owned by ForgeLoop. |
| init | MUTATING | Initializes a target project directory with ForgeLoop discovery adapters, schemas, and templates. |
| migrate-protocol | MUTATING | Safely migrates explicitly supported protocol state; unknown target versions fail without rewriting artifacts. |
| task-migrate | MUTATING | Migrates a legacy 1.0 singleton task state layout into a task-namespaced layout. |
| task-recover | MUTATING | Caller-acknowledged recovery of a STALE or ABANDONED task; records durable state and releases effective write claims. |
| task-repair-legacy-recovery | MUTATING | Migrates one recognized legacy OPERATOR_RECOVERY_RECORDED boundary event into the modern durable recovery representation (append-only; original event unchanged). |
| task-resume | MUTATING | Reacquires a recovered task's write claims under project serialization and restores ordinary mutation authority. |
| task-unlock | MUTATING | Removes an orphaned task lock file to recover an interrupted task. |
| update | MUTATING | Updates installed templates, discovery adapters, and canonical engineering guides to the latest version. |

### scope

| Command | Mutation | Purpose |
| --- | --- | --- |
| responsibility-set | MUTATING | Creates immutable, mechanically verifiable constraints for a task pass. |
| responsibility-status | READ_ONLY | Validates active responsibility constraints against current paths, inputs, and checks. |

### task

| Command | Mutation | Purpose |
| --- | --- | --- |
| handoff-accept | MUTATING | Accepts an immutable handoff exactly once in the task event ledger. |

### verification

| Command | Mutation | Purpose |
| --- | --- | --- |
| audit | READ_ONLY | Performs read-only evaluation of verification receipt coverage and gate satisfaction. |
| prepare-completion | MUTATING | Initializes execution-receipt.json with empty requirement evidence slots for the active cycle. |
| quality-baseline | EXTERNAL_EXECUTION | Captures an immutable provider-neutral structural-quality baseline through the trusted analyzer adapter. |
| quality-status | READ_ONLY | Projects persisted structural-quality baseline and evaluation status without invoking a provider. |
| quality-verify | EXTERNAL_EXECUTION | Captures one bounded structural-quality evaluation and projects it into canonical verification evidence. |
| record-check | MUTATING | Records structured verification evidence (command, manual review, or test output) against a requirement. |
| record-terminal-result | MUTATING | Records external terminal result evidence (PUBLICATION or PRODUCTION_READINESS) into receipt. |
| report | READ_ONLY | Emits a human-readable or structured JSON summary report of protocol state. |
| run-check | EXTERNAL_EXECUTION | Runs an exact command, records the execution provenance artifact, and binds observed check evidence. |
| validate-receipt | READ_ONLY | Validates schema conformance and cryptographic bounds of an execution receipt file. |
| verify-scope | MUTATING | Resolves a provable changed, claimed, full, or unresolved verification boundary without launching checks. |

### workspace

| Command | Mutation | Purpose |
| --- | --- | --- |
| workspace-bind | MUTATING | Binds a task to the current Git worktree identity; rebinding is not implicit. |
| workspace-status | READ_ONLY | Reports whether the current Git worktree matches an optional task binding. |

## Stable boundary and attestation errors

| Code | Meaning |
| --- | --- |
| E_ATTESTATION_CONFIGURATION_INVALID | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_ATTESTATION_CONTENT_MISMATCH | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_ATTESTATION_CONTRACT_MISMATCH | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_ATTESTATION_COVERAGE_CONFLICT | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_ATTESTATION_COVERAGE_GAP | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_ATTESTATION_DISABLED | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_ATTESTATION_GIT_REQUIRED | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_ATTESTATION_IDENTITY_UNTRUSTED | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_ATTESTATION_INVALID | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_ATTESTATION_ISSUER_UNTRUSTED | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_ATTESTATION_LEDGER_MISMATCH | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_ATTESTATION_MANIFEST_INVALID | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_ATTESTATION_MANIFEST_MISSING | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_ATTESTATION_MANIFEST_STALE | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_ATTESTATION_RECEIPT_MISMATCH | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_ATTESTATION_ROUTE_MISMATCH | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_ATTESTATION_SCOPE_MISMATCH | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_ATTESTATION_SIGNATURE_INVALID | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_ATTESTATION_SIGNER_UNAVAILABLE | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_ATTESTATION_STATE_MISMATCH | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_ATTESTATION_STATEMENT_INVALID | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_ATTESTATION_STATEMENT_MISSING | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_ATTESTATION_SUBJECT_MISMATCH | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_ATTESTATION_TARGET_REF_INVALID | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_ATTESTATION_UNSIGNED | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_CLI_INVOCATION_INVALID | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_HANDOFF_ACCEPTANCE_INCONSISTENT | Handoff acceptance disagrees with task event ledger history. |
| E_HANDOFF_ACCEPTANCE_UNBOUND | Handoff snapshot lacks required workStateFingerprint binding. |
| E_HANDOFF_ALREADY_ACCEPTED | Handoff was already accepted by a different consumer. |
| E_HANDOFF_INVALID | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_HANDOFF_NOT_FOUND | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_HANDOFF_STALE | Handoff snapshot has drifted from the current canonical task state or repository. |
| E_HANDOFF_STATE_UNAVAILABLE | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_HANDOFF_TAMPERED | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_RESPONSIBILITY_FROZEN_INPUT_DRIFT | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_RESPONSIBILITY_INVALID | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_RESPONSIBILITY_REQUIRED_CHECK_MISSING | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_RESPONSIBILITY_SCOPE_VIOLATION | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_REVISION_CONTENT_UNAVAILABLE | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_REVISION_NOT_FOUND | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_REVISION_PROVIDER_AMBIGUOUS | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_REVISION_PROVIDER_INVALID | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_REVISION_PROVIDER_UNAVAILABLE | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_VERIFICATION_SCOPE_INVALID | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_VERIFICATION_SCOPE_STALE | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_VERIFICATION_SCOPE_UNRESOLVED | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_WORKSPACE_BINDING_INVALID | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_WORKSPACE_BINDING_MISMATCH | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |
| E_WORKSPACE_IDENTITY_UNAVAILABLE | A ForgeLoop boundary, artifact, provider, or attestation validation condition was not satisfied. |

## Authoritative implementation surfaces

- Normative protocol: LOOP_ENGINEERING.md and PROTOCOL_INTEGRATION.md.
- Artifact contracts: schemas/.
- Lifecycle and command behavior: src/core/ and src/cli.js.
- Integration surface: src/integration.js, src/integration.d.ts, and integrations/.
- User-facing command and artifact references: docs/CLI_REFERENCE.md and docs/ARTIFACT_REFERENCE.md.

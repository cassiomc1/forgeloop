# ForgeLoop quality scorecard

This scorecard measures evidence-backed protocol quality. A dimension reaches
10/10 only when its documented contract, deterministic structure, positive and
negative checks, failure behavior, portability boundary, and compatibility
policy are all present.

| Dimension | 10/10 evidence |
| --- | --- |
| Loop engineering | Failure taxonomy, retry rule, invariants, evidence categories, and semantic tests in `LOOP_ENGINEERING.md`. |
| Routing | `src/core/router.js`, versioned route schemas, reason codes, exclusions, and positive/negative fixtures. |
| Workflow model | Canonical phases, transition table, state invariants, proportional skips, and `LOOP_SYSTEM_DESIGN.md`. |
| Protocol executability | Versioned JSON schemas, semantic cross-artifact conformance, dependency-free validation, and compatibility fixtures. |
| Graph readiness | Serializable state/transition contracts and `ORCHESTRATOR_INTEGRATION.md`; no runtime required. |
| Portability | Node 20/22/24 Linux depth, OS smoke coverage, path/line-ending fixtures, and adapter compatibility evidence. |
| Observability | `inspect`/`status`/`validate-protocol` shared derived state classification, real schema health, shared evidence, rich doctor findings, receipts, and no telemetry. |
| Completion enforcement | Canonical contract, persisted route, guide-declared gates, preflight, phase ledger, structured checks, evidence coverage, `audit`, `report`, and `complete` validators. |
| Structural quality feedback | Provider-neutral baseline and delta policy, five root-cause scores, typed task artifacts, bounded Sentrux MCP adapter, gate/observe semantics, and corrective lifecycle integration. |
| Agent lifecycle navigation | Read-only `forgeloop next` decisions, stable action/reason output, persisted-state safety, and adapter guidance at lifecycle boundaries. |
| Execution → Verification handoff | Legal `EXECUTING` → `VERIFYING` transition, implementation-step reconciliation, and preservation of verification evidence. |
| Pre-contract autonomy — structural | Blocking vs Non-Blocking Decisions policy, classify-before-ask invariant, PRE-QUESTION CHECK, explicit ASSUMPTION / source=agent-default recording, contract-before-clarification ordering, deterministic reason-code helper, and positive/negative tests. |
| External workflow compatibility — structural | Explicit autonomous-mode precedence, `WORKFLOW_CONFLICT` recording, question-source attribution, installed-versus-compatible wording, and mandatory-approval harness isolation. |
| Instruction-conflict handling — structural | External workflow policy is attributed separately from user requirements and ForgeLoop blocking decisions, with deterministic conflict reason codes and no fake unresolved user blocker. |
| Autonomous-mode precedence — structural | Explicit `autonomousMode=true` boundary, explicit interactive opt-in, preservation of `NON_BLOCKING`, and no silent workflow-induced mode switch. |
| Pre-contract autonomy — cross-agent live robustness | Independent live-agent behavior across fresh package installs, exact blind prompts, one-process/no-subagent topology, and separate evidence for non-blocking continuation versus blocking clarification. Structural coverage does not imply live cross-agent robustness. |
| Resume/checkpoint | Atomic local state, contract/HEAD/artifact freshness, age warning, schema/secret validation, status, safe validation, and bounded clearing without persisting derived freshness fields. |
| Cross-harness execution continuity — structural | Optional bounded continuity artifact, task/contract/work-state binding, deterministic reconciliation, current-checkout precedence, non-evidence/non-authority semantics, next/status/inspect integration, bundle portability, and cross-process regression coverage. |
| Cross-harness live continuity | A fresh Harness B resumes an interrupted Harness A task with no manual user summary and reaches validator-backed completion; structural coverage alone does not prove this dimension. |
| Protocol activation resumability | `PREFLIGHT_READY` durably creates or reconciles `work-state.json`, preserves blocked history, and exposes a dedicated repair code when the checkpoint is missing. |
| Artifact ↔ lifecycle reconciliation | Contract, route, gates, state, preflight, activation events, fingerprints, and append-only hash chronology agree at READY; audit and validate-protocol detect divergence. |
| Planned vs present profile truth | `PROJECT_PROFILE.md` distinguishes planned template fields from observed target facts, with hidden-kit bootstrap and legacy migration checks. |
| Contextual frontend taste | Taste is routed only to applicable premium frontend work, remains advisory, respects accessibility/performance/evidence, and has attribution without runtime dependency. |
| Multi-agent coordination | Self-contained briefs, write/write and write/read ownership checks, dependency-set validation, reviewer independence, normalized results, and inline fallback. |
| Security boundaries | Realpath containment, bounded untrusted JSON, threat model, nested secret scanning, publication evidence, and explicit authority rules. |
| Durable external actions | Immutable action identity, idempotency conflict rejection, capability policy, fingerprint-bound approvals, exact-argv provenance, `COMMIT_UNKNOWN` reconciliation, completion blocking, and audit evidence. |
| Trajectory evaluation | Read-only trace/reflection metrics, unknown usage preservation, canonical comparable-step definition, and scenario-bound efficiency without an arbitrary overall score. |
| Maintenance quality | Small modules, built-in runtime, deterministic JSON contracts, malformed/version fixtures, package gates, and backward-compatible protocol versions. |

## Capability evidence matrix

The rows below record the protocol capabilities covered by the post-
implementation correction plan. `VERIFIED` means the structure and local
tests are present in this checkout; `ATTESTED` is reserved for evidence from
an external runner, pull request, or publication boundary.

| Capability | Contract/docs | Core implementation | Schema/artifacts | Positive tests | Negative/adversarial tests | CI/E2E | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Workspace Binding | `LOOP_ENGINEERING.md`, workspace binding contract | `src/core/workspace-binding.js` | `schemas/workspace-binding.schema.json`, task binding artifact | `tests/workspace-binding.test.js`, `tests/workspace-binding-cli.test.js` | `tests/workspace-binding-mutation.test.js`, `tests/workspace-binding-run-check.test.js` | Local protocol suite; external runner pending | VERIFIED / NOT_ATTESTED |
| Canonical Handoff Envelope | `LOOP_ENGINEERING.md`, handoff contract | `src/core/handoff.js` | `schemas/handoff-envelope.schema.json` | `tests/handoff-envelope.test.js`, `tests/handoff-cli.test.js` | `tests/handoff-tamper.test.js`, `tests/handoff-continuity.test.js` | Local protocol suite; external runner pending | VERIFIED / NOT_ATTESTED |
| Responsibility Contract | Responsibility and ownership rules in `LOOP_ENGINEERING.md` | `src/core/responsibility.js` | `schemas/responsibility.schema.json` | `tests/responsibility-cli.test.js` | `tests/responsibility-completion.test.js` | Local protocol suite; external runner pending | VERIFIED / NOT_ATTESTED |
| Differential Verification Scope | Correction plan Section 1; `docs/CLI_REFERENCE.md` | `src/core/verification-scope.js`, `src/core/verification-scope-capability.js` | `schemas/verification-scope.schema.json`, scoped checker config | `tests/verification-scope.test.js`, `tests/revision-provider-conformance.test.js` | `tests/verification-scope-freshness.test.js`, `tests/run-check.test.js` | Node matrix and post-merge workflow pending | VERIFIED / NOT_ATTESTED |
| RevisionProvider | `docs/REVISION_PROVIDERS.md` | `src/core/revision/provider.js`, `src/core/revision/registry.js`, `src/core/revision/git.js` | Normalized revision entries and provider identity artifacts | `tests/revision-provider-conformance.test.js` | Unsafe path, unavailable provider, ambiguity, deletion, and rename cases in the conformance suite | Local Node suite; external runner pending | VERIFIED / NOT_ATTESTED |
| Code Manifest | `docs/CODE_ATTESTATION.md` | `src/core/code-manifest.js` | `schemas/code-manifest.schema.json`, code manifest artifact | `tests/code-manifest.test.js`, `tests/attestation-e2e.test.js` | Manifest mutation and coverage failures | Local attestation suite; external runner pending | VERIFIED / NOT_ATTESTED |
| Code Attestation | `docs/CODE_ATTESTATION.md` | `src/core/attestation.js`, `src/core/attestation-verifier.js` | `schemas/code-attestation.schema.json`, statement artifact | `tests/attestation.test.js`, `tests/attestation-e2e.test.js` | `tests/attestation-verifier.test.js`, stale-content cases | Local attestation suite; external runner pending | VERIFIED / NOT_ATTESTED |
| SigningProvider | `docs/SIGNING_PROVIDERS.md` | `src/core/signing/provider.js`, `src/core/signing/registry.js` | Sigstore bundle and signing provider contracts | `tests/signing-provider.test.js`, `tests/signing-provider-conformance.test.js` | Invalid provider, missing signature, and policy mismatch cases | Local conformance; external signer pending | VERIFIED / NOT_ATTESTED |
| Revision-range coverage | `docs/CODE_ATTESTATION.md` | `src/core/attestation-coverage.js` | `schemas/attestation-verification-result.schema.json` | `tests/attestation-coverage.test.js`, `tests/attestation-e2e.test.js` | Missing, conflicting, stale, and incomplete coverage cases | Local range checks; external revision range pending | VERIFIED / NOT_ATTESTED |
| Generic CI attestation | `integrations/generic-ci/verify.sh`, `docs/UNIVERSAL_INTEGRATION.md` | Generic CI verification and evidence boundary | CI verification outputs and attestation inputs | `tests/generic-ci-attestation.test.js` | Invalid or incomplete CI evidence cases | Pull-request workflow evidence required for ATTESTED | VERIFIED / NOT_ATTESTED |
| Documentation diagrams | `docs/diagrams/manifest.json`, `docs/DOCUMENTATION_GUIDE.md`, `docs/diagrams/forgeloop-code-attestation-flow.workflow.json` | Typed Archify workflow sources and pinned renderer wrapper | Generated HTML/SVG/receipt/review artifacts | `tests/documentation-diagrams.test.js`, `tests/documentation-diagram-manifest.test.js`, `tests/documentation-portability.test.js` | Stale output, missing review, unsupported renderer, orphan, reduced-motion, and deterministic-generation cases | Local renderer and structural accessibility checks; visual review is source-bound | VERIFIED / NOT_ATTESTED |

## Score rules

- `Observed` evidence is a command result, file, hash, or test output available
  in the current checkout.
- `Inferred` evidence is a reasoned consequence of observed evidence and must
  be labeled as inference.
- `Not verified` means the check was not run or the target is outside the
  available environment.
- `Blocked` means a genuine external condition prevents safe progress.
- A passing local check never implies that a branch was pushed, a pull request
  was merged, or a deployment succeeded.
- Literal graph runtime and runtime multi-agent orchestration are `N/A by
  design`; compatible harnesses own those capabilities.

## Blind-run conformance position

| Dimension | Classification |
| --- | --- |
| Pre-contract autonomy — structural | IMPLEMENTED / LOCAL TESTS PASS — 377 Node tests and 42 Python tests, with focused autonomy/conformance checks green |
| External workflow compatibility — structural | IMPLEMENTED / LOCAL TESTS PASS — deterministic helper covers autonomous conflict, compatible non-blocking flow, legitimate blocking questions, explicit interactive mode, and question-source vocabulary |
| Instruction-conflict handling — structural | IMPLEMENTED / LOCAL TESTS PASS — workflow-policy conflicts stay outside `unresolvedDecisions[]` and expose stable external-workflow reason codes |
| Autonomous-mode precedence — structural | IMPLEMENTED / LOCAL TESTS PASS — autonomous mode is explicit, interactive mode is explicit, and `NON_BLOCKING` is never promoted by workflow policy |
| Pre-contract autonomy — cross-agent live robustness | NOT_PROVEN — the fifth blind run is `PARTIAL` on published `0.1.4` and the sixth run requires harness-level exclusion of mandatory-approval workflows before it can start |
| Execution → Verification | REPRODUCED FAILURE in fourth blind run before implementation |
| Verification serialization | NOT_REACHED in fourth blind run |
| Review transition | NOT_REACHED in fourth blind run |
| Receipt generation | NOT_REACHED in fourth blind run |
| Full conformance | PARTIAL |

## Evidence matrix

The score is evidence-backed only when the contract and its executable proof
are both present:

| Dimension | Implementation evidence | Executable evidence |
| --- | --- | --- |
| Routing | `src/core/router.js`, route schemas, stable reason codes, and exclusions | `tests/router.test.js`, `tests/fixtures/routes/` |
| Flutter project detection and routing | `src/core/project-detection.js`, `src/core/router.js`, `src/config/guides.json`, and scoped manifest evidence | `tests/project-detection.test.js`, `tests/guide-registry.test.js`, `tests/router.test.js` |
| Observability | `src/core/receipt.js`, `src/core/inspect.js`, `src/core/evidence.js`, and schema health | `tests/observability.test.js`, `tests/receipt-semantics.test.js`, `tests/schema-health.test.js` |
| Resume/checkpoint | `src/core/work-state.js`, `EXECUTION_STATE.md`, shared loaded-state classifier, contract/artifact classifiers, and atomic writes | `tests/work-state.test.js`, `tests/checkpoint-freshness.test.js`, status, validate-state, and validate-protocol tests |
| Delegation | `src/core/delegation.js`, delegation-set validator, and `DELEGATION_PROTOCOL.md` | `tests/delegation.test.js`, `tests/delegation-set.test.js` |
| Portability | `ORCHESTRATOR_INTEGRATION.md`, adapter compatibility, and OS smoke workflow | `tests/portability.test.js`, package checks |
| Graph readiness | Serializable phase/transition mapping in `ORCHESTRATOR_INTEGRATION.md` | Python semantic validator and workflow-policy tests |
| Security boundary | realpath containment, bounded JSON, `THREAT_MODEL.md`, secret-free artifacts, authority and no-runtime rules | `tests/security-limits.test.js`, Markdown/loop validators, and `scripts/scan_secrets.py` |
| Cross-artifact conformance | `src/core/conformance.js`, `classifyLoadedWorkState`, and `forgeloop validate-protocol --contract-file` | `tests/conformance.test.js`, `tests/validate-protocol-cli.test.js`, and protocol fixtures covering precedence and stale evidence |
| Protocol preparation and completion | `src/core/preflight.js`, `src/core/completion.js`, `src/core/events.js`, policy packs, and portable bundles | `tests/preflight.test.js`, `tests/completion.test.js`, `tests/lifecycle.test.js`, `tests/policy.test.js`, and `tests/bundle.test.js` |
| Structural quality feedback | `docs/STRUCTURAL_QUALITY.md`, `LOOP_ENGINEERING.md`, `src/core/structural-quality/`, quality CLI commands, lifecycle projections, and `schemas/structural-quality.schema.json` | Structural-quality policy, provider, lifecycle, Sentrux adapter, artifact, bundle, and real-provider E2E tests; local Sentrux 0.5.7 cycle-regression scenario verified |
| Protocol activation resumability | `src/core/resumability.js`, READY consistency checks, event matrix, and `next` repair semantics | `tests/resumable-protocol.test.js` |
| Hidden kit layout | `src/core/target-layout.js`, safe init/update migration, manifest layout version, native shims, and profile resolver | `tests/hidden-layout.test.js`, package and compatibility tests |
| Contextual frontend taste | `ENG/taste-frontend-eng.md`, router metadata, attribution, and design/accessibility precedence | `tests/taste-guide.test.js`, route fixtures |
| Pre-contract autonomy — structural | `LOOP_ENGINEERING.md`, `tests/helpers/decision-classification.js`, `tests/helpers/workflow-compatibility.js`, `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `.cursor/rules/project-loop.mdc` | `tests/decision-classification.test.js`, `tests/workflow-compatibility.test.js`, `tests/autonomy-policy.test.js`, `tests/preflight.test.js` |
| External workflow compatibility — structural | `LOOP_ENGINEERING.md`, `PROTOCOL_INTEGRATION.md`, `tests/helpers/workflow-compatibility.js`, and sixth-run harness metadata rule | `tests/workflow-compatibility.test.js`, `conformance/README.md` |
| Instruction-conflict handling — structural | Canonical source-attribution and `WORKFLOW_CONFLICT` policy in `LOOP_ENGINEERING.md` plus adapter references | `tests/autonomy-policy.test.js`, `tests/workflow-compatibility.test.js` |
| Autonomous-mode precedence — structural | Autonomous/interactive mode contract and harness exclusion metadata | `tests/workflow-compatibility.test.js`, `tests/conformance-scenarios.test.js` |
| Pre-contract autonomy — cross-agent live robustness | Prior third blind-run result, `conformance/runs/2026-08-13-codex-fourth-live.md`, preserved fifth-run report `conformance/runs/2026-08-13-codex-fifth-live.md`, and the exact blind request | `tests/conformance-scenarios.test.js`; sixth run is not started until mandatory approval is excluded |

The implementation references above are local observations. OS runners,
remote links, provider sessions, publication, and deployment remain `Not
verified` unless their own checks produce current evidence.

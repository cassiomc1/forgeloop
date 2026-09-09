# Changelog

## Unreleased

No changes yet.

## 1.11.1 - 2026-09-09

### Changed

- Refreshed the README architecture image to reflect the current ForgeLoop
  entry points, canonical protocol, managed Repository Index, persistent CLI
  transport, and evidence boundary.

## 1.11.0 - 2026-09-08

### Added

- Added the mandatory ForgeLoop Repository Index and provider-neutral
  Repository Search capability, initially powered by a ForgeLoop-managed
  pinned Microsoft `tgrep` 1.0.3 engine.
- Added managed native provisioning with verified platform assets, live indexed
  search, `search`/`index-*` CLI commands, Integration API support, MCP
  discovery, and doctor readiness reporting.
- Added executable-level SHA-256 pinning and hash-before-version verification,
  warm per-repository search readiness with bounded recovery, path-safe public
  search/status projections, and real pinned native CI coverage on Linux,
  macOS, and Windows.
- Added a user-scoped persistent local search host for the CLI, with a
  versioned length-prefixed IPC protocol, ownership-checked startup/recovery,
  idle shutdown, same-repository contention serialization, and native
  cross-platform transport coverage. Integration API and MCP search remain
  direct canonical calls.

### Compatibility and operations

- The first setup may need network access unless the exact pinned release asset
  is preloaded with `index-setup --asset`.
- Supported initial platform keys are `darwin-arm64`, `darwin-x64`,
  `linux-x64`, and `windows-x64`. The project index is disposable cache data;
  search health does not rewrite task completion or evidence.

## 1.10.2 - 2026-09-07

### Added

- Added an optional host-injected Ripwire advisory context adapter to the
  public Integration API. Hosts provide an absolute executable path and exact
  version, then explicitly request ranked source signatures through
  `recallAdvisoryContext`.
- Added bounded Ripwire process transport, JSON mapping, path containment, and
  deterministic fixture coverage. The adapter validates the version immediately
  before each query and fails closed on unsafe or malformed output.

### Changed

- Documented the Ripwire adapter's advisory-only trust boundary, process
  contract, failure codes, verification commands, and repository-only retrieval
  benchmark.
- Audited the npm package boundary so the adapter, declarations, schemas,
  documentation, and governed diagram artifacts are shipped while tests,
  lifecycle state, benchmark results, and Ripwire benchmark fixtures remain
  excluded.
- Corrected dependency documentation to match the locked development toolchain:
  c8, ESLint, TypeScript, and YAML. The runtime remains dependency-free.

### Compatibility

- Protocol v1, schema v1, Integration API v1, and Node.js `>=20` support are
  unchanged.
- Advisory context remains lazy, opt-in, non-persisted, non-evidence,
  non-authoritative, and non-executable. Ripwire is not installed, discovered,
  or contacted automatically by ForgeLoop.

## 1.10.1 - 2026-09-05

### Added

- Exported `FORGELOOP_INTEGRATION_RUNTIME_VERSION` from the public
  `./integration` entry point. The constant was declared in
  `src/integration.d.ts` and used internally, but the module never re-exported
  it, so the declared name did not match the runtime surface.
- Added public type declarations for the existing
  `E_VERIFICATION_EXECUTION_INVALID` and
  `E_VERIFICATION_ISOLATION_UNAVAILABLE` codes and for
  `createStructuralQualityProviderRegistry` and
  `resolveStructuralQualityProvider`.
- Added `commands` and `commandSpecs` to the `RESOLVE_BLOCKER` result for
  `REVALIDATION_REQUIRED`, so `next` guides a safe pre-execution checkpoint
  refresh instead of leaving the blocker unexplained. `next` still writes
  nothing, and the suggested `clear-state` command remains a mutating
  operation the caller must authorize.
- Added the repository-only `transactions:compact` maintenance command for
  lock-safe transaction payload compaction. It retains every manifest and
  ledger, records `compactedAt`, skips non-terminal or recent transactions,
  and is not part of the published package.
- Added the `complexity:check` budget gate and deterministic test-selection
  tooling.

### Changed

- Audited the core npm package boundary and documented the intentional
  consumer contents and repository-only exclusions in
  `docs/PACKAGE_CONTENTS.md`.
- Added a source-completeness invariant so every maintained `src/**/*.js`
  runtime module is shipped, while the four retired compatibility helpers
  remain explicitly excluded.
- Added the clean-room package smoke gate to the tag-triggered npm
  publication workflow before trusted provenance publishing.
- Refreshed release documentation, package metadata, and generated protocol
  summary for the 1.10.1 patch release.
- Structured `successCriteria` entries and `contract.verification` now
  contribute execution-profile obligation signals; previously structured
  entries were stringified and never matched. `constraints` and
  `stopConditions` no longer contribute, and the `PUBLICATION` and
  `PRODUCTION_READINESS` requirement types force their corresponding
  signals. Profiles remain guidance only, and already-persisted routes are
  not re-derived.
- Split the lifecycle phase decisions in `next-action-phases.js` into
  per-phase modules. No `nextAction` value, reason code, phase name, or
  ordering changed.
- Widened `ForgeLoopStructuralQualityProvider` to accept either `observe()`
  or `detect()` plus `scan()`.
- Pinned the MCP adapter dependency to an exact version with a committed
  lockfile for reproducible verification.
- The receipt audit workflow now always runs and reports `NOT_VERIFIED` when
  no lifecycle receipt is supplied, instead of silently skipping. This is a
  CI reporting change only; no protocol artifact, CLI result, or Integration
  API response is affected.

### Fixed

- Task transactions now bind to the canonicalized physical project root.
  Reusing an active transaction against a different project fails closed with
  `E_TASK_CONTEXT_MISMATCH` across every transaction-aware read and write.
- `ROLLED_BACK` and `ABORTED` transactions are now terminal, so `doctor` and
  `inspect` no longer report a completed rollback or a pre-publication abort
  as `E_TRANSACTION_INCOMPLETE`.
- Transaction recovery now runs under the transaction's task lock and
  re-reads the manifest inside the lock, skipping any transaction another
  writer already advanced past `COMMITTING`, so recovery no longer races a
  live writer.
- Rollback replay validates every recorded write path with a symlink-aware
  check before unlinking or renaming.

### Compatibility

- Protocol v1, schema v1, Integration API v1, and Node.js `>=20` support are
  unchanged. `protocol-info --json` is unchanged apart from `packageVersion`,
  and no schema was modified.
- Observable additions for consumers that read `.forgeloop/` directly:
  `.forgeloop/.txn/<id>/manifest.json` gains an optional `lockTaskId`, its
  `status` domain gains `ABORTED` for the pre-publication abort case, and it
  gains an optional `compactedAt` after maintenance compaction. A reader that
  validates transaction status against a closed set must accept `ABORTED`.
- The four retired compatibility helpers `src/core/gates.js`,
  `src/core/decision-classification.js`, `src/core/workflow-compatibility.js`,
  and `src/core/cli-metadata.js` are excluded from the published tarball. The
  package `exports` map already prevented deep imports of them.

## 1.10.0 - 2026-09-02

### Added

- Added the provider-neutral advisory context contract and explicit
  `recallAdvisoryContext` Integration API service with portable-context safety,
  allowlist normalization, authority stripping, bounded budgets, and
  deterministic item fingerprints.
- Added `handoff-accept` and derived `OPEN`, `ACCEPTED`, `UNBOUND`, and
  `INCONSISTENT` acceptance projections for immutable handoffs.
- Added deterministic continuity semantic linting for contradictory or stale
  operational hints.

### Changed

- Canonical handoffs now bind exact work-state snapshots and coherent
  contract, route, changed-path, and repository branch/HEAD identities.
- Handoff acceptance checks current checkout freshness, invalid ledgers fail
  closed, and concurrent acceptance is exactly once with same-consumer retry
  idempotency.
- Published `canonicalHandoffs` capability version 2 and mirrored the
  `advisoryContextProviders` capability version 1 across public surfaces.

### Security / trust boundary

- Advisory context remains lazy, opt-in, non-persisted, non-evidence,
  non-authoritative, and non-executable. Provider output is never canonical
  state, completion truth, or next-action authority.
- Handoff acceptance remains an operational receipt only. It transfers no
  claims and creates no evidence, delegation, review, or authority.

### Compatibility

- Protocol v1 unchanged.
- Schema v1 unchanged.
- Integration API v1 unchanged.
- Node.js `>=20` support unchanged.

## 1.9.0 - 2026-09-02

### Added

- Added a provider-neutral structural-quality feedback loop with immutable
  task baselines, five normalized root-cause metrics, deterministic delta and
  dimension budgets, and `off`/`observe`/`gate` modes.
- Added bounded Sentrux MCP stdio integration, `quality-baseline`,
  `quality-verify`, and read-only `quality-status` surfaces across the CLI,
  integration API, and MCP projections.
- Corrected Sentrux MCP tool argument schemas (`scan` requires `path`, `health`
  requires empty object) and handshake tool schema validation.
- Added source material fingerprinting and mid-scan source drift detection (`E_STRUCTURAL_QUALITY_SOURCE_DRIFT`).
- Added single-session provider observation (`observe()`) and decoupled provider-specific rule files from core.
- Added measurement model compatibility checking across `measurementModel` and `compatibilityKey`.
- Relaxed default dimension budgets to unenforced (`null`) with strict aggregate non-regression and cycle prevention.
- Added two-phase scan execution outside task mutation lock with atomic reservation and projection reconciliation on retry.
- Added typed, atomic, task-scoped quality artifacts, bundle validation,
  completion provenance checks, and corrective lifecycle guidance.
- Hardened structural-quality freshness with canonical provider scope binding,
  fail-closed source fingerprints, explicit verified Sentrux versions, and
  freshness-aware recovery, status, next-action, provenance, and completion
  decisions.

### Verification boundary

- Structural quality remains separate from behavioral, security, performance,
  accessibility, review, publication, and production-readiness evidence.
- Sentrux is optional and user-managed; ForgeLoop does not install it, change
  analytics preferences, or claim built-in static analysis or a universal
  software-quality score.

### Changed

- Published the canonical read-only `task/structural-quality` Integration API
  resource and advertised its Structural Quality capability in `protocol-info`.
- Added clean-room package-consumer coverage for public Integration API imports,
  initialization, provider-absent `quality-status`, packaged schemas, and
  referenced diagrams without installing Sentrux.
- Verified Sentrux 0.5.7 interoperability while keeping Architecture Rules
  provenance separate from the provider-neutral Structural Quality signal.
- Corrected Windows path-containment comparisons for case-insensitive realpath
  results and retained cross-platform regression coverage.
- Kept `@cassiomc1/forgeloop-mcp` on its compatible `>=1.5.0 <2` core range;
  no cosmetic MCP release is required for this additive core release.

## 1.8.1 - 2026-09-01

### Fixed

- Removed historical raw and aggregate benchmark results from the core npm
  package while retaining the scenario definitions required to run new
  measurements.
- Hardened the GitHub Actions npm publication workflow with fail-closed
  candidate-version and package-content checks while retaining trusted OIDC
  publication and provenance.

## 1.8.0 - 2026-08-31

### Added

- Added methodology-v2 benchmark evidence with optional host-reported
  diagnostics, robust P25/P50/P75/P90/P95, IQR/MAD, deterministic
  `TOKEN_IQR_1_5` outlier classification, and explicit tail analysis.
- Added benchmark runner tiers (`smoke` 1–3, `evidence` 5–10, `tail` 20–30)
  and preserved the real-host repeat sets for balanced, quality, and tail
  comparisons.

### Changed

- Corrected comparative populations so paired statistics use matching run
  metadata and distribution statistics remain separately reported.
- Documented the distinction between `pairedOverheadPercent` and
  `distributionDeltaPercent`, including `LOW_BASELINE_TOKEN_REGIME`,
  `TAIL_PAIRED_RATIO_SENSITIVE`, `TAIL_DISTRIBUTION_REGRESSION`, and
  `TAIL_UNRESOLVED` interpretations.
- Kept historical benchmark methodology-v1 run sets and aggregates immutable;
  readers continue to accept benchmark versions `1` and `2`.

### Verification boundary

- Diagnostics, tail status, outlier classification, and efficiency warnings
  remain observational benchmark evidence. They never change lifecycle
  phases, required gates, verification truth, authority, provenance, safety
  floors, or completion validity. Unavailable telemetry stays `null` or
  `UNKNOWN` rather than being estimated.

## 1.7.0 - 2026-08-30

### Added

- Added schema-validated execution-profile benchmark scenarios, a host-adapter
  runner, reproducible raw/aggregate results, and summary/validation commands.
- Added the NovaTask static SaaS landing-page reference scenario, optional
  host-reported context usage, observational `CONTEXT_INFLATION` diagnostics,
  and a non-blocking CI efficiency regression report.
- Added the read-only `task/context` integration projection and MCP resource
  for bounded profile-aware host context.
- Added explicit benchmark methodology and profile invariant documentation.

### Changed

- Expanded profile-aware context guidance without changing lifecycle chronology,
  required gates, verification truth, authority, provenance, safety floors, or
  validator-backed completion.
- Advertised the canonical `task/context` resource and its resolved-profile
  authority explicitly through the integration capability handshake.
- Updated package metadata and release identity to 1.7.0.

### Verification boundary

- Benchmark claims remain observational and require actual provider/host
  telemetry, timing, PASS verification, and matching comparability metadata.
  Without those inputs, the summary remains `NOT_MEASURED` or
  `NOT_COMPARABLE`.

## 1.6.5 - 2026-08-30

### Fixed

- Fixed npm package contents so `forgeloop init` ships the required
  `AGENT_COMPATIBILITY.md` compatibility template.

## 1.6.4 - 2026-08-30

### Added

- Added optional task workspace binding, immutable cross-harness handoff
  envelopes, responsibility constraints, verification-scope planning, and
  provider-neutral code attestation.
- Added revision-provider and signing-provider contracts, in-toto statements,
  complete revision-range coverage checks, generic CI verification, and
  stable attestation exit-code handling.
- Added generated shell completions, a concise agent protocol summary,
  platform-adapter guidance, package smoke checks, and Windows full-suite CI.

### Changed

- Refactored next-action resolution into a compact orchestration layer with a
  phase-oriented resolver while preserving existing lifecycle behavior.
- Expanded protocol documentation, schemas, MCP capability metadata, and
  audit/bundle validation for the new optional artifacts.
- Refreshed the documentation diagrams with dark-first animated HTML/SVG
  sources, reduced-motion handling, text fallbacks, deterministic receipts,
  and source-bound visual reviews.

## 1.6.3 - 2026-08-28

### Fixed

- Removed the final Portuguese sentence from the shipped README so the npm
  package documentation is consistently English-only.

## 1.6.2 - 2026-08-28

### Fixed

- Docs quality link checks now exclude the intermittently unavailable Cursify
  reference while keeping the documentation link visible.

- The README and Getting Started guide now document global CLI installation,
  including the `npm install --global @cassiomc1/forgeloop` command.

- Shipped package documentation remains English-only, with no temporary
  localized documentation included in the npm package.

## 1.6.1 - 2026-08-27

### Fixed

- Verification execution now rejects contradictory isolation mode,
  filesystem-write, and network guarantees before evidence persistence.

- Verification execution now has an explicit trusted adapter boundary with
  disposable project/system isolation metadata, separate protocol and
  execution roots, bounded output provenance, and fail-closed handling when
  the required isolation capability is unavailable.

- Post-#101 durable-action corrections: trusted `COMMITTED` reconciliation now
  replays exactly once (the reconciled `ACTION_COMMIT_RECORDED` mirror is a
  validated same-revision corroboration, never a second transition, and forged
  mirrors invalidate the ledger); action verification requires an independent
  passed execution covering the action's exact immutable requirement; new
  required-for-completion actions must declare a non-empty requirement (legacy
  artifacts remain readable but classify UNTRUSTED); trusted reconciliation
  authority now propagates through the programmatic command executor and MCP
  provider boundaries; readiness and audit validate bound approval
  fingerprints for `REQUIRE_APPROVAL` authorizations; public provenance
  metadata now matches actual behavior (`CALLER_REPORTED` /
  `EXTERNAL_OBSERVED`); `executeDurableAction()` returns canonical
  `authorization` evidence.

- Completion-recovery fingerprint deadlock: a `REVIEWING` task whose persisted
  evidence-only rejection snapshot no longer matches the live checkpoint (after
  repository drift or a recovery/resume cycle) could not reach closure through
  any sanctioned path. `reconcile-closure` and the `REVIEWING -> VERIFYING`
  recovery transition now rebind the rejection append-only when — and only when
  — the logical fields (`verificationCycle`, sorted `reasonCodes`, sorted
  `missingRequirementIds`) are identical between work-state and the latest
  matching ledger rejection; the rebound `COMPLETION_REJECTED` event carries the
  current fingerprints and references the superseded snapshot via
  `reboundFromStateFingerprint`. Logical differences still fail closed.
- Checkpoint restoration is chronology-aware: when `preflight` recreates a
  missing work-state from preserved contract/route artifacts, the resume phase
  is derived from the validated ledger milestones instead of always restarting
  at `ROUTED`, so restored tasks never append duplicate non-repeatable lifecycle
  milestones such as `EXECUTION_STARTED`.
- Mid-lifecycle preflight refresh: a `PREFLIGHT_READY` re-recorded after later
  execution/verification milestones no longer invalidates the ledger as
  out-of-lifecycle-order; re-readiness keeps its prerequisite and compatibility
  guards while allowing legitimate policy/contract refresh cycles.
- Preflight re-readiness after a blocked cycle: an append-only lifecycle may
  contain a `PREFLIGHT_READY` that was superseded by a later `PREFLIGHT_BLOCKED`
  outcome (contract evolution, added gate requirement). The compatibility check
  now binds to the latest preflight outcome, so resolving the blocked preflight
  appends a fresh `PREFLIGHT_READY` with current details; a READY refresh whose
  details differ without an intervening BLOCKED outcome is still refused, and
  `PREFLIGHT_READY` joined the repeatable milestones so the rebound event keeps
  the ledger valid while milestone-order guards remain in force.

## 1.6.0 - 2026-08-24

### Fixed

- Structured diagnostic cases now satisfy every legacy diagnosis gate: one
  canonical resolver (`diagnostic-projection.js`) backs `DIAGNOSING ->
  CORRECTING`, `CORRECTING -> VERIFYING`, `next`, and `progress`; structured-only
  tasks no longer hit `E_DIAGNOSIS_REQUIRED` and no duplicate legacy event is
  written.
- Hypothesis dispositions validate against an authoritative append-only state
  projection (`hypothesis-projection.js`) using the canonical transition table;
  terminal states fail closed instead of resetting to `OPEN`.
- `inspect --task` reads the selected task's raw work state (task-isolated) and
  feeds raw state (not the classified wrapper) to progress evaluation; human
  output renders a full task inspection report.
- Trace correctness: check-attempt cardinality is ledger-primary with
  deterministic deduplication against state checkpoints; phase chronology is
  reconstructed forward (`RECEIVED`..`COMPLETE`) including `VERIFICATION_STARTED`
  and derived `DIAGNOSING`/`CORRECTING`; the phantom
  `VERIFICATION_STARTED_PLACEHOLDER` is gone; diagnostic revision chains are
  revalidated at read time.
- `trace.failureSignatures` / `failureSurfaces` are populated from the canonical
  failure-analysis projectors and reflection consumes them instead of rebuilding;
  per-cycle signature sets are real.
- Information Gain v2 is computed centrally (`information-gain.js`,
  `information-gain-projection.js`) for progress/reflect/next/inspect/continuity;
  `STALLED` is reachable; semantic noise never counts as gain.
- Evidence hardening: structured cases require >=1 hypothesis, observation
  evidence must resolve in the active cycle, `VERIFICATION_FAILURE` cases must
  bind failed/blocked active-cycle evidence.
- Continuity `doNotRepeat` requires semantic repetition plus two completed
  post-intervention verification cycles plus unchanged failure surface
  (repetition alone is not non-informative).
- Capability advertising aligned via additive
  `features.observabilityStability`; `E_TRACE_SNAPSHOT_INCONSISTENT` and all
  diagnosis/progress codes registered as stable public error codes.
- Information Gain v2 is single-source: one authoritative per-cycle cycle
  analysis computes all dimensions before `effectiveGain`; no consumer
  recomputes or post-mutates gain truth; semantic noise (IDs, timestamps,
  ordering) never creates gain or false hypothesis elimination.
- Successful verification cycles are projected explicitly as `surface: []`,
  enabling deterministic full-recovery classification of interventions as
  `IMPROVED`.
- `hypotheses.minItems = 1` is enforced identically by the JSON schema, runtime
  validator, event-ledger validation, and the record-diagnosis command path.
- `record-intervention` reports `repeatedSemanticIntervention` with retrospective
  `effectiveness: "PENDING"` instead of claiming `without gain` before any
  later verification exists.
- Continuity `diagnosticContext.activeFailureSignatures` now carries canonical
  failure-signature hashes scoped to the active cycle, with requirement names
  exposed separately via `activeFailedRequirements`.
- Package metadata synchronized: `package.json` and `package-lock.json` both
  identify 1.6.0.
- Unified structured-diagnostic stall semantics across phase, progress,
  reflection, next-action, and task inspection; all meaningful Information
  Gain v2 dimensions, including new observations, contributors, and semantic
  hypothesis elimination, now participate in effectiveGain. Stall is fail-fast,
  recoverable by meaningful new diagnostic information, and oscillation keeps
  the more specific INTRODUCE_NEW_OBSERVATION guidance.

### Added

- Unified observability and diagnostic intelligence (Protocol v1 additive):
  read-only `history`, `trace`, and `reflect` commands reconstructed from the
  canonical event ledger through a shared snapshot/trace projection core
  (`buildTaskSnapshot`, `buildTaskTrace`); structured diagnostic cases with
  observations, multifactor contributors, multiple falsifiable hypotheses,
  semantic fingerprints, and append-only revision chains via
  `record-diagnosis --file`; `record-intervention` and
  `record-hypothesis-disposition` mutation commands; information-gain v2
  dimensions, failure signatures, failure surfaces, strategy fingerprints, and
  oscillation detection; task-level `inspect --task` additive
  `taskInspection` section; continuity `diagnosticContext` with bounded
  `doNotRepeat`; `next` diagnostic guidance (`REQUIRE_NEW_DIAGNOSTIC_INFORMATION`,
  `INTRODUCE_NEW_OBSERVATION`, `RECORD_INTERVENTION`) without changing existing
  actions; `protocol-info` capability advertising; three new public schemas
  (`diagnostic-case`, `intervention`, `hypothesis-disposition`) and new stable
  error codes. Legacy single-hypothesis diagnosis remains fully valid.

## 1.5.0 - 2026-08-23

### Added

- Transport-neutral programmatic integration API v1 at
  `@cassiomc1/forgeloop/integration`: structured command executors and runtime,
  shared semantic input validation, invocation-level risk classification, and
  canonical integration resources including task/ownership derived exclusively
  from the validated claim resolver.
- Separate local MCP package (`@cassiomc1/forgeloop-mcp`, official SDK):
  deterministic tool/resource catalogs generated from canonical metadata,
  immutable project root, explicit taskId on task-aware mutations, launch-level
  capability gates (external execution, maintenance, recovery, legacy repair,
  force), and no generic shell.
- Optional stateless HTTP transport (`forgeloop-mcp-http`, PR12 hardened):
  strict modern MCP 2026 only (legacy traffic rejected), loopback-only binding
  (non-loopback refused with `E_MCP_REMOTE_NOT_SUPPORTED`), DNS-rebinding
  protection, bounded request bodies (413), header/request/keepalive timeouts,
  in-flight ceiling (503 `E_MCP_HTTP_BUSY`), POST-only, and no session-based
  authority.
- Hardening: bundle is MAINTENANCE-gated; launch `maxExecutionTimeMs` is
  enforced on every external-execution invocation; project roots resolve
  through canonical CLI semantics (symlinks rejected); integration input and
  output limits bound the transport surface; client-visible errors redact
  secret-shaped values while preserving canonical codes; a real
  `forgeloop_capabilities` tool reports versions, features, policy, and
  resources in every server mode.
- Closing pass: structured MCP input is byte-bounded
  (`E_MCP_INPUT_TOO_LARGE`); output bounds apply to command tools,
  `forgeloop_capabilities`, and every integration resource through one
  canonical helper (`E_MCP_RESULT_TOO_LARGE`); capabilities reports the real
  installed ForgeLoop core version; the documentation manifest
  `packaged:true` set is invariant against the core tarball; HTTP timeout
  bounds are observable and concurrency shedding (503 `E_MCP_HTTP_BUSY`) is
  deterministically proven; stdio/HTTP catalog parity is verified at the
  transport level across representative modes.
- MCP output bounds now measure the exact UTF-8 serialization transmitted,
  including pretty-printed tool/resource text; unrelated serialization failures
  are not misclassified as output overflow.

- `forgeloop task-repair-legacy-recovery`: migrates one recognized legacy `OPERATOR_RECOVERY_RECORDED` boundary event (no `recoveryId`) into the modern durable recovery representation via an append-only `LEGACY_RECOVERY_MIGRATION_RECORDED` tail event plus a transactional `recovery.json`; the original ledger event is never modified, ambiguous or tampered evidence fails closed, and ordinary mutation stays blocked until `task-resume`.
- Durable task recovery state in `recovery.json`, explicit `task-resume` claim reacquisition, and recovery-aware `forgeloop next` command specifications.
- A canonical validated claim-state resolver, deterministic recovery-history classifier, public ownership/claims-lock errors, protocol capability metadata, tamper conformance corpus, and invariant coverage.

### Changed

- `task-recover` accepts only `STALE` and `ABANDONED`, preserves lifecycle evidence, and records caller acknowledgement without presenting it as host attestation.
- Recovered tasks reject ordinary mutations until `task-resume` reacquires conflict-free claims under the project claims lock.
- Recovered tasks are excluded from implicit mutation-active selection; `TASK_RECOVERY_RESUMED` is meaningful activity and prevents immediate abandoned reclassification.
- Task and project claim locks distinguish absent, live, stale, unknown, and corrupt evidence; `task-resume` and project claim acquisition CAS-settle only unchanged stale leases.
- `COMPLETE` tasks report mutation disabled, and task contexts expose only the canonical `.forgeloop/locks/<taskKey>.lock` path.

### Security and reliability

- Legacy recovery repair CAS-settles only unchanged stale task locks; live, unknown, and corrupt locks are refused with the lock preserved.
- `alreadyRepaired` requires a fully valid canonical recovery relationship, not just matching identifiers.
- Helper claim APIs (`effectiveTaskClaims`/`taskClaimProjection`) no longer infer completion release from phase alone.
- Claim-state classification is side-effect free over the collected evidence.
- Legacy recovery migration v1 accepts only CALLER_ACKNOWLEDGED authority.
- COMPLETE task claim release now requires canonical lifecycle/ledger proof; manually or inconsistently terminal state fails closed and retains historical claim ownership.
- Task lock classification now rejects incomplete owner identity metadata as UNKNOWN rather than inferring live or stale ownership.
- Implicit task selection distinguishes read-only inspection from mutation.
- Claim-state and conflict inspection reuse validated ownership evidence within one snapshot while preserving TOCTOU revalidation boundaries.
- Claim ownership now requires a validated relationship between the task descriptor, work state, recovery artifact, and complete append-only recovery history before recovery can release claims.
- Fake, missing, corrupt, deleted, or mismatched recovery state fails closed, preserves every provable historical claim, and cannot restore mutation authority.
- Unhealthy task namespaces block claim acquisition when ownership cannot be proven; ordinary mutation and portable bundle export also reject inconsistent ownership.
- Stale task and project claim locks are released only when the observed lock ID, heartbeat, and owner instance remain unchanged, and recovery preconditions are revalidated under deterministic lock ordering.

### Compatibility

- The repository core package is now `1.5.0`; ForgeLoop protocol remains `1`; Integration API remains `1`. `protocol-info` advertises validated claim recovery version 1 and `features.integrationApi` version 1.
- A project containing active `task-recovery` schema v1 state still requires ForgeLoop `>=1.4.0`; older readers that do not understand validated recovery ownership must refuse the project rather than infer claims from `task.json` alone.
- The MCP package (`@cassiomc1/forgeloop-mcp`) requires ForgeLoop `>=1.5.0 <2`.
- Repository implementation state is separate from external publication; no npm publication, tag, or release is performed by these tasks.
- The ledger continues to write `OPERATOR_RECOVERY_RECORDED` for PR #66 reader compatibility, while its authority is explicitly `CALLER_ACKNOWLEDGED`; readers also accept the neutral `TASK_RECOVERY_RECORDED` name.
- `--operator-authorized` remains a deprecated alias for `--acknowledge-recovery` and does not create host authority. The standalone CLI does not self-issue `HOST_ATTESTED` recovery grants.
- Release preparation is local only; no package publication, tag, or release is performed by this implementation task.

## 1.3.0 - 2026-08-20

### Added

- Transaction journaling for safer multi-artifact protocol mutations.
- Monotonic work-state revision tracking and stale-writer conflict detection.
- Serialized event ledger appends with stronger concurrency guarantees.
- Lease-aware task locking and task lock inspection.
- Bounded verification command execution with timeout and termination metadata.
- Public `protocol-info` compatibility handshake and protocol migration support.
- Expanded protocol conformance scenarios, golden schema fixtures, and scale tests.
- Package smoke validation, executable documentation examples, and documentation health reporting.
- Contributor, security, changelog, issue, and pull-request governance files.

### Changed

- Strengthened execution, work-state, event, lock, completion, diagnosis, migration, and resumability behavior.
- Expanded CLI command metadata and documentation generation.
- Improved troubleshooting, CLI reference, artifact reference, continuity, protocol integration, system design, and execution-state documentation.
- Strengthened GitHub Actions coverage for package validation and ForgeLoop auditing.

### Compatibility

- npm package version advances to `1.3.0`.
- ForgeLoop remains protocol-version compatible with the supported v1 contract unless `forgeloop protocol-info --json` reports otherwise.
- Existing legacy compatibility and migration paths remain covered by regression tests.

### Security and reliability

- Protocol mutations gain stronger crash and concurrency protection.
- Verification commands gain bounded termination behavior.
- Task locking gains lease and staleness semantics.
- Release and package validation gain additional smoke and documentation checks.

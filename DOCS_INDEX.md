# Documentation index

The machine-readable inventory is
[`docs/documentation-manifest.json`](./docs/documentation-manifest.json). It
classifies every package-shipped document, names canonical concept owners, and
records generated/deprecated-document metadata. Normative requirements and
their implementation/test mappings are in
[`docs/protocol-requirements.json`](./docs/protocol-requirements.json).

ForgeLoop keeps one canonical process and separates protocol behavior from
integration and guide context. Use this map before editing documentation.

## Ownership map

| Need | Canonical source | Boundary |
| --- | --- | --- |
| Getting started tutorial | [`docs/GETTING_STARTED.md`](./docs/GETTING_STARTED.md) | First-time walkthrough from init to completion |
| Cross-harness continuity | [`docs/CROSS_HARNESS_CONTINUITY.md`](./docs/CROSS_HARNESS_CONTINUITY.md) | Operational resume guidance, immutable handoffs, and multi-tool resumption |
| Agent bootstrap summary | [`docs/AGENT_PROTOCOL_SUMMARY.md`](./docs/AGENT_PROTOCOL_SUMMARY.md) | Generated concise navigation aid for protocol invariants and commands |
| CLI command reference | [`docs/CLI_REFERENCE.md`](./docs/CLI_REFERENCE.md) | Full syntax, options, and JSON examples for all commands |
| Repository Index and Search | [`docs/REPOSITORY_INDEX.md`](./docs/REPOSITORY_INDEX.md) | Mandatory managed engine, indexed search contract, lifecycle, resource, security, and benchmark behavior |
| Artifact and schema reference | [`docs/ARTIFACT_REFERENCE.md`](./docs/ARTIFACT_REFERENCE.md) | Purpose, mutability, and trust classifications of `.forgeloop/` |
| Durable actions and trajectory evidence | [`docs/EXECUTION_TRACE.md`](./docs/EXECUTION_TRACE.md) and [`docs/RECIPES.md`](./docs/RECIPES.md) | Action provenance, reconciliation, metrics, and project-local evaluation |
| Troubleshooting and recovery | [`docs/TROUBLESHOOTING.md`](./docs/TROUBLESHOOTING.md) | Symptom-first recovery and stable error code reference |
| Operational recipes | [`docs/RECIPES.md`](./docs/RECIPES.md) | Short copy-paste recipes for daily workflows |
| Structural quality feedback | [`docs/STRUCTURAL_QUALITY.md`](./docs/STRUCTURAL_QUALITY.md) | Provider-neutral baseline, delta policy, Sentrux boundary, lifecycle integration, and troubleshooting |
| Diagnostic model | [`docs/DIAGNOSTIC_MODEL.md`](./docs/DIAGNOSTIC_MODEL.md) | Structured diagnostic cases, interventions, hypothesis dispositions, information gain |
| Execution trace and observability | [`docs/EXECUTION_TRACE.md`](./docs/EXECUTION_TRACE.md) | `history`, `trace`, `reflect`, and task-level `inspect` read-only projections |
| Workspace, handoff, responsibility, and scope | [`docs/ARTIFACT_REFERENCE.md`](./docs/ARTIFACT_REFERENCE.md) and [`docs/CLI_REFERENCE.md`](./docs/CLI_REFERENCE.md) | Optional task boundaries, immutable handoffs, and deterministic verification planning |
| Handoff acceptance | [`docs/CROSS_HARNESS_CONTINUITY.md`](./docs/CROSS_HARNESS_CONTINUITY.md) | Ledger-backed operational receipt; no claim transfer, evidence, or authority |
| Code attestation and revision coverage | [`docs/CODE_ATTESTATION.md`](./docs/CODE_ATTESTATION.md) | Source-content manifests, in-toto statements, signatures, and range verification |
| Revision and signing providers | [`docs/REVISION_PROVIDERS.md`](./docs/REVISION_PROVIDERS.md) and [`docs/SIGNING_PROVIDERS.md`](./docs/SIGNING_PROVIDERS.md) | Provider-neutral extension contracts |
| Platform adapters | [`docs/PLATFORM_ADAPTERS.md`](./docs/PLATFORM_ADAPTERS.md) | Generic CI boundary and platform mapping guidance |
| Universal integration API | [`docs/UNIVERSAL_INTEGRATION.md`](./docs/UNIVERSAL_INTEGRATION.md) | Programmatic integration subpath, envelope semantics, and consumer map |
| Advisory context providers | [`docs/ADVISORY_CONTEXT.md`](./docs/ADVISORY_CONTEXT.md) | Optional external host context, non-evidence trust boundary, allowlist normalization, and safety rules |
| Ripwire advisory adapter | [`docs/RIPWIRE_ADAPTER.md`](./docs/RIPWIRE_ADAPTER.md) | Ripwire-specific registration, process contract, JSON mapping, limits, and verification |
| Local-first MCP adapter | [`docs/MCP.md`](./docs/MCP.md) | stdio default, optional strict loopback HTTP; server modes/capabilities and canonical resources |
| Adaptive execution-profile benchmarks | [`docs/EXECUTION_PROFILE_BENCHMARKS.md`](./docs/EXECUTION_PROFILE_BENCHMARKS.md) | Measured provider/host runs, robust statistics, paired/distribution deltas, tail status, outliers, and profile-aware host context |
| Knowledge integration gap analysis | [`docs/KNOWLEDGE_INTEGRATION_GAP_ANALYSIS.md`](./docs/KNOWLEDGE_INTEGRATION_GAP_ANALYSIS.md) | Repository-only research audit of candidate coverage, proven gaps, canonical homes, context cost, and intentional skip/defer decisions |
| Knowledge sources and provenance | [`docs/KNOWLEDGE_SOURCES.md`](./docs/KNOWLEDGE_SOURCES.md) | Snapshot, licensing observations, source roles, accepted/skipped concepts, and reuse boundaries |
| Documentation guide | [`docs/DOCUMENTATION_GUIDE.md`](./docs/DOCUMENTATION_GUIDE.md) | Rules and checklist for modifying documentation |
| Current release checklist | [`docs/RELEASE_CHECKLIST.md`](./docs/RELEASE_CHECKLIST.md) | Package, protocol, attestation, integration, and publication gates |
| Core npm package contents | [`docs/PACKAGE_CONTENTS.md`](./docs/PACKAGE_CONTENTS.md) | Published consumer surface, intentional inclusions, exclusions, and clean-room verification |
| ForgeLoop 1.6.1 release checklist (historical) | [`docs/RELEASE_CHECKLIST_1_6_1.md`](./docs/RELEASE_CHECKLIST_1_6_1.md) | Verification adapter boundary, isolation invariants, and publication gates |
| ForgeLoop 1.5/MCP release checklist (historical) | [`docs/RELEASE_CHECKLIST_1_5_MCP.md`](./docs/RELEASE_CHECKLIST_1_5_MCP.md) | Integration API v1, MCP package, and publication gates |
| ForgeLoop 1.4 release checklist | [`docs/RELEASE_CHECKLIST_1_4.md`](./docs/RELEASE_CHECKLIST_1_4.md) | Claim-recovery, compatibility, package, and publication gates |
| Lifecycle, gates, planning, verification, and recovery | [`LOOP_ENGINEERING.md`](./LOOP_ENGINEERING.md) | Normative process for agents and developer workflows |
| Capability levels, discovery, and degradation | [`PROTOCOL_INTEGRATION.md`](./PROTOCOL_INTEGRATION.md) | Vendor-neutral harness contract |
| Host/orchestrator integration | [`ORCHESTRATOR_INTEGRATION.md`](./ORCHESTRATOR_INTEGRATION.md) | Serializable phases, transition boundaries, host responsibilities, and no-runtime integration contract |
| Durable project facts | [`PROJECT_PROFILE.md`](./PROJECT_PROFILE.md) | Target-specific facts only; no prompts or secrets |
| Guide selection | [`GUIDE_ROUTER.md`](./GUIDE_ROUTER.md) | Deterministic routing and exclusions |
| Architecture and safety boundaries | [`LOOP_SYSTEM_DESIGN.md`](./LOOP_SYSTEM_DESIGN.md) and [`THREAT_MODEL.md`](./THREAT_MODEL.md) | Design rationale and residual risk |
| Artifact and phase schemas | [`schemas/`](./schemas/) and [`CONTRACT_COVERAGE.md`](./CONTRACT_COVERAGE.md) | Versioned machine-readable contract |
| CLI/package behavior | [`src/`](./src/) and [`tests/`](./tests/) | Executable implementation and regression evidence |
| Guide content | [`ENG/`](./ENG/) | Context-specific, English-only operational guides |
| Diagram governance | [`docs/diagrams/manifest.json`](./docs/diagrams/manifest.json) | Authoritative taxonomy, renderer mapping, canonical purposes, artifact ownership, and references |
| Diagram maintainer entrypoint | [`docs/diagrams/README.md`](./docs/diagrams/README.md) | Typed Archify source, animated HTML explorer, animated SVG fallback, review, and regeneration workflow |
| Engineering flow diagram | [`docs/assets/diagrams/forgeloop-engineering-flow.html`](./docs/assets/diagrams/forgeloop-engineering-flow.html) | Conceptual lifecycle from request through validator-backed completion |
| Verification Trust Flow | [`docs/REVISION_PROVIDERS.md`](./docs/REVISION_PROVIDERS.md#differential-verification-scope) | Claims, changed paths, trusted checker capability, exact argv, and observed evidence |
| Code Attestation Chain | [`docs/CODE_ATTESTATION.md`](./docs/CODE_ATTESTATION.md#completion-flow) | Completion, exact-content manifest, in-toto statement, optional signing, and range coverage |
| Real Execution Proof of Concept (PoC) | [`poc/README.md`](./poc/README.md) | Non-normative, reproducible public engineering workload, audit evidence, and technical audit. Normative behavior remains owned by [`LOOP_ENGINEERING.md`](./LOOP_ENGINEERING.md). |

## Recent implementation review

The repository-local [Astra implementation record](./docs/ASTRA_IMPLEMENTATION.md)
maps the completed findings to code, tests, measurements, and remaining limits.
Use the canonical guides below for operational instructions; the audit record
is historical evidence and is not part of the published core package.

## Audience map

| I am a... | Start here |
| --- | --- |
| **First-time user or developer** | [`docs/GETTING_STARTED.md`](./docs/GETTING_STARTED.md) |
| **AI coding agent / harness** | [`docs/AGENT_PROTOCOL_SUMMARY.md`](./docs/AGENT_PROTOCOL_SUMMARY.md) → [`AGENTS.md`](./AGENTS.md) → [`LOOP_ENGINEERING.md`](./LOOP_ENGINEERING.md) |
| **Technical auditor / Evaluator** | [`poc/README.md`](./poc/README.md) → [`poc/reports/poc-20260826-real-execution-technical-audit-v2.md`](./poc/reports/poc-20260826-real-execution-technical-audit-v2.md) |
| **Harness integrator** | [`PROTOCOL_INTEGRATION.md`](./PROTOCOL_INTEGRATION.md) |
| **External runtime / orchestrator integrator** | [`ORCHESTRATOR_INTEGRATION.md`](./ORCHESTRATOR_INTEGRATION.md) |
| **Resuming another tool / session** | [`docs/CROSS_HARNESS_CONTINUITY.md`](./docs/CROSS_HARNESS_CONTINUITY.md) |
| **Looking up CLI commands** | [`docs/CLI_REFERENCE.md`](./docs/CLI_REFERENCE.md) |
| **Inspecting `.forgeloop/` files** | [`docs/ARTIFACT_REFERENCE.md`](./docs/ARTIFACT_REFERENCE.md) |
| **Fixing a broken or stale state** | [`docs/TROUBLESHOOTING.md`](./docs/TROUBLESHOOTING.md) |
| **Looking for quick recipes** | [`docs/RECIPES.md`](./docs/RECIPES.md) |
| **Configuring structural quality feedback** | [`docs/STRUCTURAL_QUALITY.md`](./docs/STRUCTURAL_QUALITY.md) |
| **Configuring Ripwire advisory context** | [`docs/RIPWIRE_ADAPTER.md`](./docs/RIPWIRE_ADAPTER.md) |
| **Understanding verification trust** | [`docs/REVISION_PROVIDERS.md`](./docs/REVISION_PROVIDERS.md#differential-verification-scope) |
| **Understanding attestation trust** | [`docs/CODE_ATTESTATION.md`](./docs/CODE_ATTESTATION.md#trust-levels) |
| **Maintaining generated diagrams** | [`docs/diagrams/README.md`](./docs/diagrams/README.md) |
| **Documentation contributor** | [`docs/DOCUMENTATION_GUIDE.md`](./docs/DOCUMENTATION_GUIDE.md) |
| **Release maintainer (current)** | [`docs/RELEASE_CHECKLIST.md`](./docs/RELEASE_CHECKLIST.md) |
| **Release maintainer (historical 1.5/MCP)** | [`docs/RELEASE_CHECKLIST_1_5_MCP.md`](./docs/RELEASE_CHECKLIST_1_5_MCP.md) |
| **Release maintainer (historical 1.4)** | [`docs/RELEASE_CHECKLIST_1_4.md`](./docs/RELEASE_CHECKLIST_1_4.md) |
| **Protocol architect / maintainer** | [`LOOP_SYSTEM_DESIGN.md`](./LOOP_SYSTEM_DESIGN.md) + [`schemas/`](./schemas/) |
| **Security auditor** | [`THREAT_MODEL.md`](./THREAT_MODEL.md) |
| **Engineering guide author** | [`GUIDE_ROUTER.md`](./GUIDE_ROUTER.md) + [`ENG/`](./ENG/) |

## Task map

- **Start my first task**: [`docs/GETTING_STARTED.md`](./docs/GETTING_STARTED.md)
- **Inspect real execution PoC and audit evidence**: [`poc/README.md`](./poc/README.md)
- **Resume after switching tools**: [`docs/CROSS_HARNESS_CONTINUITY.md`](./docs/CROSS_HARNESS_CONTINUITY.md)
- **Check CLI options and syntax**: [`docs/CLI_REFERENCE.md`](./docs/CLI_REFERENCE.md)
- **Search the repository through ForgeLoop**: [`docs/REPOSITORY_INDEX.md`](./docs/REPOSITORY_INDEX.md)
- **Understand what `.forgeloop/` stores**: [`docs/ARTIFACT_REFERENCE.md`](./docs/ARTIFACT_REFERENCE.md)
- **Fix a blocked, stale, or invalid state**: [`docs/TROUBLESHOOTING.md`](./docs/TROUBLESHOOTING.md)
- **Recover a stale task or reacquire released claims**: [`docs/RECIPES.md`](./docs/RECIPES.md#recipe-15--release-and-reacquire-claims-for-an-abandoned-task)
- **Find operational copy-paste commands**: [`docs/RECIPES.md`](./docs/RECIPES.md)
- **Measure structural quality without replacing tests**: [`docs/STRUCTURAL_QUALITY.md`](./docs/STRUCTURAL_QUALITY.md)
- **Read the normative protocol specification**: [`LOOP_ENGINEERING.md`](./LOOP_ENGINEERING.md)
- **Integrate a new AI environment**: [`PROTOCOL_INTEGRATION.md`](./PROTOCOL_INTEGRATION.md)
- **Map ForgeLoop state into an external runtime/orchestrator**: [`ORCHESTRATOR_INTEGRATION.md`](./ORCHESTRATOR_INTEGRATION.md)
- **Edit documentation safely**: [`docs/DOCUMENTATION_GUIDE.md`](./docs/DOCUMENTATION_GUIDE.md)
- **Audit the npm package boundary**: [`docs/PACKAGE_CONTENTS.md`](./docs/PACKAGE_CONTENTS.md)
- **Verify source-content attestations**: [`docs/CODE_ATTESTATION.md`](./docs/CODE_ATTESTATION.md)
- **Understand narrow verification and checker binding**: [`docs/REVISION_PROVIDERS.md`](./docs/REVISION_PROVIDERS.md#differential-verification-scope)
- **Inspect the governed diagrams**: [`docs/diagrams/README.md`](./docs/diagrams/README.md)

`README.md` is intentionally a catalog and quickstart. Do not copy the full
process into adapters or README sections; link to the canonical source.

## Lifecycle reading order

1. Read [`README.md`](./README.md) for scope and quickstart.
2. Read [`LOOP_ENGINEERING.md`](./LOOP_ENGINEERING.md) for the process gates.
3. Read [`PROTOCOL_INTEGRATION.md`](./PROTOCOL_INTEGRATION.md) for the active
   runtime or harness boundary.
4. Inspect [`PROJECT_PROFILE.md`](./PROJECT_PROFILE.md) and confirm facts from
   the repository before using them.
5. Use [`GUIDE_ROUTER.md`](./GUIDE_ROUTER.md) to select only relevant guides.
6. Use [`LOOP_SYSTEM_DESIGN.md`](./LOOP_SYSTEM_DESIGN.md) and schemas when a
   change affects protocol invariants or artifact shape.
7. Use [`docs/REVISION_PROVIDERS.md`](./docs/REVISION_PROVIDERS.md) and
   [`docs/CODE_ATTESTATION.md`](./docs/CODE_ATTESTATION.md) when verification
   scope, provider boundaries, signing, or revision-range coverage is involved.
8. Use [`docs/REPOSITORY_INDEX.md`](./docs/REPOSITORY_INDEX.md) for repository
   discovery; search output remains operational context and never replaces
   guides, contracts, verification evidence, or completion validation.

## Verification and release

The Node regression suite, ESLint, c8, dependency policy, package boundary,
attestation coverage, generated summaries/completions, and Archify diagram
render are the local executable checks. Python validators remain
frozen CI-only compatibility tools because they cover historical Markdown,
loop, and secret-scanning contracts that have not been migrated to Node. Their
scope, exact commands, and migration boundary are recorded in
[`scripts/CI_VALIDATORS.md`](./scripts/CI_VALIDATORS.md).

The package has no runtime dependencies. Development dependencies are limited
to c8, ESLint, TypeScript, and YAML and are checked by
`npm run dependency:policy`. GitHub Actions use `npm ci`, pinned action SHAs,
CodeQL, dependency review, and generated-release notes; npm publication still
uses trusted OIDC publishing and is not implied by local verification.

## Editing rules

- Keep lifecycle prose, the typed Archify source, generated outputs, and the
  text-only README fallback synchronized.
- Keep the generated HTML, SVG, and receipt synchronized with the Archify
  source by running `npm run docs:diagrams` and `npm run docs:check`. CI
  validates the renderer pin, source fingerprint, artifact hashes, and SVG
  safety constraints.
- Preserve the distinction between implemented behavior, local evidence, and
  external publication or production state.
- Run `npm run lint`, `npm run coverage`, `npm run pack:check`, and the Python
  CI-only validators proportionally to the change.
- Run `npm run summary:check`, `npm run completions:check`, and
  `npm run changelog:check` when changing registries, release metadata, or
  documentation.

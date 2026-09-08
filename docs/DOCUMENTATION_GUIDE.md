# ForgeLoop Documentation Guide

This guide explains how to maintain, write, and safely modify ForgeLoop documentation.

---

## 1. Canonical Ownership Model

ForgeLoop strictly separates normative protocol definitions from operational documentation to avoid contradictory rules.

| Area | Location | Responsibility | Rule |
| --- | --- | --- | --- |
| **Normative Protocol** | Root (`LOOP_ENGINEERING.md`, `PROTOCOL_INTEGRATION.md`, `LOOP_SYSTEM_DESIGN.md`, `THREAT_MODEL.md`, `EXECUTION_STATE.md`) | Canonical authority for protocol rules, schemas, state transitions, and security | Never duplicate normative rules in sub-documents; link back to root files. |
| **Operational & Reference** | `docs/` (`GETTING_STARTED.md`, `CROSS_HARNESS_CONTINUITY.md`, `CLI_REFERENCE.md`, `ARTIFACT_REFERENCE.md`, `TROUBLESHOOTING.md`, `RECIPES.md`, `REPOSITORY_INDEX.md`, `PERSISTENT_SEARCH_TRANSPORT.md`) | Tutorials, command reference, handoff workflows, repository search, transport behavior, and troubleshooting | Explains how to operate the system. Links to normative sources for formal specifications. |
| **Domain Engineering** | `ENG/` (`clean-code-eng.md`, `design-code-eng.md`, `test-code-eng.md`, etc.) | Domain-specific implementation and quality standards | Frontmatter must adhere to `validate_loop_system.py` standards. |
| **Consumer Documentation Quality** | [`ENG/documentation-quality-eng.md`](../ENG/documentation-quality-eng.md) | Quality standards for documentation work in projects using ForgeLoop | Governs client/consumer project documentation tasks via guide routing. |
| **Visual Architecture** | `docs/diagrams/manifest.json` + the three typed workflow sources under `docs/diagrams/` | Governance metadata and canonical typed Archify workflow sources | Animated HTML explorers, animated SVG fallbacks, deterministic receipts, and source-bound human reviews are committed under `docs/assets/diagrams/` and `docs/diagrams/reviews/`. |
| **Documentation Index** | `DOCS_INDEX.md` | Single repository index and ownership map | Updated whenever documentation structure changes. |

---

## 2. Documentation Source-of-Truth Rules

When updating documentation, always derive content from its authoritative source:

```text
CLI syntax truth        -> CLI registry / parser (src/cli.js, src/core/cli-command-definitions.js)
Artifact shape truth    -> JSON schemas (schemas/*.schema.json, src/core/artifact-registry.js)
Lifecycle truth         -> protocol / state machine (src/core/protocol.js)
Reason-code truth       -> exported protocol constants (src/core/error-codes.js, src/core/protocol.js)
Guide registry truth    -> canonical guide registry (src/config/guides.json)
Package contents truth  -> package.json + docs/PACKAGE_CONTENTS.md + package tests (tests/package.test.js)
Documentation routing   -> DOCS_INDEX.md
Integration API truth   -> src/integration.js (exports, envelope, limits, risk classes, resources)
MCP behavior truth      -> integrations/mcp/src/* and integrations/mcp/package.json
MCP package boundary    -> MCP package tests + scripts/mcp-package-smoke.mjs
Repository Index truth  -> src/repository-index/*, CLI definitions, Integration API, and MCP resource registry
Persistent transport truth -> src/persistent-transport/*, CLI search dispatcher, and transport tests
```

Operational documentation must explain canonical behavior, not redefine it.

Terminology must remain consistent across active documents: say “advisory
context,” not “canonical memory”; “handoff acceptance,” not “ownership
transfer”; and “operational receipt,” not “delegation.” Advisory output is
never canonical state, evidence, authority, completion truth, or next-action
authority. `consumerId`, harness names, recipient hints, and transport labels
are descriptive values rather than authenticated identity or authority.

Documentation-impact questions for integration/MCP changes:

- Did a server mode or capability gate change?
- Did an MCP transport change?
- Did an adapter error code change?
- Did an integration limit or resource list change?

Anti-drift invariant: every `documentation-manifest.json` entry marked
`packaged: true` is mechanically checked against the core npm tarball
contents (`tests/package.test.js`).

Canonical phase and transition inventories must be derived from `WORK_PHASES`
and `WORK_TRANSITIONS`; do not maintain independent hand-written transition
enums when a generated or mechanically validated representation is available.

---

## 3. Generated Documentation Provenance & Pipeline

ForgeLoop mechanically enforces documentation freshness using deterministic generator targets. If public facts change and documentation regions are not refreshed, CI fails.

```text
runtime facts
    ↓
canonical registries / schemas
    ↓
deterministic generators (scripts/generate_documentation_reference.mjs)
    ↓
generated Markdown regions (<!-- BEGIN FORGELOOP GENERATED: ... -->)
    ↓
semantic conformance checks (scripts/validate_documentation_conformance.mjs)
    ↓
cross-platform CI (.github/workflows/docs-quality.yml)
```

### Provenance Mapping Table

| Fact Category | Canonical Machine Source | Generated Target File | Generated Region Marker |
| --- | --- | --- | --- |
| **Artifact Inventory** | `ARTIFACT_REGISTRY` (`src/core/artifact-registry.js`) | `docs/ARTIFACT_REFERENCE.md` | `<!-- BEGIN FORGELOOP GENERATED: artifact-registry -->` |
| **Artifact Fields** | `schemas/*.schema.json` | `docs/ARTIFACT_REFERENCE.md` | `<!-- BEGIN FORGELOOP GENERATED: schema:<name> -->` |
| **CLI Command Index** | `CLI_COMMAND_DEFINITIONS` (`src/core/cli-command-definitions.js`) | `docs/CLI_REFERENCE.md` | `<!-- BEGIN FORGELOOP GENERATED: cli-command-index -->` |
| **CLI Common Options** | `CLI_COMMAND_DEFINITIONS` (`src/core/cli-command-definitions.js`) | `docs/CLI_REFERENCE.md` | `<!-- BEGIN FORGELOOP GENERATED: cli-common-options -->` |
| **CLI Command Options** | `CLI_COMMAND_DEFINITIONS` (`src/core/cli-command-definitions.js`) | `docs/CLI_REFERENCE.md` | `<!-- BEGIN FORGELOOP GENERATED: cli:<command>:options -->` |
| **Work-State Transitions** | `WORK_PHASES` / `WORK_TRANSITIONS` (`src/core/protocol.js`) | `ORCHESTRATOR_INTEGRATION.md` | `<!-- BEGIN FORGELOOP GENERATED: work-transitions -->` |
| **Public Error Codes** | `PUBLIC_ERROR_CODES` (`src/core/error-codes.js`) | `docs/TROUBLESHOOTING.md` | `<!-- BEGIN FORGELOOP GENERATED: public-error-codes -->` |
| **Architecture and trust diagrams** | `docs/diagrams/manifest.json` + typed workflow sources | Generated HTML/SVG/receipt/review files for Engineering Flow, Verification Trust Flow, and Code Attestation Chain | Verified via the pinned Archify renderer, trace-animation and reduced-motion markers, source/SVG fingerprints, artifact hashes, persistent review, and composition checks |

### Maintenance Workflow

Whenever CLI definitions, schemas, or error codes change:

```bash
# 1. Regenerate all deterministic documentation regions
npm run docs:generate

# 2. Run the test suite (includes parser parity and unit tests)
npm test

# 3. Verify freshness, diagram fingerprints, and semantic conformance
npm run docs:check
```

Do not hard-code inventory totals in prose or headings. Counts of commands,
schemas, fields, and public codes are derived from the registries and schemas;
when those sources change, regenerate the reference documents and let the
conformance checks detect omissions.

---

## 4. Documentation Conformance Matrix

| Documentation Area | Canonical Machine Source | Conformance Validator |
| --- | --- | --- |
| **CLI commands & flags** | `CLI_COMMAND_DEFINITIONS` (`src/core/cli-command-definitions.js`) & `src/cli.js` | `scripts/validate_documentation_conformance.mjs` |
| **Artifact paths** | `ARTIFACT_REGISTRY` & `task-paths.js` | `scripts/validate_documentation_conformance.mjs` |
| **Artifact fields & types** | `schemas/*.schema.json` | `scripts/validate_documentation_conformance.mjs` |
| **Enums & consts** | `schemas/*.schema.json` | `scripts/validate_documentation_conformance.mjs` |
| **Lifecycle phases** | `WORK_PHASES` (`src/core/protocol.js`) | `scripts/validate_documentation_conformance.mjs` |
| **Lifecycle transitions** | `WORK_TRANSITIONS` (`src/core/protocol.js`) + the special `BLOCKED` rule | `scripts/generate_documentation_reference.mjs` and `scripts/validate_documentation_conformance.mjs` |
| **Stable error codes** | `PUBLIC_ERROR_CODES` (`src/core/error-codes.js`) | `scripts/validate_documentation_conformance.mjs` |
| **Discovery resume rules** | `DISCOVERY_SURFACES` & `nativeShim` | `scripts/validate_documentation_conformance.mjs` |
| **Task-layout path freshness** | `TASK_LAYOUT_DOCUMENTS` & `task-paths.js` | `scripts/validate_documentation_conformance.mjs` |
| **Package-shipped docs and runtime** | `package.json` (`files`) + `docs/PACKAGE_CONTENTS.md` | `tests/package.test.js` + `scripts/package_smoke.mjs` |
| **Repository Index contract** | `src/repository-index/*`, `src/core/cli-command-definitions.js`, `src/integration.js` | Repository Index unit/native tests + `scripts/verify-tgrep-manifest.mjs` |
| **Persistent CLI search transport** | `src/persistent-transport/*`, `src/commands/repository-index.js`, `src/repository-index/search.js` | Persistent transport unit/native tests + Repository Index integration tests |
| **Architecture and trust diagrams** | `docs/diagrams/manifest.json` plus each typed workflow source | `scripts/check-documentation-diagrams.mjs` and `scripts/documentation-diagram-inventory.mjs` |

---

## 5. Normative Language Conventions

When writing documentation, use precise terms:

- **MUST / MUST NOT**: Strict protocol requirements enforced by schemas or CLI algorithms.
- **SHOULD / SHOULD NOT**: Strong interoperability recommendations for harnesses.
- **MAY**: Optional behaviors or flags.
- **Illustrative**: Non-normative examples provided for human understanding.

Avoid ambiguous phrases like *"should generally"* or *"usually"* for behaviors that are strictly enforced by the validator.

### Stable requirement IDs

Every protocol-level `MUST` or `MUST NOT` has a stable `FL-<AREA>-<NNN>`
anchor and an entry in [`protocol-requirements.json`](./protocol-requirements.json).
Each map entry names its normative source, implementation validator, and at
least one executable test. `npm run docs:check` rejects an unmapped normative
requirement, an unused mapping, or a missing implementation/test target.

### Documentation impact classification

Classify each documentation-impacting change as one or more of: `NONE`,
`REFERENCE_ONLY`, `OPERATIONAL`, `NORMATIVE`, `SCHEMA_COMPATIBILITY`,
`MIGRATION`, or `SECURITY`. Changes that are normative, compatibility,
migration, or security-sensitive require `npm run docs:check` before merge.

### Multi-Task Layout Rules

- Canonical task-scoped paths are defined in `src/core/task-paths.js` under `.forgeloop/task-state/<taskKey>/`.
- Operational guides (`README.md`, `GETTING_STARTED.md`, `RECIPES.md`, `CROSS_HARNESS_CONTINUITY.md`, `TROUBLESHOOTING.md`) must document namespaced paths by default.
- Architecture/integration documents (`LOOP_SYSTEM_DESIGN.md`, `ORCHESTRATOR_INTEGRATION.md`) are covered by the same task-layout conformance scope (`TASK_LAYOUT_DOCUMENTS`).
- Legacy ForgeLoop 1.0 singleton paths (e.g. `.forgeloop/current-contract.json`) are permitted **only** inside explicit legacy migration regions:

  ```markdown
  <!-- BEGIN FORGELOOP LEGACY LAYOUT EXAMPLE -->
  ...
  <!-- END FORGELOOP LEGACY LAYOUT EXAMPLE -->
  ```

- `scripts/validate_documentation_conformance.mjs` mechanically rejects any singleton task path outside these markers.

---

## 6. Linking Conventions

- **Relative Links Only**: Always use relative markdown links for repository files (e.g. `[`LOOP_ENGINEERING.md`](../LOOP_ENGINEERING.md)`).
- **Valid Targets**: Every relative link must point to an existing file and is validated by `python3 scripts/validate_markdown.py`.
- **Anchors**: Anchor links should match standard GitHub heading slugs.

---

## 7. Archify Diagrams and Animated SVG Generation

1. **Typed source is canonical**: The Engineering Flow, Verification Trust Flow, and Code Attestation Chain are authored in Archify workflow IR under `docs/diagrams/`; the high-level source is `docs/diagrams/forgeloop-engineering-flow.workflow.json`. Never modify generated HTML, SVG, or receipt files directly.
2. **Pinned local renderer**: Generation uses only the vendored Archify v2.15.0 source at the reviewed commit recorded in `docs/diagrams/manifest.json` and `vendor/archify/v2.15.0/PIN.json`.
3. **Animated committed outputs**: Every active source uses `meta.animation: "trace"`. Each interactive HTML is the primary animated explorer, and each self-contained SVG fallback carries trace-capable edge/node animation while remaining usable in repository previews. Deterministic receipts are committed under `docs/assets/diagrams/`.
4. **GitHub-safe SVG**: The SVG must not embed `<script>` or `<foreignObject>`, must expose accessible title/description metadata, and must remain visible through standard Markdown image syntax.
5. **Fingerprint and review verification**: The generated SVG embeds a `data-forgeloop-source-sha256` attribute, the outputs expose trace markers, and the receipt binds the source, HTML, and SVG hashes. The human-owned review at `docs/diagrams/reviews/` binds the current source and SVG hashes and is never generated or overwritten. Run `npm run docs:diagrams:check` before review.
6. **Scoped wrapper**: The ForgeLoop Archify wrapper is intentionally documentation-scoped. It reads canonical inputs only from `docs/diagrams/` and permits deliver outputs only under `docs/assets/diagrams/`.

ForgeLoop governs five documentation-diagram categories: workflow,
architecture, sequence, dataflow, and lifecycle. The active repository set has
three canonical workflow diagrams: the Engineering Flow, Verification Trust
Flow, and Code Attestation Chain. The pinned wrapper currently maps only
`workflow`; governance support does not imply renderer support, so a new type
requires an explicit mapping and tests before activation.

---

## 8. README Hero and Package Boundary

README hero assets are branding/conceptual architecture illustrations. They are
not the canonical protocol diagram. The typed Archify workflow under
`docs/diagrams/` remains the canonical lifecycle architecture source, with
generated outputs under `docs/assets/diagrams/`; the CLI-only persistent search
transport is explained by `docs/PERSISTENT_SEARCH_TRANSPORT.md`.

The README hero is intentionally GitHub-repository-only:

- `README.md` may reference `docs/assets/eng_readme_forgeloop.png`; GitHub
  renders it from the repository.
- The hero PNG is excluded from the npm package (`package.json` `files`), and
  `tests/package.test.js` asserts that exclusion so it cannot be silently
  re-included.
- The packaged README is therefore not self-contained for that relative hero
  path; do not claim otherwise.
- If a portable hero is ever shipped, any relative README asset referenced by
  packaged Markdown must be present in the package and covered by
  `tests/package.test.js`.

Never edit or delete a generated diagram output independently of its source;
regenerate all declared outputs from the typed workflow sources and keep each
receipt and human-owned review binding in sync. Every diagram must also have a
concise text fallback in the canonical document named by its manifest.

---

## 9. Documentation Change Checklist for Pull Requests

For documentation-impacting changes, verify each item before merging:

- [ ] Did CLI behavior change?
- [ ] Did any schema field change?
- [ ] Did any enum or status change?
- [ ] Did any lifecycle transition change?
- [ ] Did any artifact mutation rule change?
- [ ] Did any stable reason/error code change?
- [ ] Did cross-harness resume behavior change?
- [ ] Did package-shipped documentation change?
- [ ] Were generated reference docs updated (`npm run docs:generate`)?
- [ ] Did documentation conformance CI pass (`npm run docs:check`)?
- [ ] If normative language changed, are stable IDs and mappings current?
- [ ] Is the documentation impact classification recorded in the PR?

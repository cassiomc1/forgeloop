# ForgeLoopAudit 10/10 Engineering Readiness Design

> Historical record. This document describes the repository state and implementation target at the time it was written. It is not the current ForgeLoopAudit specification. See the [current documentation index](../../README.md).

## Scope

This design executes the attached `FORGELOOP_AUDIT_10_OUT_OF_10_IMPLEMENTATION_PLAN_V2.md` inline, without subagents. It covers Tasks 1–26 and 29–32. Tasks 27–28 remain optional because they require external signing credentials and are not required for the unsigned-preview target.

The implementation produces a new immutable RC3 identity, machine-verifiable protocol provenance, explicit compatibility and semantic-parity contracts, adversarial security tests, bounded live-update processing, product quality gates, supply-chain evidence, documentation conformance, and a public RC3 release scorecard.

## Architectural boundaries

ForgeLoop remains the lifecycle and protocol authority. Audit remains a local-first, read-only observer:

```text
Electron main process
  secure OS, filesystem, watcher and CLI boundaries
        ↓ typed validated IPC
Preload
  narrow application-owned API
        ↓ view models
Renderer
  display, accessibility and recovery UX
```

Audit will not write `.forgeloop/`, execute arbitrary renderer-provided commands, load project-controlled schemas as authority, or introduce an orchestration/state-transition engine.

## Data and evidence flow

Vendored schemas are paired with `schemas/provenance.json`; verification hashes the committed bytes and checks the pinned ForgeLoop source identity. Protocol compatibility is checked before project/CLI enrichment. Artifact facts remain canonical; CLI facts may enrich but contradictions become explicit diagnostics.

Filesystem events enter a bounded coalescer and reconciler. The reconciler re-reads trusted artifacts and publishes generation-tagged snapshots. Event ledger pages use bounded streaming reads and cursors bound to file identity and chain state. Transient final-line writes are recoverable partials, not permanent corruption.

Release jobs consume one self-contained electron-builder matrix, verify exact artifact counts, generate checksums after final filename normalization, publish SBOM/provenance/evidence, and re-download public assets for verification. RC3 is unsigned but labeled truthfully.

## Quality contracts

- `npm run verify:full` is the local aggregate gate.
- Production audit must report zero high/critical vulnerabilities.
- Typecheck, lint, unit/integration tests, coverage, conformance, security, accessibility, performance, packaged smoke, and E2E are required gates.
- Release evidence must include version, immutable commit, platform, architecture, signing mode, SHA-256, SBOM, provenance, and ForgeLoop compatibility.
- Documentation conformance checks fail when supported version, platform, protocol, security, or release claims drift from implementation.

## Delivery and release

Changes are developed on a `codex/` branch with independently verifiable commits. The final PR targets `main`; checks must pass before merge. After merge, the branch is synchronized, `v0.1.0-rc.3` is created once, and the tag-triggered release is verified from downloaded public assets. The existing `v0.1.0-rc.2` tag is never moved.

## Explicit non-goals

No signing credentials, cloud service, telemetry, remote schema download, autonomous agent runtime, arbitrary shell terminal, or automatic mutation/recovery of ForgeLoop state is introduced.

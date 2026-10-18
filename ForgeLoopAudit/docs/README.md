# ForgeLoopAudit documentation

This index separates current product guidance from historical records. The
current product is ForgeLoopAudit `0.3.0-rc.3`, a local-first web auditor
aligned to ForgeLoop `2.0.0` at immutable commit
`4ff11bb4bc4be39b095a151a323f1388dad0d819` with protocol v1, schema v1 and
Integration API v1. ForgeLoop remains the protocol authority.

ForgeLoop `2.0.0` retains the bounded Audit UX read model, the provider-neutral
`providerExtensions` boundary, explicit `task-abandon`, canonical `contract-revise`
and `checkpoint-revalidate`, the `REVIEWING` reconciliation bootstrap, the
advisory OpenSrc context, host-injected Browser Verification/Security Review/
Emulated Services provider boundaries, and first-class specialist guides
including `flutter`, `rust`, `go`, `java`, `sql` and `.NET` routing.
ForgeLoopAudit
reads canonical selected guides without classifying projects or treating guide
selection as evidence.

ForgeLoop 2.0.0 uses SQLite operational storage and requires Node.js
24.19.0 or newer. Native task discovery, summary and inspector reads use the
public Integration API; database/WAL changes invalidate cached observations.
Legacy JSON remains `ARTIFACT_ONLY`. Audit never migrates inspected projects.
Raw native ledger and JSON previews are unavailable; use canonical projections.

## Start here

- [Root README](../README.md) — product purpose, web startup, trust model,
  demo and verification commands.
- [Current implementation specification](../FORGELOOP_AUDIT_IMPLEMENTATION_SPEC.md)
  — runtime architecture, HTTP/session boundary, UI and verification contract.
- [Web migration report](migration/WEB_IMPLEMENTATION_REPORT.md) — completed
  migration scope, evidence and known limitations.
- [ForgeShop demo guide](../demo/README.md) — generated fixture truth and
  intentional scenario states.
- [Screenshot guide](../screen/README.md) — source, mappings and freshness rules.

## Current documentation owners

| Topic | Canonical document | Implementation or machine source |
| --- | --- | --- |
| Product purpose and getting started | [Root README](../README.md) | `src/renderer/`, `src/server/`, `package.json` |
| Architecture and security | [Implementation specification](../FORGELOOP_AUDIT_IMPLEMENTATION_SPEC.md) | `src/server/`, `src/main/core/`, `src/renderer/` |
| Audit findings, coverage and provenance | [Implementation specification](../FORGELOOP_AUDIT_IMPLEMENTATION_SPEC.md) | `src/shared/audit.ts`, `src/main/core/audit/` |
| Audit history, diffs and reports | [Implementation specification](../FORGELOOP_AUDIT_IMPLEMENTATION_SPEC.md) | `src/main/core/audit/`, `src/server/runtime/` |
| ForgeLoop compatibility | [Protocol compatibility](PROTOCOL_COMPATIBILITY.md) | `src/main/core/protocol/`, `src/main/core/integration/` |
| Operational recovery and failures | [Troubleshooting](TROUBLESHOOTING.md) | `src/server/`, `src/main/core/`, `src/renderer/` |
| Verification contract | [Quality gates](QUALITY_GATES.md) | `scripts/verify-full.mjs`, `.github/workflows/` |
| Publication contract | [Release model](RELEASE_MODEL.md) | `docs/releases/`, `.github/workflows/release.yml` |
| Visual/product principles | [UI design direction](UI_DESIGN_DIRECTION.md) | `src/renderer/`, `src/renderer/styles/` |
| Implementation status | [Implementation checklist](IMPLEMENTATION_CHECKLIST.md) | `src/`, `tests/`, `scripts/` |
| Dependency and audit policy | [Dependency policy](DEPENDENCY_POLICY.md) | `package.json`, `package-lock.json`, `scripts/dependency-policy.mjs` |
| Trusted schemas | [Schemas README](../schemas/README.md) | `schemas/provenance.json`, `src/main/core/protocol/` |
| Vendored ForgeLoop lineage | [Vendor README](../vendor/README.md) | `package.json`, `package-lock.json`, `vendor/` |

## Verification and release

[Quality gates](QUALITY_GATES.md) explains what local, CI and release checks
prove. [Release model](RELEASE_MODEL.md) explains the unsigned npm preview,
checksums, SBOM and tag-triggered workflow without conflating verification with
publication. Machine contracts live under [`docs/releases/`](releases/).

## Trust boundary

[Protocol compatibility](PROTOCOL_COMPATIBILITY.md) defines the Integration API
boundary and capability degradation. [Schemas README](../schemas/README.md)
defines the trusted protocol-v1 schema set. [Vendor README](../vendor/README.md)
defines the pinned ForgeLoop archive and its digest.

## Historical records

The dated records under [`docs/verification/`](verification/),
[`docs/superpowers/`](superpowers/) and
[`docs/migration/WEB_BASELINE.md`](migration/WEB_BASELINE.md) describe earlier
repository states. They are historical records, not current product
requirements. Their version numbers, commit IDs and test results remain
unchanged.

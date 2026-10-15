# ForgeLoopAudit 10/10 Implementation Plan

> Historical record. This document describes the repository state and implementation target at the time it was written. It is not the current ForgeLoopAudit specification. See the [current documentation index](../../README.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Execute this plan inline with verification checkpoints; do not dispatch subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the required unsigned-preview 10/10 engineering gates for ForgeLoopAudit and publish an evidence-backed immutable RC3.

**Architecture:** Preserve ForgeLoop as the sole protocol authority and keep Audit read-only. Add machine-verifiable contracts around provenance, security, reconciliation, quality, documentation, supply chain, and release evidence while exposing only typed application-owned renderer APIs.

**Tech Stack:** Electron 43, Node 22, TypeScript, React, Vite, Vitest, Playwright, Chokidar, Ajv/Zod, electron-builder, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-21-forgeloop-audit-10-10-design.md` plus the attached `FORGELOOP_AUDIT_10_OUT_OF_10_IMPLEMENTATION_PLAN_V2.md`.

## Global Constraints

- ForgeLoop remains the canonical source of truth.
- Audit remains read-only for `.forgeloop/` state.
- Renderer cannot execute arbitrary commands or access the filesystem.
- Project-controlled schemas never become validation authority.
- macOS arm64/x64, Windows, and Linux remain release targets.
- RC2 is immutable; RC3 is the next release identity.
- Unsigned artifacts must be labeled unsigned and protected by checksums, SBOM, provenance, and public re-download verification.
- Every new behavior arrives with a test or executable release gate.

---

### Task 1: RC3 identity and provenance foundation

**Files:** `package.json`, `package-lock.json`, `README.md`, `src/main/__tests__/release-version.test.ts`, `schemas/provenance.json`, `src/main/core/protocol/schema-provenance.ts`, `scripts/generate-schema-provenance.mjs`, `scripts/verify-schema-provenance.mjs`, `schemas/README.md`, `src/main/__tests__/schema-provenance.test.ts`.

- [ ] Add a failing assertion for `0.1.0-rc.3`, bump package/lock identity, and document RC2 immutability.
- [ ] Define the provenance interface and deterministic hash verification for every trusted schema.
- [ ] Generate and commit the manifest without reading user project schemas; reject missing, extra, malformed, or hash-mismatched entries.
- [ ] Add `protocol:schemas:verify` and run the focused tests before committing.

Verification: `npm test -- src/main/__tests__/release-version.test.ts src/main/__tests__/schema-provenance.test.ts && npm run protocol:schemas:verify`.

### Task 2: Compatibility contract and conformance corpus

**Files:** `src/main/core/protocol/compatibility-contract.ts`, `src/main/__tests__/compatibility-contract.test.ts`, `docs/PROTOCOL_COMPATIBILITY.md`, `tests/fixtures/protocol-valid/`, `tests/fixtures/protocol-invalid/`, `scripts/refresh-conformance-fixtures.mjs`, `src/main/__tests__/forgeloop-conformance.test.ts`.

- [ ] Derive the exact supported schema/artifact list from runtime lookups and fail explicitly on unknown protocol versions.
- [ ] Add deterministic valid/invalid fixture metadata and table-driven tests with specific error codes.
- [ ] Document artifact-only versus CLI-enhanced behavior and provenance policy.

Verification: `npm test -- src/main/__tests__/compatibility-contract.test.ts src/main/__tests__/forgeloop-conformance.test.ts`.

### Task 3: Semantic parity and Electron security

**Files:** `src/main/core/protocol/semantic-parity.ts`, CLI/project readers, `package.json`, `package-lock.json`, `scripts/verify-electron-fuses.mjs`, `src/main/security/security-contract.ts`, `src/main/app.ts`, `tests/e2e/packaged-security.spec.ts`.

- [ ] Compare artifact and CLI authoritative facts and surface contradictions as diagnostics.
- [ ] Add compatible Electron fuses, packaged verification, and security contract constants without weakening existing sandbox/isolation settings.
- [ ] Add packaged assertions that Node/require are unavailable while the typed preload API remains available.

Verification: focused parity tests, `npm run test:packaged-smoke`, and the packaged security E2E.

### Task 4: Navigation, permissions, IPC, and path adversarial proof

**Files:** `src/main/security/external-navigation.ts`, `sender-policy.ts`, IPC/preload/shared contracts, `src/main/__tests__/external-navigation.test.ts`, `ipc-security.test.ts`, `path-boundary-adversarial.test.ts`.

- [ ] Centralize HTTPS-only external navigation and deny-by-default permissions.
- [ ] Authenticate every IPC sender, validate bounded inputs, normalize errors, and keep preload APIs narrow.
- [ ] Add POSIX, Windows, symlink, junction, UNC, case, traversal, replacement-race, and separator tests with explicit skip reasons where platform-specific.

Verification: focused security tests on the current host plus CI matrix execution on all supported OSes.

### Task 5: Streaming ledger and convergent watcher

**Files:** `src/main/core/events/streaming-ledger-reader.ts`, current event readers, `src/main/__tests__/ledger-streaming.test.ts`, `scripts/generate-large-ledger-fixture.mjs`, `src/main/watcher/project-reconciler.ts`, watcher implementation, `src/main/__tests__/watcher-reconciliation.test.ts`, watcher fixtures.

- [ ] Implement page reads bounded by limit, byte offset, identity, and validated chain state.
- [ ] Treat incomplete final appends as recoverable partials and detect truncation/replacement/stale cursors.
- [ ] Reconcile watcher bursts through bounded debounce and generation-tagged snapshots; prove clean-rescan equivalence.

Verification: focused tests, static no-whole-ledger-read check, and `node scripts/benchmark-large-project.mjs --scenario ledger`.

### Task 6: Diagnostics and product explainability

**Files:** `src/shared/diagnostics.ts`, `src/main/core/diagnostics/diagnostics.ts`, renderer pages/components, `src/shared/errors.ts`, error tests, `docs/SECURITY_MODEL.md`, `docs/RELEASE_MODEL.md`, `docs/UI_QUALITY_GATES.md`.

- [ ] Add local-only structured diagnostics with bounded retention and no telemetry.
- [ ] Expose authoritative/observed/source labels and actionable recovery UX without protocol mutation.
- [ ] Expand error taxonomy and ensure raw internal exceptions do not become primary renderer copy.

Verification: shared/error tests and invalid-state E2E coverage.

### Task 7: Accessibility, visual, performance, and journey gates

**Files:** Playwright E2E specs, renderer components/styles, `tests/fixtures/large-project/`, `scripts/benchmark-large-project.mjs`, visual/accessibility configuration.

- [ ] Add keyboard-only project-open/task-navigation/live-update workflows and automated accessibility checks.
- [ ] Add deterministic visual snapshots for core surfaces with reduced-motion support.
- [ ] Add large-project/ledger budgets for load time, update convergence, memory proxy, bundle size, and packaged size.
- [ ] Make every primary user journey functional in source and packaged E2E.

Verification: `npm run test:e2e`, accessibility/visual commands, and benchmark commands with explicit thresholds.

### Task 8: Coverage, dependency policy, SBOM, and provenance

**Files:** `package.json`, `package-lock.json`, `scripts/dependency-policy.mjs`, `scripts/generate-release-evidence.mjs`, SBOM/provenance schemas, `docs/DEPENDENCY_POLICY.md`, coverage configuration.

- [ ] Enforce critical-path coverage thresholds and produce machine-readable reports.
- [ ] Keep production audit blocking, document full-audit classifications, add Dependabot policy, and reject force upgrades.
- [ ] Generate CycloneDX/SPDX-compatible SBOM and release evidence binding version, commit, platform, architecture, hashes, signing mode, and ForgeLoop compatibility.

Verification: `npm run audit:prod`, dependency policy, coverage, SBOM schema validation, and evidence generation tests.

### Task 9: CI, CodeQL, documentation, and full verification

**Files:** `.github/workflows/ci.yml`, `.github/workflows/codeql.yml`, `.github/dependabot.yml`, `scripts/check-doc-conformance.mjs`, `scripts/verify-full.mjs`, `docs/QUALITY_GATES.md`, `docs/ARCHITECTURE.md`, `docs/PROTOCOL_COMPATIBILITY.md`, README/spec docs.

- [ ] Make all quality gates required and preserve immutable SHA-pinned actions with least permissions.
- [ ] Add CodeQL and static import-boundary checks.
- [ ] Add documentation conformance checks for version/platform/protocol/security/release claims.
- [ ] Compose `npm run verify:full` in deterministic order and preserve actionable artifacts on failure.

Verification: `npm run verify:full`, CI matrix, CodeQL, and docs check.

### Task 10: RC3 release matrix, Linux provenance, scorecard, and boundary review

**Files:** `electron-builder.release.yml`, `.github/workflows/release.yml`, `scripts/verify-release-assets.mjs`, `scripts/generate-quality-scorecard.mjs`, scorecard/evidence schemas, release docs, architecture tests.

- [ ] Bump/build RC3 only after all required gates pass; keep RC2 immutable.
- [ ] Verify exact macOS arm64/x64 DMG/ZIP, Windows NSIS/portable, and Linux AppImage matrix before staging.
- [ ] Publish checksum, SBOM, provenance, release evidence, and generated quality scorecard; re-download public assets and verify exact filenames/hashes.
- [ ] Enforce final architecture boundaries and prove renderer/main/preload responsibilities remain separated.

Verification: complete local gate, tag-triggered workflow, public release download audit, and final architecture checklist.

### Final integration

- [ ] Run the complete requirement matrix against the attached plan, including explicit exclusions for optional signed Tasks 27–28.
- [ ] Create a `codex/` branch PR with only confirmed files, wait for all required checks, merge using the full head SHA, synchronize local `main`, create immutable `v0.1.0-rc.3`, and verify the public release.

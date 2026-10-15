# ForgeLoopAudit RC3 Final Corrections Implementation Plan

> Historical record. This document describes the repository state and implementation target at the time it was written. It is not the current ForgeLoopAudit specification. See the [current documentation index](../../README.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Turn the remaining RC3 verification gaps into executable, CI-enforced, release-verifiable gates without creating the `v0.1.0-rc.3` tag.

**Architecture:** Preserve ForgeLoop as the protocol authority and Audit as a read-only observer. Strengthen existing contracts through real coverage thresholds, platform-aware packaging verification, measured benchmarks, deterministic E2E/conformance fixtures, per-artifact release evidence, and public post-publish checks.

**Tech Stack:** Electron 43, electron-builder, TypeScript, Vitest/V8 coverage, Playwright, Axe, GitHub Actions, CycloneDX/npm SBOM, AJV, Node.js scripts.

**Spec:** `/Users/cassio/Downloads/FORGELOOP_AUDIT_RC3_FINAL_CORRECTION_PLAN.md`

## Global Constraints

- RC3 remains `0.1.0-rc.3` and explicitly `unsigned-preview`.
- Do not create or move the `v0.1.0-rc.3` tag.
- ForgeLoop remains the sole lifecycle authority; Audit remains read-only.
- Do not exclude security-critical modules merely to inflate coverage.
- Do not use the development Electron binary for packaged fuse mutation.
- All release evidence must represent final public filenames and hashes.
- Execute inline without subagents.

---

### Task 1: Enforce real coverage thresholds

**Files:** create `vitest.config.ts` if needed; modify `vite.config.ts`, `package.json`, `.github/workflows/ci.yml`; add tests under `src/main/__tests__`.

- [ ] Write a failing gate test/script that reads the generated summary and rejects overall values below 90/90/90/85 or critical-module values below 95/95/90.
- [ ] Run the focused gate and observe failure against the current report.
- [ ] Move active V8 coverage configuration into `vitest.config.ts`, keeping critical files included.
- [ ] Add focused tests for CLI limits/timeouts, IPC rejection, watcher teardown, lifecycle cleanup, and failed path reads.
- [ ] Run coverage and the gate; commit `test: enforce real RC3 coverage thresholds`.

### Task 2: Apply and verify Electron fuses on every packaged OS

**Files:** `scripts/apply-electron-fuses.mjs`, `scripts/after-pack-fuses.mjs`, `scripts/verify-electron-fuses.mjs`, `package.json`, `electron-builder.release.yml`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`.

- [ ] Add failing verifier cases for macOS app, Windows executable, Linux executable, and zero candidates.
- [ ] Implement platform-aware executable discovery and fuse application against packaged outputs only.
- [ ] Run package smoke before fuse mutation, then apply and verify fuses on each platform.
- [ ] Keep the development Electron binary untouched; commit `security: verify RC3 fuses cross-platform`.

### Task 3: Measure real performance budgets

**Files:** `scripts/benchmark-large-project.mjs`, `scripts/performance-budgets.json`, `src/main/__tests__/performance-contract.test.ts`, `tests/fixtures/large-project/`.

- [ ] Write a failing performance test that invokes real snapshot, indexing, ledger-page, reconciliation, and schema-validation operations.
- [ ] Implement deterministic fixtures and 3-run median reporting with duration, RSS, page size, and event count.
- [ ] Make the budget script fail on meaningful median regressions and wire it into `verify:full`/CI.
- [ ] Run the benchmark and commit `perf: enforce measured RC3 budgets`.

### Task 4: Make accessibility, keyboard, visual, and full E2E gates executable

**Files:** `playwright.config.ts`, `package.json`, `.github/workflows/ci.yml`, `tests/e2e/accessibility.spec.ts`, `keyboard.spec.ts`, `visual.spec.ts`, `project-open.spec.ts`, `task-navigation.spec.ts`, `live-update.spec.ts`, `invalid-protocol.spec.ts`.

- [ ] Add failing CI job assertions for the full Playwright suite and failure artifact uploads.
- [ ] Add Axe serious/critical checks for all primary pages, keyboard navigation/focus behavior, reduced motion, and deterministic screenshots.
- [ ] Add valid, invalid, multi-task, and live-update journeys using existing fixture factories.
- [ ] Run the focused E2E suites locally where possible and commit `test: enforce RC3 quality journeys`.

### Task 5: Maintain static security scanning without conflicting with repository defaults

**Files:** `.github/workflows/codeql.yml` only if repository default setup is absent; otherwise `.github/QUALITY_GATES.md` and CI documentation.

- [ ] Inspect active repository CodeQL configuration before adding an advanced workflow.
- [ ] Ensure one SHA-pinned JavaScript/TypeScript CodeQL path runs on PR, main, and weekly schedule.
- [ ] Verify the scan succeeds without default-setup conflicts; commit `security: enforce RC3 static scanning` if changes are required.

### Task 6: Expand ForgeLoop conformance and exact error assertions

**Files:** `scripts/refresh-conformance-fixtures.mjs`, `tests/fixtures/protocol-*`, `src/main/__tests__/forgeloop-conformance.test.ts`.

- [ ] Add failing assertions for every supported lifecycle phase, multi-task, continuity-resume, policy-locked, artifact-only, and CLI-enhanced metadata.
- [ ] Add corrupted ledger, stale policy, malformed gate, unknown phase/schema, symlink, oversized artifact, and CLI/artifact conflict fixtures.
- [ ] Assert snapshot phase/health/policy/continuity/task count and exact stable error codes.
- [ ] Run the corpus and commit `test: expand ForgeLoop RC3 conformance corpus`.

### Task 7: Generate complete per-artifact release evidence

**Files:** `scripts/stage-release.mjs`, `scripts/generate-release-evidence.mjs`, `scripts/verify-release-assets.mjs`, `docs/releases/release-evidence.schema.json`, `.github/workflows/release.yml`.

- [ ] Write failing evidence tests for missing, duplicated, misnamed, and mismatched artifacts.
- [ ] Generate one platform evidence document with an artifact array containing type, architecture, final name, and SHA-256 for every public file.
- [ ] Validate evidence against JSON Schema and verify staged checksums from final names.
- [ ] Run staging tests and commit `release: make RC3 evidence artifact-complete`.

### Task 8: Verify public release assets after publication

**Files:** create `scripts/verify-public-release.mjs`; modify `.github/workflows/release.yml`, `scripts/verify-release-assets.mjs`.

- [ ] Add a fixture/API test for exact RC3 asset matrix, tag/version mismatch, missing evidence, and checksum mismatch.
- [ ] Implement download-by-tag verification using GitHub release metadata and downloaded bytes, with no tag creation in this task.
- [ ] Wire the post-publish job after GitHub Release upload and commit `release: verify public RC3 assets`.

### Task 9: Update action revisions and package footprint checks

**Files:** `.github/workflows/*.yml`, `scripts/verify-package-contents.mjs`, `electron-builder.release.yml`, `package.json`.

- [ ] Update checkout/setup/upload/download action references to current immutable SHAs and verify workflow syntax.
- [ ] Add deterministic package inventory, dev-only deny rules, source-map/test/fixture checks, and size baseline.
- [ ] Run package-content and workflow checks; commit `ci: tighten RC3 action and package gates`.

### Task 10: Full verification, PR, merge, and post-merge proof

- [ ] Run `npm run verify:full`, measured performance, full tests, build, package smoke, fuses, and applicable E2E locally.
- [ ] Push the branch and create one non-draft PR against `main`.
- [ ] Wait for all required GitHub checks and fix any failures before merging.
- [ ] Merge with the full head SHA; do not tag RC3.
- [ ] Fetch/prune, sync local `main`, and verify local HEAD equals `origin/main`.

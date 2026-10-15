# ForgeLoopAudit RC3 Release Readiness Final Corrections Implementation Plan

> Historical record. This document describes the repository state and implementation target at the time it was written. It is not the current ForgeLoopAudit specification. See the [current documentation index](../../README.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. The user explicitly requires inline execution without subagents.

**Goal:** Make RC3 release readiness evidence strict, architecture-correct, diagnostically useful, and green-before-merge without publishing the RC3 tag.

**Architecture:** Keep release orchestration deterministic and centered on `docs/releases/release-matrix.json`. Build scripts receive target architecture explicitly; staging, checksum, evidence, and public verification consume the same matrix and reject missing, extra, duplicate, orphaned, or mismatched assets. CI separates the shared verification gate from platform-native proof and never cancels remaining OS diagnostics after one failure.

**Tech Stack:** Node.js ESM scripts, TypeScript/Vitest, Electron/Playwright, electron-builder, GitHub Actions, GitHub CLI/API.

**Spec:** `/Users/cassio/Downloads/FORGELOOP_AUDIT_RC3_RELEASE_READINESS_AND_FINAL_CORRECTIONS.md`

## Global Constraints

- Do not create or push `v0.1.0-rc.3`; the requested publication boundary is PR plus merge.
- Preserve unsigned-preview policy and production dependency audit behavior.
- Do not weaken packaged smoke or fuse hardening to hide failures.
- Use explicit artifact architecture; never infer it from runner `process.arch`.
- Require exact release matrix, checksum coverage, evidence binding, and SBOM.
- Keep `main` CI-required and up-to-date before merge when GitHub permissions allow it.

### Task 1: Smoke diagnostics

**Files:** `scripts/packaged-smoke.mjs`, new unit tests under `src/main/__tests__` or script-testable helper.

- Add explicit launch/window timeouts, executable logging, elapsed timing, process exit/signal diagnostics, and forced cleanup.
- Preserve title and preload bridge assertions.
- Test timeout/error messages and cleanup behavior without requiring a GUI in unit tests.
- Reproduce the Linux package smoke locally and keep the gate enabled.

### Task 2: Single release matrix and evidence contract

**Files:** create `docs/releases/release-matrix.json`; modify `scripts/stage-release.mjs`, `scripts/generate-release-evidence.mjs`, `docs/releases/release-evidence.schema.json`, `scripts/verify-release-assets.mjs`, `scripts/verify-public-release.mjs`, package scripts and release tests.

- Encode exact macOS, Windows, and Linux distributables and architecture targets.
- Pass architecture explicitly into evidence generation and validate allowed platform/architecture combinations.
- Enforce strict schema fields, hashes, commit, version, workflow run, and ForgeLoop compatibility.
- Compare independently discovered actual files with manifest declarations and evidence files.
- Require all platform manifests, one evidence JSON per distributable, SBOM, exact counts, and no unknown/orphan assets.
- Add negative tests for missing/extra/duplicate/path-traversal/mismatch cases and macOS arm64/x64 evidence.

### Task 3: Coverage, fuses, and CI reliability

**Files:** `vitest.config.ts`, `scripts/verify-critical-coverage.mjs`, `scripts/verify-electron-fuses.mjs`, fuse tests, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.github/workflows/public-release-verification.yml`.

- Include security, IPC, CLI, events, project, protocol, tasks, and watcher modules in critical coverage with narrow documented exclusions only for true bootstrap adapters.
- Require Linux-safe fuse assertions and macOS/Windows ASAR-integrity assertions.
- Set CI matrix `fail-fast: false`, centralize the shared `verify:full` contract, and preserve platform-native smoke/E2E/package gates.
- Refresh immutable action SHAs to supported runtime revisions.

### Task 4: Documentation, audit, and governance

**Files:** `docs/RELEASE_MODEL.md`, `docs/QUALITY_GATES.md`, `docs/DEPENDENCY_POLICY.md`, workflow/repository governance configuration where available, tests.

- Document the matrix/evidence invariant, release rehearsal, and dev-only audit triage without blanket force upgrades.
- Add a machine-checkable or API-applied `main` governance rule requiring PR, green completed CI, and up-to-date branch when authorized.
- Keep tag/release publication outside this task.

### Task 5: Verification and delivery

- Run focused red-green tests for each new behavior, then `npm run verify:full`, package smoke, coverage, and release asset checks.
- Review `git diff --check` and explicit staged paths, commit, push, create PR, watch checks, merge by full head SHA, fetch/prune, and verify clean synchronized `main`.

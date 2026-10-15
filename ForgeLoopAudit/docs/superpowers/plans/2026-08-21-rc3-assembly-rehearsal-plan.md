# RC3 Assembly Rehearsal Implementation Plan

> Historical record. This document describes the repository state and implementation target at the time it was written. It is not the current ForgeLoopAudit specification. See the [current documentation index](../../README.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the RC3 release rehearsal execute the same combined artifact assembly, SBOM generation, and release-asset verification used by a real tag release.

**Architecture:** Keep the three platform build jobs unchanged. Add an always-executable `assemble` job that downloads their staged artifacts, creates the SBOM, verifies the flat release bundle, and uploads that verified bundle. Make the tag-only `publish` job consume the assembled artifact and perform only GitHub Release publication.

**Tech Stack:** GitHub Actions YAML, Node.js scripts, npm, Node test runner.

**Spec:** `/Users/cassio/Downloads/FORGELOOP_AUDIT_RC3_PRETAG_FINAL_REVIEW.md`

## Global Constraints

- The current release matrix remains exactly seven public distributables.
- `workflow_dispatch` must run platform jobs and combined assembly verification.
- GitHub Release publication remains restricted to `refs/tags/v*`.
- SBOM generation and `node scripts/verify-release-assets.mjs release-assets` must run in the shared assembly job.
- Existing artifact names, checksum manifests, evidence files, and release permissions remain unchanged.

### Task 1: Add the release workflow topology contract

**Files:**
- Create: `scripts/__tests__/release-workflow.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `.github/workflows/release.yml` as plain text.
- Produces: executable assertions for the shared `assemble` job and tag-only `publish` job.

- [ ] Write assertions that require `assemble` to depend on all three platform jobs, have no tag-only condition, download artifacts with `merge-multiple: true`, generate the SBOM, run the release verifier, and upload the assembled bundle.
- [ ] Write assertions that require `publish` to depend on `assemble`, remain tag-only, and contain GitHub Release publication without a second artifact download.
- [ ] Add the new test file to `test:release-contracts`.
- [ ] Run `npm run test:release-contracts` and confirm it fails because the current workflow has no `assemble` job.

### Task 2: Split assembly from publication

**Files:**
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: the three existing `forgeloop-audit-{macos,windows,linux}` artifacts.
- Produces: `forgeloop-audit-assembled` containing the verified flat release bundle.

- [ ] Add `assemble` with `needs: [macos, windows, linux]`, `runs-on: ubuntu-latest`, and no tag-only `if` condition.
- [ ] Move checkout, Node setup, npm install, artifact download, SBOM generation, and release-asset verification into `assemble`; upload `release-assets/*` as `forgeloop-audit-assembled`.
- [ ] Change `publish` to `needs: [assemble]`, retain the tag-only condition, download only `forgeloop-audit-assembled` with `merge-multiple: true`, and retain the existing release action.
- [ ] Run the workflow topology contract and YAML lint/parsing checks available in the repository.

### Task 3: Verify and deliver

**Files:**
- No additional source files.

- [ ] Run the focused release-contract tests, full Vitest suite, typecheck, lint, and `npm run verify:full`.
- [ ] Inspect the diff and commit only the intended files.
- [ ] Push `codex/rc3-release-assembly`, open a non-draft PR against `main`, wait for required checks, and merge using the verified head SHA.
- [ ] Verify the merge commit, remote branch state, and local checkout after merge.
- [ ] Dispatch the Release workflow from the merged current `main` and verify the manual rehearsal reaches platform builds, `assemble`, SBOM generation, and release-asset verification.

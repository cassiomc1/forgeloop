# RC3 Final Tag Gate Implementation Plan

> Historical record. This document describes the repository state and implementation target at the time it was written. It is not the current ForgeLoopAudit specification. See the [current documentation index](../../README.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Release workflow self-verifying and bind public release evidence to the commit resolved from its Git tag.

**Architecture:** Keep platform build jobs responsible for the full verification contract and independent Electron fuse read-back. Export the tag-commit comparison as a small pure helper from the public verifier so it can be tested without network calls, while the verifier resolves the GitHub tag through the repository API before accepting evidence.

**Tech Stack:** GitHub Actions YAML, Node.js ESM, node:test, Ajv, GitHub REST API.

**Spec:** `/Users/cassio/Downloads/FORGELOOP_AUDIT_RC3_FINAL_TAG_GATE_REVIEW.md`

## Global Constraints

- Release jobs must run `npm run verify:full` on the tagged or manually rehearsed commit.
- Windows and Linux Release jobs must independently verify packaged Electron fuses.
- Public evidence must agree with the commit resolved from the release tag, including lightweight and annotated tags.
- RC3 remains unsigned-preview; do not create or push `v0.1.0-rc.3` in this implementation/PR workflow.

---

### Task 1: Add tag/evidence commit contract tests

**Files:**
- Modify: `scripts/__tests__/release-contracts.test.mjs`
- Modify: `scripts/verify-public-release.mjs`

**Interfaces:**
- Produces `scripts/release-identity.mjs` with `assertEvidenceCommitMatchesTag(commitSet, tagCommit)` for use by the networked verifier and node:test.

- [ ] **Step 1: Write failing tests**

Add tests for matching evidence, inconsistent evidence, and an evidence set that is internally consistent but differs from the tag commit. Include a resolved tag SHA value representing both lightweight and annotated tag resolution at the verifier boundary.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test scripts/__tests__/release-contracts.test.mjs`

Expected: FAIL because the tag/evidence assertion helper is not exported yet.

- [ ] **Step 3: Implement the minimal pure assertion helper**

Create the pure helper in `scripts/release-identity.mjs`; it requires exactly one evidence commit and requires it to equal the independently resolved tag commit. Keep CLI execution in the existing public verifier without changing its command signature.

- [ ] **Step 4: Run focused tests and verify they pass**

Run: `node --test scripts/__tests__/release-contracts.test.mjs`

Expected: all release contract tests pass.

### Task 2: Bind public verification to the GitHub-resolved tag

**Files:**
- Modify: `scripts/verify-public-release.mjs`
- Modify: `scripts/__tests__/release-contracts.test.mjs`

**Interfaces:**
- Consumes `GET /repos/{owner}/{repo}/commits/{tag}` from the existing authenticated GitHub API client.
- Uses `assertEvidenceCommitMatchesTag(commitSet, tagCommit)` before accepting the release.

- [ ] **Step 1: Add the tag-resolution contract test cases**

Cover correct tag SHA, wrong tag SHA, and inconsistent evidence SHA values at the pure helper boundary; the API response is treated as the final commit SHA after GitHub dereferences lightweight or annotated tags.

- [ ] **Step 2: Run focused tests and verify the expected failure**

Run: `node --test scripts/__tests__/release-contracts.test.mjs`

Expected: the new assertion cases fail until the helper is implemented.

- [ ] **Step 3: Resolve the tag and enforce the binding**

Fetch `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(tag)}`, validate its `sha` as a 40-character lowercase commit SHA, and call the helper after collecting evidence commits. Preserve the existing asset-byte, matrix, checksum, schema, version, and signing checks.

- [ ] **Step 4: Run focused tests and the verifier syntax check**

Run: `node --test scripts/__tests__/release-contracts.test.mjs` and `node --check scripts/verify-public-release.mjs`.

Expected: tests pass and syntax check exits 0.

### Task 3: Harden Release workflow gates

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `docs/RELEASE_MODEL.md`

**Interfaces:**
- Release platform jobs use the existing `verify:full` script and `verify:electron-fuses` command.

- [ ] **Step 1: Update platform gate steps**

Replace each Release job's separate `audit:prod` and `verify` steps with one named `npm run verify:full` step. Add Windows and Linux fuse verification immediately after their unpacked packaged smoke and before distributable staging; retain the existing macOS verification.

- [ ] **Step 2: Document the final release-chain invariant**

Update the release model to state that the Release workflow independently runs the full contract and verifies fuses on every native platform, while public verification binds evidence commits to the resolved tag commit.

- [ ] **Step 3: Validate workflow and documentation contracts**

Run: `npm run docs:check` and inspect the workflow diff for all three platform jobs.

Expected: documentation conformance passes and no platform job retains the weaker release gate.

### Task 4: Full verification and delivery

**Files:**
- Modify: the files from Tasks 1–3 only.
- Create: `docs/superpowers/plans/2026-08-21-rc3-final-tag-gate.md`

- [ ] **Step 1: Run the complete local verification**

Run: `npm run verify:full`.

Expected: exit 0 with tests, release contracts, coverage, performance, documentation, and package contracts passing.

- [ ] **Step 2: Review the exact diff and commit on a feature branch**

Create `codex/rc3-final-tag-gate` from synchronized `main`, stage only the listed files, and commit with message `fix: close RC3 final release tag gate`.

- [ ] **Step 3: Push and create the pull request**

Push the feature branch, create one PR targeting `main`, and include the three code-level corrections plus the explicit note that the RC3 tag was not created.

- [ ] **Step 4: Wait for required checks and merge**

Wait for the Ubuntu, macOS, and Windows required checks. Merge only the exact verified head SHA using the repository's protected-branch workflow.

- [ ] **Step 5: Verify the merged state**

Fetch with pruning, verify the PR is merged, verify `main` equals `origin/main`, and report the PR/merge commit plus the fact that no release tag was published.

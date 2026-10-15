# ForgeLoopAudit Post-1.6.1 Corrections Implementation Plan

> Historical record. This document describes the repository state and implementation target at the time it was written. It is not the current ForgeLoopAudit specification. See the [current documentation index](../../README.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or equivalent inline execution) to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make isolation presentation follow negotiated capability support, remove stale current-policy wording, and preserve an auditable verification record without changing the already-correct ForgeLoop 1.6.1 alignment.

**Architecture:** Keep artifact validation and generic execution provenance independent from optional isolation presentation. The Executions page will derive one strict boolean from `snapshot.protocol.featureSupport?.verificationExecutionIsolation`, always retain generic details/raw JSON, and render isolation-specific labels/details only when that boolean is true. Documentation changes remain limited to the current RC policy and a dated verification record.

**Tech Stack:** TypeScript, React, Vitest, Playwright, Node.js, Markdown, npm scripts.

**Spec:** `/Users/cassio/Downloads/FORGELOOP_AUDIT_POST_1_6_1_CORRECTIONS.md`

## Global Constraints

- Keep ForgeLoop 1.6.1, commit `f331100cff175a4ce990fa843b397fcf720b40f5`, and the vendored archive unchanged.
- Keep optional execution provenance fields optional and the execution schema strict.
- Missing or incomplete isolation capability stays `INTEGRATION_V1` with isolation presentation disabled.
- Audit remains read-only and never creates, verifies, or attests execution isolation.
- Preserve the existing `screen/.DS_Store` in the primary checkout and do not rewrite historical RC references.

---

### Task 1: Gate isolation presentation by negotiated capability

**Files:**
- Modify: `src/renderer/pages/execution-display.ts`
- Modify: `src/renderer/pages/execution-display.test.ts`
- Modify: `src/renderer/pages/Executions.tsx`
- Add: `src/renderer/pages/Executions.test.ts`
- Modify: `tests/e2e/demo.spec.ts` only if the available-capability flow needs an assertion update

**Interfaces:**
- Consumes: `ExecutionRecord` persisted provenance and `ProjectSnapshot.protocol.featureSupport`.
- Produces: generic provenance rows that remain available for every valid artifact and isolation rows that require exact negotiated support.

- [x] **Step 1: Add failing display-helper tests**

Test four observable contracts: complete capability returns all isolation rows, false/absent capability returns no isolation rows while generic rows remain available, the page shows the neutral message when support is unavailable, and a legacy record never receives guessed execution kind or isolation mode.

- [x] **Step 2: Run the focused helper test and verify the expected failure**

Run: `npm test -- --run src/renderer/pages/execution-display.test.ts`

Expected: FAIL because the helper does not yet separate generic provenance from isolation presentation.

- [x] **Step 3: Implement the minimal pure helper split**

Keep `executionProvenanceDetails(execution)` for execution kind, protocol project root, and execution cwd. Add an `executionIsolationDetails(execution)` helper for isolation mode, isolated, live-project-writable, network policy, and environment policy. Use persisted values and the existing explicit absent label only; do not infer values.

- [x] **Step 4: Run the focused helper test and verify it passes**

Run: `npm test -- --run src/renderer/pages/execution-display.test.ts`

Expected: PASS with both negotiated and degraded cases covered.

- [x] **Step 5: Gate the React page with one strict capability boolean**

Derive `snapshot.protocol.featureSupport?.verificationExecutionIsolation === true` once. Always render generic execution data and raw JSON. Render isolation badges/details only when available, and otherwise show the neutral unavailability message from the spec.

- [x] **Step 6: Run renderer typecheck/build and the existing demo E2E contract**

Run: `npm run typecheck`

Run: `npm run build`

Run: `npm run test:e2e -- tests/e2e/demo.spec.ts`

Expected: PASS; the demo continues to show persisted `PROJECT_ISOLATED` and `NATIVE_PROJECT` values when its capability is negotiated.

- [x] **Step 7: Commit the UI correction**

Run: `git add src/renderer/pages/Executions.tsx src/renderer/pages/execution-display.ts src/renderer/pages/execution-display.test.ts tests/e2e/demo.spec.ts && git commit -m "fix(executions): gate isolation presentation by capability"`

### Task 2: Correct current release-candidate wording

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: package version `0.1.0-rc.6` and current release-policy wording.
- Produces: durable current-policy prose without rewriting historical release references.

- [x] **Step 1: Replace only the stale current release-candidate policy sentence**

Use: `For the current release-candidate policy, Linux, macOS and Windows builds are unsigned preview artifacts.` Keep any historical RC references outside the current-policy paragraph unchanged.

- [x] **Step 2: Verify documentation and whitespace**

Run: `rg -n "release-candidate policy|unsigned preview" README.md`

Run: `npm run docs:check`

Run: `git diff --check`

Expected: the current README policy uses durable wording, documentation conformance passes, and no whitespace errors.

- [x] **Step 3: Commit the wording correction**

Run: `git add README.md && git commit -m "docs: remove stale current release-candidate policy wording"`

### Task 3: Record verification evidence

**Files:**
- Create: `docs/verification/2026-08-28-forgeloop-alignment-corrections.md`

**Interfaces:**
- Consumes: final Audit commit, ForgeLoop upstream identity, vendored archive digest, schema provenance identity, exact local command results, and environment details.
- Produces: one compact auditable record with explicit exit status for every requested command and explicit skipped-gate reasons.

- [x] **Step 1: Gather immutable identities and runtime details**

Record `git rev-parse HEAD`, the upstream commit from the supplied requirements, `shasum -a 256 vendor/cassiomc1-forgeloop-1.6.1-f331100.tgz`, the relevant fields from `schemas/provenance.json`, `node --version`, `npm --version`, and `uname -a`.

- [x] **Step 2: Run the requested verification matrix sequentially**

Run each command from the correction document and preserve its actual exit status: `npm run protocol:schemas:verify`, `npm run demo:verify`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run docs:check`, `npm run test:release-contracts`, `npm run test:e2e`, `npm run test:electron-smoke`, `npm run test:packaged-smoke`, `npm run verify:full`, and `git diff --check`.

- [x] **Step 3: Write the dated record from captured results**

Include the exact command strings, exit status, environment, identities, and any gate that could not run because of local platform/tooling constraints. Do not claim a skipped gate passed.

### Task 4: Independent review, PR, merge, and synchronization

**Files:**
- Review: complete branch diff and verification record

- [x] **Step 1: Run the full relevant verification again after the evidence file is added**

Run the focused tests, full unit suite, typecheck, lint, build, docs/schema/demo/release checks, and `git diff --check` as applicable. Read every exit status.

- [x] **Step 2: Review the exact diff against the attached requirements**

Confirm no schema/runtime pin changed, no mutating ForgeLoop command was introduced, no isolation facts are inferred, and no unrelated file is staged.

- [x] **Step 3: Request independent code review with exact base/head SHAs**

Fix Critical and Important findings, rerun affected validation, and retain Minor findings only when they do not affect acceptance.

- [ ] **Step 4: Push one branch and create one PR against `main`**

Describe the capability gate, preserved artifact compatibility, README correction, evidence record, verification results, and non-goals.

- [ ] **Step 5: Inspect required PR checks and merge only the freshly verified head**

Query the PR head immediately before merging, use a head-matched merge, then verify the merge commit and all post-merge workflows.

- [ ] **Step 6: Synchronize local `main` with `origin/main`**

Verify `HEAD == origin/main`, confirm the tracked tree is clean, and preserve the pre-existing untracked `screen/.DS_Store`.

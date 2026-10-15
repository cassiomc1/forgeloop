
# ForgeLoopAudit 1.6.1 Alignment Implementation Plan

> Historical record. This document describes the repository state and implementation target at the time it was written. It is not the current ForgeLoopAudit specification. See the [current documentation index](../../README.md).

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Align Audit's vendored ForgeLoop runtime, trusted schemas, read-only execution reader, optional capability model, Executions presentation, demo fixtures, and current-version documentation with ForgeLoop v1.6.1 at commit f331100cff175a4ce990fa843b397fcf720b40f5.

**Architecture:** Keep ForgeLoop as the semantic authority and Audit as a local-first read-only observer. Pin the runtime and schemas to the same immutable upstream commit, preserve valid legacy protocol-v1 artifacts, normalize verificationExecutionIsolation explicitly as an additive feature, and display only persisted execution provenance.

**Tech Stack:** Node.js 20+, npm, TypeScript, React 19, Electron/Vite, Vitest, Playwright, Ajv, ForgeLoop Integration API v1, JSON Schema draft 2020-12.

**Spec:** docs/superpowers/specs/2026-08-28-forgeloop-audit-1.6.1-alignment-design.md

## Global Constraints

- ForgeLoop package version is 1.6.1 and upstream commit is f331100cff175a4ce990fa843b397fcf720b40f5.
- Protocol version remains 1; schema version remains 1; Integration API version remains 1.
- execution.schema.json is copied from the controlled upstream checkout and remains strict with additionalProperties false.
- Valid legacy protocol-v1 execution artifacts remain accepted; missing provenance is never converted into an inferred default.
- verificationExecutionIsolation is optional: incomplete or absent capability data yields false, never INCOMPATIBLE by itself.
- Audit must not add process execution, protocol mutation, verification adapters, sandbox creation, or duplicated ForgeLoop isolation invariants.
- Generated schemas, provenance, lockfiles, and demo artifacts are changed through their canonical generators or package tools.
- Preserve unrelated pre-existing files, especially screen/.DS_Store; do not clean or force-reset the workspace.
- No Audit release/tag/publication or version bump is included because the request is implementation, PR creation, merge, and local synchronization.

---

### Task 1: Add red regression coverage for v1.6.1 execution artifacts

**Files:**
- Modify: src/main/__tests__/execution-reader.test.ts
- Modify: src/main/__tests__/schema-provenance.test.ts
- Modify: src/main/__tests__/forgeloop-integration.test.ts

**Interfaces:**
- Consumes: existing createExecutionReader, trusted schema validator, and bundled Integration API adapter.
- Produces: failing tests that identify the stale 1.6.0 schema/runtime identity and missing v1.6.1 execution fields before production changes.

- [ ] Step 1: Add a full v1.6.1 fixture beside the existing legacy fixture. Keep the legacy fixture unchanged and include executionKind, protocolProjectRoot, executionIsolation, and the complete isolation object with PROJECT_ISOLATED, isolated true, liveProjectWritable false, networkPolicy INHERITED, and environmentPolicy SANITIZED.
- [ ] Step 2: Rename the current valid-fixture test to state that it accepts a valid legacy protocol-v1 execution without isolation metadata.
- [ ] Step 3: Write the new execution test. Assert one returned record, invalidCount equal to zero, and exact preservation of executionKind, protocolProjectRoot, executionIsolation, and isolation.
- [ ] Step 4: Add a valid-looking execution with unsupportedProperty true beside a valid sibling. Assert only the valid sibling is returned and invalidCount is one.
- [ ] Step 5: Change current-runtime expectations in schema-provenance and integration tests to 1.6.1 and f331100cff175a4ce990fa843b397fcf720b40f5.
- [ ] Step 6: Run the focused tests and observe the expected red state.

~~~bash
npm test -- --run src/main/__tests__/execution-reader.test.ts src/main/__tests__/schema-provenance.test.ts src/main/__tests__/forgeloop-integration.test.ts
~~~

Expected: the new execution is withheld by the old schema and current-runtime identity assertions fail against 1.6.0.
- [ ] Step 7: Commit the red tests.

~~~bash
git add src/main/__tests__/execution-reader.test.ts src/main/__tests__/schema-provenance.test.ts src/main/__tests__/forgeloop-integration.test.ts
git commit -m "test: cover ForgeLoop 1.6.1 execution compatibility"
~~~

### Task 2: Pin the runtime and regenerate trusted schemas

**Files:**
- Create: vendor/cassiomc1-forgeloop-1.6.1-f331100.tgz
- Delete: vendor/cassiomc1-forgeloop-1.6.0-1eb8088.tgz
- Modify: package.json
- Modify: package-lock.json
- Modify: schemas/execution.schema.json
- Modify: schemas/provenance.json
- Modify: schemas/README.md
- Modify: vendor/README.md

**Interfaces:**
- Consumes: controlled ForgeLoop checkout at /Users/cassio/Documents/github/forgeloop and exact commit f331100cff175a4ce990fa843b397fcf720b40f5.
- Produces: deterministic package and trusted schema set with matching package version, commit, and SHA-256.

- [ ] Step 1: Verify the sibling checkout is clean, its target package version is 1.6.1, and create a temporary detached worktree from the exact commit without changing the sibling checkout.

~~~bash
FORGELOOP_UPSTREAM_DIR=/Users/cassio/Documents/github/forgeloop
FORGELOOP_PACKAGE_WORKTREE=/private/tmp/forgeloop-audit-v1.6.1
git -C "$FORGELOOP_UPSTREAM_DIR" status --short --branch
git -C "$FORGELOOP_UPSTREAM_DIR" worktree add --detach "$FORGELOOP_PACKAGE_WORKTREE" f331100cff175a4ce990fa843b397fcf720b40f5
~~~

- [ ] Step 2: Run npm pack in the detached worktree, inspect package/package.json for name @cassiomc1/forgeloop and version 1.6.1, and confirm package/src/integration.js is present.
- [ ] Step 3: Copy the archive to vendor/cassiomc1-forgeloop-1.6.1-f331100.tgz, compute shasum -a 256, and record the actual digest in vendor/README.md.
- [ ] Step 4: Change package.json to file:vendor/cassiomc1-forgeloop-1.6.1-f331100.tgz, run npm install, and verify package-lock.json no longer references the old ForgeLoop archive.
- [ ] Step 5: Run the canonical provenance generator against the exact source commit, then verify the generated manifest and schemas.

~~~bash
node scripts/generate-schema-provenance.mjs --source "$FORGELOOP_UPSTREAM_DIR" --commit f331100cff175a4ce990fa843b397fcf720b40f5 --package-version 1.6.1
npm run protocol:schemas:verify
~~~

- [ ] Step 6: Confirm execution.schema.json contains the v1.6.1 properties and strict isolation additionalProperties false. Run the focused tests from Task 1 and observe green.
- [ ] Step 7: Remove the old archive after references are migrated and commit the P0 alignment.

~~~bash
git add package.json package-lock.json schemas vendor
git rm vendor/cassiomc1-forgeloop-1.6.0-1eb8088.tgz
git commit -m "chore(protocol): align ForgeLoopAudit with ForgeLoop v1.6.1"
~~~

### Task 3: Normalize the v1.6.1 Integration API capability additively

**Files:**
- Modify: src/main/core/integration/types.ts
- Modify: src/main/core/integration/forgeloop-integration.ts
- Modify: src/main/core/protocol/protocol-capabilities.ts
- Modify: src/shared/domain.ts
- Modify: src/main/__tests__/protocol-capabilities.test.ts
- Modify: src/main/__tests__/forgeloop-integration.test.ts
- Modify: src/main/__tests__/canonical-projections.test.ts when strict fixtures require it

**Interfaces:**
- Consumes: raw features.verificationExecutionIsolation from the bundled Integration API.
- Produces: ForgeLoopVerificationIsolationMode, ForgeLoopVerificationExecutionIsolationFeatureSummary, and ForgeLoopFeatureSupport.verificationExecutionIsolation.

- [ ] Step 1: Add currentCapabilities test data with version 1, supported true, adapter true, all three known modes, and protocolProjectRootSeparateFromExecutionCwd true.
- [ ] Step 2: Add tests for complete support, missing feature, version 2, each missing known mode, supported false, adapter false, and missing root/cwd separation. Every incomplete case must assert mode INTEGRATION_V1 and support false; complete support must assert true.
- [ ] Step 3: Run the capability tests before implementation and observe the red state.

~~~bash
npm test -- --run src/main/__tests__/protocol-capabilities.test.ts src/main/__tests__/forgeloop-integration.test.ts
~~~

- [ ] Step 4: Add these explicit types and make the feature optional in the Integration API capability map.

~~~ts
export type ForgeLoopVerificationIsolationMode =
  | 'NATIVE_PROJECT'
  | 'PROJECT_ISOLATED'
  | 'SYSTEM_ISOLATED';

export interface ForgeLoopVerificationExecutionIsolationFeatureSummary {
  version: number;
  supported: boolean;
  adapter: boolean;
  modes: ForgeLoopVerificationIsolationMode[];
  protocolProjectRootSeparateFromExecutionCwd: boolean;
}
~~~

- [ ] Step 5: Add a local type guard that filters only the three known modes and normalize the raw capability using strict boolean checks; never pass the raw object through unchecked.
- [ ] Step 6: Add verificationExecutionIsolation false to EMPTY_FEATURE_SUPPORT and derive true only when version is exactly 1, supported and adapter are true, all three modes are present, and root/cwd separation is true. Do not add this feature to capabilitiesAreComplete.
- [ ] Step 7: Update reusable feature fixtures and current runtime literals, run focused tests plus typecheck, and commit.

~~~bash
npm test -- --run src/main/__tests__/protocol-capabilities.test.ts src/main/__tests__/forgeloop-integration.test.ts src/main/__tests__/canonical-projections.test.ts
npm run typecheck
git add src/main/core/integration src/main/core/protocol/protocol-capabilities.ts src/shared/domain.ts src/main/__tests__
git commit -m "feat(protocol): preserve verification isolation capability"
~~~

### Task 4: Extend the execution domain and tested presentation helpers

**Files:**
- Modify: src/shared/domain.ts
- Create: src/renderer/pages/execution-display.ts
- Create: src/renderer/pages/execution-display.test.ts
- Modify: src/renderer/pages/Executions.tsx
- Modify: tests/e2e/demo.spec.ts

**Interfaces:**
- Consumes: optional ExecutionRecord executionKind, protocolProjectRoot, executionIsolation, and isolation fields.
- Produces: pure display helpers that return explicit labels/detail rows without inventing absent metadata.

- [ ] Step 1: Add ExecutionKind, VerificationIsolationMode, and ExecutionIsolationMetadata to shared/domain.ts; add all four properties as optional on ExecutionRecord.
- [ ] Step 2: Write failing helper tests for recorded metadata and an empty record. The empty record must produce Not recorded by this artifact. The recorded case must produce rows for Execution kind, Protocol project root, Execution cwd, Isolation mode, Isolated, Live project writable, Network policy, and Environment policy.
- [ ] Step 3: Run the helper test and observe the missing-helper failure.

~~~bash
npm test -- --run src/renderer/pages/execution-display.test.ts
~~~

- [ ] Step 4: Implement the minimal helper module. Use persisted values only; if both isolation mode fields are absent, return the explicit absent label.
- [ ] Step 5: Update Executions.tsx with neutral badges only when recorded, the eight expanded provenance rows, the absent label for legacy records, and this boundary copy:

~~~text
Isolation information is persisted by ForgeLoop. Audit displays the recorded provenance and does not create or verify execution sandboxes itself.
~~~

Keep the raw JSON control unchanged.
- [ ] Step 6: Extend the demo E2E flow to navigate to Executions, expand a generated isolated execution, and assert VERIFICATION, PROJECT ISOLATED, Protocol project root, and Environment policy.
- [ ] Step 7: Run helper tests, typecheck, build, and the targeted E2E test. If the local Electron environment is unavailable, record that limitation for the GitHub matrix.

~~~bash
npm test -- --run src/renderer/pages/execution-display.test.ts
npm run typecheck
npm run build
npm run test:e2e -- tests/e2e/demo.spec.ts
~~~

- [ ] Step 8: Commit the presentation change.

~~~bash
git add src/shared/domain.ts src/renderer/pages/execution-display.ts src/renderer/pages/execution-display.test.ts src/renderer/pages/Executions.tsx tests/e2e/demo.spec.ts
git commit -m "feat(executions): surface ForgeLoop isolation provenance"
~~~

### Task 5: Refresh generated demo provenance and contract tests

**Files:**
- Modify: scripts/demo/project-builder.mjs
- Modify: scripts/__tests__/demo-project.test.mjs
- Modify: demo/.forgeloop/task-state/**/executions/exec-*.json

**Interfaces:**
- Consumes: executionRecord() helper and v1.6.1 execution schema.
- Produces: deterministic demo artifacts containing native and project-isolated verification provenance.

- [ ] Step 1: Add a generated-demo test that parses execution files from generateDemoFiles() and requires at least one NATIVE_PROJECT and one PROJECT_ISOLATED record, each with an isolation object.
- [ ] Step 2: Run node --test scripts/__tests__/demo-project.test.mjs and observe failure because the current generator has no executionIsolation field.
- [ ] Step 3: Extend executionRecord() with explicit executionKind, protocolProjectRoot, cwd, and native isolation defaults. Persist executionKind, protocolProjectRoot, cwd, executionIsolation equal to isolation.mode, and isolation.
- [ ] Step 4: Keep native verification for existing records and make at least one verification record project-isolated with a distinct protocol root and cwd. Do not fabricate isolated durable-action records.
- [ ] Step 5: Regenerate and verify the demo, inspect the diff for unrelated churn, and commit only canonical output.

~~~bash
npm run demo:generate
npm run demo:verify
node --test scripts/__tests__/demo-project.test.mjs
git add scripts/demo/project-builder.mjs scripts/__tests__/demo-project.test.mjs demo/.forgeloop
git commit -m "test(demo): exercise ForgeLoop execution provenance"
~~~

### Task 6: Update current-version documentation and references

**Files:**
- Modify: README.md
- Modify: docs/PROTOCOL_COMPATIBILITY.md
- Modify: schemas/README.md
- Modify: vendor/README.md
- Review: all current-runtime matches returned by the repository search

**Interfaces:**
- Consumes: verified package/schema identity and optional capability behavior.
- Produces: consistent current-runtime docs without rewriting historical release references or transitive dependency versions.

- [ ] Step 1: Update docs/PROTOCOL_COMPATIBILITY.md to ForgeLoop 1.6.1 at the target commit, retain protocol/schema/Integration API v1, describe persisted verification-execution provenance, and state that missing optional capability keeps protocol-v1 compatibility while disabling the feature.
- [ ] Step 2: Update README.md and schemas/README.md to say Audit reads/displays persisted isolation provenance and does not provide execution isolation. Update current stack/runtime references to 1.6.1.
- [ ] Step 3: Update vendor/README.md with source repository cassiomc1/forgeloop, exact commit, package version, and the computed archive SHA-256.
- [ ] Step 4: Review every current-runtime match without changing unrelated transitive dependency versions.

~~~bash
rg -n "1\.6\.0|1eb8088|1eb8088716e279faa746b11e3077de1fef570b69|cassiomc1-forgeloop-1\.6\.0-1eb8088" README.md docs schemas vendor package.json package-lock.json src scripts
~~~

- [ ] Step 5: Run schema/docs checks, diff check, and commit.

~~~bash
npm run protocol:schemas:verify
npm run docs:check
git diff --check
git add README.md docs schemas vendor
git commit -m "docs: document ForgeLoop 1.6.1 provenance compatibility"
~~~

### Task 7: Full verification, review, PR, merge, and local synchronization

**Files:**
- Review: complete branch diff and generated artifacts.
- Modify: only files required by a scoped verification or review finding.

**Interfaces:**
- Consumes: all completed tasks and exact main base branch.
- Produces: reviewed green PR merged at its exact head, with local main equal to origin/main and unrelated local files preserved.

- [ ] Step 1: Run the full project matrix sequentially.

~~~bash
npm run protocol:schemas:verify
npm run demo:generate
npm run demo:verify
npm run typecheck
npm run lint
npm test
npm run build
npm run verify
npm run dependency:policy
npm run test:release-contracts
npm run verify:full
npm run audit:prod
npm run test:packaged-smoke
git diff --check
~~~

Read each exit code and output before claiming a gate passes.
- [ ] Step 2: Inspect status, changed paths, and the read-only boundary. Confirm no new run-check, run-action, reconcile-closure, createForgeLoopContext, execFile, or spawn path was added to Audit, no schema was loosened, and no unrelated file is staged.
- [ ] Step 3: Request independent code review with exact base/head SHAs and the approved spec. Fix Critical and Important findings, rerun affected tests and full verification, and document Minor findings.
- [ ] Step 4: Push the branch and create one PR against main. The PR body must cover runtime/schema P0, additive capability, read-only UI, demo coverage, exact verification, and non-goals.
- [ ] Step 5: Inspect all PR checks. Queued, cancelled, missing, startup-failure, or unavailable required checks are unverified. Do not change branch protection without separate explicit authorization.

~~~bash
gh pr view <number> --json number,url,state,isDraft,headRefOid,baseRefName,statusCheckRollup,mergeStateStatus
gh pr checks <number> --watch
~~~

- [ ] Step 6: Query the exact head immediately before merging and merge with match-head-commit.

~~~bash
PR_HEAD_SHA=$(gh pr view <number> --json headRefOid --jq .headRefOid)
gh pr merge <number> --squash --match-head-commit "$PR_HEAD_SHA" --delete-branch=false
~~~

If protection prevents merge, stop and report the exact blocker rather than relaxing protection implicitly.
- [ ] Step 7: From the primary checkout, fetch and fast-forward main, then prove HEAD equals origin/main and the primary status is clean. Preserve screen/.DS_Store if it remains untracked.

~~~bash
git fetch origin main
git switch main
git merge --ff-only origin/main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
test -z "$(git status --porcelain)"
~~~

# Astra code and test audit

Review date: 2026-09-04. Reviewed revision: `fe13c597b3ba669dab93dc72d3d8e6d099dd129b` (`main`, package version `1.10.0`).

This report is for maintainers deciding what to fix, simplify, remove, and test next. It reviews the local repository, including its existing release-evidence documentation edit. No implementation or test files were changed for this audit.

## Assessment

The highest-value work is to fix several observable contract and recovery defects, reduce repeated verification work, and strengthen tests at the real integration boundaries. A broad rewrite or indiscriminate test deletion would be counterproductive.

The repository has substantial useful defensive coverage: task ownership, evidence provenance, ledger replay, stale artifacts, recovery, filesystem containment, and cross-platform behavior. Its main weaknesses are concentrated decision functions, gaps between declared and executable contracts, and tests that sometimes verify a fixture arrangement instead of the workflow a user actually runs.

There are concrete removal candidates. There is also code used only by tests that needs an explicit product decision: either connect it to a supported interface or move it out of the shipped runtime. Neither file size nor a lack of static imports alone proves that code is useless.

## Scope and method

The review combined a repository-wide tracked-file inventory with targeted reading of CLI dispatch, programmatic integration, task transactions, recovery, preflight, execution profiles, completion, policy, test helpers, package configuration, and CI workflows. Tests and documentation generators were inspected alongside their implementation.

Additional checks included import/export analysis using the already installed Acorn parser, literal dynamic-import inspection, duplicate function-body comparison, ESLint configuration inspection, public JavaScript/declaration export comparison, and temporary-directory reproductions. Dynamic imports were checked before identifying runtime-unreachable modules. No software was installed.

This is a broad, prioritized review, not a proof that every branch in every file is correct. Static reachability cannot establish whether an external consumer imports an unsupported internal path. Runtime reproductions used macOS and Node `v26.8.1`; the configured CI matrix uses Node 20, 22, and 24.

### Repository inventory

Counts below use tracked files at the reviewed revision; line counts include comments and blank lines.

| Measure | Observed value | Interpretation |
| --- | ---: | --- |
| Tracked files | 1,915 | Repository size includes historical evidence and vendored tooling. |
| JavaScript files under `src/` | 262 | 46,154 lines; not all are runtime entry points. |
| Root `tests/*.test.js` files | 244 | 42,695 lines; these are selected by `npm test`. |
| CLI commands | 83 | Derived from `CLI_COMMAND_DEFINITIONS`. |
| Shipped schemas | 49 | Explicit schema inventory exists. |
| Tracked benchmark files | 664 | About 1.83 MB of file contents; many are evidence records. |
| Tracked vendor files | 155 | About 5.93 MB of file contents. |
| Lint result | 0 errors, 114 warnings | Complexity warnings are advisory rather than a passing quality score. |

Sources: [package.json](package.json), [CLI definitions](src/core/cli-command-definitions.js), [test runner](scripts/run-tests.js), [schema inventory](src/core/schema-validation.js), and `git ls-files` with file/line counts.

## Prioritized findings

Priority meanings: **P1** can place data in the wrong project under the stated trigger; **P2** affects correctness, verification confidence, or recurring engineering cost; **P3** is bounded cleanup. “Confirmed” means observed in code and, where specified, reproduced. “Candidate” means the recommendation still requires a compatibility or cost decision.

| ID | Priority | Finding | Evidence strength |
| --- | --- | --- | --- |
| A01 | P1 | Nested transactions can reuse another project's transaction | Reproduced with two temporary projects |
| A02 | P2 | Execution-profile selection misreads structured and negated requirements | Reproduced through the exported resolver |
| A03 | P2 | Successful rollback remains an unrecoverable doctor error | Reproduced through recovery and doctor |
| A04 | P2 | Published TypeScript declarations disagree with runtime exports | Direct export comparison |
| A05 | P2 | Documented preflight recovery omits a required checkpoint step | Observed during this audit; test bypass identified |
| A06 | P2 | Lint omits MCP implementation and JavaScript runners | Effective ESLint configuration inspected |
| A07 | P2 | CI audit has no source for ignored task receipts | Tracked files and workflow inspected |
| A08 | P2 | CI repeats full suites on overlapping configurations | Workflow matrix and runner inspected |
| A09 | P2 | Lifecycle decisions remain concentrated in very large functions | AST sizes, lint results, and code review |
| A10 | P3 | Unused check and gate helpers can be removed | No repository consumers found |
| A11 | P3 | Some shipped modules serve only tests or duplicate metadata | Runtime reachability and consumers checked |
| A12 | P3 | Decision tests repeat identical inputs under different titles | Exact input and assertion comparison |
| A13 | P3 | Some structural tests freeze names and formatting | Assertions inspected |
| A14 | P2 | A compatibility helper changes the evidence semantics of tests | Helper and callers inspected |
| A15 | P3 | Cleanup and fixture utilities have duplicate implementations | Duplicate bodies and existing helper checked |
| A16 | P2 | Root test runner drops arguments and ignores nested test files | Runner implementation inspected |
| A17 | P2 | Critical coverage gates omit central authority/lifecycle modules | Threshold list and existing tests inspected |
| A18 | P3 | Transaction history has no bounded retention path | Persistence code and local directory measured |
| A19 | P2 | MCP verification dependencies are resolved without a committed lockfile | Setup script and ignore rules inspected |

### A01 — Bind nested transactions to the project as well as the task

**Location:** [transaction.js](src/core/transaction.js#L103), especially the active-transaction reuse branch at lines 107–113 and the transaction object created below it.

`withTaskTransaction` reuses its `AsyncLocalStorage` transaction when the task IDs match. It does not compare the requested target with the active transaction's target. The transaction object contains the task ID but no project identity, and its file operations close over the outer target.

**Reproduction:** open an outer transaction for project A with task ID `shared-id`; inside its callback open a transaction for project B with the same ID; call the inner transaction's `stageText("probe.txt", ...)`. The file appears in A. Reading it in B returns `ENOENT`.

**Impact:** a shared-process host that nests operations across projects can write to the wrong repository and reuse the wrong locking context. This probe establishes the defect in the transaction primitive; it does not establish that ordinary single-target CLI calls trigger it.

**Recommended fix:** bind transaction identity to the canonical target and task ID, and reject cross-target nesting before invoking the inner callback. Check how symlink aliases of the same project should normalize. Preserve legal same-project nesting.

**Missing regression:** two projects with the same task ID must never share a transaction; neither project should receive an unintended write. Existing [transaction tests](tests/transaction.test.js#L13) cover same-task reuse and different-task rejection, but not same-task cross-project nesting.

### A02 — Replace lossy contract text scanning with normalized requirement signals

**Location:** [execution-profile.js](src/core/execution-profile.js#L56), especially `contractSignals` at lines 67–89.

The resolver joins `successCriteria` directly into text. The contract schema permits structured requirement objects, which become `[object Object]` when joined. It also scans constraints for risk words without distinguishing a prohibition from a required action.

**Observed results for a documentation route:**

| Contract fragment | Resolved profile |
| --- | --- |
| `constraints: ["No publication"]` | `full`, reason `RISK_PUBLICATION` |
| `successCriteria: ["Publish documentation"]` | `full` |
| `successCriteria: [{ id: "publish", text: "Publish documentation", type: "PUBLICATION" }]` | `light` |

The first case also occurred in this audit's local-only contract. These are both unnecessary overhead and inconsistent risk classification. Execution profiles are separate from authority and completion checks: this finding does **not** prove a publication-authorization bypass.

**Recommended fix:** normalize string and object requirements, traverse nested requirements, and use declared requirement types and route risks for the safety floor. Keep exclusions separate from affirmative requirements. Avoid expanding the regular expressions into a larger informal language parser.

**Missing regressions:** equivalent string/object requirements; nested `ALL` requirements; explicit publication versus prohibited publication; conflicts between declared risks and exclusions. Existing [profile tests](tests/execution-profile.test.js) test explicit route risks, but do not catch these equivalence failures.

### A03 — A recovered transaction should stop appearing as incomplete

**Locations:** [transaction.js](src/core/transaction.js#L27) and [doctor.js](src/commands/doctor.js#L117).

`findIncompleteTransactions` treats every status other than `COMMITTED` as incomplete. Successful recovery writes `ROLLED_BACK`. `recoverIncompleteTransactions` only processes `COMMITTING`, so subsequent `doctor --fix` calls cannot settle the resulting error.

**Reproduction:** recover a temporary `COMMITTING` manifest with an empty write list. Recovery reports `ROLLED_BACK`. A fresh incomplete-transaction query still returns that manifest, and doctor reports `E_TRANSACTION_INCOMPLETE` with advice to run `doctor --fix` again.

**Recommended fix:** define successful rollback as a terminal recovered state, retain its history, and rebuild doctor findings after recovery. Distinguish a failed staging callback with no published writes from a partially published transaction requiring recovery.

**Test weakness:** [doctor-transaction.test.js](tests/doctor-transaction.test.js#L10) checks that `TRANSACTION_RECOVERED` appears. It does not check that a subsequent doctor invocation is free of that transaction error. Extend the existing test rather than adding another shallow status test.

### A04 — Fix the public JavaScript/TypeScript export contract

**Locations:** [integration.d.ts](src/integration.d.ts#L233), [integration.js](src/integration.js), and the `./integration` export in [package.json](package.json).

The declaration file advertises `FORGELOOP_INTEGRATION_RUNTIME_VERSION`, but the JavaScript module only imports that name internally and exports `FORGELOOP_INTEGRATION_API_VERSION`. A consumer can rely on a declared named export that is absent at runtime.

The opposite mismatch also exists: runtime exports lack declarations for:

- `E_VERIFICATION_EXECUTION_INVALID`;
- `E_VERIFICATION_ISOLATION_UNAVAILABLE`;
- `createStructuralQualityProviderRegistry`;
- `resolveStructuralQualityProvider`.

**Recommended fix:** reconcile the intended public API, then add a declaration/runtime parity check and a small TypeScript consumer fixture. Prefer command-specific input/result types over a permanently broad `[key: string]: unknown` interface when evolving the API; introduce stronger types incrementally.

**Why existing tests miss it:** [package.test.js](tests/package.test.js#L191) checks that the declaration path is advertised and verifies selected runtime names. It does not compile a consumer or compare the complete declared value-export surface. No TypeScript compiler check was found in the inspected scripts/workflows. No compiler was installed during this audit.

### A05 — Make preflight recovery executable from the documented state

**Locations:** [troubleshooting recovery instructions](docs/TROUBLESHOOTING.md#L201), [preflight.js](src/core/preflight.js#L103), and [preflight-reactivation.test.js](tests/preflight-reactivation.test.js#L100).

During preparation, correcting a contract source reference after blocked preflight and rerunning `route` followed by `preflight` produced `E_CONTRACT_STALE`. The documented route/preflight sequence alone did not repair the existing checkpoint. `next` reported `RESOLVE_BLOCKER` without an executable recovery command.

Using the documented CLI-owned `clear-state` checkpoint-recreation mechanism, then preflight, restored `READY` for this task before execution. The event history was preserved. This should be a clearly bounded recovery path, not something a user has to infer from another paragraph.

**Test weakness:** the reactivation test appends a blocked event and directly unlinks `work-state.json` before asserting readiness. This is useful as a low-level fixture, but it does not establish that the advertised user-facing recovery sequence works.

**Recommended fix:** define a supported pre-execution contract-refresh operation or return precise maintenance guidance with its preconditions. Add a CLI/integration test that starts from a real blocked preflight, edits the agent-owned contract, and follows exactly the returned recovery actions without direct state-file edits.

### A06 — Extend lint to the implementation that currently receives zero rules

**Location:** [eslint.config.js](eslint.config.js#L25).

The rules apply to `src/**/*.js`, `scripts/**/*.mjs`, and `tests/**/*.js`. They omit `scripts/*.js` and the separate MCP implementation.

Calling the installed ESLint API's `calculateConfigForFile` confirmed **zero configured rules** for:

- [scripts/run-tests.js](scripts/run-tests.js);
- [scripts/run-docs-check.js](scripts/run-docs-check.js);
- [integrations/mcp/src/server.js](integrations/mcp/src/server.js).

By comparison, `src/cli.js` and `scripts/benchmark-cli-startup.mjs` receive 24 rules. Running `eslint .` successfully therefore does not establish comparable lint coverage across the repository.

**Recommended fix:** explicitly include the JavaScript runners and MCP source/bin/tests, with the appropriate globals. Retain intentional fixture/vendor exclusions. Verify the effective configuration in a small configuration test so future directory additions do not silently fall outside the rules.

### A07 — Give the CI receipt audit an actual evidence input

**Locations:** [forgeloop-audit.yml](.github/workflows/forgeloop-audit.yml#L26) and [.gitignore](.gitignore#L12).

The workflow only audits receipts already present in the checkout. Task state is ignored, and the tracked-file inventory contains no execution receipt. The workflow has no step producing or downloading a task-bound receipt bundle.

Consequently, a normal clean source checkout has no receipt for either conditional audit invocation. A successful workflow status, if obtained, cannot by itself demonstrate that task completion was audited. This is a workflow-source finding; live GitHub run status was not inspected.

**Recommended fix:** choose an explicit contract: ingest a bounded, validated evidence artifact tied to the reviewed revision, or report that no receipt is available. Do not describe a skipped receipt audit as verified completion. If multiple receipts are supported, enumerate tasks and audit with explicit task IDs rather than relying on ambient task selection.

### A08 — Eliminate overlapping full-suite executions before cutting useful tests

**Historical locations:** the former `docs-quality.yml` workflow, [windows-full-suite.yml](.github/workflows/windows-full-suite.yml), [package.test.js](tests/package.test.js), and [run-tests.js](scripts/run-tests.js). The current PR boundary is defined by [pr-core.yml](.github/workflows/pr-core.yml), with documentation-only validation in [docs.yml](.github/workflows/docs.yml).

Before the CI minimization, the docs workflow ran three full suite equivalents in `validate` (Node 20, 22, and Node 24 with coverage) and six more in `cli-portability` (three operating systems × Node 20/24). That was **nine full core-suite executions**, including overlapping Ubuntu Node 20/24 combinations.

Each `npm test` already includes `tests/package.test.js`; these matrix jobs then run `pack:check` again. Within `package.test.js`, two tests independently execute `npm pack --dry-run --json`. Some repetition proves different things, but these repeated same-checkout listings can share one listing.

**Recommended fix:** retain one full job per supported OS/version combination, place coverage on the existing Linux Node 24 job, and run runtime-independent documentation/validator checks once where sufficient. Reuse the package listing within its suite. Keep tarball installation smoke distinct: installed-package behavior is different from a file-list assertion.

**Expected value:** lower CI compute and queue pressure. No exact time or monetary saving is claimed because CI timings were not measured. Preserve Windows/Linux/macOS coverage when simplifying the matrix.

### A09 — Split policy decisions by responsibility, not by line-count targets

**Measured hotspots:**

| Function | Location | Physical lines | ESLint complexity |
| --- | --- | ---: | ---: |
| `resolveNextActionPhase` | [next-action-phases.js](src/core/next-action-phases.js#L56) | 1,004 | 148 |
| `evaluateCompletion` | [completion.js](src/core/completion.js#L276) | 357 | 161 |
| `migrateLegacyLayout` | [task-migration.js](src/core/task-migration.js#L70) | 315 | 51 |
| `evaluateTargetPolicy` | [policy-engine.js](src/core/policy-engine.js#L374) | 267 | 45 |
| `evaluateStructuralQuality` | [structural-quality/service.js](src/core/structural-quality/service.js#L531) | 267 | 37 |

These functions combine several decisions and error/recovery paths. The project has already introduced useful facades, but moving a large function into a differently named file does not reduce its reasoning burden.

**Recommended fix:** start with phase-specific next-action resolvers and shared typed/structured outcomes for recovery guidance. Extract pure decisions from artifact loading and mutation. Preserve ordering explicitly: changing which blocker wins can change user-visible behavior. Refactor one behavior family at a time with characterization and negative tests.

The 1,351-line command-definition table and 1,337-line error-code catalog are mostly declarative data; their size is not equivalent to a 1,004-line branching function. Do not split those solely to improve a metric. The 114 lint warnings should become a maintained baseline or ratchet, not a reason to disable the rule or rewrite the whole runtime.

### A10 — Remove genuinely unused internal helpers

**Confirmed repository-level candidates:**

| Candidate | Evidence | Suggested action |
| --- | --- | --- |
| `requiredChecksSatisfied`, `requiredChecksSatisfiedForRequirements`, and private `requiredChecksSatisfiedBy` | [checks.js](src/core/checks.js#L138); symbol searches found only these definitions/internal calls | Remove the unused block after confirming no supported external import commitment. |
| `requiredGatePaths` | [gates.js](src/core/gates.js#L55); no consumers found | Remove this unused export. |

These names are not re-exported by `src/integration.js`. The first block is about 32 lines of inactive alternative check-selection logic, so removing it also avoids maintaining a second interpretation of evidence satisfaction.

Do not infer that all of `checks.js` is unused: its validation functions have real consumers. Do not delete public exports merely because the repository itself does not call them.

### A11 — Resolve test-only runtime modules and redundant CLI metadata

Literal import/re-export/dynamic-import analysis, followed by repository symbol searches, found four `src/` modules with no production caller from the CLI, integration, commands, or scripts:

- [cli-metadata.js](src/core/cli-metadata.js): constructs a projection of `CLI_COMMAND_DEFINITIONS`, consumed by a documentation-conformance test;
- [decision-classification.js](src/core/decision-classification.js): consumed by its tests and the next module;
- [workflow-compatibility.js](src/core/workflow-compatibility.js): consumed by its tests;
- [gates.js](src/core/gates.js): `createGate` is used by test setup; `requiredGatePaths` has no caller.

**Recommended decision:** keep useful fixture builders under test helpers unless they are an intentionally supported API. For decision/workflow classification, either expose and integrate a supported advisory feature with real consumers, or stop shipping the unused implementation and keep the normative policy/examples where they belong. Moving helpers requires updating imports; this is not a recommendation to delete their tests without preserving their purpose.

For CLI metadata, use the actual definition source in the existing test or make a real shared projection if one is needed. The module's comment still says “all 43” commands although the current table contains 83. [DOCUMENTATION_GUIDE.md](docs/DOCUMENTATION_GUIDE.md#L122) also identifies this unused projection as the command authority. Correct that source map.

**False positives deliberately excluded:** action readiness, action ledger projection, and the Sentrux adapter are loaded through dynamic imports and have real runtime consumers. They are not dead code.

### A12 — Consolidate identical decision-test inputs

**Location:** [decision-classification.test.js](tests/decision-classification.test.js#L10).

Seven non-blocking test rows all pass exactly `{ local: true, reversible: true }` to the same function and make the same assertions. Their titles describe different business examples, but those descriptions are never input to the classifier. Six rows therefore add no distinct executable behavior coverage.

The blocking table also repeats `{ realBusinessFact: true }` three times and `{ external: true }` twice with the same expected outputs. Different flags such as `external` and `authoritative` remain distinct cases and should stay covered.

**Recommended fix:** one row per distinct input/output behavior. Keep business examples in documentation, or test an actual mapping from those inputs if such a feature is implemented. Add cases that exercise different behavior: malformed flags, `local: false`, `irreversible: true`, and precedence when multiple blocking flags are true.

This is a concrete redundant-test finding, not an argument that testing decision policy is unnecessary. The larger product-reachability question is A11.

### A13 — Replace implementation-shape assertions where they do not protect a contract

**Locations:** [core-module-boundaries.test.js](tests/core-module-boundaries.test.js#L24) and [package.test.js](tests/package.test.js#L161).

Two boundary tests only check that particular internal filenames exist. A file can exist while every responsibility remains in one large function. These tests add rename friction without demonstrating the stated responsibility boundaries.

Several workflow tests match exact action SHAs and YAML formatting. A secure pinned action upgrade or a semantically equivalent matrix format can fail those assertions, while an incorrectly conditioned step can still contain the expected text.

**Recommended fix:** test prohibited dependency edges and stable facade exports where those are actual contracts; inspect workflow semantics for required versions, pins, and commands instead of hard-coding incidental formatting. Keep the existing Sentrux import-boundary check: it enforces a meaningful dependency rule, although computed imports would need separate handling.

The CLI dispatch-table test is not automatically useless: uniqueness and missing-handler checks protect real dispatch invariants. Its derived-list equality contributes less independent evidence, but deleting the whole test would lose useful checks.

### A14 — Make manual versus executed test evidence explicit

**Location:** [record-check-compat.js](tests/helpers/record-check-compat.js#L19), used by multiple lifecycle test files, including [next-action.test.js](tests/next-action.test.js#L16).

The compatibility helper silently converts some `kind: "command"` checks into `manual-review`. For installation-looking command text, it creates a fake local executable that exits successfully and records that synthetic execution.

This is understandable migration support, but it means a green test whose fixture mentions an executed command may actually exercise manual evidence or a fake command. It cannot establish the behavior of the real execution/provenance boundary.

**Recommended fix:** replace implicit conversion at call sites with clearly named manual-evidence and executed-evidence fixture helpers. Keep fake binaries for deterministic process-boundary tests, but make their role explicit. Migrate in small groups and retain direct [run-check tests](tests/run-check.test.js), [verification-capability tests](tests/verification-capability.test.js), and [integration authority tests](tests/integration-authority-context.test.js).

Do not mechanically remove this helper first: that could invalidate many fixtures without improving the intended behavioral coverage.

### A15 — Reuse existing test cleanup utilities

**Locations:** `rimrafWithRetry` in [completion-recovery-rebind.test.js](tests/completion-recovery-rebind.test.js#L23), [preflight-reactivation.test.js](tests/preflight-reactivation.test.js#L19), and [receipt-epoch.test.js](tests/receipt-epoch.test.js#L21); existing [rm-safe.js](tests/helpers/rm-safe.js).

The three cleanup functions have identical bodies, while the repository already contains a centralized Windows-tolerant removal helper. This creates multiple retry policies to maintain.

Other exact duplicates include argument parsers in the benchmark reporting scripts and small CLI-spawn helpers. The latter are less urgent; a six-line error constructor duplicated across domains may be clearer than a new dependency shared everywhere.

**Recommended fix:** compare teardown semantics and use the existing cleanup helper where equivalent. Reuse minimal fixture builders for repeated lifecycle setup, with explicit options for the boundary each test needs. Avoid a single huge fixture function that hides authority, phase, or evidence assumptions.

### A16 — Make the test runner support focused work and safe discovery

**Location:** [run-tests.js](scripts/run-tests.js#L12).

The runner only reads immediate children of `tests/` and launches all `.test.js` files it finds. It never forwards `process.argv.slice(2)` to Node. Thus `npm test -- --test-name-pattern=...` cannot narrow the test run, and moving tests into subdirectories would silently drop them from this entry point.

The repository's separate MCP and PoC suites are intentional separate entry points; they should not be mistaken for missing core tests. The problem is that the main runner's selection/argument contract is implicit.

**Recommended fix:** document and validate supported filtering arguments, fail on unsupported selectors instead of ignoring them, and either support recursive discovery with fixture exclusions or explicitly enforce the flat layout. A future directory reorganization needs a test that proves every intended test file is selected.

Useful immediate focused checks remain possible through direct `node --test <file>` and the existing `test:quick` script.

### A17 — Expand critical verification by behavior and risk

**Location:** [check-critical-coverage.mjs](scripts/check-critical-coverage.mjs#L10).

The explicit critical coverage list contains five modules: repository, policy discovery, policy adapters, task identity, and task migration validation. It omits central completion, transaction, phase, action authorization/readiness, and command-execution modules.

Those modules do have tests; absence from the threshold list does not mean zero coverage. Global coverage thresholds also exist. The weakness is that a broad percentage can hide a weak assertion or a local drop in precisely the code that owns completion and writes.

**Recommended fix:** measure a fresh supported-runtime baseline, then add targeted module/branch safeguards where justified. Add fault-injection and mutation cases for A01–A05 before chasing a higher global percentage. Preserve existing adversarial artifact-mutation tests and policy checker `rule-verify` fixtures; a broad source-mutation effectiveness gate is a separate capability and was not found in the inspected package scripts/workflows.

An existing `coverage/coverage-summary.json` predates this audit. Its percentages are deliberately not reported as current verification.

### A18 — Bound retained transaction staging and backup data

**Locations:** [transaction.js](src/core/transaction.js#L116) and its successful commit branch at line 260.

Every transaction creates a directory under `.forgeloop/.txn`. The successful path writes `COMMITTED` and returns without removing staging, append payloads, or backup files. Discovery reads every transaction manifest.

At the inspection point, this checkout retained 119 transaction manifests: 101 `COMMITTED` and 18 `ABANDONED`, with about 0.78 MB of files under `.txn`. These counts include preparation performed during this audit and are a local snapshot, not a growth-rate benchmark.

**Recommended fix:** define a bounded retention/compaction policy for terminal transaction payloads, preserving the canonical event ledger and recovery evidence. Add a supported maintenance operation with safe treatment of active, ambiguous, and failed transactions. Measure discovery cost at larger histories before changing its indexing strategy. Do not manually delete recovery directories as part of a general cleanup.

### A19 — Make MCP verification dependency resolution reproducible

**Locations:** [mcp-setup.mjs](scripts/mcp-setup.mjs#L17), [MCP package manifest](integrations/mcp/package.json), [.gitignore](.gitignore#L15), and [package-smoke.yml](.github/workflows/package-smoke.yml#L29).

The setup script installs the local core tarball plus MCP server/client packages using `^2.0.0` ranges. The MCP lockfile is explicitly ignored, and the client package is supplied by the setup command rather than declared as a test dependency in its package manifest.

Two clean CI runs can therefore test different resolved dependency graphs without a repository change. The core package's locked, minimal toolchain does not extend to this separate verification setup.

**Recommended fix:** declare test dependencies and adopt a reproducible locked setup while retaining the local-core tarball smoke. Record the resolved core/server/client identities with the verification output. Dependency updates should be explicit changes with the existing transport/parity tests.

The MCP dependencies were absent locally during this audit. MCP transport tests were not run and nothing was installed. Existing CI does contain separate MCP tests, so this report does not claim that MCP has no automated coverage.

## Tests and code that should stay

The following are valuable, even when they make the repository larger:

- Task conflict, lock, claim, and recovery tests: different invalid ownership states are not interchangeable. See [task-claim-ownership-integration.test.js](tests/task-claim-ownership-integration.test.js) and [task-lock.test.js](tests/task-lock.test.js).
- Completion freshness, receipt binding, evidence provenance, and negative authorization tests: these protect the product's core promise. See [completion-claim-ownership.test.js](tests/completion-claim-ownership.test.js), [receipt-epoch.test.js](tests/receipt-epoch.test.js), and [action-ledger-replay.test.js](tests/action-ledger-replay.test.js).
- CLI versus structured-integration parity and task-context propagation: adapters can fail even when the core function passes. See [cli-parser-parity.test.js](tests/cli-parser-parity.test.js) and [integration-context-propagation.test.js](tests/integration-context-propagation.test.js).
- Real package installation smoke, platform-specific filesystem tests, schema inventory, and generated-document freshness: they observe deployment artifacts and compatibility surfaces that unit tests cannot.
- Dynamic provider adapters, legacy layout migration fixtures, and the source-kit `PROJECT_PROFILE.md` template: these have explicit compatibility or distribution purposes. The template is intentionally uninitialized in this repository.
- Historical benchmark evidence, PoC artifacts, and pinned vendored diagram tooling: keep traceability and integrity unless their consumers are deliberately retired. Historical benchmark measurements are already excluded from the core tarball; removing them will not automatically shrink that package.

## Missing or stronger tests, in implementation order

| Priority | Test to add or strengthen | Observable oracle |
| --- | --- | --- |
| First | Same task ID nested across two projects | Reject before any wrong-project write or lock reuse. |
| First | Complete transaction recovery followed by a fresh doctor run | Recovered transaction is terminal and no longer reported as incomplete. |
| First | String/object/nested requirement equivalence | Same declared obligation produces the same safety floor. |
| First | TypeScript named imports from the packed integration API | Every declared runtime value exists; actual imports compile and execute. |
| Next | Blocked preflight recovery through public commands | Follow `next`/documented actions to `READY` with no manual lifecycle edits. |
| Next | CI audit with absent, one, and multiple receipt inputs | Explicit unverified result or actual task-bound validation, never an ambiguous skip. |
| Next | Lint and test selection inventory | New implementation/test directories cannot fall outside the gates silently. |
| Next | Critical mutation/fault probes | A wrong project binding, inverted completion condition, or invalid receipt causes a failing behavioral check. |
| Later | Large task/transaction history | Measure `next`, `doctor`, and discovery latency and retained bytes at fixed dataset sizes. |
| Later | Controlled real-provider interoperability lane | Keep fake-provider determinism and separately verify the supported real provider/version. |

The real Sentrux test already exists in [real-sentrux-structural-quality.test.js](tests/real-sentrux-structural-quality.test.js#L22). It conditionally skips when the binary is unavailable and asserts version `0.5.7` when present. A dedicated lane should make the required provider/version explicit; a generic suite passing with that test skipped is not real-provider verification.

In this local run, that real Sentrux test **passed** as part of the 1,515-test suite. Its presence and result are strengths, not missing coverage.

## Suggested delivery sequence

1. **Correctness fixes:** A01, A03, and A04, each with a failing reproduction that becomes green. Keep changes separate enough to review project isolation, recovery semantics, and public API compatibility independently.
2. **Contract and recovery behavior:** A02 and A05. Normalize requirement semantics and make recovery guidance executable. Update documentation with the actual tested sequence.
3. **Verification reliability:** A06, A07, A16, A17, and A19. Close gate-selection holes and dependency nondeterminism before expanding suite size.
4. **Reduce recurring cost:** A08, A12, A13, and A15. Preserve distinct behavioral or platform coverage while removing repeated work and incidental assertions.
5. **Bounded cleanup:** A10 and A11 after checking public/internal compatibility. Do not publish a broad API deletion as a cosmetic refactor.
6. **Incremental architecture and storage work:** A09, A14, and A18. Start with one decision family and one explicit fixture category; measure before widening scope.

No time estimate is assigned without measuring the chosen change and its required matrix. Success should mean fewer defects and less repeated work while retaining the important failure-detection ability, not a target file count or test count.

## Reproduction examples

Run these from the repository root. The first example only uses its own temporary projects and removes them afterward. The second performs read-only resolver/API inspection. These examples demonstrate the reported behavior; they are not proposed fixes.

### Wrong-project nested transaction

```bash
node --input-type=module <<'JS'
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withTaskTransaction } from './src/core/transaction.js';

const a = await mkdtemp(path.join(tmpdir(), 'astra-project-a-'));
const b = await mkdtemp(path.join(tmpdir(), 'astra-project-b-'));
try {
  await withTaskTransaction({ target: a, taskId: 'same-id' }, async () => {
    await withTaskTransaction({ target: b, taskId: 'same-id' }, async (tx) => {
      await tx.stageText('probe.txt', 'intended for project B');
    });
  });
  console.log('A:', await readFile(path.join(a, 'probe.txt'), 'utf8'));
  console.log('B:', await readFile(path.join(b, 'probe.txt'), 'utf8')
    .catch((error) => error.code));
} finally {
  await rm(a, { recursive: true, force: true });
  await rm(b, { recursive: true, force: true });
}
JS
```

Observed on the reviewed revision: A contains `intended for project B`; B returns `ENOENT`.

### Profile equivalence and declared export

```bash
node --input-type=module <<'JS'
import { resolveExecutionProfile } from './src/core/execution-profile.js';
import * as integration from './src/integration.js';

for (const contract of [
  { constraints: ['No publication'] },
  { successCriteria: ['Publish documentation'] },
  { successCriteria: [
    { id: 'publish', text: 'Publish documentation', type: 'PUBLICATION' },
  ] },
]) {
  console.log(resolveExecutionProfile({
    routeInput: { workType: 'documentation' }, contract,
  }).resolved);
}
console.log('Declared runtime version exported:',
  'FORGELOOP_INTEGRATION_RUNTIME_VERSION' in integration);
JS
```

Observed outputs: `full`, `full`, `light`, and `false`.

## Verification record and limitations

The final observed command results are recorded below before delivery. Temporary probe code only created and removed its own temporary directories. The existing release-evidence edit was preserved.

| Check | Result |
| --- | --- |
| `npm run lint` | Passed with 0 errors and 114 complexity warnings. |
| `npm test` | Passed: 1,515 tests, 0 failures, 0 skips; Node runner duration 512,962 ms (about 8 min 33 sec). Includes the real Sentrux 0.5.7 integration test. |
| `npm run docs:generated:check` | Passed; generated regions match canonical definitions. |
| `npm run docs:conformance` | Passed: 31 artifacts, 83 commands, 275 error codes, 4 discovery adapters. |
| `npm run docs:check` | Passed: diagram verification, inventory, generated references/summary, conformance, 7 executable examples, documentation manifest, and review matrix. |
| Temporary transaction/profile/export/lint probes | Confirmed A01–A04 and A06 as described above. |
| Report links, source locations, Markdown, and whitespace | Checked with the repository Markdown validator and a report-specific reference/line-range check; final whitespace check included the untracked report. |
| Initial `git diff --no-index --check /dev/null astra.md` | Returned 1 with no diagnostics; treated as a failed verification command, then replaced with explicit whitespace assertions for the untracked file. No content defect was found. |
| Fresh instrumented coverage and TypeScript compilation | Not run; historical coverage was not treated as current. |
| MCP transport tests | Not run: local MCP prerequisites absent. |
| Linux/Windows execution and live GitHub CI | Not run/queried in this local review. |
| Publication | Local report only; no commit, PR, merge, package publication, or deployment. |

Protocol scope: `astra-code-audit-20260904`, write claim `astra.md`, guides `clean`, `test`, and `documentation`. Structural-quality provider mode was `off`; no provider-backed structural score is claimed. Report completion is separate from fixing the findings listed here.

# ForgeLoop GitHub CI Minimization Validation

This report records the CI refactor against the exact baseline
`c93e42f1bbc056ed705adf64abf7c34bf36dd37b` (`origin/main` at implementation
start). The package version in that baseline is `1.11.0`.

## Baseline observed

- PR #162 was the latest merged validation sample: 20 check runs across six
  workflows, with all checks successful at exact head
  `6b6ef85329e7b39f5dbda3156995b2e7f8a214a7`.
- The old PR workflow executed nine full core-suite equivalents in its docs
  quality matrix and repeated package, documentation, Python, and link gates.
- The old docs-quality workflow used 52.45 runner-minutes and an 18.85-minute
  wall-clock duration in the observed PR sample. Billing cost was not
  available.
- The active `main-protection` ruleset is id `21693301`. Its required contexts
  are exactly `audit`, `CodeQL`, `Verify generated Archify diagram`,
  `validate (22)`, `tarball smoke (ubuntu-latest)`, and `dependency-review`.

## Changed workflows

- Added `.github/workflows/pr-core.yml` as the path-aware pull-request
  boundary.
- Added `.github/workflows/docs.yml` for main-branch documentation validation.
- Added `.github/workflows/node-compat.yml` for main-branch Node compatibility,
  with an explicit expanded cross-platform dispatch.
- Converted `repository-index.yml` into a reusable workflow while retaining its
  Linux/macOS/Windows native matrix.
- Reduced `package-smoke.yml` to Ubuntu on relevant PRs and an explicit
  macOS/Windows release matrix.
- Narrowed `forgeloop-audit.yml` to main/manual execution with path-aware
  receipt auditing.
- Reduced `windows-full-suite.yml` to its independent Windows full Node suite.
- Removed the duplicated PR-oriented `docs-quality.yml` workflow.

All action references remain immutable commit SHAs. Checkouts retain
`persist-credentials: false`, job timeouts remain bounded, and workflow
permissions remain read-only except for the pre-existing release OIDC publish
permission.

## New local validation scripts

- `scripts/ci-classify.mjs` classifies changed paths without shell evaluation,
  includes added, copied, modified, renamed, and deleted paths, and supports
  explicit GitHub output variables.
- `scripts/ci-scenario-check.mjs` exercises the five required path scenarios.
- `scripts/run-validation.mjs` exposes `verify:fast`, `verify:local`,
  `verify:prepush`, and `verify:release` with portable `npm`/Python launchers,
  literal argument vectors, and no implicit installation.
- Release identity is never guessed. The release tier reports
  `NOT_VERIFIED` until `FORGELOOP_RELEASE_VERSION` and
  `FORGELOOP_RELEASE_COMMIT` are supplied, then invokes the canonical
  identity validator with those exact values.

## Local validation evidence

| Validation | Result |
| --- | --- |
| `npm run verify:fast` | PASS: 70 quick tests, lint, dependency policy, generated docs |
| Focused workflow/classifier/package tests | PASS: 28 tests |
| `node scripts/ci-scenario-check.mjs` | PASS: README-only, ordinary JavaScript, Repository Index, package export, release |
| `npm test` through coverage | PASS: 1,613 passed, 0 failed, 10 native skips |
| `npm run verify:prepush` | PASS on the final worktree; coverage and all local pre-push gates completed |
| Coverage | PASS: lines/statements 85.63%, functions 83.78%, branches 76.19% |
| `npm run docs:check` | PASS: diagrams, inventory, generated docs, conformance, examples, manifests, review matrix |
| `npm run docs:diagrams:check` | PASS: three Archify diagrams |
| Frozen Python/Markdown/loop validators and text scanner | PASS: 50 Python tests; all validators pass |
| `npm run pack:check` | PASS: 9 package checks |
| `npm run pack:smoke` | PASS: packed `@cassiomc1/forgeloop@1.11.0` smoke |
| `npm pack --dry-run --json` | PASS: 462 files; runtime, Repository Index, integration, MCP, and docs surfaces present |
| YAML parsing for every workflow | PASS |
| `npm run performance:check` | PASS: CLI startup median 98.5 ms against a 1,000 ms budget |
| Benchmark profile schema check | PASS: three run sets valid |
| Benchmark regression check | PASS command; reports a non-blocking observational `EFFICIENCY_REGRESSION` |
| Benchmark outlier/tail reports | PASS command; existing tail observations remain diagnostic, not a release failure |
| `actionlint` | NOT_VERIFIED: tool is not installed; no tool was installed solely for this check |
| Exact-head PR #163 checks at `8092a7ad1033117674519fffb869355d44ae0ebe` | PASS: all 15 check runs completed successfully |

The first local full-tier attempt caught the repository's frozen 45-line
adapter-instruction policy after documentation edits. The documentation was
compacted without changing the policy, the final frozen Python suite passed,
and the final `verify:prepush` run passed. No source test was weakened or
converted to non-blocking behavior.

The actual release identity command is intentionally not claimed here: this
CI refactor does not create a release tag or publish a registry version, and
the canonical validator requires the exact post-publication inputs.

The first pushed candidate head `dcbc31766a4915a2f7cc97a243b5585e61b17988`
failed only because Lychee correctly found the new `docs.yml` badge was not
yet present on `main`. The badge was removed, the replacement head
`7a48afcefc671a0e0f11ec912640929ab1c5f7ac` passed every applicable remote
check, and the final report-only head above passed the same exact-head gate.

## Conditional path logic

| Scenario | Selected behavior |
| --- | --- |
| README-only | Quick Node checks, documentation/diagram validation, required no-op contexts; no native Repository Index or package execution |
| Ordinary JavaScript | One Node 24 coverage execution, targeted Node 20 compatibility, required contexts, and only path-applicable package/audit steps |
| Repository Index | Ordinary core checks plus the reusable Linux/macOS/Windows native Repository Index matrix |
| Package export | Core and Ubuntu package/MCP smoke; `src/integration.d.ts` does not spuriously select native Repository Index CI |
| Release candidate | Explicit forced classification selects documentation, Repository Index, package, audit, compatibility, and release gates |

The required `validate (22)` job is always present and uses `always()` to
inspect all prerequisites. It requires `success` for the classifier, core,
documentation, audit, and Ubuntu package contexts. It requires the native
Repository Index workflow to succeed when classified as applicable and
requires it to be skipped otherwise. Failures, cancellations, missing results,
and unexpected skips fail the aggregator.

## Before/after CI shape

- Before: 20 observed PR check runs in the PR #162 sample, including repeated
  full suites, a three-OS package matrix, a native Repository Index matrix,
  and a six-job CLI portability matrix.
- After: the exact broad implementation PR ran 15 successful check runs: 12
  PR Core jobs, two CodeQL check runs, and one Dependency Review check. Its
  wall-clock duration was 3.65 minutes and the sum of observed job elapsed
  time was 8.7 runner-minutes; billing multipliers and rounding are not
  available. A normal source PR is designed to use seven PR-core runner jobs
  plus CodeQL and Dependency Review (nine active jobs total, excluding the
  conditional native workflow). A Repository Index PR adds the reusable
  classifier, manifest, and three native jobs.
- Against the observed baseline, this exact run removed five check runs,
  15.20 wall-clock minutes, and 49.567 observed runner-minutes. The current
  implementation PR intentionally exercises the Repository Index matrix, so
  its measured count is higher than the ordinary-source design estimate.

## Security and branch-protection review

CodeQL and Dependency Review remain independent GitHub checks. The repository's
GitHub secret scanning and push protection settings were confirmed enabled.
The custom secret scanner remains in local/pre-push and release validation.
No permissions were broadened, no action was unpinned, and no native or
security check was silently made non-blocking. `validate (22)` was preserved
verbatim in the existing ruleset; no ruleset mutation is needed before the
replacement context is observed.

## Explicit answers

1. Every ordinary code PR receives one independent full clean-room test
   execution through Node 24 coverage; the exact implementation PR confirmed
   that path on its current head.
2. Coverage remains enforced by `npm run coverage` and the critical coverage
   gate.
3. CodeQL remains an independent required check.
4. Dependency Review remains an independent required check.
5. Repository Index native Linux/macOS/Windows tests remain conditional on
   Repository Index impact and are retained in the reusable workflow.
6. Windows-specific behavior remains independently validated by the main-branch
   full Windows suite and the explicit release package/compatibility matrices.
7. Cross-platform package artifacts remain release responsibilities; ordinary
   PRs use Ubuntu package smoke and the release matrix covers macOS/Windows.
8. Documentation and diagrams are validated when documentation paths change,
   and the main branch retains a documentation workflow.
9. Deterministic local checks are documented in `scripts/CI_VALIDATORS.md` and
   exposed through the four `verify:*` commands.
10. Branch protection cannot accept an applicable failed conditional gate
    because `validate (22)` fails closed; the exact PR run completed with the
    ruleset in `CLEAN` state and all six required contexts successful.
11. The historical `validate (22)` context was preserved exactly, and the
    current ruleset still lists all six original required contexts.
12. No workflow security permission became broader.
13. No test was weakened, skipped, or made non-blocking solely for speed; only
    duplicate layers were removed and targeted compatibility was separated from
    the single full-suite proof.
14. The designed normal PR shape is nine active jobs including CodeQL and
    Dependency Review; the exact broad implementation PR used 15 successful
    check runs because it also exercised the Repository Index native matrix.
15. The observed old docs-quality portion used 52.45 runner-minutes and 18.85
    minutes wall-clock. The comparable exact new run used 8.7 observed
    runner-minutes and 3.65 minutes wall-clock.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: `actionlint` is unavailable locally; benchmark profiles retain
  non-blocking observational tail/regression warnings.

PASS WITH FOLLOW-UPS

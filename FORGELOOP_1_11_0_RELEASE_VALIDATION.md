# ForgeLoop 1.11.0 Release Validation

Status: post-merge pre-publication release gate.

Verdict: PASS WITH FOLLOW-UPS

This report records the final PR #159 merge and the exact post-merge
validation performed before tagging and publication. Tag creation, the
GitHub Release, npm publication, and independent registry verification remain
explicit final gates in the authorized release sequence.

## Release identity and merge record

| Item | Observed value or classification |
| --- | --- |
| Release candidate | ForgeLoop 1.11.0 |
| Package | @cassiomc1/forgeloop@1.11.0 |
| PR | #159, merged |
| PR branch | codex/release-1.11.0 |
| PR final head before merge | 643027fb0cf32290f24b4f74f5e4b3692a341d02 |
| PR base | main |
| PR mergeability before merge | MERGEABLE; CLEAN |
| PR review state before merge | No blocking review state reported |
| PR exact-head checks | 21 check-runs, all COMPLETED/SUCCESS at the exact final head |
| Merge method | squash |
| Merge commit | 636107bd1404121b1ec7daa06d501810966b728b |
| Merge timestamp | 2026-09-09T00:16:17Z |
| Exact post-merge main validation target | 636107bd1404121b1ec7daa06d501810966b728b |
| Release tag target | The final release source commit selected after this report is finalized |
| Existing published package | @cassiomc1/forgeloop@1.10.2 |
| Published 1.11.0 identity | NOT_VERIFIED before publication; npm returned HTTP 404 for 1.11.0 |

The 1.10.2 references retained in the repository are historical release
records. Active package metadata and the 1.11.0 release documentation identify
1.11.0.

## Exact-head PR verification

PR #159 was queried immediately before merge. Its state was OPEN, its base was
main, its head branch was codex/release-1.11.0, its exact head was
643027fb0cf32290f24b4f74f5e4b3692a341d02, and GitHub reported MERGEABLE with a
CLEAN merge state. The candidate package version was 1.11.0.

The following 21 exact-head check-runs were COMPLETED/SUCCESS:

- Analyze JavaScript.
- CLI portability on macOS Node 20 and Node 24.
- CLI portability on Ubuntu Node 20 and Node 22.
- CLI portability on Windows Node 20 and Node 24.
- CodeQL.
- Native Repository Index on macOS, Ubuntu, and Windows.
- Verify Repository Index manifest.
- Verify generated Archify diagram.
- ForgeLoop audit.
- Dependency review.
- Tarball smoke on macOS, Ubuntu, and Windows.
- Validate on Node 22 and Node 24.

The required report-only follow-up PR #161 initially exposed a real Windows
portability defect in the existing safe-path code: the concurrent-ledger
test failed on Windows Node 24 while reading the shared lock because the
canonical root and child could be returned with different equivalent Windows
path spellings. The correction resolves each logical project-relative child
from the canonical root before applying the realpath containment check,
including the ancestor walk used when a concurrent lock is observed. The
affected local regression tests pass 9/9; PR #161 must be revalidated at its
new exact head before this release gate can proceed.

The final diff was restricted to the intended 1.11.0 version, lockfile,
changelog, README and architecture asset, documentation, diagrams, Repository
Index and Persistent Search Transport references, Integration API and MCP
references, security and threat-model text, the release report, and the
benchmark compatibility correction. The exact path set had 23 files, with
805 insertions and 37 deletions. Diff whitespace validation passed. No
temporary files, sockets, local state, test repositories, secrets, or
machine-specific absolute paths were found in the candidate diff.

## Documentation and architecture

Documentation validation passed after merge:

- Generated documentation check passed.
- Documentation conformance passed for 31 artifacts, 89 commands, 304 public
  error codes, and 4 discovery adapters.
- Seven examples, three governed Archify diagram sets, and the documentation
  inventory passed.
- Markdown, links, navigation, completion, summary, and changelog checks
  passed.
- No active Mermaid findings, unreferenced visual assets, or orphaned diagram
  artifacts were reported.
- No absolute machine paths were found in committed documentation.

README architecture asset:

- Reference: docs/assets/eng_readme_forgeloop.png
- Asset SHA-256:
  15844f8b153087304bbe9d1f2108b50696e6f56fe64722f913f97763636820c8
- README reference validation: PASS.
- Visual architecture validation: PASS.

The image represents the CLI, the CLI-only Persistent Search Client, local
IPC, the Persistent ForgeLoop Host, the canonical Repository Search Service,
the Repository Index, managed tgrep 1.0.3, Integration API, MCP, the protocol
lifecycle, verification/evidence, and completion. It does not imply that MCP
routes through the persistent CLI host, that Integration API requires IPC,
that Repository Index is evidence, or that tgrep is the public ForgeLoop API.

The README, DOCS_INDEX.md, CHANGELOG.md, Repository Index documentation,
Persistent Search Transport documentation, Integration API documentation, MCP
documentation, SECURITY.md, THREAT_MODEL.md, protocol and system-design
documentation, troubleshooting, diagrams, and release documentation are
synchronized with the implementation. The package documentation inventory and
internal link checks passed.

## Privacy validation

The merged-main doctor privacy probe used isolated HOME and repositories and
recursively inspected the complete JSON output in the practical non-ready
states:

| State | Result |
| --- | --- |
| ENGINE_MISSING | exit code 1; status correct; 82 findings; no absolute path leak |
| NOT_INITIALIZED | exit code 1; status correct; 82 findings; no absolute path leak |

The probe found no absolute repository path, Repository Index path, managed
binary path, HOME path, persistent-host path, socket path, or finding-evidence
path. Repository-relative paths remained acceptable. Privacy result: PASS.

## Repository Index validation

The targeted merged-main Repository Index regression suite passed with the
managed tgrep 1.0.3 binary:

- 75 passed, 0 failed, 0 skipped for the Repository Index, persistent
  transport, Integration API, and resource/runtime targeted suites.
- Managed tgrep is mandatory and pinned.
- Archive and installed-binary SHA validation passed.
- Same-version tamper rejection passed.
- PATH engine substitution and rg fallback remained rejected.
- Ownership-safe lifecycle, watcher mutation refresh, deletion refresh, and
  zero-match correctness passed.
- The public projection remained privacy-safe.
- Manifest validation passed for all four managed tgrep platform assets.

Repository Index result: PASS.

## Persistent Search Transport validation

The exact merged-main transport checks passed:

- Cold startup without a host started one persistent host and returned the
  correct search result.
- A new CLI process reused the healthy host.
- Twenty concurrent first-use searches returned correct results and created
  exactly one persistent ForgeLoop host and one repository-owned managed tgrep
  process.
- Ownership-verified test-host recovery created a new host, reused the healthy
  owned tgrep process, and returned the correct result. No unrelated process
  was killed.
- Configured idle shutdown passed.
- Mutation refresh remained correct through the transport.

Persistent Search Transport result: PASS.

## Integration API and MCP validation

The merged-main Integration API and MCP regression checks passed:

- Integration API routes to the canonical RepositorySearchService.
- MCP routes to the canonical ForgeLoop API.
- Neither surface unnecessarily routes through the persistent CLI host.
- Integration API tests passed.
- MCP tests passed 69/69.
- MCP setup and packed MCP smoke passed, including server startup and the
  expected search/resource surface.
- Public privacy behavior remained correct.

Integration API result: PASS. MCP result: PASS.

## Full post-merge validation

The exact post-merge main suite passed:

- npm ci: passed; 133 packages installed from the lockfile.
- npm test: 1,613 passed, 0 failed, 1 optional skip, 1,614 total.
- npm run coverage: passed; 1,613 passed, 0 failed, 1 optional skip.
- Global lines/statements coverage: 86.97%.
- Functions coverage: 86.23%.
- Branches coverage: 76.34%.
- Critical-module coverage gate: passed.
- Repository Index module coverage: lines/statements 86.92%, branches 93.75%,
  functions 66.90%.
- Persistent transport module coverage: lines/statements 85.96%, branches
  85.55%, functions 69.23%.
- npm run test:quick: 60/60 passed.
- npm run lint: 0 errors; 116 pre-existing complexity warnings.
- npm run dependency:policy: passed.
- npm run complexity:check: PASS with no regressions.
- npm run mcp:setup: passed.
- npm run mcp:test: 69/69 passed.
- npm run mcp:pack:check: passed.
- Python unittest suite: 50/50 passed.
- Loop-system validator: passed with 4 adapters, 10 English guides, and
  6 routing scenarios.
- Markdown validator: passed for 135 Markdown files.
- Secret scan: passed for 1,964 text files.
- Evidence verification: two evidence bundles VALID; package integrity VALID.
- Evidence tests: 67/67 passed.
- Documentation report: 46 documents, 89 commands, 304 public errors, 32
  artifacts, and 0 broken contracts.
- Pack check: 9/9 passed.
- Completion, summary, changelog, benchmark/profile/schema, generated-docs,
  conformance, examples, and diagram checks passed.

The one skipped JavaScript test is the optional real Ripwire interoperability
test, which requires an explicit test path and version configuration. It is
not a release-blocking finding.

## Package validation

Package identity validation passed:

- package.json version: 1.11.0.
- package-lock.json version: 1.11.0.
- npm pack --dry-run --json: package identity 1.11.0, 462 files, approximately
  1.32 MB packed.
- Required Persistent Search Transport runtime, Repository Index runtime,
  Integration API/types, and documentation were present.
- The separate MCP package is intentionally not embedded as
  integrations/mcp/README.md in the core tarball; its locked package smoke
  passed independently.
- pack check and pack smoke passed.
- Forbidden local lifecycle state, sockets, temporary HOME data, test
  repositories, secrets, and machine-specific paths were excluded.
- Clean local tarball consumer smoke passed with CLI version 1.11.0,
  protocol-info, doctor, Repository Index setup/status/search/zero-match,
  cold and warm persistent searches, Integration API import/status/search, and
  packed MCP surface checks.

The first local consumer attempt exposed only a harness PATH defect: limiting
PATH to the Node directory prevented the package's process-ownership probe
from resolving ps. The temporary consumer was discarded, the normal PATH was
restored, and the complete smoke passed. No package defect was found.

## Performance and resource smoke

These are workload-specific macOS arm64 observations, not universal
performance claims:

| Workload | Observed result |
| --- | --- |
| Raw managed tgrep warm path | mean 6 ms, median 6 ms, p95 7 ms |
| Direct ForgeLoop warm search | mean 6 ms, median 6 ms, p95 7 ms |
| Persistent transport warm path | mean 7 ms, median 7 ms, p95 8 ms |
| rg comparison | mean 5 ms, median 5 ms, p95 6 ms |
| Persistent cold start | 119 ms |
| Fresh CLI cold search | 235 ms |
| Fresh CLI repeated search | mean 127 ms, median 136 ms, p95 139 ms |
| Node startup component | 36 ms observed |

No material persistent-search regression was observed. Fresh CLI latency
remains dominated by Node/module startup and process creation. No universal
superiority claim over rg is made.

Formal RSS/CPU instrumentation was not measured. Practical process-count and
ownership observations showed one host and one managed tgrep process at
20-way concurrency and one healthy owned tgrep process after recovery. No
resource or lifecycle defect was observed.

## Canonical lifecycle and terminal recorder

Fresh task:

- Task: forgeloop-1-11-0-final-release-20260909.
- Contract, route, threat-boundary gate, source registry, and preflight were
  persisted through canonical ForgeLoop commands/APIs.
- Preflight returned READY.
- Activated guides: clean, test, documentation, security, performance.
- Execution profile: full.
- The task advanced through PLANNED, EXECUTING, and VERIFYING.
- The execution receipt was prepared canonically.

The task remains open before publication because its terminal publication
requirements cannot be truthfully satisfied until the tag, GitHub Release,
and npm publication are independently observed. No lifecycle state, evidence,
fingerprint, receipt, or completion artifact was edited manually.

Terminal-recorder classification: NOT_REPRODUCED. Focused tests passed 26/26.
The correct terminal-owned PUBLICATION requirement is accepted through
record-terminal-result; a premature ordinary record-check is rejected with
E_FUTURE_LIFECYCLE_EVIDENCE. The previous finding does not reproduce on the
current code and does not indicate a release-blocking evidence-integrity
defect.

## Release-gate classification

| Priority or state | Finding |
| --- | --- |
| P0 | None observed |
| P1 | None observed |
| P2 | None observed |
| P3 | Optional formal RSS/CPU instrumentation; optional real Ripwire interop configuration; development-only js-yaml advisory; future native-launcher benchmark/design |
| NOT_VERIFIED | Tag, GitHub Release, npm publication, published-package registry smoke, final release identity, and validator-backed COMPLETE remain pending until the authorized publication sequence |

The development-only js-yaml advisory was not silently remediated because it
is outside the release runtime path and no dependency-policy failure was
observed. The native launcher remains a separate future design/benchmark task;
the published package is not blocked by it.

## Pre-publication verdict

PASS WITH FOLLOW-UPS

No release-blocking P0, P1, or P2 finding remains. The non-blocking follow-ups
and the explicitly pending external publication gates are recorded as P3 or
NOT_VERIFIED. Publication may proceed only after the exact release identity,
tag collision, GitHub Release, npm authentication/version, and clean
published-artifact checks pass.

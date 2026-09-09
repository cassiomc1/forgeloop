# ForgeLoop 1.11.0 Release Validation

Status: release candidate prepared in PR #159; exact-head CI is the remaining
external delivery gate.

Verdict: PASS WITH FOLLOW-UPS

This report records the implementation and validation of the
FORGELOOP_1_11_0_DOCUMENTATION_ARCHITECTURE_AND_RELEASE_PLAN.md scope. It
does not authorize or perform npm publication, Git tagging, GitHub Release
creation, deployment, or pull-request merge.

## Release identity and baseline

| Item | Observed value or classification |
| --- | --- |
| Release candidate | ForgeLoop 1.11.0 |
| Package | @cassiomc1/forgeloop@1.11.0 in package.json and package-lock.json |
| Candidate branch | codex/release-1.11.0 |
| Candidate source commit | b46acc4bfc5be99b23c09d42876c4acd6a3a4e5c |
| Release pull request | #159, open, base main; merge commit absent |
| Exact origin/main baseline | 19b8ff622a2de3bfa29df300ebed7ac04947c4bc |
| PR #157 | Merged; f82a393c8dee859d51ede2715f2183dc0084459a; persistent search transport |
| PR #158 | Merged; 19b8ff622a2de3bfa29df300ebed7ac04947c4bc; Repository Index doctor-path privacy fix |
| CLI version probe | node src/cli.js --version returned 1.11.0 |
| Protocol probe | node src/cli.js protocol-info --json returned protocol version 1 |
| Runtime | Node.js v26.8.1, npm 11.19.0 |
| Validation platform | macOS, Darwin arm64; cross-platform behavior remains subject to CI evidence |
| Managed search engine | ForgeLoop-managed tgrep 1.0.3; manifest validation passed |
| Published release identity | NOT_VERIFIED by scope: the npm identity probe returned HTTP 404 for 1.11.0, and publication was not attempted |

The 1.10.2 references retained in the repository are historical changelog
or release-evidence records. Active candidate-facing package and release
documentation identifies 1.11.0; the changelog freshness checker correctly
continues to report the latest published version as 1.10.2 until publication
is separately authorized.

## Implemented scope

### Documentation and architecture

- Added the canonical Persistent Search Transport reference at
  docs/PERSISTENT_SEARCH_TRANSPORT.md covering the CLI-only local IPC path,
  protocol framing, bounded startup/request/idle behavior, ownership proof,
  recovery, concurrency, privacy, stable errors, platform limits, and direct
  API/MCP boundary.
- Updated README.md, DOCS_INDEX.md, docs/REPOSITORY_INDEX.md,
  docs/UNIVERSAL_INTEGRATION.md, docs/MCP.md, and the MCP adapter README
  to keep the CLI persistent host distinct from direct Integration API and MCP
  access.
- Updated SECURITY.md, THREAT_MODEL.md, and docs/TROUBLESHOOTING.md with
  local-IPC ownership, bounded recovery, public path minimization, no-fallback
  behavior, and stable transport diagnosis.
- Updated documentation guidance, package contents, release checklist,
  manifest, review matrix, generated agent summary, and navigation links.
- Added the 1.11.0 changelog section and retained an explicit empty
  Unreleased section for future work.
- Updated package identity and lockfile to 1.11.0; the new transport
  reference is included in the core package file list.

### Visuals and diagrams

- Refreshed the repository-owned README architecture visual to show the
  Entry Points, CLI-only Persistent Search Client/local IPC/host path,
  canonical Repository Search service, Repository Index, managed tgrep,
  derived-state boundary, and independent lifecycle/evidence core.
- Revalidated the existing typed Archify diagram family and its generated
  HTML/SVG outputs, receipts, reviews, manifest, fingerprints, and
  accessibility markers. No fourth diagram was added: the persistent
  transport is a runtime discovery/optimization boundary, not a lifecycle
  transition, so diagram quantity was not expanded without a distinct
  source-bound workflow.

### Benchmark and compatibility correction

The repository-index hot-path benchmark was updated to construct the
validated managed tgrep binary handle required by the hardened process API.
This is a benchmark compatibility correction, not a native launcher,
backend replacement, or runtime redesign.

## Contract and lifecycle evidence

ForgeLoop task: forgeloop-1-11-0-docs-release-20260908.

- Existing task discovery was empty before task creation; one canonical task
  was created with claims for the release artifacts.
- The task contract, source registry, route, threat-boundary gate, and
  preflight were persisted through ForgeLoop commands. Preflight returned
  READY.
- Activated guides: clean, test, documentation, performance, and
  security. Execution profile: full.
- The task advanced through PLANNED and EXECUTING and is now in
  VERIFYING.
- The candidate commit changed the task repository fingerprint. The official
  reconcile-closure path was used with a passed documentation evidence
  command; no lifecycle state was edited manually.
- ForgeLoop-executed checks recorded in the current verification cycle:
  docs-final-check, tests-final, performance-final, security-final,
  public-docs, package-release-docs, and visual-docs, all passed.
- The tracked PROJECT_PROFILE.md remains the source repository's documented
  template by design. The initialized source-backed profile used for this
  task is in the ignored ForgeLoop kit state, preserving the source-kit
  initialization invariant and the package/init tests.

## Boundary findings

### Repository Index and persistent transport

Observed and documented behavior:

- Repository Index is the public search abstraction; managed tgrep 1.0.3 is
  an implementation backend, not the public API.
- CLI search may use the persistent local IPC host. Integration API and MCP
  call the canonical search service directly and do not start or connect to
  that host.
- Requests and responses use bounded length-prefixed JSON frames. Handshake,
  package/protocol identity, scope, nonce, endpoint, and ownership checks are
  required before reuse or shutdown.
- Startup, request, response, pattern, idle, concurrency, and recovery
  boundaries are explicit. Recovery is bounded to one transport-level attempt.
- There is no silent rg, grep, arbitrary-PATH, raw-tgrep, or no-index
  fallback.
- Host state, index state, search output, and watcher state remain derived
  operational data. They do not become claims, receipts, evidence, or
  completion authority.

### Integration API and MCP

- repositorySearch() and repositoryIndexStatus() are documented as direct,
  transport-neutral Integration API operations.
- MCP documents forgeloop_search and
  forgeloop://repository/index-status as thin adapters over those canonical
  services.
- The MCP surface does not expose raw tgrep arguments, arbitrary binaries,
  the persistent CLI host, or a no-index bypass.

### Privacy and security

- Public doctor/status projections omit absolute repository-root, index,
  binary, home, temporary, socket, named-pipe, lock, and persistent-state
  paths. Relative project paths remain allowed where part of a public result.
- Local IPC is same-user process coordination, not privileged cryptographic
  authentication. The documentation states this limitation explicitly.
- The threat-boundary gate passed. Focused Repository Index privacy,
  ownership, recovery, concurrency, and CLI acceptance tests passed.
- npm run dependency:policy passed. A runtime-only audit returned zero
  vulnerabilities. The full development dependency tree still reports one
  high js-yaml advisory; it was not silently remediated because it is a
  development-tooling issue outside this documentation release scope.

### Lifecycle, evidence, and terminal recorder

- Repository Index and persistent-host health are documented as independent
  from lifecycle phases, task claims, verification evidence, receipts, and
  completion validation.
- Focused terminal-owned requirement, terminal recorder, settlement, and
  status-regression tests passed (26/26). A premature observed terminal
  claim was rejected with E_FUTURE_LIFECYCLE_EVIDENCE; authoritative
  terminal-result paths behaved as designed.
- No recorder defect was reproduced. The publication state for this candidate
  remains intentionally NOT_VERIFIED because npm publication, tagging,
  GitHub Release creation, deployment, and merge are outside the authorized
  plan boundary.

## Validation results

All listed commands exited successfully unless explicitly marked otherwise.
Commands were run against the candidate source commit before pull-request
delivery; the exact final PR head must be checked again after each push.

### Documentation and protocol

- npm run docs:generate
- npm run summary:generate
- npm run completions:generate
- npm run docs:check
- npm run docs:diagrams
- npm run docs:diagrams:check
- npm run docs:diagram:inventory -- --json
- npm run docs:report
- node --test tests/documentation-surfaces.test.js — 5/5
- python3 scripts/validate_loop_system.py — 4 adapters, 10 English guides,
  6 routing scenarios
- python3 scripts/validate_markdown.py — fences and relative links valid in
  134 Markdown files
- npm run poc:evidence:verify
- npm run poc:evidence:test — 67/67

The documentation suite reported 121 Markdown files, 7 visual assets, 3
governed Archify diagram sets, 0 active Mermaid findings, 0 unreferenced
visual assets, 0 orphaned diagram artifacts, 51 manifest documents, 12
normative requirements, 89 commands, 304 public error codes, and 4 discovery
adapters.

### Tests and quality

- npm ci — passed; 133 packages installed from the lockfile.
- npm run test:quick — 60/60 passed.
- Native focused Repository Index and persistent transport tests — 56/56
  passed with managed tgrep 1.0.3.
- Full native-enabled npm test — 1,613 passed, 1 optional skip,
  0 failed, 1,614 total. The skip is the optional real Ripwire
  interoperability test because its explicit test path and version variables
  were not configured.
- Full native-enabled npm run coverage — 1,613 passed, 1 optional skip,
  0 failed; critical-module coverage gate passed.
- python3 -m unittest discover -s tests — 50/50 passed.
- npm run lint — 0 errors and 116 pre-existing complexity warnings.
- npm run dependency:policy — passed.
- npm run complexity:check — PASS, no regressions.
- npm run critical-coverage:check — passed after coverage generation.
- npm run completions:check — passed.
- npm run summary:check — passed.
- npm run mcp:test — 69/69 passed.
- Focused terminal lifecycle tests — 26/26 passed.

### Packaging and release preparation

- npm run repository-index:manifest — managed tgrep manifest valid.
- npm run pack:check — 9/9 passed.
- npm run mcp:setup — passed; MCP lock SHA-256
  b209a0c1a4e805434e770857f83ebd4e56fba7bf54dee420516de67e1c9f7562.
- npm run mcp:pack:check — passed.
- npm run pack:smoke — passed for
  cassiomc1-forgeloop-1.11.0.tgz.
- npm pack --dry-run --json — passed; package identity 1.11.0, transport
  documentation included, README hero image correctly excluded from the core
  tarball.
- npm run changelog:check — passed; reports published-history freshness at
  v1.10.2, which is expected before candidate publication.
- npm run release:identity -- --version 1.11.0 --release-commit
  b46acc4bfc5be99b23c09d42876c4acd6a3a4e5c --json —
  RELEASE_IDENTITY_NOT_VERIFIED because the npm registry returned HTTP 404.
  No publication was attempted.

### Performance and resource smoke

The repository-index and persistent-transport benchmarks were run with 20
iterations on this macOS arm64 host. These are workload-specific observations,
not universal superiority claims.

| Workload | Observed result |
| --- | --- |
| Hot-path raw tgrep | mean 6 ms, median 5 ms, p95 9 ms |
| Hot-path ForgeLoop search | mean 6 ms, median 5 ms, p95 8 ms |
| Hot-path rg oracle | mean 6 ms, median 6 ms, p95 9 ms |
| Persistent cold start | persistent 92 ms; fresh CLI 241 ms |
| Warm direct Integration API | total 113 ms; mean 6 ms, median 5 ms, p95 9 ms |
| Warm persistent transport | total 129 ms; mean 6 ms, median 6 ms, p95 9 ms |
| Warm fresh CLI | total 2,326 ms; mean 116 ms, median 116 ms, p95 123 ms |
| Agent-style 10-query workload | direct 52 ms; persistent 61 ms; fresh CLI 1,174 ms |
| Node startup component | 32 ms observed in the persistent benchmark |
| RSS/CPU ceiling across platforms | NOT_MEASURED; no unsupported resource claim made |

npm run performance:check also passed with a CLI startup median of
113.9 ms against its configured 1,000 ms budget across 7 samples.

## P0-P3 and NOT_VERIFIED review

| Priority or state | Finding |
| --- | --- |
| P0 | None reproduced in local validation. |
| P1 | None reproduced in local validation. |
| P2 | None reproduced in local validation. |
| P3 | Optional Ripwire interoperability was skipped without its explicit test configuration; development-only js-yaml audit advisory remains; cross-platform Windows results depend on CI; RSS/resource ceilings were not measured. |
| NOT_VERIFIED | Exact final PR-head CI, npm publication, Git tag, GitHub Release, deployment, merge, and production readiness are not verified by this plan. |

## Final delivery gate

PR #159 is open with branch codex/release-1.11.0 targeting main. Before
closing the ForgeLoop task, query the live PR head and require
all applicable checks at that exact SHA to be green. If the head changes,
repeat the exact-head validation and canonical lifecycle reconciliation.

The intended delivery boundary is therefore:

1. Push the release branch and create/update the PR.
2. Verify the live PR base, head SHA, merged state, and all required CI checks.
3. Record the final PR identity and CI result in this report or its linked
   delivery evidence.
4. Continue ForgeLoop through REVIEWING, execution receipt, and
   validator-backed COMPLETE only when the required evidence is present.
5. Stop before npm publication, tagging, GitHub Release creation, deployment,
   or merge.

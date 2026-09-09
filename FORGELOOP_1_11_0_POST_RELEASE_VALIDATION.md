# ForgeLoop 1.11.0 Post-Release Validation

Validation date: 2026-09-09 UTC

## Release identity

The 1.11.0 release commit is:

093b0389071d54c46d8adab47893925ba8326fd1

This commit is the squash merge of PR #161, which carried the final release
validation report and the Windows safe-path correction required after the
initial post-merge validation. PR #159 remains recorded separately as the
release-preparation merge:

- PR #159 exact validated head: 643027fb0cf32290f24b4f74f5e4b3692a341d02
- PR #159 merge commit: 636107bd1404121b1ec7daa06d501810966b728b
- PR #159 merge time: 2026-09-09T00:16:17Z
- PR #161 final validated head: df7a9ab76afd4fad7ec5d35c98b8ab93606c286b
- PR #161 merge commit and release commit: 093b0389071d54c46d8adab47893925ba8326fd1
- Package version in package.json and package-lock.json: 1.11.0

The historical 1.10.2 identity remains unchanged at
d286e1983177a0dfb1f0ceef6c2f6e30c406303a.

## PR and CI validation

All 21 applicable PR #159 checks were completed successfully at its exact
validated head 643027fb. This included JavaScript analysis, macOS/Linux/
Windows CLI portability, CodeQL, native Repository Index checks, manifest and
diagram validation, audit, dependency review, macOS/Linux/Windows tarball
smoke, and release validation.

The final PR #161 head df7a9ab was also validated by all 21 exact-head checks,
including both Windows Node 20 and Node 24 jobs. The tag-triggered publication
workflow completed successfully as run 34303541660, including trusted npm
publication and all package, documentation, policy, coverage, and validator
steps.

## Post-merge test results

All validation below targeted the release commit above.

- Targeted Repository Index, transport, Integration API, MCP, and lifecycle
  regression tests: 84 passed, 0 failed, 0 skipped.
- Full JavaScript suite: 1,613 passed, 0 failed, 1 optional Ripwire
  interoperability skip.
- Python unit suite: 50 passed, 0 failed.
- MCP suite: 69 passed, 0 failed.
- Overall coverage: 86.98% lines/statements, 86.23% functions, 76.35%
  branches. Critical-coverage validation passed.
- Secret scan passed across 1,985 text files.
- Evidence verification returned VALID for both evidence bundles.
- Benchmark profile validation passed for all three run sets.
- Package, docs, generated-docs, conformance, completion, summary, changelog,
  Markdown, loop-system, diagram, example, and manifest validators passed.
- Documentation inventory reported 46 documents, 89 CLI commands, 304
  documented public errors, 32 artifacts, and zero broken contracts.

## Documentation and architecture

README.md references docs/assets/eng_readme_forgeloop.png. The final image is
present, current, and has SHA-256
15844f8b153087304bbe9d1f2108b50696e6f56fe64722f913f97763636820c8.

The architecture image represents the CLI, CLI-only Persistent Search Client,
local IPC, Persistent ForgeLoop Host, Integration API, MCP, canonical
ForgeLoop APIs, RepositorySearchService, Repository Index, managed tgrep
1.0.3, protocol lifecycle, verification/evidence, and completion. It does not
claim that MCP routes through the persistent CLI host, that Integration API
requires IPC, that Repository Index is evidence, or that tgrep is ForgeLoop's
public API.

Documentation, links, generated documentation, diagrams, examples, and README
asset checks passed. The diagram inventory reported 122 Markdown references,
7 visual assets, zero active Mermaid diagrams, zero unreferenced assets, and
zero orphaned diagrams. No committed documentation contains machine-specific
absolute paths.

The report-only branch recheck, which includes this file, also passed all
documentation checks; its inventory reported 123 Markdown files and the
secret scan covered 2,071 text files.

## Privacy, Repository Index, transport, and public surfaces

The isolated doctor revalidation passed for ENGINE_MISSING and
NOT_INITIALIZED. Each scenario returned the expected non-ready exit code and
82 findings, while the recursive JSON scan found zero absolute repository,
Repository Index, managed-binary, HOME, persistent-host, socket, or
finding-evidence path leaks. Repository-relative paths remained acceptable.

Repository Index validation passed for mandatory managed tgrep 1.0.3,
manifest/archive/installed-binary integrity, same-version tamper rejection,
PATH substitution rejection, no rg fallback, ownership-safe lifecycle,
watcher mutation and deletion refresh, zero-match correctness, and
privacy-safe public projection.

Persistent Search Transport validation passed for cold startup, warm reuse,
20-way concurrent first use, ownership-verified crash recovery, and idle
shutdown. Concurrent startup created exactly one persistent host and one
repository-owned tgrep process. Recovery created a replacement host and
reused the healthy owned tgrep process; no unrelated process was affected.

Integration API calls use the canonical RepositorySearchService directly, and
MCP uses the canonical ForgeLoop API. Source tests and the published core
package smoke both passed for the expected public surfaces.

## Package and publication validation

The final package dry run contained 462 files and 1.11.0 metadata. Required
Persistent Search Transport, Repository Index, Integration API/types, MCP
surface, and documentation files were present. No lifecycle state, socket,
temporary HOME, test repository, secret, machine-specific path, or validation
scratch file was included. The locally packed tarball was independently
installed and passed CLI, protocol-info, doctor, Repository Index setup/status/
search, zero-match, Persistent Search Transport, Integration API, and packed
MCP smoke checks.

The repository's tag-triggered OIDC workflow published the package. Independent
registry verification reports:

- npm package: @cassiomc1/forgeloop@1.11.0
- dist-tag: latest -> 1.11.0
- npm gitHead: 093b0389071d54c46d8adab47893925ba8326fd1
- npm tarball SHA-1: 42fe880dbc244d8269a4e0fe4b4e8eb4c51303a7
- npm tarball SHA-512: sha512-KhH+RQ4Waiv2wtG+lQZXf17vIrC8V604p6LilCSitZ2gt9uyZX0J/gW1wTNaMYiO/i+F7HQ/CrEJ3/wMBiH1Jw==

The separate @cassiomc1/forgeloop-mcp package is governed by the independent
mcp-v release workflow. Repository policy and the 1.11.0 changelog state
that no cosmetic MCP package release is required for this additive core
release. Its registry-level smoke is therefore not applicable to this core
release; the packaged MCP surface and MCP tests were validated locally and
against the published core package.

## Release tag, GitHub Release, and identity

Before creation, neither the local nor remote v1.11.0 tag existed. The
annotated tag was created and pushed without force:

- Tag object: fc14f2486103772ed85c987f231501b5485562f7
- Peeled tag target: 093b0389071d54c46d8adab47893925ba8326fd1
- GitHub Release: https://github.com/cassiomc1/forgeloop/releases/tag/v1.11.0
- GitHub Release state: published, not draft, not prerelease

The canonical release identity validator returned RELEASE_IDENTITY_VALID.
Source release commit, tag target, GitHub Release tag, npm gitHead, package
version, and published tarball integrity all agree.

## Performance and resource smoke

Representative measurements showed no material regression:

- Raw tgrep: median 6 ms, p95 8 ms.
- Warm Integration API: median 6 ms, p95 7 ms.
- Persistent transport: median 7 ms, p95 8 ms.
- Fresh CLI total: approximately 127 ms mean, with fresh process/module
  startup dominating the cost.
- rg: median 6 ms, p95 7 ms.
- CLI startup validator: 98.9 ms median against a 1,000 ms budget.

The 20-way lifecycle test passed with one host and one owned tgrep process.
Formal RSS/CPU instrumentation and a dedicated 50-way resource measurement
were not collected. No resource leak, idle CPU, or lifecycle defect was
observed.

## ForgeLoop lifecycle and terminal recorder

The fresh release validation task
forgeloop-1-11-0-final-release-20260909 completed through the canonical
ForgeLoop lifecycle. Completion returned:

- status: VALID
- task status: COMPLETE
- verification status: VALID
- publication status: published
- ledger: valid, 58 events
- contract evidence coverage: all 15 requirements COVERED

The prior terminal-recorder concern was NOT_REPRODUCED. Focused recorder
validation accepted the supported terminal outcomes, including pushed tag,
published GitHub Release, and published npm package; canonical completion
remained validator-backed and valid. No evidence-integrity or supported
lifecycle failure was found.

## Findings and follow-ups

P0 findings: none.

P1 findings: none.

P2 findings: none.

P3 follow-ups:

1. Add optional formal RSS/CPU and higher-concurrency resource instrumentation.
2. Keep native launcher work as a separate design and benchmark task; current
   evidence still shows fresh Node/module startup dominates CLI latency.
3. Upgrade the open Dependabot high-severity js-yaml alert from 4.3.1 to the
   patched 4.3.2 release. The dependency is development-only through ESLint,
   is not a runtime dependency of the published package, and was not included
   in the published dependency installation. It is therefore classified P3
   for this release, despite the advisory's upstream severity label.

NOT_VERIFIED items are limited to the optional resource instrumentation and
the intentionally separate MCP package registry publication, which is not a
requirement of the core 1.11.0 release.

## Final verdict

RELEASED WITH FOLLOW-UPS

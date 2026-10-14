# ForgeLoop Release Checklist

This is the current release checklist for the PolyForm Noncommercial-licensed
`@cassiomc1/forgeloop` package. It is a preparation and verification checklist;
it does not authorize publication.

## Bounded 2.0.0-rc.2 publication

The owner approved short verification and an RC fallback on 2026-10-13. This
candidate is published only to npm `next`; stable `latest` remains blocked while
`soleSQLiteWriter` is false. A release candidate does not assert completed
migration acceptance or production readiness.

After npm rejected restricted RC1 publication with `E402`, the owner authorized
public core-package access. RC2 preserves the immutable RC1 tag; the MCP
companion is not published and retains restricted access.

`npm run release:quick` is the RC PR and publishing check. Each check group has
an enforced three-minute timeout; timeout or failure refuses release. It runs
source equivalence, writer inventory drift detection, essential SQLite boundary
and package-policy tests, lint, dependency policy, documentation conformance,
packed CLI/API/MCP smoke checks, hygiene, and secret scanning. This approved RC
path replaces a new local `verify:prepush` run. It does not replace the ordinary
or stable-release validation policy.

`scripts/check-rc-release.mjs` requires all 593 runtime/schema/integration files
to match baseline `14008f58f8ad255692997ce3fff359591fb695d1`. Root package
metadata may change only its RC version, the three approved RC scripts, and owner-authorized public access.
Resolved dependency locks must be unchanged apart from local package versions;
MCP metadata may only admit the explicit RC peer and bind the local core version.
Changed runtime or dependency bytes refuse this fast path.

The baseline Windows full-suite receipt is GitHub run `38483385848`, successful
on that exact source. Publishing verifies its repository, workflow, source SHA,
and completed success status through the authenticated GitHub API. Current
Linux/packaged smoke and local macOS short checks are separate evidence. No new
full-coverage, full-platform, physical power-loss, or statistically qualified
p95 result is claimed by the short path. The existing 1,000-task parity run
`38483369676` is retained for review; no fresh 200-repeat benchmark is dispatched.

The writer inventory covers every current `src` JavaScript module and records
imports plus potential write sites. Alias, computed-path, external-caller, and
transitive-authority review remain incomplete. The inventory explicitly keeps
`wholeConsumerClosure: false`; it prevents drift and does not authorize setting
`soleSQLiteWriter` to true.

RC release sequence: reviewed PR checks pass, merge preserving baseline
ancestry, tag `v2.0.0-rc.2`, dispatch `npm-publish.yml` with channel `next` and
confirmation `PUBLISH PUBLIC PACKAGE`, then verify npm version, Git commit,
tarball integrity, and provenance. Stable publishing retains full checks and
additionally refuses incomplete sole-writer acceptance.

## ForgeLoop 2.0.0 candidate scope

The 2.0.0 candidate is not release-ready while SQLite migration plan §10 has
open consumer-closure, current-source performance, or platform evidence. Keep
all acceptance boxes open until their evidence is bound to the exact candidate
revision.

The 2.0.0 candidate carries the SQLite storage transition alongside the
existing protocol, routing, provider, documentation, and package surfaces. The
existing checklist remains applicable to those surfaces; SQLite release
acceptance additionally requires every item below:

- [ ] All plan §9 acceptance rows are current for the exact candidate SHA,
      including an accepted 1,000-task hosted parity run with exact output,
      validated workers, clean observer admission, cleanup, and lower native
      p95 for both operations.
- [ ] Plan §10 consumer closure is complete and `soleSQLiteWriter` is true
      based on source audit and tests; fail-closed migration boundaries remain
      in place until that evidence exists.
- [ ] Migration, crash recovery, legacy-unbound handoff, attachment recovery,
      backup, restore, rollback, and SQLite integrity checks pass on the exact
      candidate.
- [ ] Required Linux, macOS, Windows, supported Node runtime, MCP, API, and
      package workflows pass at the exact candidate SHA.
- [ ] Release identity and npm version availability are verified, and the
      matching tag workflow completes its verification job before publishing.

- [ ] README catalog and architecture fallback identify
      `ENG/flutter-development-eng.md` and explain that the specialist is
      selected only from a structurally parsed
      `dependencies.flutter.sdk: flutter` entry in affected scope.
- [ ] README catalog and architecture fallback identify
      `ENG/rust-development-eng.md` and explain that the specialist is
      selected only from a structurally parsed `[package]` or `[workspace]`
      table in an affected `Cargo.toml`.
- [ ] README catalog and architecture fallback identify
      `ENG/nodejs-backend-development-eng.md` and explain that Node.js
      backend/runtime evidence is distinct from build, test, and configuration
      tooling executed under Node.js.
- [ ] README catalog and architecture fallback identify the C, C++, Java, SQL,
      Go, TypeScript, PHP, and Swift specialists and explain their bounded
      structural evidence and same-root composition rules.
- [ ] The canonical engineering-flow source and regenerated HTML/SVG diagram
      explain project detection as routing context, not verification or
      completion evidence.
- [ ] Positive clean-room package routing selects `flutter`, `clean`, and
      `test` for a Flutter root.
- [ ] Documentation-only mentions, lockfiles, hosted packages, malformed
      dependency shapes, symlink traversal, and unrelated monorepo roots do
      not activate the Flutter specialist.
- [ ] [`docs/REPOSITORY_INDEX.md`](./REPOSITORY_INDEX.md) and
      [`docs/PERSISTENT_SEARCH_TRANSPORT.md`](./PERSISTENT_SEARCH_TRANSPORT.md)
      agree on tgrep management, no-fallback behavior, local IPC, ownership,
      bounded recovery, privacy, and derived-state semantics.
- [ ] All package-shipped documentation indexes and the package file list
      include the persistent transport reference.
- [ ] Lifecycle, evidence, completion, and publication remain independent of
      Repository Index and persistent-host health.

This checklist does not authorize publication by itself. The owner authorized
conditional npm publication through the GitHub workflow; the action remains
prohibited until every release gate passes. Tagging, GitHub Release,
deployment, and live data migration remain separate actions.

## CI minimization validation

- [ ] `npm run skill:check` passes and generated Skill frontmatter, protocol
      synchronization, safety boundaries, and package coverage remain valid.

- [ ] `npm run verify:fast` passes for edit-time feedback.
- [ ] `npm run repository:hygiene` passes: no tracked mutable ForgeLoop state,
      unexpected root reports, orphan visual assets, unapproved benchmark run
      sets, or scratch outputs.
- [ ] The documentation manifest and review matrix cover every maintained and
      packaged document with origin, currency, package, action, and canonical
      source metadata.
- [ ] Diagram source, generated output, receipts, and review bindings are
      current; a changed source is not approved until its visual review is
      renewed.
- [ ] `npm run verify:prepush` passes before the release pull request; MCP
      setup, when needed, was run explicitly with `npm run mcp:setup`.
- [ ] Ordinary PR validation uses `.github/workflows/pr-core.yml` with the
      unchanged required contexts `audit`, `CodeQL`, `Verify generated Archify
      diagram`, `validate (22)`, `tarball smoke (ubuntu-latest)`, and
      `dependency-review`.
- [ ] `validate (22)` is always present and fails closed on an applicable
      prerequisite failure, cancellation, or unexpected skip.
- [ ] Path classification scenarios cover README-only, ordinary source,
      Repository Index, package-export, and forced release validation.
- [ ] Main-branch documentation, Node compatibility, package smoke, audit,
      and Windows full-suite workflows remain available for broader validation.

## Contract and package identity

- [ ] `package.json` and `package-lock.json` contain the same package version.
- [ ] The package metadata declares the intended license
      (`PolyForm-Noncommercial-1.0.0`), includes the official license text,
      and retains public core-package publication access.
- [ ] `PROTOCOL_VERSION` and the integration API version remain compatible.
- [ ] `npm run release:identity` passes for the candidate version.
- [ ] No release tag or registry version collision exists.
- [ ] `npm pack --dry-run` contains the required scenario definitions but no
      raw or aggregate benchmark results, Ripwire benchmark runner/cases/
      fixtures, tests, local state, or repository metadata.
- [ ] [`docs/PACKAGE_CONTENTS.md`](./PACKAGE_CONTENTS.md) matches the current
      `package.json` file list and documents intentional inclusions and
      exclusions.
- [ ] The candidate tarball includes every registered specialist guide and every
      other `src/config/guides.json` path; no repository-only guide state is
      packaged.
- [ ] Every maintained `src/**/*.js` module is present in the candidate
      tarball; only the four explicitly retired compatibility helpers are
      excluded.

## Protocol and attestation

- [ ] `protocol-info` and the Integration API capability contracts agree.
- [ ] `canonicalHandoffs` v2 is advertised consistently.
- [ ] `advisoryContextProviders` v1 is advertised consistently.
- [ ] `providerExtensions` v1 is consistent, provider-neutral, experimental,
      and retains false lifecycle/completion/evidence authority.
- [ ] Generic provider registry export remains absent and auto-install remains
      false.
- [ ] Advisory context remains Integration-API-only.
- [ ] OpenSrc requires an explicit absolute executable path and lazily qualified expected version.
- [ ] OpenSrc cache remains outside the target project and returned source paths are containment-validated.
- [ ] OpenSrc recall remains advisory, non-evidence, and non-persisted by ForgeLoop.
- [ ] No OpenSrc binary or cache ships in npm.
- [ ] Optional Agent Browser uses a host-supplied absolute executable, has no
      runtime dependency, and keeps browser observations non-authoritative.
- [ ] Optional Emulated Services uses a host-supplied absolute `0.11.2`
      executable, has no runtime dependency or PATH discovery, bounds argv
      execution/readiness/output/cleanup, keeps state outside the target, and
      returns observation-only loopback results.
- [ ] Optional Security Review is host-injected through `securityReviewProviders`,
      has no auto-install or scanner discovery, and keeps findings
      observation-only, non-evidence, non-lifecycle, and non-completion.
- [ ] Security Review request/result bounds, strict snapshot validation,
      shared timeout, and cooperative cancellation are covered by focused tests
      and the public TypeScript declarations.
- [ ] `next`, `status`, and `task/context` invoke zero advisory providers.
- [ ] Advisory request budgets are normalized before provider invocation.
- [ ] Advisory results are never persisted by ForgeLoop.
- [ ] Same-consumer handoff acceptance is idempotent.
- [ ] Different-consumer handoff acceptance fails closed.
- [ ] Concurrent acceptance creates one `HANDOFF_ACCEPTED` event.
- [ ] Clean HEAD/branch drift rejects handoff acceptance.
- [ ] Stale contract/route identity rejects handoff creation or acceptance.
- [ ] An invalid event ledger projects `INCONSISTENT`.
- [ ] Continuity lint remains non-authoritative and non-evidence.
- [ ] `npm run dependency:policy` passes with only the approved exact
      `@typesafe-ai/sdk` and `smol-toml` runtime dependencies and approved
      development dependencies.
- [ ] `npm run lint` passes.
- [ ] `npm test` passes.
- [ ] `npm run benchmark:profiles:check` passes; absent provider/host history
      is reported as `NOT_MEASURED`, never as zero or a passing efficiency claim.
- [ ] `npm run benchmark:profiles:regression` reports the observed status;
      `EFFICIENCY_REGRESSION` remains a non-blocking warning.
- [ ] `npm run benchmark:profiles:outliers` and
      `npm run benchmark:profiles:tail-analysis` report the observed
      `TOKEN_IQR_1_5`, paired-ratio, and distribution-tail results without
      conflating `pairedOverheadPercent` with `distributionDeltaPercent`.
- [ ] Historical v1 run sets remain byte-for-byte immutable while v2 run sets
      carry robust statistics, low-baseline diagnostics, and explicit tail
      interpretations.
- [ ] `npm run coverage` passes the configured global and critical-module gates.
- [ ] `npm run docs:check`, `npm run docs:generated:check`,
      `npm run docs:conformance`, and `npm run docs:examples:check` pass.
- [ ] `npm run docs:diagrams:check` and `npm run docs:diagram:inventory` pass;
      every active diagram has typed source, dark-first animated HTML/SVG,
      reduced-motion handling, a deterministic receipt, a text fallback, and
      a current source-bound visual review.
- [ ] `npm run completions:check` and `npm run summary:check` pass.
- [ ] Workspace binding, handoff, responsibility, verification scope, revision,
      manifest, statement, signature, and range-coverage tests pass.
- [ ] Required attestation mode never leaves a task durably `COMPLETE` without
      its code manifest.
- [ ] Read-only attestation verification does not write task state or ledger
      events.

## Integration and cross-platform evidence

- [ ] `npm run pack:check` and `npm run pack:smoke` pass.
- [ ] `npm pack --dry-run` includes the Flutter guide, Repository Index
      runtime/manifest/docs, and excludes native release binaries and derived
      `.forgeloop` index data.
- [ ] The npm publication workflow runs `npm run pack:smoke` before its
      provenance-backed publish step.
- [ ] `npm run mcp:test` either runs the configured MCP tests or reports the
      single actionable setup prerequisite.
- [ ] `npm run mcp:pack:check` passes when MCP dependencies are available.
- [ ] Repository Index provider-neutral CLI, Integration API, and MCP
      surfaces expose the same normalized result and status contracts.
- [ ] The checked-in tgrep manifest passes archive and executable checksum/
      version validation for every supported platform, with no placeholder
      hashes or `latest` URL.
- [ ] Matrix CI runs the real pinned tgrep artifact on Linux, macOS, and
      Windows; native setup/start/status/search/live-watcher, crash-recovery,
      migration, differential, and stop tests are green with no continue-on-
      error path.
- [ ] `doctor` reports an unhealthy mandatory Repository Index instead of
      silently falling back to `rg`, `grep`, or `PATH` discovery.
- [ ] Generic CI verification uses explicit provider, base, and head revisions.
- [ ] Windows full-suite evidence is green on the main branch when scheduled.
- [ ] Frozen Python 3.9+ validators pass with `python3 -m unittest discover -s tests`.
- [ ] Secret scanning and Markdown validation pass.

## Publication boundary

- [ ] The exact validated commit is the release source.
- [ ] GitHub Actions remain immutably pinned and use least-privilege permissions.
- [ ] The npm workflow retains trusted OIDC publishing and explicit provenance.
- [ ] The publication workflow fails closed when the candidate npm version
      already exists or the package inspection finds forbidden paths.
- [ ] Publication is performed only by the authorized release workflow.
- [ ] Post-publication registry, tag, checksum, and release identity checks pass.

Local package creation, a successful validation run, or a signed ForgeLoop
attestation does not by itself prove npm publication or production deployment.

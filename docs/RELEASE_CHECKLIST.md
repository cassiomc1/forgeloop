# ForgeLoop Release Checklist

This is the current release checklist for `@cassiomc1/forgeloop`. It is a
preparation and verification checklist; it does not authorize publication.

## ForgeLoop 1.11.0 candidate scope

The 1.11.0 candidate refreshes the public documentation architecture around
the managed Repository Index and CLI-only persistent search transport. The
candidate must keep these boundaries explicit:

- [ ] README architecture visual and text fallback describe CLI persistent
      search separately from direct Integration API/MCP access.
- [ ] [`docs/REPOSITORY_INDEX.md`](./REPOSITORY_INDEX.md) and
      [`docs/PERSISTENT_SEARCH_TRANSPORT.md`](./PERSISTENT_SEARCH_TRANSPORT.md)
      agree on tgrep management, no-fallback behavior, local IPC, ownership,
      bounded recovery, privacy, and derived-state semantics.
- [ ] All package-shipped documentation indexes and the package file list
      include the persistent transport reference.
- [ ] Lifecycle, evidence, completion, and publication remain independent of
      Repository Index and persistent-host health.

This branch prepares the candidate and its pull request. npm publication,
tagging, GitHub Release, deployment, and merge remain separately authorized
actions.

## CI minimization validation

- [ ] `npm run verify:fast` passes for edit-time feedback.
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
- [ ] The package metadata declares the intended SPDX license (`MIT`).
- [ ] `PROTOCOL_VERSION` and the integration API version remain compatible.
- [ ] `npm run release:identity` passes for the candidate version.
- [ ] No release tag or registry version collision exists.
- [ ] `npm pack --dry-run` contains the required scenario definitions but no
      raw or aggregate benchmark results, Ripwire benchmark runner/cases/
      fixtures, tests, local state, or repository metadata.
- [ ] [`docs/PACKAGE_CONTENTS.md`](./PACKAGE_CONTENTS.md) matches the current
      `package.json` file list and documents intentional inclusions and
      exclusions.
- [ ] Every maintained `src/**/*.js` module is present in the candidate
      tarball; only the four explicitly retired compatibility helpers are
      excluded.

## Protocol and attestation

- [ ] `protocol-info` and the Integration API capability contracts agree.
- [ ] `canonicalHandoffs` v2 is advertised consistently.
- [ ] `advisoryContextProviders` v1 is advertised consistently.
- [ ] Advisory context remains Integration-API-only.
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
- [ ] `npm run dependency:policy` passes without adding runtime dependencies.
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
- [ ] `npm pack --dry-run` includes Repository Index runtime/manifest/docs and
      excludes native release binaries and derived `.forgeloop` index data.
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

# ForgeLoop 1.6.1 release checklist

Preparation checklist for the `@cassiomc1/forgeloop` 1.6.1 release. It does not
authorize publication. Historical checklists:
[`RELEASE_CHECKLIST_1_5_MCP.md`](RELEASE_CHECKLIST_1_5_MCP.md),
[`RELEASE_CHECKLIST_1_4.md`](RELEASE_CHECKLIST_1_4.md).

## Version and contract identity

- [ ] Core package version is `1.6.1` in `package.json` and the lockfile root.
- [ ] ForgeLoop protocol version is `1`.
- [ ] Integration API version is `1`
      (`FORGELOOP_INTEGRATION_API_VERSION`).
- [ ] Candidate version is absent from npm and the `v1.6.1` tag is absent from
      origin before release preparation starts.
- [ ] `CHANGELOG.md` has a versioned `1.6.1` section with the actual release
      date and an empty `Unreleased` section above it.

## Verification execution adapter contract (new in 1.6.x line)

- [ ] `src/core/verification-execution.js` defines the adapter boundary,
      `VERIFICATION_ISOLATION_MODES`, and the two public error codes.
- [ ] `runtimeContext.verificationExecutionAdapter` and
      `runtimeContext.verificationExecutionPolicy` are validated at context
      creation and never accepted as CLI flags or command input.
- [ ] `createForgeLoopContext`, the isolation modes, and both error codes are
      exported from `@cassiomc1/forgeloop/integration`.
- [ ] `protocol-info --json` advertises
      `features.verificationExecutionIsolation` (version 1, adapter-backed,
      modes enumerated, `protocolProjectRootSeparateFromExecutionCwd: true`).

## Isolation metadata invariants

- [ ] `NATIVE_PROJECT` requires `isolated: false` and
      `liveProjectWritable: true`; it is never described as isolated.
- [ ] `PROJECT_ISOLATED` and `SYSTEM_ISOLATED` require `isolated: true` and
      `liveProjectWritable: false`; `SYSTEM_ISOLATED` additionally requires
      `networkPolicy: DENIED`.
- [ ] Contradictory isolation metadata is rejected with
      `E_VERIFICATION_EXECUTION_INVALID` before evidence persistence.
- [ ] Isolated execution must use a cwd separate from the protocol project
      root; violation fails closed with `E_VERIFICATION_EXECUTION_INVALID`.
- [ ] Unsatisfiable isolation policy fails closed with
      `E_VERIFICATION_ISOLATION_UNAVAILABLE` and never falls back to the live
      project.
- [ ] Execution records persist `executionKind`, `protocolProjectRoot`,
      `executionIsolation`, and the `isolation` object per
      `schemas/execution.schema.json`.

## Durable-action invariants

- [ ] Trusted `COMMITTED` reconciliation replays exactly once; reconciled
      mirrors are corroborations, never second transitions.
- [ ] Action verification requires an independent passed execution covering the
      action's exact immutable requirement.
- [ ] `REQUIRE_APPROVAL` authorizations bind approval fingerprints validated by
      readiness and audit.
- [ ] Public provenance metadata matches behavior
      (`CALLER_REPORTED` / `EXTERNAL_OBSERVED`).

## PoC evidence validation

- [ ] `npm run poc:evidence:verify` passes against committed evidence bundles.
- [ ] `npm run poc:evidence:test` passes.
- [ ] PoC docs (`poc/README.md`,
      `poc/FORGELOOP_REAL_EXECUTION_POC.md`) match committed evidence paths,
      manifests, and hashes.

## Documentation freshness

- [ ] `npm run docs:generate` leaves no diff (generated regions current).
- [ ] `npm run docs:generated:check` passes.
- [ ] `npm run docs:conformance` passes.
- [ ] `npm run docs:diagrams:check` passes (typed Archify source unchanged or
      regenerated with receipt).
- [ ] `npm run docs:check` passes.
- [ ] Normative docs represent the post-`v1.6.0` verification execution
      boundary without making a harness-specific backend normative.
- [ ] `DOCS_INDEX.md` points release maintainers to this checklist as current.

## Local validation gates

- [ ] `npm run dependency:policy` passes (runtime dependencies remain zero).
- [ ] `npm run lint` passes.
- [ ] `npm test` passes.
- [ ] `npm run coverage` passes.
- [ ] `npm run pack:check` passes.
- [ ] Python validators pass: `python3 -m unittest discover -s tests`,
      `validate_markdown.py` (+ self-test), `validate_loop_system.py`
      (+ self-test).
- [ ] `python3 scripts/scan_secrets.py` passes.
- [ ] `npm pack` tarball inspected: correct name/version, intended docs, no
      secrets, no `.git`, no `.forgeloop` execution state.

## Protected-branch and PR gates

- [ ] Changes reach `main` only through a reviewed PR; `main-protection`
      ruleset never bypassed.
- [ ] Required checks green: `audit`, `CodeQL`, `Verify generated Archify
      diagram`, `validate (22)`, `tarball smoke (ubuntu-latest)`,
      `dependency-review`; every other relevant check green.
- [ ] No unresolved review threads; PR merged without admin bypass.

## Publication boundary

- [ ] Post-merge `main` workflows green before tagging.
- [ ] npm candidate version and tag re-checked for collision immediately before
      tagging.
- [ ] Annotated tag `v1.6.1` created on the exact validated `main` commit and
      pushed once; never moved after publication.
- [ ] `npm-publish.yml` retains `contents: read` + `id-token: write`; no
      `NPM_TOKEN`/`NODE_AUTH_TOKEN` is added anywhere.
- [ ] `Publish npm package` workflow succeeds (trusted OIDC publishing).
- [ ] `Release notes` workflow succeeds; GitHub Release is not draft or
      prerelease and carries the checksum asset.
- [ ] npm registry reports the exact version with `gitHead` equal to the
      release commit.
- [ ] `npm run release:identity` returns `RELEASE_IDENTITY_VALID` with every
      individual check `ok`.
- [ ] Optional clean-install smoke test installs `@cassiomc1/forgeloop@1.6.1`
      and `forgeloop --version` reports `1.6.1`.

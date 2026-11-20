# Changelog

## Unreleased

- Independent verifier: `verifier/` is packaged on its own as
  `@cassiomc1/forgeloop-verify` (Apache-2.0, no dependencies), so anyone can
  run `npx @cassiomc1/forgeloop-verify --base <rev> --head <rev>` without the
  ForgeLoop CLI.
- Delegation: `evidence-verify --brief <task-brief.json>` accepts a
  delegate's work only on evidence. It fails with
  `E_DELEGATION_EVIDENCE_MISSING`, `E_DELEGATION_SCOPE_VIOLATION` or
  `E_DELEGATION_VERIFICATION_UNMET` when the brief's task has no intact bundle,
  changed paths outside its brief, or has no passing bound check for a brief
  verification item. The independent verifier supports `--brief` too, both
  pass six delegation conformance cases (25 total), and spec Section 8 is
  normative (`FL-SPEC-012`).
- Attestation: new statements use predicate schema version 2, which binds
  every recorded check (id, requirement, status, provenance, exit code and a
  SHA-256 digest of its argv) into the signed statement. Verifiers keep
  accepting version 1.
- Verification: `evidence-verify` and the independent verifier report
  execution assurance (`UNKNOWN`, `REPORTED`, `EXECUTED`, `HOST_ATTESTED`), and
  `--min-assurance <level>` fails a range below it with
  `E_EVIDENCE_ASSURANCE_INSUFFICIENT`. `HOST_ATTESTED` needs a signature
  verified under a CI workload issuer policy.
- Conformance: six predicate-v2 and assurance cases (19 total); both
  verifiers pass them. The spec's predicate and execution-assurance sections
  are now normative (`FL-SPEC-008`..`011`).
- Licensing: the protocol is open. `docs/PROTOCOL_SPEC.md`, `schemas/`, the
  conformance suite and the new independent verifier are Apache-2.0
  (`LICENSE-APACHE`); the reference runtime stays PolyForm Noncommercial 1.0.0.
  `LICENSING.md` lists the paths; the package ships both licence texts.
- Verifier: `verifier/forgeloop-verify.mjs` is a second, dependency-free
  implementation of evidence verification that imports nothing from the
  runtime. It checks integrity, statement bindings, the manifest, head content
  and coverage, and reports execution assurance; it does not verify Sigstore
  signatures. `npm run conformance:independent` runs the suite against it.
- Conformance: five more cases, four of them "resealed" (the manifest
  fingerprint and bundle digest are recomputed after tampering, so only the
  statement, manifest and binding checks can catch them). Both verifiers pass
  all 13.
- Protocol: `docs/PROTOCOL_SPEC.md` is the normative, implementation-neutral
  core specification: roles, core objects, the lifecycle and its invariants,
  the in-toto statement and predicate, evidence bundles, two trust axes
  (integrity and execution assurance), evidence-based delegation, profiles,
  conformance and versioning. Predicate schema version 2 and execution
  assurance are specified as Draft and implemented in a follow-up.
- Completion: a contract verification item whose latest bound check failed or
  was blocked now rejects completion with `E_CHECK_FAILED`; a later passing run
  of the same item supersedes the failure. Before, only success criteria,
  guide evidence and configured evidence were required, so a failed
  verification check could reach `COMPLETE`.
- Conformance: `npm run conformance` runs the verifier conformance suite in
  `conformance/cases.json` (valid evidence, tampered content, uncovered
  changes, edited statements, forged digests, renamed bundles, missing
  signatures). Other verifiers run it through
  `FORGELOOP_CONFORMANCE_VERIFIER`.

## 2.4.0 - 2026-11-19

- Minor release. Its runtime change is bound by
  `benchmarks/storage-sqlite/stable-2.4.0-writer-review.json.gz`, a delta
  review against 2.3.1: `syncDirectory` gains an optional `openDirectory`,
  used instead of `fs.promises.open` only when given. Every filesystem binding
  is identical to 2.3.1 and no write path is added.
- Tests: the last nine test landmine allowances are gone, so the allowlist is
  empty. Fixed sleeps became awaited conditions: a real hang for the seed
  watchdog, `fs.rm` retries for transient Windows locks, a lock probe instead
  of a delay, and one shared `tests/helpers/poll.js` for processes that emit
  no event. Tests pass their own handle to `syncDirectory` instead of
  mocking `node:fs/promises`, and a data field named `retries` is no longer
  mistaken for a test retry option.

- Lower the test landmine allowances from 25 to 9. The central test runner
  now gives every test one suite-wide hang bound (`--test-timeout=120000`,
  overridable by the caller), replacing sixteen per-test `{ timeout }`
  overrides in the storage, structural-quality and provider-architecture
  tests. The engineering testing guide recommends the same pattern.
- The Evidence signing workflow uploads its verified Sigstore bundle to
  ForgeLoop Cloud (`POST https://forgeloop.monster/api/signatures`) when the
  repository has a `FORGELOOP_SYNC_TOKEN` secret, so the hosted dashboard can
  verify detached signatures. Without the secret the upload is skipped; the
  token reaches only the two steps that need it.
- ForgeLoop Audit moves to ForgeLoop Cloud, the paid team dashboard at
  `https://forgeloop.monster/dashboard/`, and the local `ForgeLoopAudit/`
  workspace leaves this repository with its CI workflow and its lint,
  Markdown, link-check, gitignore and hygiene exceptions.
  `docs/FORGELOOP_AUDIT.md` now explains the cloud Audit and the local
  read-only alternatives; the `task/audit-view` Integration API is unchanged.
  The architecture image shows the dashboard with the Audit, and the release
  checklist records the published 2.3.1 identity.
- Documentation review after 2.3.1:
  - the README hero is a new architecture image rendered from
    `docs/assets/forgeloop-architecture.svg`, now its source, with evidence and
    trust and ForgeLoop Cloud layers; `docs/DOCUMENTATION_GUIDE.md` shows how
    to regenerate it;
  - README and `DOCS_INDEX.md` cover evidence bundles, signing, cloud sync
    and assessment, list the verification tiers, and describe the current
    repository layout; duplicate index rows are gone;
  - superseded release checklists (1.4, 1.5 and MCP, 1.6.1), the Astra
    implementation record, the knowledge gap analysis and the SQLite
    migration-era records move to `docs/history/`, with the documentation
    manifest, review matrix, conformance check and package test updated.

## 2.3.1 - 2026-11-19

- Patch release. Its runtime changes are bound by
  `benchmarks/storage-sqlite/stable-2.3.1-writer-review.json.gz`, a delta
  review against 2.3.0. Both changed modules have a disposition, and the two
  added filesystem bindings are read-only `readFile` calls in
  `src/core/signing/sigstore.js` over private temporary copies of the
  statement and the bundle. No write path is added.
- Sigstore verification works with cosign 3. `verify-blob-attestation` no
  longer accepts `--statement` (Evidence signing run 44414500869:
  `unknown flag: --statement`), so the core provider and the Evidence signing
  workflow now verify with `--type`, `--digest` and `--digestAlg sha256`.
  After cosign succeeds, they also require the signed DSSE payload to be
  exactly the attestation statement, so a signature over a different
  statement with the same subject is rejected.
- Attestation statements are now plain in-toto Statement v1 documents
  without a top-level `schemaVersion`; the predicate keeps its own. The first
  real `cosign attest-blob` run (Evidence signing workflow) rejected the
  extra field with `invalid attestation: decoding json`, so Sigstore signing
  could not work with real `cosign` before this change. Statements that carry
  the legacy field still validate.
- Add the manually dispatched **Evidence signing** workflow
  (`.github/workflows/evidence-sign.yml`), which runs only from `main`. It:
  - verifies a committed evidence bundle with `evidence-verify` against the
    commit that introduced it;
  - signs its in-toto statement keylessly with the GitHub Actions OIDC
    identity, using the same `cosign attest-blob` arguments as the core
    Sigstore provider;
  - checks the signature against that exact workflow identity and uploads it
    as a run artifact.

  The signature certifies CI verification, not that ForgeLoop produced the
  bundle.
- Lower the test landmine allowances from 28 to 25 by rewriting three
  fixed-sleep tests:
  - a slow advisory provider never settles, so only the deadline ends it;
  - the security-review cancellation test waits for the provider to start,
    racing the review so an early settle fails instead of hanging;
  - the late-completion test gates the provider and releases it after the
    deadline, so no real-time race decides the result.
- The hosted team dashboard reads the task source and the signature status:
  - a "Published · not on main yet" badge marks tasks uploaded with
    `evidence-publish`;
  - the signature column shows verified, invalid, attached-but-not-verified
    or unsigned;
  - older payloads without these fields render as committed, with the
    signature attached or unsigned.
- Resolve the open Dependabot alerts:
  - `zod` 4.6.7 in `integrations/mcp`, fixing GHSA-mrhx-c7xc-m3w5;
  - patched `minimatch` 11 for the development-only `glob`, `test-exclude`
    and `typescript-eslint` consumers through scoped `overrides` in the root
    and ForgeLoopAudit, fixing GHSA-g3hv-75wg-m249.
- Align ForgeLoopAudit with the published 2.3.0 core.
  - Vendor the exact npm archive: SHA-512 verified against the registry,
    release commit 8655d42.
  - Regenerate the schema copies and provenance from `v2.3.0`;
    `config.schema.json` gains `autoExportEvidence`.
  - Update lineage, pins, docs and tests, and record the 2.3.0 publication
    identity.

## 2.3.0 - 2026-11-18

- Minor release. Its runtime changes are bound by
  `benchmarks/storage-sqlite/stable-2.3.0-writer-review.json.gz`, a delta
  review against 2.2.0. Every changed and added module has a disposition, and
  the 9 added filesystem bindings each have an explicit role: the
  `evidence-publish` user-config queue, and the `sync-pull --merge` private
  temp staging. The live store is changed only through existing transaction
  writers or `storage-restore`.
- Remove the Archify diagrams. This deletes the vendored renderer
  (`vendor/archify`), the diagram sources (`docs/diagrams`) and outputs
  (`docs/assets/diagrams`), and the generation and check scripts, tests and
  `docs:diagrams*` npm scripts. The diagrams are no longer in the package.
  - The flows stay described in prose in `LOOP_SYSTEM_DESIGN.md`,
    `docs/REVISION_PROVIDERS.md` and `docs/CODE_ATTESTATION.md`.
  - The PR documentation job is renamed from `Verify generated Archify
    diagram` to `Documentation validation`, and the required context is
    renamed with it.
- Add `npm run test:landmines`, a dependency-free check in the fast, local
  and pre-push tiers. It is modelled on `interfere-inc/landmines` and fails on
  new behaviour-replacing mocks, fixed sleeps, retries and raised per-test
  timeouts in tests.
  - Existing occurrences are allowed with exact per-file counts that may
    only shrink.
  - The testing guide gains an "Honest tests: test landmines" section.
  - The flaky 1 ms provider deadline test no longer depends on winning a
    timing race.
- The external link check (Lychee) now runs only when publishing to npm, in
  the `verify` job on the self-hosted `forgeloop-linux-remote` runner. It no
  longer runs in the PR Core and Documentation workflows, where transient
  GitHub `503` responses blocked unrelated pull requests. A workflow test
  pins this policy.
- `forgeloop sync-pull --merge` combines whole tasks from both machines
  instead of replacing local state.
  - Every push and pull records a digest of each task. A merge classifies
    each task three-way against that base: take the remote task, keep the
    local one, or report a conflict.
  - A task changed on both machines, or overlapping active claims, fails with
    `E_SYNC_MERGE_CONFLICT` and changes nothing.
  - The merged state is built offline, sealed as a verified storage backup,
    and activated through the retained replace-active restore.
  - `--dry-run` reports the plan only.
- Add `forgeloop evidence-publish` (opt-in): it uploads redacted evidence
  bundles to the team dashboard, authenticated by `FORGELOOP_SYNC_TOKEN`.
  - Bundles wait in an offline queue under the user config directory, and
    every run retries it.
  - The remote stores each bundle once by digest.
  - The command exits `1` while a bundle stays queued or was rejected.
  - New error codes: `E_EVIDENCE_PUBLISH_CONFIG` and
    `E_EVIDENCE_PUBLISH_UNAUTHORIZED`.
- With `attestation.signing.provider: "sigstore"`, the automatic evidence
  export on `complete` signs the statement with `cosign attest-blob` before
  exporting, so the bundle carries the signature.
  - `evidence.signature.status` reports `SIGNED`, `EXISTING`, `FAILED` or
    `NOT_CONFIGURED`.
  - A signing failure still exports the bundle unsigned.
  - An existing signature is never replaced.
- `forgeloop complete --task <id>` exports the evidence bundle automatically
  when attestation mode is `required`. After a `VALID` completion it creates
  the attestation statement and writes `.forgeloop-evidence/<id>.json`. The
  result's `evidence` field reports `EXPORTED`, `SKIPPED` or `FAILED`, and a
  failed export never changes the completion.
  - Set `attestation.autoExportEvidence: false` to keep exports manual.
  - `attestation-create` now returns the statement already written for the
    current manifest (`reused: true`) instead of failing.
  - `audit` and `report` ignore the task's own exported bundle when they
    compare the receipt's changed paths, so they stay `VALID` after export.
- Evidence bundles accept task IDs containing dots (for example
  `release-2.2.0-final`); IDs with separators or a leading dot stay rejected.
- Align ForgeLoopAudit with the published 2.2.0 core: vendor the exact npm
  archive (SHA-512 verified against the registry, release commit 8b472a2) and
  update lineage, provenance, docs and tests; record the 2.2.0 publication
  identity.

## 2.2.0 - 2026-11-16

- Minor release. Its runtime changes are bound by
  `benchmarks/storage-sqlite/stable-2.2.0-writer-review.json.gz`, a delta
  review against 2.1.0 that gives an explicit role to every added filesystem
  binding (all in new modules; changed modules keep identical bindings).
- `sync-pull` is a maintenance-admission command like `storage-restore`; a
  test proves it leaves a project under retained maintenance unchanged.
- Add `forgeloop sync-push` and `forgeloop sync-pull` (cloud sync, phase 5).
  They hand a project's ForgeLoop state between machines as one snapshot per
  repository, encrypted on the client with `FORGELOOP_SYNC_KEY`. A pull is
  verified and activated only through `storage-restore`. A push based on a
  stale remote version is refused with `E_SYNC_CONFLICT`; ledgers are never
  merged. Sync tokens are issued and revoked from the hosted dashboard and
  stored only as hashes. See `docs/CLOUD_SYNC.md`.
- Cloud sync stores and sends ETags in their strong form, so a machine that
  just pulled is not refused on its next push when the edge weakens the ETag.
- Evidence bundles now carry an informational `metrics` block from the task
  ledger: total and per-phase durations, verification cycles, diagnoses, and
  check counts. It is self-reported and not bound.
- ForgeLoopAudit gains a hosted, read-only team dashboard entry
  (`npm run build:hosted`, `docs/HOSTED_DASHBOARD.md`) that renders evidence
  aggregated across repositories by the forgeloop-site API. Viewers sign in
  with Google and are allowlisted by verified email. An "Install GitHub App"
  button links to the ForgeLoop Evidence App installation page. A "Cloud sync
  tokens" section issues, shows once, lists and revokes sync tokens.
- Add `forgeloop evidence-export` and `forgeloop evidence-verify`: completed,
  attested tasks export a redacted, committable evidence bundle, and pull-request
  CI verifies changed-path coverage from the bundles without local `.forgeloop/`
  state. Unsigned bundles report `INTEGRITY_ONLY`; Sigstore signatures under the
  verifier's policy report `ATTESTED`. A later task's matching entry supersedes
  an earlier one for the same path. See `docs/EVIDENCE_BUNDLES.md`.
- Add the `integrations/github-action` composite action that runs
  `evidence-verify` and writes the result to the job summary.
- Add the read-only `forgeloop assess` command: for an existing repository it
  reports stack, frontend/backend/database/infrastructure/mobile areas, test
  inventory, deduplicated candidate checks (never executed), observed gaps, and
  a guide-routed review plan with a finding contract. See `docs/ASSESSMENT.md`.
- Verify the current stable writer review against its released tag tree, so
  post-release development no longer requires regenerating the published review;
  stable publication still requires a review of HEAD.
- Align ForgeLoopAudit with the published 2.1.0 core: vendor the exact npm
  archive (SHA-512 verified), update lineage, provenance and recaptured
  screenshots, and resolve its vite and fast-uri advisories.
- Record the 2.1.0 publication identity in the release checklist and status docs.

## 2.1.0 - 2026-11-14

- Extract the bounded pubspec YAML and .NET project XML parsers into
  `src/core/parsers/`, cap inline flow-map nesting at 32 levels (deep nesting
  previously overflowed the call stack), and add seeded malformed-input tests.
- Fail closed when a completion-recovery receipt is unreadable instead of
  treating every read error as an absent receipt.
- Report missing installed dependencies before running validation tiers and fix
  the `run-validation`/`ci-classify` entry guards that never ran on Windows paths.
- Guard `benchmarks/storage-sqlite` with a tracked-file budget and reject
  ambiguous `.gz.json` names; retire the RC2-only npm promotion path and the four
  comment-only historical stubs in `src/core`.
- Share one applicability gate across PR core setup steps and align
  `upload-artifact` v7.0.2 / `download-artifact` v8.0.2 pins.
- Load `LOOP_ENGINEERING.md` sections on demand from adapters, and refresh the
  .NET, Node.js and SQL specialist guides for the 2026-11 support landscape.
- Align ForgeLoopAudit with the exact published stable 2.0.0 archive, trusted
  schema provenance, current documentation and actual browser captures. Retain
  read-only authority and its separate unsigned-preview release state.
- Record stable npm identity, all three fresh latest-install audits and final
  hosted parity receipts without extending power-loss or production claims.
- Publish every error code emitted under `src/` in the `protocol-info` error
  registry: 159 previously unlisted codes ship as `PUBLIC_UNCLASSIFIED` (no
  stable compatibility promise), and a test now fails on registry drift.
- Bind stable storage admission to the exact package version: 2.1.0 carries its
  own delta writer review (identical filesystem bindings, explicit dispositions
  for every changed module) and the gate never falls back to an earlier report.
- Add navigation to `PROTOCOL_INTEGRATION.md`; create task contracts through
  `contract-create --contract-file` in the getting-started guide.
- Reference Taste Skill, Impeccable and GoogleChrome Modern Web Guidance in the
  design guides with provenance, licenses and versions; upstream Taste Skill
  tools now require 2.1.5 or later.

## 2.0.0 - 2026-10-18

- Advertise canonical SQLite as the sole supported operational writer after
  source-bound consumer review, native user checks and recovery/exclusion drills.
  Preserve explicit file-owned exports, attachments, configuration and maintenance
  evidence, fail-closed legacy admission, and operator exclusion requirements.
- Prepare the stable core package for npm latest with full verification and a
  fresh release-source hosted parity run; retain MCP restricted distribution.

- Add an optional focused revenue-centric design companion adapted from
  heliocosta-dev/revenue-centric-design, with Richard attribution, the complete
  custom source-available license, offline journey playbook and pinned references.

- Recover new failed review findings through current-cycle diagnosis and
  correction without editing protocol state or accepting passed review evidence.
- Add isolated unversioned npm `latest` audits on native macOS, Windows and Linux,
  including the review-correction lifecycle and fresh registry metadata.

- Bundle the optional commit-pinned Cloudflare security audit skill, upstream
  MIT license, report validators, offline integrity checker, and consumer guide.
- Review the full 23-guide catalog; correct accessibility default/contrast and
  keyboard guidance, optional design tooling, Flutter/Python routing claims,
  CPU-offloading advice, PHP source fallback, Rust release references, and
  runtime dependency notices. Add a catalog maintenance and revalidation map.

- Align public installation, Node 24.19.0 prerequisites, release-channel and
  SQLite documentation with the published RC4 and verified clean-user audits.

## 2.0.0-rc.5 - 2026-10-15

- Maintain ForgeLoopAudit inside this repository with its own build, verification
  and read-only Integration API boundary; exclude Audit from the core npm package.
- Update the runtime TOML parser to `smol-toml` 1.9.0 and align the MCP flat lock.
- Update development brace-expansion dependencies and the MCP test client to 2.2.0.
  Preserve the MCP server's pinned runtime version.
- Publish this release candidate to npm `next`; stable SQLite acceptance remains
  incomplete, and the default `latest` channel remains at RC4.

- Add ForgeLoopAudit setup, project inspection, view walkthrough and demo
  screenshots in a dedicated guide linked from the parent repository README.

## 2.0.0-rc.4 default channel - 2026-10-14

- Promote the existing public RC4 to owner-authorized npm `latest`; `next`
  also points to RC4. Preserve the published artifact and incomplete stable
  SQLite acceptance.
- Verify fresh unversioned npm installations on native Windows, macOS and
  Linux: all 15 new-user checks pass on each platform.

## 2.0.0-rc.4 - 2026-10-14

- Correct the archive-repair test to assert the platform-selected system tool
  on Windows. Preserve every repair and checksum assertion.
- Keep the existing RC3 tag after its publication was cancelled; RC4 carries
  the same runtime corrections with full Windows-suite validation.

## 2.0.0-rc.3 - 2026-10-14

- Restore SQLite backups containing real verification executions into another
  directory while preserving original execution bytes and roots. Foreign-root
  evidence requires an exact match in the verified retained restore snapshot.
- Use Windows' system archive tool so Git GNU tar cannot break first-run ZIP
  extraction of the pinned Repository Index engine.
- Refresh contended task-creation claims internally with bounded backoff and
  jitter, preserving atomic overlap checks and prepared-command identity.
- Add a clean-user package audit for Windows, macOS and Linux, including
  lifecycle completion and completed-task backup restoration.
- Require fresh full verification for RC3 runtime changes; the historical
  source-equivalent RC1/RC2 shortcut does not apply.

## 2.0.0-rc.2 default channel - 2026-10-14

- Add the owner-authorized tag-only promotion of existing RC2 to npm `latest`.
  Preserve the published artifact, `next`, and incomplete stable acceptance.

## 2.0.0-rc.2 - 2026-10-14

- Publish the owner-authorized public core package to npm `next` through GitHub
  with provenance. Preserve the immutable RC1 tag after its restricted npm
  publication was refused with `E402`; the MCP companion remains restricted.
- Keep runtime, resolved dependencies, fail-closed storage and stable acceptance
  unchanged. Validate the access policy with bounded package and release checks.

## 2.0.0-rc.1 - 2026-10-13

- Prepare the SQLite core as an explicit release candidate for npm `next`.
  Stable 2.0.0 migration acceptance remains incomplete; `soleSQLiteWriter`
  remains false, and no production data cutover is claimed.
- Add bounded RC verification, a source/import/writer inventory drift guard,
  exact runtime and resolved-dependency equivalence checks, and trusted
  baseline Windows evidence. No new full coverage or p95 claim is made.
- Keep stable publishing gated on sole-writer acceptance and full validation.
  RC publishing requires `next`, matching tag/version, restricted access,
  packed CLI/API/MCP smoke checks, and GitHub OIDC provenance.
- Admit the 2.0.0 RC explicitly in the MCP companion peer metadata without
  changing its runtime or resolved dependency versions.

- Prepare the breaking ForgeLoop 2.0.0 storage release and MCP 1.0.0 companion.
  SQLite cutover requires explicit legacy-writer exclusion and retained-source
  validation; legacy filesystem apply and ledger index sidecars are retired.
  The minimum Node.js runtime is 24.19.0. MCP requires a core 2.x peer and uses
  the local core only for development. Stable publication remains gated on migration acceptance; the RC uses the
  explicitly bounded policy described in the release checklist.

## 1.14.0 - 2026-09-24

### Added

- Added the provider-neutral `providerExtensions` architecture and reference
  contract. Provider output remains bounded observation data without lifecycle,
  evidence, completion, claim, ownership, installation, or command authority.

- Added the generated, deterministic, harness-neutral ForgeLoop Agent Skill
  with bounded freshness checks, references, documentation, and npm package
  coverage.

- Added optional OpenSrc advisory context for bounded, version-qualified
  external package and repository source recall without lifecycle, completion,
  evidence, or installation authority.

- Added the provider-neutral Browser Verification contract and the optional
  host-injected Agent Browser adapter. Both remain observation-only, use exact
  origin and process boundaries, and never auto-install browser tooling.

- Added the optional host-injected Emulated Services adapter for bounded
  loopback observations with explicit executable/version selection, argv-only
  process execution, temporary-state isolation, and fail-closed cleanup.

- Added the optional host-injected Security Review provider API. It provides
  bounded, cancellable observation-only findings with strict request/result
  snapshots and no lifecycle, evidence, completion, claim, ownership,
  installation, or command authority.

- Added the bounded, deterministic Audit UX read model as a read-only
  Integration API projection. It composes canonical lifecycle, health,
  verification, ownership, recovery, and completion data without becoming a
  mutation or lifecycle authority.

- Added explicit `task-abandon` for caller-acknowledged abandonment of active
  non-terminal tasks. It records an append-only `TASK_ABANDONED` boundary,
  releases claims through the validated recovery ownership model, preserves the
  current phase, and never fabricates completion or publication.

- Added the narrow `REVIEWING` repository-only bootstrap path to
  `reconcile-closure`, resolving the no-rejection completion dead-end without
  changing phase, fabricating completion events, or releasing active claims.
  Optional continuity absence is now reported as `NOT_APPLICABLE`, while
  present invalid continuity remains fail-closed.

- Added an optional host-injected Agent Browser verification adapter. It uses a
  host-supplied executable, never auto-installs Agent Browser or Chrome, runs a
  fresh isolated session with exact-origin validation, and returns only bounded
  observation metadata.

- Added the canonical `contract-revise` mutation for safe pre-execution
  contract replacement in `CONTRACT_READY`, `ROUTED`, and `PLANNED`. Revisions
  are append-only and transaction-witnessed, invalidate derived route,
  preflight, gate, and plan evidence, preserve descriptor claims, and reject
  execution-started or contract-bootstrap repair/migration tasks.
- Added contract-revision regression coverage for idempotency, concurrent
  callers, PLANNED-to-ROUTED rewind, canonical checkpoint/route evolution,
  historical contract identity, and forged rollback rejection.

- Added the canonical `checkpoint-revalidate` mutation and
  `REVALIDATE_CHECKPOINT` next action for safe, repository-only drift of a
  valid pre-execution `ROUTED` checkpoint. Revalidation preserves contract and
  route identity, binds an append-only audit event to the state revision, and
  fails closed for contract, route, artifact, ownership, or post-execution
  changes.

- Added first-class C, C++, Java, SQL, Go, TypeScript, PHP, and Swift
  specialist guides with bounded structural project detection, conservative
  source/build evidence, same-root composition, and nested ownership
  boundaries.
- Added regression coverage for malformed/adversarial language metadata,
  generated/vendor exclusions, direct source claims, SQL overlays, and the
  public framework routing contract while preserving projectEvidence schema v1.
- Documented structural .NET, ASP.NET Core, and conditional ABP routing,
  including scoped mixed-stack discovery, supported SDK evidence, bounded
  traversal, and overlay validation.
- Documented Astra task previews, exhaustive ownership-aware discovery,
  deterministic task-list filters and pagination, and bounded `next --explain`
  projections.
- Added the first-class Node.js backend engineering guide and registered it as
  the `nodejs` specialist in the canonical guide catalog.
- Added bounded Node.js project detection for allowlisted runtime backend
  dependencies, direct Node runtime scripts, and narrow server-builtin source
  imports while keeping supporting metadata non-authoritative.
- Added adversarial detection and routing coverage for frontend/tooling false
  positives, malformed or oversized manifests, nested workspaces, shared
  lockfiles, mixed Flutter/.NET/Node repositories, symlinks, and traversal
  budgets.
- Added the first-class Rust development engineering guide and registered it as
  the `rust` specialist in the canonical guide catalog.
- Added bounded, Cargo-first Rust project detection using structural TOML
  parsing for packages and virtual/package workspaces, with conservative
  nested ownership and shared-file scope handling.
- Added Rust regression coverage for workspace membership, toolchains, MSRV
  and edition metadata, malformed/oversized manifests, target/vendor ignores,
  symlinks, traversal budgets, cross-stack boundaries, and public routing.

### Changed

- Derived mandatory semantic safety-guide protection from the canonical
  deterministic route reasons in the router, so an `external-service` trust
  boundary can no longer lose its `security` guide to a high-confidence Jev
  exclusion; retained guides record `MANDATORY_SAFETY_GUIDE`. Live provider
  failures keep stable normalized codes while the smoke check reports only safe
  diagnostics (HTTP status, provider error type, request id, network class).
- Extended the routing schema, package checks, router reference, README, and
  package-contents documentation for the Node.js specialist.
- Extended the routing schema, package checks, router reference, README, and
  package-contents documentation for the Rust specialist. The runtime uses the
  approved exact `smol-toml` parser dependency; development tooling remains
  separate and no framework-specific Rust guide IDs were added.

## 1.12.0 - 2026-09-09

### Added

- Added the first-class Flutter application engineering guide and registered
  it as the `flutter` specialist in the canonical guide catalog.
- Added deterministic Flutter project detection from the structured
  `dependencies.flutter.sdk: flutter` entry in an affected `pubspec.yaml`.
- Added scope-aware routing so confirmed Flutter projects select the Flutter
  specialist with the baseline clean-code and test guides, while unrelated
  monorepo projects remain isolated.

### Changed

- Extended the routing documentation, package-boundary checks, and generated
  architecture documentation to describe the Flutter detection and specialist
  selection boundary.
- Hardened detection against documentation-only mentions, lockfiles, hosted
  packages named `flutter`, malformed YAML shapes, and symlink traversal.

### Compatibility

- Protocol v1, Schema v1, Integration API v1, and Node.js `>=20` support are
  unchanged.
- The runtime remains dependency-free; Flutter tooling is not installed or
  invoked by ForgeLoop automatically.

## 1.11.1 - 2026-09-09

### Changed

- Refreshed the README architecture image to reflect the current ForgeLoop
  entry points, canonical protocol, managed Repository Index, persistent CLI
  transport, and evidence boundary.

## 1.11.0 - 2026-09-08

### Added

- Added the mandatory ForgeLoop Repository Index and provider-neutral
  Repository Search capability, initially powered by a ForgeLoop-managed
  pinned Microsoft `tgrep` 1.0.3 engine.
- Added managed native provisioning with verified platform assets, live indexed
  search, `search`/`index-*` CLI commands, Integration API support, MCP
  discovery, and doctor readiness reporting.
- Added executable-level SHA-256 pinning and hash-before-version verification,
  warm per-repository search readiness with bounded recovery, path-safe public
  search/status projections, and real pinned native CI coverage on Linux,
  macOS, and Windows.
- Added a user-scoped persistent local search host for the CLI, with a
  versioned length-prefixed IPC protocol, ownership-checked startup/recovery,
  idle shutdown, same-repository contention serialization, and native
  cross-platform transport coverage. Integration API and MCP search remain
  direct canonical calls.

### Compatibility and operations

- The first setup may need network access unless the exact pinned release asset
  is preloaded with `index-setup --asset`.
- Supported initial platform keys are `darwin-arm64`, `darwin-x64`,
  `linux-x64`, and `windows-x64`. The project index is disposable cache data;
  search health does not rewrite task completion or evidence.

## 1.10.2 - 2026-09-07

### Added

- Added an optional host-injected Ripwire advisory context adapter to the
  public Integration API. Hosts provide an absolute executable path and exact
  version, then explicitly request ranked source signatures through
  `recallAdvisoryContext`.
- Added bounded Ripwire process transport, JSON mapping, path containment, and
  deterministic fixture coverage. The adapter validates the version immediately
  before each query and fails closed on unsafe or malformed output.

### Changed

- Documented the Ripwire adapter's advisory-only trust boundary, process
  contract, failure codes, verification commands, and repository-only retrieval
  benchmark.
- Audited the npm package boundary so the adapter, declarations, schemas,
  documentation, and governed diagram artifacts are shipped while tests,
  lifecycle state, benchmark results, and Ripwire benchmark fixtures remain
  excluded.
- Corrected dependency documentation to match the locked development toolchain:
  c8, ESLint, TypeScript, and YAML. The runtime remains dependency-free.

### Compatibility

- Protocol v1, schema v1, Integration API v1, and Node.js `>=20` support are
  unchanged.
- Advisory context remains lazy, opt-in, non-persisted, non-evidence,
  non-authoritative, and non-executable. Ripwire is not installed, discovered,
  or contacted automatically by ForgeLoop.

## 1.10.1 - 2026-09-05

### Added

- Exported `FORGELOOP_INTEGRATION_RUNTIME_VERSION` from the public
  `./integration` entry point. The constant was declared in
  `src/integration.d.ts` and used internally, but the module never re-exported
  it, so the declared name did not match the runtime surface.
- Added public type declarations for the existing
  `E_VERIFICATION_EXECUTION_INVALID` and
  `E_VERIFICATION_ISOLATION_UNAVAILABLE` codes and for
  `createStructuralQualityProviderRegistry` and
  `resolveStructuralQualityProvider`.
- Added `commands` and `commandSpecs` to the `RESOLVE_BLOCKER` result for
  `REVALIDATION_REQUIRED`, so `next` guides a safe pre-execution checkpoint
  refresh instead of leaving the blocker unexplained. `next` still writes
  nothing, and the suggested `clear-state` command remains a mutating
  operation the caller must authorize.
- Added the repository-only `transactions:compact` maintenance command for
  lock-safe transaction payload compaction. It retains every manifest and
  ledger, records `compactedAt`, skips non-terminal or recent transactions,
  and is not part of the published package.
- Added the `complexity:check` budget gate and deterministic test-selection
  tooling.

### Changed

- Audited the core npm package boundary and documented the intentional
  consumer contents and repository-only exclusions in
  `docs/PACKAGE_CONTENTS.md`.
- Added a source-completeness invariant so every maintained `src/**/*.js`
  runtime module is shipped, while the four retired compatibility helpers
  remain explicitly excluded.
- Added the clean-room package smoke gate to the tag-triggered npm
  publication workflow before trusted provenance publishing.
- Refreshed release documentation, package metadata, and generated protocol
  summary for the 1.10.1 patch release.
- Structured `successCriteria` entries and `contract.verification` now
  contribute execution-profile obligation signals; previously structured
  entries were stringified and never matched. `constraints` and
  `stopConditions` no longer contribute, and the `PUBLICATION` and
  `PRODUCTION_READINESS` requirement types force their corresponding
  signals. Profiles remain guidance only, and already-persisted routes are
  not re-derived.
- Split the lifecycle phase decisions in `next-action-phases.js` into
  per-phase modules. No `nextAction` value, reason code, phase name, or
  ordering changed.
- Widened `ForgeLoopStructuralQualityProvider` to accept either `observe()`
  or `detect()` plus `scan()`.
- Pinned the MCP adapter dependency to an exact version with a committed
  lockfile for reproducible verification.
- The receipt audit workflow now always runs and reports `NOT_VERIFIED` when
  no lifecycle receipt is supplied, instead of silently skipping. This is a
  CI reporting change only; no protocol artifact, CLI result, or Integration
  API response is affected.

### Fixed

- Task transactions now bind to the canonicalized physical project root.
  Reusing an active transaction against a different project fails closed with
  `E_TASK_CONTEXT_MISMATCH` across every transaction-aware read and write.
- `ROLLED_BACK` and `ABORTED` transactions are now terminal, so `doctor` and
  `inspect` no longer report a completed rollback or a pre-publication abort
  as `E_TRANSACTION_INCOMPLETE`.
- Transaction recovery now runs under the transaction's task lock and
  re-reads the manifest inside the lock, skipping any transaction another
  writer already advanced past `COMMITTING`, so recovery no longer races a
  live writer.
- Rollback replay validates every recorded write path with a symlink-aware
  check before unlinking or renaming.

### Compatibility

- Protocol v1, schema v1, Integration API v1, and Node.js `>=20` support are
  unchanged. `protocol-info --json` is unchanged apart from `packageVersion`,
  and no schema was modified.
- Observable additions for consumers that read `.forgeloop/` directly:
  `.forgeloop/.txn/<id>/manifest.json` gains an optional `lockTaskId`, its
  `status` domain gains `ABORTED` for the pre-publication abort case, and it
  gains an optional `compactedAt` after maintenance compaction. A reader that
  validates transaction status against a closed set must accept `ABORTED`.
- The four retired compatibility helpers `src/core/gates.js`,
  `src/core/decision-classification.js`, `src/core/workflow-compatibility.js`,
  and `src/core/cli-metadata.js` are excluded from the published tarball. The
  package `exports` map already prevented deep imports of them.

## 1.10.0 - 2026-09-02

### Added

- Added the provider-neutral advisory context contract and explicit
  `recallAdvisoryContext` Integration API service with portable-context safety,
  allowlist normalization, authority stripping, bounded budgets, and
  deterministic item fingerprints.
- Added `handoff-accept` and derived `OPEN`, `ACCEPTED`, `UNBOUND`, and
  `INCONSISTENT` acceptance projections for immutable handoffs.
- Added deterministic continuity semantic linting for contradictory or stale
  operational hints.

### Changed

- Canonical handoffs now bind exact work-state snapshots and coherent
  contract, route, changed-path, and repository branch/HEAD identities.
- Handoff acceptance checks current checkout freshness, invalid ledgers fail
  closed, and concurrent acceptance is exactly once with same-consumer retry
  idempotency.
- Published `canonicalHandoffs` capability version 2 and mirrored the
  `advisoryContextProviders` capability version 1 across public surfaces.

### Security / trust boundary

- Advisory context remains lazy, opt-in, non-persisted, non-evidence,
  non-authoritative, and non-executable. Provider output is never canonical
  state, completion truth, or next-action authority.
- Handoff acceptance remains an operational receipt only. It transfers no
  claims and creates no evidence, delegation, review, or authority.

### Compatibility

- Protocol v1 unchanged.
- Schema v1 unchanged.
- Integration API v1 unchanged.
- Node.js `>=20` support unchanged.

## 1.9.0 - 2026-09-02

### Added

- Added a provider-neutral structural-quality feedback loop with immutable
  task baselines, five normalized root-cause metrics, deterministic delta and
  dimension budgets, and `off`/`observe`/`gate` modes.
- Added bounded Sentrux MCP stdio integration, `quality-baseline`,
  `quality-verify`, and read-only `quality-status` surfaces across the CLI,
  integration API, and MCP projections.
- Corrected Sentrux MCP tool argument schemas (`scan` requires `path`, `health`
  requires empty object) and handshake tool schema validation.
- Added source material fingerprinting and mid-scan source drift detection (`E_STRUCTURAL_QUALITY_SOURCE_DRIFT`).
- Added single-session provider observation (`observe()`) and decoupled provider-specific rule files from core.
- Added measurement model compatibility checking across `measurementModel` and `compatibilityKey`.
- Relaxed default dimension budgets to unenforced (`null`) with strict aggregate non-regression and cycle prevention.
- Added two-phase scan execution outside task mutation lock with atomic reservation and projection reconciliation on retry.
- Added typed, atomic, task-scoped quality artifacts, bundle validation,
  completion provenance checks, and corrective lifecycle guidance.
- Hardened structural-quality freshness with canonical provider scope binding,
  fail-closed source fingerprints, explicit verified Sentrux versions, and
  freshness-aware recovery, status, next-action, provenance, and completion
  decisions.

### Verification boundary

- Structural quality remains separate from behavioral, security, performance,
  accessibility, review, publication, and production-readiness evidence.
- Sentrux is optional and user-managed; ForgeLoop does not install it, change
  analytics preferences, or claim built-in static analysis or a universal
  software-quality score.

### Changed

- Published the canonical read-only `task/structural-quality` Integration API
  resource and advertised its Structural Quality capability in `protocol-info`.
- Added clean-room package-consumer coverage for public Integration API imports,
  initialization, provider-absent `quality-status`, packaged schemas, and
  referenced diagrams without installing Sentrux.
- Verified Sentrux 0.5.7 interoperability while keeping Architecture Rules
  provenance separate from the provider-neutral Structural Quality signal.
- Corrected Windows path-containment comparisons for case-insensitive realpath
  results and retained cross-platform regression coverage.
- Kept `@cassiomc1/forgeloop-mcp` on its compatible `>=1.5.0 <2` core range;
  no cosmetic MCP release is required for this additive core release.

## 1.8.1 - 2026-09-01

### Fixed

- Removed historical raw and aggregate benchmark results from the core npm
  package while retaining the scenario definitions required to run new
  measurements.
- Hardened the GitHub Actions npm publication workflow with fail-closed
  candidate-version and package-content checks while retaining trusted OIDC
  publication and provenance.

## 1.8.0 - 2026-08-31

### Added

- Added methodology-v2 benchmark evidence with optional host-reported
  diagnostics, robust P25/P50/P75/P90/P95, IQR/MAD, deterministic
  `TOKEN_IQR_1_5` outlier classification, and explicit tail analysis.
- Added benchmark runner tiers (`smoke` 1–3, `evidence` 5–10, `tail` 20–30)
  and preserved the real-host repeat sets for balanced, quality, and tail
  comparisons.

### Changed

- Corrected comparative populations so paired statistics use matching run
  metadata and distribution statistics remain separately reported.
- Documented the distinction between `pairedOverheadPercent` and
  `distributionDeltaPercent`, including `LOW_BASELINE_TOKEN_REGIME`,
  `TAIL_PAIRED_RATIO_SENSITIVE`, `TAIL_DISTRIBUTION_REGRESSION`, and
  `TAIL_UNRESOLVED` interpretations.
- Kept historical benchmark methodology-v1 run sets and aggregates immutable;
  readers continue to accept benchmark versions `1` and `2`.

### Verification boundary

- Diagnostics, tail status, outlier classification, and efficiency warnings
  remain observational benchmark evidence. They never change lifecycle
  phases, required gates, verification truth, authority, provenance, safety
  floors, or completion validity. Unavailable telemetry stays `null` or
  `UNKNOWN` rather than being estimated.

## 1.7.0 - 2026-08-30

### Added

- Added schema-validated execution-profile benchmark scenarios, a host-adapter
  runner, reproducible raw/aggregate results, and summary/validation commands.
- Added the NovaTask static SaaS landing-page reference scenario, optional
  host-reported context usage, observational `CONTEXT_INFLATION` diagnostics,
  and a non-blocking CI efficiency regression report.
- Added the read-only `task/context` integration projection and MCP resource
  for bounded profile-aware host context.
- Added explicit benchmark methodology and profile invariant documentation.

### Changed

- Expanded profile-aware context guidance without changing lifecycle chronology,
  required gates, verification truth, authority, provenance, safety floors, or
  validator-backed completion.
- Advertised the canonical `task/context` resource and its resolved-profile
  authority explicitly through the integration capability handshake.
- Updated package metadata and release identity to 1.7.0.

### Verification boundary

- Benchmark claims remain observational and require actual provider/host
  telemetry, timing, PASS verification, and matching comparability metadata.
  Without those inputs, the summary remains `NOT_MEASURED` or
  `NOT_COMPARABLE`.

## 1.6.5 - 2026-08-30

### Fixed

- Fixed npm package contents so `forgeloop init` ships the required
  `AGENT_COMPATIBILITY.md` compatibility template.

## 1.6.4 - 2026-08-30

### Added

- Added optional task workspace binding, immutable cross-harness handoff
  envelopes, responsibility constraints, verification-scope planning, and
  provider-neutral code attestation.
- Added revision-provider and signing-provider contracts, in-toto statements,
  complete revision-range coverage checks, generic CI verification, and
  stable attestation exit-code handling.
- Added generated shell completions, a concise agent protocol summary,
  platform-adapter guidance, package smoke checks, and Windows full-suite CI.

### Changed

- Refactored next-action resolution into a compact orchestration layer with a
  phase-oriented resolver while preserving existing lifecycle behavior.
- Expanded protocol documentation, schemas, MCP capability metadata, and
  audit/bundle validation for the new optional artifacts.
- Refreshed the documentation diagrams with dark-first animated HTML/SVG
  sources, reduced-motion handling, text fallbacks, deterministic receipts,
  and source-bound visual reviews.

## 1.6.3 - 2026-08-28

### Fixed

- Removed the final Portuguese sentence from the shipped README so the npm
  package documentation is consistently English-only.

## 1.6.2 - 2026-08-28

### Fixed

- Docs quality link checks now exclude the intermittently unavailable Cursify
  reference while keeping the documentation link visible.

- The README and Getting Started guide now document global CLI installation,
  including the `npm install --global @cassiomc1/forgeloop` command.

- Shipped package documentation remains English-only, with no temporary
  localized documentation included in the npm package.

## 1.6.1 - 2026-08-27

### Fixed

- Verification execution now rejects contradictory isolation mode,
  filesystem-write, and network guarantees before evidence persistence.

- Verification execution now has an explicit trusted adapter boundary with
  disposable project/system isolation metadata, separate protocol and
  execution roots, bounded output provenance, and fail-closed handling when
  the required isolation capability is unavailable.

- Post-#101 durable-action corrections: trusted `COMMITTED` reconciliation now
  replays exactly once (the reconciled `ACTION_COMMIT_RECORDED` mirror is a
  validated same-revision corroboration, never a second transition, and forged
  mirrors invalidate the ledger); action verification requires an independent
  passed execution covering the action's exact immutable requirement; new
  required-for-completion actions must declare a non-empty requirement (legacy
  artifacts remain readable but classify UNTRUSTED); trusted reconciliation
  authority now propagates through the programmatic command executor and MCP
  provider boundaries; readiness and audit validate bound approval
  fingerprints for `REQUIRE_APPROVAL` authorizations; public provenance
  metadata now matches actual behavior (`CALLER_REPORTED` /
  `EXTERNAL_OBSERVED`); `executeDurableAction()` returns canonical
  `authorization` evidence.

- Completion-recovery fingerprint deadlock: a `REVIEWING` task whose persisted
  evidence-only rejection snapshot no longer matches the live checkpoint (after
  repository drift or a recovery/resume cycle) could not reach closure through
  any sanctioned path. `reconcile-closure` and the `REVIEWING -> VERIFYING`
  recovery transition now rebind the rejection append-only when — and only when
  — the logical fields (`verificationCycle`, sorted `reasonCodes`, sorted
  `missingRequirementIds`) are identical between work-state and the latest
  matching ledger rejection; the rebound `COMPLETION_REJECTED` event carries the
  current fingerprints and references the superseded snapshot via
  `reboundFromStateFingerprint`. Logical differences still fail closed.
- Checkpoint restoration is chronology-aware: when `preflight` recreates a
  missing work-state from preserved contract/route artifacts, the resume phase
  is derived from the validated ledger milestones instead of always restarting
  at `ROUTED`, so restored tasks never append duplicate non-repeatable lifecycle
  milestones such as `EXECUTION_STARTED`.
- Mid-lifecycle preflight refresh: a `PREFLIGHT_READY` re-recorded after later
  execution/verification milestones no longer invalidates the ledger as
  out-of-lifecycle-order; re-readiness keeps its prerequisite and compatibility
  guards while allowing legitimate policy/contract refresh cycles.
- Preflight re-readiness after a blocked cycle: an append-only lifecycle may
  contain a `PREFLIGHT_READY` that was superseded by a later `PREFLIGHT_BLOCKED`
  outcome (contract evolution, added gate requirement). The compatibility check
  now binds to the latest preflight outcome, so resolving the blocked preflight
  appends a fresh `PREFLIGHT_READY` with current details; a READY refresh whose
  details differ without an intervening BLOCKED outcome is still refused, and
  `PREFLIGHT_READY` joined the repeatable milestones so the rebound event keeps
  the ledger valid while milestone-order guards remain in force.

## 1.6.0 - 2026-08-24

### Fixed

- Structured diagnostic cases now satisfy every legacy diagnosis gate: one
  canonical resolver (`diagnostic-projection.js`) backs `DIAGNOSING ->
  CORRECTING`, `CORRECTING -> VERIFYING`, `next`, and `progress`; structured-only
  tasks no longer hit `E_DIAGNOSIS_REQUIRED` and no duplicate legacy event is
  written.
- Hypothesis dispositions validate against an authoritative append-only state
  projection (`hypothesis-projection.js`) using the canonical transition table;
  terminal states fail closed instead of resetting to `OPEN`.
- `inspect --task` reads the selected task's raw work state (task-isolated) and
  feeds raw state (not the classified wrapper) to progress evaluation; human
  output renders a full task inspection report.
- Trace correctness: check-attempt cardinality is ledger-primary with
  deterministic deduplication against state checkpoints; phase chronology is
  reconstructed forward (`RECEIVED`..`COMPLETE`) including `VERIFICATION_STARTED`
  and derived `DIAGNOSING`/`CORRECTING`; the phantom
  `VERIFICATION_STARTED_PLACEHOLDER` is gone; diagnostic revision chains are
  revalidated at read time.
- `trace.failureSignatures` / `failureSurfaces` are populated from the canonical
  failure-analysis projectors and reflection consumes them instead of rebuilding;
  per-cycle signature sets are real.
- Information Gain v2 is computed centrally (`information-gain.js`,
  `information-gain-projection.js`) for progress/reflect/next/inspect/continuity;
  `STALLED` is reachable; semantic noise never counts as gain.
- Evidence hardening: structured cases require >=1 hypothesis, observation
  evidence must resolve in the active cycle, `VERIFICATION_FAILURE` cases must
  bind failed/blocked active-cycle evidence.
- Continuity `doNotRepeat` requires semantic repetition plus two completed
  post-intervention verification cycles plus unchanged failure surface
  (repetition alone is not non-informative).
- Capability advertising aligned via additive
  `features.observabilityStability`; `E_TRACE_SNAPSHOT_INCONSISTENT` and all
  diagnosis/progress codes registered as stable public error codes.
- Information Gain v2 is single-source: one authoritative per-cycle cycle
  analysis computes all dimensions before `effectiveGain`; no consumer
  recomputes or post-mutates gain truth; semantic noise (IDs, timestamps,
  ordering) never creates gain or false hypothesis elimination.
- Successful verification cycles are projected explicitly as `surface: []`,
  enabling deterministic full-recovery classification of interventions as
  `IMPROVED`.
- `hypotheses.minItems = 1` is enforced identically by the JSON schema, runtime
  validator, event-ledger validation, and the record-diagnosis command path.
- `record-intervention` reports `repeatedSemanticIntervention` with retrospective
  `effectiveness: "PENDING"` instead of claiming `without gain` before any
  later verification exists.
- Continuity `diagnosticContext.activeFailureSignatures` now carries canonical
  failure-signature hashes scoped to the active cycle, with requirement names
  exposed separately via `activeFailedRequirements`.
- Package metadata synchronized: `package.json` and `package-lock.json` both
  identify 1.6.0.
- Unified structured-diagnostic stall semantics across phase, progress,
  reflection, next-action, and task inspection; all meaningful Information
  Gain v2 dimensions, including new observations, contributors, and semantic
  hypothesis elimination, now participate in effectiveGain. Stall is fail-fast,
  recoverable by meaningful new diagnostic information, and oscillation keeps
  the more specific INTRODUCE_NEW_OBSERVATION guidance.

### Added

- Unified observability and diagnostic intelligence (Protocol v1 additive):
  read-only `history`, `trace`, and `reflect` commands reconstructed from the
  canonical event ledger through a shared snapshot/trace projection core
  (`buildTaskSnapshot`, `buildTaskTrace`); structured diagnostic cases with
  observations, multifactor contributors, multiple falsifiable hypotheses,
  semantic fingerprints, and append-only revision chains via
  `record-diagnosis --file`; `record-intervention` and
  `record-hypothesis-disposition` mutation commands; information-gain v2
  dimensions, failure signatures, failure surfaces, strategy fingerprints, and
  oscillation detection; task-level `inspect --task` additive
  `taskInspection` section; continuity `diagnosticContext` with bounded
  `doNotRepeat`; `next` diagnostic guidance (`REQUIRE_NEW_DIAGNOSTIC_INFORMATION`,
  `INTRODUCE_NEW_OBSERVATION`, `RECORD_INTERVENTION`) without changing existing
  actions; `protocol-info` capability advertising; three new public schemas
  (`diagnostic-case`, `intervention`, `hypothesis-disposition`) and new stable
  error codes. Legacy single-hypothesis diagnosis remains fully valid.

## 1.5.0 - 2026-08-23

### Added

- Transport-neutral programmatic integration API v1 at
  `@cassiomc1/forgeloop/integration`: structured command executors and runtime,
  shared semantic input validation, invocation-level risk classification, and
  canonical integration resources including task/ownership derived exclusively
  from the validated claim resolver.
- Separate local MCP package (`@cassiomc1/forgeloop-mcp`, official SDK):
  deterministic tool/resource catalogs generated from canonical metadata,
  immutable project root, explicit taskId on task-aware mutations, launch-level
  capability gates (external execution, maintenance, recovery, legacy repair,
  force), and no generic shell.
- Optional stateless HTTP transport (`forgeloop-mcp-http`, PR12 hardened):
  strict modern MCP 2026 only (legacy traffic rejected), loopback-only binding
  (non-loopback refused with `E_MCP_REMOTE_NOT_SUPPORTED`), DNS-rebinding
  protection, bounded request bodies (413), header/request/keepalive timeouts,
  in-flight ceiling (503 `E_MCP_HTTP_BUSY`), POST-only, and no session-based
  authority.
- Hardening: bundle is MAINTENANCE-gated; launch `maxExecutionTimeMs` is
  enforced on every external-execution invocation; project roots resolve
  through canonical CLI semantics (symlinks rejected); integration input and
  output limits bound the transport surface; client-visible errors redact
  secret-shaped values while preserving canonical codes; a real
  `forgeloop_capabilities` tool reports versions, features, policy, and
  resources in every server mode.
- Closing pass: structured MCP input is byte-bounded
  (`E_MCP_INPUT_TOO_LARGE`); output bounds apply to command tools,
  `forgeloop_capabilities`, and every integration resource through one
  canonical helper (`E_MCP_RESULT_TOO_LARGE`); capabilities reports the real
  installed ForgeLoop core version; the documentation manifest
  `packaged:true` set is invariant against the core tarball; HTTP timeout
  bounds are observable and concurrency shedding (503 `E_MCP_HTTP_BUSY`) is
  deterministically proven; stdio/HTTP catalog parity is verified at the
  transport level across representative modes.
- MCP output bounds now measure the exact UTF-8 serialization transmitted,
  including pretty-printed tool/resource text; unrelated serialization failures
  are not misclassified as output overflow.

- `forgeloop task-repair-legacy-recovery`: migrates one recognized legacy `OPERATOR_RECOVERY_RECORDED` boundary event (no `recoveryId`) into the modern durable recovery representation via an append-only `LEGACY_RECOVERY_MIGRATION_RECORDED` tail event plus a transactional `recovery.json`; the original ledger event is never modified, ambiguous or tampered evidence fails closed, and ordinary mutation stays blocked until `task-resume`.
- Durable task recovery state in `recovery.json`, explicit `task-resume` claim reacquisition, and recovery-aware `forgeloop next` command specifications.
- A canonical validated claim-state resolver, deterministic recovery-history classifier, public ownership/claims-lock errors, protocol capability metadata, tamper conformance corpus, and invariant coverage.

### Changed

- `task-recover` accepts only `STALE` and `ABANDONED`, preserves lifecycle evidence, and records caller acknowledgement without presenting it as host attestation.
- Recovered tasks reject ordinary mutations until `task-resume` reacquires conflict-free claims under the project claims lock.
- Recovered tasks are excluded from implicit mutation-active selection; `TASK_RECOVERY_RESUMED` is meaningful activity and prevents immediate abandoned reclassification.
- Task and project claim locks distinguish absent, live, stale, unknown, and corrupt evidence; `task-resume` and project claim acquisition CAS-settle only unchanged stale leases.
- `COMPLETE` tasks report mutation disabled, and task contexts expose only the canonical `.forgeloop/locks/<taskKey>.lock` path.

### Security and reliability

- Legacy recovery repair CAS-settles only unchanged stale task locks; live, unknown, and corrupt locks are refused with the lock preserved.
- `alreadyRepaired` requires a fully valid canonical recovery relationship, not just matching identifiers.
- Helper claim APIs (`effectiveTaskClaims`/`taskClaimProjection`) no longer infer completion release from phase alone.
- Claim-state classification is side-effect free over the collected evidence.
- Legacy recovery migration v1 accepts only CALLER_ACKNOWLEDGED authority.
- COMPLETE task claim release now requires canonical lifecycle/ledger proof; manually or inconsistently terminal state fails closed and retains historical claim ownership.
- Task lock classification now rejects incomplete owner identity metadata as UNKNOWN rather than inferring live or stale ownership.
- Implicit task selection distinguishes read-only inspection from mutation.
- Claim-state and conflict inspection reuse validated ownership evidence within one snapshot while preserving TOCTOU revalidation boundaries.
- Claim ownership now requires a validated relationship between the task descriptor, work state, recovery artifact, and complete append-only recovery history before recovery can release claims.
- Fake, missing, corrupt, deleted, or mismatched recovery state fails closed, preserves every provable historical claim, and cannot restore mutation authority.
- Unhealthy task namespaces block claim acquisition when ownership cannot be proven; ordinary mutation and portable bundle export also reject inconsistent ownership.
- Stale task and project claim locks are released only when the observed lock ID, heartbeat, and owner instance remain unchanged, and recovery preconditions are revalidated under deterministic lock ordering.

### Compatibility

- The repository core package is now `1.5.0`; ForgeLoop protocol remains `1`; Integration API remains `1`. `protocol-info` advertises validated claim recovery version 1 and `features.integrationApi` version 1.
- A project containing active `task-recovery` schema v1 state still requires ForgeLoop `>=1.4.0`; older readers that do not understand validated recovery ownership must refuse the project rather than infer claims from `task.json` alone.
- The MCP package (`@cassiomc1/forgeloop-mcp`) requires ForgeLoop `>=1.5.0 <2`.
- Repository implementation state is separate from external publication; no npm publication, tag, or release is performed by these tasks.
- The ledger continues to write `OPERATOR_RECOVERY_RECORDED` for PR #66 reader compatibility, while its authority is explicitly `CALLER_ACKNOWLEDGED`; readers also accept the neutral `TASK_RECOVERY_RECORDED` name.
- `--operator-authorized` remains a deprecated alias for `--acknowledge-recovery` and does not create host authority. The standalone CLI does not self-issue `HOST_ATTESTED` recovery grants.
- Release preparation is local only; no package publication, tag, or release is performed by this implementation task.

## 1.3.0 - 2026-08-20

### Added

- Transaction journaling for safer multi-artifact protocol mutations.
- Monotonic work-state revision tracking and stale-writer conflict detection.
- Serialized event ledger appends with stronger concurrency guarantees.
- Lease-aware task locking and task lock inspection.
- Bounded verification command execution with timeout and termination metadata.
- Public `protocol-info` compatibility handshake and protocol migration support.
- Expanded protocol conformance scenarios, golden schema fixtures, and scale tests.
- Package smoke validation, executable documentation examples, and documentation health reporting.
- Contributor, security, changelog, issue, and pull-request governance files.

### Changed

- Strengthened execution, work-state, event, lock, completion, diagnosis, migration, and resumability behavior.
- Expanded CLI command metadata and documentation generation.
- Improved troubleshooting, CLI reference, artifact reference, continuity, protocol integration, system design, and execution-state documentation.
- Strengthened GitHub Actions coverage for package validation and ForgeLoop auditing.

### Compatibility

- npm package version advances to `1.3.0`.
- ForgeLoop remains protocol-version compatible with the supported v1 contract unless `forgeloop protocol-info --json` reports otherwise.
- Existing legacy compatibility and migration paths remain covered by regression tests.

### Security and reliability

- Protocol mutations gain stronger crash and concurrency protection.
- Verification commands gain bounded termination behavior.
- Task locking gains lease and staleness semantics.
- Release and package validation gain additional smoke and documentation checks.

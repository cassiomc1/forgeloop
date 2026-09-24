# ForgeLoop 1.10.0 Ecosystem Release Evidence

Recorded 2026-09-02 after the ForgeLoop, ForgeLoopStudio, and ForgeLoopBridge
pull requests were merged and their public release identities were verified.

## ForgeLoop publication

- Release PR: [#146](https://github.com/cassiomc1/forgeloop/pull/146), merged
  from the exact validated head.
- Release commit: `3bf721bac6a09c6291bfcbc507a66a2833ebddf4`.
- Tag: [`v1.10.0`](https://github.com/cassiomc1/forgeloop/releases/tag/v1.10.0),
  pointing to the release commit.
- Registry version: `@cassiomc1/forgeloop@1.10.0`.
- npm dist integrity:
  `sha512-K9vXhTdFybOnARYPqLKwAAffWg7ZpW9VH7kdT/muZ/tHUiyRpEIftK1GKUAi1urN8uKBppS1EpXGHpCuau8BEA==`.
- Publication workflow: [GitHub Actions run 33685983024](https://github.com/cassiomc1/forgeloop/actions/runs/33685983024), successful.
- Release-notes workflow: [GitHub Actions run 33685983105](https://github.com/cassiomc1/forgeloop/actions/runs/33685983105), successful.
- Clean consumer `npm install`, `npm exec`, `npx`, and public Integration API
  smoke verified package `1.10.0`, canonicalHandoffs v2, and advisory
  context trust metadata. Publication used GitHub Actions trusted publishing;
  no local `npm publish` was used.

## Companion synchronization

### ForgeLoopStudio

- Sync PR: [#83](https://github.com/cassiomc1/ForgeLoopStudio/pull/83), merged.
- Final main commit: `94fab2d27decda5c95d89d2b88f55ff3578d46da`.
- Studio version: `0.1.0-rc.7`.
- Vendored archive:
  `vendor/cassiomc1-forgeloop-1.10.0-3bf721b.tgz`.
- Vendored archive SHA-256:
  `d0973751dc5f193349fb7bb0e7cfd2bd9b394415b9620c725964562d558ef901`.
- Schema provenance SHA-256:
  `08fcbf1918408720639d46144a2d4524e1e9053bbfaf6c5d1ebb0af18e408138`.
- Provenance points to ForgeLoop release commit
  `3bf721bac6a09c6291bfcbc507a66a2833ebddf4`.
- All 9 required PR checks passed, including macOS, Ubuntu, Windows, and
  CodeQL lanes.

Studio consumes the canonical handoff and continuity projections read-only.
Acceptance is displayed as an operational receipt only; it creates no
authority, evidence, or claim transfer. Advisory context is capability display
only and is not loaded automatically.

### ForgeLoopBridge

- Sync PR: [#27](https://github.com/cassiomc1/ForgeLoopBridge/pull/27), merged.
- Final main commit: `2fd4c35fc165adfe49c1c8c887aacf7e75e8df1e`.
- Bridge API: `2.1.3`.
- Typed message schema: v1.
- All 7 required PR checks passed, including Linux, macOS, Windows, and
  CodeQL lanes.

Bridge remains transport-only. It adds no ForgeLoop dependency, provider,
memory persistence, advisory recall, or automatic handoff acceptance. A
`HANDOFF_NOTICE` remains distinct from receiving-harness `handoff-accept`.

## Compatibility matrix

| Component | Version | Protocol | Schema | Integration API | Handoffs | Advisory context |
| --- | --- | --- | --- | --- | --- | --- |
| ForgeLoop | 1.10.0 | v1 | v1 | v1 | canonicalHandoffs v2, exactly-once | provider v1, lazy/opt-in |
| ForgeLoopStudio | 0.1.0-rc.7 | v1 reader | v1 trusted copy | v1 | read-only acceptance projection | capability display only |
| ForgeLoopBridge | 2.1.3 | v1 coordination target | not authority | v1 coordination target | transport/copy only | transport boundary only |

## Cross-repository verification

All three repositories use the same capability-first terminology and trust
boundary:

- `canonicalHandoffs` v2 has `OPEN`, `ACCEPTED`, `UNBOUND`, and `INCONSISTENT`
  statuses; acceptance is exactly-once and an operational receipt only.
- `advisoryContextProviders` v1 is lazy, opt-in, provider-neutral,
  Integration API-only, non-persisted by ForgeLoop, non-authoritative,
  non-evidence, and non-executable.
- Work-state remains lifecycle truth; continuity remains operational context;
  continuity lint remains non-authoritative diagnostics.
- Protocol v1, schema v1, and Integration API v1 remain unchanged.
- Security and performance audits found no provider credential storage, hidden
  recall path, authority promotion, automatic handoff acceptance, or new
  default polling process.

Bridge and Studio platform CI was green. ForgeLoop's optional MCP test command
reported its documented setup prerequisite, and no missing optional dependency
was installed; the MCP package smoke and the remaining release gates passed.

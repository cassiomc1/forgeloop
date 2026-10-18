# Quality gates

The current release is ForgeLoopAudit `0.3.0-rc.3` with vendored ForgeLoop
`2.0.0` at `4ff11bb4bc4be39b095a151a323f1388dad0d819` (protocol v1, schema v1,
Integration API v1). `npm run verify:full` is the shared fail-fast contract.

ForgeLoop 2.0.0 uses SQLite operational storage and requires Node.js
24.19.0 or newer. Native task discovery, summary and inspector reads use the
public Integration API; database/WAL changes invalidate cached observations.
Legacy JSON remains `ARTIFACT_ONLY`. Audit never migrates inspected projects.
Raw native ledger and JSON previews are unavailable; use canonical projections.

## Local contract

The contract verifies, in order:

1. vendored ForgeLoop lineage and package/version lineage;
2. dependency policy and the high/critical production audit;
3. schema provenance, deterministic demo integrity and documentation
   conformance;
4. TypeScript, ESLint, unit tests, release-contract tests, coverage and
   critical coverage;
5. measured performance budgets;
6. the production renderer/server build; and
7. npm package contents.

The web-specific smoke command is:

```bash
npm run test:web-smoke
```

It starts the built loopback server, bootstraps a same-origin browser session,
checks dark/light theme switching, traverses the audit navigation and verifies a
live watcher update. The screenshot command uses the same web server and
Playwright Chromium path.

## CI matrix

The CI workflow runs `npm run verify:full` on Ubuntu, macOS and Windows. It then
installs Playwright Chromium and runs the web smoke suite. CodeQL remains the
repository-level static-analysis authority; this project does not add a second
overlapping CodeQL workflow.

The matrix proves the configured platform checks. It does not prove registry
publication, production deployment, signing or notarization.

## Coverage boundary

Pure protocol, path-boundary, server security and renderer contract logic is
covered by Vitest and browser smoke tests. Process bootstrap, filesystem access
and browser behavior are verified through the web server test and Playwright
instead of being hidden in a renderer-only coverage denominator. Missing
optional ForgeLoop capabilities are tested as explicit unavailable states.

## Required verification commands

```bash
npm run verify:full
npm run test:web-smoke
npm run screenshots:readme
npm run screenshots:check
```

Do not infer publication, signing, deployment or completion authority from a
green local command or a green CI job.

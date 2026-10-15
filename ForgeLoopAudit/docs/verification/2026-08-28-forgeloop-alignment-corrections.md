# ForgeLoop Alignment Corrections Verification

> Historical record. This document records a specific verification run and repository state. It is not the current ForgeLoopAudit specification. See the [current documentation index](../README.md).

**Date:** 2026-08-28 09:51 BRT
**Scope:** Post-1.6.1 alignment corrections from `FORGELOOP_AUDIT_POST_1_6_1_CORRECTIONS.md`

## Source identity

- Audit implementation commits verified: `69e284a7ff04a8b725f89ac77b73295b52a8fbce` (capability-gated UI) and `e9f89df335ec47ad46ec1b2d54e41f94aa0b52d4` (fail-closed helper plus unavailable-capability presentation coverage)
- Audit verification record introduced in commit: `5fef9c08410c05d653db8f405145be3c9d19cae5`
- Audit code head for the reviewed correction: `e9f89df335ec47ad46ec1b2d54e41f94aa0b52d4`
- Final branch commit validated locally: `7704d4824984400fc800b6d89178531a8c4b5227` (documentation-only commit carrying the code head above)
- Independent review range: `3059187dd8ca63e229add17cecdf06e6575c2757..950c86fcd60ac9662a2ad32e489187b3fd406ff0`; no Critical or Important findings
- Audit base commit: `3059187dd8ca63e229add17cecdf06e6575c2757`
- ForgeLoop package: `1.6.1`
- ForgeLoop upstream commit: `f331100cff175a4ce990fa843b397fcf720b40f5`
- Vendored archive: `vendor/cassiomc1-forgeloop-1.6.1-f331100.tgz`
- Vendored archive SHA-256: `0411a7a0d45429ac40b498cd432c377184afd6530058d56469561e4c3cab1193`

## Schema provenance identity

Read from `schemas/provenance.json`:

- `forgeLoopPackageVersion`: `1.6.1`
- `forgeLoopGitCommit`: `f331100cff175a4ce990fa843b397fcf720b40f5`
- `protocolVersion`: `1`
- `generatedAt`: `2026-08-28T11:23:11.294Z`
- `schemas["execution.schema.json"].sha256`: `a2c5dfe9b776b9717feee6bad3ce926473549b424f87143d57a50cfb59eae448`

## Environment

- OS: `Darwin cassios-MacBook-Air.local 25.6.0 Darwin Kernel Version 25.6.0: Fri Jul 31 19:18:43 PDT 2026 arm64`
- Node.js: `v26.7.0`
- npm: `11.19.0`
- Architecture: `arm64`
- Time zone: `America/Sao_Paulo (-03:00)`

## Verification commands

| Command | Exit status | Result |
|---|---:|---|
| `npm run protocol:schemas:verify` | `0` | 23 schemas verified against ForgeLoop 1.6.1 |
| `npm run demo:verify` | `0` | 6 tasks, 70 events, 23/23 artifact categories; protocol-valid |
| `npm run typecheck` | `0` | TypeScript check passed |
| `npm run lint` | `0` | ESLint passed |
| `npm test` | `0` | 58 files and 359 tests passed |
| `npm run build` | `0` | Renderer and Electron build passed |
| `npm run docs:check` | `0` | Documentation conformance passed for `0.1.0-rc.6` |
| `npm run test:release-contracts` | `0` | 70 tests passed, 0 failed |
| `npm run test:e2e` | `0` | 6 E2E tests passed |
| `npm run test:electron-smoke` | `0` | 2 Electron smoke tests passed |
| `npm run test:packaged-smoke` | `0` | Packaged macOS arm64 smoke passed; ForgeLoop Integration `1.6.1` detected |
| `npm run verify:full` | `0` | Local result PASS; version, dependency, audit, schema, demo, docs, tests, coverage, performance and build gates passed |
| `git diff --check` | `0` | No whitespace errors |

## Focused verification

- `npm test -- --run src/main/__tests__/execution-reader.test.ts src/main/__tests__/schema-provenance.test.ts src/main/__tests__/forgeloop-integration.test.ts src/main/__tests__/protocol-capabilities.test.ts src/main/__tests__/canonical-projections.test.ts src/renderer/pages/execution-display.test.ts src/renderer/pages/Executions.test.ts`: exit `0`, 7 files and 99 tests passed.
- `npm run test:e2e -- tests/e2e/demo.spec.ts`: exit `0` after the worktree build, 1 test passed.
- The first targeted E2E attempt before building the fresh worktree timed out while the expected `dist/` entrypoints were absent. After `npm run build`, the same test passed; no product timeout or workaround was added.

## Known non-blocking output

- Vitest emits the existing Vite `configLoader: 'native'` warning.
- Unit and release-contract tests print expected diagnostics from deliberately invalid negative fixtures while their parent test processes exit `0`.
- `npm run test:packaged-smoke` reports that macOS Developer ID signing was skipped because no valid Developer ID identity is installed; this matches the unsigned preview policy.

## Skipped or externally owned gates

- Linux and Windows release/packaged matrices were not run on this macOS arm64 host. `npm run verify:full` explicitly reports that platform release gates require the GitHub Actions matrix.
- No release tag, publication, or production deployment was requested or performed.

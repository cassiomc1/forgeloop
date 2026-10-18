# ForgeLoopAudit — Current Implementation and Verification Matrix

This is a current-state matrix for the web migration, not an unchecked
backlog.

| Status | Meaning |
| --- | --- |
| `[x]` | Implemented and covered by the current verification contract |
| `[~]` | Partial, bounded or environment-specific |
| `[ ]` | Not implemented or not verified |
| `[-]` | Intentional non-goal for this release |

## Foundation and web host

- [x] Local Node.js CLI and loopback web server.
- [x] React/Vite renderer with typed same-origin HTTP client and SSE updates.
- [x] One-time bootstrap token, HttpOnly/SameSite=Strict session and origin/host checks.
- [x] CSP, security headers and static-file containment.
- [x] Explicit API routes with safe error envelopes; no generic command/file dispatch.
- [x] CLI-owned project selection, recent-project reopening and managed report destinations.
- [x] Application data and audit history stored outside the audited project.

Evidence: `src/server/`, `src/renderer/lib/audit-client.ts`,
`src/server/__tests__/web-server-security.test.ts` and `tests/e2e/web-smoke.spec.ts`.

## ForgeLoop integration and trust boundary

- [x] Vendored ForgeLoop `2.0.0` at
  `4ff11bb4bc4be39b095a151a323f1388dad0d819`.
- [x] Protocol v1, schema v1 and Integration API v1 provenance verification.
- [x] Node.js 24.19.0 minimum, matching CI and release workflows.
- [x] Native SQLite task discovery and inspector projections without JSON namespaces.
- [x] Database/WAL refreshes, excluding reader-lock and empty-WAL bookkeeping.
- [x] Read-only storage checks and refusal of missing-database artifact fallback.
- [~] Native raw ledger, JSON and execution previews are unavailable through the
  public API; canonical History, Trace and Audit UX remain supported.
- [x] Canonical `flutter` guide IDs are accepted and preserved without local
  Flutter detection or guide-selection authority.
- [x] Fail-closed `INTEGRATION_V1`, `ARTIFACT_ONLY` and `INCOMPATIBLE` modes.
- [x] Canonical ownership, recovery, observability, actions, approvals,
  policy, trajectory, workspace binding, handoffs, responsibility,
  verification scope, attestation and execution-profile projections.
- [x] `canonicalHandoffs v2` remains an operational receipt only.
- [x] `advisoryContextProviders v1` remains host-provided, lazy and not loaded.
- [x] Repository Index/Search is negotiated independently and marked discovery-only.

Evidence: `src/main/core/integration/`, `src/main/core/protocol/`,
`src/server/runtime/audit-runtime.ts`, `schemas/provenance.json` and
`docs/PROTOCOL_COMPATIBILITY.md`.

## Product surfaces

- [x] Audit Summary, Findings, Tasks, Evidence, Quality, Policy & Trust,
  Audit History, Reports, Repository Search, Diagnostics and Settings.
- [x] Selected-task Contract, Lifecycle, Events, Executions, Continuity,
  Actions and Task Boundaries detail surfaces.
- [x] Dark, light and system themes with a shared theme provider.
- [x] Code-owned shadcn-style Button, Card, Badge, Input, Separator and theme controls.
- [x] Explicit unavailable/unknown/error states and reduced-motion behavior.
- [x] Deterministic JSON/Markdown/SARIF reports and application-data history.

Evidence: `src/renderer/pages/`, `src/renderer/components/ui/`,
`src/renderer/lib/theme.tsx`, `docs/UI_DESIGN_DIRECTION.md` and `screen/`.

## Live updates and safety

- [x] Bounded `.forgeloop` watcher with coalesced snapshot refreshes.
- [x] Targeted projection refreshes for task, action, approval, policy,
  handoff, responsibility, scope, attestation and evaluation changes.
- [x] Path containment, trusted schemas, size/depth limits and hostile-string-safe rendering.
- [x] Sanitized SSE update paths and no arbitrary browser filesystem access.
- [x] Security tests for bootstrap, session, origin, CSP and traversal boundaries.

## Tests, CI and release

- [x] Vitest unit/integration suite and web server security tests.
- [x] Playwright Chromium web smoke for startup, navigation, themes and live updates.
- [x] Production screenshot capture through the same loopback web server.
- [x] `npm run verify:full` shared contract.
- [x] Ubuntu/macOS/Windows CI matrix and browser smoke step.
- [x] npm package release workflow with checksum and `SBOM-cyclonedx.json`.
- [~] CI platform execution is verified by GitHub Actions, not by one local checkout.
- [-] Native Electron packaging, code signing, notarization, cloud access,
  task mutation and automatic external-provider verification.

## Intentional demo coverage

- [x] TASK-001 complete lifecycle with unsigned attestation artifacts.
- [x] TASK-002 verification cycle with persisted `AUTO` → `CHANGED` scope.
- [x] TASK-003 workspace binding and responsibility constraints.
- [x] TASK-004 blocked/recovery continuity and canonical handoff receipt.
- [x] TASK-005 planned performance work.
- [x] TASK-006 security-policy scenario.

## Verification commands

```bash
npm run verify:forgeloop-lineage
npm run protocol:schemas:verify
npm run typecheck
npm run lint
npm test
npm run test:web-smoke
npm run screenshots:readme
npm run screenshots:check
npm run docs:check
npm run verify:full
```

The migration report in [`migration/WEB_IMPLEMENTATION_REPORT.md`](migration/WEB_IMPLEMENTATION_REPORT.md)
records the architecture, security boundary, UI work and known limitations.

# ForgeLoopAudit Web Migration Baseline

Captured: 2026-09-09
Branch: `codex/forgeloop-1.11.1-web-migration`

## Product and dependency identity

- ForgeLoopAudit: `0.2.0-rc.3`
- ForgeLoop package: `@cassiomc1/forgeloop@1.10.2`
- ForgeLoop source commit: `d286e1983177a0dfb1f0ceef6c2f6e30c406303a`
- Protocol: v1
- Schema: v1
- Integration API: v1
- Node runtime observed: `v26.8.1` (the supported package contract remains Node `>=20`)

## Verification results

| Command | Result | Observed evidence |
| --- | --- | --- |
| `npm test` | PASS | 80 files passed, 1 skipped; 485 tests passed, 3 skipped |
| `npm run typecheck` | PASS | TypeScript completed without errors |
| `npm run lint` | PASS | ESLint completed without errors |
| `npm run build` | PASS | Renderer and Electron bundles built; package contents verified |
| `npm run demo:verify` | PASS | 6 tasks, 71 events, 29/29 artifact categories |
| `npm run test:e2e` | PASS | 8 passed, 1 skipped |
| `npm run screenshots:readme` | PASS | 10 screenshots captured at 1440x900 |
| `npm run docs:check` | PASS | Documentation and 10 screenshot references conformed |
| `npm run brand:check` | PASS | 571 active files checked |
| `npm run verify:forgeloop-lineage` | PASS | 1.10.2 archive, commit and digest matched |
| `npm run protocol:schemas:verify` | PASS | 31 schemas verified against ForgeLoop 1.10.2 provenance |
| `npm run verify:full` | PASS | All local gates completed; platform release gates remain CI-owned |

The release-contract test suite intentionally exercises failing child processes for
negative cases. Those child-process error messages are expected; the suite itself
completed with 84 passing tests and no failures.

## Current IPC surface

The preload exposes the following renderer methods through `window.forgeLoopAudit`:

```text
selectProject
openRecentProject
openDemoProject
closeProject
getProjectAudit
getTaskAudit
getAuditFindings
getTaskStructuralQuality
saveAuditBaseline
listAuditHistory
compareAudits
exportAuditReport
getProjectSnapshot
getTask
getTaskEvents
validateEventLedger
getPolicyStatus
getRawArtifact
getRawCollectionArtifact
getTaskHistory
getTaskTrace
getTaskReflection
getTaskInspection
getTaskActions
getTaskAction
getTaskApprovals
getTaskMetrics
getTaskEvaluations
getCapabilityPolicy
getTaskWorkspaceBinding
getTaskHandoffs
getTaskContinuityLint
getTaskResponsibility
getTaskVerificationScope
getTaskAttestation
getTaskExecutionProfileContext
getTaskExecutions
getRecentProjects
addRecentProject
removeRecentProject
notifyRendererReady
getAppVersion
getDiagnostics
minimizeWindow
toggleMaximizeWindow
subscribeProjectUpdates
```

The renderer also receives `project-update`, `watcher-status`, and `error` events.

## Electron-only surface

- `src/main/app.ts`: `BrowserWindow`, Electron session/permission policy,
  navigation policy, packaged renderer loading, window lifecycle and shutdown.
- `src/main/ipc/project.handlers.ts`: `ipcMain` route registration, native folder
  picker, Electron app-data path, demo resource resolution, and renderer event
  delivery. The audit/domain orchestration in this file is the primary extraction
  target for the local server.
- `src/main/ipc/task.handlers.ts`, `src/main/ipc/window.handlers.ts`, and
  `src/main/ipc/register-ipc.ts`: Electron IPC registration and window controls.
- `src/preload/index.ts`: `contextBridge` and `ipcRenderer` adapter.
- `scripts/build-electron.mjs`, `scripts/apply-electron-fuses.mjs`,
  `scripts/after-pack-fuses.mjs`, `scripts/verify-electron-fuses.mjs`:
  Electron-specific build and fuse tooling.
- `scripts/packaged-smoke.mjs`, `scripts/packaged-open-demo.mjs`, and
  `tests/e2e/electron-smoke.spec.ts`: packaged Electron smoke paths.
- `electron-builder.release.yml`, `build/entitlements*.plist`, and the Electron
  packaging section of `package.json`: distributable packaging configuration.

## Privileged operations currently owned by Electron main

- Select a directory through `dialog.showOpenDialog`.
- Resolve and validate a project boundary and `.forgeloop` artifacts.
- Read ForgeLoop artifacts, ledgers, reports and history from the filesystem.
- Load and call the ForgeLoop Integration API.
- Run bounded read-only ForgeLoop CLI operations through the existing allowlist.
- Start and stop the Chokidar project watcher.
- Persist recent projects through `electron-store`.
- Persist audit history below Electron's `app.getPath('userData')`.
- Create exclusive report files after validating the destination policy.
- Send projection invalidation and watcher events to the renderer.
- Control the native window and open approved external HTTPS links.

## Feature and screenshot parity set

The current UI surfaces that must remain available in the web runtime are:

- Audit Summary
- Findings
- Tasks and task audit detail
- Evidence
- Structural Quality
- Policy & Trust
- Audit History and snapshot diff
- Reports
- Diagnostics
- Settings and compatibility metadata
- Lifecycle, Events, Executions, Continuity, Actions, Contract and Boundaries task views
- Demo project opening and watcher refresh behavior

The baseline README capture set contains these 10 1440x900 dark-theme files:

```text
screen/audit-summary.png
screen/findings.png
screen/task-audit.png
screen/evidence.png
screen/quality.png
screen/policy-trust.png
screen/history-diff.png
screen/report.png
screen/diagnostics.png
screen/settings.png
```

The web replacement must add a light theme and must not use Electron window chrome
in current screenshots.

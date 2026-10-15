# ForgeLoopAudit — setup and usage

ForgeLoopAudit is the local, read-only web interface for inspecting ForgeLoop
projects. It lives in [`ForgeLoopAudit/`](https://github.com/cassiomc1/forgeloop/blob/main/ForgeLoopAudit/README.md) in this
repository; the standalone repository is retired. Use it to inspect task
progress, findings, verification evidence, quality, history and reports.
ForgeLoop remains the authority for lifecycle and completion decisions.

## Start ForgeLoopAudit

Use Node.js **24.19.0 or newer**. From a checkout of this repository:

```bash
cd ForgeLoopAudit
npm ci
npm run build:web
node dist/server/cli.mjs --demo
```

The CLI starts a loopback-only server and opens the browser. If it does not
open automatically, use the one-time bootstrap URL printed in the terminal.
Keep the terminal running while using Audit; press `Ctrl+C` to stop the server.

To inspect your own ForgeLoop project, replace the demo command with an
explicit project path, still from `ForgeLoopAudit/`:

```bash
node dist/server/cli.mjs --project /absolute/path/to/your-project
```

To inspect the parent ForgeLoop checkout itself, use `--project ..`.
Audit reads native SQLite task state through ForgeLoop's public Integration API.
Legacy JSON projects open as `ARTIFACT_ONLY`; Audit does not migrate them or
change task state. Project selection stays with the local server rather than
uploading a repository through the browser.

## Explore the audit views

1. Open **Audit Summary** for integrity, completion readiness, quality and trust
   verdicts. Use **Run audit** to refresh the read-only assessment.
2. Use **Projects** and **Task Board** to navigate registered projects and tasks
   by canonical lifecycle phase; open **Tasks** for a task's detailed audit.
3. Review **Findings** and **Evidence** to trace warnings and verification gaps.
   Coverage, attestation and completion are separate signals.
4. Inspect **Quality**, **Policy & Trust**, **Audit History** and **Diagnostics**
   for supporting context. Use **Reports** for exports to managed local storage.
   **Repository Search** is discovery only, not verification evidence.

## Screenshots

These are existing captures of the ForgeShop demo, taken from the production
renderer at 1440 × 900 in the dark theme, aligned to Audit `0.3.0-rc.3` and
ForgeLoop `2.0.0-rc.4`. The demo deliberately includes invalid, stale, blocked and
unverified scenarios. Its warnings and coverage values do not establish
completion or production readiness for your project.

| Audit Summary | Task Board |
| --- | --- |
| ![ForgeShop demo audit summary with separate integrity, readiness, quality and trust verdicts](https://raw.githubusercontent.com/cassiomc1/forgeloop/main/ForgeLoopAudit/screen/audit-summary.png) | ![Read-only task board grouping demo tasks by canonical lifecycle phase](https://raw.githubusercontent.com/cassiomc1/forgeloop/main/ForgeLoopAudit/screen/kanban.png) |
| Findings | Evidence |
| ![ForgeShop demo findings with provenance and severity](https://raw.githubusercontent.com/cassiomc1/forgeloop/main/ForgeLoopAudit/screen/findings.png) | ![ForgeShop demo task evidence and verification scope](https://raw.githubusercontent.com/cassiomc1/forgeloop/main/ForgeLoopAudit/screen/evidence.png) |

See the [complete screenshot gallery](https://github.com/cassiomc1/forgeloop/blob/main/ForgeLoopAudit/README.md#screenshots)
and [capture provenance](https://github.com/cassiomc1/forgeloop/blob/main/ForgeLoopAudit/screen/README.md) for the full set.
For development, verification and command-root details, see the
[Audit README](https://github.com/cassiomc1/forgeloop/blob/main/ForgeLoopAudit/README.md),
[Audit documentation index](https://github.com/cassiomc1/forgeloop/blob/main/ForgeLoopAudit/docs/README.md) and
[workspace guidance](./AGENT_SKILL.md#forgeloopaudit-workspace-guidance).
Audit has its own dependencies, build and verification commands. Its application
source and screenshots are excluded from the core npm package; npm users can
[read this section and its images on GitHub](https://github.com/cassiomc1/forgeloop#forgeloopaudit-workspace).


# ForgeLoopAudit screenshot documentation

These images are documentation captures of the real ForgeShop audit scenario,
the production renderer build, the local web server and the default dark theme. They are not
illustrations or edited mockups. The capture metadata and page/task mapping are
in [`manifest.json`](manifest.json).

## Source and freshness

The source project is [`../demo/`](../demo/). Capture prepares an isolated native
SQLite copy with ForgeLoop’s public CLI, rebases only synthetic fixture execution
roots, and removes that copy afterward. The source fixture remains unchanged.
The capture uses the built
loopback web server with a 1440 × 900 browser viewport, 100% zoom, an expanded
sidebar and reduced motion. The capture excludes operating-system chrome, local
paths, credentials and transient loading state. The current capture is aligned
to ForgeLoopAudit `0.3.0-rc.3` and ForgeLoop `2.0.0-rc.4`.

Regenerate the complete set after a user-visible layout, demo-state,
terminology, theme or navigation change:

```bash
npm run screenshots:readme
npm run screenshots:check
```

Do not edit PNG files manually. The capture script asserts the expected page,
task and scenario text before writing each image. The checker validates the
manifest, exact dimensions, README references, source metadata and absence of
orphaned screenshot files.

## Capture mapping

| File | Surface | Selected task | Scenario |
| --- | --- | --- | --- |
| `audit-summary.png` | Audit Summary | — | Separate integrity, completion, quality, trust and coverage verdicts |
| `projects.png` | Projects | — | Two registered ForgeLoop projects with task counts, health and live-watch status |
| `kanban.png` | Task Board | — | Cross-project task board, one column per canonical status, with a project filter |
| `timeline.png` | Project Timeline | — | Git-backed project evolution, current architecture and bounded evidence |
| `findings.png` | Findings | — | Canonical and derived findings with provenance |
| `task-audit.png` | Tasks | — | Eight tasks with canonical audit state and finding counts |
| `evidence.png` | Evidence | `TASK-002` | Evidence coverage, `AUTO` → `CHANGED` verification scope and attestation boundary |
| `quality.png` | Quality | `TASK-001` | Canonical Structural Quality projection without provider execution |
| `policy-trust.png` | Policy & Trust | `TASK-006` | Policy, workspace, responsibility, handoff and attestation boundaries |
| `history-diff.png` | Audit History | — | Manual snapshots stored outside the audited project |
| `report.png` | Reports | — | Deterministic report formats and provenance |
| `diagnostics.png` | Diagnostics | `TASK-004` | Canonical diagnostic signals |
| `settings.png` | Settings | — | Project context, ForgeLoopAudit preferences, ForgeLoop 2.0.0-rc.4 and advisory capability metadata |

## Review checklist

- all images show the ForgeShop audit scenario and current navigation;
- no loading spinner, personal path, credential or OS chrome is visible;
- status labels and warnings remain canonical and readable;
- optional capabilities remain clearly optional;
- Handoff, Continuity, Verification Scope and Attestation are not conflated;
- alt text in the root README describes the visible scenario; and
- `npm run screenshots:check` passes after review.

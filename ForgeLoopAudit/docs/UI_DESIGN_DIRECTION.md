# ForgeLoopAudit UI design direction

## Goal

Make ForgeLoop state readable at a glance in a calm, precise local web
interface. The current implementation is ForgeLoopAudit `0.3.0-rc.3` aligned to
ForgeLoop `2.0.0` at
`4ff11bb4bc4be39b095a151a323f1388dad0d819` (protocol v1, schema v1, Integration
API v1).

## Visual language

The product is dark by default, compact and information-rich. It uses semantic
color, restrained typography, visible focus, and text labels for state. The
renderer has a light theme and a system theme through the same provider. UI
primitives are code-owned shadcn-style components following the composable
approach described by [shadcn/ui](https://ui.shadcn.com/).

Palette tokens are defined in `src/renderer/styles/index.css` and Tailwind:

```text
dark background      #09090B
light background     #FAFAFA
primary accent       Forge orange
success              green
warning              amber
danger               red
muted text           zinc
```

Typography is compact and technical: interface text uses the system sans stack;
hashes, protocol values and paths use a monospace stack. Whitespace and
alignment carry hierarchy instead of decorative effects.

## Current navigation and trust surfaces

The main navigation is Audit Summary, Projects, Task Board, Project Timeline,
Findings, Tasks, Evidence, Quality, Policy & Trust, Audit History, Reports,
Repository Search, Diagnostics and Settings. Selected-task detail includes
Contract, Lifecycle, Events, Executions, Continuity, Actions and Task
Boundaries.

The Projects screen owns the multi-project workspace: a project is registered by
an absolute path, is either opened for deep canonical inspection or saved while
staying tracked, and every registered project keeps a live, read-only session so
its status stays current while another project is open. The Task Board is a
read-only projection of canonical ForgeLoop phases: one column per status, one
card per task, filtered by a single project or shown across all of them. Neither
surface writes lifecycle state, and neither accepts a drop.

Trust surfaces keep these concepts separate:

- **Task Boundaries** show workspace binding, responsibility and canonical
  handoff context as read-only projections.
- **Verification Scope** shows ForgeLoop’s requested/resolved scope and never
  claims attestation coverage.
- **Attestation** shows canonical status and trust level; the auditor never
  creates or signs an attestation.
- Repository Search is marked **Discovery only** and cannot create evidence.
- An accepted handoff is an operational receipt only, not authority, delegation,
  completion or evidence.

Optional capability failure is displayed as `UNAVAILABLE`, `UNKNOWN` or an
explicit canonical error. It is never silently rendered as a pass. Status is
never conveyed by color alone.

## Interaction and motion

Use subtle transitions for state changes, inspector reveals and live updates.
Respect `prefers-reduced-motion`; avoid glow, parallax and looping decoration.
Empty states explain which ForgeLoop artifact or CLI action will make content
appear. The browser cannot choose arbitrary filesystem paths: the CLI/server
owns project selection and report destinations.

## Accessibility

- semantic headings and landmark navigation;
- visible keyboard focus and accessible button names;
- WCAG AA contrast targets;
- reduced-motion support;
- text labels and icons together for status; and
- keyboard-readable alternatives for graph and dense technical views.

The final criterion is a production-ready screen when animation is disabled and
no gradient is visible: composition, spacing, typography and information
hierarchy must carry the experience.

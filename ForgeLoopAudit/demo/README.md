# ForgeShop — ForgeLoopAudit demo project

ForgeShop is a fictional premium e-commerce web application being built through
ForgeLoop. Everything under `.forgeloop/` is a real, schema-valid ForgeLoop
project fixture — ForgeLoopAudit reads it with exactly the same pipeline it uses for any
other project (ProjectDetector → PathBoundary → SchemaValidator → ProjectSnapshot).
No external service, network access or build step is required.

## Open it

1. Launch ForgeLoopAudit.
2. Choose **Open Demo Project** on the start screen (or **Open Project** and select this `demo/` directory).
3. Explore Overview, Tasks, Flow, Contract, Evidence, Events, Executions, Continuity, Diagnostics, Actions, Policy and Settings. The active task's Overview includes the read-only Task Boundaries surface.

## Task map

| Task | Title | Phase | Demonstrates |
|---|---|---|---|
| TASK-001 | Implement premium product catalog | COMPLETE | Full lifecycle plus unsigned code-attestation artifacts; policy does not claim a signature |
| TASK-002 | Add shopping cart persistence | VERIFYING | Verification cycle with a rejected completion attempt and AUTO → CHANGED scope |
| TASK-003 | Implement checkout API integration | EXECUTING | Portable workspace-binding warning plus intentional INVALID Responsibility Contract |
| TASK-004 | Accessibility and keyboard navigation audit | BLOCKED | Failed gate, recovery route, mutable continuity and an accepted canonical handoff operational receipt |
| TASK-005 | Improve image loading performance | PLANNED | Planned work with a recorded baseline |
| TASK-006 | Security review of checkout flow | COMPLETE | Security policy gates and attestation policy metadata |
| TASK-007 | Explore server-side rendering migration | PLANNED | Caller abandonment (`TASK_ABANDONED`): rendered distinctly, never as completion, with canonical recovery releasing the claims |
| TASK-008 | Rework checkout contract after the retry policy change | ROUTED | Pre-execution contract revision (`PLANNED` → `ROUTED`) plus repository-drift checkpoint revalidation, both as provenance refreshes |

TASK-004 is the continuity showcase: `harness-a` failed the keyboard-navigation
gate, recorded findings, selected a recovery route and handed off to
`harness-b`, which resumed from `continuity.json`. The generated ledger also
contains a known `HANDOFF_ACCEPTED` event for the canonical handoff. ForgeLoopAudit
displays it as **Accepted — operational receipt only**; it is not review,
completion or other evidence and transfers no claims or authority.

TASK-007 is the abandonment showcase. ForgeLoop's canonical `task-abandon`
boundary records `TASK_ABANDONED` with the exact abandonment details and a
caller-acknowledged recovery artifact, and canonical ownership moves to
released-by-recovery. ForgeLoopAudit shows an explicit **ABANDONED** label that
is never rendered as completion, publication, or evidence.

TASK-008 is the provenance-refresh showcase. The contract was revised before
execution, which rewinds the task from `PLANNED` to `ROUTED` and invalidates
dependent plan/preflight/route evidence; afterwards the checkpoint was
revalidated against new repository drift. Both events are displayed as
provenance refreshes — never as new execution and never as completion.

Optional provider observations are intentionally *not* fabricated in this
fixture. ForgeLoop does not persist Browser Verification, Security Review, or
Emulated Services provider output as project state: those are host-injected,
observation-only, non-evidence results. ForgeLoopAudit therefore shows their
capability boundary (provider-neutral, experimental, never invoked by the
auditor) and displays unavailable/not-advertised states instead of inventing
findings.

The optional boundary capabilities are intentionally distributed across the
tasks. TASK-003 contains a deterministic portable workspace binding, so a real
checkout normally shows ForgeLoop's canonical MISMATCH or UNAVAILABLE result;
the demo never pretends to know the host worktree. TASK-002 shows a persisted
verification scope, TASK-003 shows responsibility constraints, and TASK-004
shows that immutable handoffs and their operational acceptance receipts are
distinct from mutable Continuity. TASK-003's
responsibility projection intentionally exercises ForgeLoop's INVALID fail-closed
result (including route validation errors), so ForgeLoopAudit does not reinterpret it as
an accepted scope. TASK-001's
attestation files are unsigned and the project policy is `off`; the fixture
does not claim ATTESTED trust.

## Intentional scenario states

ForgeShop is a scenario-rich demo, not a fixture where every task is expected
to be complete. ForgeLoopAudit labels these known states as demo scenarios so users can
distinguish protocol examples from application failures.

The scenario label never suppresses real validation or integrity errors.
Schema errors, invalid artifacts, broken event hashes, policy-lock mismatches,
unexpected phase drift, transport errors, and ForgeLoopAudit failures must still be treated as
real defects.

## Regenerating

This directory is generated by `scripts/generate-demo-project.mjs`:

```bash
npm run demo:generate   # regenerate deterministically
npm run demo:verify     # schema + integrity + drift verification
```

Never edit `.forgeloop/` artifacts by hand — change the generator instead so the
demo stays an executable compatibility fixture.

<!-- FORGELOOP_PROJECT_PROTOCOL=REQUIRED -->
# Claude Code — Universal Project Loop

This project is ForgeLoop-enabled. If your execution environment loaded this
file, ForgeLoop applies regardless of model, provider, IDE, agent, or runtime.
Do not treat ForgeLoop as vendor-specific, optional, or to follow only "in spirit".

When working in this repository:

1. Follow higher-level instructions, the user's latest request, and local rules first.
1. Read [`LOOP_ENGINEERING.md`](./LOOP_ENGINEERING.md) and [`PROTOCOL_INTEGRATION.md`](./PROTOCOL_INTEGRATION.md).
1. If an official ForgeLoop structured integration is available in your host, prefer it for protocol operations; otherwise use the project-local ForgeLoop CLI. Never simulate ForgeLoop-managed lifecycle, claim, recovery, ledger, or completion state directly.
1. Verify [`PROJECT_PROFILE.md`](./PROJECT_PROFILE.md) against real sources; initialize if in `template` mode.
1. Consult [`GUIDE_ROUTER.md`](./GUIDE_ROUTER.md), select relevant guides, and announce their IDs.
1. For repository-wide textual discovery, prefer `forgeloop search` and treat its results as discovery only; do not use them as verification evidence or scope authority.
1. Make small changes, run specific checks, and run proportional regression checks.
1. Investigate root causes before fixing failures; do not make unverified attempts.
1. Request authority for unrelated installations, publications, deletions, or migrations. Do not install a missing verification tool merely to satisfy a check. For missing Qwen-MM-Plugins, follow `LOOP_ENGINEERING.md`.
1. Before creating or activating new lifecycle state: discover existing tasks first with `forgeloop task-list --json`; if an existing task is selected or identifiable, use `forgeloop next --task <id> --json` before creating another task, reconcile continuity when present, and inspect the checkout. A change of harness, model, provider, IDE, process, terminal, or session does not create a new task. Legacy singleton state such as `.forgeloop/work-state.json` is compatibility-only, not the primary modern discovery mechanism.
1. After implementation begins, do not return a final result in `EXECUTING`: advance through `VERIFYING` → structured evidence → `REVIEWING` → execution receipt → validator-backed `COMPLETE`. If closure cannot be reached, report `BLOCKED` or `PARTIALLY VERIFIED`.
1. After implementation work for the current task is complete, run `forgeloop next` before returning a final result. Follow the returned lifecycle action until ForgeLoop reaches a terminal state or an explicit blocker.
1. Report current evidence, limitations, and publication state without claiming checks that were not run.

When `structuralQuality` is enabled, capture its baseline after planning and
before `EXECUTING`, evaluate the current cycle in `VERIFYING`, and use the
existing diagnosis/correction lifecycle for regressions. Do not report
unavailable evidence as `PASS`, replace a baseline after execution begins, or
expand scope to pursue a perfect score.

Do not stop for non-blocking missing product details. When a safe, reversible
local default exists, record it as an agent assumption and follow the Blocking vs Non-Blocking Decisions policy in `LOOP_ENGINEERING.md`.

## Pre-question decisions

Before asking any product-detail question, classify it as `BLOCKING` or
`NON_BLOCKING` using `LOOP_ENGINEERING.md`. For
`NON_BLOCKING`, choose a safe reversible local default, record it in
`current-contract.assumptions[]`, and continue. For `BLOCKING`, persist
`current-contract.json` with `unresolvedDecisions[]` and a blocking reason
before asking. Do not ask the user to choose among reversible local
product-positioning alternatives; the canonical checklist and boundary remain
in `LOOP_ENGINEERING.md`.

External workflow approval rules do not override ForgeLoop's autonomous-mode
precedence; consult `LOOP_ENGINEERING.md#external-workflow-compatibility`.

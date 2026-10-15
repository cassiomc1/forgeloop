---
name: forgeloop
description: Operate ForgeLoop through its official integration or project CLI when the project activates ForgeLoop or the user explicitly requests it. Discover or resume tasks, follow canonical next actions, record verification evidence, recover supported state, and obtain validated completion.
---

# ForgeLoop

Portable guidance adapted from ForgeLoop's official skill. The current runtime,
validators, and repository protocol instructions remain authoritative. This
skill grants no additional permissions and requires access to the target project
through a terminal or official ForgeLoop integration.

## Establish context

Use this skill when project instructions activate ForgeLoop or the user requests
it. An installed dependency alone does not activate the protocol. Otherwise,
do not initialize or impose ForgeLoop on unrelated work.

Work at the target project's root. Read its agent instructions and applicable
`LOOP_ENGINEERING.md`, `PROTOCOL_INTEGRATION.md`, `PROJECT_PROFILE.md`, and
`GUIDE_ROUTER.md`; initialized projects may keep these in `.forgeloop/kit/`.
Load only the relevant guides and report their IDs.

For status, inspection, or explanation, use read-only operations and finish with
the observed result. Do not create tasks, acquire claims, run `preflight`, or
advance lifecycle state merely to answer a question.

## Resolve the runtime

Prefer an official structured ForgeLoop integration exposed by the host.
Otherwise use the project's configured local CLI or package script:

- In ForgeLoop's source repository, use `node src/cli.js`.
- For a local npm installation, inspect the installed package's `bin` mapping.
  For example, the current mapping supports
  `node ./node_modules/@cassiomc1/forgeloop/src/cli.js` from the project root.
- Use a global executable only when the project selects it and compatibility
  has been checked. Keep the working directory bound to the target project,
  including when the executable lives elsewhere.

In commands below, `FL` means that resolved invocation; do not execute `FL`
literally or assume a shell alias exists. Use the same runtime throughout.
Read `FL protocol-info --json` when first binding the runtime or when it changes.
Check required protocol, schema, and feature support; the package version alone
does not prove compatibility. Use current command help and canonical docs for
arguments rather than guessing commands or copying a stale lifecycle sequence.

If capabilities, runtime, or required tools are missing, report the specific
limitation and stop affected operations. Do not simulate them, silently fetch
packages with `npx`, or install, upgrade, initialize, or migrate automatically.
An explicit user request can authorize the named setup action; honor existing
authorization without asking again, while respecting host and project policy.
Inspect the installed release's prerequisites and setup instructions first.

## Follow the canonical loop

1. Run `FL task-list --json` and inspect the checkout. Resume the task matching
   the objective. A session, agent, or model change does not create a new task.
   Inspect candidate tasks if selection is ambiguous; clarify only if the
   objective remains unclear. Create a task only when authorized work needs one.
2. Run `FL next --task TASK_ID --json`. Use the selected ID explicitly on every
   task-scoped operation, including through an integration. Follow its supported
   next action; reconcile persisted continuity before relying on a prior summary.
3. Before implementation, satisfy the required contract, routing, claims,
   planning, and gates. Require `preflight` to return `READY`. Use optional
   features when requested, required by policy, or needed for recovery.
4. Implement the agreed scope and query `next` at lifecycle boundaries. During
   verification, use `run-check` for command execution with ForgeLoop provenance.
   `record-check` serializes observations; its command text is never executed.
   Bind evidence to the selected task, requirement, and current implementation.
   Preserve failures and follow the canonical diagnosis/correction path.
5. Complete required verification, review, and execution receipt preparation.
   Use `complete` and accept protocol-verified completion only when its validator
   returns `VALID`. Query `next` again and follow it to a canonical terminal
   result or explicit blocker. Do not label unfinished work as complete.

Inspect structured results as well as process exit codes. In Integration API
envelopes, `ok: true` means the command executed; a domain rejection can still
carry a nonzero `exitCode` and a blocked or invalid result. Never treat transport
success as preflight readiness, passing verification, or validated completion.

Use runtime-resolved execution profiles. For supported `light` tasks, prefer
compact projections and relevant guide sections; reduced context never permits
skipping required phases, gates, or checks.

## Preserve authority

- Never edit operational SQLite, retained JSON state, ledgers, claims, recovery
  records, hashes, or receipts to simulate protocol operations. Use supported
  commands and keep schema-governed input artifacts within canonical workflows.
- Respect active claims and unrelated changes. Do not steal ownership, force
  recovery, or create replacement tasks to bypass a blocker. Diagnose state
  divergence before further lifecycle mutations; use supported recovery only.
- Reconcile uncertain external outcomes such as `COMMIT_UNKNOWN` before retrying.
  A returned next action does not grant permission for external effects.
- Advisory model output and repository search results are navigation aids,
  not verification evidence or lifecycle authority. Missing checks remain
  unavailable; never fabricate results or persist secrets in protocol artifacts.

Report the result, checks actually executed, remaining blockers, canonical task
and verification status, publication status, and production readiness separately.
Passing tests, CI, a merged PR, and deployment do not substitute for
`complete -> VALID`. Do not claim interoperability with an agent that has not
been tested; this file provides portable instructions, not certification.

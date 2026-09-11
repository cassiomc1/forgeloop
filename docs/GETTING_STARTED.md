# Getting Started with ForgeLoop

This guide walks through your first complete task with ForgeLoop from initialization to validator-backed completion.

---

## 1. What is ForgeLoop?

ForgeLoop is a portable, vendor-neutral engineering protocol for AI-assisted coding and automated workflows. It turns a task outcome into:

- **A structured contract** (`.forgeloop/task-state/<taskKey>/contract.json`);
- **Deterministic guide routing** based on declared work type, surfaces, and risks;
- **Resumable work state** across different tools, IDEs, and AI harnesses;
- **Observed verification evidence** linked to ForgeLoop-attested command execution;
- **Diagnostic recovery loops** when tests or checks fail;
- **Validator-backed completion** validated by protocol algorithms rather than agent claims.

ForgeLoop is **not** an LLM runtime, agent framework, or graph orchestrator. It is a deterministic protocol and CLI that guides execution environments safely.

Core mental model:

- `work-state = lifecycle truth`
- `continuity = operational handoff context`
- `checkout = implementation truth`
- `execution artifacts = process provenance`
- `checks = verification truth`
- `receipt = completion/publication record`

### Adaptive execution profiles

ForgeLoop uses `executionProfile` to choose the appropriate process and context
depth without changing its assurance guarantees. It is separate from
`complianceMode`, which controls policy enforcement.

```text
auto → light | balanced | full
```

Small, local, reversible documentation and UI work normally resolves to
`light`; behavior changes and ordinary application work resolve to
`balanced`; authentication, publication, infrastructure, secrets, personal
data, critical paths, and irreversible work resolve to `full`. A CLI or project
request may raise the profile, but never lower the deterministic safety floor.

For compact host context, use:

```bash
forgeloop next --task task-contact-form-001 --compact --json
forgeloop task-show --task task-contact-form-001 --compact --json
```

When the task shape is known but a full contract has not been written yet,
use a bounded preset preview. Preview is read-only and records unresolved
decisions instead of guessing project facts:

```bash
forgeloop task-create --task task-contact-form-001 \
  --claim src/components --claim tests \
  --preset feature --preview --json
```

After reviewing the proposed contract, repeat the command without
`--preview` to create the namespace and persist the same validated contract.
The supported presets are `documentation`, `bug`, `feature`, and `release`.
The release preset retains an independently verified publication requirement;
it does not publish or deploy anything.

For a bounded explanation of a blocked or recovery-sensitive next action, opt
in with `--explain`. The explanation is read-only and derived from canonical
reason codes and artifact references:

```bash
forgeloop next --task task-contact-form-001 --explain --json
```

These commands do not bypass contracts, gates, verification, provenance,
lifecycle phases, or validator-backed completion. Usage telemetry is optional,
never estimated, and never verification evidence; `efficiency --task` compares
only against a metadata-compatible local baseline.

---

## 2. Prerequisites

- **Node.js**: version 20 or higher (`node -v`)
- **npm**: standard npm toolchain

---

## 3. Installation & Initialization

### Global installation

Install the ForgeLoop CLI globally to make the `forgeloop` command available
in your terminal:

```bash
npm install --global @cassiomc1/forgeloop
forgeloop --version
```

In your project repository:

Confirm the installed CLI exposes the compatible protocol before creating
state. This is read-only and safe to run in a fresh project directory.

<!-- FORGELOOP EXAMPLE: getting-started:compatibility | exit=0 | json.compatibility.schemaVersion=1 -->
```bash
forgeloop protocol-info --json
```
<!-- END FORGELOOP EXAMPLE -->

```bash
# Initialize ForgeLoop kit and discovery shims
npx @cassiomc1/forgeloop init

# Check target project health
npx @cassiomc1/forgeloop doctor
```

What `init` does:

- Installs the canonical instruction kit under `.forgeloop/kit/`;
- Places native discovery shims at the project root (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules/`, `.github/copilot-instructions.md`);
- Creates `.forgeloop/` for project configuration and `.forgeloop/task-state/` for isolated task execution.
- For a Git repository, provisions the pinned managed Repository Index, builds
  its derived cache under `.forgeloop/repository-index/tgrep/`, starts the
  owned watcher, and verifies readiness. The first setup may need network
  access; use `forgeloop index-setup --asset <absolute-archive>` for an
  explicitly preloaded release asset.

Repository discovery uses the same canonical service from every transport:

```bash
forgeloop index-status --json
forgeloop search "ExecutionReceipt" --json
```

The index is a disposable local cache. Its matches help an agent find relevant
files but do not define verification scope, evidence, task ownership, or
completion truth. Read [`REPOSITORY_INDEX.md`](./REPOSITORY_INDEX.md) for the
full command, Integration API, MCP, platform, offline, and security contract.

---

## 4. End-to-End Walkthrough

Here is a typical end-to-end task: *"Implement a contact form with input validation and tests."*

```text
User Request
     │
     ▼
Create Task Namespace
     │
     ▼
Define Task Contract
     │
     ▼
Route Guides
     │
     ▼
Preflight & Gate Validation
     │
     ▼
Plan & Implement
     │
     ▼
Execute & Verify Checks ─── failure ───► Diagnose & Correct
     │                                         │
     ▼                                         ▼
Review Evidence ◄──────────────────────────────┘
     │
     ▼
Complete Validation (VALID)
```

---

### Step 1 — Create the Task Namespace and Contract

First, create the task namespace with explicit write claims covering the files this task will touch:

```bash
forgeloop task-create \
  --task task-contact-form-001 \
  --claim src/components \
  --claim tests \
  --json
```

Discover the deterministic task state path using `task-show`:

```bash
forgeloop task-show --task task-contact-form-001 --json
```

Then write the task contract to `.forgeloop/task-state/<taskKey>/contract.json`:

```json
{
  "schemaVersion": 1,
  "protocolVersion": 1,
  "taskId": "task-contact-form-001",
  "objective": "Add a validated contact form with unit and visual tests",
  "assumptions": [
    {
      "value": "Form submits via fetch POST to /api/contact",
      "reason": "Backend endpoint already supports JSON payload",
      "scope": "contact-form",
      "reversible": true,
      "source": "agent-default"
    }
  ],
  "deliverables": [
    "src/components/ContactForm.jsx",
    "tests/contact-form.test.js"
  ],
  "constraints": [
    "No external form libraries",
    "WCAG AA contrast compliant"
  ],
  "risks": [
    "untrusted-input"
  ],
  "verification": [
    { "id": "unit-tests", "text": "npm test passes for contact form", "type": "VERIFICATION" },
    { "id": "lint", "text": "npm run lint passes", "type": "VERIFICATION" }
  ],
  "successCriteria": [
    "Form validates required fields client-side",
    "All unit tests pass"
  ],
  "stopConditions": [
    "Unresolved API specification change required"
  ],
  "unresolvedDecisions": [],
  "sourceRefs": []
}
```

---

### Step 2 — Route Guides Deterministically

Ask ForgeLoop which engineering guides apply to your work:

```bash
forgeloop route \
  --task task-contact-form-001 \
  --work complete-website \
  --surface ui \
  --surface forms \
  --risk untrusted-input \
  --json
```

This writes `.forgeloop/task-state/<taskKey>/routing-result.json` referencing selected guides (e.g. `clean`, `test`, `security`, `design`, `accessibility`).

---

### Step 3 — Run Preflight

Before writing code, validate readiness and establish the canonical resumable work state:

```bash
forgeloop preflight --task task-contact-form-001 --json
```

Output:

```json
{
  "status": "READY",
  "taskId": "task-contact-form-001",
  "errors": []
}
```

When preflight returns `READY`, ForgeLoop synchronizes resumable work state (`.forgeloop/task-state/<taskKey>/work-state.json`) and preflight status (`.forgeloop/task-state/<taskKey>/preflight.json`). If preflight reports `BLOCKED`, inspect the required gates in the output and satisfy them first.

If executable policy artifacts exist under `.forgeloop/policy/`, preflight also captures the effective rules and baseline into `.forgeloop/task-state/<taskKey>/policy-snapshot.json` so later policy drift can be detected. Malformed policy artifacts block preflight with `E_POLICY_INVALID`. See [LOOP_ENGINEERING.md](../LOOP_ENGINEERING.md#executable-policy--autonomy-preserving-invariants).

---

### Step 4 — Activate Session and Plan

Create a session activation marker and transition to `PLANNED`:

```bash
forgeloop activate
forgeloop advance --task task-contact-form-001 --to PLANNED
```

`activate` is session-scoped, not task-scoped: it records the current harness session (`.forgeloop/sessions/<sessionId>.json`) and does not accept `--task`.

---

### Step 5 — Implement

Advance to `EXECUTING` and make your code changes:

```bash
forgeloop advance --task task-contact-form-001 --to EXECUTING
```

Implement your components, styles, and test files according to the activated guides.

---

### Step 6 — Verify with Observed Evidence

Advance to `VERIFYING` and prepare completion receipt:

```bash
forgeloop advance --task task-contact-form-001 --to VERIFYING
forgeloop prepare-completion --task task-contact-form-001 --json
```

Execute your verification checks through ForgeLoop so provenance is recorded:

```bash
# Run unit tests and record evidence
forgeloop run-check --task task-contact-form-001 --id unit-tests --requirement "npm test passes for contact form" -- npm test

# Run linter and record evidence
forgeloop run-check --task task-contact-form-001 --id lint --requirement "npm run lint passes" -- npm run lint
```

If a check fails:

1. Advance to `DIAGNOSING`:

   ```bash
   forgeloop advance --task task-contact-form-001 --to DIAGNOSING
   ```

2. Record an append-only root-cause diagnosis in the event ledger:

   ```bash
   forgeloop record-diagnosis \
     --task task-contact-form-001 \
     --hypothesis="Form validation regex incorrectly rejects valid domain formats" \
     --failure-class="VERIFICATION_FAILURE" \
     --evidence-ref="unit-tests" \
     --settled-by="All domain validation unit tests pass" \
     --next-safe-action="Update email domain regex in ContactForm.jsx"
   ```

3. Advance to `CORRECTING` and apply the fix:

   ```bash
   forgeloop advance --task task-contact-form-001 --to CORRECTING
   ```

4. Re-enter `VERIFYING` (advances `verificationCycle` monotonically) and re-run checks:

   ```bash
   forgeloop advance --task task-contact-form-001 --to VERIFYING
   forgeloop run-check --task task-contact-form-001 --id unit-tests --requirement "npm test passes for contact form" -- npm test
   ```

---

### Step 7 — Review Evidence

Advance to `REVIEWING` and perform a read-only audit:

```bash
forgeloop advance --task task-contact-form-001 --to REVIEWING
forgeloop audit --task task-contact-form-001 --json
```

Output checks contract coverage, ledger integrity, and fingerprint freshness.

---

### Step 8 — Validate Completion

Run `forgeloop complete` to validate completion:

```bash
forgeloop complete --task task-contact-form-001 --json
```

Output:

```json
{
  "status": "VALID",
  "taskStatus": "COMPLETE",
  "verificationStatus": "VALID"
}
```

Finally, query ForgeLoop for the next action:

```bash
forgeloop next --task task-contact-form-001 --json
```

When `terminal: true` and `nextAction: "NONE"` are returned, your task is protocol-verified as complete.

---

## 5. Multi-Task Concurrency

ForgeLoop supports multiple parallel tasks in the same project without collision:

```bash
# Create an isolated task with explicit write claims
forgeloop task-create --task auth-feature --claim src/auth --claim tests/auth --json

# Run all commands against that specific task
forgeloop route --task auth-feature --work clean-code --surface backend
forgeloop preflight --task auth-feature --json
forgeloop advance --task auth-feature --to EXECUTING
forgeloop complete --task auth-feature --json

# Inspect active tasks
forgeloop task-list --json
```

---

## 6. What ForgeLoop Creates

Under `.forgeloop/task-state/<taskKey>/`:

- `task.json`: task descriptor and write claims;
- `contract.json`: task intent, deliverables, and success criteria;
- `routing-result.json`: deterministic guide selections;
- `preflight.json`: pre-implementation authorization checkpoint;
- `work-state.json`: lifecycle phase and resumption checkpoint;
- `events.ndjson`: hash-chained append-only event ledger;
- `executions/*.json`: provenance records for executed verification commands;
- `execution-receipt.json`: completion evidence and coverage mapping;
- `policy-snapshot.json`: effective policy and baseline captured at preflight (created when executable policy is configured).

Shared repository artifacts (`sources.json`, `config.json`) remain at `.forgeloop/`. When executable policy is configured, its shared artifacts live under `.forgeloop/policy/` (`rules.json`, `baseline.json`, `policy.lock`, `discovery.json`).

---

## 7. Migrating ForgeLoop 1.0 Singleton State

<!-- BEGIN FORGELOOP LEGACY LAYOUT EXAMPLE -->

Legacy ForgeLoop 1.0 releases stored task artifacts directly under `.forgeloop/`, including `.forgeloop/current-contract.json`, `.forgeloop/work-state.json`, `.forgeloop/routing-result.json`, `.forgeloop/preflight.json`, `.forgeloop/execution-receipt.json`, `.forgeloop/events.ndjson`, `.forgeloop/gates/`, and `.forgeloop/executions/`.

<!-- END FORGELOOP LEGACY LAYOUT EXAMPLE -->

To safely migrate legacy singleton state into the modern namespaced layout:

```bash
forgeloop task-migrate --dry-run --json
forgeloop task-migrate --json
```

---

## 8. Optional advanced capabilities

The default walkthrough above is complete without these extensions. Add them
only when the task needs an extra boundary or provenance result.

### Workspace binding, handoff, and responsibility

For a task that must remain in one Git worktree, bind it explicitly and check
the derived status before mutation:

```bash
forgeloop workspace-bind --task <taskId> --json
forgeloop workspace-status --task <taskId> --json
```

Record a deterministic handoff snapshot or an optional pass constraint when
the workflow needs those boundaries:

```bash
forgeloop handoff-create --task <taskId> --note "Continue verification" --json
forgeloop handoff-list --task <taskId> --json
forgeloop handoff-show --task <taskId> --id <handoffId> --json
forgeloop handoff-accept --task <taskId> --handoff <handoffId> \
  --consumer-id <consumerId> --harness <harness> --json
forgeloop responsibility-set --task <taskId> --label implementation --allowed-path src --required-check unit-tests --json
forgeloop responsibility-status --task <taskId> --json
```

Workspace binding, handoff, and responsibility artifacts are optional. A
binding checks the complete derived repository/worktree identity; a branch name
or HEAD alone is not enough. A handoff is immutable protocol-derived context,
not delegation or evidence. A responsibility label is descriptive, not a
coder/reviewer/cleaner role, and its allowed paths, required checks, and frozen
inputs are mechanically enforced when present.

### Optional advisory context

An embedding host may inject an advisory provider through the Integration API
when extra context is useful. This is not part of the minimum quickstart:

```javascript
const runtimeContext = createForgeLoopContext({
  advisoryContextProviders: {
    "host-context": {
      id: "host-context",
      recall: async ({ query }) => ({ items: await hostLookup(query) }),
    },
  },
});
```

Recall is explicit, lazy, bounded, and non-persisted. Provider output is never
state, evidence, authority, completion truth, or executable instructions. See
[`ADVISORY_CONTEXT.md`](./ADVISORY_CONTEXT.md) for the full contract.

### Differential Verification Scope

Configure a trusted scoped checker only when it can consume canonical paths:

```json
{
  "verification": {
    "checkers": [
      {
        "checkId": "unit-tests",
        "scopeMode": "PATH_ARGUMENTS",
        "argvPrefix": ["node", "--test"],
        "pathInsertion": "APPEND"
      }
    ]
  }
}
```

Then ask ForgeLoop to resolve the scope and pass its exact paths to the
checker:

```bash
forgeloop verify-scope --task <taskId> --mode AUTO --json
forgeloop run-check --task <taskId> --id unit-tests \
  --requirement "Unit tests" \
  --scope-ref .forgeloop/task-state/<taskKey>/verification-scope.json \
  -- node --test <paths-returned-by-verify-scope>
```

`AUTO` can resolve to `CHANGED` or `CLAIMED` only with a trusted scoped
checker; otherwise it resolves to `FULL`. Explicit `CHANGED` or `CLAIMED`
without that checker returns `E_VERIFICATION_SCOPE_UNRESOLVED`, and an argv
mismatch is rejected before launch. This pre-completion decision is not
revision-range attestation coverage.

## 9. Optional code attestation

When the project enables attestation, completion captures a source-content
manifest transactionally. After completion, create and inspect the deterministic
statement:

```bash
forgeloop attestation-create --task <taskId> --json
forgeloop attestation-status --task <taskId> --json
forgeloop attestation-verify --task <taskId> --ref HEAD --json
```

For a revision range, use the provider-neutral coverage command:

```bash
forgeloop attestation-verify-range \
  --revision-provider git \
  --base origin/main \
  --head HEAD \
  --require-complete-coverage \
  --json
```

Verification commands are read-only. A valid source manifest proves exact
content binding to ForgeLoop evidence; only an additional valid external
signature can raise the trust level to `ATTESTED`.

## 10. Next Steps

- Continue a task across different AI harnesses: [`docs/CROSS_HARNESS_CONTINUITY.md`](./CROSS_HARNESS_CONTINUITY.md)
- Optional: use ForgeLoop through MCP or the Integration API — [`docs/MCP.md`](./MCP.md) and [`docs/UNIVERSAL_INTEGRATION.md`](./UNIVERSAL_INTEGRATION.md). MCP is not required; CLI and MCP share the same canonical project/task state.
- Complete command reference: [`docs/CLI_REFERENCE.md`](./CLI_REFERENCE.md)
- Artifact and schema reference: [`docs/ARTIFACT_REFERENCE.md`](./ARTIFACT_REFERENCE.md)
- Common symptoms and recovery: [`docs/TROUBLESHOOTING.md`](./TROUBLESHOOTING.md)
- Real-world operational recipes: [`docs/RECIPES.md`](./RECIPES.md)
- Code attestation and revision coverage: [`docs/CODE_ATTESTATION.md`](./CODE_ATTESTATION.md)

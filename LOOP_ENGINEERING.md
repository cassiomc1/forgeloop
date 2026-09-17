# Loop Engineering — Universal Execution Protocol

> Canonical operating cycle for this kit. Agent adapters point here; specialized
> technical rules remain in the guides selected through
> [`GUIDE_ROUTER.md`](./GUIDE_ROUTER.md).

## Navigation

- [Protocol Applicability](#protocol-applicability)
- [Blocking vs Non-Blocking Decisions](#blocking-vs-non-blocking-decisions)
- [External Workflow Compatibility](#external-workflow-compatibility)
- [Serialized Protocol Preparation](#serialized-protocol-preparation)
- [Completion Validation & Chronology](#completion-validation-and-chronology)
- [Post-Implementation Closure](#post-implementation-closure)
- [Independent Completion Dimensions](#independent-completion-dimensions)
- [Failure Taxonomy & Invariants](#failure-taxonomy-retry-and-loop-invariants)
- [Workflow State Semantics](#workflow-state-semantics)
- [Execution Contract](#execution-contract)
- [Project Discovery](#project-discovery)
- [Capability Discovery & Authority](#capability-discovery-and-on-demand-extensions)
- [Guide Selection](#guide-selection)
- [Adaptive Execution Profiles](#adaptive-execution-profiles)
- [Design & Implementation Gates](#design-and-implementation-gates)
- [Proportional Planning](#proportional-planning)
- [Execution Loop](#execution-loop)
- [Verification & Regression](#verification-and-regression)
- [Structural Quality Feedback](#structural-quality-feedback)
- [Evidence-Driven Correction](#evidence-driven-correction)
- [Precedence & Stop Conditions](#precedence)
- [Final Delivery](#final-delivery)
- [Cross-Harness Continuity](#cross-harness-execution-continuity)
- [Durable Actions and Trajectory Evidence](#durable-actions-and-trajectory-evidence)
- [Multi-Task Concurrent Project State](#multi-task-concurrent-project-state)

## Protocol applicability

ForgeLoop is a project-local engineering protocol.

If the active execution environment discovers a ForgeLoop project adapter,
ForgeLoop applies to work performed in that project regardless of the
environment's model, provider, product, IDE, agent name, runtime name, or
orchestration implementation.

Named integrations, documented discovery surfaces, previous conformance runs,
and certification records are informational evidence only. They are never an
allowlist.

An execution environment that has not been previously tested is
`CONFORMANCE_UNVERIFIED`, not `PROTOCOL_OPTIONAL`.

```text
INVALID:
"I am not a named ForgeLoop integration, therefore ForgeLoop does not apply."
"I will follow ForgeLoop only in spirit because my harness is not documented."

VALID:
"I discovered the ForgeLoop project adapter. ForgeLoop applies.
My current runtime may have unverified or limited capabilities, which I will evaluate."
```

### Unknown execution environment policy

An unknown or undocumented execution environment is not a blocker by itself.

If it discovered the ForgeLoop project adapter, evaluate capabilities:

- If protocol-capable: execute ForgeLoop normally.
- If capability-limited: execute all supported ForgeLoop dimensions, fail closed
  for unavailable dimensions, and report limitations precisely.

Never downgrade ForgeLoop to optional guidance solely because the runtime
name is unknown.

## Adaptive execution profiles

ForgeLoop separates compliance policy from execution depth:

- `complianceMode` (`advisory`, `standard`, `strict`) controls how strongly
  project policy is enforced.
- `executionProfile` (`auto`, `light`, `balanced`, `full`) controls how much
  process and context depth is appropriate for the task.

The default request is `auto`. ForgeLoop resolves it deterministically from
route signals, the task contract, and task scope. A CLI request takes
precedence over project configuration, and project configuration takes
precedence over `auto`; the safety floor always wins. A low explicit request is
escalated with a structured reason rather than treated as an error.

`light` is intended for small, local, reversible, low-risk work. Hosts should
use the smallest sufficient discovery, compact plans, targeted guide sections,
focused verification, and `next --compact` or `task-show --compact`. It does
not remove contracts, routes, preflight, required gates, verification truth,
provenance, lifecycle phases, review, or validator-backed completion.

`balanced` remains the normal profile for behavior changes, ordinary bugs,
refactors, APIs, configuration, and moderate scope. `full` is required by
authentication, secrets, personal data, publication, infrastructure,
critical-path, destructive, irreversible, and authority-sensitive work.

Optional reflection, trajectory evaluation, handoff, responsibility,
attestation, benchmark, and continuity artifacts are lazy: they are created
only when required by policy, requested by the user or host, or needed for
recovery. The first profile release does not change lifecycle chronology or
introduce a fast path.

The profile-aware context projection is presentation guidance only. A host may
use `task/context` to select targeted, normal, or expanded context, but a
profile never authorizes skipping a lifecycle phase, required gate,
verification requirement, authority check, provenance binding, safety floor,
or validator-backed completion. A phase may be absent only when the canonical
protocol determines that it is not applicable; it may never be omitted because
the resolved profile is `light`.

Usage telemetry is a separate informational domain. Only a trusted provider or
host can report `PROVIDER_REPORTED` or `HOST_REPORTED`; the CLI fallback is
explicitly `ACTOR_REPORTED`; absent data is `UNKNOWN`. ForgeLoop never
estimates tokens, promotes actor data, or treats usage as verification
evidence. `efficiency --task` reports comparisons only for a metadata-compatible
project-local baseline.

### CLI-owned artifact policy

Lifecycle-owned ForgeLoop artifacts must be created or mutated only through
the supported ForgeLoop lifecycle commands or canonical ForgeLoop APIs:

- `.forgeloop/task-state/<taskKey>/preflight.json`
- `.forgeloop/task-state/<taskKey>/work-state.json`
- `.forgeloop/task-state/<taskKey>/events.ndjson`
- `.forgeloop/task-state/<taskKey>/execution-receipt.json`
- `.forgeloop/task-state/<taskKey>/executions/<executionId>.json`
- completion recovery metadata
- canonical check/evidence state
- terminal-result lifecycle state

If the required CLI/API capability cannot be resolved:

- do not fabricate current lifecycle state;
- do not synthesize event history;
- do not manually assign `COMPLETE`;
- do not construct a fake execution receipt;
- do not invent `record-check` evidence;
- do not rewrite `events.ndjson` to simulate chronology.

Report the corresponding ForgeLoop dimension as `NOT_VERIFIED` with
`E_FORGELOOP_CLI_UNAVAILABLE`.

### Missing verification tool policy

A missing verification tool does not grant authority to install it.

When a verification command or checker is unavailable:

1. Try only already-installed or explicitly non-installing resolution paths.
2. Prefer an already available equivalent when it can verify the same requirement.
3. If no suitable local capability exists, request explicit installation authority
   only when the missing verification is genuinely required.
4. If authority is unavailable or the check is non-critical, record the affected
   verification dimension as `NOT_VERIFIED` with `E_VERIFICATION_TOOL_UNAVAILABLE`.

Do not retry a failed non-installing lookup with a command that implicitly
downloads or installs the missing package.

Examples of forbidden escalation without authority:

```text
npx --no-install TOOL → missing
npx TOOL              → implicit install
```

```text
command -v TOOL → missing
package-manager install TOOL
```

```text
local executable missing
curl | sh
```

Automatic installation is allowed only when an explicit ForgeLoop rule grants
that exact task-scoped installation authority and higher-priority platform/user
rules permit it.

A missing checker must never be converted into environmental mutation merely
to make verification pass.

### Verification command resolution modes and validator enforcement

Every verification command path is classified by resolution mode:

| Mode | Examples | May install software | Authority required |
| --- | --- | --- | --- |
| `LOCAL_EXECUTABLE` | `node scripts/test.js`, `python3 -m unittest`, `./bin/check` | No | No |
| `LOCAL_PACKAGE_BINARY` | `./node_modules/.bin/tool`, `npm test`, `pnpm test`, `yarn test` | No | No |
| `NON_INSTALLING_RESOLUTION` | `npx --no-install tool`, `npx --no tool` | No | No |
| `INSTALL_CAPABLE_RESOLUTION` | `npx tool`, `npm exec tool`, `npm x tool`, `pnpm dlx tool`, `yarn dlx tool`, `bunx tool`, `uvx tool`, `pipx run tool` | Yes | Yes (`E_INSTALLATION_AUTHORITY_REQUIRED`) |
| `EXPLICIT_INSTALLATION` | `npm install tool`, `pnpm add tool`, `pip install tool`, `cargo install tool` | Yes | Yes (`E_INSTALLATION_AUTHORITY_REQUIRED`) |

**Validator-enforced rule**: Any verification command executed via an installation-capable or explicit-installation resolution mode without a valid canonical installation authority grant is rejected by `record-check`, `audit`, and `complete` with error code `E_INSTALLATION_AUTHORITY_REQUIRED`, `E_AUTHORITY_INVALID`, `E_AUTHORITY_SCOPE_MISMATCH`, or `E_AUTHORITY_UNTRUSTED_SOURCE` and cannot contribute to `VALID` completion.

Recognized command dispatchers (such as `npm test`, `npm start`, `npm stop`, `npm restart`, `npm run <script>`, `npm run-script <script>`, `npm rum <script>`, `npm urn <script>`) are classified by their effective package resolution behavior across recognized lifecycle scripts before process launch. npm invocation parsing recognizes options (e.g. `--silent`, `--loglevel=error`) before the subcommand. Recognized npm-script dispatch is resolved recursively before process launch. `npm restart` uses npm's restart-specific lifecycle semantics (`prerestart`, `prestop`, `stop`, `poststop`, `prestart`, `start`, `poststart`, `postrestart` when `restart` is absent; `prerestart`, `restart`, `postrestart` when `restart` is present) rather than generic pre/main/post handling. ForgeLoop fails closed (`mayInstall: true`) when recursive npm-script resolution encounters a cycle or exceeds its maximum resolution depth (16). ForgeLoop does not resolve npm workspace selection in `run-check`. npm script executions using `--workspace`, `-w`, `--workspaces`, or `--ws` fail closed (`E_COMMAND_RESOLUTION_AMBIGUOUS`) because the effective `package.json` execution context may differ from the current ForgeLoop target. Run ForgeLoop against the selected workspace directory directly instead. If any nested lifecycle script invokes an installation-capable command (such as `npx`, `npm exec`, or `pnpm dlx`), the execution is elevated to `INSTALL_CAPABLE_RESOLUTION` and blocked before launch without authority.

**npm Classification Model**: npm classification is semantic and fail-closed. Unknown npm commands are not assumed safe. The classifier specifically identifies install-capable families including: `exec`/`x`, `install` aliases, `ci` aliases, `install-test` families, `install-ci-test` families, `update` aliases, `audit fix`, and conditional `init`/`create`/`innit` invocations. Unknown or ambiguous semantics fail closed (`E_COMMAND_RESOLUTION_AMBIGUOUS`).

Use `forgeloop run-check --id <id> --requirement <requirement> -- <argv>` for
observed command evidence. ForgeLoop preserves the exact argv vector, target
cwd, resolution classification, timestamps, exit status, and task/check
binding in `.forgeloop/task-state/<taskKey>/executions/<executionId>.json` before recording the
check. Resolution is classified before process launch; install-capable
resolution is rejected without a valid host-attested authority, while
`npx --no-install` remains a non-installing path and may fail honestly when a
tool is absent. `run-check` launches the supplied argv without a shell.

### Verification execution isolation

Without a trusted adapter, verification executes in the live project and is
recorded as `NATIVE_PROJECT` (`isolated: false`, `liveProjectWritable: true`,
inherited network and environment). A host may supply a trusted verification
execution adapter and an isolation policy through the integration runtime
context (`verificationExecutionAdapter`, `verificationExecutionPolicy`).
The policy modes are `NONE`, `NATIVE_PROJECT`, `PROJECT_ISOLATED`
(`isolated: true`, `liveProjectWritable: false`), and `SYSTEM_ISOLATED`
(additionally `networkPolicy: DENIED`). `liveProjectWritable` is an enforced
host guarantee reported by the adapter, not an inference from a different
working directory, and a disposable copy alone does not satisfy filesystem
isolation. Isolated execution must use a working directory separate from the
protocol project root. Contradictory isolation metadata is intrinsically
rejected before evidence persistence with `E_VERIFICATION_EXECUTION_INVALID`,
and verification that cannot satisfy the required isolation boundary fails
closed with `E_VERIFICATION_ISOLATION_UNAVAILABLE` instead of running in the
live project. ForgeLoop owns the adapter contract and evidence semantics; the
harness owns the concrete isolation backend and no specific backend is
normative.

`forgeloop record-check` is serialization-only. Its `--command` value is
metadata and is never executed. A `kind: command`, `evidenceKind: OBSERVED`
check must carry `provenance: FORGELOOP_EXECUTED` and a valid `executionRef`;
manual or actor-reported observations must use an explicit non-command kind or
provenance and must not be upgraded to command execution evidence. Completion,
audit, protocol validation, and bundles revalidate the referenced artifact and
its task, check, requirement, cycle, cwd, status, and exit-code binding.

Authority cannot be self-issued by the actor consuming it. Boolean fields inside verification evidence (such as `installationAuthorized: true`) are not sufficient proof of installation authority. Installation authority must be established via a canonical authority grant supplied by a host/operator trust boundary and referenced via `installationAuthorityRef`.

The runtime authority context has two modes:

- `NONE` is the default for the actor-facing standalone CLI. `FORGELOOP_AUTHORITY_FILE` and `FORGELOOP_AUTHORITY_DIR` may select candidate source metadata for compatibility and diagnostics, but they do not make a source trusted. An environment-selected source is rejected with `E_AUTHORITY_UNTRUSTED_SOURCE` when it is used for an installation-capable verification.
- `HOST_ATTESTED` is an internal integration context supplied by a host-owned wrapper, embedded API, or equivalent boundary. It may select a trusted authority file, directory, or in-memory provider only when the actor cannot replace that context at command invocation time. The CLI exposes no flag that promotes a source to `HOST_ATTESTED`.

External path is not equivalent to external authority ownership. The host-attested source must still resolve outside the actor-writable target, and a project-local `.forgeloop/authorities/` artifact remains an untrusted reference, cache, diagnostic, or mirror by default. A local claim such as `source: operator` is not proof of operator authority.

ForgeLoop validates authority semantics, while the host defines the trust boundary. If the host grants the actor write access to the configured attested source, the host boundary is compromised and ForgeLoop cannot distinguish operator authority from actor fabrication without a stronger external trust anchor.

### Stale receipt recovery invariant

Every recovery action returned by `forgeloop next` must be executable from the state that produced it. When work state changes legitimately after preparing a completion receipt, `forgeloop prepare-completion` refreshes the receipt and re-binds it to current state and changed paths without requiring manual deletion of `.forgeloop/task-state/<taskKey>/execution-receipt.json`.

### Conformance profile escalation policy

A run started in Standard conformance must not be silently escalated to Strict after validator-backed completion. Strict validation is a separate conformance profile. If Strict revalidation is performed after Standard `COMPLETE`, it is treated as a distinct revalidation cycle and does not retroactively invalidate a valid Standard result.

## Blocking vs Non-Blocking Decisions

Classify every unresolved decision before deciding whether to ask the user.
The question is a consequence of a `BLOCKING` classification, never a default
response to ordinary uncertainty.

### Pre-question decision classification

Before asking the user any product-detail question:

1. Classify the unresolved detail as `BLOCKING` or `NON_BLOCKING`.
2. If `NON_BLOCKING`, do not ask; choose the smallest reasonable reversible
   local default, record it in `current-contract.assumptions[]`, and continue.
3. If `BLOCKING`, record the detail in
   `current-contract.unresolvedDecisions[]`, persist and validate the contract,
   then ask the user with a blocking reason.

In short, `NON_BLOCKING` means do not ask and record it in `current-contract.assumptions[]`; `BLOCKING` means persist the contract and ask the user with a blocking reason.

There is no third `UNKNOWN → ask` path for ordinary reversible product
ambiguity. The invariant is:

```text
QUESTION
must never happen
before CLASSIFICATION
```

### PRE-QUESTION CHECK

Before asking the user, answer every item:

```text
[ ] Is this a real user/business fact?
[ ] Is this sensitive?
[ ] Is this authoritative?
[ ] Does it affect external state?
[ ] Is it destructive?
[ ] Is it irreversible?
[ ] Would a safe local reversible default materially misrepresent the user?
```

If all answers are `NO`, classify the detail as `NON_BLOCKING`, record an
assumption, and continue. If any answer is `YES`, classify it as `BLOCKING`,
persist the contract before clarification, and attach a blocking reason.

### Safe assumption rule

`NON_BLOCKING` applies when the choice is `SAFE + REVERSIBLE + LOCAL +
NON-SENSITIVE + NON-AUTHORITATIVE + NON-DESTRUCTIVE` and does not assert a real
user or business fact. Each recorded `ASSUMPTION` must include `value`, `reason`,
`scope`, `reversible=true`, and `source=agent-default`. Do not place resolved
safe assumptions in `unresolvedDecisions[]`, and never present an assumption as
a verified user or business fact.

Generally `NON_BLOCKING` when no real business fact is supplied:

```text
practice-area emphasis
fictional positioning
representative specialty mix
tone of the fictional firm
hero messaging
section ordering
fictional partner/attorney profiles
fictional office location
visual identity
palette
typography
local fictional brand name
local-only fictional identity
fictional company name
demo contact details
demo phone number
placeholder legal-service descriptions
placeholder copy
fictional testimonials
temporary logo text
local-only form behavior
```

These examples remain non-blocking only when they stay safe, reversible,
local, non-sensitive, non-authoritative, and non-destructive. Do not hardcode
one law-firm positioning into the protocol or tests.

### Blocking boundary

`BLOCKING` applies when proceeding requires any of the following:

```text
real legal business name
real contact information
real contact details
real attorney identities
credentials
payment information
payment data
production endpoints
production endpoint
deployment target
deployment/domain authority
destructive operations
destructive operation
irreversible architecture
irreversible architectural decision
irreversible data decisions
regulated or legal claims
regulated/legal claim
real compliance representations
real business facts not safely inferable
```

Blocking decisions must be written to
`current-contract.unresolvedDecisions[]`. They make `preflight` return
`BLOCKED`, but they do not prevent contract serialization.
Unresolved blocking decisions are recorded in `current-contract.unresolvedDecisions[]`.

### Question justification invariant

Asking the user is allowed only when `blockingReason` is present and comes from
a blocking category such as:

A user question requires a `blockingReason`; a question without one is invalid.

```text
REAL_BUSINESS_FACT_REQUIRED
SENSITIVE_VALUE_REQUIRED
EXTERNAL_AUTHORITY_REQUIRED
IRREVERSIBLE_DECISION_REQUIRED
REGULATED_CLAIM_REQUIRED
DESTRUCTIVE_ACTION_REQUIRED
```

Multiple reasonable aesthetic or positioning choices do not justify a question.
The executable test example in `tests/helpers/decision-classification.js`
illustrates this boundary; runtime authority remains with this protocol and the task contract. The example does not use an LLM or parse natural language.

### Contract-before-clarification sequence

The operational order is:

```text
DISCOVERY
    ↓
classify unresolved details
    ↓
create and persist current-contract.json
    ↓
persist assumptions[] and unresolvedDecisions[]
    ↓
validate contract
    ↓
if unresolvedDecisions.length > 0
    ↓
ask user with blockingReason
```

No clarification stop is allowed before a serialized contract exists. A
non-blocking ambiguity never becomes a contract blocker.

## External Workflow Compatibility

ForgeLoop's decision classification has precedence over an external workflow's
planning, brainstorming, review, testing, or documentation policy. The
canonical order remains:

```text
uncertainty → classify → NON_BLOCKING → assume → record → continue
uncertainty → classify → BLOCKING → serialize → ask
```

An external workflow may improve the plan, review the change, or recommend a
test. It must not turn a ForgeLoop `NON_BLOCKING` decision into mandatory user
approval while the task is in autonomous mode. `NON_BLOCKING` remains
`NON_BLOCKING`; a policy that requires approval for it is a
`WORKFLOW_CONFLICT`, not a user blocker. Record the conflict and continue with
the safe reversible default. Do not put the conflict in
`current-contract.unresolvedDecisions[]` as a fake user decision.

The stable compatibility reason codes are:

```text
E_EXTERNAL_WORKFLOW_APPROVAL_CONFLICT
E_EXTERNAL_WORKFLOW_BLOCKS_NON_BLOCKING
E_EXTERNAL_WORKFLOW_REQUIRES_USER_GATE
```

Autonomous mode means the active harness has explicitly selected
`autonomousMode=true`: the agent can choose safe local defaults, record
`assumptions[]`, and continue without an external approval gate for ordinary
reversible ambiguity. Interactive mode remains available only when the caller
explicitly selects `autonomousMode=false`; the harness must not silently switch
between the two modes.

When a question is considered, record its source as exactly one of:

```text
USER_REQUIREMENT
FORGELOOP_BLOCKING_DECISION
EXTERNAL_WORKFLOW_POLICY
MODEL_PREFERENCE
```

Only `USER_REQUIREMENT` and `FORGELOOP_BLOCKING_DECISION` authorize a question
in autonomous mode. `EXTERNAL_WORKFLOW_POLICY` and `MODEL_PREFERENCE` may be
recorded for diagnosis, but neither can authorize a question there. A genuine
`BLOCKING` ForgeLoop decision remains compatible with an external approval and
may produce a legitimate question with its persisted blocking reason.

The question-source invariant is:

```text
ASK_USER is allowed only when:
  classification = BLOCKING
  AND blockingReason is valid
  AND the source is not EXTERNAL_WORKFLOW_POLICY alone
```

Before asking, apply the external-workflow conflict check in addition to the
ordinary pre-question checklist:

1. Is the product decision `BLOCKING` under ForgeLoop?
2. If not, is the question required only by another workflow or skill?
3. If yes, do not ask in autonomous mode; record the incompatibility when
   useful and continue through the safe reversible assumption path.

Examples of incompatible hard gates for an otherwise `NON_BLOCKING` decision
include: “ask before implementation”, “present two or three designs and
wait”, “receive explicit approval”, and “stop until the user reviews the
specification”. Planning, review, testing, and documentation remain useful
when they do not impose that interruption.

The compatibility distinction is explicit:

| External workflow behavior | Autonomous-mode result |
| --- | --- |
| Adds local planning without a user gate | Compatible; continue the ForgeLoop loop. |
| Adds a local review or checklist | Compatible; continue the ForgeLoop loop. |
| Adds deterministic tests | Compatible; continue the ForgeLoop loop. |
| Adds documentation generation | Compatible; continue the ForgeLoop loop. |
| Approval for a real `BLOCKING` decision | Compatible; a justified question is allowed. |
| Approval for every design choice | `INCOMPATIBLE WITH AUTONOMOUS MODE`; record `WORKFLOW_CONFLICT`, do not ask. |
| Approval before any implementation | `INCOMPATIBLE WITH AUTONOMOUS MODE` unless a real blocker exists. |
| Reclassifying a reversible local aesthetic choice as blocking | `INCOMPATIBLE WITH AUTONOMOUS MODE`; preserve `NON_BLOCKING`. |
| Spawning agents that change precedence | Not suitable for an isolated blind-conformance run; it does not change this contract. |

"Installed" and "compatible" are different claims. A harness can have an
external workflow installed and still be `INCOMPATIBLE WITH AUTONOMOUS MODE`.
Use that wording instead of calling the workflow broken. The deterministic
test example in `tests/helpers/workflow-compatibility.js` exercises this boundary;
it does not modify `tests/helpers/decision-classification.js`, invoke an LLM, or
redesign a runtime, arbiter, supervisor, or approval broker.

For the sixth blind conformance run, exclude mandatory-approval workflows at
the harness level rather than weakening the blind prompt. Record the harness
state before starting:

```text
mandatory-approval workflows enabled: NO
external brainstorming hard gate enabled: NO
external design approval gate enabled: NO
subagents enabled: NO
delegation enabled: NO
```

If the harness cannot disable a mandatory approval workflow, record
`TEST_NOT_STARTED` and do not claim a conformance result.

## Serialized protocol preparation

ForgeLoop keeps the agent responsible for implementation while making the
pre-implementation contract observable. Before executable changes, the target
should contain a schema-valid task contract (`.forgeloop/task-state/<taskKey>/contract.json`) and a persisted
`.forgeloop/task-state/<taskKey>/routing-result.json`. Guide metadata can declare mandatory gates;
those gates are recorded under `.forgeloop/task-state/<taskKey>/gates/` and are checked by:

```text
forgeloop preflight
```

`preflight` validates local ForgeLoop artifacts only. It does not invoke the model, run project commands, or treat a prose declaration as evidence. A `READY` result is required before `EXECUTING` in standard and strict workflows. A non-empty `current-contract.unresolvedDecisions[]` causes `forgeloop preflight` to return `BLOCKED` with `E_CONTRACT_UNRESOLVED_DECISION`; a valid `current-contract.assumptions[]` list does not block preparation.

### Resumable activation and artifact reconciliation

`PREFLIGHT_READY` is a durable checkpoint, not only a status value. A persisted
READY result is valid only when the same target also contains:

```text
current-contract.json
routing-result.json
gates required by the route
work-state.json
events.ndjson with the activation chronology
preflight.json with status READY
```

The activation event matrix is explicit:

| Stage | Event | Requirement |
| --- | --- | --- |
| Task received | `TASK_RECEIVED` | New activation; one first event when the ledger is empty |
| Contract validated | `CONTRACT_VALIDATED` | Before READY |
| Route validated | `ROUTE_VALIDATED` | Before READY |
| Gate satisfied | `GATE_SATISFIED` | One event for each satisfied required gate |
| Preflight blocked | `PREFLIGHT_BLOCKED` | Persisted when activation is blocked |
| Preflight ready | `PREFLIGHT_READY` | Exactly the matching READY fingerprints and gate sets |

The ledger is append-only and hash-linked. A `BLOCKED → READY` recovery keeps
the original `PREFLIGHT_BLOCKED` event, appends only newly satisfied gate and
readiness events, and never deletes or rewrites history. `forgeloop next` is a
read-only query: if READY remains but `work-state.json` is missing, it returns
`RESOLVE_BLOCKER` with `E_STATE_MISSING_AFTER_PREFLIGHT_READY` instead of
silently returning to discovery.

`PROJECT_PROFILE.md` distinguishes planned template locations from files
observed in the target. New targets receive canonical documents under
`.forgeloop/kit/`; root `AGENTS.md`, `CLAUDE.md`, Cursor, and Copilot files are
minimal native shims. `forgeloop update` migrates unchanged managed legacy root
files, preserves modified or unowned files, and reports conflicts without
following symlinks or escaping the selected target. Migration validates the
complete plan, writes and verifies hidden destinations, atomically switches the
manifest authority, and then cleans only legacy files whose recorded ownership
hash still matches. `doctor` reports `E_MIGRATION_INCOMPLETE` for an interrupted
authority switch or cleanup; a later `update` may safely resume that cleanup.

## Completion validation and chronology

`COMPLETE` is a validator result, not a string an agent may assign by itself.
The local `events.ndjson` ledger records protocol milestones and hash links,
without prompts, hidden reasoning, credentials, or arbitrary command output.
The final validator checks the contract, route, state, gates, structured checks,
evidence coverage, receipt consistency, freshness, and chronology:

```text
forgeloop audit --strict
forgeloop complete
```

Every load-bearing success criterion must have `COVERED` evidence. A required
`OBSERVED` check cannot be satisfied by `INFERRED`, `NOT_VERIFIED`, or
`BLOCKED` evidence. If the validator cannot be run, use
`COMPLETE (FORGELOOP COMPLETION NOT VERIFIED)` rather than claiming protocol
validity.

## Post-implementation closure

Implementation finished is not task finished, and tests executed are not the
same as verification recorded. After implementation begins, do not stop or
return the final result while the ForgeLoop task remains in `EXECUTING`.

ACT → QUERY NEXT → ACT → QUERY NEXT → … → TERMINAL

At each lifecycle boundary, query persisted state with `forgeloop next` before
choosing the next action. Always query after implementation, verification,
correction, and review. The query is advisory and read-only; the host agent
runs checks and applies the returned legal transition or repair action.

```text
POST-IMPLEMENTATION CLOSURE

EXECUTING
    ↓ forgeloop next
advance --to VERIFYING
    ↓ forgeloop next
prepare-completion
    ↓
run applicable project checks
    ↓
run commands with run-check; record manual observations with record-check
    ↓ forgeloop next
advance --to REVIEWING
    ↓ forgeloop next
complete
    ↓ VALID
COMPLETE
```

`prepare-completion` creates or refreshes the in-progress execution receipt.
It does not claim completion. The receipt is the structured container used by
subsequent `record-check` operations; completion remains invalid until required
observed evidence, review state, chronology, and validator requirements are
satisfied.

The host agent runs applicable checks after the receipt exists, uses `run-check`
for commands, and uses `record-check` for manual or non-command observations.
`run-check` records exact command provenance; `record-check` records supplied
metadata only and never executes its `--command` value. Query `forgeloop next`
before each subsequent lifecycle action.

Continue until the terminal outcome is either validator-backed `COMPLETE` or
an explicitly reported `BLOCKED` / `PARTIALLY VERIFIED` result with exact
unresolved findings. Record verification evidence before review. If a required
check fails, use `VERIFYING → DIAGNOSING → CORRECTING → VERIFYING`; do not skip
the evidence recording step or replace it with prose.

If completion is rejected only because evidence is missing, partial, invalid,
or insufficiently observed, ForgeLoop persists `COMPLETION_REJECTED` and
authorizes `REVIEWING → VERIFYING` without requiring product diagnosis. Each
restart increments `verificationCycle`; receipts and recorded checks bind to
the current cycle. Lifecycle-owned terminal criteria such as validator-backed
`COMPLETE` are satisfied by lifecycle events, not by pre-completion
`record-check` claims. Compound `ALL` checks cannot pass while any declared
component is failed, blocked, partial, or not verified.

### Diagnosis Ledger and Evidence-Driven Correction

When a check fails during verification (`VERIFYING → DIAGNOSING`), the actor must record an append-only diagnosis event in the lifecycle ledger before entering `CORRECTING`:

```bash
forgeloop record-diagnosis \
  --hypothesis="Specific root-cause hypothesis explaining the verification failure" \
  --failure-class="VERIFICATION_FAILURE" \
  --evidence-ref="check-id" \
  --settled-by="Observable condition that settles or falsifies the hypothesis" \
  --next-safe-action="Smallest safe local action to address the hypothesis"
```

- **Single Source of Truth**: The append-only, hash-chained `events.ndjson` is the sole authority for diagnosis chronology (`DIAGNOSIS_RECORDED` events). The mutable `work-state.diagnosedHypothesis` field is maintained strictly as a backward-compatibility projection.
- **Evidence Binding**: `evidence-ref` must reference at least one failed or blocked check from the active `verificationCycle`.
- **Information Gain Classification**: Each diagnosis is classified by comparing its normalized semantic fingerprint (`sha256(failureClass:normalizedHypothesis:sortedEvidenceRefs)`) against previous task diagnoses:
  - `FIRST_DIAGNOSIS`: Initial diagnosis for the task.
  - `NEW_HYPOTHESIS`: Distinct hypothesis with previously observed evidence.
  - `NEW_EVIDENCE`: Same hypothesis supported by newly observed evidence checks.
  - `NEW_HYPOTHESIS_AND_EVIDENCE`: Both hypothesis and evidence references are new.
  - `NONE`: Repeating the previous hypothesis with the exact same evidence.
- **Idempotent Recovery in the Same Cycle**: Retrying `record-diagnosis` with the identical hypothesis and evidence within the *same* verification cycle is idempotent. It reuses the existing event, repairs or synchronizes `work-state.diagnosedHypothesis`, advances `work-state.lastUpdated`, and returns `idempotent: true` without appending a duplicate event or triggering a false stall.
- **No Retry Without Information Gain**: Repeating the same hypothesis and evidence in a *subsequent* verification cycle produces `informationGain: NONE`. Such diagnoses are recorded in the event ledger for auditability but cannot authorize a correction phase transition (`DIAGNOSING → CORRECTING` fails with `E_DIAGNOSIS_NO_NEW_INFORMATION`, and `forgeloop next` returns `CHANGE_STRATEGY`). Superficial alterations to `settled-by`, `next-safe-action`, or formatting without changing the underlying hypothesis or evidence references do not generate information gain.
- **Legacy Compatibility Invariant**: Tasks created under older protocol-v1 revisions that have `diagnosedHypothesis` populated in `work-state.json` without a corresponding `DIAGNOSIS_RECORDED` event remain readable. However, `forgeloop next` returns `RECORD_DIAGNOSIS` and `DIAGNOSING → CORRECTING` fails with `E_DIAGNOSIS_REQUIRED` until a formal diagnosis is appended via `forgeloop record-diagnosis`. ForgeLoop never synthesizes historical events automatically.

### Progress Stall Detection (`forgeloop progress`)

Task progress across iterative verification cycles is evaluated deterministically without heuristics, model confidence scores, or chain-of-thought introspection:

- **Statuses**:
  - `ADVANCING`: Failure counts are low, or new diagnostic information gain is present.
  - `WATCH`: A single requirement has failed across 3+ distinct cycles with changing diagnoses, or the task has reached a high cycle count ($\ge 4$). High cycle count alone produces `WATCH`, never a hard stall.
  - `STALLED`: The latest diagnosis has `informationGain: NONE` (global stall with signal `NO_DIAGNOSTIC_INFORMATION_GAIN`), or a specific requirement failed 3+ times with identical diagnoses (`REPEATED_FAILURE_WITH_SAME_DIAGNOSIS`).
- **Requirement-Specific Attribution**: Stall signals are mapped to individual contract requirements strictly through `evidenceRefs → check → requirement`. A stall on one requirement does not fabricate false repeat-diagnosis signals for unrelated requirements.
- **Strategy Change**: When stalled, `forgeloop next` returns action `CHANGE_STRATEGY` with error code `E_PROGRESS_STALLED`. This directs the actor to formulate a genuinely new root-cause hypothesis, gather independent diagnostic evidence, or change the technical approach.

### Decision Settlement Criteria

Unresolved contract decisions in `current-contract.unresolvedDecisions[]` can be paired with append-only settlement criteria bound to the active contract fingerprint:

```bash
forgeloop record-decision-criterion \
  --decision="Exact text of unresolved decision" \
  --settled-by="Criteria or guidance that settles the decision"
```

- **Contract Schema Compatibility**: `current-contract.unresolvedDecisions[]` remains an array of strings (`string[]`) under `protocolVersion: 1`. Criteria are persisted as `DECISION_CRITERION_RECORDED` events in `events.ndjson` bound to `contractFingerprint`.
- **Guidance Surfacing**: `forgeloop next` surfaces recorded criteria in its blocker reasons as `SETTLEMENT_CRITERION` (for a single decision) or `SETTLEMENT_CRITERIA` with an `items[]` array (for multiple decisions). Decisions without recorded criteria do not receive fabricated guidance.
- **Fingerprint Binding and Staleness**: A criterion is valid only while the contract fingerprint matches. If the contract is modified, previous criteria bound to older fingerprints are automatically ignored as stale.
- **Non-Bypassing**: Recording a settlement criterion attaches advisory guidance only; it does not automatically resolve the decision or make preflight `READY`. The contract must still be explicitly updated or resolved before execution begins.

## Independent completion dimensions

Local task completion, verification, publication, and production readiness are
separate dimensions. A valid local result can therefore be reported as:

```text
TASK: COMPLETE
VERIFICATION: VALID
PUBLICATION: LOCAL_ONLY
PRODUCTION_READINESS: NOT_VERIFIED
```

ForgeLoop does not execute commands from profiles, contracts, receipts, state,
or policy artifacts. Publication and deployment require their own authority and
observed evidence.

Validators expose stable repair-oriented codes such as
`E_CONTRACT_MISSING`, `E_ROUTE_STALE`, `E_GATE_UNVERIFIED`,
`E_PHASE_CHRONOLOGY_INVALID`, `E_EVIDENCE_COVERAGE_PARTIAL`,
`E_PROFILE_SOURCE_UNKNOWN`, `E_RECEIPT_ROUTE_MISMATCH`, and
`E_PUBLICATION_CLAIM_UNVERIFIED`. Integrations should consume the code and
artifact paths rather than parse human-readable prose.

## Core principle

Never treat a request as an isolated instruction or the first plausible answer
as completion.

```text
RECEIVE REQUEST
      ↓
DISCOVER CONTEXT
      ↓
DEFINE CONTRACT
      ↓
SELECT GUIDES
      ↓
PLAN → EXECUTE → VERIFY
                    ↓
          ┌─────────┴─────────┐
          │                   │
        PASSED              FAILED
          │                   │
PROPORTIONAL REGRESSION   DIAGNOSE CAUSE
          │                   │
       FINISH          CORRECT AND VERIFY
```

The loop creates real feedback until objective criteria are met. It does not
authorize infinite execution, scope expansion, or unrequested external action.

## Protocol version and evidence contract

The portable protocol currently uses `protocol-version: 1`. This version is
independent of the npm package version and is carried by structured routing,
state, receipt, and delegation artifacts.

Every result separates:

```text
Observed       current command, file, hash, or test evidence
Inferred       conclusion derived from observed evidence
Not verified   check not run or target outside the environment
Blocked        genuine external condition preventing safe progress
```

Do not present an inference, an unrun check, or a local result as observed
proof. Local success never implies publication, deployment, or remote-check
success.

The protocol-support CLI is local and offline-capable by default. It sends no
telemetry, does not require a central trace server, and never executes commands
found in untrusted profile, receipt, or state data.

## Failure taxonomy, retry, and loop invariants

The protocol uses these stable failure classes:

```text
CONTRACT_FAILURE
DISCOVERY_FAILURE
ROUTING_FAILURE
IMPLEMENTATION_FAILURE
VERIFICATION_FAILURE
REGRESSION_FAILURE
REVIEW_FAILURE
CAPABILITY_FAILURE
AUTHORITY_FAILURE
ENVIRONMENT_FAILURE
EXTERNAL_SERVICE_FAILURE
STALE_STATE_FAILURE
OPERATOR_INTERRUPTION
```

For every failure, record the class, hypothesis, evidence, and next safe
action. A retry is allowed only when new diagnostic evidence or a changed
hypothesis exists. The same hypothesis with the same evidence is not an
immediate retry. Repeated review/fix cycles are bounded by the task contract;
an unavailable external dependency becomes a blocker rather than a spin loop.

The loop invariants are:

1. no completion claim without current verification evidence;
2. no route without a reason code;
3. no retry without new evidence or a changed hypothesis;
4. no destructive action without validated authority and target;
5. no project-profile fact without a source;
6. no external publication implied by local success;
7. no skipped failed check silently treated as passed;
8. no unrelated refactor during uncertain diagnosis;
9. no secret in the profile, work state, receipt, or delegation artifacts;
10. no independent-agent claim when only self-review occurred.
11. no EXECUTING phase without a valid current contract.
12. no EXECUTING phase without a valid route when routing is required.
13. no EXECUTING phase while a mandatory pre-implementation gate is unsatisfied.
14. no COMPLETE phase without evidence coverage for every required success criterion.
15. no COMPLETE phase with stale contract, route, gate, state, or receipt fingerprints.
16. selected guides must match across route, work state, and receipt.
17. an agent decision cannot be recorded as a user fact.
18. a required OBSERVED check cannot be satisfied by INFERRED evidence.
19. BLOCKED evidence cannot be represented as PASSED.
20. completion must be validated by the protocol, not only declared by the agent.
21. protocol chronology must not permit execution before mandatory preflight events.
22. publication status and production readiness must remain independent from local task completion.
23. a task with implemented deliverables must not terminate in EXECUTING.
24. a persisted PREFLIGHT_READY result must reconcile with a resumable state and
    its matching append-only activation chronology.
25. planned profile fields must not be reported as present target evidence.

The serializable phase and transition contract is maintained in
[`ORCHESTRATOR_INTEGRATION.md`](./ORCHESTRATOR_INTEGRATION.md). It is a host
integration boundary, not an execution runtime; semantic validation checks that
its phase list, transitions, invariants, schema version, and no-runtime markers
remain aligned with this loop.

## Workflow state semantics

The canonical phases are `RECEIVED`, `DISCOVERING`, `CONTRACT_READY`,
`ROUTED`, `DESIGNING`, `PLANNED`, `EXECUTING`, `VERIFYING`, `DIAGNOSING`,
`CORRECTING`, `REVIEWING`, `COMPLETE`, and `BLOCKED`. A task may skip
proportional phases, but:

- `COMPLETE` requires verification evidence;
- `BLOCKED` requires a blocker category and evidence;
- `CORRECTING` requires a diagnosed hypothesis;
- `ROUTED` requires at least one route reason, even if no technical guide is
  selected for documentation-only work;
- `REVIEWING` cannot claim independent review when reviewer and implementer
  identities are equal.

Immediately after `task-create`, a task may have a valid descriptor and
hash-linked `TASK_RECEIVED`/transaction history without `work-state.json`.
ForgeLoop derives `RECEIVED` from that canonical early artifact set. `next`
returns `DISCOVER`, and `discover` appends the initial discovery milestone
without creating synthetic work state. `next` then returns `CREATE_CONTRACT`;
`contract-create` persists and validates the real contract and materializes the
first work-state checkpoint with its actual contract fingerprint. Invalid,
contradictory, or unexpected early history remains inconsistent.

Resume rules are conservative: revalidate branch, HEAD, contract fingerprint,
protocol version, and required artifacts before continuing; never rerun a
completed destructive or publication action automatically; rerun cheap
verification when state is stale; and clear only task work state (`.forgeloop/task-state/<taskKey>/work-state.json`)
when abandoned state must be removed.

## Execution contract

Before changing files, translate the request into a contract proportional to
the task:

```text
OBJECTIVE
Observable state that must exist at the end.

CONTEXT
Relevant files, modules, services, data, dependencies, and rules.

DELIVERABLES
Expected changes, artifacts, or answers.

CONSTRAINTS
What must not be broken, removed, published, or assumed.

RISKS
Regression, security, data, compatibility, and external effects.

VERIFICATION
Checks capable of demonstrating the result.

SUCCESS
Objective conditions that must be true.

STOP
Verified success or a genuine external blocker.
```

Do not interrupt the user for information that can be discovered safely in the
project. Request a decision when legitimate alternatives produce materially
different outcomes, authority is missing, or the action is destructive.

Unknown non-blocking details do not prevent contract creation. Record them as
reversible agent assumptions in `current-contract.assumptions[]` and continue.
Unresolved blocking decisions, missing authority, and unsafe-to-infer facts
must be serialized in `current-contract.unresolvedDecisions[]`; they prevent
`preflight` from returning `READY` and block `EXECUTING` until resolved, not
contract creation or serialization.

### Classify the request

- **Answer, explain, or review:** inspect and report evidence; do not make implicit changes.
- **Diagnose:** reproduce and determine the cause; implement only when a fix is in scope.
- **Create or change:** implement, test, and document in proportion to risk.
- **Publish or operate external systems:** confirm the target and authority before changing state.
- **Delete or overwrite:** resolve the exact target, prefer recoverable methods, and verify the result.

The user's latest explicit instruction replaces incompatible earlier requests
but does not silently broaden scope.

## Project discovery

Read the closest instructions for the directory in scope. Then inspect only
sources that exist and are relevant:

```text
AGENTS.md
CLAUDE.md
README.md
CONTRIBUTING.md
PROJECT_PROFILE.md
package.json
pyproject.toml
requirements.txt
Cargo.toml
go.mod
Makefile
docker-compose.yml
Dockerfile
.github/workflows/
docs/
src/
tests/
```

Discover before inferring:

- product, stack, platforms, and architecture;
- official development, lint, test, typecheck, and build commands;
- CI, release, deployment, and environments;
- Git state and pre-existing changes;
- external services, persistence, and security surfaces;
- browsers, devices, and accessibility requirements;
- project-specific decisions.

A text reference to a technology does not prove it is active. Confirm it through
manifests, imports, configuration, execution, or authoritative documentation.

### Persistent profile

Use [`PROJECT_PROFILE.md`](./PROJECT_PROFILE.md) as a cache of durable facts:

1. verify a source before recording or changing a fact;
2. leave unknown facts unverified;
3. cite a path, command, or other evidence;
4. never record secrets or credentials;
5. do not turn the profile into a task log;
6. preserve explicit decisions until newer evidence replaces them.

When the profile conflicts with the repository, current verifiable state wins.
Correct only the affected profile facts.

## Capability discovery and on-demand extensions

When a task may require image, video, document, audio, OCR, grounding,
segmentation, web search, generation, editing, long-video memory, or 3D
tooling, the agent must verify the capability boundary before using it:

1. Classify the operation and identify whether it needs a model capability, a
   skill, an MCP server, an API-backed provider, or a system dependency.
2. Inspect the active model and harness for native support, registered skills,
   MCP servers, and callable tools. A prompt, package name, or documentation
   reference is not evidence that the current session can call a tool.
3. Reuse an existing callable capability when it is sufficient for the task.
4. If the required capability is missing and a keyless Qwen path exists,
   install only the smallest matching capability, normally
   `qwen-mm-plugins-core` for multimodal reading. Use the active harness's
   native installation mechanism or the official
   [Qwen-MM-Plugins](https://github.com/QwenLM/Qwen-MM-Plugins) instructions.
5. If the operation is API-backed, check the required environment variable or
   configured service endpoint before enabling it. Without that prerequisite,
   keep the optional capability disabled and continue with a keyless path or
   report exactly what must be configured.
6. Verify registration and dependencies with the harness capability listing
   and the upstream plugin's supported verification/check command.
7. Invoke the callable tool for the task and report missing system tools,
   unavailable credentials, or model/harness limitations. Do not claim a
   capability based only on a downloaded package or an unsuccessful fallback.

This installation is task-scoped and capability-scoped, not a startup-wide
installation of every plugin. The agent must never create, guess, persist, or
expose an API key. System-level package installation, global configuration,
network access, and credentials remain subject to host controls. If the active
harness cannot register skills or MCP tools, the agent must state that the
capability is unavailable rather than pretending to use it.

## Guide selection

Read [`GUIDE_ROUTER.md`](./GUIDE_ROUTER.md) after discovery and before planning.

Required rules:

- select all guides applicable to the intent, changed surfaces, and risks;
- do not load every guide as a precaution;
- locate headings and relevant sections with `rg` before reading a long file;
- read the whole guide only when the task crosses the whole domain;
- briefly report the selected guide IDs and reason;
- treat optional references as options; only the task-scoped Qwen capability
  policy above permits its matching installation, while unrelated resources
  remain gated.

A guide provides specialized defaults. It does not replace explicit product
requirements, closer instructions, code evidence, or higher-level host rules.

## Design and implementation gates

### Design gate

Before behavior, feature, architecture, or instruction changes, do proportional
design after discovery. Classify unresolved design decisions before requesting
approval. Require user approval only for load-bearing decisions whose
alternatives materially change the requested product and cannot be resolved
through a safe, reversible local default. For non-blocking prototype choices,
choose a reasonable default, record the assumption, and continue. Retain
approval for material alternatives and external or irreversible decisions. For
small documentation maintenance, keep the treatment compact while still
confirming the objective, boundaries, and verification.

Use the [Execution contract](#execution-contract), [Project discovery](#project-discovery),
[Guide selection](#guide-selection), and [Proportional planning](#proportional-planning)
sections as the canonical sources for context, routing, and plan depth.

### Plan contract and task briefs

Every implementation plan or task brief must be self-contained for its scope
and state the objective, architecture, technology, global constraints, exact
files or interfaces, verification, and commit boundaries. Independent tasks
must stay independently executable without hidden dependencies on unpublished
conversation context.

For long or multi-task work, keep an ignored ledger scoped to the plan. Use
`DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, and `BLOCKED` to support
recovery and resume for completed work, concerns, missing context, and
blockers rather than turning the ledger into a task log.

Use the [Execution contract](#execution-contract) for the required fields, the
[Project discovery](#project-discovery) and [Guide selection](#guide-selection)
sections for evidence and routing, and [Stop conditions](#stop-conditions) for
genuine blockers.

### Test-first implementation

For behavior changes, use RED → expected failure → minimal GREEN → refactor,
with the testing strategy and risk depth anchored in
[`ENG/test-code-eng.md`](./ENG/test-code-eng.md) and the
[Verification and regression](#verification-and-regression) plus
[Evidence-driven correction](#evidence-driven-correction) sections. Explicit
exceptions are documentation-only work, generated output, or throwaway
exploration that will not become maintained production behavior.

### Review and recovery

self-review is required but is not independent review. For multi-task work,
specification compliance before code quality: first verify that the result
matches the approved contract, then evaluate implementation quality. Handle one
finding at a time, stop after at most five review-fix rounds, and treat any
unresolved load-bearing finding as blocked until the contract or implementation
changes.

Use [Evidence-driven correction](#evidence-driven-correction) for diagnosis,
[Verification and regression](#verification-and-regression) for re-checking,
and [Stop conditions](#stop-conditions) when a blocker remains genuine.

### Worktree and capability degradation

Prefer native isolation when the harness provides it; otherwise use an approved
ignored local worktree and require explicit consent before working directly on
the main branch. When optional subagent, todo, web, or isolation capabilities
are missing, fall back inline or to a plan file, report the degraded mode, and
never invent a tool call.

Use [Capability discovery and on-demand extensions](#capability-discovery-and-on-demand-extensions)
for callable-tool proof, [Execution loop](#execution-loop) for scoped progress,
and [Stop conditions](#stop-conditions) when the missing capability removes a
required verification path.

## Instruction and adapter hygiene

Write canonical rules once in this file and make adapters delegate to
`LOOP_ENGINEERING.md`, `PROJECT_PROFILE.md`, and `GUIDE_ROUTER.md` rather than
copying process bodies. Adapter descriptions are trigger and reference text,
not duplicate policy. Mechanical contracts belong in tests. New harness
adapters should use the harness's native installation and context-loading path
without editing global configuration, and actual bootstrap or context loading
should be proven with a unique marker where possible.

Keep capability rules in [Capability discovery and on-demand extensions](#capability-discovery-and-on-demand-extensions),
routing in [Guide selection](#guide-selection), planning in
[Proportional planning](#proportional-planning), execution in
[Execution loop](#execution-loop), verification in
[Verification and regression](#verification-and-regression), correction in
[Evidence-driven correction](#evidence-driven-correction), and exit handling in
[Stop conditions](#stop-conditions).

## Proportional planning

### Simple task

```text
Objective → small change → specific check → final review
```

### Medium task

```text
Objective → investigation → short plan → verifiable steps
→ related regression checks → final review
```

### Complex task

```text
Objective → system map → risks and dependencies → subtasks
→ per-subtask validation → integration → broad regression
```

Every step must produce a testable result. Split components by responsibility
and keep interfaces explicit. Do not create extensive plans for trivial changes
or hide complex work in one vague step.

## Execution loop

1. Confirm the objective and success condition.
2. Collect the smallest sufficient context.
3. Preserve user changes and keep the diff scoped.
4. For bugs, reproduce the failure and capture evidence before fixing it when practical.
5. Make the smallest coherent change that addresses the cause or delivers the capability.
6. Run the specific check.
7. If it fails, diagnose before editing again.
8. After the specific check passes, run proportional regression checks.
9. Inspect the result and the complete diff.
10. Finish only with current evidence.

Do not bundle independent changes while the cause remains uncertain. Do not
refactor large areas merely because they could be improved.

## Verification and regression

Choose checks that match the artifact and risk.

### Code

- focused and regression tests;
- lint and formatting;
- typecheck;
- production build;
- imports, runtime errors, and public contracts;
- relevant compatibility and edge cases.

### Backend, APIs, and data

- status codes and payloads;
- authentication and authorization;
- validation, persistence, and idempotency;
- migrations, constraints, indexes, and rollback;
- real integrations or doubles appropriate to the test level;
- logs without secrets or sensitive data.

### Interfaces

- normal, loading, empty, error, and disabled states;
- responsiveness and lack of overflow;
- keyboard, focus, contrast, and applicable assistive technology;
- browser console;
- API integration;
- production and target-device measurement when required.

### Infrastructure and automation

- syntax and schema;
- permissions and variables;
- rollback plan;
- health checks;
- CI-equivalent execution when practical.

### Documentation

- consistency with real state;
- commands and paths;
- links and references;
- examples;
- Markdown and language.

Regression depth grows with risk: specific check, related tests, then suite,
build, and integration validation when reasonable.

<a id="FL-SQ-001"></a> **FL-SQ-001 — Structural-quality evidence MUST remain provider-neutral, task-bound, delta-first, and separate from other verification dimensions.**

### Structural quality feedback

Structural quality is an optional provider-neutral verification dimension. It
is a measurement of dependency structure, not a guide, a static analyzer built
into ForgeLoop, or a universal software-quality score. The external provider
remains a replaceable sensor while ForgeLoop owns policy and evidence.

When enabled, capture a task-bound baseline after planning and immediately
before execution. In `VERIFYING`, record the current-cycle evaluation before
entering `REVIEWING`. A gate requires a comparable current-cycle pass; observe
mode exposes the result or limitation without adding a completion blocker;
off mode does not resolve or launch a provider.

The baseline is immutable after `EXECUTING`. Provider identity/version, policy,
route, contract, scope, and rules drift makes observations incomparable. A
regression follows the existing `VERIFYING -> DIAGNOSING -> CORRECTING ->
VERIFYING` loop with evidence-backed diagnosis; ForgeLoop does not fabricate a
diagnosis. Do not claim `PASS` for unavailable or malformed evidence.

Optional optimization is bounded, advisory, and scope-safe. It may use at most
two extra evaluations in a verification cycle, never becomes required for
completion, never widens claims, and never chases a perfect score. See
[`docs/STRUCTURAL_QUALITY.md`](./docs/STRUCTURAL_QUALITY.md) for the provider
contract, policy fields, commands, artifact layout, and Sentrux boundary.

### Executable Policy & Autonomy-Preserving Invariants

ForgeLoop enforces executable verification rules (`.forgeloop/policy/rules.json`) that evaluate constraints on code and artifacts.

Autonomy invariant: **zero mandatory configuration, zero mandatory questions, deterministic discovery first, safe defaults second, graceful reduction of enforcement under uncertainty, and explicit configuration only as an optional override.** Uncertainty and corruption are different: uncertainty reduces enforcement where designed (for example, an unknown architecture produces no mandatory architecture question), while a broken trust boundary fails closed (for example, malformed policy produces `E_POLICY_INVALID`).

The enforceable invariants are:

1. **Zero-Interaction Autonomy Invariant**: The default workflow (`init` → `discovery` → `task creation` → `routing` → `execution` → `verification` → `completion`) must run to completion without interactive prompts, interviews, or mandatory user configuration.
2. **Uncertainty Principle**: "Uncertainty reduces enforcement; uncertainty does not stop execution." When architecture, patterns, or tools cannot be inferred with high confidence, ForgeLoop records `confidence: "LOW"` or `confidence: "UNKNOWN"`, skips unproven rules or treats them as advisory, and proceeds with execution.
3. **Brownfield Baseline Tolerances**: Existing violations in a repository are fingerprinted (SHA-256) into `.forgeloop/policy/baseline.json`. Baselined debt does not block task completion. Only *new* violations introduced during the task are blocking.
4. **Monotonic Ratchet-Down**: As legacy debt is resolved, running `forgeloop baseline --update` removes the resolved fingerprints, preventing regression without re-introducing solved violations. It never adds new debt.
5. **Mutation-Backed Verification**: Rule checkers must prove efficacy against synthetic mutation fixtures via `forgeloop rule-verify`. Expected `FAIL` with checker `FAIL` yields `PROVEN`. Expected `FAIL` with checker `PASS` yields `UNPROVEN` (`CHECK_MUTATION_NOT_DETECTED`).
6. **Inert Check Graceful Degradation**: Automatically discovered inert checks (no matching files or adapters) degrade to `UNSUPPORTED`/`ADVISORY` with `isInert: true` and no error. Explicit project-configured blocking rules with no effective scope fail with `E_CHECK_INERT` to signal configuration errors.
7. **Policy Diffing & Drift Detection**: Preflight captures a task policy snapshot (`policy-snapshot.json`). If workspace policy is modified mid-task, `forgeloop policy-status` detects policy drift. Drift is classified into `TIGHTEN` (stricter rules/debt reduction), `NEUTRAL`, `WEAKEN` (relaxed rules/expanded debt), or `UNKNOWN` (legacy snapshot without baseline state). Weakening takes precedence if both occur and blocks completion (`E_POLICY_WEAKENING`).
8. **Mutation Proof States & Error Correctness**: `verifyRuleMutation` strictly distinguishes `PASS`, `FAIL`, and `ERROR`. Checkers throwing unhandled exceptions produce `observed: ERROR`, `CHECK_MUTATION_EXECUTION_ERROR`, and null `proofDigest`. A checker crash is never treated as proof of detecting a mutation.
9. **Fail-Closed Policy Availability**: Absence of policy in legacy targets continues with `capability: "NOT_PRESENT"`. Present but corrupt or schema-invalid artifacts fail closed with `E_POLICY_INVALID` (blocking preflight and completion), and evaluation exceptions fail closed with `E_POLICY_EVALUATION_FAILED`.
10. **Enforced Policy Lock Boundary**: `policy.lock` derives deterministically from effective rules (`built-in rules` + `discovered rules` + `project rules/overrides`) and `baseline`. Modern locks require `algorithm`, `digest`, `rulesDigest`, and `baselineDigest` to participate in integrity validation. `capturedAt` is non-semantic metadata and changes to it alone do not represent a policy change. Lock verification is enforced in `policy-status`, `audit`, and `complete`; unauthorized modifications produce `E_POLICY_LOCK_MISMATCH`.
11. **Semantic Baseline Snapshots**: Task snapshots retain full semantic baseline entries. Drift diffing classifies fingerprint additions as `WEAKEN` and removals as `TIGHTEN`. Legacy snapshots lacking baseline state classify drift as `UNKNOWN` rather than inventing prior state.
12. **Baseline Recording Protection During Active Tasks**: Re-recording baseline debt via `baseline --record` is blocked during active policy-bound tasks (`E_BASELINE_RECORD_DURING_ACTIVE_TASK`) to prevent absorbing new violations into legacy debt. `baseline --update` is strictly monotonic; additions trigger `E_BASELINE_EXPANSION`. Explicit operator resets require `--policy-reset-authorized`.
13. **Semantic Next-Action Policy Recovery**: `forgeloop next` maps policy findings directly to actionable recovery commands (`RESTORE_POLICY`, `REPAIR_CHECKER`, `REPAIR_POLICY`, `REVERIFY_AFTER_POLICY_CHANGE`, `RESTORE_BASELINE`, `CONTINUE_WITH_EXISTING_BASELINE`, `RESOLVE_INERT_CHECK`) rather than collapsing into generic blockers.
14. **Task Namespacing & Multi-Task Isolation**: Task-aware operations resolve artifacts under `.forgeloop/task-state/<taskKey>/` for the selected task (explicit `--task`, `FORGELOOP_TASK`, or the single active task), so a concurrent task cannot become an implicit source of lifecycle state. With multiple active tasks and no selector, task-aware commands report `E_TASK_AMBIGUOUS` instead of guessing.

## Evidence-driven correction

```text
FAILURE
  ↓
COLLECT COMPLETE OUTPUT
  ↓
IDENTIFY ROOT CAUSE
  ↓
FORM A TESTABLE HYPOTHESIS
  ↓
APPLY THE SMALLEST FIX
  ↓
RUN THE SPECIFIC CHECK
  ↓
RUN REGRESSION CHECKS
```

Avoid random edits and never hide a failure by weakening verification.

If the same hypothesis fails again without new evidence:

1. stop repeating the attempt;
2. review assumptions, logs, and environment boundaries;
3. seek an independent check;
4. change strategy or report the genuine blocker.

An unavailable check does not pass by absence. Use an available equivalent when
it produces compatible evidence; otherwise request installation authority or
record the limitation.

## Precedence

Apply conflicts in this order:

1. platform and host-agent rules;
2. the user's latest explicit request;
3. the closest project, directory, or file instructions;
4. legal, security, and data-preservation requirements;
5. this loop contract;
6. the router decision;
7. specialized guide defaults.

Within technical scope, prioritize:

```text
correctness → no regression → security → product requirement
→ simplicity → measured performance → elegance
```

A guide never authorizes unrelated installation, publication, deletion,
migration, production changes, messages, or information exposure. The
task-scoped Qwen capability policy is the narrow exception for installing the
smallest missing capability when the current task requires it; host approval
controls and the API-credential boundary still apply.

## Stop conditions

### Verified success

- the primary requirement is met;
- applicable checks were run and passed;
- no relevant regression was found;
- the diff was reviewed and remains scoped;
- documentation was updated when necessary;
- residual limitations are declared.

### Genuine external blocker

- a material product decision is missing;
- authority for an external or destructive action is missing;
- an indispensable credential, service, device, or environment is unavailable;
- an essential check has no safe alternative;
- the environment prevents progress after diagnosis and distinct attempts.

Difficulty, slowness, initial uncertainty, or a preference for more context are
not blockers by themselves.

## Final delivery

Use the shortest report that preserves evidence:

```text
STATUS: COMPLETE | PARTIALLY VERIFIED | BLOCKED

Delivered:
- changed files or behavior.

Verified:
- commands, checks, and objective results.

Limitations:
- what was not proven and why.

Publication:
- commit, push, pull request, merge, or deployment state when applicable.
```

Never claim that a test, build, platform, device, or integration passed without
a compatible check. The final response must distinguish local implementation
from external publication.

## Cross-harness execution continuity

A change of model, provider, IDE, process, terminal, or context window does not
create a new task when a valid resumable ForgeLoop task already exists.
`work-state.json` remains the sole owner of lifecycle progress. An optional
`.forgeloop/task-state/<taskKey>/continuity.json` may record bounded granular implementation context
such as current focus, remaining implementation work, known issues, and paths
to inspect first.

`CONTINUITY_CONTEXT_IS_NOT_EVIDENCE`: continuity may guide inspection but can
never satisfy verification coverage, publication, production readiness, or
completion. `CONTINUITY_CANNOT_GRANT_AUTHORITY`: continuity cannot authorize an
installation or external action. <a id="FL-CONT-001"></a> **FL-CONT-001 — A receiving harness MUST reconcile**
continuity against the current work state and checkout before acting on it.

Canonical handoff acceptance is orthogonal to lifecycle phase transitions. The
`HANDOFF_ACCEPTED` event is an exactly-once, ledger-backed operational receipt;
it does not add a lifecycle phase, transfer claims, create evidence, authorize
work, or approve review. A receiving harness runs `handoff-accept` only when it
actually consumes the immutable handoff. Advisory context is also outside the
canonical lifecycle: providers are lazy and opt-in through the Integration API,
and their output cannot determine state, evidence, authority, completion, or
the next action.

## Optional task boundaries and code attestation

ForgeLoop keeps the following extensions optional so existing task artifacts
remain readable without migration. When an extension artifact is present, its
schema and canonical bindings are validated before the artifact affects a
mutation, verification, or trust result.

<a id="FL-WS-001"></a> **FL-WS-001 — A bound task MUST validate the current workspace**
before a task mutation or ForgeLoop-owned verification launch. Workspace
identity is derived from the repository/worktree and is never accepted from
actor input; a mismatch fails closed before a child process starts. A branch
name or HEAD value by itself is insufficient to identify a checkout: the
binding also covers the repository/worktree identity that the protocol derives.
The artifact is optional; when absent, workspace binding is not applicable.
When present, `workspace-status` and `run-check` cross the same boundary.

<a id="FL-HANDOFF-001"></a> **FL-HANDOFF-001 — A canonical handoff MUST remain an immutable**
protocol-derived snapshot. It can carry intent and resume context, but it does
not delegate work, establish identity, grant authority, provide independent
review evidence, or prove completion. An optional actor note or recipient hint
is descriptive metadata only. This envelope is distinct from mutable
`continuity.json`, which is operational resume context and non-evidence.

`handoff-accept` records the receiver's operational consumption only. It does
not make `consumerId`, `harness`, a recipient hint, or a handoff envelope an
authenticated identity, delegation approval, or lifecycle authority.

<a id="FL-SCOPE-001"></a> **FL-SCOPE-001 — A verification scope MUST narrow execution only from**
current canonical changed paths, effective claims, or an explicit full-project
requirement. The resolver never guesses impacted tests, and a stale scope is
not used as verification evidence. The modes are `AUTO`, `CHANGED`, `CLAIMED`,
and `FULL`; there is no heuristic `IMPACTED` mode. `AUTO` may resolve to
`CHANGED` or `CLAIMED` only when a trusted scoped checker is configured,
otherwise it resolves to `FULL`. An explicit `CHANGED` or `CLAIMED` request
without that checker fails closed with `E_VERIFICATION_SCOPE_UNRESOLVED`.
The selected paths, checker capability fingerprint, verification cycle,
contract fingerprint, and repository fingerprint are bound before launch.
`run-check` must match the configured `argvPrefix` plus the selected paths;
drift is rejected before the process starts.

<a id="FL-ATTEST-001"></a> **FL-ATTEST-001 — A code attestation MUST bind exact source content**
to a valid completion receipt and event-ledger checkpoint. Protocol metadata is
excluded from the source subject, verification is read-only, and a plain
fingerprint is not a signature. The binding includes exact bytes, per-entry
SHA-256 content digests, a deterministic in-toto Statement v1, and the
provider-specific revision identity. `PROCESSED` means artifacts exist and can
be parsed; `VERIFIED` means the applicable completion, evidence, manifest, and
content relationships validate; `ATTESTED` additionally requires a valid
external signature under the configured identity and issuer policy. Attestation
does not claim authorship, bug-free code, or absolute security. Verification
scope is a pre-completion execution decision; attestation coverage is a
post-completion revision-range question, and one never proves the other.

### Optional responsibility contracts

An optional responsibility contract mechanically constrains a pass with
allowed/read-only paths, required check IDs, and frozen contract, route, claim,
and repository inputs. It is a boundary artifact, not an agent-role system.
Labels such as `implementation` or `review` are descriptive; ForgeLoop has no
built-in coder, reviewer, or cleaner roles. Completion and audit validate the
constraint when it is present, and a path or frozen-input drift fails closed.

## Durable Actions and Trajectory Evidence

Durable actions extend the existing task protocol; they do not turn ForgeLoop
into an agent runtime, scheduler, queue, or workflow engine. Action intent,
approval, execution provenance, reconciliation, and evaluation are task-local
artifacts whose chronology remains in the same hash-chained `events.ndjson`.

Every side-effecting action declares an explicit capability, effect class,
bounded target, immutable idempotency key, and provenance. Project capability
policy is a decision input (`ALLOW`, `DENY`, `REQUIRE_AUTHORITY`, or
`REQUIRE_APPROVAL`); it is never host authority. `HOST_ATTESTED` authority can
only cross the existing host trust boundary, and `run-action` accepts exact
argv with no shell mode.

### Durable action trust boundaries (hardened)

The following invariants are enforced in core code and are regression-tested:

- **Authorization is canonical.** No caller-controlled surface (`action-record`,
  CLI flags, MCP tool arguments, project files, environment) can mint
  `AUTHORIZED`. Only the core authorization service may transition
  `PROPOSED -> AUTHORIZED` — through `run-action`, or explicitly through
  `forgeloop action-authorize`, which is a pure adapter over the same service —
  and only after the current capability policy, the persisted policy lock, and
  the task policy snapshot agree. Every modern
  `ACTION_AUTHORIZED` event binds the capability decision, capability-policy
  fingerprint, policy-lock digest, task-policy digest, and — for
  `REQUIRE_AUTHORITY`/`REQUIRE_APPROVAL` — the exact host authority or
  fingerprint-bound approval. Post-authorization mutation of a bound approval
  artifact is readiness/audit-visible.
- **Verification is canonical, independent, and requirement-bound.**
  `COMMITTED != VERIFIED`. A command exiting 0 proves only local completion.
  `VERIFIED` is produced exclusively by `forgeloop action-verify` (or the
  equivalent core service) against a passed ForgeLoop execution artifact that
  is independent of the action's own commit execution and whose immutable
  `requirement` exactly equals the action's requirement. New required actions
  must declare a non-empty requirement at proposal time; historical required
  artifacts without one remain readable but can never become trusted-satisfied.
- **Reconciliation has exactly one replay truth.** A trusted `COMMITTED`
  settlement emits `ACTION_RECONCILED(outcome=COMMITTED)` (the transition) plus
  a same-revision informational mirror `ACTION_COMMIT_RECORDED(reconciled=true)`
  (corroboration only). Ledger replay applies the transition exactly once and
  validates mirror identity; forged or orphaned mirrors invalidate the ledger.
- **Completion consumes readiness.** Required-action completion truth comes
  from the canonical action-readiness projection, never from raw state labels.
  A forged or legacy `VERIFIED` label without trusted authorization and
  canonical verification evidence yields `UNTRUSTED` and blocks completion.
- **Settling ambiguity requires trust.** Recording an `UNKNOWN`
  reconciliation observation is always safe. Settling `COMMIT_UNKNOWN` as
  `COMMITTED` or `NOT_COMMITTED` requires a trusted out-of-band host authority
  context plus bounded evidence references bound to the event. Trusted
  `NOT_COMMITTED` returns the action to `PROPOSED`, so any retry re-evaluates
  policy, approval, authority, and the task policy snapshot; stale
  authorization can never be reused.
- **STARTED marks the launch boundary.** Deterministic pre-launch checks
  (argv normalization, command resolution, installation authority, policy
  identity, approvals) all run before `ACTION_STARTED`; post-start outcomes
  remain conservative: spawn failure without launch is `FAILED`; anything
  unproven is `COMMIT_UNKNOWN`.
- **Capability policy participates in policy identity.** When
  `.forgeloop/policy/capabilities.json` exists, its digest participates in the
  policy lock, the active task policy snapshot, and authorization evidence.
  Drift blocks before any side effect (`E_ACTION_POLICY_DRIFT`).
- **Host context is out-of-band.** Trusted authority travels as an execution
  context object supplied by an embedding host (`executeForgeLoopCommand` /
  `createForgeLoopMcpServer({ authorityContextProvider })`). CLI flags such as
  `--authority HOST_ATTESTED` are requested kinds, never proof. MCP launch
  flags expose transport surfaces only; tool arguments can never carry
  `authorityContext`.
- **Guidance never lies about authority.** `forgeloop next` returns a
  structured `authorityRequired` requirement for host-bound approvals instead
  of recommending a command that cannot satisfy the blocker.

Trajectory metrics and reference evaluations are read-only projections over the
canonical trace, reflection, actions, and events. Missing tokens, costs,
provider, model, or optimal-path data remain `null`/`UNKNOWN`; a comparative
efficiency ratio exists only when a project-local reference scenario supplies
`reference.comparableSteps`. Existing information-gain, intervention, failure
signature, and oscillation diagnostics remain canonical.

## Multi-task concurrent project state

ForgeLoop supports isolated, concurrent tasks within the same repository workspace.
Multiple active tasks can progress simultaneously without artifact collisions or state
corruption through three fundamental protocol mechanisms:

1. **Deterministic Task Namespacing**:
   Each task is identified by a canonical string `taskId` and an immutable, filesystem-safe
   `taskKey` derived as `SHA-256(taskId)` in 64 lowercase hexadecimal characters. All
   task-scoped artifacts (`task.json`, `contract.json`, `routing-result.json`,
   `preflight.json`, `work-state.json`, `events.ndjson`, `execution-receipt.json`,
   `continuity.json`, `recovery.json`, gates, and execution records) are stored strictly under
   `.forgeloop/task-state/<taskKey>/`. Shared repository configuration and sources
   (`config.json`, `sources.json`) remain at `.forgeloop/`.

2. **Scoped Write Claims & Conflict Prevention**:
   Every task declares explicit project-relative directory or file path prefixes
   (`writeClaims`) in its `task.json` descriptor.
   - When creating a task (`forgeloop task-create --task <id> --claim <path>`),
     ForgeLoop asserts that claimed paths have no pre-existing uncommitted changes
     (`E_TASK_SCOPE_DIRTY`) and do not overlap with active write claims of any other
     non-`COMPLETE` task (`E_TASK_SCOPE_CONFLICT`).
   - Once execution begins (`EXECUTING` through `COMPLETE`), write claims are immutable
     (`E_TASK_SCOPE_FROZEN`).
   - At verification and completion, Git modifications are validated to ensure no changes
     escaped the task's declared scope (`E_TASK_CHANGE_OUTSIDE_SCOPE`).
   - `task.json` retains historical claims. Effective claims are empty only after
     validator-backed `COMPLETE` or when the canonical claim-state resolver
     validates `recovery.json` against the descriptor, work state, and complete
     hash-chained recovery history. A tombstone alone never releases claims.
   - Fake, missing, corrupt, deleted, or mismatched recovery evidence is
     `INCONSISTENT`: every provable historical claim remains reserved,
     `mutationAllowed=false`, and overlapping claim acquisition fails with
     `E_TASK_CLAIM_OWNERSHIP_INCONSISTENT`.
   - Recovery is not completion. `task-recover` accepts only deterministic
     `STALE` or `ABANDONED` classifications, preserves work state, receipts,
     failures, policy, continuity, and repository fingerprints, and suspends
     ordinary task mutation with `E_TASK_RECOVERED`.
   - Only `forgeloop task-resume --task <id>` may remove recovery state. It
     first validates recovery ownership and lifecycle revision, safely settles
     only an unchanged stale task lease, then reacquires the released (or
     explicitly supplied) claims through the normal overlap and clean-checkout
     checks under the project claims lock. A claim held by another task remains
     unavailable. `TASK_RECOVERY_RESUMED` is meaningful activity.

3. **Per-Task Exclusive Mutex Locking**:
   Mutating lifecycle commands (`advance`, `preflight`, `run-check`, `complete`, etc.)
   acquire an exclusive filesystem lock at `.forgeloop/locks/<taskKey>.lock` using
   atomic creation flags (`wx`). Concurrent mutations on the same task reject with
   `E_TASK_LOCKED`. Read-only commands (`status`, `audit`, `inspect`, `continuity`) bypass
   locking. Lock inspection distinguishes `NONE`, `LIVE`, `STALE`, `UNKNOWN`,
   and `CORRUPT`; unknown or corrupt ownership fails closed. Stale-only release
   compares the observed lock ID, heartbeat, and owner instance before deletion.

   Recovery that changes claim ownership acquires the project claims lock before
   the task lock, safely settles an unchanged stale lease, then revalidates phase,
   work-state revision, ledger sequence, and the `STALE`/`ABANDONED` allowlist
   before committing `recovery.json` and its append-only event in one transaction.
   The project claims lock itself uses the same `NONE`/`LIVE`/`STALE`/`UNKNOWN`/
   `CORRUPT` lease classification and CAS-safe quarantine/restore semantics;
   unknown, corrupt, or concurrently replaced ownership fails with
   `E_PROJECT_CLAIMS_LOCK_INCONSISTENT`.
   The standalone acknowledgement flag does not grant host authority:

   ```text
   --acknowledge-recovery
   ≠
   HOST_ATTESTED
   ```

   `forgeloop next --task <id> --json` maps conflict evidence to structured
   `RECONCILE_CLOSURE`, `RECOVER_TASK`, `RESUME_RECOVERED_TASK`, or
   `RESOLVE_RECOVERY_INCONSISTENCY` guidance. A `RECOVERABLE` task must use its
   canonical reconciliation path and cannot release claims through `task-recover`.

4. **Task Resolution & Legacy Migration**:
   Commands select their target task via `--task <id>`, the `FORGELOOP_TASK` environment
   variable, or implicit single-task fallback. Only mutation-active tasks are
   implicit candidates; recovered, inconsistent, and `COMPLETE` tasks remain
   explicitly addressable but do not make unrelated work ambiguous. If multiple
   mutation-active tasks exist without a selector, ForgeLoop fails closed with
   `E_TASK_AMBIGUOUS`. Legacy ForgeLoop 1.0 single-task
   layouts can be migrated into namespaced layout using `forgeloop task-migrate`.

A project containing active task recovery state requires ForgeLoop 1.4.0 or
newer.
<a id="FL-CLAIM-002"></a> **FL-CLAIM-002 — Harnesses that cannot validate task-recovery schema v1 and its linked ledger history MUST refuse**
ownership mutation rather than fall back to descriptor-only claims.

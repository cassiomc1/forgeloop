# Universal Engineering Loop — System Design

**Status:** Implemented; repository checks validate the system contract.

## Objective

Turn this collection into a portable instruction kit for future projects. After the kit is copied into a repository, requests handled by a compatible agent enter a cycle of discovery, guide selection, execution, verification, and correction.

The system should use every guide that materially helps the task without loading irrelevant documents or replacing project-specific instructions with generic defaults.

## Primary decisions

- The protocol is vendor-neutral, project-scoped, and capability-based,
  supporting any AI agent, coding assistant, IDE runtime, or developer workflow.
- Common discovery surfaces (e.g. `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/`,
  `.github/copilot-instructions.md`) use project-local shims delegating to the
  canonical protocol under `.forgeloop/kit/`, while other environments use the
  shared `AGENTS.md` entry point or manual bootstrap.
- The portable instruction layer uses Markdown and each environment's native instruction mechanism; the optional local Node CLI validates and installs the kit without an agent runtime or third-party dependency.
- English is the only language used by repository content and guide metadata.
- The agent uses all applicable guides, not every file indiscriminately.
- Design, planning, test-first, and review process gates live in the canonical loop and scale with task risk instead of becoming unconditional boilerplate in every adapter or architecture note.
- The persistent project profile stores only verifiable facts and never secrets, tokens, or credentials.
- The loop continues while safe progress is possible. Repetition without new evidence triggers hypothesis reassessment or a blocked result, not infinite retries.
- Third-party provenance and reuse boundaries remain part of every portable copy.
- Qwen-MM-Plugins is an optional, task-scoped capability extension: the agent checks native support first, installs the smallest missing capability when needed, and verifies it before use; it is not a package or runtime dependency.
- Canonical documents are installed under `.forgeloop/kit/`; root native adapters remain small discovery shims; project-scoped configuration remains under `.forgeloop/`; and modern mutable task protocol state is isolated under `.forgeloop/task-state/<taskKey>/`.
- `PREFLIGHT_READY` is a resumable protocol checkpoint reconciled with work state, activation events, fingerprints, and the append-only hash chain.

## Alternatives considered

### One large file

Combining the loop, routing rules, and technical content would simplify copying but increase context use, duplicate guide material, and make maintenance harder. This option was rejected.

### Thin adapters with canonical modules

Small entry points for each agent, one central loop, one router, and specialized guides preserve modularity and allow the agent to load only relevant context. This is the selected architecture.

### Generated configuration

A tool could detect the stack and generate instructions automatically, but that would add installation, compatibility, and maintenance costs before the need is proven. It may become a later enhancement but is outside the first version.

## Architecture

The ForgeLoop system is organized around three observable control surfaces:
deterministic routing, checkpointed state, and evidence that can be inspected by
the compatible harness.

```text
                            FORGELOOP
                                │
                   ┌──────────────┼──────────────┐
                   │              │              │
                CONTRACT        ROUTE         EVIDENCE
                   │              │              │
                   └──────┬───────┴──────┬───────┘
                          │              │
                       required       current
                        gates         fingerprints
                          │              │
                          ▼              │
                      PREFLIGHT_READY   │
                          │              │
                   ┌──────┴──────┐       │
                   │             │       │
                work-state   event ledger │
                   │             │       │
                   └──────┬──────┘       │
                          │              │
                  plan → execute → verify → review
                          │              │
                          └──────┬───────┘
                                 ▼
                   AUDIT / COMPLETE / VALIDATE-PROTOCOL
                                 │
                                 ▼
              VALID / INCOMPLETE / STALE / INCONSISTENT / INVALID
                                 │
                                 ▼
                         compatible harness
```

```text
User request
    |
    v
Nearest agent adapter
    |
    +--> root native shim
             |
             +--> .forgeloop/kit/LOOP_ENGINEERING.md
             |        |
             |        +--> .forgeloop/kit/PROJECT_PROFILE.md
             |        +--> .forgeloop/kit/GUIDE_ROUTER.md
             |                  |
             |                  +--> .forgeloop/kit/ENG/*.md
    |
    +--> repository-specific instructions
    |
    v
Discovery -> contract -> route
                              |
                              v
          proportional design -> plan -> change -> targeted check -> regression -> review
                              ^                                                   |
                              +--------------- diagnosis and correction ----------+
    |
    v
Final result with evidence and limitations
```

The canonical loop keeps proportional design, planning, implementation,
testing, and review visible between routing and delivery. Architecture names
the order of those stages without duplicating the detailed operating rules that
belong in `LOOP_ENGINEERING.md`.

## Components and responsibilities

### `AGENTS.md`

Primary entry point for Codex and agents that recognize repository instructions. It stays short and requires the loop, profile, and router to be read before execution.

### `CLAUDE.md`

Adapter for Claude Code. It points to the same canonical source and does not repeat loop rules.

### `.github/copilot-instructions.md`

GitHub Copilot adapter. It activates the same operational contract while preserving more specific instructions in the destination project.

### `.cursor/rules/project-loop.mdc`

Always-applicable Cursor adapter. It delegates decisions to the loop and router.

### `PROTOCOL_INTEGRATION.md`

Human-readable integration protocol and capability levels. It explains native entry
points, discovery surfaces, required and optional capabilities, degradation,
and the deterministic verification boundary.

### `LOOP_ENGINEERING.md`

Canonical operational cycle. It defines:

- discovery of repository state and nearby instructions;
- capability discovery and task-scoped Qwen-MM-Plugins installation;
- conversion of the request into an execution contract;
- risk assessment and authority boundaries;
- guide selection;
- proportional design, planning, test-first, and review gates for behavior,
  architecture, and instruction changes;
- small coherent changes;
- delivery-specific verification;
- evidence-driven diagnosis and root-cause correction;
- final regression checks;
- success and stop conditions;
- handling of destructive actions and external authority.

The loop is also the only place that defines harness-conditional behavior such
as native isolation, independent review, and capability fallback rules. The
system design references those boundaries but does not restate their detailed
criteria.

### Capability extensions

The capability protocol is a narrow extension of the canonical loop. It asks
the agent to inspect native model and harness support, reuse an existing
callable tool, install only the smallest missing Qwen-MM-Plugins capability
when the task requires it, check API and system prerequisites, verify
registration, and then use the tool. Keyless multimodal reading is the default;
API-backed operations remain disabled until their documented credentials or
service endpoints are configured. The kit links to the upstream project but
does not bundle its source, MCP server, model, or dependencies.

### Repository Index

The Repository Index is a mandatory, provider-neutral discovery boundary for
Git repositories. The CLI, Integration API, and MCP adapter share one search
service backed initially by a ForgeLoop-managed, pinned Microsoft `tgrep`
1.0.3 executable. The executable is verified before use; the project index
under `.forgeloop/repository-index/tgrep/` and `engine-state.json` are derived
cache/state outside the task ledger. Index health can block operational
readiness, but index contents never become evidence, completion authority,
task ownership, or historical truth. A host uses `forgeloop search` rather
than assuming `grep`, `rg`, or `tgrep` is present on PATH.

### `GUIDE_ROUTER.md`

Canonical map between request or project signals and applicable guides. Each route records:

- activation signals;
- exclusions;
- normal guide combinations;
- useful search targets;
- expected verification evidence.

### `PROJECT_PROFILE.md`

Durable context for a destination project. The template captures:

- confirmed stack and versions;
- package manager and official commands;
- architecture and relevant directories;
- external services and risk surfaces;
- test, lint, build, and release commands;
- documentation and UI conventions;
- constraints, decisions, and unverified items;
- a source for every durable fact.

The profile changes only when discovery reveals a real project change; it is not a task diary. In this source repository, `profile-mode: template` keeps it as a reusable template. After `forgeloop init` installs it under `.forgeloop/kit/` in a target, the first cycle may change the mode to `project` and fill only confirmed facts.

### `DELEGATION_PROTOCOL.md`

The delegation document defines serializable task briefs, write ownership,
dependencies, normalized results, reviewer independence, and inline fallback.
It does not add agent personas, a scheduler, or a provider runtime.

### `ORCHESTRATOR_INTEGRATION.md`

The integration contract is the graph-readiness boundary. It names the
serializable phases, transitions, invariants, artifact schemas, host
responsibilities, and inline fallback in one canonical document. It does not
implement a graph runtime or duplicate the detailed operational rules in
`LOOP_ENGINEERING.md`.

### `THREAT_MODEL.md`

The threat model records path, symlink, artifact, secret, stale-state,
publication, schema, dependency, and resource-limit boundaries with their
mitigations, residual limitations, and executable evidence.

Persistent task mutations use a task lease lock and a recoverable transaction
journal. State writes carry a monotonically increasing revision, while event
appends are serialized and hash chained. The ledger keeps a validated tail
checkpoint (`seq` and last hash), so a normal append stages and publishes only
its new NDJSON suffix; a mismatched tail forces a full checkpoint rebuild. A
crash during a multi-file publish leaves a journal that `doctor --fix` can roll
back deterministically — including truncating an interrupted ledger suffix to
its recorded pre-append size. It never permits a partial artifact set to be
presented as a completed protocol state.

### `ENG/*.md`

Eleven canonical guides cover:

- clean code;
- testing;
- security;
- performance;
- design;
- accessibility;
- premium website production;
- web games;
- contextual frontend taste;
- technical documentation quality;
- Flutter application engineering.

Each guide has exact English frontmatter and a stable guide ID.

### `THIRD_PARTY_NOTICES.md`

Records external provenance, trademarks, licenses, and reuse boundaries. It is required in the repository and in every portable copy.

## Initial routing matrix

| Work type | Guide set |
| --- | --- |
| Documentation | Related domain and documentation checks |
| Flutter application | `flutter` with `clean` and `test`; add surface-specific guides as needed |
| General code or bug fix | `clean`, `test`; add `security` or `performance` when the surface requires it |
| Backend, API, authentication, or data | `clean`, `test`, `security`; add `performance` for critical paths |
| Web, mobile, or desktop interface | `clean`, `test`, `design`, `accessibility`; add `security` and `performance` according to product risk |
| Complete site or landing page | `premium`, `design`, `accessibility`, `clean`, `test`, `security`, `performance` |
| Web game | `games`, `clean`, `test`, `security`, `performance`, `accessibility`; add `design` for UI or visual direction |
| HTML video or motion | `design`, `accessibility`, `performance`, `test`, `security`; use HyperFrames only when requested or already available |
| Infrastructure or CI/CD | `security`, `test`; add `performance` when availability or cost changes |

Routing uses the request and files actually affected. A single word in the repository is not enough to activate a stack or guide.

## Execution flow

1. Read the agent adapter and the nearest instructions for the scoped directory.
2. Inspect manifests, configuration, documentation, tests, CI, and Git state.
3. Confirm or update the project profile with sourced facts.
4. Convert the request into an objective, deliverables, constraints, risks, checks, and a stop condition.
5. Select the guide set in the router.
6. Read only the required sections of each guide.
7. Apply proportional design and plan gates before behavior, architecture, or instruction changes.
8. Establish a baseline and reproduce the problem when applicable.
9. Make the smallest coherent change that satisfies the objective.
10. Run the targeted check first, then proportional regression checks.
11. Use the loop's review gate after regression when the task or harness calls for self-review or independent review.
12. On failure, collect evidence, identify the root cause, and repeat with a targeted correction.
13. Finish only with current evidence, explicit limitations, and no unrelated changes.

## Canonical workflow state model

The protocol represents the engineering loop with serializable conceptual
states rather than an executable graph:

```text
RECEIVED → DISCOVERING → CONTRACT_READY → ROUTED
                                      ├→ DESIGNING → PLANNED
                                      └→ PLANNED
PLANNED → EXECUTING → VERIFYING
VERIFYING ├→ DIAGNOSING → CORRECTING → VERIFYING
          └→ REVIEWING → COMPLETE
                         └→ VERIFYING when completion is rejected only for evidence
Any non-terminal state → BLOCKED when a genuine blocker is evidenced
```

| From | Condition | To |
| --- | --- | --- |
| `RECEIVED` | context is required | `DISCOVERING` |
| `DISCOVERING` | sufficient sourced context | `CONTRACT_READY` |
| `CONTRACT_READY` | route is resolved | `ROUTED` |
| `ROUTED` | design decision is required | `DESIGNING` |
| `ROUTED` | no design gate is required | `PLANNED` |
| `DESIGNING` | design is approved | `PLANNED` |
| `PLANNED` | task work begins | `EXECUTING` |
| `EXECUTING` | targeted check is ready | `VERIFYING` |
| `VERIFYING` | a check fails | `DIAGNOSING` |
| `DIAGNOSING` | a fix hypothesis exists | `CORRECTING` |
| `CORRECTING` | the fix is applied | `VERIFYING` |
| `VERIFYING` | checks pass | `REVIEWING` |
| `REVIEWING` | completion is rejected only for evidence | `VERIFYING` |
| `REVIEWING` | contract and quality are accepted | `COMPLETE` |
| any non-terminal state | a genuine external blocker is evidenced | `BLOCKED` |

State invariants are machine-validatable: `COMPLETE` requires verification
evidence, `BLOCKED` requires a blocker category, `CORRECTING` requires a
diagnosed hypothesis, an evidence-only `REVIEWING → VERIFYING` transition
requires a persisted rejection and starts a new verification cycle, and
`REVIEWING` cannot claim independent review from the
same identity as the implementer. Simple documentation tasks may skip design,
delegation, and full regression when the contract records why those states are
not applicable.

## Optional boundaries and provenance chain

The current integration view keeps optional safety and provenance boundaries
visible without turning them into a second state machine:

```text
Intent
  ↓
Contract
  ↓
Route
  ↓
Task + claim ownership
  ↓
Optional workspace binding
  ↓
Execution
  ↓
Optional responsibility constraint
  ↓
Verification planning
  ↓
Observed command evidence
  ↓
Review
  ↓
Transactional completion
  ↓
Optional code manifest / attestation
  ↓
Optional signing
  ↓
Read-only verification / range coverage
```

Each boundary has a distinct trust meaning. Repository and checkout state
identify the implementation being inspected; task state owns lifecycle and
claims; execution artifacts prove process provenance; the completion receipt
summarizes validated evidence; the code manifest binds exact source bytes; the
in-toto statement binds that manifest to completion; a signature is an
external signer result; and a revision-range result evaluates coverage across
multiple task attestations. A workspace binding is optional and a branch name
or HEAD alone is not a complete checkout identity. A handoff is an immutable
state snapshot, while mutable continuity is operational context; neither is
independent review evidence. Verification scope decides which paths a specific
checker may execute, whereas attestation coverage asks whether changed paths
in a revision range are covered. These relationships are intentionally not
interchangeable.

The [Verification Trust Flow](./docs/REVISION_PROVIDERS.md#differential-verification-scope)
(`docs/diagrams/forgeloop-verification-trust-flow.workflow.json`) and [Code
Attestation Chain](./docs/CODE_ATTESTATION.md#completion-flow) diagrams provide
the focused visual fallbacks for these two boundaries.

## Precedence and conflicts

The system respects this order:

1. platform and safety rules;
2. the user's latest explicit request;
3. more specific and nearer repository or directory instructions;
4. applicable legal, security, and data-preservation requirements;
5. confirmed project profile facts;
6. router decisions;
7. general guide recommendations.

A guide never authorizes installation, publication, deletion, migration, or an external change that the user did not place in scope.

## Failures and stop conditions

- **Missing tool:** use an available equivalent only when it provides compatible evidence; otherwise request approval or report the check as not run.
- **Missing guide or broken link:** continue only with conservative defaults and disclose the limitation.
- **Missing credential:** report the blocked capability without exposing or inventing a credential.
- **Executable policy failure:** present but malformed policy artifacts fail closed and block preflight and completion; policy weakening relative to the task snapshot blocks completion. Canonical invariants and recovery actions are defined in [`LOOP_ENGINEERING.md`](./LOOP_ENGINEERING.md#executable-policy--autonomy-preserving-invariants), with integration obligations in [`PROTOCOL_INTEGRATION.md`](./PROTOCOL_INTEGRATION.md).
- **Conflicting instructions:** apply precedence, choose the most conservative interpretation, and record any material decision.
- **Repeated failure without new evidence:** stop repeating the same action, reassess the hypothesis, and use another diagnostic method.
- **External or destructive action:** proceed only with explicit authority and an exact validated target.

## Validation of the instruction system

The documentation workflow verifies:

- every file referenced by an adapter exists;
- repository-relative links resolve;
- exactly eleven canonical English guides exist;
- guide IDs, filenames, frontmatter keys, and `language: en` match the catalog;
- no legacy language tree or bilingual metadata remains;
- all route contracts contain valid guide IDs;
- the canonical phase list, transition rows, state invariants, reason-code
  language, graph-readiness evidence, and no-runtime boundary are present;
- Markdown and frontmatter are valid;
- secrets and credential-like assignments are absent;
- `THIRD_PARTY_NOTICES.md` is present.

The validator also exercises seven routing scenarios:

1. premium landing page;
2. authenticated API;
3. bug fix without UI;
4. mobile app with UI;
5. multiplayer web game;
6. documentation-only change;
7. Flutter application feature with a primary SDK dependency signal.

## Distribution

The npm CLI installs the kit into the current directory or an existing
directory selected with `--path` when the package is available in the npm
registry. If it is not available yet, the same commands can run as
`node src/cli.js ...` from a repository checkout. The CLI maps canonical
documents into `.forgeloop/kit/`, keeps only native instruction shims at the
target root, and leaves project-scoped configuration under `.forgeloop/` while
isolating modern mutable task protocol state (contract, route, gate, state,
event, preflight, receipt, and recovery artifacts) under
`.forgeloop/task-state/<taskKey>/`. Legacy singleton artifacts remain under
`.forgeloop/` for compatibility and migration only. Manual copying must
preserve that target layout; copying package-source root files directly is not
equivalent to `forgeloop init`.

Recovery uses a relational state model: `work-state.json` owns the lifecycle
phase, `task.json` retains historical claims, `recovery.json` records current
suspension, and the complete hash-chained ledger proves recovery/resume cycles.
Only their canonical validated projection can release effective claims. The
same holds for completion: `RELEASED_BY_COMPLETION` requires the canonical
completion ownership proof (COMPLETE phase plus a validated ledger containing
the task-bound `COMPLETION_VALIDATED` event with coherent state and no
contradicting later lifecycle event); a manually forged COMPLETE state is
`INCONSISTENT`, retains historical claims, and disables mutation. Any
missing, corrupt, forged, or mismatched relationship is `INCONSISTENT`, retains
historical claims, and disables mutation. Recovery never fabricates completion;
`task-resume` is the only path that rechecks and reacquires ownership before
removing the recovery artifact. Project claim serialization always precedes
the per-task lock for create, scope, recover, and resume operations, and both
lock classes use lease classification plus CAS-safe stale settlement. Task
locks additionally require complete owner identity (`taskId`, `lockId`,
`ownerInstanceId`, `operation`, heartbeat, positive lease): incomplete identity
classifies `UNKNOWN` and is never eligible for stale release. Implicit task
selection distinguishes read-only discoverability (`READ`: any single healthy
task) from mutation authority (`MUTATION`: only operationally active tasks).

The README explains the file set, activation behavior, current/relative/absolute
target installation, first-run profile flow, local validation commands, and safe
update practice.

## Advisory and handoff trust boundaries

Optional advisory context remains outside canonical lifecycle state and evidence:

```text
External advisory provider
        |
        v
bounded recall input
        |
        v
allowlist normalization
        |
        v
ADVISORY / NON_EVIDENCE / NON_EXECUTABLE
```

Handoff acceptance is a separate operational receipt over an immutable snapshot:

```text
canonical state + current repository
        |
        v
immutable handoff
        |
        v
HANDOFF_ACCEPTED ledger receipt
```

Neither boundary transfers claims or creates evidence or authority. Advisory
providers are lazy and opt-in through the Integration API; handoff acceptance
is orthogonal to lifecycle phases and does not authorize the receiving harness.

## Out of scope

- remote prompt services or databases;
- mandatory orchestration frameworks;
- infinite or unattended execution beyond agent limits;
- automatic installation of unrelated tools or provider runtimes; task-scoped
  Qwen-MM-Plugins capability installation remains governed by the canonical
  capability protocol and host approval controls;
- automatic modification of global computer files;
- duplication of complete guides inside adapters;
- versioned logs for every request.

## Acceptance criteria

- The repository and its maintained content are English-only.
- Common project instruction surfaces and generic bootstrap mechanisms have a
  documented entry into one canonical loop.
- The router selects every relevant guide and excludes irrelevant guides in the seven defined scenarios.
- The profile contains verifiable facts, sources, and real commands without secrets.
- The loop requires evidence before completion claims and exits safely when blocked.
- Structural, Markdown, link, and secret checks pass locally and in CI.
- Portable-copy instructions always include third-party notices.
- The package does not alter destination commands, dependencies, or behavior without need and applicable authority.

## Cross-harness continuity boundary

Execution continuity is intentionally a companion artifact, not a second state
machine and not a general memory subsystem. Work state owns lifecycle truth;
the checkout owns implementation truth; checks/executions own verification
truth; completion owns certification. Continuity only narrows what a receiving
executor should inspect and continue.

## Durable action and trajectory boundary

Durable actions are protocol-owned task artifacts (`actions/`, `approvals/`,
and `evaluations/`) projected through the existing hash-chained event ledger.
They record intent, capability policy, approval binding, execution provenance,
commit uncertainty, reconciliation, and verification without introducing a
workflow runtime, scheduler, queue, or second ledger.

The external side-effect boundary is deliberately conservative: exact argv is
launched only through `run-action` with no shell mode; project capability
policy cannot manufacture `HOST_ATTESTED` authority, and trusted host context
travels out-of-band only (never inside command input, CLI flags, or tool
arguments). Authorization and verification are canonical core services:
callers cannot mint `AUTHORIZED` or `VERIFIED`, verification requires an
independent passed ForgeLoop execution artifact, and required completion
consumes the canonical action-readiness projection rather than raw state
labels. Capability policy participates in policy identity: its digest is bound
into the policy lock, the task policy snapshot, and authorization evidence, so
drift blocks before any side effect. A started action whose external result is
uncertain becomes `COMMIT_UNKNOWN`, which forbids retry until explicit
reconciliation; settling ambiguity as `COMMITTED`/`NOT_COMMITTED` requires
trusted host attestation plus evidence, and a trusted `NOT_COMMITTED` returns
the action to `PROPOSED` so stale authorization can never be reused. This
reduces duplicate-effect risk but cannot provide a universal exactly-once
guarantee for arbitrary external systems.

Metrics and trajectory evaluation are deterministic read-only projections of
canonical trace/reflection evidence. They preserve unknown usage values and
only compare efficiency when a project-local reference scenario exists. The
existing diagnostic and reflection model remains the authority for information
gain, intervention effectiveness, failure signatures, and oscillation.

## Transaction identity and diagnostic retention

The transaction context binds the physical project root and task ID. Nested
operations reject cross-project reuse, even when task IDs match. Filesystem
aliases of the same physical project remain compatible. Reads and writes of
transaction-aware artifacts enforce the same project boundary.

Committed transactions, successful rollbacks, and failures aborted before
publication are terminal. `doctor --fix` recovers eligible committing
transactions under their task locks, then recomputes incomplete findings.
This does not imply that an ambiguous external action was reconciled.

Repository maintenance can preview or compact old terminal stage/backup
payloads with `npm run transactions:compact`. Manifests and event ledgers
remain intact; recent, ambiguous, invalid, locked, and unsafe records are
preserved. See [maintenance usage](CONTRIBUTING.md#focused-verification-and-maintenance).

Lifecycle selection keeps common identity, freshness, gates, and chronology
checks ahead of phase-specific resolvers. Planning, verification, review,
recovery, and pending-action modules organize decisions without changing that
precedence. Executable protocol examples under `tests/helpers` are test
fixtures, not runtime policy authorities.

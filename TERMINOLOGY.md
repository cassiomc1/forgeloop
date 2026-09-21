# ForgeLoop terminology

| Term | Meaning |
| --- | --- |
| Adapter | A thin native instruction entry file that points an agent to the canonical protocol. |
| Guide | A focused technical Markdown document selected for a task surface or risk. |
| Route | The deterministic guide set produced after an agent declares routing signals. |
| Contract | The observable objective, deliverables, constraints, risks, verification, authority, and stop condition for a task. |
| Checkpoint | A validated local snapshot of compatible work state stored under `.forgeloop`. |
| Receipt | A structured, secret-free summary of changes, checks, review, limitations, and publication state. |
| Review | A specification and implementation quality check performed after verification. |
| Independent review | A review performed by an identity different from the implementer and explicitly marked independent. |
| Blocker | A genuine condition that prevents safe progress and has a category and evidence. |
| Capability | A model, harness, tool, or system feature required by a scoped operation. |
| Authority | The explicit permission and target boundary for a destructive or external action. |
| Publication | Push, pull request, merge, release, or deployment; none is implied by local success. |
| Portable protocol | A serializable, framework-neutral contract that compatible agents can execute in their own harness. |
| Runtime | A process that owns execution, scheduling, model calls, or persistence; `ForgeLoop` intentionally does not provide one. |
| Evidence kind | One of `OBSERVED`, `INFERRED`, `NOT_VERIFIED`, or `BLOCKED`; evidence never upgrades an unverified claim by itself. |
| Required artifact | A checkpoint-recorded relative path and SHA-256 hash that must still match before resume. |
| Integration API | The stable programmatic surface (`@cassiomc1/forgeloop/integration`) used by structured consumers instead of parsing CLI output. |
| MCP adapter | The local-first Model Context Protocol server package; an adapter over canonical ForgeLoop commands, never a second implementation. |
| Server mode | The MCP launch policy tier (`readonly`, `safe`, `full`) that determines which tool classes are available. |
| Launch capability | A process-scoped, immutable MCP flag (`--allow-*`) required by higher-risk invocation classes; tool input cannot grant it. |
| Claim state | Canonical ownership classification (`ACTIVE`, `RELEASED_BY_COMPLETION`, `RELEASED_BY_RECOVERY`, `INCONSISTENT`) produced only by the validated claim resolver. |
| Historical write claims | Claims recorded as evidence in the task descriptor/recovery history after validated release. |
| Effective write claims | The claims currently enforced against overlapping acquisition; empty only for validated completion or recovery. |
| Completion ownership proof | The validated lifecycle/ledger evidence (canonical `COMPLETION_VALIDATED` + coherence) required before COMPLETE releases claims. |
| Caller acknowledgement | Explicit current-caller authorization for recovery actions; never equivalent to host attestation. |
| Legacy recovery migration | The narrow append-only repair that materializes one recognized historical recovery boundary into the modern durable representation. |
| Conformance | Relationship validation across route, state, receipt, task brief, and delegated-result artifacts. |
| Universal applicability | ForgeLoop applies whenever an execution environment discovers a project adapter, regardless of model, provider, agent, IDE, or tool name. |
| Integration level | The capability tier of an execution environment (`INSTRUCTION_DISCOVERED`, `PROTOCOL_CAPABLE`, `PROTOCOL_LIMITED`, `CONFORMANCE_VERIFIED`). |
| Recovered task | A non-terminal task whose ordinary mutation authority is suspended and whose effective write claims are released by durable `recovery.json` state. |
| Recovery acknowledgement | A caller declaration that it intends to recover a task classified `STALE` or `ABANDONED`; it is not a host-attested authority grant. |
| Active-task abandonment | An explicit caller-acknowledged `task-abandon` operation that releases validated claims for a non-terminal active task without changing its phase or asserting completion. |
| Abandonment event | The append-only `TASK_ABANDONED` recovery boundary and its transaction witness; it is distinct from automatic stale-task recovery and from completion. |
| Historical claims | The write claims retained in `task.json` as task history, including while recovery releases their active ownership. |
| Effective claims | The claims currently enforced for ownership conflicts: descriptor claims for an active task, or an empty set after validator-backed completion or active recovery. |
| Claim reacquisition | The serialized `task-resume` operation that rechecks conflicts and checkout cleanliness before removing recovery state and restoring mutation authority. |
| Workspace binding | An optional protocol-derived repository/worktree identity boundary that blocks mutation or `run-check` when the current checkout differs. |
| Handoff envelope | An immutable protocol-derived task snapshot; it is not delegation, authority, independent review evidence, or completion evidence. |
| Responsibility contract | An optional mechanical boundary for allowed/read-only paths, required checks, and frozen inputs; labels are descriptive rather than roles. |
| Verification scope | The pre-completion set of paths a specific checker may execute, resolved as `AUTO`, `CHANGED`, `CLAIMED`, or `FULL`. |
| Scoped checker | A trusted checker configuration whose exact argv prefix and selected paths are bound before launch. |
| RevisionProvider | The provider-neutral boundary for opaque revisions, exact content, normalized changes, and revision-range coverage. |
| SigningProvider | An optional external authority that can raise a valid attestation from `VERIFIED` to `ATTESTED` under identity and issuer policy. |
| Code manifest | A deterministic source-content snapshot with per-entry SHA-256 digests and an aggregate content digest. |
| Attestation statement | A deterministic in-toto Statement v1 binding the code manifest to valid ForgeLoop completion evidence. |
| Revision-range coverage | A post-completion result asking whether changed paths between two revisions are covered by valid task attestations. |
| Generic CI | The provider-neutral range-verification boundary that thin platform adapters may invoke without adding platform trust rules to the core. |
| Advisory Context | Optional host-provided information returned for human or agent consideration; it is not canonical task state, evidence, authority, completion truth, or next-action authority. |
| Advisory Context Provider | A runtime-injected Integration API provider with a declared identity and bounded recall method; providers are lazy, opt-in, and not persisted by ForgeLoop. |
| Portable Context | Bounded text normalized for transport, with control characters, secrets, unsafe paths, and unsupported fields rejected or discarded according to the canonical boundary. |
| Handoff Acceptance | An exactly-once, ledger-backed operational receipt that records consumption of an immutable handoff without transferring claims or creating evidence or authority. |
| Consumer ID | A caller-supplied descriptive key used to make handoff acceptance idempotent; it is not an authenticated identity. |
| Acceptance Status | The derived handoff projection `OPEN`, `ACCEPTED`, `UNBOUND`, or `INCONSISTENT`; it is not a lifecycle phase. |
| Continuity Lint | Non-authoritative, non-evidence diagnostics for stale or contradictory operational resume hints. |

`consumerId` is not an authenticated identity. A `harness`, recipient hint,
session label, or transport channel is descriptive metadata, not authority.
The harness owns execution and presentation; ForgeLoop owns canonical state,
evidence relationships, and validated lifecycle decisions.

| Execution continuity | Bounded current-task implementation context used to resume the same ForgeLoop task across sessions or harnesses. |
| Continuity artifact | `.forgeloop/continuity.json`; non-evidence operational context bound to canonical work state. |
| Continuity reconciliation | Read-only comparison of continuity bindings and path hints against current canonical state and checkout. |
| Executable policy rule | A structured rule with an automated checker evaluating constraints on code and artifacts. |
| Policy discovery | Deterministic non-interactive inspection of codebase structure and conventions with confidence levels. |
| Brownfield baseline | Cryptographically fingerprinted list of pre-existing policy violations tolerated without blocking progress. |
| Violation fingerprint | SHA-256 hash uniquely identifying a violation by rule, file, and line/content hash. |
| Monotonic ratchet | Invariant ensuring brownfield baseline debt only decreases as legacy violations are resolved. |
| Mutation verification | Proving checker capability by asserting failure on intentionally mutated code fixtures. |
| Proof digest | Cryptographic digest confirming a checker caught a mutation fixture. |
| Inert check | A verification rule whose check target or scope does not exist or matches 0 files in the codebase. |
| Policy drift | Divergence between task preflight snapshot policy and current workspace policy. |
| Policy diff | Semantic classification of policy changes into `TIGHTEN`, `NEUTRAL`, `WEAKEN`, or `UNKNOWN`. |

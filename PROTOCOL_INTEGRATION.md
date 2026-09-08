# Protocol Integration

ForgeLoop is a portable, project-scoped engineering protocol. It is vendor-neutral
and is not tied to a specific model, provider, agent product, IDE, or orchestration runtime.

The protocol becomes applicable because a project activates ForgeLoop, not because
an execution environment appears in a compatibility list.

<!-- FORGELOOP_PROJECT_PROTOCOL=REQUIRED -->

## Universal applicability

If the active execution environment discovers a ForgeLoop project adapter,
the canonical ForgeLoop protocol applies to work performed in that project.

```text
PROJECT HAS FORGELOOP ADAPTER
+
RUNTIME DISCOVERS IT
+
REQUIRED LOCAL CAPABILITIES ARE AVAILABLE
=
FORGELOOP APPLIES
```

An execution environment that has not been previously tested is
`CONFORMANCE_UNVERIFIED`, not unsupported and not exempt from the protocol.

Capabilities determine how much of ForgeLoop can be executed. Brand names do not.

### Interpretation rules

```text
INVALID:
"I am not a named ForgeLoop integration, therefore ForgeLoop does not apply."
"I will follow ForgeLoop only in spirit because my harness is not documented."

VALID:
"I discovered the ForgeLoop project adapter. ForgeLoop applies.
My current runtime may have unverified or limited capabilities, which I will evaluate."
```

## Integration levels

Execution environments integrate with ForgeLoop by capability:

### Level 1 — `INSTRUCTION_DISCOVERED`

The environment has automatically or explicitly loaded a project-local ForgeLoop
adapter (such as `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/project-loop.mdc`,
`.github/copilot-instructions.md`, or manual bootstrap).

### Level 2 — `PROTOCOL_CAPABLE`

The environment possesses the necessary local capabilities:

- Read project files.
- Write project-local files.
- Execute local commands.
- Invoke the project-local ForgeLoop CLI.
- Preserve project state across lifecycle transitions.

When these are available, the environment executes the complete ForgeLoop lifecycle.

### Level 3 — `PROTOCOL_LIMITED`

The environment discovered ForgeLoop but lacks one or more required local
capabilities (for example, no command execution or no write access).

ForgeLoop **still applies**, but the runtime must:

- Fail closed for the affected lifecycle dimension.
- Report the missing capability explicitly.
- Never simulate missing capabilities.
- Never manually fabricate protocol-owned state.
- Never claim validator-backed completion.

### Level 4 — `CONFORMANCE_VERIFIED`

A specific runtime, model, version, environment, and configuration has completed a
recorded blind conformance scenario under standard protocol verification.

Conformance verification is **evidence of tested interoperability**; it is
never an eligibility gate or allowlist for protocol adoption.

## Discovery surfaces

ForgeLoop provides project-local shims for common instruction-discovery mechanisms:

- `AGENTS.md`: Standard discovery surface recognized by multiple AI coding tools and developers.
- `CLAUDE.md`: Discovery surface for Claude Code.
- `.cursor/rules/project-loop.mdc`: MDC rule format for Cursor.
- `.github/copilot-instructions.md`: Repository instructions for GitHub Copilot.

These files are discovery aliases. They all point to the same canonical project
protocol in `.forgeloop/kit/LOOP_ENGINEERING.md` and `.forgeloop/kit/PROTOCOL_INTEGRATION.md`.
They do not define separate ForgeLoop implementations.

### Generic and manual bootstrap

For environments, internal enterprise agents, custom harnesses, or developer-operated
workflows that do not automatically discover one of the default files:

1. Read `.forgeloop/kit/LOOP_ENGINEERING.md`.
2. Read `.forgeloop/kit/PROTOCOL_INTEGRATION.md`.
3. Resolve the project-local ForgeLoop CLI.
4. Execute the contract, route, preflight, and lifecycle workflow.

A developer or custom automation can execute ForgeLoop identically to an AI agent.

### Compatibility handshake

Before a harness creates or resumes task state, it can read the complete
machine-readable compatibility boundary:

```bash
forgeloop protocol-info --json
```

When a compatibility change requires persisted state conversion, inspect it
before writing anything:

```bash
forgeloop migrate-protocol --to 1 --dry-run --json
```

`migrate-protocol` accepts only versions with an explicit migration in the
installed release. Unsupported targets fail without rewriting state. The
current protocol's only supported conversion is the receipt-backed legacy
singleton-layout migration; a future protocol version must add its own
validated migration before it can become an accepted `--to` value.

The response separates package and protocol identity. `packageVersion` is the
installed CLI version; `readsProtocol` and `writesProtocol` enumerate protocol
versions supported by this CLI; `readsSchemaVersions` and
`writesSchemaVersions` map every public artifact schema to its supported
versions. A harness must not infer compatibility from the package version
alone, and it must fail closed when its required protocol or schema version is
absent from the relevant list.

## Adaptive execution profiles and context presentation

`complianceMode` and `executionProfile` are independent dimensions. Compliance
mode (`advisory`, `standard`, or `strict`) describes enforcement policy;
execution profile (`auto`, `light`, `balanced`, or `full`) describes process and
context depth. ForgeLoop resolves the profile deterministically from route,
contract, and task-scope metadata. CLI requests override project configuration
as requests, but never lower the safety floor.

Hosts may use the resolved profile to control presentation. For `light`, pass
the objective, deliverables, constraints, profile, selected guide IDs, phase,
next action, and verification requirements; reuse unchanged state locally and
avoid reinjecting complete ledgers, schemas, receipts, and protocol documents.
`next --compact` and `task-show --compact` provide bounded machine-readable
projections. These presentation choices never alter required gates, evidence,
verification truth, lifecycle chronology, authority, or validator-backed
completion. A protocol-v1 route without profile metadata remains readable and
projects to `balanced` compatibility behavior.

The integration API also exposes the read-only `task/context` projection. It
contains the resolved profile, objective, deliverables, constraints, selected
guide IDs, next action, verification requirements, and a bounded context
policy for hosts. A host may omit optional presentation context, but
`light` never authorizes a skipped lifecycle phase or required gate. A phase
may be absent only when the canonical protocol marks it not applicable.

The capability handshake names this contract as `executionProfileContext` and
marks `executionProfile.resolved` as authoritative. Historical consumers that
do not expose `task/context` must use balanced compatibility behavior rather
than inventing a local LIGHT heuristic. Optional benchmark context telemetry is
host-reported or `UNKNOWN`; ForgeLoop does not tokenize provider prompts.

The profile invariant block is explicit:

```text
execution depth changes presentation and optional context only.
required lifecycle phases remain unchanged.
required gates remain unchanged.
verification truth and evidence requirements remain unchanged.
authority, provenance, and safety-floor decisions remain unchanged.
validator-backed completion remains unchanged.
```

## Capability negotiation

The public capability handshake exposes additive capability families separately
from Protocol v1, schema v1, and Integration API v1:

| Capability family | Version | Boundary |
| --- | --- | --- |
| `canonicalHandoffs` | v2 | Immutable handoff snapshots with ledger-backed exactly-once operational acceptance |
| `advisoryContextProviders` | v1 | Lazy, opt-in, provider-neutral Integration API injection only |

`repositoryIndex` v1 is a mandatory provider-neutral discovery capability for
Git repositories. ForgeLoop currently implements it with a managed, pinned
Microsoft `tgrep` 1.0.3 release. `protocol-info --json` and the stable
Integration API advertise the same `repository/search` operation and
`repository/index-status` project resource used by the CLI and MCP adapter.
The index is derived local cache/state: it is never lifecycle evidence,
completion authority, task ownership, or historical source of truth. Hosts
must not replace an unhealthy index with a silent `rg`, `grep`, or PATH-based
fallback, and must not treat search results as proof of verification.

`canonicalHandoffs` v2 advertises `supported: true`, immutable snapshots,
`lifecycleAuthority: false`, `evidenceAuthority: false`,
`exactlyOnceAcceptance: true`, `acceptanceLedgerBacked: true`, and the
`handoff-accept` command with `OPEN`, `ACCEPTED`, `UNBOUND`, and `INCONSISTENT`
status projections. Acceptance is an operational receipt only: it does not
transfer claims or create evidence or authority, and it is orthogonal to phase
transitions.

`advisoryContextProviders` v1 is `integrationApiOnly: true`, lazy, and opt-in.
Its results are never persisted by ForgeLoop and are never canonical state,
evidence, authority, completion truth, next-action authority, or executable
instructions. `protocol-info` may advertise the capability, but advisory
recall remains a programmatic Integration API operation; there is no stock
`context-recall` CLI command.

A consumer that understands `canonicalHandoffs` v1 but not v2 may disable the
handoff-specific UI while keeping Protocol v1 core functionality available.
Consumers must feature-detect the capability family and must not mark the
whole project incompatible merely because an optional capability version is
newer.

Optional observability is lazy. Reflection, trajectory evaluation, handoff,
responsibility, attestation, benchmark analysis, and continuity artifacts are
not required merely because the capability exists; policy, user/host request,
or recovery need must require them.

Usage telemetry is a separate informational boundary. A runtime may supply an
optional `ForgeLoopUsageProvider.getTaskUsage({ projectPath, taskId })`; the
provider must report only `PROVIDER_REPORTED` or `HOST_REPORTED`. The CLI
fallback records only `ACTOR_REPORTED`, and absent data is `UNKNOWN`. ForgeLoop
never estimates tokens or accepts usage as verification evidence. The
read-only `efficiency --task` command reports `NOT_COMPARABLE` until an
optional project-local baseline has matching metadata.

Execution-profile benchmark evidence is a separate observational boundary.
The reproducible runner compares direct, balanced, and adaptive modes only
when provider or host usage, actual timing, PASS verification, comparable
steps, and matching metadata are present. Missing or non-comparable values
remain `UNKNOWN`/`NOT_COMPARABLE`; no efficiency claim is inferred.

## CLI resolution policy

Lifecycle-owned protocol state must be managed through the project-local ForgeLoop CLI:

1. Project-local `node_modules/.bin/forgeloop`
2. Package manager local execution (e.g. `npx --no-install forgeloop` or equivalent)
3. Direct package CLI entry point (`node src/cli.js`)
4. Verified global `forgeloop` matching the installed package version

Do not automatically download a different version during a reproducible run.
The resolved CLI must match the installed project's package identity.

## Protocol-owned state and no-simulation policy

The following protocol artifacts are strictly owned by ForgeLoop:

- `.forgeloop/task-state/<taskKey>/preflight.json`
- `.forgeloop/task-state/<taskKey>/work-state.json`
- `.forgeloop/task-state/<taskKey>/events.ndjson`
- `.forgeloop/task-state/<taskKey>/execution-receipt.json`
- `.forgeloop/task-state/<taskKey>/recovery.json`
- `.forgeloop/task-state/<taskKey>/executions/<executionId>.json`
- Canonical check, evidence, and terminal-result state

If the required CLI or API capability cannot be resolved:

- **Do not** fabricate lifecycle state manually.
- **Do not** synthesize event history.
- **Do not** manually assign `COMPLETE`.
- **Do not** construct a fake execution receipt.
- **Do not** rewrite `events.ndjson` to simulate chronology.

Report the corresponding ForgeLoop dimension as `NOT_VERIFIED` / `E_FORGELOOP_CLI_UNAVAILABLE`.

## Trusted command provenance

Command verification has two explicit paths:

- `forgeloop run-check --id <id> --requirement <requirement> -- <argv>` owns
  execution. It classifies the exact argv before launch, uses a non-shell
  process boundary, records the target cwd, resolution mode, timestamps,
  exit status, and task/check binding in
  `.forgeloop/task-state/<taskKey>/executions/<executionId>.json`, then records an `OBSERVED` check
  with `provenance: FORGELOOP_EXECUTED`.
- `forgeloop record-check` owns serialization only. `--command` is metadata and
  is never launched. A `kind: command` check with `evidenceKind: OBSERVED`
  requires both `executionRef` and `FORGELOOP_EXECUTED`; manual or actor-reported
  observations use their explicit non-command/provenance values and remain
  distinguishable from process execution.

`run-check` rejects install-capable resolution before process launch unless the
host supplies a valid trusted authority context. `npm exec` and `npm x` are
installation-capable resolution paths. Recognized command dispatchers (such as
`npm test`, `npm restart`, `npm run`, `npm rum`, `npm urn`) are resolved
recursively across recognized lifecycle scripts before launch with cycle
detection, leading option normalization, and restart-specific lifecycle fallback.
npm workspace script executions (`--workspace`, `-w`, `--workspaces`, `--ws`) fail
closed before launch with `E_COMMAND_RESOLUTION_AMBIGUOUS` because the effective
`package.json` context cannot be proven from the root target. Unknown npm command semantics are rejected before execution rather than downgraded to local execution. ForgeLoop uses an explicit non-installing allowlist instead of assuming that unrecognized npm commands are safe. `npx --no-install` is
an allowed non-installing resolution and can return a normal failed result when
the requested tool is unavailable. Completion, audit, `validate-protocol`, and task
bundles revalidate execution references rather than trusting duplicated check
metadata. Invalid or missing references return `E_EXECUTION_REF_INVALID`; an
observed command without ForgeLoop provenance returns
`E_COMMAND_PROVENANCE_UNATTESTED`.

### Verification execution adapter boundary

Verification execution is separated from protocol state through a trusted
adapter boundary. A host supplies both through the integration runtime
context, and neither is accepted as CLI flags, input, or project files:

```js
createForgeLoopContext({
  verificationExecutionAdapter: { execute: async (request) => { /* ... */ } },
  verificationExecutionPolicy: { requiredIsolation: "PROJECT_ISOLATED" },
});
```

The adapter receives a frozen request (`argv`, `protocolProjectRoot`, `taskId`,
`checkId`, `requirement`, `timeoutMs`, `resolution`) and returns the execution
result plus isolation metadata. Isolation modes are:

| Mode | `isolated` | `liveProjectWritable` | Network/environment |
| --- | --- | --- | --- |
| `NATIVE_PROJECT` | `false` | `true` | Inherited |
| `PROJECT_ISOLATED` | `true` | `false` | Adapter-declared policy |
| `SYSTEM_ISOLATED` | `true` | `false` | `networkPolicy: DENIED` required |

ForgeLoop owns the adapter contract and evidence semantics; the harness owns
the concrete isolation backend, and no specific backend is normative in
ForgeLoop core documentation. The boundary is fail-closed:

- isolation metadata must be internally consistent with its declared mode
  (`NATIVE_PROJECT` is never isolated; isolated modes are never
  `liveProjectWritable`; `SYSTEM_ISOLATED` never inherits network access).
  Contradictory metadata is rejected with `E_VERIFICATION_EXECUTION_INVALID`
  before evidence persistence;
- isolated execution must use a working directory separate from the protocol
  project root;
- verification that cannot satisfy the required isolation boundary fails with
  `E_VERIFICATION_ISOLATION_UNAVAILABLE` and must never fall back to running
  in the live project.

`protocol-info --json` advertises this capability as
`features.verificationExecutionIsolation` (version 1), including the supported
modes and the `protocolProjectRootSeparateFromExecutionCwd` invariant. The
modes, public error codes, and `createForgeLoopContext` are exported from
`@cassiomc1/forgeloop/integration`.

## Missing tool capability

A missing tool is a capability gap, not installation authority.

If an expected verifier, browser tool, linter, analyzer, or test dependency is
not already available:

- use a suitable existing local equivalent when possible;
- otherwise request authority if installation is necessary and allowed;
- otherwise report the affected verification dimension as not verified with
  `E_VERIFICATION_TOOL_UNAVAILABLE`.

Every verification command is classified by resolution mode (`LOCAL_EXECUTABLE`,
`LOCAL_PACKAGE_BINARY`, `NON_INSTALLING_RESOLUTION`, `INSTALL_CAPABLE_RESOLUTION`,
`EXPLICIT_INSTALLATION`). Any command that uses an install-capable or installation
path without a valid canonical authority reference is rejected by `record-check`,
`audit`, and `complete` with `E_INSTALLATION_AUTHORITY_REQUIRED`, `E_AUTHORITY_INVALID`,
`E_AUTHORITY_SCOPE_MISMATCH`, or `E_AUTHORITY_UNTRUSTED_SOURCE`.

```text
capability ≠ authority
evidence ≠ authority grant
actor claim ≠ operator grant
```

Authority cannot be self-issued by the actor consuming it. Boolean fields inside
verification evidence are not sufficient proof of installation authority.

The same rule applies to claim-release recovery. The standalone
`--acknowledge-recovery` flag records `CALLER_ACKNOWLEDGED`; it is an explicit
request, not a host grant. The deprecated `--operator-authorized` spelling is
only a compatibility alias and has identical caller-acknowledgement semantics.
`HOST_ATTESTED` recovery metadata is valid only when a host integration supplies
a trusted grant reference through a boundary the active actor cannot mint or
replace. The standalone CLI does not expose such a self-attestation option.

Claim ownership is a validated relationship, not an artifact preference.
<a id="FL-CLAIM-001"></a> **FL-CLAIM-001 — Every harness MUST consume the canonical claim-state resolver**
over the descriptor, work state, recovery artifact, and complete validated
recovery history. The resolver retains historical claims and disables mutation
when that relationship is `INCONSISTENT`; reading `recovery.json` alone is
non-conforming.

### Authority provenance

Authority provenance is external to actor-authored project state. An external
path is not equivalent to external authority ownership:

```text
outside target
≠
outside actor control
```

The standalone CLI uses `trustMode: NONE`. `FORGELOOP_AUTHORITY_FILE` and
`FORGELOOP_AUTHORITY_DIR` select candidate authority sources, but they do not
make a source trusted in actor-facing execution. Environment-selected sources
are rejected with `E_AUTHORITY_UNTRUSTED_SOURCE` for install-capable checks.

Trusted authority requires an explicit `HOST_ATTESTED` runtime context supplied
through an integration boundary the active actor cannot replace at command
invocation time. Configuration is not trust:

```text
environment-selected source
≠
host-attested source

configuration
≠
trust
```

For durable actions, trusted host authority travels **out-of-band** through the
programmatic integration API:

```js
await executeForgeLoopCommand({
  command: "approval-resolve",
  projectPath,
  input: { /* actor-controlled command input only */ },
  authorityContext: trustedHostContext, // host-supplied, never from input
});
```

`authorityContext` and `runtimeContext` are separate executor parameters; they
are never merged into `input`, never accepted as tool arguments, and cannot be
minted by CLI flags, project files, environment variables, or transport
sessions. MCP embeddings supply an immutable provider instead:

```js
createForgeLoopMcpServer({
  projectPath,
  allowApprovalResolution: true,      // transport surface only
  authorityContextProvider: async ({ command }) => trustedContextOrNull,
});
```

The host-attested source must still resolve outside the actor-writable target. A
project-local authority reference may identify a grant, but it does not create
the root of trust.

```text
actor-authored evidence
≠
trusted authority

project-local file
≠
host grant

declared provenance
≠
verified provenance
```

A local artifact claiming `source: operator` is not sufficient proof of operator
authority. The actor-facing CLI must not expose an equivalent of
`--authority-source-attested-by-host` or `--trusted-authority-file` that
self-promotes a source. If the host exposes the attested source as writable to
the actor, the host boundary has been compromised and ForgeLoop cannot provide
cryptographic attestation by itself.

Never convert `PROTOCOL_LIMITED` into environmental mutation by implicitly
installing a package.

## Optional capability extensions

The installed loop directs the active actor to inspect native model and harness
capabilities. When a task requires a missing capability (e.g. multimodal vision),
the actor may install the smallest task-scoped capability (such as `Qwen-MM-Plugins`)
through native mechanisms or upstream installers, then verify it before use.

API credentials, system packages, and unrelated environment changes remain
separately gated.

## Delegation scope

Delegation is optional.

A run that contains no delegation events, no delegated task references, and no
delegation artifacts is a valid single-actor run.

Missing delegation artifacts must not make such a run incomplete. For a purely
local single-actor lifecycle, the delegation dimension is `NOT_APPLICABLE`.

Once delegation is observed in canonical state, receipt, or event history, the
required delegation artifacts become mandatory.

## Instruction precedence

When multiple instruction layers exist, follow standard precedence:

1. Platform, sandbox, and system security rules.
2. Direct user instructions in the latest prompt.
3. Target project-specific rules and instructions.
4. ForgeLoop project protocol (`LOOP_ENGINEERING.md`, `PROTOCOL_INTEGRATION.md`).
5. Activated domain guides (`GUIDE_ROUTER.md` → `ENG/*.md`).
6. Technical defaults and safe assumptions.

The absence of an environment's name from documentation is never a precedence conflict.

## External workflow interaction

External planning, interview, or review workflows (such as `/grill-me`, `/plan`, or IDE
review gates) may assist in clarifying requirements, but they must not silently
redefine ForgeLoop `NON_BLOCKING` decisions as `BLOCKING` in autonomous mode.
Consult `LOOP_ENGINEERING.md#external-workflow-interaction` for the complete boundary.

## Harness and session continuity

Harness identity is not task identity. Session identity is not task identity.
A compatible environment reopening a resumable task SHOULD inspect the current
work state, reconcile optional execution continuity, inspect the checkout, and
continue the existing lifecycle instead of replacing the contract merely
because the executor changed.

For the practical handoff and multi-tool takeover sequence, see
[`docs/CROSS_HARNESS_CONTINUITY.md`](./docs/CROSS_HARNESS_CONTINUITY.md).

### Optional workspace and attestation integrations

The stable integration API exposes optional task workspace binding, immutable
handoff snapshots, responsibility constraints, verification-scope planning,
and provider-neutral code attestation. Integrations pass opaque revision IDs
and optional signing policy to the canonical runtime; they do not reimplement
content coverage, evidence binding, or signer trust.

The ownership boundary for these extensions is explicit:

| Capability | ForgeLoop owns | Host owns |
| --- | --- | --- |
| Workspace binding | Derives repository/worktree identity, persists the binding, and rejects mismatch before mutation or `run-check` launch | Chooses whether a task needs binding and provides the current checkout |
| Handoff envelope | Creates immutable protocol-derived snapshots and verifies their digest and ledger relationships | Supplies any descriptive note or recipient hint; it cannot turn the envelope into delegation or evidence |
| Responsibility contract | Validates allowed/read-only paths, required checks, and frozen-input fingerprints | Chooses the optional boundary and performs the work inside it |
| Verification scope | Resolves `AUTO`, `CHANGED`, `CLAIMED`, or `FULL`, binds scoped-checker argv, and fails closed on stale or mismatched inputs | Declares checker configuration and consumes the returned scope without guessing a narrower one |
| Structural quality | Owns provider-neutral baseline/evaluation artifacts, delta policy, typed check provenance, and lifecycle/completion semantics | Supplies or selects a runtime provider and consumes `quality-status`; it does not provide arbitrary executable or shell input |
| RevisionProvider | Reads opaque revisions, exact bytes, normalized changes, and range coverage through the provider contract | Supplies or selects the provider and revision identifiers |
| SigningProvider | Validates provider results and preserves `VERIFIED` versus `ATTESTED` semantics | Owns the external signer, identity/issuer policy, credentials, and availability |
| Generic CI / MCP | Keeps canonical command, evidence, and trust semantics | Owns the platform job, transport, scheduling, and presentation layer |

These capabilities are additive. Basic ForgeLoop compatibility still consists
of the canonical task, contract, route, preflight, lifecycle, evidence, and
completion boundaries; a host must not make workspace binding, narrow
checking, signing, Generic CI, or MCP prerequisites for the default loop.

<a id="FL-ATTEST-002"></a> **FL-ATTEST-002 — An integration MUST consume the canonical**
attestation result and preserve its distinction between `VALID`, invalid,
uncovered, stale, and provider/environment failure. An adapter cannot upgrade
an invalid result or treat npm provenance, a platform status, or a local
fingerprint as a ForgeLoop signature.

<a id="FL-ATTEST-003"></a> **FL-ATTEST-003 — A signing integration MUST keep private keys,**
OIDC tokens, and credentials outside ForgeLoop artifacts. Signing and
verification may use an external provider, while the persisted statement stays
deterministic and provider-neutral.

<a id="FL-SQ-002"></a> **FL-SQ-002 — A structural-quality integration MUST preserve unavailable, malformed, stale, incomparable, and blocked provider results without promoting them to PASS.**

## Structural quality integration

Structural quality is an optional provider-neutral capability. The public
integration API exposes `StructuralQualityProvider`, normalized detection and
snapshot types, and runtime provider injection through the context. Project
configuration selects only a registered provider name and policy; it cannot
select an executable path, shell command, arbitrary argument vector, raw score,
or baseline.

The canonical commands are `quality-baseline` and `quality-verify` for bounded
provider execution and task mutation, plus read-only `quality-status`. MCP and
the integration API consume the same declarative command definitions and
preserve `PASS`, `FAIL`, `BLOCKED`, and `NOT_OBSERVED` without duplicating
lifecycle logic. The read-only `task/structural-quality` resource never starts
the provider.

The built-in `sentrux` provider uses the local MCP stdio boundary, requires a
supported version, and keeps output, timeout, path, and secret handling inside
ForgeLoop's normalized evidence boundary. Sentrux is not a runtime dependency;
installation and analytics preferences remain user-managed. Quality evidence
does not replace behavioral, security, performance, accessibility, review,
publication, or production-readiness evidence.

## Executable Policy Protocol Integration

ForgeLoop integrates executable verification rules directly into the lifecycle:

- **Preflight**: Validates policy capability (`NOT_PRESENT`, `AVAILABLE`, `INVALID`). For `AVAILABLE`, captures effective policy rules and semantic baseline state into `.forgeloop/task-state/<taskKey>/policy-snapshot.json`. If policy artifacts are malformed (`INVALID`), preflight fails closed with `E_POLICY_INVALID`. Snapshot write conflicts fail closed with `E_POLICY_SNAPSHOT_WRITE_FAILED`.
- **Lock Verification**: Validates `.forgeloop/policy/policy.lock` against effective rules (`built-in` + `discovered` + `project overrides`) and baseline. Requires `algorithm`, `digest`, `rulesDigest`, and `baselineDigest` to match. `capturedAt` is non-semantic metadata. Mismatches trigger `E_POLICY_LOCK_MISMATCH`.
- **Execution & Verifying**: Evaluates checks with mutation proofing (`rule-verify`). Checkers must cleanly distinguish `PASS`, `FAIL`, and `ERROR` (`CHECK_MUTATION_EXECUTION_ERROR`). Expected mutant failure yields `PROVEN`; false passes yield `UNPROVEN` (`CHECK_MUTATION_NOT_DETECTED`). Unproven or inert checks in discovered rules degrade gracefully without stopping execution.
- **Completion**: Audits unbaselined violations, policy weakening, and drift. Weakening relative to task snapshot produces `E_POLICY_WEAKENING`. Returns `VALID` when policy integrity is intact and no new unbaselined violations exist.
- **Autonomy Principle**: Non-interactive execution is preserved. Tools, commands, and validators operate unattended with standard input closed and without interactive prompt dependencies.
- **Baseline Protection**: Re-recording baseline debt mid-task is rejected with `E_BASELINE_RECORD_DURING_ACTIVE_TASK`; only monotonic ratchet-down is allowed during active tasks (`baseline --update`). Explicit re-recording requires `--policy-reset-authorized`.
- **Semantic Recovery**: `forgeloop next` maps policy findings directly to actionable recovery actions (`RESTORE_POLICY`, `REPAIR_CHECKER`, `REPAIR_POLICY`, `REVERIFY_AFTER_POLICY_CHANGE`, `RESTORE_BASELINE`, `CONTINUE_WITH_EXISTING_BASELINE`, `RESOLVE_INERT_CHECK`).
- **Claim Recovery**: `forgeloop next` maps validated task ownership to `RECONCILE_CLOSURE`, `RECOVER_TASK`, `RESUME_RECOVERED_TASK`, or `RESOLVE_RECOVERY_INCONSISTENCY`. `task-recover` is restricted to `STALE`/`ABANDONED`; it writes durable `recovery.json` plus an append-only event without changing lifecycle evidence. `task-resume` validates the same ownership projection, safely settles an unchanged stale task lock, reuses canonical scope conflict checks, and removes recovery state transactionally.
- **Task Scoping**: Task-specific policy snapshots and state live under `.forgeloop/task-state/<taskKey>/` to ensure clean multi-task isolation and cross-harness continuity.

## Structured integration surfaces

When a host provides an official ForgeLoop structured integration, prefer it
for protocol operations; otherwise use the project-local ForgeLoop CLI. Both
surfaces execute the same canonical commands and share one protocol authority:
`.forgeloop/` state written only by ForgeLoop itself.

- `@cassiomc1/forgeloop/integration` (integration API version 1): the
  transport-neutral programmatic runtime. Domain rejections keep `ok:true`
  with a non-zero exit code; public error codes are preserved verbatim.
- `@cassiomc1/forgeloop-mcp` (local stdio MCP): an adapter over the same API.
  It never edits `.forgeloop/` state directly, never synthesizes authority,
  and never derives claim ownership outside the canonical resolver
  (`features.integrationApi.version >= 1` in `protocol-info --json`).

ForgeLoop applicability never depends on MCP availability: instruction-only
hosts remain fully supported through the CLI and instruction adapters.

`protocol-info --json` advertises claim-recovery capability version 1 under
`features.taskClaimRecovery`. A project containing active task recovery state
requires ForgeLoop 1.4.0 or newer.
<a id="FL-CLAIM-003"></a> **FL-CLAIM-003 — A reader without `validatedClaimProjection=true` MUST fail closed**
and must not mutate claims.

## Durable actions and authority boundary

Durable action support is additive to the integration contract. Read-only
resources may expose action, approval, metrics, evaluation, and capability
policy projections, but an integration must not treat transport metadata,
session IDs, project policy, or actor prose as host authority. `HOST_ATTESTED`
is accepted only from the existing host trust boundary.

`run-action` is an exact-argv surface with no shell mode. Hosts that perform an
operation themselves must record it as `HOST_REPORTED`; external observations
used to settle uncertainty are `EXTERNAL_OBSERVED`. A started action whose
external outcome cannot be proven is `COMMIT_UNKNOWN`: integrations must surface
`E_ACTION_RECONCILIATION_REQUIRED` and must not retry automatically. The only
forward path is explicit `action-reconcile` with bounded evidence.

Trajectory metrics and evaluations are read-only projections over canonical
events and trace/reflection data. Missing token/cost/model data remains unknown,
and efficiency is comparable only when a project-local scenario supplies a
positive reference step count. ForgeLoop remains an evidence protocol, not an
agent runtime or workflow engine.

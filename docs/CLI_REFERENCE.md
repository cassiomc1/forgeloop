# ForgeLoop CLI Reference

This document provides a complete operational reference for every ForgeLoop CLI command.

```text
Usage: forgeloop <command> [options]
```

## Common Options

<!-- BEGIN FORGELOOP GENERATED: cli-common-options -->

- `--path <directory>`: target project directory (default: current directory)
- `--help`: show this help
- `--version`: show the installed package version

Commands that support structured machine-readable output document `--json` in their command-specific option list.

<!-- END FORGELOOP GENERATED: cli-common-options -->

---

## CLI Syntax Contract

ForgeLoop uses a definition-driven command-line parser:

- **Bootstrap Options**: Before the command, only common options (`--path <directory>`, `--help`, `--version`, `-h`, `-v`) are accepted.
- **Command-Specific Options**: Available after command discovery.
- **Equals Syntax**: All value-taking long options support both `--option value` and `--option=value`.
- **String Options**: Reject empty values by default (e.g. `--path=` or `--task=""` are rejected).
- **Boolean Flags**: Never accept inline values (e.g. `--json=false` is rejected).
- **Argv Passthrough**: Everything after a command's `--` passthrough marker is preserved exactly and is not parsed as ForgeLoop syntax.

### Execution profile and compact context

`route` resolves the orthogonal execution profile from `auto`, `light`,
`balanced`, or `full`. CLI requests take precedence over project configuration,
but a deterministic safety floor always wins. The profile changes context and
process depth only; it never bypasses lifecycle phases, gates, verification,
authority, provenance, or completion validation.

For high-frequency host reads, request bounded projections:

```bash
forgeloop next --task <id> --compact --json
forgeloop task-show --task <id> --compact --json
```

Compact output always preserves task identity, phase, resolved profile,
required next action or status, terminal state where applicable, and blocker
error codes. Default output and default JSON remain unchanged.

---

## Command Index by Purpose

<!-- BEGIN FORGELOOP GENERATED: cli-command-index -->

| Category | Commands |
| --- | --- |
| **Inspection & Diagnostics** | [`protocol-info`](#protocol-info), [`doctor`](#doctor), [`index-status`](#index-status), [`search`](#search), [`metrics`](#metrics), [`usage-record`](#usage-record), [`efficiency`](#efficiency), [`eval`](#eval), [`history`](#history), [`trace`](#trace), [`reflect`](#reflect), [`progress`](#progress), [`profile-interview`](#profile-interview), [`inspect`](#inspect), [`status`](#status), [`validate-state`](#validate-state), [`validate-protocol`](#validate-protocol) |
| **Setup & Maintenance** | [`init`](#init), [`index-setup`](#index-setup), [`index-start`](#index-start), [`index-stop`](#index-stop), [`index-rebuild`](#index-rebuild), [`update`](#update), [`task-migrate`](#task-migrate), [`migrate-protocol`](#migrate-protocol), [`task-unlock`](#task-unlock), [`task-recover`](#task-recover), [`task-repair-legacy-recovery`](#task-repair-legacy-recovery), [`task-resume`](#task-resume) |
| **Lifecycle & State** | [`activate`](#activate), [`route`](#route), [`preflight`](#preflight), [`advance`](#advance), [`next`](#next), [`record-diagnosis`](#record-diagnosis), [`record-intervention`](#record-intervention), [`record-hypothesis-disposition`](#record-hypothesis-disposition), [`record-decision-criterion`](#record-decision-criterion), [`complete`](#complete), [`clear-state`](#clear-state), [`reconcile-closure`](#reconcile-closure), [`task-create`](#task-create), [`task-list`](#task-list), [`task-show`](#task-show), [`task-lock-status`](#task-lock-status), [`task-scope`](#task-scope) |
| **Verification & Completion** | [`quality-baseline`](#quality-baseline), [`quality-verify`](#quality-verify), [`quality-status`](#quality-status), [`prepare-completion`](#prepare-completion), [`run-check`](#run-check), [`record-check`](#record-check), [`record-terminal-result`](#record-terminal-result), [`audit`](#audit), [`report`](#report), [`validate-receipt`](#validate-receipt), [`verify-scope`](#verify-scope) |
| **Cross-Harness Continuity** | [`continuity`](#continuity), [`record-continuity`](#record-continuity), [`reconcile-continuity`](#reconcile-continuity), [`clear-continuity`](#clear-continuity), [`handoff-create`](#handoff-create), [`handoff-list`](#handoff-list), [`handoff-show`](#handoff-show) |
| **Durable Actions & Approvals** | [`run-action`](#run-action), [`action-propose`](#action-propose), [`action-record`](#action-record), [`action-show`](#action-show), [`action-reconcile`](#action-reconcile), [`action-verify`](#action-verify), [`action-authorize`](#action-authorize), [`approval-request`](#approval-request), [`approval-resolve`](#approval-resolve) |
| **Policy & Auditing** | [`policy`](#policy), [`policy-discover`](#policy-discover), [`policy-status`](#policy-status), [`policy-diff`](#policy-diff), [`rule-verify`](#rule-verify), [`baseline`](#baseline), [`bundle`](#bundle) |
| **workspace** | [`workspace-bind`](#workspace-bind), [`workspace-status`](#workspace-status) |
| **task** | [`handoff-accept`](#handoff-accept) |
| **scope** | [`responsibility-set`](#responsibility-set), [`responsibility-status`](#responsibility-status) |
| **attestation** | [`attestation-create`](#attestation-create), [`attestation-verify`](#attestation-verify), [`attestation-status`](#attestation-status), [`attestation-verify-range`](#attestation-verify-range) |

<!-- END FORGELOOP GENERATED: cli-command-index -->

---

## 1. Setup & Maintenance

### `index-setup`

Provisions or reuses the managed Repository Index engine, builds its derived
index, and starts the owned watcher.

- **Purpose**: Establish mandatory repository-search readiness.
- **Mutation**: Writes only Repository Index runtime state and cache data.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:index-setup:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--asset <path>`: use a preloaded pinned tgrep archive instead of downloading
- `--force`: rebuild the repository index even when metadata is current
- `--json`: emit repository-index setup as JSON

<!-- END FORGELOOP GENERATED: cli:index-setup:options -->

### `index-start`

Starts the ForgeLoop-owned Repository Index watcher after a complete index is
available. A verified healthy server is reused.

- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:index-start:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--json`: emit repository-index start as JSON

<!-- END FORGELOOP GENERATED: cli:index-start:options -->

### `index-stop`

Stops only a server whose repository, index, metadata, executable, and process
identity are verified as ForgeLoop-owned.

- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:index-stop:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--json`: emit repository-index stop as JSON

<!-- END FORGELOOP GENERATED: cli:index-stop:options -->

### `index-status`

Reports normalized Repository Index engine, index, policy, watcher, and health
state without repairing or provisioning it.

- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:index-status:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--json`: emit repository-index health as JSON

<!-- END FORGELOOP GENERATED: cli:index-status:options -->

### `index-rebuild`

Rebuilds only the derived Repository Index cache and restarts its owned
watcher. ForgeLoop task and protocol artifacts remain outside the deletion
boundary.

- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:index-rebuild:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--asset <path>`: use a preloaded pinned tgrep archive instead of downloading
- `--json`: emit repository-index rebuild as JSON

<!-- END FORGELOOP GENERATED: cli:index-rebuild:options -->

### `search`

Searches the managed Repository Index through the provider-neutral structured
search contract. Native tgrep flags are not accepted as a generic pass-through.

- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:search:options -->

- `--path <directory>`: target project directory (default: current directory)
- `<pattern>`: regular expression or literal search pattern
- `--glob <glob>`: include files matching a glob (repeatable)
- `--type <type>`: include files of a tgrep type (repeatable)
- `--fixed-strings`: treat the pattern as a literal string
- `--ignore-case`: search case-insensitively
- `--smart-case`: use case-insensitive search only for lowercase patterns
- `--word-regexp`: match whole words only
- `--context <lines>`: lines of context before and after matches
- `--before-context <lines>`: lines of context before matches
- `--after-context <lines>`: lines of context after matches
- `--max-count <number>`: maximum matches per file
- `--files-with-matches`: return matching file paths only
- `--stats`: include observed native search statistics
- `--json`: emit normalized provider-neutral search JSON

<!-- END FORGELOOP GENERATED: cli:search:options -->

## Workspace, Handoff, Responsibility, Scope, and Attestation

These commands add optional, task-scoped protocol artifacts. They do not turn
ForgeLoop into an agent runtime, scheduler, delegation service, SCM authority,
or signing authority.

### `workspace-bind`

Binds the selected task to the current Git worktree identity. Rebinding is
never implicit.

- **Purpose**: Persist an immutable repository/worktree identity binding for the task.
- **Mutation**: Writes the workspace binding and appends a `WORKSPACE_BOUND` event.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:workspace-bind:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--json`: emit binding result as JSON

<!-- END FORGELOOP GENERATED: cli:workspace-bind:options -->

- **Example**:

  ```bash
  forgeloop workspace-bind --task task-001 --json
  ```

### `workspace-status`

Reports whether the current Git worktree matches the selected task binding.

- **Purpose**: Inspect workspace binding status without changing task state.
- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:workspace-status:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--json`: emit workspace status as JSON

<!-- END FORGELOOP GENERATED: cli:workspace-status:options -->

- **Example**:

  ```bash
  forgeloop workspace-status --task task-001 --json
  ```

### `handoff-create`

Creates an immutable snapshot of current task state for cross-harness
continuity. It does not delegate work or create a review assignment.

- **Purpose**: Capture protocol-derived state, evidence, paths, and continuity with optional recipient intent.
- **Mutation**: Writes an immutable handoff artifact and appends a `HANDOFF_CREATED` event.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:handoff-create:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--recipient <hint>`: non-authoritative recipient hint
- `--note <text>`: non-authoritative handoff note
- `--json`: emit handoff as JSON

<!-- END FORGELOOP GENERATED: cli:handoff-create:options -->

- **Example**:

  ```bash
  forgeloop handoff-create --task task-001 --recipient next-harness --note "Continue verification" --json
  ```

### `handoff-list`

Lists immutable handoff snapshots for a task.

- **Purpose**: Inspect existing handoff snapshots without changing them.
- **Mutation**: Read-only.
- **Acceptance projection**: Derives `OPEN`, `ACCEPTED`, `UNBOUND`, or
  `INCONSISTENT` from the validated event ledger. Invalid or unreadable ledgers
  are fail-closed and expose `reasonCodes`; they are never treated as empty.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:handoff-list:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--json`: emit handoff list as JSON

<!-- END FORGELOOP GENERATED: cli:handoff-list:options -->

- **Example**:

  ```bash
  forgeloop handoff-list --task task-001 --json
  ```

### `handoff-show`

Reads and verifies one immutable handoff snapshot.

- **Purpose**: Inspect one handoff by ID and validate its digest and bindings.
- **Acceptance projection**: Uses the same fail-closed ledger-derived status as
  `handoff-list`.
- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:handoff-show:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--id <id>`: handoff identifier
- `--json`: emit handoff as JSON

<!-- END FORGELOOP GENERATED: cli:handoff-show:options -->

- **Example**:

  ```bash
  forgeloop handoff-show --task task-001 --id handoff-001 --json
  ```

### `handoff-accept`

Records exactly-once acceptance of an immutable handoff into the task event ledger.

- **Purpose**: Bind an incoming consumer/harness to an immutable handoff snapshot.
- **Mutation**: Appends a `HANDOFF_ACCEPTED` event.
- **Freshness**: Acceptance requires the current canonical state and directly
  observed repository branch/HEAD to match the immutable snapshot, including a
  clean committed HEAD drift check.
- **Human output**: Reports `authority: OPERATIONAL_RECEIPT_ONLY`,
  `evidence: NONE`, and `claims transferred: NO`; acceptance is exactly-once
  operational receipt only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:handoff-accept:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--handoff <id>`: handoff identifier
- `--consumer-id <id>`: consumer identifier accepting the handoff
- `--harness <name>`: optional harness accepting the handoff
- `--json`: emit acceptance result as JSON

<!-- END FORGELOOP GENERATED: cli:handoff-accept:options -->

- **Example**:

  ```bash
  forgeloop handoff-accept --task task-001 --handoff handoff-001 --consumer-id agent-42 --json
  ```

### `responsibility-set`

Creates immutable constraints for the current task pass.

- **Purpose**: Freeze allowed paths, read-only paths, input fingerprints, and required checks.
- **Mutation**: Writes responsibility constraints and appends a `RESPONSIBILITY_SET` event.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:responsibility-set:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--label <label>`: descriptive pass label; not an identity or role
- `--allowed-path <path>`: path prefix allowed during this pass (repeatable)
- `--read-only-path <path>`: path prefix that must not change during this pass (repeatable)
- `--required-check <id>`: current-cycle check required by this pass (repeatable)
- `--freeze-contract`: freeze the current contract fingerprint
- `--freeze-route`: freeze the current route fingerprint
- `--freeze-claims`: freeze the current effective claims fingerprint
- `--json`: emit responsibility result as JSON

<!-- END FORGELOOP GENERATED: cli:responsibility-set:options -->

- **Example**:

  ```bash
  forgeloop responsibility-set --task task-001 --label implementation --allowed-path src --required-check unit-tests --json
  ```

### `responsibility-status`

Validates active responsibility constraints against current paths, inputs, and
checks.

- **Purpose**: Inspect whether the current task pass remains within its immutable responsibility boundary.
- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:responsibility-status:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--json`: emit responsibility status as JSON

<!-- END FORGELOOP GENERATED: cli:responsibility-status:options -->

- **Example**:

  ```bash
  forgeloop responsibility-status --task task-001 --json
  ```

### `verify-scope`

Resolves a provable verification boundary without launching checks.

- **Purpose**: Persist exact changed, claimed, or full verification scope for the current cycle.
- **Mutation**: Writes a verification-scope artifact and appends a `VERIFICATION_SCOPE_CAPTURED` event.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:verify-scope:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--mode <mode>`: requested deterministic verification boundary (default: AUTO)
- `--json`: emit verification scope as JSON

<!-- END FORGELOOP GENERATED: cli:verify-scope:options -->

- **Example**:

  ```bash
  forgeloop verify-scope --task task-001 --mode AUTO --json
  ```

### `attestation-create`

Creates a deterministic in-toto Statement after completion and manifest
validation.

- **Purpose**: Bind the final source-content manifest to valid completion and audit evidence.
- **Mutation**: Writes the immutable attestation statement and appends an `ATTESTATION_STATEMENT_CREATED` event.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:attestation-create:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--json`: emit attestation statement result as JSON

<!-- END FORGELOOP GENERATED: cli:attestation-create:options -->

- **Example**:

  ```bash
  forgeloop attestation-create --task task-001 --json
  ```

### `attestation-verify`

Verifies a task attestation and current revision without mutating task state.

- **Purpose**: Check statement, manifest, evidence bindings, source bytes, and optional signing-provider policy.
- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:attestation-verify:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--ref <revision>`: target revision to compare with the manifest
- `--bundle <path>`: optional external signature bundle
- `--identity <identity>`: optional exact signer identity policy
- `--issuer <issuer>`: optional exact signer issuer policy
- `--revision-provider <provider>`: revision provider (default: git)
- `--signing-provider <provider>`: signing provider (default: none)
- `--trusted-root <path>`: trusted signing root path
- `--require-signature`: require a valid external signature
- `--json`: emit verification result as JSON

<!-- END FORGELOOP GENERATED: cli:attestation-verify:options -->

- **Example**:

  ```bash
  forgeloop attestation-verify --task task-001 --json
  ```

### `attestation-status`

Reports local attestation status and trust level without network access.

- **Purpose**: Summarize the locally available manifest, statement, content, evidence, and signature state.
- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:attestation-status:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--json`: emit attestation status as JSON

<!-- END FORGELOOP GENERATED: cli:attestation-status:options -->

- **Example**:

  ```bash
  forgeloop attestation-status --task task-001 --json
  ```

### `attestation-verify-range`

Verifies attestation coverage for an opaque revision range through the
provider-neutral revision contract.

- **Purpose**: Detect uncovered changed paths, conflicting attestations, stale content, and required signature failures.
- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:attestation-verify-range:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--revision-provider <provider>`: revision provider (default: git)
- `--base <revision>`: opaque base revision
- `--head <revision>`: opaque head revision
- `--require-complete-coverage`: fail when any changed source path lacks a valid attestation
- `--require-signature`: require a valid external signature for covered attestations
- `--signing-provider <provider>`: signing provider (default: none)
- `--identity <identity>`: optional exact signer identity policy
- `--issuer <issuer>`: optional exact signer issuer policy
- `--trusted-root <path>`: trusted signing root path
- `--json`: emit range verification result as JSON

<!-- END FORGELOOP GENERATED: cli:attestation-verify-range:options -->

- **Example**:

  ```bash
  forgeloop attestation-verify-range --base base-ref --head head-ref --require-complete-coverage --json
  ```

## Durable Actions, Approvals, and Trajectory

ForgeLoop is still a protocol/evidence layer, not an agent runtime. Use
`COMMIT_UNKNOWN` as a hard stop: do not retry until an external observation is
recorded with `action-reconcile`. `run-action` has no shell mode and executes
only exact argv. Caller-reported and externally observed provenance are not host authority, and a project capability policy cannot mint host authority.

### `run-action`

<!-- BEGIN FORGELOOP GENERATED: cli:run-action:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--action <id>`: stable durable action ID
- `--capability <capability>`: canonical action capability
- `--effect-class <class>`: durable action effect class
- `--target <target>`: bounded external action target
- `--idempotency-key <key>`: immutable logical action idempotency key
- `--requirement <id>`: bound completion requirement
- `--required-for-completion`: mark the action as required for completion
- `--approval <id>`: current fingerprint-bound approval
- `--timeout-ms <number>`: maximum command duration before termination
- `-- <argv...>`: exact command argv; shell mode is never used
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:run-action:options -->

### `action-propose`

<!-- BEGIN FORGELOOP GENERATED: cli:action-propose:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--id <id>`: stable action ID
- `--capability <capability>`: canonical capability
- `--effect-class <class>`: effect class
- `--target <target>`: bounded action target
- `--operation <text>`: bounded operation description
- `--idempotency-key <key>`: logical action idempotency key
- `--requirement <id>`: bound requirement
- `--required-for-completion`: mark required for completion
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:action-propose:options -->

### `action-record`

<!-- BEGIN FORGELOOP GENERATED: cli:action-record:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--action <id>`: durable action ID
- `--state <state>`: next canonical action state
- `--provenance <value>`: CALLER_REPORTED or EXTERNAL_OBSERVED
- `--evidence-ref <ref>`: bounded external evidence reference
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:action-record:options -->

### `action-show`

<!-- BEGIN FORGELOOP GENERATED: cli:action-show:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--action <id>`: durable action ID
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:action-show:options -->

### `action-verify`

<!-- BEGIN FORGELOOP GENERATED: cli:action-verify:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--action <id>`: durable action ID
- `--evidence <ref>`: canonical execution or check reference proving the postcondition
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:action-verify:options -->

### `action-authorize`

<!-- BEGIN FORGELOOP GENERATED: cli:action-authorize:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--action <id>`: durable action ID
- `--approval <id>`: current fingerprint-bound approval
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:action-authorize:options -->

### `action-reconcile`

<!-- BEGIN FORGELOOP GENERATED: cli:action-reconcile:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--action <id>`: ambiguous durable action ID
- `--outcome <outcome>`: externally observed reconciliation outcome
- `--evidence-ref <ref>`: bounded external evidence reference (repeatable)
- `--observed-at <timestamp>`: external observation timestamp
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:action-reconcile:options -->

### `metrics`

<!-- BEGIN FORGELOOP GENERATED: cli:metrics:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--json`: emit trajectory metrics as JSON

<!-- END FORGELOOP GENERATED: cli:metrics:options -->

### `usage-record`

Records optional actor-reported usage telemetry for a task. This data is
informational and never satisfies verification or completion requirements.

<!-- BEGIN FORGELOOP GENERATED: cli:usage-record:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--provider <name>`: provider name reported by the actor
- `--model <name>`: model name reported by the actor
- `--input-tokens <number>`: provider-reported input token count
- `--output-tokens <number>`: provider-reported output token count
- `--cache-read-tokens <number>`: provider-reported cache-read token count
- `--cache-write-tokens <number>`: provider-reported cache-write token count
- `--total-tokens <number>`: provider-reported total token count; never estimated
- `--cost-usd <amount>`: provider-reported cost in USD; never estimated
- `--source <kind>`: usage source; CLI fallback accepts only ACTOR_REPORTED
- `--json`: emit usage telemetry as JSON

<!-- END FORGELOOP GENERATED: cli:usage-record:options -->

- **Example**:

  ```bash
  forgeloop usage-record --task task-001 --provider provider --model provider/model --input-tokens 10000 --output-tokens 2500 --source ACTOR_REPORTED --json
  ```

  The CLI fallback is always actor-reported. It never promotes the source to a
  provider or host observation and never satisfies verification evidence.

### `efficiency`

Projects timing and usage efficiency. Comparisons are reported only when the
project-local baseline metadata is compatible with the current task.

<!-- BEGIN FORGELOOP GENERATED: cli:efficiency:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--baseline <path>`: optional comparable efficiency baseline JSON
- `--json`: emit efficiency metrics as JSON

<!-- END FORGELOOP GENERATED: cli:efficiency:options -->

- **Example**:

  ```bash
  forgeloop efficiency --task task-001 --baseline benchmark-baseline.json --json
  ```

  A missing or metadata-incompatible baseline produces `NOT_COMPARABLE` and
  null comparison values; ForgeLoop does not estimate token or time overhead.

### `eval`

<!-- BEGIN FORGELOOP GENERATED: cli:eval:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--scenario <path>`: project-local trajectory scenario JSON
- `--json`: emit evaluation as JSON

<!-- END FORGELOOP GENERATED: cli:eval:options -->

### `approval-request`

<!-- BEGIN FORGELOOP GENERATED: cli:approval-request:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--approval <id>`: approval artifact ID
- `--action <id>`: bound action ID
- `--reason <text>`: bounded approval reason
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:approval-request:options -->

### `approval-resolve`

<!-- BEGIN FORGELOOP GENERATED: cli:approval-resolve:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--approval <id>`: approval artifact ID
- `--decision <decision>`: approval decision
- `--authority <kind>`: CALLER_ACKNOWLEDGED or HOST_ATTESTED
- `--host-grant-ref <ref>`: host boundary grant reference
- `--reason <text>`: bounded resolution reason
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:approval-resolve:options -->

### `protocol-info`

Reports the public compatibility handshake required by external ForgeLoop harnesses.

- **Purpose**: Publishes protocol/schema versioning, lifecycle metadata, command metadata, guide registry, and the documented error registry.
- **When to use**: Before a harness creates or resumes a ForgeLoop task, and when verifying compatibility without reading internal source.
- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:protocol-info:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--json`: emit complete machine-readable protocol metadata

<!-- END FORGELOOP GENERATED: cli:protocol-info:options -->

- **Example**:

  <!-- FORGELOOP EXAMPLE: cli-reference:protocol-info | exit=0 | json.commands.0.name=protocol-info -->
  ```bash
  forgeloop protocol-info --json
  ```
  <!-- END FORGELOOP EXAMPLE -->

### `init`

Initializes ForgeLoop in a target repository.

- **Purpose**: Installs canonical instruction templates under `.forgeloop/kit/`, creates discovery shims at root, and prepares `.forgeloop/`.
- **When to use**: Once when onboarding a new repository to ForgeLoop.
- **Mutation**: Writes `.forgeloop/kit/`, `.forgeloop/forgeloop.gitignore`, `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/project-loop.mdc`, `.github/copilot-instructions.md`.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:init:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--dry-run`: perform deterministic init planning and conflict detection without writing

<!-- END FORGELOOP GENERATED: cli:init:options -->

- **Example**:

  ```bash
  forgeloop init
  ```

### `doctor`

Inspects repository health, adapter synchronization, and template integrity.

- **Purpose**: Diagnose missing files, unmanaged adapters, profile issues, and broken kit references.
- **When to use**: After initialization, after git merges, or when troubleshooting.
- **Mutation**: Writes `.forgeloop/.manifest.json` only when `--fix` is passed; otherwise performs no mutation.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:doctor:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--json`: emit doctor findings as JSON
- `--strict`: treat warnings as unhealthy
- `--fix`: restore missing managed template files
- `--adopt <path>`: preserve an existing adapter in the manifest (repeatable)

<!-- END FORGELOOP GENERATED: cli:doctor:options -->

- **Example**:

  ```bash
  forgeloop doctor --json
  ```

### `update`

Updates the managed instruction kit to match the current ForgeLoop package version.

- **Purpose**: Safely updates `.forgeloop/kit/` while preserving project profile facts and local modifications.
- **When to use**: After upgrading `@cassiomc1/forgeloop` package version.
- **Mutation**: Updates `.forgeloop/kit/` and adapter shims.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:update:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--dry-run`: perform deterministic update planning and conflict detection without writing

<!-- END FORGELOOP GENERATED: cli:update:options -->

- **Example**:

  ```bash
  forgeloop update
  ```

---

## 2. Activation & Planning

### `route`

Calculates and persists deterministic engineering guide routing.

- **Purpose**: Selects relevant technical guides (e.g. `clean`, `test`, `security`, `design`) based on declared work attributes.
- **When to use**: During discovery before preflight.
- **Mutation**: Writes `.forgeloop/task-state/<taskKey>/routing-result.json`.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:route:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--work <type>`: declared work type
- `--surface <value>`: affected surface (repeatable)
- `--risk <value>`: task risk (repeatable)
- `--platform <value>`: affected platform (repeatable)
- `--behavior-change`: declare behavior change
- `--executable-change`: declare executable/configuration change
- `--execution-profile <profile>`: requested execution profile; safety floors always win
- `--json`: emit route result as JSON

<!-- END FORGELOOP GENERATED: cli:route:options -->

- **Example**:

  ```bash
  forgeloop route --work complete-website --surface ui --risk untrusted-input --json
  ```

  A requested profile is an override request, not a safety bypass:

  ```bash
  forgeloop route --task landing-page --work complete-website --surface ui --execution-profile light --json
  ```

### `preflight`

Validates pre-implementation readiness and establishes protocol readiness state.

- **Purpose**: Verifies that the contract, route, profile facts, and mandatory pre-implementation gates (e.g. `design`) are satisfied and consistent.
- **When to use**: Before starting implementation.
- **Mutation**: Persists `.forgeloop/task-state/<taskKey>/preflight.json` and, when the protocol is ready, may create or synchronize task-scoped resumable work state and lifecycle events.
- **Return Status**: `READY` or `BLOCKED`.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:preflight:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--strict`: require strict protocol compliance
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:preflight:options -->

- **Example**:

  ```bash
  forgeloop preflight --json
  ```

### `activate`

Creates a protocol/session activation marker for the current harness session.

- **Purpose**: Creates an activation marker containing `sessionId`, `activationMarker`, and `createdAt` for the current harness session. It does not create the canonical lifecycle work state.
- **When to use**: When starting a session after `preflight` is established.
- **Mutation**: Writes `.forgeloop/sessions/<sessionId>.json`.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:activate:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:activate:options -->

- **Example**:

  ```bash
  forgeloop activate --json
  ```

### `record-decision-criterion`

Records an append-only decision settlement criterion bound to the active contract fingerprint.

- **Purpose**: Records settlement guidance or criteria for open contract decisions without modifying contract schema.
- **When to use**: To attach settlement guidance to unresolved decisions in `current-contract.unresolvedDecisions[]`.
- **Mutation**: Appends `DECISION_CRITERION_RECORDED` to event ledger.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:record-decision-criterion:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--decision <text>`: unresolved decision text matching current contract
- `--settled-by <text>`: criteria or guidance that settles the decision
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:record-decision-criterion:options -->

- **Example**:

  ```bash
  forgeloop record-decision-criterion \
    --decision="Which authentication provider should be used?" \
    --settled-by="Use provider supporting current session token middleware"
  ```

### `advance`

Advances the protocol lifecycle phase.

- **Purpose**: Transitions the task along a valid edge of the canonical ForgeLoop work-state machine. The destination is validated against the current phase and the canonical lifecycle transition rules.
- **When to use**: To declare transitions between workflow stages.
- **Mutation**: Updates `.forgeloop/task-state/<taskKey>/work-state.json` and appends transition event to ledger.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:advance:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--to <phase>`: destination workflow phase
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:advance:options -->

- **Example**:

  ```bash
  forgeloop advance --to EXECUTING
  ```

### `next`

Computes the deterministic next action required by the protocol.

- **Purpose**: Tells the executing agent or harness exactly what action or command to perform next based on current state, evidence, and continuity.
- **When to use**: Continuously after each step, and upon starting any session.
- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:next:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--compact`: emit a bounded next-action projection
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:next:options -->

- **Examples**:

  ```bash
  forgeloop next --json

  # Explicit task selection prevents another concurrent task from
  # becoming the implicit source of lifecycle state
  forgeloop next --task <id> --json
  ```

---

## 3. Continuity & Handoff

### `continuity`

Reads current operational continuity context.

- **Purpose**: Retrieves the active focus, remaining items, known issues, and inspect-first notes recorded by the previous harness.
- **When to use**: When resuming an existing task.
- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:continuity:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:continuity:options -->

- **Example**:

  ```bash
  forgeloop continuity --json
  ```

### `record-continuity`

Records operational handoff context before pausing or switching tools.

- **Purpose**: Stores immediate work-in-progress notes to help the next harness continue without confusion.
- **When to use**: Before ending a session or transferring control.
- **Mutation**: Writes `.forgeloop/task-state/<taskKey>/continuity.json`.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:record-continuity:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--focus-id <id>`: current implementation focus ID
- `--focus-summary <text>`: current implementation focus summary
- `--remaining <id:summary>`: remaining implementation item (repeatable)
- `--known-issue <id:summary>`: known implementation issue (repeatable)
- `--changed-area <path>`: changed project area (repeatable)
- `--inspect-first <path>`: suggested inspection path (repeatable)
- `--resume-note <text>`: bounded operational resume note
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:record-continuity:options -->

- **Example**:

  ```bash
  forgeloop record-continuity \
    --focus-id auth-jwt \
    --focus-summary "Implement JWT refresh token rotation" \
    --remaining "tests:Add token expiration test" \
    --inspect-first src/auth/token.js \
    --resume-note "Access tokens are working; refresh token rotation is in progress."
  ```

### `reconcile-continuity`

Reconciles continuity with the active work state and checkout.

- **Purpose**: Compares continuity bindings against the canonical work state, contract, phase, repository fingerprint, and checkout state.
- **Lint**: Returns deterministic `PASS`/`WARN` findings for stale completed
  item references, role conflicts, missing `inspectFirst` paths, and empty hint
  sets without changing reconciliation classification.
- **When to use**: When starting a session in an active task.
- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:reconcile-continuity:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:reconcile-continuity:options -->

- **Example**:

  ```bash
  forgeloop reconcile-continuity --json
  ```

### `clear-continuity`

Clears operational continuity context while preserving canonical work state.

- **Purpose**: Removes stale or corrupt continuity handoff data when starting fresh from the last work-state checkpoint.
- **When to use**: When continuity is unrecoverably stale or no longer relevant.
- **Mutation**: Removes `.forgeloop/task-state/<taskKey>/continuity.json`.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:clear-continuity:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:clear-continuity:options -->

- **Example**:

  ```bash
  forgeloop clear-continuity
  ```

---

## 4. Verification

### `run-check`

Executes a verification command with ForgeLoop-attested provenance.

- **Purpose**: Runs an exact command, records the execution artifact in `.forgeloop/task-state/<taskKey>/executions/`, and binds the resulting observed check evidence to that execution through `executionRef`.
- **When to use**: During `VERIFYING` phase to execute test suites, linters, or validators.
- **Mutation**: Writes `.forgeloop/task-state/<taskKey>/executions/exec-*.json`, updates `.forgeloop/task-state/<taskKey>/execution-receipt.json`, appends to task ledger.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:run-check:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--id <id>`: stable check identifier
- `--requirement <id>`: completion requirement covered by the check
- `--details <json>`: additional structured check details
- `--timeout-ms <number>`: maximum command duration before termination
- `--scope-ref <path>`: current verification-scope.json to bind to execution evidence
- `-- <argv...>`: exact command argv to classify, execute, and attest
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:run-check:options -->

- **Example**:

  ```bash
  forgeloop run-check --id unit-tests --requirement "All unit tests pass" -- npm test
  ```

### `record-check`

Records an observed or manual verification check result without executing commands.

- **Purpose**: Records manual review evidence or external observations.
- **When to use**: For manual reviews, accessibility inspections, or external validations.
- **Mutation**: Updates `.forgeloop/task-state/<taskKey>/execution-receipt.json` and appends to task ledger.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:record-check:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--id <id>`: stable check identifier
- `--requirement <id>`: completion requirement covered by the check
- `--kind <kind>`: check kind (default: command; use manual-review for manual evidence)
- `--status <status>`: passed, failed, blocked, or not-run
- `--evidence-kind <kind>`: OBSERVED, INFERRED, NOT_VERIFIED, or BLOCKED
- `--command <text>`: recorded only as metadata; it is never executed
- `--result <text>`: observed result supplied by the actor
- `--exit-code <number>`: observed process exit code
- `--execution-ref <id>`: ForgeLoop execution artifact reference
- `--provenance <value>`: FORGELOOP_EXECUTED, ACTOR_REPORTED, or MANUAL_OBSERVATION
- `--details <json>`: additional structured check details
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:record-check:options -->

- **Example**:

  ```bash
  forgeloop record-check \
    --id manual-a11y-review \
    --requirement "WCAG AA contrast compliant" \
    --status passed \
    --kind manual-review \
    --evidence-kind OBSERVED \
    --result "Verified contrast ratios exceed 4.5:1 across all color schemes"
  ```

### `record-diagnosis`

Records an append-only diagnosis event in the lifecycle event ledger for the active cycle.

- **Purpose**: Records root-cause hypotheses, failure classes, and settlement criteria for failed verification checks.
- **When to use**: In `DIAGNOSING` phase before advancing to `CORRECTING`.
- **Mutation**: Appends `DIAGNOSIS_RECORDED` to event ledger and updates work state projection.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:record-diagnosis:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--file <path>`: structured diagnostic case JSON file (mutually exclusive with legacy diagnosis fields)
- `--hypothesis <text>`: specific root-cause hypothesis explaining the verification failure
- `--failure-class <class>`: canonical failure class taxonomy
- `--evidence-ref <check-id>`: reference to failed/blocked check from current cycle (repeatable)
- `--settled-by <text>`: falsification or settlement criteria for the hypothesis
- `--next-safe-action <text>`: smallest safe action to address the hypothesis
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:record-diagnosis:options -->

- **Example**:

  ```bash
  forgeloop record-diagnosis \
    --hypothesis="Off-by-one index calculation in slice function" \
    --failure-class="VERIFICATION_FAILURE" \
    --evidence-ref="unit-tests" \
    --settled-by="Test returns expected slice length" \
    --next-safe-action="Adjust offset +1 in slice.js"
  ```

### `record-intervention`

Records an append-only intervention bound to hypotheses; the described change is never executed by ForgeLoop.

- **Purpose**: Records corrective or experimental changes (code, config, tests, instrumentation) associated with one or more hypotheses.
- **When to use**: In `CORRECTING` phase after a structured diagnostic case has been recorded.
- **Mutation**: Appends `INTERVENTION_RECORDED` to event ledger.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:record-intervention:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--file <path>`: intervention JSON file describing the recorded change (never executed)
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:record-intervention:options -->

- **Example**:

  ```bash
  forgeloop record-intervention --task checkout --file intervention.json --json
  ```

### `record-hypothesis-disposition`

Records an evidence-bound hypothesis disposition update in the lifecycle event ledger.

- **Purpose**: Updates hypothesis status (SUPPORTED, WEAKENED, FALSIFIED, SUPERSEDED, UNRESOLVED) based on recorded evidence.
- **When to use**: After new verification evidence resolves an open hypothesis.
- **Mutation**: Appends `HYPOTHESIS_DISPOSITION_RECORDED` to event ledger.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:record-hypothesis-disposition:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--hypothesis <id>`: existing hypothesis ID to disposition
- `--status <status>`: SUPPORTED, WEAKENED, FALSIFIED, SUPERSEDED, or UNRESOLVED
- `--evidence-ref <check-id>`: check ID supporting this disposition (repeatable)
- `--reason <text>`: evidence-bound reason for the disposition
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:record-hypothesis-disposition:options -->

- **Example**:

  ```bash
  forgeloop record-hypothesis-disposition \
    --task checkout \
    --hypothesis h-timeout-latency \
    --status SUPPORTED \
    --evidence-ref checkout-tests \
    --reason "Instrumented dependency time exceeded the timeout." \
    --json
  ```

### `validate-state`

Validates `.forgeloop/task-state/<taskKey>/work-state.json` structure, hash chain, and repository binding.

- **Purpose**: Integrity check for work state.
- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:validate-state:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:validate-state:options -->

- **Example**:

  ```bash
  forgeloop validate-state --json
  ```

### `validate-receipt`

Validates `.forgeloop/task-state/<taskKey>/execution-receipt.json` schema and check references.

- **Purpose**: Integrity check for completion receipt.
- **Mutation**: Read-only.
- **Receipt Resolution**: Without `--file`, the receipt is resolved from the task context: an explicit `--task` (or `FORGELOOP_TASK`) selects that task's namespaced receipt, otherwise a single active task is resolved automatically. `--file` overrides task-based receipt resolution and validates exactly the given relative file.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:validate-receipt:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--file <path>`: receipt file relative to target (overrides task-based receipt resolution)
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:validate-receipt:options -->

- **Examples**:

  Validate the selected task's namespaced receipt:

  ```bash
  forgeloop validate-receipt --task task-001 --json
  ```

  Validate an explicit receipt file (`--file` overrides task-based receipt resolution):

  ```bash
  forgeloop validate-receipt --file .forgeloop/task-state/<taskKey>/execution-receipt.json --json
  ```

<!-- BEGIN FORGELOOP LEGACY LAYOUT EXAMPLE -->

When no task is selected and no task descriptors exist, the legacy singleton `.forgeloop/execution-receipt.json` compatibility path is validated.

<!-- END FORGELOOP LEGACY LAYOUT EXAMPLE -->

### `validate-protocol`

Performs comprehensive protocol validation across all active artifacts.

- **Purpose**: Validates contract, route, state, receipt, executions, and event ledger freshness and consistency.
- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:validate-protocol:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--contract-file <path>`: current JSON contract used for freshness comparison
- `--route-file <path>`: routing-result JSON relative to target
- `--state-file <path>`: work-state JSON relative to target
- `--receipt-file <path>`: execution-receipt JSON relative to target
- `--continuity-file <path>`: optional execution-continuity JSON relative to target
- `--task-brief-file <path>`: task brief JSON file (repeatable)
- `--delegated-result-file <path>`: delegated result JSON file (repeatable)
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:validate-protocol:options -->

- **Example**:

  ```bash
  forgeloop validate-protocol --json
  ```

### `progress`

Evaluates task progress across verification cycles and detects stalls deterministically.

- **Purpose**: Evaluates whether iterative correction cycles are advancing, on watch, or stalled.
- **When to use**: Any time during execution, verification, or diagnosis to inspect progress signals and prevent repeated ineffective retries.
- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:progress:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--json`: emit progress evaluation as JSON

<!-- END FORGELOOP GENERATED: cli:progress:options -->

- **Example**:

  ```bash
  forgeloop progress --json
  ```

---

## 5. Completion & Reporting

### `quality-baseline`

Captures the provider observation that becomes the task's structural-quality
baseline.

- **Purpose**: Persist an immutable, task-bound structural-quality baseline before execution.
- **When to use**: After a valid preflight checkpoint in `PLANNED`, before entering `EXECUTING`.
- **Mutation**: Executes the configured provider, writes `baseline.json`, and appends a quality-baseline ledger event.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:quality-baseline:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--replace`: replace a different baseline before EXECUTING
- `--timeout-ms <number>`: bounded analyzer timeout in milliseconds
- `--json`: emit baseline result as JSON

<!-- END FORGELOOP GENERATED: cli:quality-baseline:options -->

- **Example**:

  ```bash
  forgeloop quality-baseline --task task-001 --json
  ```

Use `--replace` only for an intentional pre-execution baseline replacement.
The superseded fingerprint remains in the append-only ledger. The command
does not accept an executable path, shell fragment, arbitrary arguments, score,
or baseline value.

### `quality-verify`

Scans the current project through the configured structural-quality provider and
compares it with the task baseline.

- **Purpose**: Record a current-cycle structural-quality evaluation and project it into the canonical `structural-quality` check.
- **When to use**: In `VERIFYING`, before `REVIEWING`.
- **Mutation**: Executes the configured provider, writes a typed evaluation, and records the bound check/evidence projection.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:quality-verify:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--timeout-ms <number>`: bounded analyzer timeout in milliseconds
- `--json`: emit structural-quality verification as JSON

<!-- END FORGELOOP GENERATED: cli:quality-verify:options -->

- **Example**:

  ```bash
  forgeloop quality-verify --task task-001 --json
  ```

`PASS`, `FAIL`, `BLOCKED`, and `NOT_OBSERVED` remain distinct. A failed,
unavailable, malformed, timed-out, truncated, stale, or incomparable provider
result cannot become a passing check.

### `quality-status`

Projects the persisted structural-quality evidence without launching a provider.

- **Purpose**: Inspect baseline, current-cycle status, policy comparison, and next guidance.
- **When to use**: At any point when a read-only quality projection is needed.
- **Mutation**: Read-only; it creates no provider process and writes no quality artifact.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:quality-status:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--json`: emit persisted structural-quality status as JSON

<!-- END FORGELOOP GENERATED: cli:quality-status:options -->

- **Example**:

  ```bash
  forgeloop quality-status --task task-001 --json
  ```

### `prepare-completion`

Initializes or refreshes `.forgeloop/task-state/<taskKey>/execution-receipt.json`.

- **Purpose**: Maps contract requirements to evidence coverage slots.
- **When to use**: Upon entering the `VERIFYING` phase before recording checks.
- **Mutation**: Writes `.forgeloop/task-state/<taskKey>/execution-receipt.json`.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:prepare-completion:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:prepare-completion:options -->

- **Example**:

  ```bash
  forgeloop prepare-completion --json
  ```

### `record-terminal-result`

Records external publication or production-readiness observations.

- **Purpose**: Records evidence for terminal requirements (e.g. git push, npm publish, staging deploy).
- **When to use**: When the contract contains explicit publication or production-readiness requirements.
- **Mutation**: Updates work state and receipt with terminal status.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:record-terminal-result:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--requirement <id>`: terminal requirement covered by the result
- `--type <type>`: PUBLICATION or PRODUCTION_READINESS
- `--status <status>`: observed terminal status
- `--source <text>`: external action source (e.g. npm publish, git push)
- `--result <text>`: observed external result description
- `--details <json>`: additional structured result details
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:record-terminal-result:options -->

- **Example**:

  ```bash
  forgeloop record-terminal-result \
    --requirement release-publish \
    --type PUBLICATION \
    --status published \
    --source "npm publish" \
    --result "v1.1.0 published to registry"
  ```

- **Terminal Statuses**: The `--status` value must be one of the canonical
  statuses for the declared `--type`:

  | `--type` | Allowed `--status` values |
  | --- | --- |
  | `PUBLICATION` | `committed`, `pushed`, `published`, `deployed` |
  | `PRODUCTION_READINESS` | `ready`, `blocked` |

### `audit`

Performs a read-only dry-run evaluation of completion readiness.

- **Purpose**: Checks if all requirements are covered, ledger is valid, and fingerprints are fresh without changing lifecycle phase.
- **When to use**: In `REVIEWING` phase before running `complete`.
- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:audit:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--strict`: require strict protocol compliance
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:audit:options -->

- **Example**:

  ```bash
  forgeloop audit --json
  ```

### `complete`

Validates protocol completion and transitions the task to `COMPLETE`.

- **Purpose**: Authoritative protocol validation of the entire task lifecycle.
- **When to use**: In `REVIEWING` phase when all checks have passed.
- **Mutation**: Updates `.forgeloop/task-state/<taskKey>/work-state.json` to `COMPLETE` and records completion event.
- **Return Status**: `VALID` or `REJECTED`.
- **Return Dimensions**: The evaluation result reports separate dimensions alongside the return status: `taskStatus` (`COMPLETE`/`INCOMPLETE`/`BLOCKED`), `verificationStatus` (`VALID`/`invalid`), `publicationStatus`, `productionReadiness`, and `errors[]` with the concrete rejection reasons.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:complete:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--strict`: require strict protocol compliance
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:complete:options -->

- **Example**:

  ```bash
  forgeloop complete --json
  ```

### `report`

Emits an independent multi-dimensional status report.

- **Purpose**: Reports task completion, publication status, and production readiness as independent dimensions.
- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:report:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--strict`: require strict protocol compliance
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:report:options -->

- **Example**:

  ```bash
  forgeloop report --json
  ```

### `bundle`

Exports a portable, self-contained task bundle.

- **Purpose**: Bundles contract, route, state, receipt, executions, and ledger for archiving or cross-environment migration.
- **Mutation**: Writes portable bundle under `.forgeloop/tasks/<taskId>`.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:bundle:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:bundle:options -->

- **Example**:

  ```bash
  forgeloop bundle --task task-001 --json
  ```

---

## 6. Inspection & Recovery

### `status`

Displays human-readable or structured summary of current task state.

- **Purpose**: Quick overview of task ID, phase, cycle, active guides, and completion status.
- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:status:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--contract-file <path>`: current JSON contract used for freshness comparison
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:status:options -->

- **Example**:

  ```bash
  forgeloop status --json
  ```

### `inspect`

Inspects checkout changes and compares them against contract deliverables. With `--task <id>`, human output renders a task inspection report (phase, cycle, ledger/snapshot health, progress, verification attempts, diagnostics, failure surface, signals, next command); `--json` keeps the full additive `taskInspection` section.

- **Purpose**: Shows modified files, untracked files, and deliverable coverage.
- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:inspect:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--contract-file <path>`: current JSON contract used for freshness comparison
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:inspect:options -->

- **Example**:

  ```bash
  forgeloop inspect --json
  ```

### `history`

Shows chronological protocol history reconstructed from canonical ForgeLoop state.

- **Purpose**: Answers "what happened during this task?" with deterministic, read-only reconstruction from the event ledger.
- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:history:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--type <list>`: comma-separated event types or categories to include
- `--phase <list>`: comma-separated lifecycle phases to include
- `--failures`: show only failed/blocked verification events
- `--checks`: show only verification events
- `--since <timestamp>`: include events at or after this timestamp
- `--until <timestamp>`: include events at or before this timestamp
- `--limit <number>`: show only the last N events after filtering
- `--compact`: one line per event
- `--verbose`: show full event data
- `--json`: emit structured history output as JSON

<!-- END FORGELOOP GENERATED: cli:history:options -->

- **Example**:

  ```bash
  forgeloop history --task auth-feature --json
  ```

### `trace`

Emits detailed structured task trace with provenance and artifact relationships.

- **Purpose**: Machine-readable protocol reconstruction consumed by history, reflect, task-level inspect, and external integrations.
- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:trace:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--json`: emit structured trace output as JSON (default rendering is a summary)

<!-- END FORGELOOP GENERATED: cli:trace:options -->

- **Example**:

  ```bash
  forgeloop trace --task auth-feature --json
  ```

### `reflect`

Analyzes diagnostic and correction history deterministically for information gain, repeated failures, ineffective interventions, and oscillation.

- **Purpose**: Whole-task retrospective that reports whether the run actually learned anything, without calling an LLM.
- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:reflect:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--json`: emit structured reflection output as JSON

<!-- END FORGELOOP GENERATED: cli:reflect:options -->

- **Example**:

  ```bash
  forgeloop reflect --task auth-feature --json
  ```

### `policy`

Evaluates compliance against a named policy pack.

- **Purpose**: Checks repository conformity against organizational or protocol policy packs.
- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:policy:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `<name>`: policy pack name
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:policy:options -->

- **Example**:

  ```bash
  forgeloop policy default --json
  ```

### `policy-discover`

Discovers architectural patterns, project conventions, and candidate verification rules deterministically.

- **Purpose**: Runs non-interactive repository inspection to derive policy rules with confidence scores.
- **Mutation**: Read-only by default; writes `.forgeloop/policy/discovery.json` and regenerates `.forgeloop/policy/policy.lock` only with `--write`. Without `--write`, discovery is observational and persists nothing.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:policy-discover:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--write`: persist discovered policy to .forgeloop/policy/discovery.json
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:policy-discover:options -->

- **Examples**:

  Read-only discovery (observational, persists nothing):

  ```bash
  forgeloop policy-discover --json
  ```

  Persist discovery and regenerate the policy lock:

  ```bash
  forgeloop policy-discover --write --json
  ```

### `policy-status`

Reports effective executable policy verification status, baselines, lock integrity, and drift.

- **Purpose**: Evaluates all rules, verifies `policy.lock` integrity, identifies inert checks, baselined debt, unbaselined violations, and drift against the task snapshot.
- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:policy-status:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:policy-status:options -->

- **Examples**:

  ```bash
  forgeloop policy-status --json

  # Evaluate drift against a specific task snapshot
  forgeloop policy-status --task <id> --json
  ```

### `policy-diff`

Semantically diffs policy rules and classifies changes as tightening, neutral, or weakening.

- **Purpose**: Compares proposed or current policy against a base or task snapshot.
- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:policy-diff:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--before <path>`: path to before policy JSON
- `--after <path>`: path to after policy JSON
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:policy-diff:options -->

- **Examples**:

  ```bash
  # Diff the current effective policy against the task snapshot
  forgeloop policy-diff --task <id> --json

  # Diff two explicit policy JSON files
  forgeloop policy-diff --before .forgeloop/policy/before.json --after .forgeloop/policy/after.json --json
  ```

### `rule-verify`

Runs mutation verification on policy rules to prove checkers actively detect invalid states.

- **Purpose**: Validates that rule checkers fail on mutant fixtures, generating proof digests.
- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:rule-verify:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--rule <id>`: verify a specific policy rule ID
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:rule-verify:options -->

- **Example**:

  ```bash
  forgeloop rule-verify --rule SECURITY.NO_HARDCODED_SECRET --json
  ```

### `baseline`

Manages the brownfield policy baseline and monotonic ratchet-down.

- **Purpose**: Records current violations into baseline, or ratchets baseline downward as debt is fixed.
- **Mutation**: Writes `.forgeloop/policy/baseline.json` and regenerates `.forgeloop/policy/policy.lock`.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:baseline:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--record`: record current violations as brownfield baseline
- `--update`: ratchet baseline downward by removing resolved violations
- `--policy-reset-authorized`: explicit operator authority to re-record baseline during active tasks
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:baseline:options -->

- **Examples**:

  ```bash
  # Adopt pre-existing violations as brownfield debt
  forgeloop baseline --record --json

  # Remove resolved debt (monotonic; additions are rejected)
  forgeloop baseline --update --json

  # Explicit operator authority to re-record during an active task
  forgeloop baseline --record --policy-reset-authorized --json
  ```

During an active task bound to a policy snapshot, `--record` without
`--policy-reset-authorized` fails with `E_BASELINE_RECORD_DURING_ACTIVE_TASK`;
`--update` is monotonic and fails with `E_BASELINE_EXPANSION` if it would add
debt.

### `profile-interview`

Optional operator-facing interview guidance (never invoked autonomously by agent).

- **Purpose**: Returns optional discovery/interview guidance to help an operator inspect or refine project assumptions. It does not write `PROJECT_PROFILE.md` automatically.
- **When to use**: Optional; never required for normal autonomous execution.
- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:profile-interview:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--dry-run`: show planned interview questions without changing files
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:profile-interview:options -->

- **Example**:

  ```bash
  forgeloop profile-interview
  ```

### `clear-state`

Clears canonical work-state checkpoint for the current task.

- **Purpose**: Emergency reset of local work-state checkpoint.
- **When to use**: Only when abandoning a task or resetting state after an unrecoverable corruption.
- **Mutation**: Removes `.forgeloop/task-state/<taskKey>/work-state.json` only. Sibling ForgeLoop artifacts (such as contracts, routes, gates, and ledger history) are preserved.
- **Safety Note**: This is not a full `.forgeloop/` reset command.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:clear-state:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:clear-state:options -->

- **Example**:

  ```bash
  forgeloop clear-state
  ```

---

### `reconcile-closure`

Reconciles the checkpoint of an EXECUTING task whose objective is already satisfied in the current repository.

- **Purpose**: Refresh the work-state repository fingerprint of a stale EXECUTING task after repository movement, using executed contract-bound evidence that the objective is present, so the canonical completion pipeline can close it.
- **When to use**: When a task is stuck in EXECUTING with `E_REPOSITORY_CHANGED` / `E_STATE_REVALIDATION_REQUIRED` and its objective was already satisfied by other changes in the current repository.
- **Mutation**: Appends a `CHECKPOINT_RECONCILED` ledger event (previous/current repository fingerprints plus evidence) and refreshes the work-state repository fingerprint. Phase stays EXECUTING; claims release only through canonical `COMPLETE`.
- **Safety Note**: Refuses non-EXECUTING tasks, fresh checkpoints, contract or artifact drift, invalid ledgers, unknown requirements, and failing evidence.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:reconcile-closure:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--id <id>`: contract verification item id used as evidence
- `--requirement <id>`: exact contract verification item requirement text
- `--details <json>`: additional structured execution details
- `-- <argv...>`: exact command argv to execute as objective-satisfaction evidence
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:reconcile-closure:options -->

- **Example**:

  ```bash
  forgeloop reconcile-closure --task <id> --id regression-tests \
    --requirement "pack tarball test asserts the README image is excluded from the npm package" \
    -- node --test tests/package.test.js
  ```

---

## 7. Multi-Task Management

### `task-create`

Initializes a new isolated task namespace with write claims and contract.

- **Purpose**: Creates `.forgeloop/task-state/<taskKey>/task.json` descriptor.
- **Mutation**: Writes task descriptor.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:task-create:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--claim <path>`: scoped file path or directory prefix claimed for mutation (repeatable)
- `--contract-file <path>`: path to initial contract file
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:task-create:options -->

- **Example**:

  ```bash
  forgeloop task-create --task task-001 --claim src/auth --json
  ```

  With an explicit initial contract file:

  ```bash
  forgeloop task-create --task task-001 --claim src/auth --claim tests/auth --contract-file task-contract.json --json
  ```

  `--contract-file` points to a contract JSON that is validated and copied into the task namespace.

### `task-list`

Lists all tasks discovered in `.forgeloop/task-state/`.

- **Purpose**: Discovers tasks, their keys, phases, write claims, and lock status.
- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:task-list:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:task-list:options -->

- **Example**:

  ```bash
  forgeloop task-list --json
  ```

### `task-show`

Displays details of a specific task by ID or storage key.

- **Purpose**: Inspects task descriptor, write claims, active lock, and lifecycle state.
- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:task-show:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--compact`: emit a bounded task-status projection
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:task-show:options -->

- **Example**:

  ```bash
  forgeloop task-show --task task-001 --json
  ```

### `task-lock-status`

Reports the lock owner and lease-based staleness classification for a specific task without mutating it.

- **Mutation**: Read-only.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:task-lock-status:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:task-lock-status:options -->

- **Example**:

  ```bash
  forgeloop task-lock-status --task task-001 --json
  ```

### `task-scope`

Updates or inspects write claims for a task.

- **Purpose**: Modifies write claims before execution starts.
- **Mutation**: Updates `task.json`.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:task-scope:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--claim <path>`: scoped file path or directory prefix claimed for mutation (repeatable)
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:task-scope:options -->

- **Example**:

  ```bash
  forgeloop task-scope --task task-001 --claim src/auth --claim tests/auth --json
  ```

### `task-migrate`

Migrates a legacy 1.0 single-task `.forgeloop/` layout into a namespaced task directory.

- **Purpose**: Converts root `.forgeloop/` artifacts into `.forgeloop/task-state/<taskKey>/`.
- **Mutation**: Moves task artifacts into task state subfolder.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:task-migrate:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--dry-run`: show planned migration actions without moving files
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:task-migrate:options -->

- **Example**:

  ```bash
  forgeloop task-migrate --json
  ```

### `migrate-protocol`

Plans or applies an explicitly supported persisted-state migration to a target
protocol version.

- **Purpose**: Provides a fail-closed compatibility migration surface. In the
  current release, target protocol `1` either needs no change or converts a
  detected legacy singleton layout through the verified `task-migrate` flow.
- **When to use**: Before upgrading persisted ForgeLoop state when a release
  documents a new protocol migration. Run the dry-run first and retain the
  resulting migration receipt after applying a legacy conversion.
- **Mutation**: Does not write with `--dry-run`. A supported legacy conversion
  writes the namespaced task state and its `migration-receipt.json` before
  removing legacy artifacts.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:migrate-protocol:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--to <protocolVersion>`: target supported protocol version
- `--dry-run`: show migration actions without writing or deleting artifacts
- `--json`: emit structured migration result as JSON

<!-- END FORGELOOP GENERATED: cli:migrate-protocol:options -->

- **Example**:

  ```bash
  forgeloop migrate-protocol --to 1 --dry-run --json
  ```

### `task-unlock`

Forces the release of a task lock or CAS-safely releases an unchanged stale lease.

- **Purpose**: Removes `.forgeloop/locks/<taskKey>.lock` when its owner is no longer valid. Prefer `--stale-only`; `--force` is an explicit unconditional maintenance action.
- **Mutation**: Deletes task lock file.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:task-unlock:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--force`: force release of an orphaned task lock
- `--stale-only`: release only a lock whose lease is expired
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:task-unlock:options -->

- **Example**:

  ```bash
  forgeloop task-unlock --task task-001 --force --json
  ```

### `task-recover`

Suspends mutation and releases effective claims for a task deterministically classified `STALE` or `ABANDONED`.

- **Purpose**: For a task classified only `STALE` or `ABANDONED`, persists `recovery.json` plus a linked append-only event without changing work state or fabricating completion. The canonical claim-state resolver must validate both before claims become effective-empty. `RECOVERABLE` tasks must use `reconcile-closure`.
- **Mutation**: Transactionally writes recovery state and appends the recovery event. Historical descriptor claims and all lifecycle evidence remain intact; ordinary mutations return `E_TASK_RECOVERED`.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:task-recover:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--acknowledge-recovery`: acknowledge release of claims for a STALE or ABANDONED task (required; not host attestation)
- `--operator-authorized`: deprecated alias for --acknowledge-recovery; does not attest operator authority
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:task-recover:options -->

- **Example**:

  ```bash
  forgeloop task-recover --task task-001 --acknowledge-recovery --json
  ```

`--acknowledge-recovery` is caller acknowledgement only. The deprecated
`--operator-authorized` alias has the same semantics and is not host attestation.
Fake, missing, corrupt, or mismatched recovery state is
`E_TASK_CLAIM_OWNERSHIP_INCONSISTENT`/`E_TASK_RECOVERY_INCONSISTENT`; historical
claims remain reserved.

### `task-resume`

Reacquires a recovered task's write claims and restores ordinary mutation authority.

- **Purpose**: Validates active recovery ownership, CAS-settles only an unchanged stale task lease, reuses normal claim-overlap and clean-checkout enforcement under project/task serialization, then removes `recovery.json` transactionally.
- **Mutation**: Optionally updates historical claims in `task.json`, appends `TASK_RECOVERY_RESUMED`, and removes `recovery.json` in one transaction.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:task-resume:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--claim <path>`: write claim to reacquire (defaults to all released claims) (repeatable)
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:task-resume:options -->

- **Example**:

  ```bash
  forgeloop task-resume --task task-001 --claim src --claim tests --json
  ```

With no `--claim`, the command attempts to reacquire all claims recorded in the
active recovery artifact. It returns `E_TASK_SCOPE_CONFLICT` without removing
recovery state when another active task owns an overlapping path.
The resume event counts as meaningful task activity. Never create, edit, or
delete `recovery.json` manually to emulate this command.

### `task-repair-legacy-recovery`

Migrates one recognized legacy recovery boundary event into the modern durable recovery representation.

- **Purpose**: Proves that a historical `OPERATOR_RECOVERY_RECORDED` without `recoveryId` marks the effective task boundary and materializes its modern representation as an append-only `LEGACY_RECOVERY_MIGRATION_RECORDED` event plus a transactional `recovery.json`. The original legacy event is never modified.
- **Mutation**: Appends the migration event at the ledger tail and writes `recovery.json` in one transaction under project claims locking.
- **Options**:

<!-- BEGIN FORGELOOP GENERATED: cli:task-repair-legacy-recovery:options -->

- `--path <directory>`: target project directory (default: current directory)
- `--task <id>`: task ID to operate on (when omitted, resolved from context or single active task)
- `--acknowledge-recovery`: fresh explicit acknowledgement of the legacy boundary migration (required)
- `--json`: emit structured output as JSON

<!-- END FORGELOOP GENERATED: cli:task-repair-legacy-recovery:options -->

- **Example**:

  ```bash
  forgeloop task-repair-legacy-recovery --task task-001 --acknowledge-recovery --json
  ```

Only the exact known legacy signature is eligible; ambiguous, tampered, or
post-boundary-active ledgers fail closed with
`E_LEGACY_RECOVERY_MIGRATION_INVALID` and ownership stays INCONSISTENT. A
`STALE` task lease is settled only through CAS-safe stale release when the
observed lock is unchanged; `LIVE` locks refuse with `E_TASK_LOCKED`, and
`UNKNOWN`/`CORRUPT` locks fail closed with the lock preserved — never delete a
lock file manually to unblock this command. The repair is idempotent: an
already repaired task returns `{repaired: 0, alreadyRepaired: true}` only when
the whole canonical recovery relationship validates; any mismatch fails closed.
The repair itself never releases claims directly; ownership becomes validated
recovery state and ordinary mutation remains blocked until `task-resume`.

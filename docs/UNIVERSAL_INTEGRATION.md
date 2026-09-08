# Universal ForgeLoop Integration

ForgeLoop applies to any agent, harness, IDE, or orchestration runtime — with
or without MCP. The universal rule:

> If the active host exposes an official ForgeLoop structured integration,
> prefer it for protocol operations. Otherwise use the project-local ForgeLoop
> CLI. Never manually synthesize ForgeLoop-managed lifecycle, claim, recovery,
> ledger, or completion state because an integration is unavailable.

## The programmatic integration API

`@cassiomc1/forgeloop/integration` (integration API version 1) is the
transport-neutral entrypoint:

```js
import {
  executeForgeLoopCommand,
  validateForgeLoopCommandInput,
  getForgeLoopCapabilities,
  classifyForgeLoopInvocation,
  readForgeLoopIntegrationResource,
} from "@cassiomc1/forgeloop/integration";
```

- `executeForgeLoopCommand({command, projectPath, input})` returns a
  deterministic envelope: `{ok, command, exitCode, result, error, metadata}`.
  Domain rejections (preflight BLOCKED, audit INVALID) keep `ok:true` with a
  non-zero exit code; `ok:false` means the command could not be executed and
  preserves the canonical public error code.
- Ownership values always come from `resolveTaskClaimState()` through the
  `task/ownership` resource — never derived from raw artifacts.
- Invocation risk classes (READ_ONLY, LOOP_MUTATION, CLAIM_REACQUISITION,
  EXTERNAL_EXECUTION, MAINTENANCE, CLAIM_RELEASE_RECOVERY, LEGACY_MIGRATION,
  FORCE_DESTRUCTIVE) describe what an invocation would do; launch policy
  decides what is allowed.

### Profile-aware context

The resolved execution profile is available from the persisted route and from
compact `next`/`task-show` projections. `complianceMode` remains the policy
enforcement dimension; `executionProfile` is the independent process/context
depth dimension.

The API's read-only `task/context` resource provides the canonical host
projection for this decision. It includes the objective, deliverables,
constraints, selected guide IDs, current phase, next action, verification
requirements, resolved profile, and bounded optional-context policy. The MCP
adapter exposes the same projection at
`forgeloop://task/{taskId}/context`.

For `light`, an adapter should send only the current objective, deliverables,
hard constraints, resolved profile, selected guide IDs or relevant guide
sections, current phase, exact next action, and verification requirements. It
should reuse unchanged state locally instead of repeatedly sending full
ledgers, schemas, receipts, or protocol documents. This is presentation
optimization only: required gates, verification truth, authority, provenance,
and validated completion remain unchanged. A lifecycle fast path is not part
of protocol v1.

Optional reflection, trajectory evaluation, handoff, responsibility,
attestation, benchmark, and continuity artifacts are lazy and should be
created only when policy, an explicit request, or recovery requires them.

The profile never authorizes a lifecycle-phase or required-gate skip. A phase
may be absent only when the canonical protocol marks it not applicable;
presentation depth cannot change evidence, verification truth, authority,
provenance, safety-floor, or validator-backed completion requirements.

### Repository Search boundary

The Integration API exposes direct, transport-neutral repository operations:

```js
import {
  repositorySearch,
  repositoryIndexStatus,
} from "@cassiomc1/forgeloop/integration";

const result = await repositorySearch({
  projectPath: ".",
  pattern: "needle",
  fixedStrings: true,
});

const status = await repositoryIndexStatus({ projectPath: "." });
```

These operations call the canonical Repository Search service and require the
managed Repository Index for supported Git repositories. The shell-facing CLI
`search` command may use the user-scoped persistent local IPC host described in
[`PERSISTENT_SEARCH_TRANSPORT.md`](./PERSISTENT_SEARCH_TRANSPORT.md), but that
host is only a CLI startup/reuse optimization. Integration API and MCP callers
do not use it, and no transport carries lifecycle, claims, receipts, evidence,
or completion authority.

See [`REPOSITORY_INDEX.md`](./REPOSITORY_INDEX.md) for the normalized search
contract, tgrep management, status resource, and maintenance commands.

### Usage and efficiency boundary

Create a context with an optional trusted provider:

```js
const context = createForgeLoopContext({
  usageProvider: {
    async getTaskUsage({ projectPath, taskId }) {
      return hostUsageStore.lookup({ projectPath, taskId });
    },
  },
});
```

The provider returns `PROVIDER_REPORTED` or `HOST_REPORTED` snapshots. The CLI
fallback is explicitly `ACTOR_REPORTED`; missing fields remain `null` and no
token or cost estimate is produced. Usage never satisfies a check or
completion requirement. Use `efficiency --task --baseline <project-local-json>`
only for metadata-compatible comparisons; otherwise the result is
`NOT_COMPARABLE`.

For measured execution-profile comparisons, use the reproducible benchmark
commands in [`EXECUTION_PROFILE_BENCHMARKS.md`](./EXECUTION_PROFILE_BENCHMARKS.md).
The benchmark source policy accepts provider or host observations only and
keeps unavailable or non-comparable measurements out of efficiency claims.

### Advisory Context & Handoff Acceptance

Capability negotiation is feature-first: `canonicalHandoffs` is v2 and
`advisoryContextProviders` is v1. These capability-family versions are
independent of Protocol v1, schema v1, and Integration API v1. The programmatic
integration API exposes lazy advisory context querying and exactly-once handoff
acceptance:

```javascript
import {
  createForgeLoopContext,
  recallAdvisoryContext,
  acceptCanonicalHandoff,
  resolveHandoffAcceptance,
} from "@cassiomc1/forgeloop/integration";

// 1. Register host-provided advisory context
const runtimeContext = createForgeLoopContext({
  advisoryContextProviders: {
    "host-memory": {
      id: "host-memory",
      recall: async ({ query }) => ({ items: [...] }),
    },
  },
});

// 2. Explicitly query advisory context (strictly non-evidence, non-executable)
const advisoryResult = await recallAdvisoryContext({
  target: ".",
  taskId: "task-1",
  providerName: "host-memory",
  query: "authentication tokens",
  runtimeContext,
});

// 3. Exactly-once handoff acceptance
const acceptance = await acceptCanonicalHandoff(".", {
  taskId: "task-1",
  handoffId: "handoff-001",
  consumerId: "agent-session-42",
  harness: "cursor",
});
```

See [`ADVISORY_CONTEXT.md`](./ADVISORY_CONTEXT.md) for full trust boundary specifications, portable text sanitization rules, and budget enforcement.

Advisory recall budgets are normalized before provider dispatch: valid oversized
integer requests are clamped, while invalid finite/integer/minimum types fail
with `E_ADVISORY_CONTEXT_REQUEST_INVALID` before provider lookup. The registry
key and resolved provider `id` must match. Handoff acceptance independently
checks canonical state and the current repository branch/HEAD, and remains an
exactly-once operational receipt with no evidence, claim transfer, or authority.

Advisory context is not a canonical resource unless a future explicitly
versioned resource introduces one. `protocol-info` advertises the optional
provider capability, but the stock CLI never recalls it automatically and
there is no stock `context-recall` command. A consumer that only understands
`canonicalHandoffs` v1 may disable only the handoff-specific UI while retaining
the rest of Protocol v1 functionality.

## Consumers

| Surface | Entry |
| --- | --- |
| ForgeLoop CLI | human terminal rendering over the same executors |
| ForgeLoop MCP | `@cassiomc1/forgeloop-mcp`: stdio (default/recommended) plus optional strict-modern loopback-only HTTP; see [MCP.md](./MCP.md) |
| Studio / IDE / CI adapters | the same integration subpath |

All consumers share one protocol authority: `.forgeloop/` state written only
by canonical ForgeLoop commands, so cross-harness continuity and recovery work
identically regardless of transport.

Optional integrations use the same ownership boundary. ForgeLoop derives and
validates workspace bindings, immutable handoffs, responsibility constraints,
verification scopes, execution evidence, code manifests, attestation
statements, and provider results. The embedding host owns checkout selection,
model/tool execution, scheduling, transport, external signer credentials, and
platform presentation. A handoff or continuity note never becomes evidence;
`CHANGED`/`CLAIMED` verification scope never becomes revision-range coverage;
and only a validated external signature can raise `VERIFIED` to `ATTESTED`.
These extensions are optional and do not change the zero-configuration basic
loop.

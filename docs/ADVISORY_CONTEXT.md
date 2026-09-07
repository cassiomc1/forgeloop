# Advisory Context & External Provider Boundary

## Overview

ForgeLoop treats external advisory context as **optional, host-injected, lazy,
and strictly advisory**.

The core invariant of the protocol is:

```
MEMORY != STATE
MEMORY != EVIDENCE
MEMORY != AUTHORITY
MEMORY != COMPLETION
MEMORY != NEXT ACTION
```

ForgeLoop contains **no built-in vector database, SQLite engine, or full-text search (FTS)** dependencies. Memory systems belong to hosts, IDEs, orchestrators, and harnesses. ForgeLoop provides the hardened runtime contract, trust boundary, portable text sanitization, and allowlist normalization.

## Architectural Boundaries

1. **Non-Authoritative (`ADVISORY`)**: Advisory memory can provide context or suggestions to an agent, but cannot dictate lifecycle state, phase transitions, or next actions.
2. **Non-Evidence (`evidenceAuthority: "NONE"`)**: Stored memories or suggestions cannot satisfy verification requirements, pass gates, or serve as execution receipts.
3. **Non-Executable (`actionability: "NON_EXECUTABLE"`)**: Output items cannot be executed directly as protocol commands.
4. **Ephemeral & Unpersisted (`persisted: false`)**: ForgeLoop never persists external recall results to `.forgeloop/` state or the event ledger.
5. **Lazy Provider Evaluation**: ForgeLoop runtime commands (`next`, `status`, `preflight`, `complete`, `task-show`, etc.) never invoke advisory memory providers. Recall occurs only when a host explicitly invokes the integration recall service.

## Registering Providers

Hosts configure providers through the runtime context:

```javascript
import { createForgeLoopContext } from "@cassiomc1/forgeloop/integration";

const runtimeContext = createForgeLoopContext({
  advisoryContextProviders: {
    "my-memory": {
      id: "my-memory",
      version: "1.0.0",
      async recall({ projectPath, taskId, query, limit, maxItemChars, maxTotalChars, timeoutMs }) {
        // Query host vector database, knowledge base, or memory cache
        return {
          items: [
            {
              title: "Previous Architecture Decision",
              summary: "Decided to use rotating refresh tokens with 15-minute expiry.",
              sourceRef: "docs/decisions/auth-tokens.md",
              confidence: 0.95,
            },
          ],
        };
      },
    },
  },
});
```

Provider IDs must match `^[a-z0-9][a-z0-9_-]*$`. Providers may be plain objects or async factory functions. The registry key and the resolved provider `id` must match exactly; a factory that resolves to another identity fails with `E_ADVISORY_CONTEXT_PROVIDER_INVALID` before `recall` is called.

## Querying Advisory Context

Hosts explicitly invoke `recallAdvisoryContext`:

```javascript
import { recallAdvisoryContext } from "@cassiomc1/forgeloop/integration";

const result = await recallAdvisoryContext({
  target: "/path/to/project",
  taskId: "auth-impl-42",
  providerName: "my-memory",
  query: "token refresh strategy",
  limit: 5,
  runtimeContext,
});
```

### Result Schema

Every returned result is normalized, frozen, and stamped with immutable trust metadata:

```json
{
  "provider": {
    "id": "my-memory",
    "version": "1.0.0"
  },
  "taskId": "auth-impl-42",
  "authority": "ADVISORY",
  "evidenceAuthority": "NONE",
  "actionability": "NON_EXECUTABLE",
  "trustRole": "NON_EVIDENCE_ADVISORY_CONTEXT",
  "persisted": false,
  "items": [
    {
      "title": "Previous Architecture Decision",
      "summary": "Decided to use rotating refresh tokens with 15-minute expiry.",
      "sourceRef": "docs/decisions/auth-tokens.md",
      "confidence": 0.95,
      "itemFingerprint": "4a7d...3b1f"
    }
  ]
}
```

## Normalization & Authority Stripping

ForgeLoop checks the raw result shape and item count, then selects bounded items and projects only allowlisted fields before portable safety inspection. Unknown raw fields—including secret-like or cyclic metadata—are discarded and are never copied or logged. A secret in a selected field still fails closed.

Any raw fields returned by a provider that attempt to assert protocol authority are completely stripped during normalization:

- `nextAction`, `command`, `phase`
- `evidence`, `approval`, `authority`
- `writeClaims`, `changedPaths`, `checkIds`

Only allowlisted fields (`title`, `summary`, `sourceRef`, `observedAt`, `confidence`) survive. Each item receives a deterministic SHA-256 `itemFingerprint`.

## Portable Safety Boundary

All text flowing into or out of advisory recall is verified:

- **Control Character Rejection**: ASCII control characters (`\x00-\x08`, `\x0B-\x0C`, `\x0E-\x1F`, `\x7F`) throw `E_PORTABLE_CONTEXT_INVALID`.
- **Secret Scanning**: Inputs and outputs containing secret tokens (e.g., `Bearer <token>`, `ghp_`, AWS keys, private keys) throw `E_PORTABLE_CONTEXT_INVALID`.
- **Budget Enforcements**:

  - Max query characters: 1,000 chars (`E_ADVISORY_CONTEXT_QUERY_INVALID`)
  - Max item summary: 4,000 chars (`E_ADVISORY_CONTEXT_OUTPUT_LIMIT`)
  - Default item limit: 6 items (max 20)
  - Default total characters: 6,000 chars (max 16,000) (`E_ADVISORY_CONTEXT_OUTPUT_LIMIT`)
  - Raw provider result ceiling: 100 items (`E_ADVISORY_CONTEXT_OUTPUT_LIMIT`)
  - Default timeout: 5,000 ms, max 30,000 ms (`E_ADVISORY_CONTEXT_TIMEOUT`)

ForgeLoop normalizes recall limits before provider dispatch. Valid oversized
integer requests are clamped to the canonical maxima, and non-finite,
non-integer, below-minimum, string, boolean, object, or null values fail before
provider lookup with `E_ADVISORY_CONTEXT_REQUEST_INVALID`. Providers therefore
never receive caller-requested budgets above ForgeLoop's supported maxima.

## Replay safety and failure handling

Advisory recall is an explicit host operation. ForgeLoop does not record a
provider query, provider response, or item fingerprint in the task event ledger,
and a later recall is never treated as proof that an earlier response was
current. Hosts should re-query when context is needed and must independently
validate any proposed action or lifecycle step against canonical state.

Provider failures remain advisory failures and do not block the canonical loop.
The public boundary reports these stable codes:

| Code | Meaning |
| --- | --- |
| `E_ADVISORY_CONTEXT_PROVIDER_INVALID` | Provider identity or recall contract is invalid. |
| `E_ADVISORY_CONTEXT_PROVIDER_UNAVAILABLE` | The requested provider is not registered in the runtime context. |
| `E_ADVISORY_CONTEXT_QUERY_INVALID` | The query is empty, unsafe, or exceeds the query budget. |
| `E_ADVISORY_CONTEXT_REQUEST_INVALID` | A recall budget has an invalid type, range, or numeric value. |
| `E_ADVISORY_CONTEXT_RESULT_INVALID` | The provider returned an invalid result shape. |
| `E_ADVISORY_CONTEXT_TIMEOUT` | Provider recall exceeded the bounded timeout. |
| `E_ADVISORY_CONTEXT_OUTPUT_LIMIT` | The raw or normalized provider output exceeded a bounded limit. |
| `E_PORTABLE_CONTEXT_INVALID` | Portable text contains unsafe controls, secrets, or unsupported content. |

## What ForgeLoop Never Does Automatically

- It does not look up a provider on startup.
- It does not look up a provider for `status`, `next`, `preflight`, `complete`,
  `task-show`, or the read-only `task/context` resource.
- It does not persist provider results, queries, or provider metadata in
  `.forgeloop/` or the event ledger.
- It does not turn provider text into a command, lifecycle transition, check,
  evidence record, approval, claim, or next action.
- It does not infer provider trust from a package version, a source path, or a
  host label. The provider identity contract is resolved at the Integration
  API boundary and remains descriptive rather than authenticated authority.

The host owns whether and when to display or use advisory context. ForgeLoop
owns only the bounded normalization and trust-role projection.

## Ripwire adapter

ForgeLoop includes an optional host-injected adapter for the [Ripwire](https://github.com/redhat-et/ripwire)
ranked source map. The adapter is deliberately outside the default runtime:
the host must provide an absolute executable path and an exact expected
version, register the returned provider under the `ripwire` key, and invoke
`recallAdvisoryContext` explicitly. Creating the provider performs no discovery,
network access, process start, or lifecycle write.

The adapter runs Ripwire's qualified `--for=<query> --signatures-only --json
--no-cache --exclude=.forgeloop` form with `shell: false`, closes standard
input, bounds stdout to 1 MiB and stderr to 64 KiB, and applies the caller's
existing advisory deadline. It validates the version immediately before the
query, rejects malformed JSON and unsafe paths, and never copies raw stderr
into an error message. Ripwire's graph is approximate, so the first returned
item is a bounded status card that preserves cap, omission, ambiguity,
unindexed-content, and unknown-completeness warnings after core normalization.

See [RIPWIRE_ADAPTER.md](RIPWIRE_ADAPTER.md) for registration, tests, the
opt-in real-binary smoke test, and the retrieval benchmark. A real binary and
its exact version must be qualified by the host; ForgeLoop does not install or
discover Ripwire and does not treat an unavailable smoke test as proof of
interoperability.

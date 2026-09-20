# Audit UX read model

`task/audit-view` is a bounded, read-only Integration API resource for audit
and operator interfaces. It composes canonical ForgeLoop projections; it does
not become a second lifecycle, evidence, ownership, or completion authority.

```js
import { readForgeLoopIntegrationResource } from "@cassiomc1/forgeloop/integration";

const view = await readForgeLoopIntegrationResource("task/audit-view", {
  taskId: "task-1",
  limit: 50,
  categories: ["LIFECYCLE", "CHECK", "DIAGNOSTIC"],
});
```

The projection includes lifecycle and health; a deterministic sequence-backed
timeline with explicit `null` timestamps when the ledger has no authoritative
timestamp; bounded checks, attempts, diagnostics, approvals, durable-action
summaries, recovery history, completion status, and canonical ownership; and
integrity and reason-code summaries that remain fail-closed when source
projections are inconsistent.

Timeline pagination accepts `limit`, `beforeSequence`, `afterSequence`, and a
bounded category allowlist. Without a cursor, the latest bounded page is
returned. `beforeSequence` performs backward pagination and returns the
nearest earlier matching events; its `nextBeforeSequence` cursor is the first
returned sequence when another page exists. `afterSequence` performs forward
pagination and returns the earliest later matching events; its
`nextAfterSequence` cursor is the last returned sequence when another page
exists. Pages never skip matching sequence numbers within the filtered event
stream, and combining the two cursors is rejected.

The projection redacts general POSIX, Windows, UNC, and local `file://`
absolute paths; environment assignments; common credential assignments;
authorization and cookie headers; and URL userinfo credentials. It does not
return raw event payloads, commands, or provider output. These are presentation
boundary redactions, not a replacement for secret-handling controls at the
source. The resource never invokes a provider, executes a command, writes an
artifact, changes lifecycle state, or releases claims.

`auditUx` is advertised during capability discovery with version `1` and
`readOnly: true`. Hosts must use the canonical CLI/API lifecycle commands for
all mutations and must treat this view as presentation and diagnostic context
only.

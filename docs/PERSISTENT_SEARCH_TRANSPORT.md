# Persistent Search Transport

ForgeLoop's persistent search transport is a local optimization for the CLI
`search` command. It keeps one ForgeLoop-owned search host available between
CLI invocations and sends bounded requests over local IPC. It does not create a
second search implementation, replace the Repository Index, or change the
protocol lifecycle and evidence authority.

The public Repository Index contract, managed tgrep policy, search result
shape, and index maintenance commands are documented in
[`REPOSITORY_INDEX.md`](./REPOSITORY_INDEX.md). This document explains the
transport boundary and its operational behavior.

## Architecture and boundaries

The runtime has one canonical search service and two access paths:

```text
CLI `search` only
    -> Persistent Search Client
    -> local IPC
    -> Persistent ForgeLoop Host
    -> canonical `searchRepository()` service
    -> Repository Index
    -> ForgeLoop-managed tgrep 1.0.3

Integration API `repositorySearch()` --------------------┐
MCP `forgeloop_search` -----------------------------------┘
    -> canonical `searchRepository()` service
    -> Repository Index
    -> ForgeLoop-managed tgrep 1.0.3

Lifecycle, claims, verification, receipts, evidence, and completion
    -> remain separate ForgeLoop protocol state and authority
```

Only the shell-facing CLI search path uses the persistent host. The
Integration API and MCP adapter call the canonical search service directly;
they do not route through the persistent host. The host also does not read or
write task claims, receipts, ledgers, or completion state.

The persistent host is an optimization layer, not a public protocol authority:

- Repository Index readiness remains mandatory for supported Git repositories.
- The managed tgrep engine remains the only runtime search backend; there is no
  silent `rg`, `grep`, or arbitrary-`PATH` fallback.
- Search output remains normalized by the canonical service and uses project-
  relative paths.
- Derived index files and host state are cache/coordination data, not evidence.
- A fresh CLI invocation still pays Node.js and module startup cost. The
  persistent path removes repeated host startup and keeps subsequent requests
  local; it does not promise a universal latency improvement.

Implementation sources are [`client.js`](../src/persistent-transport/client.js),
[`server.js`](../src/persistent-transport/server.js),
[`lifecycle.js`](../src/persistent-transport/lifecycle.js), and the canonical
[`search.js`](../src/repository-index/search.js).

## Transport protocol

The transport currently uses protocol version `1` and state schema version `1`.
Its supported methods are deliberately small:

| Method | Purpose | Access rule |
| --- | --- | --- |
| `handshake` | Prove protocol, package, scope, and host ownership identity | First request on every connection |
| `repository.search` | Dispatch one bounded normalized Repository Search request | Requires a successful handshake |
| `transport.status` | Return the host's ready/version projection | Requires a successful handshake |
| `transport.shutdown` | Ask the verified host to shut down | Requires a successful handshake and matching nonce |

Requests and responses are JSON encoded in UTF-8 and carried in a
length-prefixed frame. The length is a four-byte unsigned big-endian value;
the JSON payload is bounded before it is parsed or written.

The defaults are defined in
[`constants.js`](../src/persistent-transport/constants.js):

| Limit | Default |
| --- | ---: |
| Host startup timeout | 15 seconds |
| Search request timeout | 120 seconds |
| Idle shutdown | 10 minutes |
| Maximum request frame | 1 MiB |
| Maximum response frame | 16 MiB |
| Maximum search pattern | 4,096 characters |

The request projection accepts only the canonical search fields: pattern,
globs, types, context, before/after context, max count, files-with-matches,
stats, fixed strings, ignore case, smart case, and word regexp. Internal
transport fields, executable arguments, arbitrary binaries, and machine-local
path options are not forwarded as public query fields. See
[`protocol.js`](../src/persistent-transport/protocol.js) for the allowlist and
validation rules.

## Host lifecycle

### Startup and reuse

When the CLI search path needs a host, the client:

1. acquires a user-scoped startup coordination lock;
2. reads and validates the existing host state, if present;
3. reuses the host only after ownership, endpoint, protocol, package version,
   and handshake checks succeed;
4. otherwise removes only verified stale or incompatible transport state;
5. starts the packaged ForgeLoop host with a shell-free Node.js child process;
6. waits for a bounded successful handshake before dispatching the search.

Concurrent callers coordinate startup and requests for the same repository are
serialized by the host. Requests for different repositories may be served by
the same user-scoped host without sharing repository result data.

There is no separate public `persistent-host-start` command. The host starts
on demand for CLI `search`, and it can be observed through the sanitized
`persistentTransport` projection returned by `forgeloop doctor --json`.

### Recovery

The client permits at most one bounded connection/startup recovery attempt for
a search request. Recoverable transport failures include an unavailable host,
timeout, protocol mismatch, or invalid response when the failure is at the
transport boundary. A remote Repository Index or query error is returned to the
caller and is not hidden by transport recovery.

If state is stale, the verified host has exited, or the endpoint cannot prove
the expected identity, the client repairs transport coordination state only
within its user-scoped transport boundary. It does not delete project
`.forgeloop` state, rebuild an index implicitly beyond the canonical search
service's existing readiness behavior, or alter lifecycle artifacts.

### Idle shutdown

After ten minutes without active connections or in-flight requests, the host
shuts down. Idle shutdown removes the host's coordination state and POSIX
endpoint; it does not stop the Repository Index watcher or delete the derived
repository index. A later CLI search starts or reuses the host again.

Explicit shutdown is sent through the verified endpoint. If ownership cannot be
proved, ForgeLoop fails closed rather than killing a process by PID or name.

## Platform transport

On POSIX systems the host listens on a user-scoped Unix-domain socket in the
local temporary namespace. On Windows it listens on a user-scoped named pipe.
The authoritative state and startup lock are kept in the user's ForgeLoop
persistent-search directory. The exact endpoint, home directory, process
entrypoint, and lock paths are internal machine-local details; normal status,
doctor, search results, and MCP projections do not expose them.

The host is launched with:

- the current ForgeLoop package entrypoint and package version;
- a user-scoped home/environment binding;
- detached, ignored stdio;
- `shell: false` and direct argument arrays;
- a generated nonce and scope identity recorded in host state.

The Windows implementation uses the same protocol, bounds, handshake, nonce,
and ownership model as POSIX. Native transport coverage is exercised by the
platform-specific test suite and the Windows CI matrix; local non-Windows
validation cannot substitute for a Windows run.

## Ownership and safety

The state file is only a coordination hint. Before reuse, shutdown, or stale
cleanup, ForgeLoop validates the state schema and checks the endpoint and live
process identity. Depending on platform and available process inspection, the
ownership proof uses an endpoint handshake or a process command-line identity
that includes the expected host entrypoint, persistent-server marker, and
scope.

The handshake binds these values:

- transport protocol version;
- ForgeLoop package version;
- user scope identity;
- host process ID;
- generated host nonce.

Shutdown requires the same nonce. A PID by itself is never enough. Invalid
state, endpoint substitution, a mismatched version, an unverified process, or
an unexpected endpoint produces a stable transport error and fails closed.

Relevant error codes are exported by
[`errors.js`](../src/persistent-transport/errors.js) and include:

| Code | Meaning |
| --- | --- |
| `E_PERSISTENT_TRANSPORT_UNAVAILABLE` | The expected local host or connection is unavailable |
| `E_PERSISTENT_TRANSPORT_TIMEOUT` | A bounded connect, handshake, or request wait expired |
| `E_PERSISTENT_TRANSPORT_START_FAILED` | Startup coordination or host readiness exceeded its bound |
| `E_PERSISTENT_TRANSPORT_PROTOCOL_MISMATCH` | Client and host protocol/package identity is incompatible |
| `E_PERSISTENT_TRANSPORT_OWNERSHIP_UNVERIFIED` | State or endpoint identity cannot be proven |
| `E_PERSISTENT_TRANSPORT_FRAME_INVALID` | A frame is truncated or not valid JSON |
| `E_PERSISTENT_TRANSPORT_FRAME_TOO_LARGE` | A request or response exceeds its frame bound |
| `E_PERSISTENT_TRANSPORT_INVALID_REQUEST` | Method, request ID, parameters, or handshake order is invalid |
| `E_PERSISTENT_TRANSPORT_INVALID_RESPONSE` | The response shape or response ID is invalid |
| `E_PERSISTENT_TRANSPORT_HOST_STALE` | A stale host condition is detected at the transport boundary |

The full public error inventory remains generated in
[`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md).

## Privacy and public projections

Repository content is searched locally. The persistent host does not persist
query history, matches, repository content, task evidence, or lifecycle
receipts. Search results are returned to the requesting local caller and are
normalized by the Repository Index service.

Public status projections are intentionally smaller than internal state. A
normal `forgeloop doctor --json` or integration status result may report the
transport schema, status, running/owned booleans, protocol version, and
ForgeLoop version, but not endpoint, state, lock, repository-root, index, or
binary paths. The same rule applies to the MCP resource
`forgeloop://repository/index-status` and `forgeloop_search` results.

This is local process isolation and path minimization, not cryptographic
authentication against a privileged process running as the same user. A
privileged same-user process can still observe or deny local IPC. The ownership
checks are designed to prevent accidental PID reuse, stale-state cleanup, and
endpoint substitution from being treated as trusted ForgeLoop host activity.
See [`THREAT_MODEL.md`](../THREAT_MODEL.md) and
[`SECURITY.md`](../SECURITY.md) for the broader security boundary.

## Integration API and MCP

The public Integration API remains direct and transport-neutral:

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

The MCP adapter maps `forgeloop_search` and
`forgeloop://repository/index-status` to those canonical services. MCP does
not connect to, start, stop, or inspect the persistent CLI host. This keeps
MCP session metadata, transport choice, and host presentation separate from
Repository Index and lifecycle authority. See
[`UNIVERSAL_INTEGRATION.md`](./UNIVERSAL_INTEGRATION.md) and
[`MCP.md`](./MCP.md).

## Operational diagnosis

Use the public Repository Index commands when search is unhealthy:

```bash
forgeloop index-status --json
forgeloop doctor --json
forgeloop search "pattern" --json
```

For an absent or incomplete managed engine, use the explicitly authorized
maintenance flow described in [`REPOSITORY_INDEX.md`](./REPOSITORY_INDEX.md):

```bash
forgeloop index-setup --asset <pinned-asset-archive>
forgeloop index-start --json
forgeloop index-rebuild --json
```

Do not delete the whole `.forgeloop` directory, manually edit host state, or
stop a process by executable name. If the persistent host is unavailable, a
subsequent CLI search will perform its bounded on-demand recovery. If the
canonical search service reports an index, engine, request, or native-output
error, follow the Repository Index troubleshooting procedure; transport
recovery does not authorize an alternate backend.

## Release and compatibility

The 1.11.0 release candidate documents this transport while preserving
protocol v1, schema v1, and Integration API v1. The package version, registry
publication, Git tag, GitHub Release, deployment, and merge are separate
external lifecycle events. Local tests or a successful PR do not prove that
the package has been published.

The package release boundary ships the transport runtime and this reference,
but not user-specific state, sockets, named pipes, native release binaries, or
derived repository indexes. The release checklist is
[`RELEASE_CHECKLIST.md`](./RELEASE_CHECKLIST.md).

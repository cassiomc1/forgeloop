# ForgeLoop MCP

Local **stdio** Model Context Protocol server exposing the canonical ForgeLoop
programmatic integration API (`@cassiomc1/forgeloop/integration`).

`@cassiomc1/forgeloop-mcp` is a separately published adapter with its own
`0.1.x` version line. It supports ForgeLoop core versions `>=1.5.0 <2`; the
compatibility range is tested by the package smoke flow. The package has no
committed lockfile by deliberate policy: its dependency ranges follow the
published MCP SDK and ForgeLoop core compatibility contract, while release
verification installs from a clean temporary project and checks the packed
package. Reproducible release inputs are the package manifest, the lockfile of
the ForgeLoop core repository, immutable workflow action pins, and the exact
packed tarballs.

ForgeLoop MCP is an **adapter over ForgeLoop, never another implementation of
ForgeLoop**: every tool call executes a canonical ForgeLoop command through the
transport-neutral runtime, and every ownership value comes from the canonical
claim resolver. The server never reads or writes `.forgeloop` state directly.

## Usage

```bash
forgeloop-mcp --project /repo --mode safe
```

### Modes

| Mode | Read tools | Loop mutations | task-resume | External execution | Maintenance | Recovery | Legacy repair | Force |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `readonly` | yes | no | no | no | no | no | no | no |
| `safe` (default) | yes | yes | yes | no | no | no | no | no |
| `full` | yes | yes | yes | opt-in | opt-in | opt-in | opt-in | opt-in |

Higher-risk capabilities require both the launch flag and (for recovery) the
canonical command-level acknowledgement:

```text
--allow-external-execution   run-check, reconcile-closure (exact argv only)
--allow-maintenance          init/update/migrations/clear-state/doctor/baseline/task-unlock
--allow-recovery             task-recover (plus --acknowledge-recovery in tool input)
--allow-legacy-repair        task-repair-legacy-recovery (hidden by default)
--allow-force-recovery       task-unlock --force
```

Tool input can never upgrade launch policy. `acknowledgeRecovery: true` in tool
input is not an authorization grant. There is no generic shell tool.

The read-only resource `forgeloop://task/{taskId}/context` exposes the
canonical profile-aware host projection. It lets a client choose targeted,
standard, or expanded presentation context while preserving lifecycle phases,
required gates, verification truth, authority, provenance, safety floors, and
validator-backed completion.

### Repository search

The adapter exposes the canonical read-only `forgeloop_search` tool and the
`forgeloop://repository/index-status` resource. Both use ForgeLoop's direct
Integration API and normalized Repository Index contract. They do not connect
to or start the CLI's persistent search host, accept raw tgrep arguments, or
provide a no-index fallback. Repository Index health and search results remain
operational data, never lifecycle evidence or completion authority. See the
core [`Repository Index`](../../docs/REPOSITORY_INDEX.md) and
[`Persistent Search Transport`](../../docs/PERSISTENT_SEARCH_TRANSPORT.md)
references for the shared boundary.

## Security model

- Project root is pinned at startup (realpath + frozen); never a tool input.
- Task-aware mutation tools require an explicit `taskId`.
- Tool/resource catalogs are deterministic; project state never changes them.
- stdout carries only the MCP protocol; diagnostics go to stderr.
- Public ForgeLoop error codes are preserved verbatim.

## Transports

- **stdio** (default, recommended): `forgeloop-mcp --project /repo --mode safe`.
- **HTTP** (optional): `forgeloop-mcp-http` serves the strict modern stateless
  MCP 2026 model. Loopback-only — non-loopback binds fail closed with
  `E_MCP_REMOTE_NOT_SUPPORTED` until an authenticated remote design exists.

## Test setup and release

The root `npm run mcp:test` command never installs dependencies. On a clean
checkout without the MCP package dependencies it prints one actionable
prerequisite:

```text
MCP dependencies are not installed.
Run: npm run mcp:setup
```

Run `npm run mcp:setup` explicitly when installation is authorized, then use
`npm run mcp:test`. `npm run mcp:pack:check` performs the clean packed-package
smoke test used before publishing this adapter. Publication is separate from
core ForgeLoop publication and requires its own authorized release workflow.

# ForgeLoop Repository Index

## Overview

ForgeLoop includes a mandatory, local Repository Index for repeatable
repository-wide textual discovery. The public contract is provider-neutral:
the CLI, Integration API, and MCP adapter all use the same normalized search
service. The initial implementation is a ForgeLoop-managed Microsoft `tgrep`
1.0.3 engine.

Repository Search is an engineering aid. It locates source text quickly and
keeps up with working-tree changes, but it is not a task ledger, a dependency
graph, verification evidence, completion authority, or historical source of
truth.

## Why Repository Index exists

Repeated full-tree scans are noisy and can be expensive on larger projects.
The index keeps a derived local cache and a live watcher so harnesses and
developers can search through one stable ForgeLoop boundary. Consumers do not
need to install or discover a host `grep`, `rg`, or `tgrep` executable.

ForgeLoop does not promise a universal speedup. Correctness, current-working-
tree visibility, bounded resource use, and deterministic failure are the
acceptance criteria. Benchmark results are workload- and platform-specific.

## Mandatory status

For an actual Git repository, `init`, `doctor`, and `update` treat the
Repository Index as required operational readiness. A missing or unhealthy
engine is reported as unhealthy; it is never silently replaced by `rg`,
`grep`, or an unpinned `tgrep` on `PATH`.

The first setup may download a pinned release asset. Air-gapped environments
can preload the exact release archive with `--asset`; the archive is still
checked against the manifest SHA-256 value. A non-Git target can be used for
protocol fixtures and reports an explicit `DEFERRED` result from lifecycle
commands because there is no repository to index.

Index health does not alter task ownership, historical completion, contracts,
receipts, evidence, guides, or verification scope. A task that was previously
validated `COMPLETE` remains historically complete even if the current index
server is down.

## Architecture

```text
CLI / Integration API / MCP
            |
            v
  provider-neutral search service
            |
            v
  managed tgrep executable and server
       |                    |
       v                    v
  opaque project cache   working-tree watcher
  .forgeloop/.../tgrep   current file mutations
```

The user-level binary cache and project-level index are separate:

```text
~/.forgeloop/engines/tgrep/1.0.3/<platform>/tgrep
<repo>/.forgeloop/repository-index/tgrep/
<repo>/.forgeloop/repository-index/engine-state.json
```

The native index files are opaque derived cache data. ForgeLoop communicates
with `tgrep` through its CLI and server behavior; it does not read or depend
on `index.bin`, `lookup.bin`, `files.bin`, or other native file formats.

## Managed engine

The checked-in
[`tgrep-manifest.json`](../src/repository-index/tgrep-manifest.json) is the
distribution source of truth. It pins the upstream repository, semantic
version, release asset name, archive type, binary name, archive SHA-256
checksum, and extracted executable SHA-256 checksum. Managed installation
verifies the executable digest before it ever runs `tgrep --version`; a digest
mismatch is reported and explicit setup/repair safely replaces the quarantined
binary. The development override remains version-checked but is deliberately
non-canonical and is not covered by the release binary digest.
The manifest currently contains verified assets for:

| ForgeLoop key | Native platform | Archive |
| --- | --- | --- |
| `darwin-arm64` | macOS Apple Silicon | `tar.gz` |
| `darwin-x64` | macOS Intel | `tar.gz` |
| `linux-x64` | Linux Intel/AMD64 | `tar.gz` |
| `windows-x64` | Windows Intel/AMD64 | `zip` |

Unsupported platform/architecture combinations fail with
`E_REPOSITORY_INDEX_PLATFORM_UNSUPPORTED`; they never fall through to another
binary. Verify the manifest locally with:

```bash
npm run repository-index:manifest
```

The normal runtime never asks GitHub for `latest` and never searches `PATH`.
`FORGELOOP_TGREP_BINARY` is an explicit development/test override. It must be
an absolute path and still reports the pinned `tgrep 1.0.3` version. An
override is marked `managed: false` and is not a production provisioning
mechanism.

## Initial setup

Inside a supported Git repository:

```bash
forgeloop init
forgeloop doctor
forgeloop index-status --json
```

`init` performs the existing ForgeLoop kit and policy initialization, then
provisions the managed engine when needed, explicitly builds the index, starts
the ForgeLoop-owned watcher, and verifies readiness. A valid binary and index
are reused on a second `init`; no duplicate server is started.

For explicit repair or a preloaded archive:

```bash
forgeloop index-setup
forgeloop index-setup --asset /absolute/path/tgrep-v1.0.3-release.tar.gz
```

The archive filename may differ from the manifest asset name, but its bytes
must match the archive and executable checksums for the current platform. Setup
downloads or reads into a temporary directory, validates the archive, rejects
unsafe entries, verifies the extracted executable digest before version
execution, and installs atomically.

## Search CLI

The standard discovery command is:

```bash
forgeloop search "ExecutionReceipt"
forgeloop search "validateCompletion" --glob "*.js"
forgeloop search "receipt" --type js --context 3
forgeloop search "E_RECEIPT_PATH_MISMATCH" --files-with-matches
```

Supported first-release options are `--fixed-strings`, `--ignore-case`,
`--smart-case`, `--word`/`--word-regexp`, repeatable `--glob` and `--type`,
`--context`, `--before-context`, `--after-context`, `--max-count`,
`--files-with-matches`, `--stats`, and `--json`. Native flags are not exposed
through a generic pass-through option, and the normal API does not expose
`--no-index` or `--no-ignore`.

Default output is generated from normalized results:

```text
src/core/completion.js:42:7: return validateCompletion(result);
```

JSON output is provider-neutral and uses project-relative paths:

```bash
forgeloop search "ExecutionReceipt" --json
```

```json
{
  "schemaVersion": 1,
  "query": {
    "pattern": "ExecutionReceipt",
    "globs": [],
    "types": [],
    "fixedStrings": false,
    "ignoreCase": false,
    "smartCase": false,
    "wordRegexp": false,
    "filesWithMatches": false,
    "stats": false
  },
  "repositoryIndex": {
    "engine": "tgrep",
    "engineVersion": "1.0.3",
    "indexed": true,
    "server": true
  },
  "matches": [
    {
      "path": "src/core/completion.js",
      "line": 42,
      "column": 7,
      "text": "return validateCompletion(result);",
      "submatches": []
    }
  ],
  "metrics": {
    "queryDurationMs": 12,
    "nativeDurationMs": 4,
    "matchCount": 1,
    "matchedFileCount": 1,
    "engine": "tgrep",
    "engineVersion": "1.0.3",
    "serverUsed": true,
    "exitCode": 0
  }
}
```

ForgeLoop returns CLI exit code `0` for a completed query, including zero
matches, and `2` for a ForgeLoop/search error. The `metrics.exitCode` field
preserves the observed native result (`0` for matches or `1` for no matches)
for diagnostics. A native exit code `2` is always a structured search error.

Structured search output intentionally omits `repositoryRoot`, `indexPath`,
`statePath`, `binaryPath`, and other machine-local paths. Match and file paths
are repository-relative. The same sanitized projection is used by the CLI,
Integration API, and MCP adapter; `doctor` remains the explicit diagnostic
surface for local troubleshooting details.

The first search in a process performs strong setup and readiness checks.
Subsequent searches use a per-repository process-local readiness record and a
cheap PID liveness check, without repeating native version/status commands or
process command-line inspection. A healthy cache is invalidated when the
manifest version, selected binary, index boundary, or server liveness no
longer matches. If a query observes a server/index execution failure, ForgeLoop
performs one bounded setup-and-retry cycle. Native exit code `1` remains a
successful zero-match result and is never treated as a recovery failure.

Search patterns, paths, and filters are passed as direct argument-array values
with `shell: false`. Shell syntax is not evaluated. Request limits are:

| Input | Limit |
| --- | --- |
| Pattern | 1 to 4096 characters |
| Glob/type filters | At most 32 values of at most 256 characters each |
| Context values | Safe non-negative integers |
| `max-count` | A positive integer when supplied |

## Status and lifecycle commands

All lifecycle commands support `--json`.

### `index-status`

```bash
forgeloop index-status
forgeloop index-status --json
```

This command is read-only. It does not repair a stale server or download an
engine. The normalized status includes `health`, pinned engine information,
effective resource policy, index metadata, and owned-server state. Structured
status omits machine-local repository, index, state, and binary paths;
diagnostics may expose local paths only through the explicit `doctor`
diagnostic surface. Health is one of `READY`, `INDEXING`,
`NOT_INITIALIZED`, `ENGINE_MISSING`, `ENGINE_INVALID`, `SERVER_DOWN`,
`SERVER_UNHEALTHY`, or `ERROR`. Only `READY` satisfies mandatory readiness.

### `index-start`

```bash
forgeloop index-start --json
```

Starts a server only after a complete index exists. A matching healthy server
is reused. ForgeLoop writes `engine-state.json` and validates the server's
repository root, index path, binary, server metadata, process liveness, and
command line.

### `index-stop`

```bash
forgeloop index-stop --json
```

Stops only a server whose ownership is proven for the current repository. PID
presence is not ownership. ForgeLoop never uses `pkill`, `killall`, or an
executable-name-wide termination.

### `index-rebuild`

```bash
forgeloop index-rebuild --json
```

This is an explicit derived-cache operation. It stops the ForgeLoop-owned
server, removes only `.forgeloop/repository-index/tgrep/`, rebuilds with the
canonical flags, restarts the watcher, and verifies readiness. Task state,
contracts, receipts, evidence, profiles, guides, and other `.forgeloop`
artifacts are outside its deletion boundary.

## Integration API

The stable entrypoint is
`@cassiomc1/forgeloop/integration`. The named operation `repository/search`
uses the same `searchRepository()` service as the CLI:

```js
import { repositorySearch, repositoryIndexStatus } from "@cassiomc1/forgeloop/integration";

const result = await repositorySearch({
  projectPath: "/absolute/project",
  pattern: "ExecutionReceipt",
  globs: ["*.js"],
  context: 2,
});

const status = await repositoryIndexStatus({ projectPath: "/absolute/project" });
```

The public types are `RepositorySearchRequest`, `RepositorySearchMatch`,
`RepositorySearchResult`, and `RepositoryIndexStatus`. They do not expose
child-process objects, native JSON-RPC packets, or binary index internals.
Integrations must not supply arbitrary native command arguments.

The generic command envelope also supports `executeForgeLoopCommand({ command:
"search", projectPath, input: { pattern } })`; it has the same validation,
error, and provenance semantics as the CLI executor.

## MCP usage

The optional MCP adapter derives the `forgeloop_search` tool from the canonical
command registry, so it calls ForgeLoop's search service rather than spawning
its own process. It exposes normalized structured output and preserves
ForgeLoop error codes. The read-only status resource is:

```text
forgeloop://repository/index-status
```

MCP clients must not create a second index configuration or pass raw tgrep
arguments. In safe/default mode, repository search is read-only and available;
maintenance commands such as setup, start, stop, and rebuild remain launch-
capability gated. See [`docs/MCP.md`](./MCP.md) for transport and capability
policy.

## Resource controls

The initial canonical policy is intentionally small and explicit:

| Setting | Default |
| --- | --- |
| Maximum indexed/searchable file size | `64M` |
| Initial indexing CPU budget | `50%` of logical cores |
| Watcher queue capacity | `16384` events |
| Automatic mutation-save threshold | `5000` mutations |

The index command and server share the file-size and traversal boundary. The
server's own bounded memory behavior is retained for its initial build; the
ForgeLoop wrapper does not add a second scheduler. Effective values are
reported in `index-status`.

## Ignored files

Normal indexing respects repository ignore rules and follows the pinned
engine's default hidden-file behavior. ForgeLoop also explicitly excludes
`.forgeloop/repository-index` so the cache cannot index its own writes. Tracked
source files and normal unignored files remain searchable; ignored generated
files are not part of the default result set.

Search is not a complete dependency analysis. A search result must not be used
to narrow Differential Verification Scope or to claim that unreturned files
are unaffected. Direct file reading remains authoritative when a verification
requirement concerns a large or ignored file.

## File-size policy

The pinned engine's default maximum searchable file size is made explicit as
`64M`. Files over that limit may be absent from both the index and search
results. ForgeLoop does not claim that Repository Search covers every byte of
the repository. A known large-file verification must use an existing direct
verification mechanism rather than treating a no-match result as proof of
absence.

## Offline installation

An already provisioned, version-verified managed binary works offline. A
missing binary requires either network access to the pinned GitHub release
asset or an explicit local archive:

```bash
forgeloop index-setup --asset /absolute/path/tgrep-v1.0.3-x86_64-unknown-linux-musl.tar.gz
```

The preloaded archive path must be absolute and regular. ForgeLoop validates
the exact platform archive and executable checksums, rejects archive path
traversal and symbolic-link entries, extracts only to a temporary directory,
verifies the executable digest before `tgrep --version`, and performs an
atomic install. A failed or partial download is removed and does not become a
trusted engine.

## Troubleshooting

Start with read-only status:

```bash
forgeloop index-status --json
forgeloop doctor --json
```

Then use the narrowest repair:

```bash
forgeloop index-start --json
forgeloop index-setup --asset /absolute/path/to/pinned-asset.tar.gz --json
forgeloop index-rebuild --json
```

Stable Repository Index errors include:

| Code | Meaning | First response |
| --- | --- | --- |
| `E_REPOSITORY_INDEX_PLATFORM_UNSUPPORTED` | No pinned asset exists for the host pair | Use a supported platform or an explicitly supported release build |
| `E_REPOSITORY_INDEX_ENGINE_MISSING` | Managed/override binary is absent or not a regular executable | Run `index-setup` or provide `FORGELOOP_TGREP_BINARY` for development |
| `E_REPOSITORY_INDEX_ENGINE_DOWNLOAD_FAILED` | Pinned asset could not be safely downloaded/read | Check network or use `--asset` |
| `E_REPOSITORY_INDEX_ENGINE_CHECKSUM_MISMATCH` | Archive bytes differ from the manifest | Obtain the exact release asset; do not bypass verification |
| `E_REPOSITORY_INDEX_ENGINE_BINARY_CHECKSUM_MISMATCH` | Managed or extracted executable bytes differ from the manifest | Run `index-setup` or `index-rebuild` to repair the managed binary; do not run a mismatched executable |
| `E_REPOSITORY_INDEX_ENGINE_EXTRACTION_FAILED` | Archive is invalid or unsafe | Replace the archive with the exact pinned asset |
| `E_REPOSITORY_INDEX_ENGINE_VERSION_MISMATCH` | Binary does not report the pinned version | Use `tgrep 1.0.3` |
| `E_REPOSITORY_INDEX_ENGINE_EXECUTION_FAILED` | Managed executable could not be launched/verified | Inspect permissions and host compatibility |
| `E_REPOSITORY_INDEX_NOT_INITIALIZED` | No complete project index exists | Run `index-setup` |
| `E_REPOSITORY_INDEX_INDEXING` | Initial index metadata is incomplete | Wait briefly and inspect status again |
| `E_REPOSITORY_INDEX_SERVER_START_FAILED` | Owned watcher did not become ready | Inspect status, then run `index-rebuild` |
| `E_REPOSITORY_INDEX_SERVER_STOP_FAILED` | Ownership could not be proven or stop timed out | Do not kill by name; inspect metadata/process identity |
| `E_REPOSITORY_INDEX_SERVER_UNHEALTHY` | Server/index identity or health check failed | Run `index-status`, then rebuild if needed |
| `E_REPOSITORY_INDEX_SEARCH_FAILED` | Native search exited with an error | Inspect the preserved bounded diagnostic and status |
| `E_REPOSITORY_INDEX_OUTPUT_INVALID` | Known JSON output was malformed | Rebuild and report a pinned-engine regression if repeated |
| `E_REPOSITORY_INDEX_REBUILD_FAILED` | Rebuild did not produce complete metadata | Preserve other ForgeLoop state and retry after diagnosis |
| `E_REPOSITORY_INDEX_REQUEST_INVALID` | Search request exceeded the contract | Correct the pattern, filter, or numeric bound |

## Security

The Repository Index is a local derived-cache boundary:

- version, asset, archive SHA-256, and executable SHA-256 are pinned in source control;
- release URLs are restricted to the expected HTTPS GitHub hosts;
- downloads and extraction are bounded and atomic; managed binaries are hashed
  before any execution and tampered binaries are repaired only through the
  canonical setup path;
- archive absolute paths, `..` traversal, and symbolic links are rejected;
- native processes receive direct argument arrays with `shell: false`;
- server stop requires repository-root, index-path, metadata, binary, and
  command-line identity, not just a PID;
- search patterns, match text, and machine-local repository paths are not sent
  to telemetry or returned in normal structured search/status output by default;
- native index files are never interpreted as protocol truth;
- search metrics remain operational observations, not evidence or completion
  proof.

See [`THREAT_MODEL.md`](../THREAT_MODEL.md) and [`SECURITY.md`](../SECURITY.md)
for the broader ForgeLoop trust model.

## Rebuilding

Use `index-rebuild` after corruption, a pinned-engine upgrade, or a confirmed
stale cache. The operation is deliberately scoped to derived Repository Index
data. It does not run task recovery, rewrite completion, alter claims, remove
receipts, or change guide/profile authority.

If an owned server unexpectedly exits, the next normal search invalidates its
local readiness record and performs one recovery setup/retry under a short
project-scoped startup lock. Concurrent searches share one verified server; the
lock is not held for the duration of a search query.

## Upgrade behavior

The runtime uses one pinned version from the manifest and never auto-tracks
`latest`. When a future ForgeLoop release changes that version, `update`
provisions the new engine and rebuilds the derived index by default. An engine
upgrade must refresh asset names and hashes, third-party notices, differential
and live-watcher tests, benchmarks, and package validation before release.

Existing ForgeLoop projects do not need their entire `.forgeloop` directory
deleted. `update` creates missing Repository Index state while preserving
project profile, task state, evidence, receipts, and policy artifacts.

## Performance benchmarking

The reproducible benchmark input is
[`benchmarks/repository-index/queries.json`](../benchmarks/repository-index/queries.json)
and its protocol is described in
[`benchmarks/repository-index/README.md`](../benchmarks/repository-index/README.md).
Measure cold index build, first-use setup, warm selective queries, post-mutation
queries, and high-match queries. Record actual duration, match counts, commit,
platform, architecture, Node version, and engine version. Do not convert these
measurements into token savings, cost savings, or universal speed claims.

## Relationship to guides, context, and evidence

ForgeLoop keeps the boundaries distinct:

```text
Guides / routing        -> how the work should be performed
Repository Search       -> where matching repository content exists
Task contract           -> what outcome is required
Verification / evidence -> what was actually proven
Completion validation   -> whether protocol completion is valid
```

Repository Search can support discovery, planning, execution, debugging, and
review preparation. It is not a lifecycle transition, does not select or
shrink verification scope, and does not become a receipt or evidence source.
Optional Ripwire advisory context and structural-quality providers remain
independent capabilities; neither is a Repository Index backend.

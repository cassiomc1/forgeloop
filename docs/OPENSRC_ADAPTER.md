# OpenSrc Advisory Context Adapter

## Status

Optional, host-injected, advisory-only. OpenSrc is an external
host-provisioned executable ([vercel-labs/opensrc](https://github.com/vercel-labs/opensrc),
Apache-2.0); ForgeLoop never installs, discovers, or invokes it automatically.

## Purpose

Give a trusted host a bounded way to recall external package/repository
source-code snippets (npm, PyPI, crates.io, GitHub, GitLab, Bitbucket) as
ForgeLoop advisory context through the existing `advisoryContextProviders`
Integration API boundary.

## Architecture

```text
host / coding harness
        ↓
createOpenSrcAdvisoryContextProvider(...)
        ↓
createForgeLoopContext({ advisoryContextProviders: { opensrc } })
        ↓
recallAdvisoryContext(...)
        ↓
<absolute-opensrc> --version (qualified every recall)
        ↓
<absolute-opensrc> path <source> --cwd <projectRoot> (one source per call)
        ↓
canonical realpath containment inside OPENSRC_HOME
        ↓
bounded deterministic Node.js search (ForgeLoop-owned)
        ↓
normalized advisory items
        ↓
NON_EVIDENCE_ADVISORY_CONTEXT
```

OpenSrc owns source acquisition, version-aware resolution, and its own cache.
ForgeLoop owns snippet selection, normalization, and the advisory trust
boundary. No `rg`, `grep`, embeddings, or network search are used by ForgeLoop.

## Prerequisites

- An OpenSrc executable provisioned by the host (ForgeLoop does not install it).
- A host-qualified exact expected version (for example `0.7.3`).
- A dedicated absolute cache root outside the project, passed as `OPENSRC_HOME`.
- An explicit allowlist of source specs (at most 8).

## Host Configuration

```javascript
import {
  createForgeLoopContext,
  createOpenSrcAdvisoryContextProvider,
  recallAdvisoryContext,
} from "@cassiomc1/forgeloop/integration";

const opensrc = createOpenSrcAdvisoryContextProvider({
  executablePath: "/absolute/path/to/opensrc",
  expectedVersion: "<host-qualified-version>",
  cacheRoot: "/absolute/path/to/opensrc-cache",
  sources: ["zod", "vercel/next.js"],
});

const runtimeContext = createForgeLoopContext({
  advisoryContextProviders: {
    opensrc,
  },
});

const context = await recallAdvisoryContext({
  target: "/absolute/project",
  taskId: "task-001",
  providerName: "opensrc",
  query: "parse error handling",
  runtimeContext,
});
```

Construction is inert: it validates configuration only and never spawns,
reads source, touches the network, populates the cache, or mutates ForgeLoop
state.

## Executable Qualification

Before source resolution on every recall, the adapter runs
`<absolute-opensrc> --version` with `shell: false`, bounded output, and a
shared deadline, then requires `actualVersion === expectedVersion` exactly.
No semver ranges and no newer-version tolerance. Mismatch fails closed.

## Source Allowlist

Only configured `sources` entries are resolved, one per `opensrc path`
invocation. Specs must be non-empty, bounded (256 chars), free of control or
whitespace characters, must not begin with `-`, and must not contain shell
metacharacters. Documented forms include bare npm names (with `@scope/` and
`@version` pins), `pypi:`, `crates:` (plus `pip:`, `python:`, `cargo:`,
`rust:` aliases), `owner/repo`, URLs, and `gitlab:` / `bitbucket:` specs.
Automatic dependency enumeration is out of scope.

## Cache Behavior

`OPENSRC_HOME` is set to the configured `cacheRoot` for every OpenSrc child
process. The cache root and the project root must be fully disjoint: neither
may equal or contain the other, and the cache must not sit inside
`.forgeloop`. Each relationship is checked both lexically and canonically
(realpath), so symlinked prefixes cannot hide an overlap.
Each printed path must canonicalize inside the cache root, exist, be a
directory, and survive symlink-escape checks before any search runs.

## Network Behavior

`opensrc path` may contact registries or remotes and shallow-clone source on
cache miss; later recalls may reuse the OpenSrc cache. This recall path is
protocol-state side-effect-free: ForgeLoop persists no advisory result,
writes no lifecycle state, and never auto-recalls. OpenSrc itself persists
cache data under `OPENSRC_HOME`; that is upstream behavior, not ForgeLoop
state.

## Recall Example

See Host Configuration. Only `--version` and `path` are ever invoked; `fetch`,
`clean`, `remove`, and `rm` are never called by this adapter.

## Result Shape

```javascript
{
  title: "zod — src/types.ts",
  summary: "L120-L126 | <bounded single-line snippet>",
  sourceRef: "opensrc:zod:src/types.ts#L120-L126"
}
```

Summaries are flattened to one portable line because the core advisory
contract rejects control characters. Absolute cache paths, home directories,
stderr, environment, credentials, and cache metadata are never emitted. The
core service then applies `authority: ADVISORY`, `evidenceAuthority: NONE`,
`actionability: NON_EXECUTABLE`, `trustRole: NON_EVIDENCE_ADVISORY_CONTEXT`,
and `persisted: false`, plus item fingerprints and deep freezing.

## Trust Boundary

Snippets are inert source text. They satisfy no verification requirement,
terminal requirement, gate, receipt, attestation, or run-check provenance.
Source content is never executed, even when it contains instruction-like
text. Provider output never advances phases, selects next actions, releases
claims, or authorizes durable actions.

## Security

Threats and mitigations are tracked in `THREAT_MODEL.md` (OpenSrc rows):
binary substitution and version drift (exact lazy qualification), malicious
stdout paths and cache/symlink escapes (realpath containment), prompt
injection in source (inert bounded text, non-executable trust role),
credential leakage (no raw stderr/env/absolute-path emission), unbounded
trees and binary ingestion (sorted traversal, size/count/byte budgets, binary
skip), network/cache side effects (explicit host-owned `OPENSRC_HOME`,
documented fetch-on-miss), private-repository credentials (host-owned env,
never persisted or logged), timeouts and output overflow (shared deadline,
64 KiB ceilings, SIGTERM/SIGKILL escalation).

## Limits

- Sources: at most 8 configured; one `path` call each.
- Files read per source: 2,000; examined entries per source: 5,000
  (skipped, oversized, and binary entries count toward traversal, never
  bypass it).
- Per-file: 256 KiB; total reads: 8 MiB per advisory recall across all
  configured sources through one shared budget.
- Matches per source: 32; snippet window: 7 lines.
- Process stdout/stderr: 64 KiB each; kill grace: 250 ms.
- One shared recall deadline spans version qualification, path resolution,
  traversal, reads, matching, and normalization.
- Ranking: exact full-query match, then token overlap, then source order,
  relative path, and line number. Repeated runs over unchanged fixtures are
  byte-identical, including identical stopping points under budget pressure.

## Private Repositories

Private sources work only through host-owned configuration (environment,
authenticated OpenSrc cache). ForgeLoop never discovers, persists, logs, or
returns credentials; errors never echo secret-bearing values.

## Credentials Ownership

Credentials belong to the host. They travel only through host-supplied process
configuration, never through ForgeLoop artifacts, and never into advisory
output.

## No Auto-Install

ForgeLoop never runs package installs, `npx`, `curl | sh`, or equivalents for
OpenSrc. An unavailable binary maps to the standard advisory-provider
unavailable semantics; the host provisions OpenSrc explicitly.

## No PATH Discovery

The executable must be absolute. `which`, `where`, `command -v`, and PATH
resolution are never used.

## No Evidence Authority

See Trust Boundary. Behavioral claims still require canonical ForgeLoop
verification with ForgeLoop-owned provenance.

## No Lifecycle Authority

See Trust Boundary. Advisory recall is never triggered by `next`,
`preflight`, verification, `complete`, task creation, task discovery, or
Agent Skill loading.

## Troubleshooting

| Symptom | Meaning | Action |
| --- | --- | --- |
| `E_ADVISORY_CONTEXT_PROVIDER_INVALID` on recall | Bad config, version mismatch, cache inside project, or malformed version output | Check absolute paths, exact version, `OPENSRC_HOME` placement |
| `E_ADVISORY_CONTEXT_PROVIDER_UNAVAILABLE` | Missing binary or spawn failure | Provision the host executable; ForgeLoop will not install it |
| `E_ADVISORY_CONTEXT_RESULT_INVALID` | Empty/multi-line/relative/outside-cache path, non-directory, or bad exit | Inspect host cache and source spec |
| `E_ADVISORY_CONTEXT_TIMEOUT` | Shared deadline expired | Retry with a larger recall `timeoutMs` within core ceilings |
| `E_ADVISORY_CONTEXT_OUTPUT_LIMIT` | 64 KiB process ceiling or item budget exceeded | Narrow sources or query |

## Package Behavior

`src/adapters/opensrc/**`, this guide, and the integration declarations ship
in the core npm tarball. No OpenSrc binary, cache, fixture, credential, or
source snapshot ships. No new runtime dependency and no new package subpath
are added; `providerExtensions.publicRegistryApi` and
`providerExtensions.packageSubpathExported` remain false.

## Compatibility

- Protocol v1, schema v1, Integration API v1 unchanged.
- `advisoryContextProviders` v1 and `providerExtensions` v1 unchanged; the
  `ADVISORY_CONTEXT` provider kind covers this adapter.
- Requires Node.js 20+.
- Upstream behaviors referenced: `opensrc path <source> [--cwd]`,
  `OPENSRC_HOME` override, fetch-on-miss, `opensrc 0.7.3` observed at
  authoring time (never hardcoded into behavior).

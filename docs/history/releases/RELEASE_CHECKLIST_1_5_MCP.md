# ForgeLoop 1.5.0 + MCP release checklist

Preparation checklist for the `@cassiomc1/forgeloop` 1.5.0 and
`@cassiomc1/forgeloop-mcp` releases. It does not authorize publication.

## Core integration gates

- [ ] Core package version is `1.5.0`; integration API version is `1`.
- [ ] `exports` map exposes only `.` and `./integration`.
- [ ] Executor registry is in parity with canonical command definitions.
- [ ] `bundle` is MAINTENANCE-gated; hidden in readonly/safe.
- [ ] `resolveForgeLoopProjectRoot` applies CLI target semantics (symlinks rejected).
- [ ] Integration limits bound strings, arrays, argv, and structured inputs.

## MCP package gates

- [ ] Official SDK v2; target protocol generation `2026-07-28`.
- [ ] stdio works with clean stdout (protocol-only) and JSON stderr diagnostics.
- [ ] HTTP is strict modern (`legacy: "reject"`) and loopback-only
      (`E_MCP_REMOTE_NOT_SUPPORTED` for any other bind).
- [ ] Transport bounds active: header/request/keepalive timeouts, 4 MiB body cap,
      POST-only, in-flight ceiling (503 `E_MCP_HTTP_BUSY`).
- [ ] Tool/resource catalogs are deterministic and identical across transports.
- [ ] Task-aware mutation tools require explicit `taskId`.
- [ ] Capability gates re-checked per invocation; tool input cannot elevate policy.
- [ ] `task-recover`, legacy repair, and force unlock are separately gated;
      legacy repair hidden by default; `operatorAuthorized` absent from schemas.
- [ ] No generic shell/exec tool exists.

## Ownership/recovery parity

- [ ] `task/ownership` derives exclusively from the canonical claim resolver.
- [ ] Forged COMPLETE stays INCONSISTENT with retained claims on every surface.
- [ ] RECOVERED tasks block ordinary mutation; `task-resume` reacquires canonically.
- [ ] Concurrent resume yields exactly one winner.

## Safety

- [ ] `maxExecutionTimeMs` enforced: missing→max, zero/negative/float rejected,
      over-max rejected.
- [ ] Error payloads preserve canonical codes; secrets redacted; stacks stripped;
      messages bounded.
- [ ] Oversized tool/resource output refused with `E_MCP_RESULT_TOO_LARGE`.

## Packaging/docs

- [ ] Core tarball contains integration modules and both integration docs.
- [ ] MCP tarball contains both bins, src, README; core tarball never ships
      `integrations/`.
- [ ] Server `serverInfo.version` equals MCP package.json version.
- [ ] MCP README documents stdio-default + optional loopback-only HTTP.
- [ ] THIRD_PARTY_NOTICES covers the Model Context Protocol SDK.
- [ ] CHANGELOG entries present.

## Exact output-bound gates (post-PR #80)

- [ ] Output bounds measure the exact UTF-8 serialization transmitted
      (pretty-printed included), not compact JSON.
- [ ] Compact-below/pretty-above regression covered by tests.
- [ ] UTF-8 byte-count regression covered by tests.
- [ ] `forgeloop_capabilities` complete result is bounded like command tools.
- [ ] Non-size serialization errors are rethrown, not mislabeled as overflow.
- [ ] Structured tool input is byte-bounded (`E_MCP_INPUT_TOO_LARGE`).

## Documentation gates

- [ ] Repository-wide documentation audit complete.
- [ ] Documentation manifest/index current.
- [ ] Generated references current (`docs:generate` leaves no diff).
- [ ] README / CHANGELOG current.
- [ ] MCP / Universal Integration docs current.
- [ ] Security docs current.

## Publication boundary

- [ ] Release identity verification passes.
- [ ] Publication of either package is separately authorized; this checklist
      does not itself authorize npm publishing.

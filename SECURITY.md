# Security policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability in ForgeLoop's file
handling, task isolation, command execution, or release process. Report it
privately to the repository maintainers with a minimal reproduction, affected
version, impact, and any safe mitigation already identified.

## Supported releases

Only the latest published npm release receives security fixes. Protocol
artifacts declare both `protocolVersion` and `schemaVersion`; unknown versions
must be rejected rather than interpreted permissively.

## Security boundaries

ForgeLoop does not execute shell strings: command checks use exact argv,
bounded output capture, and timeout termination. It does not install software
without a host-attested authority grant. Paths must remain within the selected
target and cannot traverse symlinks. Transaction journals, task locks, and
hash-chained events are integrity mechanisms, not a substitute for operating
system access control.

## MCP local boundary

The optional ForgeLoop MCP HTTP transport is **loopback-only**; non-loopback
binds are refused (`E_MCP_REMOTE_NOT_SUPPORTED`) and authenticated remote MCP
is unsupported. Host/Origin validation is DNS-rebinding defense, not remote
authentication. Security reports covering the MCP adapter are in scope.

## Structural-quality process boundary

The optional structural-quality provider is an untrusted local process. The
built-in Sentrux adapter uses the fixed `sentrux --mcp` argument vector with
`shell: false`, validates the server name/version/tools, bounds combined
stdout/stderr and execution time, rejects malformed or secret-bearing output,
and terminates a process that exceeds its limits. Project configuration cannot
select an executable path, shell, arbitrary argv, raw score, or baseline.

Quality artifacts are task-scoped, atomic, provider/version/policy/scope bound,
and revalidated when completion or a portable bundle is read. A baseline cannot
be replaced after execution begins. `observe` preserves unavailable evidence as
`NOT_OBSERVED`; `gate` fails closed as `BLOCKED`. Missing diagnostics in a
provider tier remain `null` and do not become fabricated evidence.

Sentrux installation, upgrades, and analytics preferences remain user-managed;
ForgeLoop does not install the provider or modify its global analytics setting.

## Repository Index security boundary

The Repository Index provisions only the pinned tgrep release for the current
platform. ForgeLoop validates the HTTPS asset identity, SHA-256 digest,
archive paths, extracted executable, and reported version before atomic
installation. Native arguments are passed directly with `shell: false`; paths,
patterns, filters, and context values are bounded, so shell syntax is not
evaluated.

Index files are opaque derived cache under
`.forgeloop/repository-index/tgrep/`; they are not evidence, completion truth,
or authority. Server stop/start validates the repository root, index path,
serve metadata, binary, process liveness, and command line before acting, and
never terminates by process name or PID alone. Search content remains local
and is not automatically logged or sent to telemetry. Corrupt or stale cache
is handled through status and explicit rebuild rather than by trusting native
index internals or silently falling back to another search executable.

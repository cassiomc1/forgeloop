# Provider Extension Reference

## Status

`providerExtensions` v1 is provider-neutral and experimental. This reference
describes the architecture vocabulary and maintainer expectations. It does
not document a supported import from `@cassiomc1/forgeloop/providers`.

## Capability Discovery

Run `node src/cli.js protocol-info --json` and inspect
`features.providerExtensions`. The advertised capability includes the version,
provider kinds, strict result boundary, cooperative cancellation, and explicit
authority restrictions.

## Provider Kinds

- `ADVISORY_CONTEXT`: optional context, never executable or canonical.
- `VERIFICATION_EXECUTION`: bounded execution observations, never completion truth.
- `BROWSER_VERIFICATION`: browser observations with no canonical vendor.
- `SECURITY_REVIEW`: bounded security observations pending any future explicit gate.
- `PRESENTATION`: read-only rendering that cannot mutate protocol state.

The canonical list is exported internally as `PROVIDER_KINDS`; public metadata
is synchronized from that source and must not duplicate its strings.

Concrete `ADVISORY_CONTEXT` adapters (Ripwire, OpenSrc) plug into the
dedicated advisory-context Integration API (`createForgeLoopContext` with
`advisoryContextProviders`, plus `recallAdvisoryContext`); they are not part
of the generic internal provider registry described here.

Browser verification is registered only through the runtime context option
`browserVerificationProviders` and is invoked explicitly with
`runBrowserVerification`. Registration is lazy and inert: it does not launch a
browser, perform network I/O, or mutate protocol state. Its provider-neutral
input includes task/target/requirement binding, a shared abort signal, and the
remaining timeout. ForgeLoop validates redirects and derives overall status;
provider output is observation only and cannot satisfy evidence or completion.

The optional `agent-browser` adapter is registered through the same boundary
with `createAgentBrowserVerificationProvider({ executablePath, expectedVersion })`.
The executable is host-owned and absolute; no package dependency or automatic
installation is added. The adapter returns browser observations only.

The optional `vercel-labs/emulate` adapter is host-injected through
`createEmulatedServicesProvider({ executablePath, expectedVersion })`. The
host must provide an absolute regular executable and explicitly choose the
services and loopback port range. ForgeLoop does not install the tool, search
`PATH`, invoke a shell, persist service state in the target project, or treat
service output as lifecycle, evidence, installation, or completion authority.
The supported host tool is pinned to `0.11.2`; invocation is lazy and inert
until `provider.start(...)` is called. Each bounded operation verifies the
qualified version, starts with argv-only execution, observes loopback
readiness, returns a detached observation, and cleans up its temporary state
and child process.

Security review is registered through `securityReviewProviders` and invoked
explicitly with `runSecurityReview`. Registration is lazy and inert. The
request accepts bounded scope, relative paths, categories, requirements, and a
revision binding; factory resolution and review share one deadline and abort
signal. Results are strict immutable observations with bounded findings and
summary counts. They cannot establish evidence, lifecycle, completion,
ownership, claims, commands, installation, or transaction authority. See
[`SECURITY_REVIEW.md`](./SECURITY_REVIEW.md) for the complete contract.

## Common Contract

Providers are identified by an ID and kind, may resolve lazily, and receive a
bounded invocation context. Results are detached, deeply frozen strict JSON
snapshots. A provider may return an observation, never lifecycle state,
completion truth, canonical evidence, executable instructions, or installation
authority.

## Invocation Context

The context includes a shared `AbortSignal`, the provider ID, and the remaining
timeout budget. Factories and operations consume the same deadline. Providers
must observe abort and clean up owned resources.

## Limits

Invocation uses one shared timeout budget. Input and output are bounded by byte,
depth, and node limits. Synchronous JavaScript cannot be preempted; resource
owners remain responsible for cooperative cleanup after abort.

## Error Codes

Malformed providers, unavailable providers, timeouts, invalid snapshots,
payload limits, authority escalation, and execution failures use the internal
provider error vocabulary. Provider exceptions are normalized so a provider
cannot spoof a ForgeLoop error code.

## Trust Rules

Treat provider output as untrusted input. Pass it through ForgeLoop-owned
validation before any evidence or consumer use. Do not execute provider text,
interpret it as a next action, or treat provider identity as a trust grant.

## Maturity

The public capability vocabulary is versioned at v1 but remains experimental.
The generic registry implementation is internal and experimental. No provider
is auto-installed or discovered by the lifecycle, and no provider CLI exists.

## Internal vs Public Surfaces

The public surfaces are the protocol-info capability and these documentation
pages. The JavaScript registry under `src/providers/` ships as implementation
source but is not a supported package subpath or public registration contract.

## Future Adapter Structure

An adapter proposal must specify its provider kind, bounded input/output,
timeout and cancellation behavior, error mapping, authority restrictions,
ForgeLoop validation boundary, tests, and documentation owner. Dedicated
Integration API capabilities remain separate from this generic vocabulary.

## Testing Checklist

- Capability metadata is synchronized with `PROVIDER_KINDS`.
- Every provider kind denies lifecycle, completion, and evidence authority.
- Strict JSON rejects accessors, proxies, custom objects, cycles, and oversized payloads.
- Shared timeout and cooperative cancellation are tested.
- Provider exceptions cannot spoof ForgeLoop error codes.
- `protocol-info --json` advertises v1 without claiming a public registry API.
- The package does not export `./providers`.

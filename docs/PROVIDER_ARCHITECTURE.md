# Provider Extension Architecture

## Status

Provider extensions are a provider-neutral, experimental capability family in
Protocol v1. The capability vocabulary is public and versioned; the generic
provider registry is internal and is not a supported package API.

## Scope

This document explains the common boundary around provider observations. It
does not add generic provider registration to `createForgeLoopContext()`, CLI
provider commands, automatic installation, lifecycle authority, or completion
authority.

## Why ForgeLoop Uses Providers

Providers allow a host to connect bounded observations or execution services to
ForgeLoop without making a vendor, model, browser, scanner, or presentation
tool canonical. A provider result is an input to ForgeLoop-owned validation,
not a replacement for it.

## Provider-Neutral Design

The public `providerExtensions` capability advertises architecture and
compatibility semantics only. It is provider-neutral, experimental, lazy at
the host boundary, and deliberately separate from the existing dedicated
`advisoryContextProviders` Integration API capability.

The generic registry is currently an internal implementation module. It is
not exported as `@cassiomc1/forgeloop/providers`, and capability advertising
does not imply a public registration or installation API.

## Provider Kinds

The five kinds are derived from the canonical `PROVIDER_KINDS` source:

| Kind | Contract |
| --- | --- |
| `ADVISORY_CONTEXT` | Optional, non-authoritative context. It is never canonical state, evidence, completion authority, or executable instruction. |
| `VERIFICATION_EXECUTION` | A bounded execution boundary that may produce observations, but never completion truth. |
| `BROWSER_VERIFICATION` | Browser-driven observation and assertion collection. No vendor is canonical. |
| `SECURITY_REVIEW` | Bounded security findings, observation-oriented unless a future explicit gate contract exists. |
| `PRESENTATION` | Read-only presentation or rendering. It must never mutate protocol state. |

Every kind denies lifecycle, completion, and evidence authority. Providers do
not acquire installation authority.

## Invocation Lifecycle

```text
HOST
 │
 ▼
provider selection
 │
 ▼
registry lookup
 │
 ▼
lazy factory resolution
 │
 ▼
provider validation
 │
 ▼
bounded invocation
 │
 ▼
strict JSON normalization
 │
 ▼
authority validation
 │
 ▼
immutable observation
 │
 ▼
ForgeLoop consumer
```

The result boundary is:

```text
provider result
      ↓
normalized observation
      ↓
ForgeLoop-owned validation
      ↓
optional canonical evidence/use
```

A provider must never bypass ForgeLoop-owned validation.

## Trust Boundary

Provider output is untrusted input. It cannot establish lifecycle state,
completion truth, canonical evidence, next-action authority, or installation
authority. Provider identity and availability are descriptive and must not be
treated as proof of executable identity or trust.

## Strict JSON Snapshot Boundary

Provider input and output use detached, deeply frozen snapshots. Allowed values
are `null`, booleans, finite numbers, strings, arrays, and plain objects.

The boundary rejects `undefined`, functions, symbols, bigints, non-finite
numbers, dates, maps, sets, promises, proxies, custom classes, accessors,
cycles, sparse or extended arrays, and hidden non-enumerable payload data.
Provider payloads are bounded by byte, depth, and node limits.

## Timeout and Cancellation

Factory resolution and operation execution share one timeout budget and one
invocation context. The `AbortSignal` is propagated and cancellation is
cooperative. A late factory resolution cannot start an operation after the
deadline. Synchronous JavaScript cannot be preempted by a timer, so providers
that own subprocesses, browsers, requests, or sockets must clean them up when
the signal is aborted.

## Error Normalization

Provider exceptions are normalized to ForgeLoop provider execution failures;
provider-supplied ForgeLoop-shaped error codes are not trusted. Validation and
timeout failures are generated outside the provider call boundary.

## Authority Restrictions

The following public capability fields remain false: `autoInstall`,
`lifecycleAuthority`, `completionAuthority`, and `evidenceAuthority`.
Providers observe. ForgeLoop validates, owns lifecycle transitions, and decides
whether an observation can contribute to canonical evidence.

## Evidence Conversion Boundary

An observation can become usable evidence only through the relevant
ForgeLoop-owned validation and evidence contract. Provider output is never
itself a completion claim or canonical evidence record.

## Internal vs Public Surfaces

Public and versioned:

- `protocol-info --json` and `features.providerExtensions`.
- This architecture document and [`PROVIDERS.md`](./PROVIDERS.md).

Internal and experimental:

- `src/providers/index.js` and the generic registry implementation.
- Provider capability implementation details not included in the public
  Integration API contract.

`@cassiomc1/forgeloop/providers` remains unexported.

## Compatibility

Protocol version, Schema version, and Integration API version remain `1`.
`providerExtensions` is capability version `1`; consumers must feature-detect
it and may continue using the core protocol when they do not understand it.

## Future Provider Adapters

Future adapters may implement a provider kind only after a provider-neutral
contract defines its input, output, resource bounds, trust treatment, and
ForgeLoop-owned validation boundary. Vendor-specific adapters remain optional
and must not become a competing source of protocol truth.

## Security Considerations

Provider output can be malicious, oversized, mutable, delayed, or misleading.
Strict JSON snapshots, bounded invocation, cooperative cancellation, error
normalization, recursive authority checks, and no automatic installation keep
the boundary fail-closed. See [`THREAT_MODEL.md`](../THREAT_MODEL.md) for the
security ownership table.

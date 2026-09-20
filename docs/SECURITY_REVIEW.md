# Security Review Provider

The Security Review provider is an optional, host-injected Integration API
capability for bounded, observation-only security findings. It is deliberately
separate from ForgeLoop lifecycle, evidence, completion, claim, ownership,
installation, command, and transaction authority.

## Registration

Register providers on `createForgeLoopContext({ securityReviewProviders })`.
The registry accepts an object or `Map`, and each value is either a provider
or a lazy factory. Registration validates provider identity but does not invoke
factories, scan the project, start a process, access the network, install a
tool, or mutate `.forgeloop` state.

Provider IDs are lower-case portable identifiers. A provider must expose the
same `id` as its registry key and a `review(request)` function. The host owns
the provider implementation and any scanner or executable it uses; ForgeLoop
does not discover tools or search `PATH`.

## Invocation

Call `runSecurityReview({ projectPath, taskId, providerName, reviewId, ... })`
through `@cassiomc1/forgeloop/integration`. Requests are detached and deeply
frozen before invocation. The request supports `FULL`, `CHANGED`, or
`SELECTED` scope, bounded relative paths, categories, requirements, an
optional revision binding, and a timeout capped by ForgeLoop.

Factory resolution and `review()` share one deadline and one cooperative
`AbortSignal`. A caller may provide its own signal. Timeout, cancellation,
provider absence, invalid providers, malformed results, output limits, and
provider failures have stable `E_SECURITY_REVIEW_*` error codes. Provider
exceptions are normalized so provider code cannot spoof ForgeLoop errors.

## Result contract

Results are detached, deeply frozen JSON observations with bounded findings,
diagnostics, and summary counts. Each finding has a portable relative path,
bounded title/summary/rule/category/severity/confidence fields, and no secret-
like content. Results carry trust metadata stating that they are observation-
only and non-evidence.

Provider output is not a pass/fail lifecycle decision. It cannot create or
modify contracts, routes, gates, events, transactions, receipts, claims,
ownership, completion, executable commands, shell operations, credentials, or
installation state. Any future use as canonical evidence requires a separate
ForgeLoop-owned validation and evidence contract.

## Operational rules

- Keep registration lazy and explicit.
- Use a host-owned provider and a bounded request.
- Treat findings as advisory observations, not proof of `VALID`, `COMPLETE`,
  or any lifecycle phase.
- Handle timeout and cancellation cooperatively and clean up resources owned by
  the provider.
- Do not persist provider output as ForgeLoop task state unless a future
  canonical evidence contract explicitly defines that boundary.

See [`PROVIDER_ARCHITECTURE.md`](./PROVIDER_ARCHITECTURE.md),
[`PROVIDERS.md`](./PROVIDERS.md), and [`THREAT_MODEL.md`](../THREAT_MODEL.md)
for shared provider and security-boundary rules.

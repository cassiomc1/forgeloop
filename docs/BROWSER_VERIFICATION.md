# Browser Verification

## Status

Browser verification is a provider-neutral, host-injected v1 observation
contract. It is experimental and explicit. ForgeLoop does not select a browser
vendor, install a browser, or invoke verification from lifecycle commands.

## Purpose and Architecture

`runBrowserVerification` validates a bounded request, resolves one registered
provider, and turns its untrusted observation into an immutable result. Core
does not perform browser I/O. The runtime registry is inert at context
construction; factories are lazy and are invoked only by the explicit API call.

## Invocation

Provide an explicit task, target, requirement, and verification identity along
with `runtimeContext.browserVerificationProviders`:

```js
const result = await runBrowserVerification({
  taskId: "task-123",
  target: "/workspace/project",
  providerName: "playwright",
  verificationId: "checkout",
  requirement: "Checkout is usable",
  startUrl: "https://app.example.test/checkout",
  allowedOrigins: ["https://app.example.test"],
  steps: [{ id: "open", kind: "NAVIGATE", url: "https://app.example.test/checkout" }],
  assertions: [{ id: "title", kind: "TITLE_EQUALS", expected: "Checkout" }],
  runtimeContext: { browserVerificationProviders: { playwright: provider } },
});
```

Providers are registered by ID and must expose `verify(input)`. Factories are
lazy and are resolved only when the explicit invocation runs. Provider input
contains the normalized request, `signal`, and remaining `timeoutMs`. The
`AbortSignal` is an invocation control, not protocol state.

## Request Model

Requests require `taskId`, `target` (or `projectPath`), `verificationId`,
`requirement`, `startUrl`, `allowedOrigins`, at least one bounded step, and at
least one bounded assertion. Optional viewport, screenshot capture policy, and
timeout values are bounded. Unknown request, step, locator, assertion, capture,
or viewport fields are rejected. Arbitrary scripts, headers, cookies, uploads,
downloads, shell commands, and executable paths are not part of this contract.

Supported steps are `NAVIGATE`, `CLICK`, `FILL`, `PRESS`, and `WAIT_FOR`.
Supported assertions include visibility, text, value, attribute, URL, title,
and their documented bounded variants. Assertion results must match the
requested IDs, kinds, cardinality, and order exactly.

## Origins and Navigation

Authored URLs and provider-reported `finalUrl` and `navigations` must use
`http:` or `https:`, contain no credentials, and have an exact origin in
`allowedOrigins`. Hostnames are case-normalized and trailing-dot hostnames are
rejected. `localhost` and IPv4 origins are supported; bracketed IPv6 literals
are intentionally excluded in v1. The allowlist is an observation policy, not
a network sandbox: providers remain responsible for browser network access.

## Result Model

The normalized result contains task and requirement binding, provider identity,
assertions, final navigation state, diagnostics, optional accessibility
snapshots, and structured screenshot metadata. Raw image bytes are never
returned. Artifact references are portable, bounded, credential-free metadata
with a lowercase SHA-256 digest.

ForgeLoop derives overall status: any `FAIL` assertion yields `FAIL`, otherwise
any `BLOCKED` yields `BLOCKED`, otherwise all assertions yield `PASS`. A raw
provider status is optional and, when present, must match that derived value.
Provider output cannot choose lifecycle state, evidence, completion, claims, or
next actions. Unknown top-level fields and authority-bearing fields fail closed.

Snapshots are optional explicit `ACCESSIBILITY` observations with bounded
portable text. They are never assertion status or authority.

## Timeout and Cancellation

Factory resolution, provider validation, provider verification, and result
normalization share one ForgeLoop-owned deadline. On expiry ForgeLoop aborts
the shared signal, allows only bounded cooperative cleanup, and returns
`E_BROWSER_VERIFICATION_TIMEOUT`. Late provider resolution cannot change the
returned result. Providers must observe the signal and clean up resources they
own; synchronous JavaScript cannot be forcibly preempted.

## Trust Boundary and Credentials

Provider output is untrusted and normalized under strict size limits. Results
are stamped with `authority: "OBSERVATION"`, `evidenceAuthority: "NONE"`,
`actionability: "NON_EXECUTABLE"`, `lifecycleAuthority: false`, and
`completionAuthority: false`. Provider output cannot substitute for ForgeLoop
validation or lifecycle evidence.

Provider errors are mapped to generic, secret-safe public errors. Raw causes,
stacks, stderr, cookies, tokens, signed URLs, and local paths are not public
metadata. Credentials must not be placed in requests, URLs, artifacts,
diagnostics, or snapshots.

## Evidence Boundary

Results are observation-only: `persisted: false`, `evidenceAuthority: "NONE"`,
`completionAuthority: false`, and `evidenceRequiresForgeLoopValidation: true`.
Running this API does not mutate tasks, claims, routes, contracts, events,
receipts, checks, evidence, recovery, or actions.

## Network and Session Semantics

The origin allowlist does not provide browser isolation or prevent provider
network access. Providers own browser sessions and must not reuse credentials
or session state across unrelated invocations. No automatic browser install,
executable discovery, browser adapter, or auto-invocation is provided.

## Future Adapters and Troubleshooting

A future Agent Browser or other vendor adapter may implement this provider
contract, but no vendor is canonical and no adapter is included here. For
malformed requests, invalid results, origin escapes, provider failures, and
timeouts, use the stable error codes in `docs/TROUBLESHOOTING.md`.

## Compatibility

The canonical public operation is `runBrowserVerification`. The runtime
registration key remains `browserVerificationProviders`, and the provider kind
remains `BROWSER_VERIFICATION`.

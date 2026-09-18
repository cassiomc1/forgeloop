# Browser Verification

Browser verification is an explicit, host-injected observation capability. It
does not perform browser I/O in core, persist provider output, create protocol
evidence, advance lifecycle state, or authorize completion.

## Invocation

Call `runBrowserVerification` (or the existing `verifyBrowserContext` alias)
explicitly and provide `runtimeContext.browserVerificationProviders`:

```js
const result = await runBrowserVerification({
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

Providers are registered by ID and must expose `verify(request)`. Factories are
lazy and are resolved only when the explicit invocation runs. Requests are
bounded, allowlisted to HTTP(S) origins, and normalized before provider code
receives them.

## Trust Boundary

Provider output is untrusted and normalized under strict size limits. Results
are stamped with `authority: "OBSERVATION"`, `evidenceAuthority: "NONE"`,
`actionability: "NON_EXECUTABLE"`, `lifecycleAuthority: false`, and
`completionAuthority: false`. Provider output cannot substitute for ForgeLoop
validation or lifecycle evidence.

Provider errors, malformed output, origin violations, and timeouts fail closed
with the documented browser-verification error codes.

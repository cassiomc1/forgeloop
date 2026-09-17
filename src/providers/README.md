# Experimental internal provider modules

`index.js` is an internal module entry point, not a supported package subpath.
`@cassiomc1/forgeloop/providers` is deliberately not exported. The public,
provider-neutral capability vocabulary is advertised by `protocol-info`; the
generic registry remains experimental and internal. See
[`../../docs/PROVIDER_ARCHITECTURE.md`](../../docs/PROVIDER_ARCHITECTURE.md),
[`../../docs/PROVIDERS.md`](../../docs/PROVIDERS.md), and
[`../../PROTOCOL_INTEGRATION.md`](../../PROTOCOL_INTEGRATION.md).

`createProviderRegistry({ providers })` accepts a plain object map from ID to
provider or lazy factory. Object keys are already unique in JavaScript; there
is no duplicate-registration contract. Providers implement `id`, `kind`, optional
`version` and `operation(input, context)`. Factories receive the same frozen
`context` as operations: `{ signal, timeoutMs, providerId }`.

The default deadline is 10,000 ms; `timeoutMs` must be an integer from 1 through
300,000. Each byte limit defaults to 262,144 bytes and must be an integer from 1
through 4,194,304. Undefined options use defaults; null and coercible values do
not. Input normalization precedes the shared factory/validation/operation/result
deadline. Checkpoints reject results after elapsed synchronous work, but JavaScript
running on the same event loop cannot be preempted by a timer.

Timeout rejects the invocation and aborts its context. Cancellation is cooperative:
providers owning subprocesses, browsers, requests or other resources must listen
to `signal` and clean them up. Late factory resolution never starts an operation.
This registry is not a sandbox for hostile executable code. Async providers must
return native promises; arbitrary thenables are not supported. JavaScript itself
assimilates values returned by async functions before the registry can inspect them.

Input and output are detached, deeply frozen JSON snapshots. Output requires a
plain object root; input permits any JSON root. Accessors, proxies, custom
prototypes, symbols, non-enumerable properties, functions, undefined, non-finite
numbers, cycles and sparse or extended arrays are rejected without invoking
payload getters or serialization hooks. Serialization is byte-budgeted with a
maximum depth of 64 and 100,000 visited values. Shared acyclic references are
copied as ordinary JSON. Provider-owned originals are not frozen or returned.

Reserved authority keys set to true are rejected recursively, and top-level
`status: COMPLETE` is forbidden. These checks never turn other output into evidence
or authority. All factory/operation exceptions normalize to
`E_PROVIDER_EXECUTION_FAILED`, even if they carry ForgeLoop-shaped codes or were
constructed with `providerError`; validation and timeout errors are generated
outside that call boundary. Error messages do not reproduce provider payloads.

No installation, subprocess launch, protocol mutation or persistence occurs here.
Existing advisory and verification boundaries remain unchanged.

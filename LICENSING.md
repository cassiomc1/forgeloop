# Licensing

ForgeLoop is published under two licences. The protocol is open so that any
runtime, agent or verifier can implement it; the reference runtime stays
source-available.

## Apache-2.0 — the protocol

These paths are licensed under the Apache License, Version 2.0
([`LICENSE-APACHE`](./LICENSE-APACHE)):

- [`docs/PROTOCOL_SPEC.md`](./docs/PROTOCOL_SPEC.md) — the core specification
- [`schemas/`](./schemas/) — the JSON Schemas of the protocol objects
- [`conformance/`](./conformance/) and
  [`scripts/run-conformance.mjs`](./scripts/run-conformance.mjs) — the
  conformance suite and its runner
- [`verifier/`](./verifier/) — the independent evidence verifier

You may implement, copy, modify and redistribute these, including
commercially, under the terms of Apache-2.0.

## PolyForm Noncommercial 1.0.0 — the reference runtime

Everything else in this repository and in the `@cassiomc1/forgeloop` package,
including the CLI and runtime under [`src/`](./src/), is licensed under the
PolyForm Noncommercial License 1.0.0 ([`LICENSE`](./LICENSE)). Commercial use
of the runtime needs a commercial licence; see
<https://forgeloop.monster/#pricing>.

The npm package's `license` field names the runtime licence; the package also
ships `LICENSE-APACHE` and this file, which govern the Apache-2.0 paths above.

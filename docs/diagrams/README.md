# Documentation diagrams

ForgeLoop maintains three canonical P0 visuals in typed Archify workflow IR.
The manifest is the governance source for their identities, canonical
purposes, renderer mapping, artifact ownership, references, and review files:

| Visual | Canonical purpose | Source | Explorer | SVG fallback |
| --- | --- | --- | --- | --- |
| Engineering Flow | `high-level-engineering-flow` | [`forgeloop-engineering-flow.workflow.json`](./forgeloop-engineering-flow.workflow.json) | [HTML](../assets/diagrams/forgeloop-engineering-flow.html) | [SVG](../assets/diagrams/forgeloop-engineering-flow.svg) |
| Verification Trust Flow | `differential-verification-trust-boundary` | [`forgeloop-verification-trust-flow.workflow.json`](./forgeloop-verification-trust-flow.workflow.json) | [HTML](../assets/diagrams/forgeloop-verification-trust-flow.html) | [SVG](../assets/diagrams/forgeloop-verification-trust-flow.svg) |
| Code Attestation Chain | `code-attestation-chain` | [`forgeloop-code-attestation-flow.workflow.json`](./forgeloop-code-attestation-flow.workflow.json) | [HTML](../assets/diagrams/forgeloop-code-attestation-flow.html) | [SVG](../assets/diagrams/forgeloop-code-attestation-flow.svg) |

Each visual also has a deterministic [receipt directory](../assets/diagrams/)
entry and a source-bound [review directory](./reviews/). The Engineering Flow
is the conceptual lifecycle; the Verification Trust Flow explains the
fail-closed Differential Verification boundary; and the Code Attestation Chain
explains exact-content provenance, optional signing, and revision-range
coverage. Their text fallbacks remain in
[`README.md`](../../README.md#architecture-flow),
[`REVISION_PROVIDERS.md`](../REVISION_PROVIDERS.md#differential-verification-scope),
and [`CODE_ATTESTATION.md`](../CODE_ATTESTATION.md#completion-flow).

The canonical sources set `meta.animation` to `trace`, so the explorers and
SVGs trace workflow edges and emphasize active nodes. Use each explorer's
Present, playback, and focus controls for the full animated experience; every
SVG remains available for repository previews and text-only fallbacks.

The JSON IR is the source of truth. Do not edit the generated HTML or SVG by
hand. Run `npm run docs:diagrams` to regenerate the outputs and
`npm run docs:diagrams:check` to validate the pinned renderer, source semantics,
animation markers, artifact fingerprints, persistent review binding, manifest
ownership, and GitHub-safe SVG constraints.

The HTML view opens in Archify's dark presentation stage so the official flow
is visible without scrolling; its Present and playback controls expose the
animated trace, while reduced-motion preferences remain respected. The SVG
fallback also carries the trace-capable styles and intentionally defaults to the
dark presentation so it remains legible in repository previews; the adjacent text fallback in
[`README.md`](../../README.md#architecture-flow) carries the same lifecycle
semantics for text-only readers.

Advisory context, including the optional Ripwire adapter, is intentionally not
drawn as a lifecycle node or transition. It is a host-injected, explicit,
non-evidence input that can guide inspection while remaining outside state,
authority, verification, completion, and next-action decisions. Its boundary
is documented in [`ADVISORY_CONTEXT.md`](../ADVISORY_CONTEXT.md) and
[`RIPWIRE_ADAPTER.md`](../RIPWIRE_ADAPTER.md); keeping it out of these P0
visuals prevents an optional side channel from being mistaken for protocol
control flow.

Archify is vendored at `vendor/archify/v2.15.0/archify` under its MIT license.
The exact source commit and cryptographic vendor-tree hash are recorded in
`vendor/archify/v2.15.0/PIN.json`; generated-file hashes are recorded in the
receipt and the visual approval binds the current source and SVG fingerprints.

`PIN.json` uses ForgeLoop Archify PIN `schemaVersion: 2`. This version describes
the metadata and integrity-declaration format and is independent of Archify's
upstream release version. A future PIN format change must increment the schema
version and update the validator before new files are accepted; it does not
change the vendored tree digest.

The ForgeLoop Archify wrapper is intentionally documentation-scoped. It reads
canonical inputs only from `docs/diagrams/` and permits deliver outputs only
under `docs/assets/diagrams/`.

ForgeLoop governs five documentation-diagram categories: workflow,
architecture, sequence, dataflow, and lifecycle. The current active set uses
three workflow diagrams because the pinned wrapper currently maps only
`workflow`. Governance support does not imply renderer support: a type requires
an explicit renderer mapping before it can be added as an active diagram.
Additional safety-boundary, resume, or provider visuals remain intentionally
deferred until their mappings are proven.

## Current behavioral boundaries

The engineering explorer describes structured obligations, project/task-bound
transactions, and bounded refresh of blocked pre-execution checkpoints. Its
later correction loop still returns through verification.

The verification explorer distinguishes test filtering from a canonical
verification scope and executed command evidence from explicit manual review.
The attestation explorer distinguishes absent CI receipts (`NOT_VERIFIED`)
from attestation trust levels and notes that payload compaction preserves
transaction manifests and event history.

These explanations are part of the JSON sources and generated explorers;
matching textual fallbacks live in the README, revision-provider guide, and
attestation guide. Re-render before renewing a visual review, then inspect
the new output at desktop and narrow widths before binding the review hashes.

The Repository Index and Persistent Search Transport are runtime discovery
boundaries rather than lifecycle transitions. Their current CLI/API/MCP
separation and local IPC sequence are documented in
[`REPOSITORY_INDEX.md`](../REPOSITORY_INDEX.md) and
[`PERSISTENT_SEARCH_TRANSPORT.md`](../PERSISTENT_SEARCH_TRANSPORT.md). They are
intentionally not added as a fourth Archify workflow merely to increase the
diagram count; the README hero provides the conceptual architecture overview,
while these three governed visuals remain focused on lifecycle, verification,
and attestation.

# Release model

ForgeLoopAudit `0.3.0-rc.3` is an unsigned preview npm package aligned to
ForgeLoop `2.0.0` at immutable commit
`4ff11bb4bc4be39b095a151a323f1388dad0d819`, with protocol v1, schema v1 and
Integration API v1. The current release asset is the package produced by
`npm pack`; native Electron packaging is no longer part of the product.

The upstream 2.0.0 alignment changes operational storage to SQLite: ForgeLoop owns
project classification — including the canonical Flutter specialist route and
the expanded multi-language guide set — provider execution, lifecycle events
and completion authority, while ForgeLoopAudit remains a read-only consumer of
canonical read models. ForgeLoop is licensed under PolyForm Noncommercial
1.0.0 with public publish access. The release embeds the controlled vendored
runtime tarball for offline use, including its license. Node.js 24.19.0 or newer
is required; upstream package metadata is not a registry-publication receipt.

The machine-readable asset authority is
[`release-matrix.json`](releases/release-matrix.json). It describes one
platform-neutral npm tarball plus the supported Node/browser runtime family.

## Public release contract

A tag-triggered workflow must:

- check out the tagged source and verify the package version;
- run `npm run verify:full`;
- build the renderer/server package and run `npm pack`;
- generate a SHA-256 checksum for the tarball;
- generate `SBOM-cyclonedx.json`; and
- upload the package, checksum and SBOM as workflow artifacts.

The current artifact is an unsigned preview. Signing, notarization, registry
publication and production deployment are separate claims and are not implied
by a local build or a successful CI job.

## Verification boundaries

| Stage | Proves | Does not prove |
| --- | --- | --- |
| Local verification | The shared `verify:full` contract passes in the current checkout | Public publication, deployment or tag identity |
| Pull-request CI | The contract and browser smoke pass on Ubuntu, macOS and Windows | Publication or signed trust |
| Workflow rehearsal | The web package, checksum and `SBOM-cyclonedx.json` can be generated | Public release availability |
| Tag-triggered workflow | The tagged source produced the uploaded npm package and metadata | Signing, notarization or production deployment |

Do not infer ForgeLoop lifecycle completion, npm publication or production
deployment from release-package verification. Those are independent states.

See [Quality gates](QUALITY_GATES.md) for the shared contract and the
[migration report](migration/WEB_IMPLEMENTATION_REPORT.md) for the completed
web delivery boundary.

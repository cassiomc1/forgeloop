# Core npm package contents

This page describes the intentional boundary of the published
`@cassiomc1/forgeloop` package. The [`files`](../package.json) list in
`package.json` is the packaging source of truth, while the repository's
`tests/package.test.js` and clean-room `scripts/package_smoke.mjs` checks keep
the boundary executable. Those test files are repository tooling and are not
part of the consumer tarball.

## Consumer surface

The package exposes the `forgeloop` executable from `src/cli.js` and the
`@cassiomc1/forgeloop/integration` subpath from `src/integration.js`, with its
declaration file. The package has no runtime dependencies and requires Node.js
20 or newer.

## Included files

The published tarball includes the following consumer-facing groups:

- **Runtime and protocol:** every maintained JavaScript module under `src/`,
  the guide registry, protocol templates, JSON schemas, completions, and the
  generic CI verifier. Four retired compatibility helpers remain in the
  repository for historical context and are explicitly excluded:
  `src/core/cli-metadata.js`, `src/core/decision-classification.js`,
  `src/core/gates.js`, and `src/core/workflow-compatibility.js`.
  This includes the provider-neutral Repository Index runtime and its pinned
  `src/repository-index/tgrep-manifest.json`; native engine binaries are
  provisioned outside the npm tarball.
- **Specialist guidance:** every registered consumer guide under `ENG/`,
  including `ENG/flutter-development-eng.md`, ships with the guide registry
  and is resolved from a package-local path. The Flutter specialist is
  selected only for an affected root with the structural SDK dependency
  signal; the package does not install or invoke Flutter tooling.
- **Initialization material:** the root protocol and integration documents,
  legal notices, the target profile template, and every path listed by
  `src/core/templates.js`. These files are read by `init` and `update`, so
  they are part of the executable consumer contract even when a document is
  marked deprecated in the documentation manifest.
- **Benchmark inputs:** execution-profile scenario definitions and their
  README. They make new measurements reproducible; historical measurements
  and generated results are repository evidence and are excluded.
  Repository Index query inputs and benchmark instructions are also shipped;
  generated local repositories and measurements are not.
- **User documentation:** the getting-started, integration, CLI, artifact,
  Repository Index, Persistent Search Transport, troubleshooting, release,
  package-boundary, and related reference pages.
  The advisory-context and Ripwire adapter guides ship with the corresponding
  public integration surface.
  The typed diagram sources, generated HTML/SVG/receipt artifacts, and
  source-bound review records under `docs/diagrams/` are included together so
  the packaged documentation keeps its visual provenance.
- **Release tooling:** the selected deterministic generators, validators,
  benchmark helpers, and shell completions needed by maintainers who consume
  the source kit.

## Excluded files

The tarball intentionally omits repository-only material:

- tests, conformance fixtures, coverage output, and secret-scanning helpers;
- local `.forgeloop` state, task ledgers, locks, transactions, and execution
  receipts (the `.forgeloop/forgeloop.gitignore` template is the sole
  exception);
- raw or aggregate benchmark results, package archives, and release train
  contracts;
- the Ripwire retrieval benchmark runner, cases, and fixture corpus; those
  maintainer-only files require a clean repository checkout and are not part of
  the consumer adapter surface;
- historical release plans and retired MCP adapter sources; the MCP adapter
  is published as its own package;
- the repository README hero PNG, which is a GitHub-only asset. The packaged
  README remains intentionally text-first around that relative repository
  image reference.

The package test checks both required paths and these exclusion classes. It
also enumerates `src/**/*.js` and fails if a maintained runtime module is
missing from the candidate tarball or if a retired helper is reintroduced.
The repository index remains a catalog: links from `DOCS_INDEX.md` to tests,
proof-of-concept evidence, historical plans, and source trees may intentionally
resolve only in the full repository and are not package dependencies.

## Verification and publication

Run the following checks from a clean checkout before opening a release PR:

```bash
npm pack --dry-run --json
npm run pack:check
npm run pack:smoke
```

`pack:smoke` installs the candidate tarball into a temporary consumer and
exercises the CLI, public Integration API, initialization, schemas, and
packaged documentation references. The package-boundary tests also assert
that every registered guide path, including the Flutter specialist, is
present in the candidate. The tag-triggered publication workflow
runs the same smoke gate before `npm publish --provenance --access public`.
Publication therefore remains owned by the trusted GitHub Actions OIDC
workflow; local package inspection proves the candidate boundary but does not
publish it.

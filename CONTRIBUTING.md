# Contributing to ForgeLoop

## Before opening a pull request

Run `npm run verify:prepush` before opening a pull request. For fast feedback,
use `npm run verify:fast`; the full suite and coverage gate are run once by
the local pre-push tier and by the PR core workflow. Run `npm run mcp:setup`
explicitly when MCP checks are in scope. Keep CLI metadata, generated
references, schemas, completions, summaries, and conformance scenarios
aligned. Do not add vendor-specific runtime behavior: ForgeLoop remains a
file-backed protocol and support CLI.

The ordinary PR workflow is intentionally path-aware. `pr-core.yml` always
publishes the ruleset contexts `audit`, `CodeQL`, `Verify generated Archify
diagram`, `validate (22)`, `tarball smoke (ubuntu-latest)`, and
`dependency-review`; `validate (22)` fails closed if an applicable job fails
or is skipped unexpectedly. Broader main-branch and release workflows provide
the explicit cross-platform, package, Windows, documentation, and audit
coverage that is not duplicated on every pull request.

## Protocol changes

Any persisted artifact or lifecycle change must preserve the published schema
compatibility policy, add valid and invalid fixtures, update `protocol-info`,
and include a recovery path for interrupted writes. A breaking protocol change
requires a new explicit protocol version and migration plan.

## Documentation & MCP verification

- Follow [`docs/DOCUMENTATION_GUIDE.md`](./docs/DOCUMENTATION_GUIDE.md); run
  `npm run docs:generate`, `npm run completions:generate`, and
  `npm run summary:generate` before `npm run docs:check` when canonical
  registries change.
- Changes under `integrations/mcp/` require `npm run mcp:test`, and package
  changes require `npm run mcp:pack:check`.
- `npm run mcp:test` never installs dependencies. If the MCP package is not
  set up, run `npm run mcp:setup` explicitly when installation is authorized.

## Frozen repository validators

The supported local Python command is `python3 -m unittest discover -s tests`.
The frozen validators require Python 3.9 or newer and are compatibility tools
used by CI; they are not a replacement for the Node test suite.

## Release and performance checks

Use `npm run coverage` followed by `npm run critical-coverage:check` for
coverage gates. `npm run performance:check` measures the median startup time of
the read-only `protocol-info` command using a broad shared-runner budget.
Historical link exclusions in `.lychee.toml` are reviewed manually at least
quarterly and must not be removed automatically.

## Review expectations

PRs must explain the task contract, verification evidence, migration impact,
and compatibility impact. Never commit secrets, external credentials, or
unverified publication claims.

## Focused verification and maintenance

`npm test -- tests/transaction.test.js` runs a selected file. Directories select
all nested test files; helpers and fixtures are excluded. Name filters such as
`npm test -- --test-name-pattern='transaction' tests/transaction.test.js` are
forwarded to Node. Unsupported options and unmatched selectors fail explicitly.

Run `npm run complexity:check` with lint. Reductions are welcome; increases to
the committed hotspot budget require an explicit explanation and review.
TypeScript and YAML are development-only dependencies for packed-consumer and
semantic workflow verification; the core runtime has no npm dependencies.

Transaction payload maintenance is opt-in:
`npm run transactions:compact -- --path /path/to/project --retain-days 7`
previews the operation; add `--apply` to compact eligible payloads. Manifests,
ledgers, recent transactions, and ambiguous outcomes remain intact. See the
[Astra implementation record](docs/ASTRA_IMPLEMENTATION.md) for boundaries.

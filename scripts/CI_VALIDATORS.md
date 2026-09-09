# Frozen CI-only validators

The Python validators are retained as compatibility checks for repository
contracts that predate the Node test suite:

- `validate_markdown.py` checks Markdown structure, frontmatter, links, code
  fences, guide metadata, and adapter/documentation consistency.
- `validate_loop_system.py` checks the universal loop, instruction boundaries,
  routing metadata, and protocol wording.
- `scan_secrets.py` checks repository text for secret-shaped values and is also
  exercised by its Python unit tests.

They are deliberately frozen as CI-only tooling. The current migration does
not replace them with a second Node implementation because doing so would
change the historical scanner and validator contracts without a dedicated
parity project. They are not runtime dependencies, are not shipped as the CLI
runtime, and are not required by `npm install`.

The minimum supported Python version for these validators is Python 3.9. CI
must select or verify Python 3.9 or newer before invoking the frozen commands.

## CI invocation

```bash
python3 -m unittest discover -s tests -v
python3 scripts/validate_markdown.py --self-test
python3 scripts/validate_markdown.py
python3 scripts/validate_loop_system.py --self-test
python3 scripts/validate_loop_system.py
python3 scripts/scan_secrets.py
```

The Node suite and Python suite have separate ownership: Node tests cover CLI,
protocol behavior, schemas, and execution evidence; Python remains the
compatibility gate for these repository-wide textual invariants.

## Distinguishing CI Link vs Infrastructure Failures

Maintainers should distinguish between actual documentation link failures and external CI/action infrastructure errors:

- **Link-content failure (`Lychee`)**: The link checking step runs with `--verbose` and outputs the exact failing URL along with the HTTP status code (e.g. 404, 403). If a documentation URL is broken, update the link in the source Markdown. If a legitimate external host blocks shared CI runners or aggressively rate-limits CI automation, add a minimal, targeted exclusion in `.lychee.toml` with an explanatory comment.
- **Action-download / Runner infrastructure failure (GitHub 429/502/503)**: When GitHub Actions fails during action checkout or tool download before running the test steps, this is a transient infrastructure issue rather than a project defect. Rerun the workflow without modifying project files.

## Validation tiers

The local runner makes the validation boundary explicit and never installs a
missing tool implicitly:

| Tier | Command | Intended use |
| --- | --- | --- |
| Fast | `npm run verify:fast` | feedback while editing; quick Node, lint, dependency-policy, and generated-doc checks |
| Local | `npm run verify:local` | full deterministic source, documentation, manifest, and frozen Python checks |
| Pre-push | `npm run verify:prepush` | coverage, critical coverage, package/MCP checks, PoC checks, and the local suite expected before a PR |
| Release | `npm run verify:release` | pre-push checks plus package smoke, benchmark/profile checks, performance, release-identity prerequisites, and `npm pack --dry-run --json` |

Run `npm run mcp:setup` explicitly when the MCP package is not installed and
the MCP checks are in scope. If Python or another external validator is
unavailable, report `NOT_VERIFIED`; do not turn an unavailable check into a
pass by installing an unapproved tool.

The release tier reports `NOT_VERIFIED` until both
`FORGELOOP_RELEASE_VERSION` and `FORGELOOP_RELEASE_COMMIT` are supplied. When
present, those values are passed to the canonical `release:identity` command;
the runner never invents a release SHA or treats a pre-publication identity as
valid.

`npm run verify:prepush` deliberately runs coverage once and does not repeat
the full suite as a second `npm test`. `npm run lint`,
`npm run complexity:check`, and `npm run critical-coverage:check` retain
independent purposes: syntax and usage correctness, hotspot growth, and
coverage of critical modules. Packed TypeScript consumers validate the public
declarations; YAML-based tests validate workflow semantics. The core runtime
remains dependency-free.

## GitHub Actions boundary

Ordinary pull requests use `.github/workflows/pr-core.yml`. It preserves the
ruleset's exact required contexts:

- `audit`
- `CodeQL`
- `Verify generated Archify diagram`
- `validate (22)`
- `tarball smoke (ubuntu-latest)`
- `dependency-review`

`validate (22)` is an always-present, fail-closed aggregator over the core
matrix and the path-applicable documentation, audit, package, and native
Repository Index jobs. An optional Repository Index job may be skipped only
when the classifier says that the change cannot affect it; the aggregator
rejects every unexpected skip, failure, or cancellation. The aggregator is
the status required by the branch ruleset, not a second copy of the Node
suite.

The path classifier is deterministic and testable locally:

```bash
node scripts/ci-scenario-check.mjs
node scripts/ci-classify.mjs --paths README.md --json
node scripts/ci-classify.mjs --all --json
```

Documentation-only pull requests use quick core validation plus the
documentation/diagram path. Runtime and package changes use Node 20 and Node
24 core validation, with coverage collected once on Node 24. Repository Index
changes retain the native reusable workflow and its platform matrix. Package
smoke is Ubuntu-only on ordinary PRs and expands to macOS/Windows through the
explicit release matrix. The main branch retains dedicated documentation,
Node compatibility, package smoke, audit, and Windows full-suite workflows;
those workflows are the place for broader post-merge or release validation.

CodeQL and dependency review remain independent GitHub security gates. The
repository's GitHub secret scanning and push protection remain enabled; the
custom `scan_secrets.py` check is a local/pre-push compatibility validator and
is not duplicated in every ordinary PR job.

## Receipts and infrastructure failures

`scripts/audit-receipts.mjs` runs after checkout. It audits supplied scoped
receipts with explicit task IDs, fails on an invalid audit, and reports
`NOT_VERIFIED` when none are supplied. This repository job does not create
lifecycle evidence from CI test results.

Maintainers should distinguish actual validation failures from external
CI/action infrastructure errors. A Lychee link failure identifies the exact
URL and status; update Markdown or add only a targeted, explained exclusion
for a legitimate shared-runner restriction. An action-download or runner
failure before project steps begin (for example GitHub 429/502/503) is
infrastructure and should be retried without changing project files.

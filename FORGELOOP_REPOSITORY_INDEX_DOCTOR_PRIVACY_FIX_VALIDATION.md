# ForgeLoop Repository Index Doctor Privacy Fix Validation

## Verdict

**PASS for local validation.** The P1 public-serialization leak is fixed in the
candidate branch. The implementation keeps the internal Repository Index
paths canonical and absolute, while doctor exposes only sanitized status data
and the useful repository-relative index path
`.forgeloop/repository-index/tgrep`.

The focused PR was not merged, no release was started, and no package was
published.

## Scope and provenance

- Baseline merged `main`: `f82a393c8dee859d51ede2715f2183dc0084459a`
- Candidate implementation commit: `c362f3cd8229dec82be611e51caccf6d3ff6ce89`
- Validation branch: `codex/post-merge-search-privacy-fix`
- Additional regression-test commit: `1bb68560f7ae1fc17e287eb851ceea8eed0fa769`
- Package version: unchanged at `1.10.2`
- PR #156 and PR #157: not modified

## Root cause and remediation

The merged doctor command requested internal Repository Index status with
local paths enabled, then copied the absolute `indexPath`, diagnostics, and
finding evidence into its public result. This affected non-ready states such
as `ENGINE_MISSING`.

The remediation uses the existing canonical
`sanitizeRepositoryIndexStatus` boundary before constructing the public
doctor projection. It keeps the internal status available for the READY smoke
search, but emits sanitized engine/status/server/diagnostic values, a fixed
repository-relative `indexPath`, and sanitized finding evidence. No internal
path validation, ownership check, tgrep lifecycle, binary verification,
search, persistent transport, Integration API, or MCP behavior was changed.

## Exact before/after privacy probe

The probe runs the same `doctor --json` scenario against the merged baseline
and the candidate with an unavailable managed engine and an isolated HOME.
Only boolean results are recorded here; machine-specific paths are omitted.

| Result | Baseline | Candidate |
| --- | ---: | ---: |
| Status | `ENGINE_MISSING` | `ENGINE_MISSING` |
| Exit code | `1` | `1` |
| Top-level index path is absolute | `true` | `false` |
| Serialized result contains target path | `true` | `false` |
| Serialized result contains isolated HOME | `true` | `false` |
| Finding evidence contains target path | `true` | `false` |

The candidate retains the public value
`.forgeloop/repository-index/tgrep`.

## State matrix

| State/surface | Observed result | Privacy result |
| --- | --- | --- |
| `ENGINE_MISSING` doctor | Status preserved; doctor remains unhealthy as expected | Complete serialized result contains no target, HOME, or binary path |
| `NOT_INITIALIZED` doctor/status | Status preserved; Integration API returns `NOT_INITIALIZED` | No target, HOME, or binary path; no path-bearing status keys |
| `READY` doctor | Status `READY`; smoke search `OK` | Relative index path retained; exact target/HOME/binary checks false |
| `READY` index-status | Health `READY`; owned server status preserved | Sanitized public status has no absolute path fields |
| `READY` search | Search returned the expected fixture match and used the persistent server | Exact target/HOME/binary checks false; repository match content remains unchanged |
| Stale metadata/server down | `SERVER_DOWN` or `SERVER_UNHEALTHY` as applicable | Diagnostics remain useful and sanitized |
| Ownership mismatch | `SERVER_UNHEALTHY` with the ownership diagnostic code | No absolute path fields or path-bearing diagnostic values |
| Binary validation failure | `ENGINE_MISSING` with the canonical diagnostic code | Diagnostic detail remains while local binary path is removed/redacted |

The degraded-state probes used disposable metadata only. Existing POSIX and
Windows-style sanitizer fixtures also passed without exposing their synthetic
user/project roots.

## Public-surface audit

The Repository Index and doctor implementations were inspected for
`repositoryRoot`, `indexPath`, `binaryPath`, `statePath`, `endpoint`, `cwd`,
socket, temporary-directory, and server metadata exposure. Internal endpoint,
state, binary, and working-directory values remain internal to lifecycle and
process ownership code. Public projections use relative repository paths or
omit host-local values.

Validated surfaces:

- `doctor --json`
- `index-status --json`
- `search --json`
- `protocol-info --json`
- core Integration API and `repository/index-status` resource
- MCP `repository/index-status` resource and parity tests
- diagnostics, errors, and finding evidence

Search results continue to expose repository-relative match paths and match
content. A generic absolute-string scan was not used to reject repository
content itself; the exact runtime target, isolated HOME, and binary metadata
checks were all false.

## Tests and checks

All commands below exited successfully unless explicitly classified as
`NOT_VERIFIED`.

- Focused doctor/privacy tests: **6/6 passed**
- Public-surface tests: **passed**
- Repository Index and persistent-transport targeted regression: **108/108 passed**
- Full `npm test`: **passed**
- `npm run coverage`: **passed** — lines 86.97%, functions 86.23%, branches 76.35%
- `npm run lint`: **passed**
- `npm run dependency:policy`: **passed**
- `npm run complexity:check`: **passed**
- `npm run critical-coverage:check`: **passed**
- `npm run pack:check`: **passed**
- `npm run pack:smoke`: **passed**
- `npm run mcp:test`: **passed**
- `npm run mcp:pack:check`: **passed**
- `npm run docs:check`: **passed**
- `npm run docs:diagrams:check`: **passed**
- `npm run docs:generated:check`: **passed**
- `npm run docs:conformance`: **passed**
- `npm run docs:examples:check`: **passed**
- `npm run summary:check`: **passed**
- `npm run completions:check`: **passed**
- `npm run repository-index:manifest`: **passed**
- `python3 -m unittest discover -s tests -v`: **passed**
- `python3 -m unittest tests.test_scan_secrets -v`: **passed**
- `python3 scripts/validate_markdown.py --self-test`: **passed**
- `python3 scripts/validate_markdown.py`: **passed**
- `python3 scripts/validate_loop_system.py --self-test`: **passed**
- `python3 scripts/validate_loop_system.py`: **passed**
- `python3 scripts/scan_secrets.py`: **passed**
- `npm run poc:evidence:verify`: **passed**
- `npm run poc:evidence:test`: **passed**
- Static path-serialization audit: **no additional public leak found**

## Classification

- **P0:** none found
- **P1:** fixed — absolute Repository Index paths no longer appear in the public doctor projection
- **P2:** none found in scope
- **P3:** none found in scope
- **NOT_VERIFIED:** exact-head cross-platform CI was not available before publication; it is required on the new PR before any merge recommendation

## Publication state

Local validation is **PASS** and authorizes the focused branch publication.
The new PR must run the applicable Linux, macOS, Windows, native Repository
Index, persistent transport, package smoke, MCP, CodeQL, dependency, docs,
and ForgeLoop audit checks at its exact final head. Merge, release 1.11.0,
tagging, npm publication, and production deployment remain out of scope.

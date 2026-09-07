# Ripwire advisory adapter

This document explains the optional Ripwire integration shipped with
ForgeLoop. It is an advisory context provider. It can help a host choose
which source files to inspect, but it never controls ForgeLoop state, checks,
receipts, commands, approvals, or completion.

## When to use it

Use the adapter when a host already has a qualified Ripwire executable and
wants ranked source signatures for an explicit task query. Do not use it as a
replacement for tests, code review, lifecycle evidence, or a sound call graph.
Ripwire's resolver is approximate: same-file and same-directory edges are
useful hints, while ambiguous or unresolved edges can be missing or wrong.

ForgeLoop does not install Ripwire, search `PATH`, contact a server, create a
cache, or persist a recall. The host owns executable selection and version
qualification.

## Registration

Import the factory from the public integration entry point and register the
returned provider under the exact `ripwire` key:

```js
import {
  createForgeLoopContext,
  createRipwireAdvisoryContextProvider,
  recallAdvisoryContext,
} from "@cassiomc1/forgeloop/integration";

const ripwire = createRipwireAdvisoryContextProvider({
  executablePath: "/absolute/path/to/ripwire",
  expectedVersion: "0.3.8",
});

const runtimeContext = createForgeLoopContext({
  advisoryContextProviders: { ripwire },
});

const context = await recallAdvisoryContext({
  target: "/absolute/path/to/project",
  taskId: "task-123",
  providerName: "ripwire",
  query: "stale handoff acceptance and repository fingerprint",
  limit: 6,
  runtimeContext,
});
```

`executablePath` must be absolute. `expectedVersion` is an exact version token,
not a range. Provider construction is inert. On every recall the adapter first
runs `ripwire --version`; a mismatch fails with
`E_ADVISORY_CONTEXT_PROVIDER_INVALID` before the query is attempted.

## Process contract

The adapter invokes one command with an argv array:

```text
<ripwire-path> <absolute-project-path> \
  --for=<entire-query-string> --signatures-only --json --no-cache \
  --exclude=.forgeloop
```

The query is one argument, so shell metacharacters cannot add arguments or
commands. The child is started with `shell: false`, standard input is closed,
and stdout/stderr are read concurrently. A single deadline covers the version
probe and query. The default transport ceilings are 1 MiB for stdout and 64
KiB for stderr. On timeout or overflow the child is terminated and the error
uses a stable ForgeLoop code; raw output is not copied into the message.

The `.forgeloop` exclusion keeps lifecycle files out of the advisory source
surface. The adapter does not add other exclusion flags because every flag
must be qualified against the selected Ripwire version.

## JSON mapping

Ripwire's `--for --json` response is expected to be an object containing a
flat `sigs` array. Each known row is mapped as follows:

| Ripwire field | ForgeLoop field | Rule |
| --- | --- | --- |
| `n` | `title` | Candidate symbol name. |
| `sig` | `summary` | Signature text, bounded before core normalization. |
| `p` + `l` | `sourceRef` | Repository-relative path and one-based line. |
| `r`, `k` | summary annotation | Rank and ranking score remain descriptive text. |
| numeric `confidence` in `[0, 1]` | `confidence` | Copied only when the upstream field is explicitly numeric and bounded. |
| `at` | omitted | A run timestamp or revision is not needed for deterministic item identity. |

PageRank, BM25, margin, and other ranking values are never converted into a
probability. Unknown fields are discarded by the core allowlist. Candidate
order is preserved, duplicates are removed by stable first occurrence, and
items stop when the requested item or total-character budget is reached.

The first item is always `Ripwire advisory status`. It states that the result
is approximate and carries bounded disclosures such as `capped`, `sigs_total`,
`sigs_shown`, `lens`, `ambiguous`, `unresolved`, `unindexed`, parse health, and
`index_completeness=unknown`. If no symbol fits, the status item says so; an
empty result never proves that the project has no impact.

Source references are rejected when they are absolute outside the project,
contain traversal segments, use an in-project symlink, or report an invalid
line. The host must still inspect the referenced file and independently verify
the proposed change.

The status item is budget-aware. When candidates or diagnostic notices do not
fit, it preserves a truthful completeness warning and says which candidate
rows or text were omitted. The final item total is checked against the same
character budget used by the core advisory normalizer.

## Failure codes

| Situation | Code |
| --- | --- |
| Missing or unqualified executable or unsafe target | `E_ADVISORY_CONTEXT_PROVIDER_UNAVAILABLE` |
| Nonzero process exit without a qualified meaning | `E_ADVISORY_CONTEXT_RESULT_INVALID` |
| Expected version differs from `--version` output | `E_ADVISORY_CONTEXT_PROVIDER_INVALID` |
| Invalid JSON or unsupported response shape | `E_ADVISORY_CONTEXT_RESULT_INVALID` |
| Timeout | `E_ADVISORY_CONTEXT_TIMEOUT` |
| Stdout/stderr or candidate ceiling exceeded | `E_ADVISORY_CONTEXT_OUTPUT_LIMIT` |
| Secret or control character in selected context | `E_PORTABLE_CONTEXT_INVALID` |

These failures affect the explicit recall operation only. They do not change a
ForgeLoop task phase and do not write `.forgeloop` state.

## Verification

The deterministic fixture tests run without a Ripwire installation:

```bash
node --test \
  tests/ripwire-advisory-process.test.js \
  tests/ripwire-advisory-normalize.test.js \
  tests/ripwire-advisory-provider.test.js
```

The real-binary smoke test is opt-in. Set both variables to a host-qualified
binary and version, then run:

```bash
FORGELOOP_TEST_RIPWIRE_PATH=/absolute/path/to/ripwire \
FORGELOOP_TEST_RIPWIRE_VERSION=0.3.8 \
node --test tests/real-ripwire-advisory.test.js
```

Without those variables the test is skipped and interoperability remains
`NOT_VERIFIED`. When it runs, it requires a candidate reference to the known
fixture source and compares the complete fixture tree before and after recall,
so a binary that mutates the project fails the test. The test does not install
software or discover a binary.

## Retrieval benchmark

`benchmarks/ripwire-context/cases.json` freezes six task-shaped queries,
expected files, lexical baseline terms, and the ForgeLoop commit used for the
comparison. Run the benchmark only against a clean checkout and an explicitly
qualified binary:

```bash
node scripts/benchmark-ripwire-context.mjs \
  --project /absolute/path/to/forgeloop \
  --ripwire-path /absolute/path/to/ripwire \
  --version 0.3.8 \
  --cases benchmarks/ripwire-context/cases.json \
  --runs 5 \
  --json
```

The report includes per-case and per-run expected-file coverage, misses,
irrelevant references, baseline bytes, normalized adapter bytes, transport
bytes when observed, and median/min/max durations. A file seen in only one
repetition is reported as observed across runs but does not count as a
consistently found file. A missing binary, version, dirty checkout, or commit
mismatch produces `NOT_VERIFIED`; it is never reported as a performance win.

## Scope boundary

The adapter is intentionally limited to source-map retrieval. It does not
implement Ripwire's body packing, impact commands, cache management, server
mode, automatic file reads, lifecycle transitions, evidence production, or
publication. Those features require a separate contract and separate
qualification work.

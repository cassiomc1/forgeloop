# Ripwire advisory context integration: implementation plan

Status: proposed implementation; no adapter has been implemented by this document.

Prepared: 2026-09-06.

Audience: a coding agent that needs explicit instructions, file locations, and acceptance criteria.

## 1. Read this first

Implement an **optional Ripwire adapter** that helps a host find relevant source code before making a change. Reuse ForgeLoop's existing advisory context API.

The first delivery is a small, tested adapter plus a reproducible comparison against ordinary repository search. It does not include a code editor, automatic test execution, a new lifecycle, or a new quality gate.

This document is a plan, not authorization to execute it. When the user explicitly requests implementation, implement Sections 2–13. Section 14 is a separate roadmap and is not part of that first delivery unless explicitly requested.

Do not interpret creating this Markdown file as implementing the integration.

### Definitions

| Term | Meaning in this plan |
| --- | --- |
| Host | The IDE, agent harness, or application that calls ForgeLoop's Integration API. |
| Adapter | Code that runs a supported Ripwire query and converts its result into ForgeLoop advisory items. |
| Advisory | Information that may guide investigation but cannot approve work, pass a check, or change protocol state. |
| Symbol | A source-code definition, such as a function, class, or method. |
| Fixture | A small, fixed input or output used in a test. |
| Qualified version | A specific Ripwire binary version whose output and behavior were actually checked. |
| MVP | The first delivery defined in Sections 2–13. |

## 2. Outcome and boundaries

After implementation, an embedding host can explicitly request context for a task, receive a bounded list of source references and signatures, and continue normally if Ripwire is unavailable.

Example user need: "Find the code that rejects a stale handoff."

Expected behavior:

1. The host already knows the target project and task ID.
2. The host explicitly calls `recallAdvisoryContext` with provider name `ripwire`.
3. The adapter queries an already installed, host-selected Ripwire executable.
4. The adapter returns source references, useful text, and an explanation of limitations.
5. ForgeLoop applies its existing normalization and advisory trust labels.
6. The coding agent reads the referenced current source before editing it.
7. Required tests and completion checks still run through the existing protocol.

Never claim that a suggested test was executed, that a graph edge is certain, or that an empty result proves no impact.

### Included in the MVP

- Explicit host registration through `advisoryContextProviders`.
- One operation: task-oriented source discovery using Ripwire `--for`.
- Signatures and source references rather than automatic full function bodies.
- Bounded subprocess execution and bounded normalized output.
- Honest treatment of omitted sections, ambiguous relationships, and truncated results.
- Tests with a fake executable and versioned output fixtures.
- An opt-in real-binary smoke check and a small retrieval benchmark.
- Documentation and public JavaScript/TypeScript API parity.

### Excluded from the MVP

- Installing, downloading, bundling, or automatically upgrading Ripwire.
- Ripwire MCP server management or automatic provider discovery.
- A `forgeloop context-recall` CLI command or a new MCP tool.
- Running any command suggested by Ripwire output.
- Automatically changing selected guides, claims, verification scope, or required checks.
- Writing recall queries or results into `.forgeloop/`, receipts, or event history.
- Adding a vector database, embedding model, index server, or background watcher.
- Replacing Sentrux or changing `structuralQuality` scoring.
- Publishing a package, creating a release, deploying, or merging without the user's corresponding instruction.

## 3. Confirmed starting point

The inspected ForgeLoop checkout was version `1.10.1`, commit `30aa49e359c723bcb8c786a7af969016bd12b02c`. Recheck the current checkout before implementation. This is a reference baseline, not an instruction to reset Git.

The project already has these components:

| Existing file | Existing responsibility | How to use it |
| --- | --- | --- |
| [src/integration.js](src/integration.js) | Public Integration API exports | Export the new adapter factory here. |
| [src/integration.d.ts](src/integration.d.ts) | Public TypeScript declarations | Add matching declarations for the new factory. |
| [src/core/runtime-context.js](src/core/runtime-context.js) | Host runtime context and provider registration | Reuse registration; do not add automatic registration. |
| [src/core/advisory-context/service.js](src/core/advisory-context/service.js) | Explicit recall, provider resolution, limits, timeout | Call through this service; keep its existing contract. |
| [src/core/advisory-context/provider.js](src/core/advisory-context/provider.js) | Provider validation and allowlisted result normalization | Return compatible items; do not bypass normalization. |
| [src/core/advisory-context/constants.js](src/core/advisory-context/constants.js) | Canonical recall budgets and trust labels | Import these limits instead of creating a competing policy. |
| [src/core/execution-profile-context.js](src/core/execution-profile-context.js) | Read-only task context projection | Preserve its lazy behavior. Reading context must not launch Ripwire. |
| [docs/ADVISORY_CONTEXT.md](docs/ADVISORY_CONTEXT.md) | Advisory integration documentation | Add a short registration example and link to the adapter guide. |

The existing item fields are `title`, `summary`, `sourceRef`, `observedAt`, and numeric `confidence`. The core adds `itemFingerprint` after normalization. Unknown fields are discarded.

The existing trust result is:

```json
{
  "authority": "ADVISORY",
  "evidenceAuthority": "NONE",
  "actionability": "NON_EXECUTABLE",
  "trustRole": "NON_EVIDENCE_ADVISORY_CONTEXT",
  "persisted": false
}
```

Keep those semantics unchanged. A provider ID or version is descriptive metadata, not proof of executable identity or trusted authority.

## 4. File-by-file implementation map

Paths in this document are relative to the ForgeLoop repository root. Files marked **new** do not exist merely because this plan names them.

| File | Action | Exact responsibility |
| --- | --- | --- |
| `src/adapters/ripwire/provider.js` | New | Export `createRipwireAdvisoryContextProvider`; validate host configuration; implement `recall`. |
| `src/adapters/ripwire/process.js` | New | Launch the bounded native executable with an argument array; collect output; stop the process on timeout or overflow. |
| `src/adapters/ripwire/normalize.js` | New | Validate supported JSON, map symbols to items, preserve limitations, and fit character budgets. |
| `src/integration.js` | Update | Re-export the factory; importing the API must not inspect or launch a binary. |
| `src/integration.d.ts` | Update | Declare factory options and return type using `ForgeLoopAdvisoryContextProvider`. |
| `tests/ripwire-advisory-provider.test.js` | New | Test factory behavior, registration, public exports, and recall through the existing service. |
| `tests/ripwire-advisory-process.test.js` | New | Test argv boundaries, failure codes, timeouts, output limits, and cleanup. |
| `tests/ripwire-advisory-normalize.test.js` | New | Test supported JSON shapes, limitations, path validation, ordering, and output budgets. |
| `tests/fixtures/ripwire/fake-ripwire.mjs` | New | Deterministic fake child process; it must not require a real Ripwire installation. |
| `tests/fixtures/ripwire/` | New directory | Tiny source corpus, versioned output examples, malformed examples, and fixture provenance. |
| `tests/real-ripwire-advisory.test.js` | New | Opt-in test using an already installed binary; skip explicitly when no path is supplied. |
| `scripts/benchmark-ripwire-context.mjs` | New | Run the bounded paired experiment described in Section 11. |
| `benchmarks/ripwire-context/cases.json` | New | Frozen queries and independently reviewed expected file sets. |
| `benchmarks/ripwire-context/README.md` | New | Explain the benchmark method, baseline, prerequisites, and result interpretation. |
| `docs/RIPWIRE_ADAPTER.md` | New | Explain setup, supported versions, use, errors, limits, and opt-in smoke/benchmark commands. |
| `docs/ADVISORY_CONTEXT.md` | Update | Link the guide and show explicit optional registration. |
| `DOCS_INDEX.md` | Update | Add the new adapter guide in the appropriate section. |
| `docs/documentation-manifest.json` | Update if required by current schema | Register the shipped adapter guide; follow existing records. |
| `docs/documentation-review-matrix.json` | Update if required by current schema | Add review coverage using the existing format. |
| `package.json` | Narrow update | Add `docs/RIPWIRE_ADAPTER.md` to the existing package file allowlist. Do not add a runtime dependency or change the package version. |
| `tests/package.test.js` | Narrow update | Assert that the packed artifact contains the adapter and guide and that the public export works. |
| `CHANGELOG.md` | Update | Add an unreleased entry consistent with current repository conventions. |

Do not modify `next-action`, lifecycle transitions, completion validators, canonical evidence schemas, or structural-quality providers for this MVP.

If a listed existing file was renamed, locate its current owner and record the substitution. Do not create a duplicate subsystem to match an old path.

## 5. Preparation and upstream qualification

### Step 1 — Prepare the ForgeLoop task

1. Read the current `AGENTS.md`, `LOOP_ENGINEERING.md`, `PROTOCOL_INTEGRATION.md`, `PROJECT_PROFILE.md`, and `GUIDE_ROUTER.md`.
2. Run `node src/cli.js task-list --json` before creating a task.
3. If this implementation already has a task, inspect it with `next --task <task-id> --json` and resume it. A new model or session is not a new task.
4. Inspect Git status and active write claims. Preserve unrelated changes. Use an isolated checkout if necessary; do not reclaim another task's files.
5. Create or validate the implementation contract and route before editing code. Include the files in Section 4, the exclusions in Section 2, and the checks in Section 12.
6. Select guides from actual signals. This implementation affects code, tests, external process input, documentation, and measured retrieval performance.
7. Require `preflight` to return `READY`. If structural quality is enabled, capture its baseline at the canonical pre-execution phase.

The source kit's `PROJECT_PROFILE.md` intentionally remains a template. Follow its maintenance rule; do not rewrite the distributed template as a machine-specific profile.

### Step 2 — Qualify the upstream boundary before writing a parser

The inspected upstream source revision was `93c8edaafdb5499e89939cc2cebd0429e278e86f`. The plan author inspected documentation, not a running Ripwire binary. A source revision is not a tested binary version.

Use the pinned references in Section 15, then:

1. Check whether a Ripwire binary is already available or supplied by the host. Do not install one implicitly.
2. Record its actual version and, for the smoke/benchmark report, its binary checksum and platform.
3. Confirm the exact argument combination and actual JSON output on a tiny JavaScript/TypeScript corpus.
4. Record the successful argv, root keys, result-array keys, required symbol keys, field types, and exit meanings in `tests/fixtures/ripwire/README.md`.
5. Capture fixtures from that known corpus. Use synthetic fixtures only for deliberately malformed or exceptional cases, and label them synthetic.
6. Add a compatibility test before implementing normalization. Reject unsupported shapes instead of guessing aliases for unknown fields.

Candidate invocation to qualify, **not an already verified command**:

```text
<absolute-ripwire-path> <absolute-project-path> --for=<query> --signatures-only --json --no-cache
```

Use a supported cap such as `--pack-top-n` only after confirming its effect on this exact mode. Do not assume `--top-k` bounds the normal `--for` bundle. Do not combine `--format=candidates` with `--json`: the inspected command documentation describes that combination as unsupported.

Ripwire JSON can omit sections that appear in XML. Preserve its omission indicators, including `lens` when present. Do not describe JSON as a complete copy of every XML section.

If no real binary is available, source-derived fixture work may proceed with explicit provenance, but real integration remains `NOT_VERIFIED`. Never invent a qualified binary version or mark a mocked run as a real smoke check.

## 6. Proposed public API

Add this factory to the existing Integration API. These names are **proposed**, not existing exports:

```typescript
export interface ForgeLoopRipwireProviderOptions {
  executablePath: string;
  expectedVersion: string;
}

export declare function createRipwireAdvisoryContextProvider(
  options: ForgeLoopRipwireProviderOptions,
): ForgeLoopAdvisoryContextProvider;
```

Rules:

- `executablePath` must be an absolute path selected by the embedding host.
- `expectedVersion` must identify a version qualified against the adapter's supported output shape. It is an exact compatibility expectation, not a trust grant.
- The returned provider has `id: "ripwire"` and a descriptive `version` corresponding to that expected version.
- Creating the provider and importing the module perform no subprocess execution, filesystem discovery, network request, or state mutation.
- Validate the actual binary version lazily during recall. Do not accept a configured version string as proof that the executable matches it.
- Do not offer public `command`, `shell`, `args`, or arbitrary query-mode options.
- Do not read executable configuration from contracts, provider output, or project task files.
- The host may register the factory lazily. Never register it by default.

Illustrative host usage after implementation:

```javascript
import {
  createForgeLoopContext,
  createRipwireAdvisoryContextProvider,
  recallAdvisoryContext,
} from "@cassiomc1/forgeloop/integration";

// ripwirePath and qualifiedVersion are supplied by the embedding host.
const runtimeContext = createForgeLoopContext({
  advisoryContextProviders: {
    ripwire: () => createRipwireAdvisoryContextProvider({
      executablePath: ripwirePath,
      expectedVersion: qualifiedVersion,
    }),
  },
});

const result = await recallAdvisoryContext({
  target: projectPath,
  taskId,
  providerName: "ripwire",
  query: "stale handoff repository fingerprint validation",
  limit: 6,
  runtimeContext,
});
```

The host handles an advisory error by displaying a short limitation and continuing with ordinary source inspection. It must not change canonical task status merely because this optional query failed.

## 7. Bounded process execution

Implement these rules in `src/adapters/ripwire/process.js`:

1. Use Node's native subprocess API with `shell: false` and an argv array.
2. Pass the entire query as one `--for=<query>` argument. Quotes, spaces, semicolons, and leading hyphens inside the query remain data.
3. Resolve and validate the target project directory. Use it as the query root and subprocess working directory. A target path must not be taken from Ripwire output.
4. Keep stdin closed. Do not start a daemon or interactive process.
5. Preserve default upstream redaction. Never pass `--no-redact`.
6. Disable upstream caching for the MVP with the qualified `--no-cache` path. Do not add an adapter result cache.
7. Prevent `.forgeloop` lifecycle/receipt content from becoming retrieved code context using a qualified exclusion for that directory. Verify the exclusion rather than inventing its flag semantics.
8. Keep normal upstream ignore behavior. Do not enable ignored-file crawling merely to increase result counts.
9. Count raw stdout and stderr bytes while streaming. Use an initial adapter-owned ceiling of 1 MiB stdout and 64 KiB stderr. These are transport limits, separate from the much smaller advisory item budgets.
10. Stop the child immediately on overflow; discard partial output and report an output-limit error.
11. Use one absolute deadline for version checking and querying combined. Do not spend the full timeout independently on each process.
12. Terminate active work on deadline expiry and clean up timers/listeners. Bound any termination grace period and test that the child exits. Reject late output.
13. Coordinate with the service timeout: the existing service uses `Promise.race`, which does not itself kill a subprocess. Adapter cleanup must run even when the outer service promise has already timed out.
14. Do not log raw queries, raw stdout, raw stderr, or environment variables on errors. Return a stable sanitized description and an error code.
15. Read and validate JSON only after successful process completion. Empty stdout is an error unless the qualified mode explicitly documents that representation.

Use the current canonical advisory error codes where they fit:

| Condition | Result |
| --- | --- |
| Executable missing or cannot be executed | `E_ADVISORY_CONTEXT_PROVIDER_UNAVAILABLE` |
| Invalid host options or unsupported/mismatched version | `E_ADVISORY_CONTEXT_PROVIDER_INVALID` |
| Deadline expired | `E_ADVISORY_CONTEXT_TIMEOUT` |
| Raw or normalized output exceeds a supported bound | `E_ADVISORY_CONTEXT_OUTPUT_LIMIT` |
| Invalid JSON, unsupported shape, or unexplained unsuccessful exit | `E_ADVISORY_CONTEXT_RESULT_INVALID` |
| Unsafe selected text | Preserve the existing portable-context validation error. |

If a qualified Ripwire exit code specifically means output-budget refusal, map it to the output-limit error. Document that mapping from the qualified version. Do not convert every nonzero exit into "no results."

For tests, use a private runner injection boundary inside the adapter modules. It may invoke the fake fixture through `process.execPath`. Do not expose this test seam as an arbitrary-command option in the public factory.

## 8. Normalization without changing the core item schema

Implement `normalize.js` as a pure conversion: input JSON and effective budgets in, advisory items out. It must not execute commands, read source bodies, or mutate task state.

### Preserve warnings in a first item

The core discards arbitrary result metadata. Therefore, do not return important warnings only in an extra property such as `diagnostics`.

Reserve item 1 for a bounded status summary with this information:

- Output is advisory and graph relationships may be approximate.
- Number of upstream candidates available in the parsed response and number returned by the adapter.
- Any upstream omitted sections, caps, ambiguity, unsupported-language, or parse-health information exposed by the qualified mode.
- Whether the adapter omitted candidate rows or shortened candidate text to fit budgets.
- Explicit `unknown` wording when this mode does not report indexing completeness.

Do not derive complete indexing from the absence of an error. Do not convert an upstream estimate such as `est_tokens` into measured model usage.

The status item counts toward `limit`. With `limit: 1`, return only the status item and say that no symbol items fit. With the default limit of 6, at most five symbol items follow.

If the full diagnostics cannot fit, retain a short mandatory warning that diagnostics were omitted and completeness is unknown. Never silently drop the last warning. If even the minimum truthful envelope cannot fit, return the output-limit error.

### Convert each candidate

| ForgeLoop field | Content |
| --- | --- |
| `title` | Symbol name, bounded by the existing title limit. |
| `summary` | Signature and useful qualified annotations; explicit marker if text was shortened. |
| `sourceRef` | Validated repository-relative path and positive line number, when actually reported. |
| `observedAt` | Omit in the MVP to keep unchanged fixture results deterministic. |
| `confidence` | Omit unless the upstream meaning is a documented numeric confidence in `[0,1]`. |

Do not map PageRank, BM25, a relevance score, or the string `high` to an invented probability. A textual ranking label may appear in `summary` with its actual meaning.

Validate every source path before exposing it:

1. Normalize relative separators for display.
2. Reject NULs, traversal outside the project, absolute paths outside the project, and invalid line numbers.
3. Confirm filesystem containment, including symlink resolution, in the provider boundary before normalization if filesystem access is needed.
4. Drop an invalid candidate and disclose that candidates were rejected. Do not expose unsafe paths.
5. Do not read the referenced file automatically. The host decides when to inspect current source.

Keep upstream ranking order. Use a stable identity such as path, line, and symbol name for deterministic deduplication. Do not rerank with an LLM.

Calculate the exact character total using the same fields counted by the core normalizer: title, summary, source reference, and optional timestamp. Reserve the status item before fitting candidates. Keep the result within the effective `limit`, `maxItemChars`, and `maxTotalChars` received from the service.

Return `{ items }` and let `recallAdvisoryContext` apply the canonical trust fields, safety checks, fingerprints, and freezing. Do not implement a second replacement for those mechanisms.

### Freshness boundary

Run a fresh query on each explicit recall. Preserve a qualified upstream revision/dirty marker in the status summary when available; otherwise label revision freshness unknown.

A commit plus `dirty` marker is not a content fingerprint of all modified files. This MVP must not claim an atomic repository snapshot or authenticated provenance. The agent must reopen current source before editing or relying on a reference. Stronger snapshot guarantees belong to a separately designed extension.

## 9. Implementation order

Do these steps in order. Each step has a concrete exit condition.

| Step | Work | Exit condition |
| --- | --- | --- |
| A | Complete protocol preparation and upstream qualification. | Valid task/preflight; fixture provenance states what was observed and what remains unverified. |
| B | Add fake child process and transport tests. | Failures, overflow, deadlines, and argv boundaries are reproducible without Ripwire installed. |
| C | Implement bounded process runner. | Transport tests pass; no child remains running after failure/timeout. |
| D | Add fixture-based conversion tests and implement normalization. | Status warnings survive; all output fits the core budgets; malformed data is rejected. |
| E | Implement provider factory and public export/declarations. | Public import and host registration work without starting a child. |
| F | Test explicit recall through the public service. | Existing trust labels and lazy lifecycle behavior remain unchanged. |
| G | Add guide, package inclusion, and documentation registration. | A packed consumer can import the adapter and read the guide. |
| H | Run the opt-in real smoke and benchmark where the tool is available. | A report distinguishes real observations, skipped checks, and measured results. |
| I | Run regressions and close the implementation task canonically. | Required checks are recorded; `complete` returns `VALID`, or exact blockers are reported. |

Do not claim all steps passed if H was skipped. It is possible to deliver a tested adapter with real-binary interoperability still explicitly `NOT_VERIFIED`; that is not proof of successful integration or of a speed improvement.

## 10. Required tests

Prefer meaningful boundary tests over tests that merely repeat implementation constants.

| ID | Scenario | Required assertion |
| --- | --- | --- |
| T01 | Import and construct the provider | No executable lookup, spawn, network call, or task write. |
| T02 | Register and read task context | Registration and read-only lifecycle/resource calls do not invoke the provider. |
| T03 | Explicit public recall | Provider executes and result has the exact canonical advisory trust labels. |
| T04 | Query contains quotes, spaces, shell metacharacters, or option-looking text | Query remains one argv value; no additional command or option executes. |
| T05 | Missing executable, denied execution, or wrong version | Correct failure; no installation attempt and no lifecycle change. |
| T06 | Hanging child | Call terminates within the bound and the actual child is stopped. |
| T07 | stdout or stderr flood | Child stops; partial result is not returned; no raw output appears in the error. |
| T08 | Invalid JSON or incompatible schema | Explicit invalid-result error, not an empty successful list. |
| T09 | Valid empty candidate set | Status item says no candidates were found; it does not claim no impact. |
| T10 | Upstream omission/cap/ambiguity fields | Limitations survive core normalization inside selected item text. |
| T11 | Small budgets, including `limit: 1` | Status item survives; candidate omission is explicit; every character bound holds. |
| T12 | Relevance score greater than 1 or confidence label `high` | No fabricated numeric probability. |
| T13 | Traversal, outside-root absolute path, symlink escape, invalid line | Unsafe candidate is rejected and disclosed without leaking an outside source reference. |
| T14 | Selected text contains a secret-like value or unsafe control character | Existing portable safety rejection remains in force; no raw payload is logged. |
| T15 | Raw provider fields claim authority, commands, or completion | Those fields cannot become executable instructions, evidence, or canonical state. |
| T16 | Same fixture and budgets twice | Same ordered item contents and fingerprints. |
| T17 | Real tiny corpus with a known function and caller | Expected source reference is found; output is normalized; tracked files and `.forgeloop` are unchanged. |
| T18 | Provider unavailable during ordinary ForgeLoop use | Existing lifecycle operations still work independently. |
| T19 | Package consumer | Factory exists in shipped JavaScript and TypeScript declarations; guide and adapter files are included. |

Use temporary fixture projects for mutation checks. Some canonical lifecycle commands legitimately write their own state; compare those against the same commands without the provider. The assertion is that recall adds no state writes, not that all lifecycle operations are read-only.

The real-binary test should use an explicit environment variable such as `FORGELOOP_TEST_RIPWIRE_PATH` only for selecting the test executable. No automatic PATH discovery or installation is necessary for normal CI.

## 11. Retrieval benchmark

Measure usefulness before claiming savings. The benchmark is separate from production telemetry and ForgeLoop verification evidence.

Create at least six fixed cases covering:

1. Stale handoff rejection.
2. Exactly-once handoff acceptance.
3. Advisory result normalization and trust stripping.
4. Task selection with multiple task namespaces.
5. Verification execution provenance.
6. Structural-quality source freshness.

For each case, store the natural-language query, a separately specified lexical baseline search, and an independently reviewed expected file set in `cases.json`. Establish those expected files from source inspection before running Ripwire. Do not derive the gold set from the tool being evaluated.

Run both arms against the same pinned, clean fixture checkout:

- **Baseline:** predefined `rg` searches followed by predefined bounded line reads. Use argument arrays, a stable path order, and fixed limits. Do not read whole files only to inflate baseline cost.
- **Adapter:** one explicit public recall with a fixed item/character budget and a qualified Ripwire version. Count only source files actually delivered after normalization. Report the raw upstream response size separately.

If the checked-out corpus does not match the case-set revision, refuse the comparison rather than silently scoring different source trees. Do not reset the user's working checkout to run it.

Report per case and aggregate:

- Expected files found and missed; recall over the expected set.
- Whether every expected file was found.
- Irrelevant returned files.
- Bytes delivered to the model and raw transport bytes.
- Latency, including adapter overhead and version checks; at least five measured runs and the measurement order.
- Failures, incomplete results, and all cases where the baseline does better.

Use the MVP's no-cache mode consistently. Cache comparisons are a later experiment. With only five runs, report median and range rather than implying a reliable tail-latency estimate.

Do not write `bytes / 4` into ForgeLoop usage fields. If a tokenizer is already available, a separate benchmark estimate may identify that tokenizer; otherwise report bytes only. Actual model token/cost savings require host/provider measurements.

Initial adoption rule: keep the adapter opt-in. Recommend broader use only if the report shows useful retrieval without unexplained loss of relevant files and with acceptable context/latency cost. A negative benchmark is a valid result; do not hide it or expand this task into a new ranking engine.

## 12. Verification commands and protocol closure

Run commands from the repository root. The new test and benchmark filenames below are planned deliverables and must exist first.

Focused automated checks:

```bash
node --test tests/ripwire-advisory-provider.test.js tests/ripwire-advisory-process.test.js tests/ripwire-advisory-normalize.test.js
node --test tests/advisory-context-provider.test.js tests/advisory-context-service.test.js tests/advisory-context-runtime.test.js tests/advisory-context-security.test.js tests/advisory-context-replay-safety.test.js
npm run lint
npm run pack:check
npm run docs:check
npm test
```

Add current repository-required type/API, package smoke, coverage, and CI checks when applicable to changed files. Inspect scripts before running them; do not install a missing tool just to satisfy a check. Do not edit generated documentation manually.

Execute the real-binary test only with a qualified installed binary and record its environment. Document the benchmark script's actual argument interface in the new benchmark README; do not publish a command that the script does not accept.

Use `forgeloop run-check` for command evidence, binding each check to the current implementation task and requirement. A successful direct shell run alone is not a recorded ForgeLoop check.

After implementation, query `next --task <task-id> --json` and follow canonical actions through verification, recorded evidence, review, receipt, and `complete`. Do not manually edit protocol state. Do not leave the task in `EXECUTING`.

Report separately:

- Implementation and automated-test status.
- Real-binary interoperability status.
- Benchmark outcome.
- ForgeLoop completion validation.
- Commit/PR/merge/publication status, only for operations actually authorized and performed.

## 13. Acceptance checklist

- [ ] A host can explicitly register `ripwire` through the existing Integration API.
- [ ] Ripwire remains optional and is not installed, bundled, or discovered automatically.
- [ ] The factory is exported and its TypeScript declaration matches runtime behavior.
- [ ] The qualified upstream version, command mode, and fixture provenance are documented.
- [ ] Query values cannot become shell commands or additional CLI options.
- [ ] Process timeout and output limits stop real child work, not just the awaiting promise.
- [ ] Results contain validated source references and a truthful status item.
- [ ] Upstream/adapter truncation and unknown completeness remain visible after core normalization.
- [ ] Scores are not promoted into invented probabilities, trust, or measured token usage.
- [ ] Advisory results cannot mutate state, satisfy checks, or alter lifecycle decisions.
- [ ] Existing tests remain green and new boundary tests cover the scenarios in Section 10.
- [ ] Package contents include the adapter and its guide.
- [ ] The paired benchmark includes misses and losses as well as wins.
- [ ] Real-binary checks are either observed or explicitly reported as `NOT_VERIFIED`.
- [ ] The final report distinguishes tested implementation from demonstrated performance benefit.
- [ ] ForgeLoop closure is validator-backed, or the exact remaining blocker is stated.

## 14. Later phases — do not implement in the MVP

### Phase 2: suggested tests and change-impact context

What: use explicitly requested impact/PR queries to suggest source relationships and candidate tests.

Where: add a host-facing advisory operation under `src/adapters/ripwire/` with dedicated fixtures/tests and documented typed input. Keep lifecycle and verification-scope selection unchanged.

How: qualify each upstream mode separately. Use `--impact` for a known symbol and evaluate `--pr-context` or `--situ` only after confirming the supported output format. The inspected JSON allowlist does not cover every command; never blindly append `--json` to all modes.

Acceptance: candidate tests are suggestions only; unsupported runners and approximate reachability are disclosed; no test command is executed from returned text; required regression checks are preserved.

### Phase 3: progressive detail and stronger retrieval diagnostics

What: let a host request the body of a previously identified symbol and optionally receive structured diagnostics beyond the current item fields.

Where: a dedicated adapter operation for expansion; change the generic advisory schema/types/normalizer only under a separately reviewed, provider-neutral compatibility design.

How: use validated symbol identity and the qualified expansion mode. Apply independent output bounds. Keep signatures as the default. Define how diagnostics survive truncation before exposing a new metadata field.

Acceptance: expansion is explicit and bounded; no follow-up is automatically executed from an upstream `next` string; older providers and hosts continue to work.

### Phase 4: optional quality signals

What: evaluate whether Ripwire's structural metrics provide useful complementary diagnostics.

Where: start with advisory reporting. A real structural-quality provider would belong to the existing provider interface only after metric compatibility is established.

How: compare metric definitions, supported languages, baseline comparability, freshness, and uncertainty. Do not rename unrelated scores to satisfy existing schema fields.

Acceptance: no fabricated canonical quality score, no automatic Sentrux replacement, and no conversion of approximate ranking data into a structural `PASS`.

## 15. Sources and evidence limitations

These links pin the inspected upstream source revision:

- [Ripwire README](https://github.com/redhat-et/ripwire/blob/93c8edaafdb5499e89939cc2cebd0429e278e86f/README.md): purpose and available discovery/navigation capabilities.
- [Ripwire command reference](https://github.com/redhat-et/ripwire/blob/93c8edaafdb5499e89939cc2cebd0429e278e86f/docs/COMMANDS.md): query modes, output-format restrictions, caps, and cache controls.
- [Ripwire architecture](https://github.com/redhat-et/ripwire/blob/93c8edaafdb5499e89939cc2cebd0429e278e86f/docs/ARCHITECTURE.md): approximate reference resolution and deterministic output design.
- [Ripwire evaluations](https://github.com/redhat-et/ripwire/blob/93c8edaafdb5499e89939cc2cebd0429e278e86f/docs/EVALS.md): upstream experimental methods and counterexamples; not a measured ForgeLoop benefit.
- [ForgeLoop advisory boundary](docs/ADVISORY_CONTEXT.md): existing API, normalization, and trust guarantees.
- [ForgeLoop protocol integration](PROTOCOL_INTEGRATION.md): host ownership and canonical evidence boundaries.

All adapter filenames, factory names, transport defaults, and benchmark design in this plan are proposed implementation decisions. They are not claims that those features already exist. No Ripwire binary was installed or executed while this plan was written.

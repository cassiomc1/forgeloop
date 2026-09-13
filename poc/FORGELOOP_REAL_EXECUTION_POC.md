# ForgeLoop Real Execution PoC: What GitHub Can Verify

> A technical account of a real ForgeLoop execution, written around evidence that is
> either directly recorded by GitHub or committed to the repository and independently
> verifiable from the public checkout.

## Scope of this article

This article intentionally uses a stricter evidence model than a normal project post.
It separates three different kinds of claims:

1. **GitHub platform facts** — merged pull requests, immutable commit IDs, changed-file
   statistics, and GitHub Actions results that GitHub records directly.
2. **Versioned execution evidence** — ForgeLoop protocol artifacts committed to the
   repository. GitHub proves that these exact bytes exist at specific commits; the
   repository's verifier checks their internal cryptographic and semantic consistency.
3. **Things GitHub did not witness** — developer-local filesystem transitions before
   publication, private originals behind redacted projections, production deployment,
   and universal correctness. This article does not promote those to GitHub-proven facts.

That distinction matters. A file being hosted on GitHub is not the same as GitHub having
observed the local event that originally produced it.

The complete PoC is under [`poc/`](./), with the primary overview in
[`poc/README.md`](./README.md).

---

## Executive proof matrix

| Claim | Public evidence | What GitHub can verify |
| --- | --- | --- |
| A real PoC implementation was merged | [PR #110](https://github.com/cassiomc1/forgeloop/pull/110), [merge commit `098f3c1`](https://github.com/cassiomc1/forgeloop/commit/098f3c1629abd820088464f9491ffad18c39deeb) | PR #110 was merged, changed 44 files, and introduced the workload, reports, and evidence package |
| Evidence publication was hardened | [PR #111](https://github.com/cassiomc1/forgeloop/pull/111), [merge commit `9024c44`](https://github.com/cassiomc1/forgeloop/commit/9024c44a37429340e2733c4995969bc3c1c0359a) | A deterministic verifier, audit v2, manifest hardening, and regression tests were merged |
| Evidence semantics were hardened further | [PR #112](https://github.com/cassiomc1/forgeloop/pull/112), [merge commit `0197474`](https://github.com/cassiomc1/forgeloop/commit/0197474a94e3b4c702d59b0ceb249f0f27eba5e3) | Completion semantics, path safety, manifest/hash parity, discoverability, and regression coverage were merged |
| Cross-platform evidence verification entered `main` | [PR #113](https://github.com/cassiomc1/forgeloop/pull/113), [merge commit `43a5ee0`](https://github.com/cassiomc1/forgeloop/commit/43a5ee029b750aed01534f753e9523b96d7e0169) | Windows drive/UNC handling, evidence tests, and Node 20/22/24 CI integration were merged |
| The maintenance task behind PR #113 became publicly auditable | [PR #114](https://github.com/cassiomc1/forgeloop/pull/114), [merge commit `71b2285`](https://github.com/cassiomc1/forgeloop/commit/71b2285c3faf96bcf907444532ecf30c66f82f9f) | A curated, privacy-aware maintenance evidence bundle was merged |
| Post-merge repository checks succeeded for PR #114's merge commit | [ForgeLoop audit](https://github.com/cassiomc1/forgeloop/actions/runs/33023729403), [Docs quality](https://github.com/cassiomc1/forgeloop/actions/runs/33023729364), [Package smoke](https://github.com/cassiomc1/forgeloop/actions/runs/33023729310), [CodeQL](https://github.com/cassiomc1/forgeloop/actions/runs/33023729345) | All four GitHub Actions runs completed successfully against commit `71b2285c...` |

The rest of this article explains what those objects contain and how the evidence model
fits together.

---

## Why build this PoC?

AI coding agents can already read repositories, edit code, invoke tools, run tests, and
produce pull requests. The harder engineering problem is not whether a model can produce
code. It is whether the execution around that code can be inspected later without
relying exclusively on the model's own summary.

Typical agent output may contain statements such as:

```text
Implemented the feature.
Tests passed.
Security checks passed.
The task is complete.
```

Those statements can be correct, but they are still claims made by the executing system.
The ForgeLoop PoC explores a different architecture:

```text
Request
  |
  v
Task
  |
  v
Contract
  |
  v
Routing
  |
  v
Preflight and gates
  |
  v
Scoped execution
  |
  v
Trusted checks
  |
  v
Verification
  |
  v
Review
  |
  v
Validator-backed completion
  |
  v
Evidence package
  |
  v
Independent verification
  |
  v
GitHub publication and CI
```

The model remains responsible for reasoning and implementation. ForgeLoop is responsible
for durable task state, explicit boundaries, execution provenance, validation, and audit
artifacts.

---

## The workload is real code, not a transcript

The engineering workload implemented by the PoC lives in [`poc/workload/`](./workload/).
It is a zero-runtime-dependency deterministic risk-evaluation CLI.

The implementation is split into small, inspectable units:

- [`src/rules.js`](./workload/src/rules.js) — deterministic risk rules and weights.
- [`src/schemas.js`](./workload/src/schemas.js) — strict input validation.
- [`src/evaluator.js`](./workload/src/evaluator.js) — bounded score calculation,
  risk-tier mapping, and policy decisions.
- [`src/cli.js`](./workload/src/cli.js) — CLI input modes and exit-code semantics.
- [`test/evaluator.test.js`](./workload/test/evaluator.test.js) — evaluator tests.
- [`test/cli.test.js`](./workload/test/cli.test.js) — CLI integration and exit-code tests.

The original execution's canonical audit records 23 workload unit/integration tests and
nine trusted ForgeLoop verification executions. See
[`poc/reports/poc-20260826-real-execution-technical-audit-v2.md`](./reports/poc-20260826-real-execution-technical-audit-v2.md).

GitHub independently proves that this workload was introduced through PR #110. The PR is
closed and merged, its merge commit is
[`098f3c1629abd820088464f9491ffad18c39deeb`](https://github.com/cassiomc1/forgeloop/commit/098f3c1629abd820088464f9491ffad18c39deeb),
and GitHub reports 44 changed files and 13,443 additions for that PR.

---

## The original task is represented as protocol state

The original task identifier is:

```text
poc-real-protocol-execution-20260826
```

Its preserved public task-state directory is:

[`poc/evidence/poc-20260826-real-execution/task-state/`](./evidence/poc-20260826-real-execution/task-state/)

Important artifacts include:

| Artifact | Purpose |
| --- | --- |
| [`task.json`](./evidence/poc-20260826-real-execution/task-state/task.json) | Task identity and write claims |
| [`contract.json`](./evidence/poc-20260826-real-execution/task-state/contract.json) | Authoritative task contract |
| [`routing-result.json`](./evidence/poc-20260826-real-execution/task-state/routing-result.json) | Deterministic guide routing |
| [`preflight.json`](./evidence/poc-20260826-real-execution/task-state/preflight.json) | Preflight result |
| [`gates/threat-boundary.json`](./evidence/poc-20260826-real-execution/task-state/gates/threat-boundary.json) | Security gate artifact |
| [`work-state.json`](./evidence/poc-20260826-real-execution/task-state/work-state.json) | Canonical lifecycle checkpoint |
| [`execution-receipt.json`](./evidence/poc-20260826-real-execution/task-state/execution-receipt.json) | Compiled execution receipt |
| [`events.ndjson`](./evidence/poc-20260826-real-execution/task-state/events.ndjson) | Append-only protocol event ledger |
| [`executions/`](./evidence/poc-20260826-real-execution/task-state/executions/) | Trusted execution records |

The public completion artifact, [`completion.json`](./evidence/poc-20260826-real-execution/completion.json),
records the following state:

```text
status: VALID
taskStatus: COMPLETE
verificationStatus: VALID
publicationStatus: local-only
productionReadiness: not-verified
```

It also records preflight as `READY`, the routed guides as `clean`, `test`,
`documentation`, and `security`, and the required `threat-boundary` gate as satisfied.

This does **not** mean GitHub witnessed those developer-local transitions in real time.
What GitHub proves is that this exact evidence is versioned in the repository. The
repository verifier then tests whether the published artifacts are internally consistent.

---

## Trusted execution provenance

A central question for AI-assisted engineering is the difference between:

```text
The agent says a command passed.
```

and:

```text
The protocol has an execution record for a specific requirement,
command, argv, process result, and exit status.
```

The original execution records are stored under
[`task-state/executions/`](./evidence/poc-20260826-real-execution/task-state/executions/).
The canonical audit maps nine checks to concrete execution IDs. They cover workload unit
and functional tests, valid/invalid CLI smoke cases, linting, documentation conformance,
security validation, and audit-report verification.

The evidence model links completion requirements to execution references rather than
relying only on a free-form agent report:

```text
Contract requirement
        |
        v
Verification check
        |
        v
Execution reference
        |
        v
Execution JSON
   /      |      \
  v       v       v
argv   exit code  status
           \
            v
         timestamps
```

This is the foundation for later provenance-closure verification in the maintenance
bundle.

---

## Validator-backed completion

The terminal artifact for the original PoC is
[`completion.json`](./evidence/poc-20260826-real-execution/completion.json).
The canonical audit is
[`poc-20260826-real-execution-technical-audit-v2.md`](./reports/poc-20260826-real-execution-technical-audit-v2.md).

The distinction is architectural: completion is represented as protocol state with
coverage and validation data, not just an assistant message saying the work is finished.

The completion artifact records:

- `status: VALID`
- `taskStatus: COMPLETE`
- `verificationStatus: VALID`
- no completion errors or warnings
- all four listed requirement/evidence dimensions as `COVERED`
- `productionReadiness: not-verified`

The last field is important. The PoC does not convert successful engineering verification
into a production-readiness claim.

---

## The most interesting result is negative evidence

The strongest part of the PoC is not a green result. It is a deliberately preserved red
result that appeared **after** historical completion.

The original execution receipt described a set of changed paths. After task completion,
the evidence package itself was exported into the repository. That introduced additional
paths not covered by the historical receipt.

The preserved strict audit is:

[`poc/evidence/poc-20260826-real-execution/audit.json`](./evidence/poc-20260826-real-execution/audit.json)

It reports:

```text
status: INVALID
code: E_RECEIPT_PATH_MISMATCH
message: Receipt changedPaths do not match observed repository paths
```

The corresponding report is
[`report.json`](./evidence/poc-20260826-real-execution/report.json).

This produces two different, non-contradictory facts:

```text
Historical completion: VALID / COMPLETE
Later repository audit: INVALID / E_RECEIPT_PATH_MISMATCH
```

The canonical audit v2 explains the chronology rather than rewriting the later invalid
audit to make the demo look cleaner.

This is a useful property for an engineering protocol: evidence applies to a state. If
the repository changes after that state is verified, the previous receipt should not be
silently treated as proof of the new state.

---

## The evidence package is cryptographically inventoried

The original evidence package is documented in
[`poc/evidence/poc-20260826-real-execution/README.md`](./evidence/poc-20260826-real-execution/README.md).
Its integrity metadata includes:

- [`manifest.json`](./evidence/poc-20260826-real-execution/manifest.json)
- [`manifest.sha256`](./evidence/poc-20260826-real-execution/manifest.sha256)
- [`hashes.txt`](./evidence/poc-20260826-real-execution/hashes.txt)
- [`publication.json`](./evidence/poc-20260826-real-execution/publication.json)

This provides file-level cryptographic integrity, but file hashes alone are not sufficient
for semantic integrity.

If an attacker modified an event and then recomputed every outer file hash, the package
could become cryptographically self-consistent again while still describing a different
lifecycle.

That is why the repository contains a semantic evidence verifier:

[`scripts/verify_poc_evidence.mjs`](../scripts/verify_poc_evidence.mjs)

and an adversarial regression suite:

[`poc/test/poc-evidence-publication.test.js`](./test/poc-evidence-publication.test.js)

The verifier checks relationships between artifacts, not only their outer checksums.

---

## The hardening history is itself visible in GitHub

The PoC was not published once and declared perfect. Its evidence system was hardened in
successive pull requests, and GitHub preserves that evolution.

### PR #110 — initial real execution PoC

[PR #110](https://github.com/cassiomc1/forgeloop/pull/110)

Merged as:
[`098f3c1629abd820088464f9491ffad18c39deeb`](https://github.com/cassiomc1/forgeloop/commit/098f3c1629abd820088464f9491ffad18c39deeb)

GitHub records:

- 1 commit
- 44 changed files
- 13,443 additions
- 0 deletions

This PR introduced the workload, PoC documentation, technical audit, and publication
evidence snapshot.

### PR #111 — evidence publication hardening

[PR #111](https://github.com/cassiomc1/forgeloop/pull/111)

Merged as:
[`9024c44a37429340e2733c4995969bc3c1c0359a`](https://github.com/cassiomc1/forgeloop/commit/9024c44a37429340e2733c4995969bc3c1c0359a)

GitHub records:

- 1 commit
- 13 changed files
- 946 additions
- 116 deletions

This PR introduced the two-layer evidence interpretation, preserved the post-publication
`E_RECEIPT_PATH_MISMATCH`, added the deterministic verifier and regression tests, created
the canonical audit v2, and hardened the manifest/hash model.

### PR #112 — semantic and path-safety hardening

[PR #112](https://github.com/cassiomc1/forgeloop/pull/112)

Merged as:
[`0197474a94e3b4c702d59b0ceb249f0f27eba5e3`](https://github.com/cassiomc1/forgeloop/commit/0197474a94e3b4c702d59b0ceb249f0f27eba5e3)

GitHub records:

- 3 commits
- 7 changed files
- 397 additions
- 48 deletions

This PR tightened traversal/path handling, canonical path representation, exact
manifest/hash parity, duplicate rejection, completion semantic validation, and public PoC
discoverability.

### PR #113 — cross-platform final hardening

[PR #113](https://github.com/cassiomc1/forgeloop/pull/113)

Merged as:
[`43a5ee029b750aed01534f753e9523b96d7e0169`](https://github.com/cassiomc1/forgeloop/commit/43a5ee029b750aed01534f753e9523b96d7e0169)

GitHub records:

- 1 commit
- 5 changed files
- 151 additions
- 5 deletions

This PR added Windows drive-absolute and UNC-path rejection independently of host OS,
added end-to-end Windows evidence-path regressions, enforced production-readiness
consistency, added the `poc:evidence:test` script, and placed evidence verification and
regressions in the Node 20/22/24 CI matrix.

### PR #114 — maintenance execution evidence

[PR #114](https://github.com/cassiomc1/forgeloop/pull/114)

Merged as:
[`71b2285c3faf96bcf907444532ecf30c66f82f9f`](https://github.com/cassiomc1/forgeloop/commit/71b2285c3faf96bcf907444532ecf30c66f82f9f)

GitHub records:

- 1 commit
- 38 changed files
- 12,125 additions
- 156 deletions

This PR published a curated evidence bundle for the ForgeLoop maintenance task that
implemented PR #113. That means the work used to harden the verifier became auditable
through the same general evidence architecture.

---

## The maintenance task closes the provenance graph

The maintenance evidence is under:

[`poc/evidence/maintenance/pr-113-final-hardening/`](./evidence/maintenance/pr-113-final-hardening/)

Its entry point is:

[`README.md`](./evidence/maintenance/pr-113-final-hardening/README.md)

The consolidated machine-readable interpretation is:

[`audit-summary.json`](./evidence/maintenance/pr-113-final-hardening/audit-summary.json)

That summary records:

```text
historicalCompletionState: COMPLETE
historicalCompletionValidation: VALID
historical event count: 35
COMPLETION_VALIDATED sequence: 34
completion transaction sequence: 35
execution references: 6
published execution derivatives: 6
missing execution derivatives: 0
publication-time protocol validation: STALE
publication-time reason: REPOSITORY_CHANGED
productionReadiness: NOT_VERIFIED
```

The maintenance event ledger is:

[`source/events.ndjson`](./evidence/maintenance/pr-113-final-hardening/source/events.ndjson)

The historical work-state projection is:

[`source/work-state.json`](./evidence/maintenance/pr-113-final-hardening/source/work-state.json)

The historical receipt snapshot is:

[`source/execution-receipt.json`](./evidence/maintenance/pr-113-final-hardening/source/execution-receipt.json)

The six published execution derivatives are under:

[`source/executions/`](./evidence/maintenance/pr-113-final-hardening/source/executions/)

The public verifier checks the execution graph in both directions and validates identity,
requirement binding, command/argv, exit code, status, verification cycle, timestamps, and
reference closure.

---

## Historical completion and current repository truth are separate

One of the most important semantic decisions in the maintenance evidence is that a later
repository observation does not rewrite historical completion.

The publication-time protocol observation is:

[`inspection/validate-protocol.json`](./evidence/maintenance/pr-113-final-hardening/inspection/validate-protocol.json)

The publication-time strict audit is:

[`inspection/audit-strict.json`](./evidence/maintenance/pr-113-final-hardening/inspection/audit-strict.json)

The consolidated summary records publication-time protocol status as `STALE`, with
`REPOSITORY_CHANGED`, while the strict audit preserves these reason codes:

```text
E_PHASE_ARTIFACT_STALE
E_RECEIPT_PATH_MISMATCH
E_STATE_REVALIDATION_REQUIRED
```

At the same time, historical completion remains `COMPLETE / VALID`.

The model is therefore:

```text
Historical task state
        |
        v
COMPLETE / VALID
        |
        v
Repository changes after completion
        |
        v
Publication-time observation
        |
        v
STALE / REPOSITORY_CHANGED
```

Those states answer different questions:

- **Historical:** did the task reach valid completion against the state it verified?
- **Current:** does the old verification still describe the repository now?

Conflating those two dimensions would either erase real historical completion or falsely
certify a changed repository.

---

## Privacy-safe publication without pretending redacted files are originals

Detailed execution evidence can contain machine-local paths. Publishing them directly can
expose local environment information. Replacing those values creates a different file, so
calling the result an untouched authoritative artifact would also be incorrect.

The maintenance package therefore explicitly distinguishes clean public artifacts from
redacted publication projections.

The privacy record is:

[`privacy-review.json`](./evidence/maintenance/pr-113-final-hardening/privacy-review.json)

It records:

- `status: PASS`
- `secretsPublished: false`
- `localAbsolutePathsPublished: false`
- `credentialsOrTokensPublished: false`
- an enforced independent public-payload scan
- 12 listed redacted artifacts

Each redacted derivative is labeled non-authoritative and carries a SHA-256 commitment to
its private original. The package manifest repeats the commitment and redacted-field
metadata.

The maintenance manifest is:

[`manifest.json`](./evidence/maintenance/pr-113-final-hardening/manifest.json)

Its detached hash is:

[`manifest.sha256`](./evidence/maintenance/pr-113-final-hardening/manifest.sha256)

Its checksum inventory is:

[`hashes.txt`](./evidence/maintenance/pr-113-final-hardening/hashes.txt)

This model makes a deliberately limited claim: the public verifier can check commitment
consistency, but it cannot prove the undisclosed contents of the private originals without
those originals being disclosed later.

---

## CI verifies the evidence, not only the application code

The historical CI definition described by this evidence is preserved in the
repository history. The current PR CI boundary is versioned at:

[`.github/workflows/pr-core.yml`](../.github/workflows/pr-core.yml)

The historical workflow ran its main validation job on Node 20, 22, and 24. Among other
repository checks, that historical matrix executed:

```bash
npm test
npm run poc:evidence:verify
npm run poc:evidence:test
npm run dependency:policy
npm run lint
npm run coverage
npm run pack:check
npm run docs:generated:check
npm run docs:conformance
```

It also ran Markdown linting, link checking, repository Markdown validation, loop-system
validation, and secret scanning. A separate historical portability matrix ran on Ubuntu,
macOS, and Windows with Node 20 and 24. The current PR workflow keeps the independent
security gates and selects the relevant documentation, package, audit, and native checks
through its path-aware aggregator.

After PR #114 was merged as commit `71b2285c...`, GitHub Actions independently recorded
successful runs for:

- [ForgeLoop audit — run 33023729403](https://github.com/cassiomc1/forgeloop/actions/runs/33023729403)
- [Docs quality — run 33023729364](https://github.com/cassiomc1/forgeloop/actions/runs/33023729364)
- [Package smoke — run 33023729310](https://github.com/cassiomc1/forgeloop/actions/runs/33023729310)
- [CodeQL — run 33023729345](https://github.com/cassiomc1/forgeloop/actions/runs/33023729345)

This is stronger than a local statement that the suite passed: GitHub records the remote
workflow results against the public merge commit.

---

## How to verify the public evidence yourself

Clone the repository and use the repository-defined verification commands:

```bash
git clone https://github.com/cassiomc1/forgeloop.git
cd forgeloop
npm ci --ignore-scripts
npm run poc:evidence:verify
npm run poc:evidence:test
```

Then inspect the evidence directly.

### Start here

- [PoC overview](./README.md)
- [Workload](./workload/)
- [Canonical technical audit v2](./reports/poc-20260826-real-execution-technical-audit-v2.md)
- [Original execution evidence](./evidence/poc-20260826-real-execution/)
- [Maintenance execution evidence](./evidence/maintenance/pr-113-final-hardening/)
- [Evidence verifier](../scripts/verify_poc_evidence.mjs)
- [Evidence regression tests](./test/poc-evidence-publication.test.js)

### Inspect the original lifecycle

- [task](./evidence/poc-20260826-real-execution/task-state/task.json)
- [contract](./evidence/poc-20260826-real-execution/task-state/contract.json)
- [routing](./evidence/poc-20260826-real-execution/task-state/routing-result.json)
- [preflight](./evidence/poc-20260826-real-execution/task-state/preflight.json)
- [work state](./evidence/poc-20260826-real-execution/task-state/work-state.json)
- [receipt](./evidence/poc-20260826-real-execution/task-state/execution-receipt.json)
- [event ledger](./evidence/poc-20260826-real-execution/task-state/events.ndjson)
- [completion](./evidence/poc-20260826-real-execution/completion.json)
- [post-publication strict audit](./evidence/poc-20260826-real-execution/audit.json)

### Inspect the maintenance lifecycle

- [maintenance README](./evidence/maintenance/pr-113-final-hardening/README.md)
- [audit summary](./evidence/maintenance/pr-113-final-hardening/audit-summary.json)
- [maintenance contract](./evidence/maintenance/pr-113-final-hardening/source/contract.json)
- [maintenance event ledger](./evidence/maintenance/pr-113-final-hardening/source/events.ndjson)
- [maintenance executions](./evidence/maintenance/pr-113-final-hardening/source/executions/)
- [publication-time protocol validation](./evidence/maintenance/pr-113-final-hardening/inspection/validate-protocol.json)
- [publication-time strict audit](./evidence/maintenance/pr-113-final-hardening/inspection/audit-strict.json)
- [privacy review](./evidence/maintenance/pr-113-final-hardening/privacy-review.json)
- [manifest](./evidence/maintenance/pr-113-final-hardening/manifest.json)

---

## What GitHub proves directly

Using GitHub alone, an external reviewer can independently establish at least the following:

1. PRs #110, #111, #112, #113, and #114 exist and were merged.
2. Their merge commits and repository diffs are public and immutable by commit ID.
3. The workload implementation, reports, evidence bundles, verifier, and regression tests
   are present in the public commit history.
4. The original `audit.json` publicly contains `INVALID / E_RECEIPT_PATH_MISMATCH` rather
   than a rewritten green result.
5. The maintenance bundle publicly contains a 35-event ledger, a `COMPLETE / VALID`
   historical summary, six referenced/published execution derivatives, and explicit
   publication-time `STALE` findings.
6. The public maintenance privacy record declares the redacted artifacts and the limits of
   SHA-256 commitments instead of representing them as untouched originals.
7. The CI workflow actually contains the evidence-verifier commands and cross-platform
   matrices described above.
8. GitHub Actions recorded successful post-merge runs for the PR #114 merge commit.

Those are externally inspectable facts.

---

## What GitHub does not prove

The same evidence should not be stretched beyond its boundary.

GitHub does **not** independently prove that:

- every developer-local filesystem transition occurred exactly as described before the
  evidence was committed;
- the local machine was uncompromised;
- the undisclosed private originals behind redacted derivatives contain any particular
  bytes beyond what can later be tested against their commitments;
- the PoC establishes formal or universal correctness for every repository, model, agent,
  operating system, runtime, or hostile environment;
- the project is production-ready;
- successful CI means the protocol is mathematically impossible to bypass.

The maintenance summary explicitly records `productionReadiness: NOT_VERIFIED` and lists
universal correctness among the unproven boundaries.

That limitation is not a weakness in the evidence model. It is part of making the claims
match the evidence.

---

## The architectural idea behind the PoC

ForgeLoop is exploring a separation of responsibilities between a probabilistic coding
agent and deterministic engineering infrastructure.

The agent is useful for:

```text
reasoning
design
implementation
diagnosis
adaptation
review
```

The protocol is useful for:

```text
task identity
contracts
write claims
routing
gates
state transitions
execution provenance
receipts
event history
validation
recovery
continuity
audit
```

The model can propose and implement. The protocol can preserve what was required, what was
owned, what execution records exist, what state was validated, and whether later changes
make previous evidence stale.

For short coding sessions, a conversation transcript may be enough context. For longer
agent-driven engineering, structured continuity becomes more important because work may
cross models, sessions, humans, CI systems, and deployment systems.

A future handoff can be represented by structured state rather than only by a large prompt:

```text
Task
Contract
Current phase
Write claims
Completed requirements
Remaining requirements
Execution references
Diagnostics
Validation state
Evidence
```

That is the larger experiment behind ForgeLoop.

---

## Conclusion

The ForgeLoop Real Execution PoC does not ask readers to trust a screenshot or a single
success message.

The implementation is public. The pull requests are public. The merge commits are public.
The historical completion evidence is public. The later drift failure is public. The
hardening history is public. The verifier is public. The adversarial regression tests are
public. The maintenance task evidence is public. The post-merge GitHub Actions results are
public.

Most importantly, the red results are preserved next to the green ones.

The original task can be historically `VALID / COMPLETE` while a later audit correctly
reports `E_RECEIPT_PATH_MISMATCH`. The maintenance task can be historically complete while
publication-time inspection correctly reports `STALE / REPOSITORY_CHANGED`.

That separation between **what was valid then** and **what is true now** is one of the core
properties the PoC is designed to demonstrate.

If you want to evaluate the claim, do not start with this article. Start with the evidence:

- [`poc/README.md`](./README.md)
- [`poc/evidence/poc-20260826-real-execution/`](./evidence/poc-20260826-real-execution/)
- [`poc/evidence/maintenance/pr-113-final-hardening/`](./evidence/maintenance/pr-113-final-hardening/)
- [`scripts/verify_poc_evidence.mjs`](../scripts/verify_poc_evidence.mjs)
- [`poc/test/poc-evidence-publication.test.js`](./test/poc-evidence-publication.test.js)

Then run the verifier, inspect the Git history, inspect the Actions runs, and try to break
the evidence model.

That is the PoC.

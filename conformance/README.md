# ForgeLoop conformance scenarios

These scenarios are adapter-facing contracts. They describe requests and the
artifacts a live agent must produce; they do not invoke a model runtime and are
not part of the deterministic `npm test` execution path.

The current published baseline for new runs is
`@cassiomc1/forgeloop@0.1.10`. Pin that version when preparing a reproducible
blind run; historical reports retain the exact package version they used.

The frozen baseline was verified on 2026-08-13 with this identity:

```text
package: @cassiomc1/forgeloop@0.1.10
npm gitHead: 10246cf92016c92c91c6d99c2e8c7df7d99fa68a
release commit: 10246cf92016c92c91c6d99c2e8c7df7d99fa68a
GitHub tag: v0.1.10 -> 10246cf92016c92c91c6d99c2e8c7df7d99fa68a
tarball URL: https://registry.npmjs.org/@cassiomc1/forgeloop/-/forgeloop-0.1.10.tgz
tarball SHA-1: 175a83ebd00e6b0ec4f0b7bf2ed8924198d6df3c
npm SHA-512 integrity: sha512-+aMssrl9Wh69at9B1oKJQJEpgHpbKlb7sT1pLAWh+v/IouxXZkVqz5w34iR54pfqykjhl5Nrpd+g3XbQtzYdbA==
release identity: RELEASE_IDENTITY_VALID
```

The repository may contain documentation or executable commits after this
frozen package. Those commits do not change the package used by the blind run.
Version `0.1.10` includes the completion-validation and cleanup TOCTOU fixes;
repeat the complete identity check before starting a reproducible run.

The repository release is `0.1.14`. It enforces verification installation
authority, provides recoverable stale receipt lifecycle in `prepare-completion`,
and validates single-actor protocol runs. Repeat the complete identity
check before starting a reproducible run.

## Current source-checkout guidance

The package identities and run results above are historical evidence. They are
not a claim about the package or publication state of the current checkout.
For a new local adapter check, read the current source package version and
protocol metadata from the checkout, then use the public Integration API or the
CLI command registry. Do not infer publication, deployment, or live-agent
conformance from a local version or a successful deterministic check.

The repeatable adapter-facing kit is [`adapter-test-kit.mjs`](./adapter-test-kit.mjs):

```bash
node conformance/adapter-test-kit.mjs
```

It emits bounded machine-readable JSON with the exact Node runtime, protocol
version, scenario IDs, observed outcomes, and a summary. Its available public
API scenarios cover cross-harness resume, bounded evidence-recovery guidance,
and concurrent claims. Policy-drift and interrupted-transaction scenarios are
reported `UNAVAILABLE` by the public adapter kit because fabricating their
durable artifacts would bypass canonical lifecycle ownership; use their
versioned fixtures for those cases. `FAIL` means the supported adapter
behavior was observed and did not meet the scenario contract. `UNAVAILABLE`
and `NOT_STARTED` are not passes and do not certify a live model run.

To test a nonconforming adapter, import `runAdapterTestKit` and provide an
executor with the same `executeForgeLoopCommand({ command, projectPath,
input })` shape. The kit must report failures rather than converting malformed
or missing envelopes into success. Keep that negative check separate from a
live-agent conformance report.

Run a scenario in a disposable target using the Standard profile first:

```bash
npx @cassiomc1/forgeloop preflight --json
npx @cassiomc1/forgeloop next --json
npx @cassiomc1/forgeloop audit --json
npx @cassiomc1/forgeloop complete --json
```

The expected post-implementation path is:

```text
implementation
→ forgeloop next
→ advance --to VERIFYING
→ forgeloop next
→ prepare-completion
→ forgeloop next
→ checks + record-check
→ forgeloop next
→ advance --to REVIEWING
→ forgeloop next
→ complete
```

Use the Strict profile only as a separate experiment:

```bash
# .forgeloop/kit/PROJECT_PROFILE.md must be verified before this profile starts.
npx @cassiomc1/forgeloop preflight --strict --json
npx @cassiomc1/forgeloop audit --strict --json
npx @cassiomc1/forgeloop complete --strict --json
```

Do not mix Standard and Strict criteria in one conformance result. Live-run
diagnostic records belong under [`conformance/runs/`](./runs/); they must not
contain secrets, credentials, hidden reasoning, or unnecessary conversation
history.

## Release identity evidence

Every live-run report records the exact published package used by the target.
Include all of these fields before sending the blind prompt:

```text
package: @cassiomc1/forgeloop@X.Y.Z
npm gitHead: <40-character commit SHA>
release commit: <40-character commit SHA>
GitHub tag: vX.Y.Z -> <40-character commit SHA>
tarball URL: https://registry.npmjs.org/...
tarball SHA-1: <40-character hex digest>
npm SHA-512 integrity: sha512-<base64 digest>
release identity: RELEASE_IDENTITY_VALID
```

Run the repository's read-only verifier against the exact release commit:

```bash
RELEASE_COMMIT="$(git rev-list -n1 vX.Y.Z)"
npm run release:identity -- --version X.Y.Z --release-commit "$RELEASE_COMMIT"
```

Do not interpret a local package version, a green build, or a tarball URL by
itself as publication proof. If the verifier cannot establish every identity
field, record `RELEASE_IDENTITY_NOT_VERIFIED` or `RELEASE_IDENTITY_INVALID` and
do not start the blind run.

The complete-website scenario deliberately fails when implementation starts
before the contract, route, and required gates exist.

## Migration compatibility evidence

The real published `0.1.6` fixture at
[`tests/fixtures/legacy-0.1.6/`](../tests/fixtures/legacy-0.1.6/) is frozen
with package, tarball, SHA-1, SHA-512, `gitHead`, and extraction-date metadata.
The migration tests run from those local bytes and cover interruptions after
hidden writes, after hidden verification, after the manifest authority switch,
and during legacy cleanup. An interrupted target must be diagnosed as
`E_MIGRATION_INCOMPLETE`; a later `update` may retry only hash-owned cleanup.
User-modified, unmanaged, and `preserve=true` files remain untouched even when
that leaves a root residual. ForgeLoop revalidates the recorded ownership hash
immediately before deleting each managed legacy file. This narrows the race
window but does not provide OS-level filesystem locking against a separately
privileged concurrent process.

## Autonomous blind-run isolation

External workflows may help with local planning, review, tests, or
documentation, but a mandatory approval policy for a ForgeLoop `NON_BLOCKING`
decision is `INCOMPATIBLE WITH AUTONOMOUS MODE`. The harness must exclude that
policy before the blind prompt starts; do not add a hint to the prompt that
changes the scenario. `NON_BLOCKING` must remain non-blocking, and any
compatibility conflict is recorded as `WORKFLOW_CONFLICT`, not as a fake user
blocker.

For the sixth blind run, record these values before sending the unchanged blind
prompt:

```text
mandatory-approval workflows enabled: NO
external brainstorming hard gate enabled: NO
external design approval gate enabled: NO
subagents enabled: NO
delegation enabled: NO
```

Also record the available and invoked external workflows, explicit autonomy
mode, process count, subagent count, and delegation status. If the harness
cannot disable a mandatory approval workflow, record `TEST_NOT_STARTED` and do
not interpret the run as a conformance failure or success. An installed
workflow and a compatible workflow are separate claims; use
`INCOMPATIBLE WITH AUTONOMOUS MODE`, not "broken", for the former.

Every live-run report must classify how it ended with exactly one
`terminationSource`: `AGENT`, `OPERATOR`, `HARNESS`, `TIMEOUT`, or `BLOCKER`.
An operator-terminated run is recorded as `RUN_STATUS: OPERATOR_INTERRUPTED`,
`CONFORMANCE: PARTIAL`, with post-termination capabilities marked
`NOT_REACHED` and the smallest failure class `OPERATOR_INTERRUPTION`.

## Protocol compatibility corpus

This corpus is harness-neutral. A compatible implementation must preserve the
listed artifacts, run the command sequence without interactive input, and
obtain the stated observable result. The JSON schemas and
`forgeloop protocol-info --json` are the version handshake; internal source is
not part of this contract.

| Scenario | Required observation |
| --- | --- |
| `cross-harness-resume` | A second harness reads a persisted task and `next --json` is deterministic. |
| `policy-drift` | A changed policy snapshot is reported as drift, never silently accepted. |
| `verification-recovery` | Rejected evidence produces validator-directed recovery. |
| `concurrent-claims` | Same-revision mutations serialize; only one can commit. |
| `interrupted-transaction` | A `COMMITTING` journal deterministically restores the prior artifact. |

Executable coverage is in `tests/cross-harness-resume.test.js`,
`tests/policy-hardening.test.js`, `tests/state-revision.test.js`,
`tests/concurrent-ledger.test.js`, and `tests/transaction.test.js`.

Each listed scenario has a versioned `SCENARIO.json` contract. It records the
request, deterministic route, gates, evidence, next-action sequence, and
terminal observation independently of any model runtime.

The contract set additionally covers stale route and receipt recovery, baseline
expansion refusal, delegated result validation, interrupted migration,
terminal-owned requirements, external versus executed checks, Windows
workspaces, and repository movement during completion review.

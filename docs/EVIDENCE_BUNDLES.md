# Evidence Bundles

Evidence bundles let pull-request CI verify ForgeLoop completions without the
developer's local `.forgeloop/` state. A completed task exports a redacted,
portable bundle. You commit it with the change, and the verifier checks the
committed code against it.

```bash
forgeloop complete --task <taskId>      # exports the bundle automatically
git add .forgeloop-evidence/<taskId>.json
forgeloop evidence-verify --base origin/main --head HEAD --format markdown
```

## Producing a bundle

1. Enable attestation (`"attestation": { "mode": "required" }`) so completion
   captures a code manifest. See [`CODE_ATTESTATION.md`](./CODE_ATTESTATION.md).
2. Run `forgeloop complete --task <taskId>`. After a `VALID` completion the
   CLI creates the attestation statement and writes
   `.forgeloop-evidence/<taskId>.json`. The result reports this in an
   `evidence` field:
   - `EXPORTED` gives the bundle path to commit;
   - `SKIPPED` gives the reason (attestation not required, the export
     turned off, `complete` run without `--task`, or a task ID that cannot
     name a bundle);
   - `FAILED` gives the error and the manual commands to run.

   A failed export never changes the `VALID` completion. `audit` and
   `report` ignore the task's own bundle (`.forgeloop-evidence/<taskId>.json`)
   when they compare the receipt's changed paths, so they stay `VALID`. Any
   other new file still counts as an unexpected change. The MCP and
   integration `complete` run the same executor and export the same way.
   With `"signing": { "provider": "sigstore" }` in `attestation`, the
   automatic export also signs the statement with `cosign attest-blob`
   before exporting, so the bundle carries the signature. The result's
   `evidence.signature.status` is:
   - `SIGNED` when the signature is attached;
   - `EXISTING` when a signature was already stored (it is never replaced);
   - `FAILED`, with a code such as `E_ATTESTATION_SIGNER_UNAVAILABLE` when
     `cosign` is missing. The bundle is still exported, unsigned.
   - `NOT_CONFIGURED` for the default `none` provider.

   Keyless Sigstore signing records the signer's identity (for example an
   email address) in the public Rekor transparency log. Enable it only for
   identities that may be published. The hosted GitHub App check does not
   verify signatures and reports `INTEGRITY_ONLY`; use `evidence-verify
   --require-signature` with an identity and issuer policy to reach
   `ATTESTED`.
3. To export by hand, or after signing the statement with a Sigstore
   identity, run `forgeloop attestation-create --task <taskId>` and then
   `forgeloop evidence-export --task <taskId>`. `attestation-create` returns
   the statement already written for the current verification cycle
   (`reused: true`) instead of failing. `--dir` changes the export directory.

The task ID must start with a letter or digit and contain only letters,
digits, `.`, `_` and `-` (at most 200 characters). Set
`"autoExportEvidence": false` inside `attestation` to keep exports manual.

Only a task completed while attestation mode is `required` can be exported.
Completion captures the code manifest in the same transaction as the final
state, so a task completed with attestation `off` or `optional` has no
manifest. `evidence-export` then fails with `E_EVIDENCE_EXPORT_UNAVAILABLE`,
and the manifest cannot be added afterwards. Enable attestation before you
start the task, in the local `.forgeloop/config.json`:

```json
{
  "schemaVersion": 1,
  "protocolVersion": 1,
  "attestation": {
    "mode": "required",
    "revisionProvider": "git",
    "requireCompleteCoverage": true,
    "coverage": { "exclude": [] },
    "signing": { "provider": "none", "required": false }
  }
}
```

With `"provider": "none"` the bundles are unsigned and verify as
`INTEGRITY_ONLY`.

A bundle contains:

- the exact attestation statement bytes;
- the code manifest bound to that statement;
- the optional Sigstore signature bundle;
- an informational summary of the contract objective, success criteria, and
  check results;
- an informational `metrics` block derived from the task ledger: received
  and completed times, total and per-phase durations (planning, executing,
  verifying, reviewing), verification cycles, diagnoses, and passed and failed
  checks;
- a SHA-256 digest over all fields.

The summary and metrics are self-reported and not cryptographically bound.
The ledger does not record the harness or model, so bundles omit them.

It never contains ledger events, command argv or output, environment values,
or absolute paths. Export refuses to write a bundle that would contain the
absolute project path.

## Publishing to the team dashboard (opt-in)

`forgeloop evidence-publish` uploads bundles to the hosted team dashboard,
so it shows tasks that are not on the default branch yet. Nothing is sent
unless you run the command, and it sends only bundles that `evidence-export`
already redacted and that still match their digest.

```bash
export FORGELOOP_SYNC_TOKEN=...          # a token issued for this repository
forgeloop evidence-publish --task <taskId>
forgeloop evidence-publish --all         # every bundle in .forgeloop-evidence
forgeloop evidence-publish               # retry the queue only
```

- **Authentication:** the same `FORGELOOP_SYNC_TOKEN` as cloud sync. The
  token is read from the environment and never written.
- **Remote and repository:** the remote defaults to
  `https://forgeloop.monster/api/evidence`, and the repository comes from
  the git origin. `--remote` and `--repo` override them.
- **Offline queue:** requested bundles enter a queue kept outside the
  repository, under `<config>/forgeloop/evidence-queue/`, and every run
  retries it:
  - published or unchanged bundles leave the queue;
  - network and server errors keep them queued;
  - bundles the remote rejects as invalid are dropped and reported.

  A refused token stops the run with `E_EVIDENCE_PUBLISH_UNAUTHORIZED` and
  keeps the queue.
- **Idempotence:** the remote stores each bundle once by digest, so
  republishing reports `UNCHANGED`.
- **Exit code:** `0` only when every bundle was published or unchanged;
  otherwise `1`.

## Verifying a range

`evidence-verify` is read-only and needs only a git checkout that contains the
base and head revisions. It works as follows:

1. It considers only bundles added or modified in the range, so old bundles
   never conflict with later edits.
2. For each bundle, it checks the digest, the statement schema, and the
   statement↔manifest binding. It then compares each manifest entry with the
   head content.
3. A changed path is covered when an intact bundle has a matching entry for
   it. Paths under `.forgeloop/`, the evidence directory, and `--exclude`
   patterns are excluded.
4. When several tasks touched the same path, an entry that no longer matches
   the head is reported as **superseded** if another bundle covers that path.
   Otherwise it is a content mismatch.
5. With `--require-signature`, every bundle used must carry a signature that
   verifies under the verifier's `--identity` and `--issuer`.
6. Each bundle also reports **execution assurance** from its predicate
   (schema version 2 binds every recorded check): `EXECUTED` when ForgeLoop
   ran every check itself, `REPORTED` when any check was only reported by the
   actor, `HOST_ATTESTED` when it is `EXECUTED` and signed under a CI workload
   issuer policy (`--issuer https://token.actions.githubusercontent.com`), and
   `UNKNOWN` for version-1 predicates. The range reports the lowest, and
   `--min-assurance <level>` fails it below that level with
   `E_EVIDENCE_ASSURANCE_INSUFFICIENT`.
7. With `--brief <task-brief.json>`, the range is verified as the delivery
   for that delegation brief: the brief's task needs an intact bundle, its
   covered paths must stay inside `allowedPaths` and out of `readOnlyPaths`,
   and every brief verification item needs a passing bound check.

| Result | Meaning |
| --- | --- |
| `VALID` / `ATTESTED` | Every changed path is covered, and every bundle used has a valid signature under the verifier's policy. |
| `VALID` / `INTEGRITY_ONLY` | Every changed path is covered by intact, unsigned bundles. Unsigned bundles can be hand-written, so this result is a consistency check, not proof that ForgeLoop produced them. |
| `INVALID` / `NONE` | At least one of: an uncovered path, a tampered bundle, content that differs from the head, or a missing or invalid required signature. |

Exit codes match `attestation-verify-range`: `0` valid, `1` invalid,
uncovered, or untrusted, and `2` invocation, provider, or environment error.

## Trust boundary

- Signer identity, issuer, and exclusions are verifier policy. Supply them
  from the CI configuration on the protected base branch or from a GitHub App
  configuration, never from files the pull request can change.
- The summary inside a bundle is not cryptographically bound. Only the
  statement and the manifest it binds are.
- A valid result proves that the committed content matches what a ForgeLoop
  completion attested. It does not prove that the code is correct or secure.

## GitHub Action

[`integrations/github-action`](../integrations/github-action/README.md) runs
`evidence-verify` and writes the Markdown result to the job summary.

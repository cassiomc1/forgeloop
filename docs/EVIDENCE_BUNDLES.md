# Evidence Bundles

Evidence bundles let pull-request CI verify ForgeLoop completions without the
developer's local `.forgeloop/` state. A completed task exports a redacted,
portable bundle. You commit it with the change, and the verifier checks the
committed code against it.

```bash
forgeloop evidence-export --task <taskId>
git add .forgeloop-evidence/<taskId>.json
forgeloop evidence-verify --base origin/main --head HEAD --format markdown
```

## Producing a bundle

1. Enable attestation (`"attestation": { "mode": "required" }`) so completion
   captures a code manifest. See [`CODE_ATTESTATION.md`](./CODE_ATTESTATION.md).
2. Complete the task, then run `forgeloop attestation-create --task <taskId>`.
   Optionally sign the statement with a Sigstore identity.
3. Run `forgeloop evidence-export --task <taskId>`. It writes
   `.forgeloop-evidence/<taskId>.json`; `--dir` changes the directory.

A bundle contains:

- the exact attestation statement bytes;
- the code manifest bound to that statement;
- the optional Sigstore signature bundle;
- an informational summary of the contract objective, success criteria, and
  check results;
- a SHA-256 digest over all fields.

It never contains ledger events, command argv or output, environment values,
or absolute paths. Export refuses to write a bundle that would contain the
absolute project path.

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

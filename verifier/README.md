# forgeloop-verify

An independent verifier for ForgeLoop evidence bundles, licensed Apache-2.0.
It is a single dependency-free file that shares no code with the ForgeLoop
runtime, and it passes the same conformance suite as the reference CLI. That
makes it the second implementation of
[`docs/PROTOCOL_SPEC.md`](../docs/PROTOCOL_SPEC.md) Sections 5–7.

```bash
npx @cassiomc1/forgeloop-verify --base origin/main --head HEAD
```

It is published on its own as `@cassiomc1/forgeloop-verify` (Node.js 22 or
later, no dependencies). In this repository you can also run
`node verifier/forgeloop-verify.mjs` directly.

| Option | Meaning |
| --- | --- |
| `--base`, `--head` | revision range to verify (required) |
| `--path` | repository directory (default `.`) |
| `--dir` | evidence directory (default `.forgeloop-evidence`) |
| `--exclude` | changed path or `dir/**` left out of coverage (repeatable) |
| `--allow-partial-coverage` | report uncovered paths without failing |
| `--require-signature` | fail unless every bundle used is signed |
| `--min-assurance` | fail below this execution assurance: `REPORTED`, `EXECUTED` or `HOST_ATTESTED` |
| `--brief` | verify the range as the delivery for this task brief (delegation, spec Section 8) |
| `--json` | print the result as JSON |

It checks bundle integrity, the in-toto statement and its bindings, the code
manifest, content at the head revision and coverage of every changed path. It
reports execution assurance from predicate schema version 2 (at most
`EXECUTED`, since `HOST_ATTESTED` needs a verified CI signature). It does **not**
verify Sigstore signatures: a signed bundle is reported as
`SIGNATURE_NOT_VERIFIED`. Verify those with `cosign` or the reference CLI
(`forgeloop evidence-verify --require-signature`).

Run the conformance suite against it:

```bash
npm run conformance:independent
```

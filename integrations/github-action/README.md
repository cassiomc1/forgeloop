# ForgeLoop evidence GitHub Action

Fails a pull request when its changed files are not covered by committed
ForgeLoop evidence bundles, and writes the result to the job summary. See
[`docs/EVIDENCE_BUNDLES.md`](../../docs/EVIDENCE_BUNDLES.md).

```yaml
on: pull_request
permissions:
  contents: read
jobs:
  evidence:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - uses: cassiomc1/forgeloop/integrations/github-action@<commit-sha>
        with:
          forgeloop-version: <version with evidence-verify>
          require-signature: "true"
          identity: https://github.com/<org>/<repo>/.github/workflows/sign.yml@refs/heads/main
          issuer: https://token.actions.githubusercontent.com
```

- `fetch-depth: 0` is required so the base revision exists locally.
- `forgeloop-version` must be an exact published version that includes
  `evidence-verify`.
- Without `require-signature`, a passing check reports `INTEGRITY_ONLY`:
  the bundles match the committed code, but unsigned bundles can be
  hand-written. Use signatures to make the check a trust gate.
- In `pull_request` workflows, the workflow file comes from the pull request.
  Protect signer policy with branch protection on workflow files, or
  enforce it from a GitHub App that keeps the policy outside the pull request.
- Exit codes: `0` valid, `1` invalid or uncovered, `2` invocation or
  environment error.

# Reproducing the persistence LOC comparison

The original target is a 25% net reduction in production persistence-related
nonblank physical lines. The scope includes the new store, importer/exporter,
compatibility and maintenance code. Comments count on both sides. Runtime
validation, performance and release acceptance remain separate requirements.

The reviewed function scope is pinned to production source `9dd179c` and
baseline `ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5`. Prepare a clean checkout of
that baseline. The current checkout must have the locked TypeScript 7.0.2
development dependency already available; the analyzer does not install tools,
execute production code, run benchmarks or make network requests.

From the repository root, with `LOC_BASELINE_ROOT` set to the clean baseline
checkout and `LOC_RESULT_PATH` set to a writable output file, run:

```sh
node scripts/measure-persistence-loc.mjs \
  --repo-root="$PWD" \
  --baseline-root="$LOC_BASELINE_ROOT" \
  --scope-manifest="$PWD/benchmarks/storage-sqlite/persistence-loc/scope-9dd179c.json.gz" \
  --output="$LOC_RESULT_PATH"
```

At the pinned production source, the result is 25,732 baseline lines and 32,529
current lines. The target ceiling is 19,299: `targetMet` is false. Zero unresolved
membership makes the static scope eligible for comparison, not the migration
eligible for release. Successful process exit means analysis completed; it
does not mean the target passed. Inspect `acceptanceEligible`, `targetMet` and
`unresolvedMembership` in the output.

The output retains per-file and per-node hashes, source identities, call graph,
scope dispositions and limitations. Production changes require reviewing and
refreshing the manifest. Stale or unresolved membership must not be presented
as an accepted measurement. Both sides use the same identity closure, and the
25% threshold is fixed in the analyzer.

Normalized token fingerprints are matching heuristics, not semantic equivalence
proofs. Comment normalization and scanner fallback can lose lexical detail.
Raw source hashes and direct source review remain authoritative; do not renew
a scope disposition merely because a normalized fingerprint matches.

`whole-module-inventory.json` preserves the earlier conservative whole-module
inventory separately: 43,788 baseline lines and 52,191 then-current lines.
Its semantic scope review was incomplete, so those historical totals are not
the function-scope acceptance result and do not describe current production.
They remain retained rather than replaced by a narrower count.

The current compact result receipt is
[`persistence-loc-9dd179c-closed.json`](../persistence-loc-9dd179c-closed.json).
The full output is deliberately generated outside the repository because it
contains detailed AST and source evidence; it is reproducible from the script,
manifest and pinned source inputs above.

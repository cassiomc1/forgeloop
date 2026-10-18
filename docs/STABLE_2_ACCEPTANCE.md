# Stable ForgeLoop 2.0.0 acceptance

This record separates supported operational-writer acceptance from publication,
production cutover and universal process exclusion. Historical migration
scoreboards retain their original source and dates; this record is the current
release pointer.

## Supported writer boundary

The source review covers every core/MCP runtime JavaScript module, 105 literal
filesystem modules, 457 lexically bound filesystem/wrapper references and 16
indirect references. The inventory has no nonliteral runtime imports. Ninety-five
filesystem modules match the prior reviewed bytes; ten changed modules were
reviewed against their exact deltas. Source hashes, roles, indirect-reference
dispositions, authority chains and limits are retained in the
[source review](https://github.com/cassiomc1/forgeloop/blob/61447313c5b13e6eb8d80240a5be5c6eea56a410/benchmarks/storage-sqlite/stable-2.0.0-writer-review.json.gz).

Supported CLI, Integration API and MCP dispatch select canonical SQLite.
Operational state, events, receipts, claims and indexed domain records share the
native transaction boundary. Portable writers reject operational namespaces;
mixed native/legacy layouts, foreign or expired contexts and actor-supplied
persistence capabilities fail closed. Explicit migration and restore admission
retain independent ownership and quiescence checks.

Configuration, installation manifests, exports/bundles, backups, immutable
attachments, owner-bound maintenance journals/archives, repository-index caches,
transport state and private scratch files are explicit file-owned exceptions.
They are not writable operational mirrors. Legacy data requires explicit
migration; a migrated active project does not silently fall back to JSON.

The candidate advertises `soleSQLiteWriter: true` for this reviewed supported
operational boundary. Source acceptance does not imply final release, registry,
performance, or production acceptance.

## Validation evidence

- [Native candidate audit](https://github.com/cassiomc1/forgeloop/actions/runs/39125623599):
  15/15 checks on macOS ARM64, Windows x64 and Linux x64, including the new
  review-finding → diagnosis → correction → fresh verification flow.
- [Windows full suite](https://github.com/cassiomc1/forgeloop/actions/runs/39083442557):
  successful on the runtime correction candidate.
- [Old-client exclusion](https://github.com/cassiomc1/forgeloop/actions/runs/39125628347):
  successful on native Linux and Windows. Retained evidence records the precise
  inventoried identity/installation and cleanup boundary.
- macOS source `61447313`: all sixteen real public rollback/owner-death cases
  pass with unchanged source; the separate old-client drill passes with cleanup.
  Raw records are retained under `benchmarks/storage-sqlite/stable-candidate-6144731-darwin-*`.
- The [earlier-source hosted pair](https://github.com/cassiomc1/forgeloop/actions/runs/39083441154)
  at `e9139a55` passes the owner-approved comparison: 1,000 canonical-rich-all
  tasks, ordinary 10 events, selected 1,000 events, 200 samples per side,
  exact output parity and validated worker completion. Native p95 is 2,205.943 ms
  versus 5,162.466 ms for task listing, and 2,190.628 ms versus 5,177.674 ms for
  project tasks. This is preparation evidence; the final release source must
  repeat the same hosted case before publication.

`scripts/verify-stable-storage-review.mjs` checks complete core/MCP runtime
module membership and normalized source SHA-256 hashes against the reviewed
manifest. The stable channel guard requires this check; any new module or source
drift requires review. This is a repository release check, not a signature or
substitute for the behavioral checks below.

Final-source full pre-push/release verification, native candidate checks,
required exact-head PR checks and the final hosted comparison must all be
successful. The immutable `v2.0.0` publication workflow preserves the stable
channel guard and runs full verification; the RC1/RC2 shortcut is inapplicable.
After publication, verify registry `gitHead`, SHA-512 integrity and tag identity,
then run fresh unversioned `latest` installations with the expected exact version
on all three native hosts. The audit also checks both bundled companions.
Update this source record with terminal release links in the post-publication
documentation/Audit alignment change; never treat a pending run as successful.

## Limits

These checks establish the supported release boundary. Process-kill drills do
not prove physical power-loss behavior. Raw privileged SQLite access, arbitrary
host providers/external commands and uninventoried legacy installations are
outside this proof. Production migration still requires a named target, backup,
writer inventory and operator-enforced quiescence; no live project was migrated
by these release tests. No production deployment or Audit binary publication
is implied by core npm publication.

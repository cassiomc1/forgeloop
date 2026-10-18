# Stable ForgeLoop 2.0.0 acceptance

ForgeLoop **2.0.0** is published on npm **latest**. The immutable `v2.0.0` tag
and registry `gitHead` identify `4ff11bb4bc4be39b095a151a323f1388dad0d819`.
[PR #229](https://github.com/cassiomc1/forgeloop/pull/229) merged after all six
required checks passed on that head. The protected merge has the same release
tree and retains the reviewed commit as an ancestor.

## Published identity and native user checks

The [trusted publication](https://github.com/cassiomc1/forgeloop/actions/runs/39133661722)
passed full verification and published with GitHub OIDC and signed provenance.
`release:identity` independently verified the version, remote tag, `gitHead`,
SHA-1 and SHA-512 of the actual registry tarball. npm processing completed
before user tests began. The archive SHA-256 is
`326fbd81db54b9164f862a383fba4861817bd31ee325cf07252fb0b1101bc835`.

The [fresh latest-install matrix](https://github.com/cassiomc1/forgeloop/actions/runs/39135810569)
installed the **unversioned** package with separate fresh home, npm cache,
configuration, prefix and project directories. Each host resolved **2.0.0**,
with matching registry identity and all sixteen checks passing:

| Native host | Runtime | Result |
| --- | --- | --- |
| macOS ARM64 | Node 24.19.0 | 16/16 PASS |
| Windows x64 | Node 24.19.0 | 16/16 PASS |
| Linux x64 | Node 24.19.0 | 16/16 PASS |

Checks cover both bundled companions, live Jev health, initialization and
persistence, claim conflicts, contract/routing/preflight, eight concurrent
writers, WAL/SQLite/foreign-key integrity, tamper detection, mixed-state
refusal, backup/no-overwrite, a real review finding and correction with fresh
verification, validator-backed completion and completed-task restore into a new
directory. The temporary GitHub TypeSafe secret was removed after all reports
were retained and verified. Raw registry/user receipts are retained as
`benchmarks/storage-sqlite/stable-2.0.0-latest-*.json.gz`.

## Supported operational writer boundary

The [source review at the release tag](https://github.com/cassiomc1/forgeloop/blob/v2.0.0/benchmarks/storage-sqlite/stable-2.0.0-writer-review.json.gz)
binds all 511 core/MCP runtime JavaScript modules, 105 literal filesystem
modules, 457 lexical filesystem/wrapper references and sixteen indirect
references. Ninety-five filesystem modules retain reviewed bytes; ten deltas
have explicit dispositions. No nonliteral runtime import is present in that
inventory. Source hashes and the collector are retained with the review.

Supported CLI, Integration API and MCP dispatch select canonical SQLite.
Operational state, events, receipts, claims and indexed domain records share
the native transaction boundary. Portable writers reject operational namespaces;
mixed layouts, foreign or expired contexts and actor-supplied persistence
capabilities fail closed. Explicit migration/restore retain ownership and
quiescence admission. The package advertises `soleSQLiteWriter: true` for this
supported boundary.

Configuration, installation manifests, portable exports/bundles and backups,
immutable attachments, owner-bound maintenance journals/archives, repository
index/cache, transport state and private scratch files remain explicit file
roles. They are not writable operational mirrors. Legacy data requires explicit
migration; native projects do not silently fall back to JSON.

`scripts/verify-stable-storage-review.mjs` checks complete runtime-module
membership and normalized source SHA-256 hashes. The stable channel guard
requires that source check. New modules or changed runtime bytes require review.
The manifest is not a signature, universal absence proof or substitute for
behavioral verification. The older call-name inventory retains
`wholeConsumerClosure: false` and remains discovery-only.

## Source-bound release validation

Full local pre-push on `780b9338` passed 3,109 tests with zero failures and sixteen
optional skips, plus coverage, critical coverage, lint, dependency/complexity,
documentation, package, MCP and Python validators. The final delta at `4ff11bb4`
corrected only three Markdown formatting errors; exact-head required CI and
full tag-publication verification passed on that final source. The
[native candidate matrix](https://github.com/cassiomc1/forgeloop/actions/runs/39128718653)
also passed 16/16 on each host before publication. All post-merge workflows,
including full Windows, Node compatibility, package, documentation and CodeQL,
passed on the identical protected-merge tree.

The [final-source hosted pair](https://github.com/cassiomc1/forgeloop/actions/runs/39128716481)
meets the owner-approved plan §9 criterion: 1,000 canonical-rich-all tasks,
ordinary ten events, one selected task with 1,000 events, 200 timed/resource
samples per side, exact output parity, validated closed workers and parent,
matching before/after source manifests, and successful root cleanup observers.

| Operation | Native p95 | Pinned baseline p95 |
| --- | --- | --- |
| taskListTool | 2,161.862 ms | 4,361.678 ms |
| projectTasksResource | 2,141.102 ms | 4,364.023 ms |

Both native p95 values are lower than baseline
`ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5`. This proves the recorded replacement
criterion, not every original benchmark dimension. The raw receipt deliberately
retains `releaseThresholdsVerified: false`; it has not been relabeled as full
original-matrix acceptance. Final-source artifacts are retained under
`benchmarks/storage-sqlite/stable-2.0.0-hosted-*`.

[Linux and Windows public rollback](https://github.com/cassiomc1/forgeloop/actions/runs/39126195649)
passed all sixteen cases per host at `61447313`; macOS passed the same sixteen
cases at that revision with unchanged source. The
[Linux/Windows old-client exclusion drill](https://github.com/cassiomc1/forgeloop/actions/runs/39125628347)
passed at `e9139a55`; the macOS drill passed at `61447313` with cleanup. These
receipts retain their precise source revisions and inventoried installation
boundary. Later stable metadata and documentation changes do not expand those
exclusion claims. Current-source full tests and fresh registry checks remain
separate evidence.

## ForgeLoopAudit alignment

[ForgeLoopAudit](https://github.com/cassiomc1/forgeloop/tree/main/ForgeLoopAudit) pins the actual public 2.0.0 archive
and release commit. All 52 shipped schema files were compared with the exact
release source before regenerating its trusted 31-schema provenance. Its own
lineage checks and recaptured README images identify stable core 2.0.0. Audit
retains its separate full verification, native-platform and browser gates; core
publication does not publish an Audit binary. Audit remains a read-only unsigned
preview and uses the public Integration API.

## Limits

Process-kill drills do not establish physical power-loss behavior. Privileged
raw SQLite access, arbitrary host providers/external commands and uninventoried
legacy installations are outside this proof. Production migration still needs a
named target, backup, writer inventory and operator-enforced quiescence. No live
user project was migrated by these release tests. Historical migration
scoreboards retain their original source/date and do not describe current
release completion. No production deployment or Audit binary publication is
implied.

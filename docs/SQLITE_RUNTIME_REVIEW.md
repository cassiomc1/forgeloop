# SQLite runtime compatibility review

Reviewed against the migration worktree on 2026-10-02. This is scoped runtime
and upstream-fix evidence, not platform or full migration acceptance.

## Exact local runtime

Node 24.19.0, macOS arm64, built-in SQLite 3.53.3. Native
`sqlite_source_id()` returns:

```text
2026-06-26 20:14:12 d4c0e51e4aeb96955b99185ab9cde75c339e2c29c3f3f12428d364a10d782c62
```

The native output is retained in
`/tmp/sqlite-runtime-review-increment150-native.json`. The source identity matches
[SQLite 3.53.3 release metadata](https://sqlite.org/releaselog/3_53_3.html).
[Node 24.19.0 release notes](https://nodejs.org/en/blog/release/v24.19.0)
identify the bundled SQLite update to 3.53.3.

## API mapping

[Exact Node 24.19.0 SQLite documentation](https://github.com/nodejs/node/blob/v24.19.0/doc/api/sqlite.md)
describes DatabaseSync as synchronous and the module as release candidate.
Constructor options used here are open, readOnly and enableForeignKeyConstraints.
Prepared get/run/all/iterate APIs cover indexed queries, short mutation commits
and incremental export/diagnostic consumption. Numeric reads outside JavaScript's
safe integer range reject unless BigInt reading is enabled; this implementation
does not silently coerce such values.

Native backup returns a Promise. It may observe mutations on its own connection
and restart for independent-connection changes. ForgeLoop copies into a private
path, opens the completed copy read-only, and closes/removes it after consumption.
It refuses a snapshot while the source connection is in a transaction. Sustained
writer pressure and backup restart cost still need measurement. Constructor and
backup API presence are checked by the single lazy driver loader.

Current code mapping: src/storage/runtime.js, connection.js, backup.js,
snapshot.js, repository.js and exporter.js. Local API, WAL snapshot isolation,
backup and round-trip tests provide behavioral evidence separately; documentation
alone cannot prove those behaviors.

## Applicable upstream fixes and constraints

[SQLite WAL documentation](https://sqlite.org/wal.html) identifies the WAL-reset
corruption race as fixed in 3.51.3 and later. ForgeLoop uses multiple WAL
connections, so the fix matters. The selected 3.53.3 release includes that fix.
WAL requires same-host shared memory and does not support network filesystems.
Committed WAL contents must accompany the database or be checkpointed or backed up;
copying only a live database pathname is insufficient.

The [3.53.0–3.53.3 upstream timeline](https://sqlite.org/src/timeline?from=version-3.53.0&to=version-3.53.3&to2=branch-3.53&y=ci)
includes backup destination locking fixes, active-backup/ATTACH use-after-free
correction, corrupt read-only WAL page-size handling, freelist/integrity-check
hardening, and Windows shared-memory filename locking correction. These are
relevant to backup, retained snapshot validation and future Windows checks.
Application code does not use deserialize or ATTACH, but selection includes their
fixes. Matching the release source ID supports inclusion; it is not a reproduction
of every upstream defect or certification of a platform build.

## Remaining acceptance

Hosted Windows/Linux/native package results, startup cost, sustained backup
pressure, event-loop/RSS benchmarks, power-loss behavior, supported local
filesystem matrix, later admitted runtime review and breaking-major publication
metadata remain unverified. The direct Node HTML API URL was inaccessible in this
review; the exact upstream tagged documentation was accessible and used instead.

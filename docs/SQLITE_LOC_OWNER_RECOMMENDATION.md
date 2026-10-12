# Inclusive persistence LOC: owner decision recommendation (a773879 state, 2026-10-12)

**Status:** OWNER DECISION RECORDED 2026-10-12 — the owner authorized **Option A+C**:
depcline the numeric LOC reduction gate and adopt the performance-parity
acceptance criterion (now amended into `SQLITE_MIGRATION_PLAN.md` §9/§7/§10 with
the decision status recorded in `SQLITE_LOC_RELEASE_DECISION.md`, which is now
CLOSED). No Option B consolidation and no unrelated architecture change was
performed or is authorized by this record.

**Evidence base:** the acceptance-eligible, zero-unresolved-membership analyzer
run bound to `a7738796c2859524fad0933037b142089fb90e3c`
([result summary](../benchmarks/storage-sqlite/persistence-loc/result-a773879-summary.json),
[raw result](../benchmarks/storage-sqlite/persistence-loc/loc-a773879-r5.json.gz),
[rebound scope manifest](../benchmarks/storage-sqlite/persistence-loc/scope-a773879-rebound.json)).
Baseline `ee9ce11` selected 25,732 lines; current 32,996; unchanged ceiling
19,299 (25 % net reduction). **Target not met; gap 13,697 lines.**

## Where the gap actually sits (from the committed raw result)

| Component | Selected lines | Evidence |
| --- | --- | --- |
| `src/storage/*` whole (net-new) | 7,449 | mandatory whole-module, incl. importer/exporter |
| — storage core (schema/connection/ledger/import/export/repository/unit-of-work) | 5,773 | plan-tier architecture, currently modularized past the minimum |
| — migration/rollback/restore/backup family | 1,676 | staged safety machinery |
| Net growth in shared files (not storage) | +1,987 | events +206, task-discovery +181, reconcile-closure +105, cli-command-definitions +101, bundles +86 … |
| Net-new elsewhere | +474 | 7 files under src/core+commands+adapters |
| Baseline retirements taken | −922 file-level (−67 maintenance) plus shared-file deletions | fileRows diff |
| Mechanism-retirement delta (transaction/task-migration/task-lock/txn-maintenance) | **−737** | nodeRows per-path line sums |

The gap is dominated by the SQLite store itself (7,449 lines), not by lingering
legacy code: the four filesystem-mechanism modules already shrank by 737 lines
(`transaction.js` 291→32, `task-migration.js` 330→89, `task-lock.js` 297→119,
`transaction-maintenance.js` 59→0). Even deleting the remaining shim bytes
totally frees only ~240 more lines.

## The elimination arithmetic (why simple consolidation is insufficient)

Reaching 19,299 requires removing 13,697 current lines *net of any new work*.
Adding real consolidation savings S and avoiding new growth G must satisfy
`32,996 − S + G ≤ 19,299`. Even an aggressive 1,800-line storage-core
consolidation leaves a ~11,900-line gap. No consolidation-only path reaches the
ceiling because the mandatory importer/exporter, connection owner, schema,
ledger relations, repository, unit-of-work and the staged migration family are
the plan's own required architecture.

## Three owner-decidable options

**Option A — Decline the 25 % target for this migration (release decision, no
code change).** Record in the plan's §9 "failing a target triggers
investigation and a release decision" clause that the measured store cost is
the price of the chosen durability/safety feature set (staged migration,
rollback, restore, old-client exclusion, strict tamper checks). Pros: honest,
zero-risk, keeps fail-closed boundaries. Cons: migration plan's headline
LOC goal is formally unmet.

**Option B — Approve consolidation to a realistic floor, then re-measure
(owner sets the floor).** Concrete candidates, all preserving error
precedence/authority/CAS semantics: fold `migration-candidate` +
`migration-source` + `migration-rollback-*` + `restore-replacement-*` stages
(~2,350 LOC family) into a ~1,100-line staged pipeline module; merge
`connection.js` + `unit-of-work.js` transaction plumbing (~250 LOC); drop the
remaining `task-migration`/`task-lock`/`transaction` shims (~240 LOC). Realistic
upside ≈ 2,300–2,900 lines → current ~30,100. Still ~10,800 above ceiling; it
changes the number, not the verdict.

**Option C — Amend the acceptance contract (owner changes the goal).** Replace
the 25 % production-persistence reduction with a demonstrated tradeoff metric
this migration actually wins, e.g. "persistence LOC + measured p95 latency and
memory improvement, equal validation guarantees," which the hosted 1,000-case
benchmark (native ≈1.31 s vs baseline ≈2.1 s p95, output parity) already
supports at `85f4cce`.

## Recommended owner decision

Either **A + C packaged** (decline the 25 % numeric target, adopt the measured
performance-parity threshold as the replacement release criterion) or **B as a
bounded follow-up increment** with the accepted realistic floor recorded
beforehand. Options A and C require no further product changes; Option B is a
~2,300–2,900-line consolidation requiring fresh LOC + full-suite re-
verification. **No option authorizes weakening durability, skipping integrity
checks, hiding importer/exporter code from the count, or retaining dual write
backends.**

## What this document does not do

It does not apply any architecture change, does not close or re-define the
gate, and does not touch the existing release-decision record
([SQLITE_LOC_RELEASE_DECISION.md](SQLITE_LOC_RELEASE_DECISION.md)), which stays
OPEN until the owner chooses.

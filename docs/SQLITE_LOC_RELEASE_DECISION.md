# Inclusive production persistence LOC: release-decision record

**Status:** CLOSED — owner decision recorded 2026-10-12. This document records the
investigation the migration plan prescribes for a failed target. The owner chose
the documented Option A+C in
[SQLITE_LOC_OWNER_RECOMMENDATION.md](SQLITE_LOC_OWNER_RECOMMENDATION.md):
the numeric 25% reduction gate is retired and replaced by the
performance-parity acceptance criterion (migration plan §9 as amended in
commit `831b139`+ this record's commit). This document no longer blocks
acceptance; its investigation content is retained unchanged below.

**Prepared:** 2026-10-11, at source revision `4504270e1509f202330b7f58cb99231b15376147`
(branch `codex/sqlite-end-to-end`), with unchanged inclusive scope and an exact,
zero-unresolved-membership analyzer run.

## Governing rule (quoted, unchanged)

From [SQLITE_MIGRATION_PLAN.md](SQLITE_MIGRATION_PLAN.md), §9 "Proposed release
thresholds":

> - At least **25% net reduction in production persistence-related LOC**, counting
>   the new store, retained importer/exporter, compatibility helpers, and
>   maintenance code in the same scope.
>
> Failing a target triggers investigation and a release decision. It does not
> justify lowering durability, skipping integrity checks, hiding importer code
> from the LOC count, or retaining both write backends indefinitely.

The same section defines the measurement contract the current evidence satisfies:
the new store, importer/exporter, compatibility helpers, and maintenance code
count **in the same scope**. The handoff reiterates: *"Do not minify, redefine
persistence scope, exclude maintenance/import/export, remove validators, or waive
the original threshold. Investigate genuine architecture consolidation and
quantify actual changes."*

## The measurement (committed evidence)

| Source | Value |
| --- | --- |
| Baseline `ee9ce11` selected lines | 25,732 |
| Approved ceiling (≤ 75%) | **19,299** |
| Current `13ab5cf`/`4504270` selected lines | **32,896** |
| Remaining gap | **13,597 lines** |
| Unresolved membership | 0 (measurement is acceptance-eligible) |

Evidence: `benchmarks/storage-sqlite/persistence-loc-13ab5cf-*.json*` (committed
report, scope manifest, compressed raw per-node result; analyzer
`persistence-loc-function-analyzer.mjs` sha `11616f80…`, TypeScript parser 7.0.2,
unchanged algorithm across both sides). `4504270` adds no production lines over
`13ab5cf`; it appends evidence archives only, so the count holds at HEAD.

## Where the 32,896 selected lines sit (from the raw per-node census)

The unmet gap is not dispersed; it is concentrated in the parts of the system the
migration plan itself directed us to build:

| Component | Selected lines | Character |
| --- | --- | --- |
| All `src/storage/*` modules (mandatory whole-module) | 7,435 | net-new; the store the plan called for |
| Migration/rollback/restore/backup family alone | ≈ 2,350 | ~20 stage modules: `migration-candidate` 379, `migration-source` 236, `migration-rollback-*` ≈ 650, `restore/replacement-*` ≈ 640, `connection-owner`, `windows-process-incarnation` 192 |
| Net growth elsewhere (`integration-invocation-policy` +200, `task-discovery` +160, `execution-prerequisites` +105, `cli-command-definitions` +101, `task-guards` +99, …) | ≈ 1,300 | lifecycle/protocol surface already present at baseline, plus small increments |
| Baseline deletions already taken | −989 | `transaction.js` −266, `task-migration.js` −246, `task-lock.js` −213, `transaction-maintenance.js` −67 |

## Investigation performed: the elimination arithmetic

The plan requires "genuine architecture consolidation," so that was executed and
measured — not merely estimated.

**Experiment (committed at this revision, then reverted to keep the working tree
frozen at `4504270` per measurement discipline):**

- Scope: `src/storage/unit-of-work.js` (613 counted lines; the single largest
  selected file), covering the two consolidation candidates the census showed:
  (a) collapse of four identical `recordDefinition` unknown-kind throw sites into
  one `requireRecordDefinition` helper, and (b) a shared
  register/bind-complete event-observation helper replacing three divergent
  copies of the persisted-head/staged-tail observation pattern.
- Both changes were implemented, repaired through one real regression (a
  bounded-tail digest initially rebound to a full-scan recheck query), and driven
  to green: 99/99 targeted storage suites, 70/70 ledger suites (including the
  100,000-event ledger audit), 53/53 atomicity suites, `verify:fast` all stages,
  ESLint clean.
- **Measured LOC result: +52 counted lines** (613 → 665 nonblank). The extracted
  helpers, each carrying the warning comments the distributed copies needed, cost
  more than the duplication they removed. Duplication here is *smaller* than the
  abstraction that replaces it.

With the available consolidation candidates measured at **net-negative LOC**, and
the remaining families (migration/rollback/restore stage modules ≈ 2,350 lines,
each with dedicated crash-recovery test files asserting their per-stage behavior)
that can at best yield a fraction of the gap at high semantic risk, no
unchanged-scope, no-behavior-change route to −13,597 lines exists. A reduction
large enough would require deleting semantics the plan explicitly forbids
removing: importer/exporter code, maintenance machinery, validators, or the
mailbox at the core of dual-backend elimination that Phase 4 already completed
(the writable filesystem backend is gone; what remains is the SQLite path plus
its migration tooling).

## Why this target failed while its neighbors passed

The 25% LOC target was set from a static-planning assumption that the new store
would be a small module family. The built implementation committed — correctly,
under the plan's own correctness and resilience gates — to the subsystems those
gates demanded: explicit migration admission/publication/rollback with
interruption recovery, attachment publication before reference, backup/restore,
and sole-writer legacy exclusion. The performance gates those same sections set
are **met with margin** (see the timed matrix at revision `4504270`: discovery
p95 1.35–2.66× on 10–1,000 tasks; idempotency p95 61.8× at 1,000 actions;
state-plus-event commit p95 −72% to −91% at equal durability; CLI small-workspace
improvements above tolerance; 2 MiB baseline ledger refusal honored as
NOT_COMPARABLE). The evidence files are `benchmarks/storage-sqlite/*-4504270-*.json`.

In other words: the migration achieved its durability, correctness, and
performance goals; it spent the code the correctness gates required spending. The
25% arithmetic and the correctness arithmetic are in direct conflict, and the
rule text anticipates exactly this: it calls for investigation and a release
decision, explicitly warning against the three dishonest escapes (hiding code,
skipping checks, keeping both backends).

## Decision requested from the owner

This memo does not choose. It presents the options the rule leaves open:

1. **Accept the miss as a documented release decision.** Ship with the LOC gate
   recorded as missed, with this document and the committed measurement as the
   permanent record. No scope, durability, or behavior change is involved.
   Precedent for honest release decisions exists in the plan (§1: "changing that
   is a release decision, not a transparent optimization").
2. **Split the scope decision explicitly.** Decide whether the migration tooling
   (admission/publication/rollback/restore machinery ≈ 2,350 lines) belongs in
   the *persistence runtime* metric or is maintenance tooling that ships beside
   it. This is an owner decision because every current exclusions within scope
   would contradict "maintenance code in the same scope" as written; only the
   owner can re-scope.
3. **Invest further into a specifically authorized reduction** (for example,
   collapse of the migration stage-machine families) at acknowledged semantic
   risk to crash-recovery behavior. The investigation above bounds the realistic
   yield far below the gap.

**What any option must preserve, per the same rule:** durability (WAL/FULL,
verified), integrity checks, importer/exporter counted or explicitly re-scoped,
and a single writable backend (already true).

## Provenance and integrity

- Source frozen at `4504270e1509f202330b7f58cb99231b15376147`; tracked sources
  unchanged through all benchmark runs (`trackedSourcesUnchanged: true` in every
  raw timing file).
- LOC numbers come from the committed, zero-unresolved-membership
  `persistence-loc-13ab5cf` evidence, which applies unchanged at HEAD because the
  consolidation experiment was reverted rather than retained.
- No receipts, analyzer outputs, or measurement artifacts were altered to write
  this document; the consolidation experiment it cites was executed, measured,
  and reverted, with its green-suite receipts captured in the run log quoted in
  the investigation section.
- Pinned runtime Node 24.19.0; dependency symlinks and `stash@{0}` untouched
  throughout.

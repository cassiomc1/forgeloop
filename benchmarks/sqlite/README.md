# SQLite ledger memory experiment

This reproducible experiment measures one synthetic task with 10, 1,000 and
100,000 genuine hash-chained events. Each event contains a deterministic 1 KiB
observation message (seed 42). It compares the pinned pre-migration commit
`ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5` (core 1.14.0) with the current SQLite
reader. Fixtures are built outside the measured processes. Every successful
sample checks the full payload digest, sequence, task identity, ancestry and
content hash; audit samples also invoke the actual shared ledger validator.

Run from a repository checkout containing the pinned commit and existing project
dependencies, using Node24.19.0:

```sh
node scripts/benchmark-ledger-memory.mjs --events=10,1000,100000 --repeats=3 --warmup=1 --seed=42 --payload-bytes=1024 --out=benchmarks/sqlite/ledger-memory-node24-macos.json
```

[Raw measurements](ledger-memory-node24-macos.json) include individual timings,
output digests, runtime/SQLite versions, hardware, dataset/database bytes,
throughput, peak RSS and event-loop delay. Temporary fixtures, exports and the
baseline archive are removed. No TypeSafe request, software installation or user
data migration is performed. The baseline uses the checkout's existing external
dependencies; common harness imports and the pinned filesystem reader imports
are included in its process footprint.

## Observed 100,000-event SQLite results

| Operation | Warm p95 ms | Peak process RSS MiB |
| --- | ---: | ---: |
| iterator | 1609.276 | 111.64 |
| audit | 2015.857 | 617.89 |
| export | 2603.368 | 141.08 |

The pinned filesystem iterator and audit refuse this dataset at their existing
2 MiB whole-ledger limit (`JSON_LIMIT_EXCEEDED`). Their refusal is recorded with
no successful timing or output-equivalence claim; the guard was not weakened.
SQLite completes the larger dataset. No latency speedup against a refused
operation is claimed.

The full array-returning SQLite audit consumes much more memory than iteration
or export. This measurement identifies remaining materialization work; it does
not establish a whole-product bounded-memory gate. The 1,000-event timings also
show SQLite reader/validator overhead that requires investigation in final
performance acceptance.

## Interpretation limits

Each operation/size uses a fresh worker, one discarded warmup and three measured
warm domain samples. Nearest-rank p95 with three samples is the maximum sample,
not a high-confidence release estimate. Peak RSS covers startup, warmup, measured
operations and export validation; fixtures are excluded. Event-loop delay covers
worker operations, verification and intervening idle ticks. Export latency ends
after publication and precedes independent output verification, which still
contributes to the process RSS peak.

These are not cold CLI timings or controlled filesystem-cold measurements. No
forced garbage collection or OS cache eviction is used. Baseline export timing
is not claimed equivalent. WAL/FULL durability is used; database size is recorded
after fixture close/checkpoint. WAL growth, file-operation counts, lock waits,
concurrent clients, the complete task/action matrix, other operating systems,
final persistence LOC and release thresholds remain separate unfinished work.

## Direct array cursor follow-up

[Follow-up measurements](ledger-memory-direct-array-node24-macos.json) use the
same fixtures and harness after native array reads were changed to consume the
synchronous validated store cursor directly. Streaming callers retain the async
iterator. Full row validation, staged events and optimistic read-set bindings
remain required; concurrent-change and invalid-schema controls cover the array
path explicitly.

The isolated 100,000-event audit measured p95 2068.771 ms and peak process RSS
608.61 MiB, compared with 2015.857 ms and 617.89 MiB in the preceding experiment.
These independent three-sample runs do not establish a latency or memory
improvement. Removing the per-row async boundary does not resolve full-array
materialization; that remaining work is still required for final memory
acceptance. A preliminary rerun overlapped regression tests and is excluded from
this published follow-up.

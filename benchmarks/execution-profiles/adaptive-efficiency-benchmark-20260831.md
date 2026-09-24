# ForgeLoop Adaptive Efficiency Benchmark

Status: measured and observational. This report records a real host run; it
does not promote efficiency observations to lifecycle, verification, or
completion evidence.

The earlier `codex-repeat5-20260831` run set remains preserved in the results
directory. The results below use the quality-evidence run set, which adds a
post-run blind UI-quality finalization pass without changing the host timing
or usage measurements.

| Field | Value |
| --- | --- |
| Run set | `codex-quality-repeat5-20260831` |
| Recorded | 2026-08-31 |
| Host | locally authenticated Codex CLI |
| Implementation model | `gpt-5.4-mini` |
| Implementation reasoning effort | `low` |
| Provider label | `codex-chatgpt` |
| Environment | `codex-cli-darwin-arm64`, Node `26.8.1` |
| Scenarios | 7, including the original NovaTask workload |
| Modes | `direct`, `forgeloopBalanced`, `forgeloopAdaptive` |
| Samples | 5 runs per scenario and mode, 105 runs total |
| Usage source | `HOST_REPORTED` |
| Blind quality records | 30 UI records, 10 evaluator groups, 5 per mode and UI scenario |

## Efficiency results

Token values are the observed total tokens for all five runs in a mode. The
adaptive comparison columns use matching run indices that passed the
deterministic verifier; they are observational P50/P95 comparisons, not a
claim that every run had the same outcome. A positive percentage means that
adaptive used more tokens or time than direct for that statistic.

| Scenario | Resolved profile | Direct P50 tokens | Balanced P50 tokens | Adaptive P50 tokens | Adaptive vs direct token P50 / P95 | Adaptive vs direct time P50 / P95 | Verification direct / balanced / adaptive |
| --- | --- | ---: | ---: | ---: | --- | --- | --- |
| API feature | `balanced` | 56,280 | 58,391 | 57,478 | +1.8923% / +1.9949% (3 pairs) | +19.0659% / +24.1380% (3 pairs) | 5/5 / 5/5 / 3/5 |
| Authentication change | `full` | 55,983 | 57,925 | 57,535 | +2.7121% / +3.1454% (5 pairs) | +18.3299% / +21.4037% (5 pairs) | 5/5 / 5/5 / 5/5 |
| Documentation correction | `light` | 55,518 | 57,734 | 58,716 | +7.3046% / +7.6352% (3 pairs) | +44.6554% / +54.1420% (3 pairs) | 4/5 / 4/5 / 4/5 |
| Infrastructure release | `full` | 69,095 | 57,433 | 57,103 | -17.5706% / +3.9755% (5 pairs) | -4.4544% / +53.1226% (5 pairs) | 5/5 / 5/5 / 5/5 |
| NovaTask SaaS landing page | `light` | 178,041 | 168,987 | 151,138 | -30.0426% / -4.3345% (4 pairs) | -15.6764% / -13.2952% (4 pairs) | 4/5 / 5/5 / 5/5 |
| Small bug fix | `balanced` | 56,340 | 57,459 | 57,595 | +2.0067% / +21.3338% (5 pairs) | +22.6377% / +34.7155% (5 pairs) | 5/5 / 5/5 / 5/5 |
| Static landing page | `light` | 140,206 | 144,754 | 146,367 | +2.2143% / +133.2808% (5 pairs) | +12.3455% / +19.1648% (5 pairs) | 5/5 / 5/5 / 5/5 |

The runner captured actual wall-clock time, verification cycles, and
comparable steps for every run. The validator recomputed aggregates from the
raw files; no token, cache, cost, or timing value was derived from prompt
length or another estimate.

The plan's LIGHT objectives are non-blocking observations against the
comparable direct baseline:

| LIGHT scenario | Adaptive token P50 / P95 overhead | Adaptive time P50 / P95 overhead | Objective result |
| --- | --- | --- | --- |
| Documentation correction | +7.3046% / +7.6352% | +44.6554% / +54.1420% | P50 and P95 token objectives pass |
| NovaTask SaaS landing page | -30.0426% / -4.3345% | -15.6764% / -13.2952% | P50 and P95 token objectives pass |
| Static landing page | +2.2143% / +133.2808% | +12.3455% / +19.1648% | P50 passes; P95 token objective fails |

The static landing-page P95 paired observation is reported by the regression check as
`EFFICIENCY_REGRESSION`. Note that `pairedOverheadP95Percent` measures the P95 of run-index paired relative ratios (`((adaptive_i - direct_i) / direct_i) * 100`), which is sensitive to runs falling into `LOW_BASELINE_TOKEN_REGIME` in the direct baseline. When comparing overall distribution percentiles directly (`distributionP95DeltaPercent`), candidate distribution spread remains bounded. These are observational results and are not a
completion gate. The deterministic verifier is a requirements check, not a
visual-quality evaluator.

## Blind UI-quality finalization

The two UI scenarios were finalized after all 105 host runs completed. The
quality pass rendered anonymized candidates at fixed desktop `1440x900` and
mobile `390x844` viewports, collected neutral DOM and interaction observations,
and sent only the requirements, observations, and candidate screenshots to a
separate local Codex CLI evaluator. The evaluator used `gpt-5.4` with low
reasoning effort. It did not receive mode names, run IDs, source paths, or
self-reported scores. The quality source is therefore recorded as
`EXTERNAL_REPORTED`; these scores are still observational and are not human
acceptance testing.

The scores below are averages on a 0--5 scale in the order visual,
responsive, accessibility, interaction, and requirements completeness.

| Scenario / mode | Visual | Responsive | Accessibility | Interaction | Requirements |
| --- | ---: | ---: | ---: | ---: | ---: |
| NovaTask / direct | 4.32 | 4.54 | 4.66 | 4.10 | 4.74 |
| NovaTask / balanced | 4.58 | 4.70 | 4.72 | 4.38 | 4.80 |
| NovaTask / adaptive | 4.54 | 4.58 | 4.62 | 4.34 | 4.78 |
| Static landing / direct | 4.14 | 4.38 | 4.42 | 3.96 | 4.60 |
| Static landing / balanced | 4.26 | 4.48 | 4.50 | 4.16 | 4.72 |
| Static landing / adaptive | 4.54 | 4.56 | 4.46 | 4.16 | 4.58 |

Adaptive minus balanced quality deltas were `-0.04, -0.12, -0.10, -0.04,
-0.02` for NovaTask and `+0.28, +0.08, -0.04, 0.00, -0.14` for the static
landing page. This sample does not support a general claim that LIGHT
preserves quality relative to BALANCED; the plan's quality-preservation
criterion remains open. The evaluator is an evidence source, not an authority
that closes the product-quality decision.

## Host-consumption evidence

[`benchmarks/adapters/codex-cli-real-host.mjs`](../adapters/codex-cli-real-host.mjs)
is the provider-specific host adapter used for this run. It:

- creates a fresh local fixture for each run and invokes the authenticated Codex
  CLI with `workspace-write`, `--json`, model `gpt-5.4-mini`, and low reasoning;
- creates a temporary canonical ForgeLoop task for the balanced and adaptive
  modes, then reads `task/context` through the public integration resource;
- passes the canonical `executionProfile.resolved` value to the host prompt;
  adaptive requests `auto`, but the host consumes the resolved profile;
- records non-direct usage through Core's normalized `writeTaskUsage` API with
  source `HOST_REPORTED` and appends the canonical `USAGE_RECORDED` event;
- runs a deterministic verifier against the isolated fixture after the host
  exits; and
- invokes the optional benchmark finalizer only after all host runs have
  completed, attaching quality by the canonical runner `runId`.

The host uses the usage values emitted by the CLI's completed-turn event:
`input_tokens`, `output_tokens`, `cached_input_tokens`, and
`cache_write_input_tokens`. `totalTokens` is the reported total when present,
or the exact arithmetic sum of the reported input and output fields. The
adapter never estimates tokens from characters, prompt size, elapsed time, or
model names. Wall-clock time is measured by the benchmark runner.

## Known evidence boundaries

The Codex CLI exposes aggregate turn usage, but not a trustworthy token
decomposition for task context, guides, history, protocol instructions,
repository context, and other context items. Consequently all 105 runs keep
`contextUsage.source` as `UNKNOWN` with null item values, and every aggregate
reports context inflation as `NOT_COMPARABLE`. This report does not claim that
LIGHT context is smaller than BALANCED context.

The quality finalizer is independent of token and lifecycle accounting. It
does not make a failed efficiency observation pass, and it does not convert an
external score into ForgeLoop verification or completion evidence.

## Reproduction

The host adapter requires a locally authenticated `codex` executable and an
available `gpt-5.4-mini` model. Blind quality finalization additionally
requires an already available Playwright package and browser executable; the
workflow does not install them. A new run set must use a new output directory:

```bash
FORGELOOP_BENCHMARK_MODEL=gpt-5.4-mini \
FORGELOOP_BENCHMARK_REASONING=low \
FORGELOOP_BENCHMARK_QUALITY_EVALUATOR=./benchmarks/evaluators/codex-cli-blind-visual.mjs \
FORGELOOP_BENCHMARK_PLAYWRIGHT_ROOT=/absolute/path/to/playwright \
FORGELOOP_BENCHMARK_BROWSER=/absolute/path/to/browser \
FORGELOOP_BENCHMARK_EVALUATOR_MODEL=gpt-5.4 \
npm run benchmark:profiles -- \
  --adapter ./benchmarks/adapters/codex-cli-real-host.mjs \
  --runs 5 \
  --run-set codex-quality-reproduction-YYYYMMDD \
  --output /tmp/forgeloop-benchmark-results-reproduction \
  --json

npm run benchmark:profiles:summary -- \
  --results /tmp/forgeloop-benchmark-results-reproduction \
  --run-set codex-quality-reproduction-YYYYMMDD \
  --json

npm run benchmark:profiles:check -- \
  --results /tmp/forgeloop-benchmark-results-reproduction \
  --json
```

The committed run set contains normalized measurements and aggregate
artifacts. No credentials, external service data, or temporary fixture
workspaces are committed.

## Release status

The `v1.7.0` tag, GitHub Release, npm publication, package identity, and
installed-package smoke checks were completed separately in the core release
delivery. This benchmark report does not represent a second package release.

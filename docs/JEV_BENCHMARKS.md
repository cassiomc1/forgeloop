# Jev benchmark and calibration

`npm run benchmark:jev` emits an offline deterministic baseline for model-route
scenarios. It records the pinned engine/model, safety-floor projection, fallback
status, Jev/cache/latency fields, context and tool dimensions, and unknown host
telemetry. Zero counts mean that no provider request was made; `null` and
`NOT_MEASURED` remain explicit when the host did not observe a value. It does
not fabricate provider usage and does not authorize lifecycle, execution,
pruning, or completion.

Provider-backed calibration requires a live TypeSafe organization with credits;
an unavailable provider is reported as unavailable rather than treated as a
successful benchmark.

`npm run benchmark:jev:live` runs bounded intake, route, and context requests
through the pinned Jev provider and reports provider usage/latency only when the
provider supplies it. It requires `TYPESAFE_API_KEY`, never prints that key,
and is intentionally separate from the offline benchmark.

Dependency audit attribution for the current base and PR head is unchanged:
one high-severity `js-yaml` advisory (`GHSA-2883-xcg3-v3hh`, CVSS 7.5, CWE-400
and CWE-407) arrives transitively through `eslint` → `@eslint/eslintrc` →
`js-yaml` 4.3.1. It is not introduced by the Jev dependency; the audit reports
an available upgrade outside this correction's runtime dependency policy.

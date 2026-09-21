# Jev benchmark and calibration

`npm run benchmark:jev` emits an offline deterministic baseline for model-route
scenarios. It records the pinned engine/model, safety-floor projection, fallback
status, and unknown token telemetry. It does not fabricate provider usage and
does not authorize lifecycle, execution, pruning, or completion.

Provider-backed calibration requires a live TypeSafe organization with credits;
an unavailable provider is reported as unavailable rather than treated as a
successful benchmark.

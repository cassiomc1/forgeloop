# Semantic Decision Plane

ForgeLoop uses the pinned TypeSafe Jev model `jev-1.13.0` for bounded semantic decisions. The SDK version is exact-pinned in `package.json` and credentials are read only from `TYPESAFE_API_KEY`; credentials are never persisted in ForgeLoop artifacts, event details, diagnostics, or logs.

Jev output has `SEMANTIC_DECISION` authority and `NONE` evidence authority. It cannot advance lifecycle, change ownership, satisfy gates, record verification, mark completion, install dependencies, execute commands, or delete tests. ForgeLoop remains the deterministic authority for state, claims, locks, schemas, event chronology, evidence, recovery, and completion.

Failure triage, diagnosis prioritization, and review planning use the versioned
question sets `failure-v1`, `diagnosis-v1`, and `review-v1`. Their projections
are advisory only: deterministic mandatory review signals are always unioned
into the plan, unknown semantic output escalates, and no projection can record
evidence or authorize an action.

Test utility analysis uses `test-utility-v1` and is persisted separately from
completion evidence. Protected, contract-linked, public-API, security, and
protocol tests remain keep-required or keep-risk-guard candidates; unknown
utility is blocked and no command performs deletion.

Context plans are bounded, fingerprinted, and non-authoritative. Deterministic mandatory candidates remain selected even when a semantic ranker is unavailable; suspicious instruction-like text is marked as prompt-injection content and is never treated as an instruction. Token values are `UNKNOWN` unless the provider or host reports them.

`npm run jev:smoke` performs only a tiny health request when credentials are configured. A missing credential reports `NOT_RUN`; an unavailable or rate-limited service is a failed live check, never a fabricated success. Inspection, recovery, and completion validation do not require a live Jev call.

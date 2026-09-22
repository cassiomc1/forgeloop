# Semantic Decision Plane

ForgeLoop uses the pinned TypeSafe Jev model `jev-1.13.0` for bounded semantic decisions. The SDK version is exact-pinned in `package.json` and credentials are read only from `TYPESAFE_API_KEY`; credentials are never persisted in ForgeLoop artifacts, event details, diagnostics, or logs.

Jev output has `SEMANTIC_DECISION` authority and `NONE` evidence authority. It cannot advance lifecycle, change ownership, satisfy gates, record verification, mark completion, install dependencies, execute commands, or delete tests. ForgeLoop remains the deterministic authority for state, claims, locks, schemas, event chronology, evidence, recovery, and completion.

Every semantic checkpoint uses a versioned question set: intake, contract
applicability, route enrichment, context planning, model routing, failure
triage, diagnosis prioritization, review planning, task overlap, test utility,
and test pruning. Failure triage, diagnosis prioritization, and review planning
remain advisory projections: deterministic mandatory review signals are always
unioned into the plan, unknown semantic output escalates, and no projection can
record evidence or authorize an action.

Test utility analysis uses `test-utility-v1` and is persisted separately from
completion evidence. Protected, contract-linked, public-API, security, and
protocol tests remain keep-required or keep-risk-guard candidates; unknown
utility is blocked and no command performs deletion.

Context plans send bounded, sanitized actual candidates to Jev. The candidate-set
fingerprint is bound to the persisted decision, and Jev returns candidate ranking
and exclusion judgments consumed by the context compiler. Deterministic required
and mandatory candidates remain selected; prompt-injection candidates are never
given semantic authority. Token values are `UNKNOWN` unless the provider or host
reports them.

Route execution records intake and route decisions before persisting the route.
The deterministic router remains the eligibility and safety floor; Jev can only
enrich eligible route/profile choices. A missing live decision fails closed.

`npm run jev:smoke` performs only a tiny health request when credentials are configured. A missing credential reports `NOT_RUN`; an unavailable or rate-limited service is a failed live check, never a fabricated success. Inspection, recovery, and completion validation do not require a live Jev call, but a semantic-required mutation fails closed when its canonical decision is missing or stale.

Semantic-required operations use fail-closed cutover semantics: an unavailable,
stale, malformed, or unsupported decision cannot silently authorize a mutation.
Offline inspection, recovery, and deterministic completion validation remain
usable without a live Jev request. Cached decisions may be used only when their
existing fingerprint/freshness validators accept them.

# Semantic Decision Plane

ForgeLoop uses the pinned TypeSafe Jev model `jev-1.13.0` for bounded semantic decisions. The SDK version is exact-pinned in `package.json` and credentials are read only from `TYPESAFE_API_KEY`; credentials are never persisted in ForgeLoop artifacts, event details, diagnostics, or logs.

Jev output has `SEMANTIC_DECISION` authority and `NONE` evidence authority. It cannot advance lifecycle, change ownership, satisfy gates, record verification, mark completion, install dependencies, execute commands, or delete tests. ForgeLoop remains the deterministic authority for state, claims, locks, schemas, event chronology, evidence, recovery, and completion.

The decision registry contains versioned question sets for intake, contract
applicability, route, execution profile, context, model routing, failure triage,
diagnosis, review, task overlap, test utility, and test pruning. Current route,
context, and test-utility mutations also use bounded dynamic candidate question
sets: `route-candidates-v1`, `context-candidates-v1`, and
`test-utility-candidates-v1`. Failure triage, diagnosis prioritization, and review planning
remain advisory projections: deterministic mandatory review signals are always
unioned into the plan, unknown semantic output escalates, and no projection can
record evidence or authorize an action.

Decision freshness separates canonical lifecycle state from semantic request
state. Persisted artifacts retain both fingerprints and their combined request
fingerprint, so lifecycle mutations cannot be mistaken for semantic changes
and semantic changes cannot be hidden by a stable lifecycle revision. The
lifecycle, event ledger, claims, and artifact validators remain authoritative.

Test utility analysis uses the bounded `test-utility-candidates-v1` question set
for the current command path; `test-utility-v1` remains a registered base
question set. The analysis is persisted separately from
completion evidence. Protected, contract-linked, public-API, security, and
protocol tests remain keep-required or keep-risk-guard candidates; unknown
utility is blocked and no command performs deletion.

Context plans send bounded, sanitized actual candidates to Jev. The candidate-set
fingerprint is bound to the persisted decision, and Jev returns candidate ranking
and exclusion judgments consumed by the context compiler. Deterministic required
and mandatory candidates remain selected; prompt-injection candidates are never
given semantic authority. Token values are `UNKNOWN` unless the provider or host
reports them.

Route execution records intake, route relevance, and execution-profile decisions
before persisting the route. The deterministic router remains the eligibility
and safety floor; Jev may rank or exclude only eligible non-mandatory guides and
may raise the execution profile, never lower a deterministic safety floor.
Mandatory safety protection is derived from the canonical deterministic route
reasons already produced by the router (`isMandatorySafetyGuide` reads the
`MANDATORY_SAFETY_REASONS` set — `SURFACE_AUTH` plus the trust-boundary risk
reasons `RISK_UNTRUSTED_INPUT`, `RISK_PERSONAL_DATA`, `RISK_SECRETS`,
`RISK_EXTERNAL_SERVICE`, `RISK_PUBLICATION`), so a security guide selected for an
external-service boundary cannot be removed by Jev and retains an explicit
`MANDATORY_SAFETY_GUIDE` reason. Mandatory safety guides and low-confidence
exclusions remain selected. A missing live decision fails closed.

The semantic provider is injected into repository tests through an internal
loader only. There is no production environment switch that turns semantic
decisions into fixture results; packaged commands without the pinned provider
fail closed.

`npm run jev:smoke` performs only a tiny health request when credentials are configured. A missing credential reports `NOT_RUN`; an unavailable or rate-limited service is a failed live check, never a fabricated success. Provider failures are classified into stable error codes (authentication, unsupported model, rate limit, timeout, result normalization) and, for live maintainer diagnostics, the smoke result additionally reports only safe metadata (HTTP status, provider error type, request id, network class) — never credentials, headers, or raw request bodies. Inspection, recovery, and completion validation do not require a live Jev call, but a semantic-required mutation fails closed when its canonical decision is missing or stale.

The `INTAKE` and `CONTRACT_APPLICABILITY` checkpoints are observation-only in
this version. Their immutable decisions are recorded, fingerprinted, and
available for review and follow-up consumption, but their result does not
currently alter the route or create, skip, or weaken the contract: Jev never
removes user or deterministic signals, and a semantic `applicable: false` can
never suppress a deterministic contract requirement. A narrow additive consumer
was evaluated and deferred because it changes behavior across every provider
mode without a validated benefit; semantic consumption is tracked as a
follow-up task, not claimed as current routing quality.

Semantic-required operations use fail-closed cutover semantics: an unavailable,
stale, malformed, or unsupported decision cannot silently authorize a mutation.
Offline inspection, recovery, and deterministic completion validation remain
usable without a live Jev request. Cached decisions may be used only when their
existing fingerprint/freshness validators accept them.

# Model routing

ForgeLoop exposes model routing as a bounded, non-authoritative projection. The
deterministic policy establishes the safety floor:

- `NONE` when no generation is required;
- `STANDARD` for ordinary executable generation;
- `PRIMARY` for security, architecture, migration, ambiguity, and other
  high-risk signals.

The pinned Jev model (`jev-1.13.0`) may recommend an escalation or request an
escalation when confidence is low. It can never lower the deterministic floor,
select a vendor-specific model, execute a command, change lifecycle state,
authorize ownership, or weaken verification requirements. ForgeLoop remains the
authority for all lifecycle, evidence, safety, and completion decisions.

The live Jev provider is not an authority substitute. Semantic-required
model-routing operations consume a fresh persisted `MODEL_ROUTE` decision and
fail closed when it is unavailable or stale; offline inspection may still
project deterministic policy without making a network request.

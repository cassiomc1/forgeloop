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

The live Jev provider is optional at runtime for inspection and bounded
projections. If it is unavailable, callers must use the deterministic policy or
fail closed; no fabricated semantic result is accepted.


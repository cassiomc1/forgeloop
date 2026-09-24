# Model routing

ForgeLoop exposes model routing as a bounded semantic-decision projection. It
has `SEMANTIC_DECISION` authority only within the declared decision contract;
it has no lifecycle, completion, evidence, ownership, installation, command, or
publication authority. The deterministic policy establishes the safety floor:

- `NONE` when no generation is required;
- `STANDARD` for ordinary executable generation;
- `PRIMARY` for security, architecture, migration, ambiguity, and other
  high-risk signals.

The deterministic floor currently emits `NONE`, `STANDARD`, or `PRIMARY`. The
public vocabulary also includes `FAST`, which is available only as an advisory
escalation and cannot lower the deterministic floor.

The pinned Jev model (`jev-1.13.0`) may recommend an escalation or request an
escalation when confidence is low. It can never lower the deterministic floor,
select a vendor-specific model, execute a command, change lifecycle state,
authorize ownership, or weaken verification requirements. ForgeLoop remains the
authority for all lifecycle, evidence, safety, and completion decisions.

For route execution, the same boundary applies to guide relevance: Jev can
reorder or remove a selected non-mandatory guide only with sufficient
confidence. Mandatory safety protection is derived from the canonical
deterministic route reasons the router already produced (auth surface and the
trust-boundary risks untrusted-input, personal-data, secrets, external-service,
publication), so a `security` guide selected by `external-service` risk cannot be
removed. Mandatory safety guides are retained and low-confidence removal
recommendations are retained rather than treated as authority. The resulting
guide set and profile are persisted in the route artifact, so the semantic
recommendation materially affects routing without becoming lifecycle authority.

The live Jev provider is not an authority substitute. Semantic-required
model-routing operations consume a fresh persisted `MODEL_ROUTE` decision and
fail closed when it is unavailable or stale; offline inspection may still
project deterministic policy without making a network request.

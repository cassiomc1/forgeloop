---
name: clean-code-eng
language: en
description: "Practices for readable, observable, secure code operated by AI agents."
version: "2026.09"
last-reviewed: "2026-10-17"
guide-id: clean
---

# Clean Code for AI Agents

> Original operational synthesis influenced by Fabio Akita's "Clean Code for AI Agents" article. It is not a translation, reproduction, or work officially associated with the author.
>
> **Related documents**: for language-specific testing frameworks and tools, see [`test-code-eng.md`](./test-code-eng.md). For security, see [`sec-code-eng.md`](./sec-code-eng.md), the canonical reference for secrets, authorization, cryptography, and sensitive-data redaction. For visual/UX guidelines, see [`design-code-eng.md`](./design-code-eng.md). For HTML-based video and motion, see [HyperFrames](https://hyperframes.heygen.com). This guide focuses on code quality, structure, and operation.
>
> **Tooling policy**: identify the stack, the stage, and the applicable checks; prefer an already available equivalent that produces compatible evidence. Installation or environment changes require authority; reuse scoped authorization already given rather than asking again. If no safe equivalent exists, record the required check as blocked and never claim that it passed. Do not install merely optional resources.

## Context

Clean code is infrastructure for people and AI agents. In both cases, the reader needs to locate intent, validate a change, and understand consequences without relying on tacit knowledge. The practices below favor cohesive units, explicit boundaries, execution evidence, and safe operation.

## Real constraints of AI agents

- **Partial reads**: agents read files in chunks; extensive or multi-purpose files make context retrieval less reliable.
- **Attention and latency**: larger context does not eliminate attention degradation; concise test output and logs reduce cost and ambiguity.
- **Name-driven search**: specific, consistent names make `rg` and equivalent tools useful for locating the right unit.
- **Operational evidence**: predictable commands, automated tests, and structured observability make it possible to verify hypotheses rather than fill gaps by assumption.

## Priority practices

### 1. Cohesive functions and files

Make a function express one understandable responsibility and keep the file navigable. Ranges such as 4–20 lines for functions, 200–300 lines for files, and 500 lines as a ceiling are **review signals**, not mechanical rules. Split when cohesion, domain vocabulary, or reading improve; keep a documented exception when splitting would harm those criteria.

### 2. Single responsibility

Each module should have a clear reason to change. Separate business rules, use-case coordination, integration, and presentation so a local change does not require unnecessary reading or testing of the rest of the system.

### 3. Meaningful and searchable names

Prefer names that reveal intent and belong to the domain vocabulary. `InvoiceLineItemTotal` communicates more than `process`; if a search for a name returns many irrelevant results, treat that as a review signal, not as an absolute numerical target.

### 4. Comments with context, not noise

Record the why, an external constraint, a decision, or the provenance of non-obvious behavior. Update or remove stale comments: preserving a comment merely because it exists propagates incorrect context. Avoid describing syntax that the code already makes clear.

### 5. Explicit types and contracts

Types, schemas, and preconditions make inputs, outputs, and invalid states visible. Make contracts explicit at boundaries and validate external data; do not use annotations merely to satisfy a tool when they obscure the domain.

### 6. Intentional DRY

Extract truly repeated logic when the copies share the same rule and will evolve together. Do not join snippets merely because they look similar: a premature abstraction can hide important domain differences.

### 7. Tests the agent can run

Keep a documented, repeatable, self-contained command when the project provides one. Do not invent a command or install a tool merely to make a check runnable; record a required unavailable check as blocked. Every behavior change needs tests appropriate to its risk: unit tests for rules, integration tests for boundaries, and regression tests for real failures. See [`test-code-eng.md`](./test-code-eng.md) for language-specific choices.

### 8. Predictable structure

Use stack conventions when they make responsibilities easier to locate, but do not force a framework structure on a project that does not use it. Predictability should serve navigation and boundaries, not the appearance of compliance.

### 9. Risk-proportionate dependencies

Introduce project-owned interfaces or wrappers for I/O, volatile SDKs, expensive integrations, side-effecting dependencies, or when a fake makes the test clearer. Direct imports are acceptable for stable, pure, well-understood libraries. Do not create an abstraction without a consumer or an explicit decision.

### 10. Simple flow

Prefer guard clauses, early returns, and decomposition when they reduce implicit states. Two indentation levels are a useful review signal, not a prohibition: keep a larger block when it makes the business rule more readable.

### 11. Safe, actionable errors

Use stable codes for programmatic handling and include only safe diagnostic context. Never include raw values, secrets, passwords, tokens, PII, card numbers, or complete payloads in error messages, traces, or logs. Follow [`sec-code-eng.md`](./sec-code-eng.md) for classification, retention, access, and redaction.

### 12. Automatic formatting

Use the formatter accepted by the stack and apply it consistently. The tool resolves repetitive style; human and agent reviews should focus on intent, security, behavior, and contracts.

### 13. Obvious comments are debt

Remove comments that merely repeat the code and rewrite comments that have lost validity. A short, correct comment about a decision is worth more than a long, inaccurate history.

## Architecture and boundaries

Separate the system into three clear roles:

- **Domain** contains rules, types, and invariants that do not depend on network, disk, clock, or SDKs.
- **Application** coordinates use cases, transactions, flow authorization, and required ports.
- **Infrastructure** implements I/O, persistence, messaging, clock, SDKs, and adapters at the edges.

Keep I/O at the edges and make the domain depend on contracts rather than infrastructure details. Test contracts at both ends of a boundary and record relevant architecture decisions — context, decision, alternatives, and consequence — in an ADR or equivalent record. Tailor the separation to the system's size; the goal is to make dependencies and effects observable, not to impose a fashionable architecture.

## Async, concurrency, and external effects

- Propagate cancellation to every operation that can block and define an explicit timeout for every external call.
- Retry only transient failures, with a limited number of attempts, backoff, and jitter. Do not retry non-idempotent operations without an idempotency key or strategy.
- Limit concurrency to protect dependencies and local resources; clean up files, connections, tasks, and locks on success, failure, and cancellation.
- Define what can be repeated without changing the outcome and persist the evidence needed to detect duplicates.
- Test timeout, cancellation, cleanup, and race conditions with a controllable clock, scheduler, or dependencies; do not rely on arbitrary waits.

## Safe observability

Emit structured events with, at minimum, `event`, `level`, `request_id` or correlation ID, duration, result, and already-redacted fields. Establish stable names for events and results so alerts and queries do not depend on free text.

- Use **logs** for discrete events and safe diagnostic context.
- Use **metrics** for aggregated volume, latency, errors, and capacity.
- Use **traces** to follow a request across boundaries and dependencies.
- Define retention, access, and disposal according to operational need, cost, and security policy; shorter retention does not replace redaction.

Never treat logs, metrics, or traces as a place for sensitive data. The canonical reference for redaction and handling of this data is [`sec-code-eng.md`](./sec-code-eng.md).

## Evidence-driven debugging

If the root cause is not clear, formulate a hypothesis and add minimal temporary instrumentation in a controlled, non-production environment. Apply redaction/masking before emitting any data, reproduce the problem, compare the evidence with the hypothesis, and only then change behavior. Confirm removal of temporary instrumentation after the investigation; retain only structured events that are permanently useful.

## Framework-independent examples

### Safe error with a stable code

```text
return error(
  code = "ACCOUNT_ID_INVALID",
  message = "account identifier is invalid",
  safe_context = { field = "account_id" }
)
```

The client can react to `ACCOUNT_ID_INVALID`; the internal detail belongs in a protected, already-redacted channel, not in the returned text.

### Structured event with redacted fields

```json
{
  "event": "invoice.fetch.completed",
  "level": "info",
  "request_id": "req-7f3c",
  "duration_ms": 84,
  "result": "success",
  "customer_reference": "[REDACTED]"
}
```

The event preserves correlation and outcome without recording payload, token, card, or PII in plain text.

### Propagated timeout and cancellation

```text
result = fetch_invoice(
  invoice_id,
  timeout = 1500ms,
  cancellation = request.cancellation
)
```

The caller treats timeout and cancellation as expected results, releases resources, and does not begin a blind retry.

### Injectable dependency for an I/O edge

```text
interface InvoiceStore:
  load(invoice_id, cancellation) -> Invoice

class InvoiceService(store: InvoiceStore):
  get(invoice_id, cancellation) -> Invoice:
    return store.load(invoice_id, cancellation)
```

`InvoiceStore` is a justified port because it represents I/O; a pure mathematical function can be imported directly.

### Limited idempotent retry

```text
retry(
  operation = send_receipt(idempotency_key),
  attempts = 3,
  backoff = exponential_with_jitter
)
```

The retry is limited and is safe only because the operation receives a verifiable idempotency key.

## Template for `CLAUDE.md` / `AGENTS.md`

Adapt this block to the repository and language:

```text
## Code and architecture

- Use cohesive functions and files; treat size and indentation limits as review signals.
- Keep domain, application, and infrastructure separate; I/O stays at the edges.
- Create wrappers for I/O, volatile SDKs, expensive integrations, or useful fakes; import stable, pure libraries directly.
- Update or remove stale comments. Document cohesion exceptions or relevant architecture decisions.

## Errors, async, and observability

- Use stable error codes and safe context. Never log raw values, secrets, tokens, PII, cards, or complete payloads.
- Propagate cancellation and configure timeouts. Retry only transient failures, with limited attempts, backoff, jitter, and idempotency before repeating external effects.
- Limit concurrency to protect dependencies and clean up resources on success, failure, and cancellation.
- Emit structured events with event, level, request_id, duration, result, and redacted fields.
- Use logs for safe diagnosis, metrics for aggregates, and traces to cross boundaries. Define retention and access.

## Debugging and tests

- Investigate through hypothesis and evidence in a controlled non-production environment; apply redaction and confirm removal of temporary instrumentation.
- Test rules, contracts, timeout, cancellation, cleanup, and race conditions according to risk.
```

## Definition of Done

- [ ] Functions, files, and abstractions were reviewed for cohesion, readability, and domain vocabulary; relevant exceptions are documented.
- [ ] Domain, application, and infrastructure have explicit boundaries; I/O is at the edges and integration contracts were tested.
- [ ] Errors expose a stable code and safe context; messages, logs, and traces contain no raw values, secrets, tokens, PII, cards, or complete payloads.
- [ ] External calls have a timeout, propagate cancellation, clean up resources, and use limited backoff/jitter retries only when idempotency permits.
- [ ] Concurrency limits and duplication risks were defined and tested, including relevant timeout, cancellation, and race conditions.
- [ ] Structured events include `event`, `level`, `request_id`, duration, result, and redacted fields; logs, metrics, traces, access, and retention have a defined purpose.
- [ ] Temporary investigation occurred only in a controlled environment, produced redacted evidence, and had its instrumentation removed or intentionally promoted.

## Summary

Clean code for agents reveals intent, bounds effects, and produces safe evidence. Size metrics help start a review conversation, but cohesion and clarity decide; observability, cancellation, and boundaries make the system verifiable in operation.

---

Influence source: [Clean Code for AI Agents, Fabio Akita](https://akitaonrails.com/en/2026/04/20/clean-code-for-ai-agents/).

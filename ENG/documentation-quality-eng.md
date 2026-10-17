---
name: documentation-quality-eng
language: en
description: "Quality standards for accurate, task-oriented, maintainable, accessible, and verifiable technical documentation."
version: "2026.09"
last-reviewed: "2026-10-17"
guide-id: documentation
---

# Documentation Quality for AI Agents

> **Related documents**: use [`clean-code-eng.md`](./clean-code-eng.md) when software behavior or code structure changes; [`test-code-eng.md`](./test-code-eng.md) for executable examples and verification strategy; [`sec-code-eng.md`](./sec-code-eng.md) for secrets, authentication, authorization, privacy, and sensitive examples; [`accessibility-eng.md`](./accessibility-eng.md) when a published documentation surface has additional accessibility requirements. This guide owns documentation architecture, factual quality, freshness, maintainability, and reader usability.
>
> **Tooling policy**: identify the documentation surface, canonical sources, and existing project checks first. Prefer already available project-native tools. Installation or environment changes require authority; reuse scoped authorization already given rather than asking again. If a required check cannot be executed, record it as blocked or `NOT_VERIFIED`; never claim it passed.

## Context

Technical documentation is part of the product contract. A document can compile, render, and contain no broken links while still being wrong, incomplete, difficult to use, or stale. Treat documentation changes with the same evidence discipline as executable changes: identify the reader, identify the authoritative source, make the smallest coherent change, and verify what can be observed.

## Documentation quality model

Review documentation across independent dimensions:

- **Accuracy** — facts match the implementation, public contract, schema, registry, configuration, or other authoritative source.
- **Completeness** — the intended reader has enough information to complete the intended task.
- **Consistency** — terminology, values, commands, and behavior do not contradict other authoritative documentation.
- **Precision** — statements are specific enough to act on and verify.
- **Usefulness** — the content serves a real reader need rather than filling a template.
- **Freshness** — current supported behavior is documented and obsolete claims are removed or versioned.
- **Findability** — readers can reach the content through predictable navigation and descriptive headings/links.
- **Accessibility** — structure and meaning remain usable with assistive technology and without visual-only cues.
- **Verifiability** — executable or machine-defined claims are checked against authoritative sources where feasible.
- **Flow** — prerequisites, actions, results, and recovery guidance follow the reader's task without unrelated detours.

Functional correctness is required before polish. A beautiful document that is inaccurate is not high-quality documentation.

## Identify the reader and job

Before writing, answer:

- Who is the intended reader?
- What are they trying to accomplish or understand?
- What can they reasonably be expected to know?
- What prerequisites must exist?
- What is the expected result?
- Which project source owns each factual claim?
- Which checks can verify the result?

Do not write from memory when the repository contains a more authoritative source.

## Documentation modes

Use the Diátaxis model as a practical mental model. Do not create empty structures merely to satisfy it.

### Tutorial

Use a tutorial for learning. Provide a controlled, safe path that produces a working result and helps the reader acquire familiarity. Keep optional branches and exhaustive reference material out of the main learning flow.

### How-to guide

Use a how-to guide for a real task. State the goal and prerequisites, provide ordered actions, show the expected result, and include verification or recovery where useful. Link to explanation rather than interrupting the procedure with long conceptual digressions.

### Reference

Use reference for authoritative technical facts: APIs, CLI commands, configuration, schemas, environment variables, statuses, and error codes. Prioritize accuracy, completeness, precision, neutrality, and predictable structure. Where possible, structure reference documentation to reflect the structure of the system it describes.

### Explanation

Use explanation for understanding: architecture, concepts, trade-offs, context, and why the system behaves as it does. Keep required operational steps in how-to material.

## README quality

A repository README should normally make it possible to answer:

1. What is this project?
2. Why would I use it?
3. What are the prerequisites?
4. How do I get a minimal working result?
5. Where is deeper documentation?
6. How do I get help or contribute when relevant?
7. What license or support policy applies?

Keep the README as an entry point. Move deep tutorials, reference, architecture, and troubleshooting to dedicated documents when they grow.

## Canonical sources and docs-as-code

Prefer one authoritative source for machine-defined facts.

Examples:

```text
package scripts       -> documented development commands
CLI registry          -> CLI reference
OpenAPI description   -> HTTP API reference
JSON Schema/types     -> configuration/reference fields
error registry        -> error-code reference
runtime config        -> environment-variable reference
protocol constants    -> lifecycle/status reference
```

Generate or validate projections when practical. Do not manually copy the same factual table into multiple documents.

## Generated and handwritten documentation

Generated content must have an explicit owner and deterministic generation path. Edit the canonical source or generator, not the generated projection.

Keep handwritten content for reader context, explanation, examples, and guidance that cannot be mechanically derived.

If generated regions use markers, validation must fail closed on missing, duplicate, nested, malformed, or unknown regions rather than silently rewriting arbitrary content.

## Documentation impact analysis

For each task, assess whether it changes:

- public behavior;
- API or CLI syntax;
- installation or prerequisites;
- configuration or environment variables;
- architecture or trust boundaries;
- authentication or authorization;
- errors or observable states;
- deployment or operation;
- version compatibility;
- deprecations or migration steps;
- examples or workflows.

Update affected documentation in the same task when the change is required for correct use.

## Freshness and timeless wording

When reviewing engineering guides, compare the full catalog with its registry,
activation implementation, and metadata. Separate implemented capability from
proposed integration, sample check names from required evidence identifiers,
and contextual defaults from protocol or user-approval gates. A named tool
does not become mandatory merely because an example uses it. Record the
review's scope and unavailable consumer/platform checks; a fresh review date
does not certify every referenced API or framework.

Avoid time-sensitive words such as `new`, `currently`, `latest`, `now`, or `soon` in evergreen technical documentation when they will age without adding information.

Use explicit versions or dates when history or compatibility requires them.

Release notes, migration histories, and announcements may intentionally use time-based language.

## Writing style and terminology

- Use direct, concise language.
- Prefer active voice.
- Use second person where it clarifies reader actions.
- Prefer specific nouns and verbs over vague references.
- Use one canonical term per concept.
- Define acronyms when the intended audience may not know them.
- Use sentence-case headings unless project style requires otherwise.
- Avoid idioms, culture-specific jokes, unnecessary metaphors, and ambiguous language in globally consumed documentation.
- Use normative `MUST`, `SHOULD`, and `MAY` only when the document is truly specifying requirement levels.

## Procedures

A procedure should normally include:

```text
goal
prerequisites
ordered actions
expected result
verification
recovery/troubleshooting
```

Use numbered steps when order matters and imperative verbs for required actions.

Do not hide a prerequisite after the step that depends on it.

## Commands and code samples

Runnable commands and copyable code must be safe and credible.

- Validate examples when feasible.
- Never invent successful command output.
- Label illustrative output explicitly.
- Use clear placeholders.
- Never include real secrets, tokens, private keys, PII, or production credentials.
- Explain destructive effects before the command.
- Follow the project's language and formatting conventions.
- Prefer real text over screenshots of terminal output or code.

## API documentation

For HTTP APIs, use a machine-readable description such as OpenAPI when the project already supports or benefits from it.

Document relevant:

- authentication and authorization;
- operations and paths;
- parameters;
- request and response bodies;
- status codes and errors;
- pagination;
- rate limits;
- idempotency;
- webhooks;
- versioning;
- deprecation;
- examples.

Do not require OpenAPI for projects without an HTTP API.

## CLI documentation

CLI reference should describe relevant:

- usage;
- commands;
- arguments;
- options;
- aliases;
- defaults;
- repeatable options;
- exit/error behavior;
- examples;
- shell-sensitive behavior;
- configuration precedence.

Derive or validate these facts from the CLI registry/parser when possible.

## Configuration and environment documentation

Document each public configuration item with relevant:

```text
name
purpose
type
required/optional
default
allowed values
safe example
secret classification
scope
precedence
reload/restart behavior
```

Keep `.env.example`, runtime configuration, and documentation consistent.

## Architecture documentation

Document the architecture at the smallest useful level.

Cover relevant:

- system context;
- major runtime boundaries;
- dependencies;
- data flow;
- trust boundaries;
- storage;
- external systems;
- deployment topology;
- important architectural decisions.

Use diagrams only when they improve understanding. A context/container view is enough for many systems; do not generate every possible diagram level.

For significant decisions, use an ADR or equivalent record containing context, decision, alternatives when useful, consequences, and status.

## Troubleshooting and runbooks

Write troubleshooting around observable symptoms or stable error codes.

Prefer:

```text
symptom
likely cause
how to verify
correction
next diagnostic/escalation step
```

Operational runbooks should identify trigger, access prerequisites, safety checks, steps, verification, rollback, and escalation.

## Accessibility

- Use one clear title.
- Maintain meaningful heading hierarchy.
- Use descriptive link text instead of `click here`.
- Provide text alternatives for informative images.
- Do not put unique information only in screenshots or diagrams.
- Do not use color, location, shape, or direction as the only semantic cue.
- Use tables for tabular data, not layout.
- Keep long content scannable.
- Prefer real text for code and terminal output.

## Security and sensitive information

Documentation must not expose:

```text
tokens
passwords
private keys
real credentials
session identifiers
personal data
production connection strings
internal secrets
```

Use explicitly fake examples. Authentication and authorization documentation must match actual server-side behavior and permissions.

## Versioning, deprecation, and migration

If the project has a versioned public API, keep its documentation precise and comprehensive enough to understand compatibility.

Document breaking changes and deprecations. When users need action to upgrade, provide a migration guide with affected versions, prerequisites, steps, verification, rollback/recovery, and known incompatibilities.

Do not promise removal dates or future behavior unless the project has committed to them.

## Validation and evidence

Use the project's own tools first.

Possible checks include:

- Markdown lint/validation;
- internal link and anchor validation;
- external link checks with an explicit network-failure policy;
- documentation build;
- code example execution or compilation;
- OpenAPI/schema validation;
- CLI/reference parity;
- configuration/reference parity;
- generated-document freshness;
- diagram source/artifact parity;
- README quick-start execution.

Do not install optional tooling solely to satisfy this list.

If a required check is unavailable, record it as blocked or `NOT_VERIFIED`. Never report an unexecuted check as passed.

## Anti-patterns

Avoid:

- README as a dumping ground;
- tutorials mixed with exhaustive reference;
- procedures interrupted by unrelated explanation;
- factual tables manually duplicated across files;
- untested commands presented as guaranteed;
- invented output;
- screenshots of code or terminal text;
- stale time-sensitive wording;
- dead-end documents with no navigation;
- manual edits to generated documentation;
- undocumented breaking changes;
- known required documentation deferred indefinitely after behavior changes.

## Agent workflow

For documentation work:

1. Discover relevant documentation and project truth sources.
2. Classify the reader need: tutorial, how-to, reference, or explanation.
3. Identify the authoritative source for factual claims.
4. Map documentation impact.
5. Make the smallest coherent update.
6. Run relevant project-native documentation checks.
7. Inspect the diff from the intended reader's perspective.
8. Cross-check facts against implementation or canonical machine sources.
9. Record observed verification evidence through the project/ForgeLoop verification flow.
10. Do not claim completion beyond the evidence.

## Documentation Definition of Done

Before completion verify:

- [ ] Intended reader and purpose are clear.
- [ ] Factual claims match authoritative project sources.
- [ ] The documentation mode fits the reader need.
- [ ] Required information is complete for the intended task.
- [ ] Terminology is consistent.
- [ ] Procedures are ordered and actionable.
- [ ] Examples and commands are safe and validated when feasible.
- [ ] Internal navigation and links are coherent.
- [ ] Accessibility basics are satisfied.
- [ ] No real secrets or sensitive data appear.
- [ ] Generated/reference material is fresh.
- [ ] Version/deprecation/migration impact is documented when applicable.
- [ ] Relevant project-native checks have observed evidence.
- [ ] Unavailable required checks are explicitly `NOT_VERIFIED` or blocked.
- [ ] The completion claim does not exceed the evidence.

## Sources and further reading

This guide is an original operational synthesis informed by:

- Diátaxis — https://diataxis.fr/
- Diátaxis quality — https://diataxis.fr/quality/
- Google Developer Documentation Style Guide — https://developers.google.com/style
- Google accessible documentation guidance — https://developers.google.com/style/accessibility
- Google code sample guidance — https://developers.google.com/style/code-samples
- Google timeless documentation guidance — https://developers.google.com/style/timeless-documentation
- GitHub repository documentation guidance — https://docs.github.com/en/repositories/creating-and-managing-repositories/best-practices-for-repositories
- W3C WAI writing guidance — https://www.w3.org/WAI/tips/writing/
- OpenAPI Specification — https://spec.openapis.org/oas/
- Semantic Versioning — https://semver.org/
- C4 model — https://c4model.com/
- RFC 2119 — https://www.rfc-editor.org/rfc/rfc2119.html

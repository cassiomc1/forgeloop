# ForgeLoop Agent Skill

## Status

ForgeLoop ships a generated, portable Agent Skill at
[`skills/forgeloop/SKILL.md`](../skills/forgeloop/SKILL.md). It is operational
guidance, not protocol authority, and it does not certify any particular agent
harness.

## Purpose and Architecture

The projection direction is strictly:

```text
runtime protocol registries and validators
        -> canonical protocol documentation
        -> docs/AGENT_PROTOCOL_SUMMARY.md
        -> scripts/generate-forgeloop-skill.mjs
        -> skills/forgeloop/
```

The Skill never becomes lifecycle, completion, evidence, claim, scheduler,
provider, or installation authority.

## Generation and Freshness

Generation is deterministic, offline, and has no external Agent Skills
dependency:

```bash
npm run summary:generate
npm run skill:generate
npm run summary:check
npm run skill:check
```

The writer is bounded to the five known files under `skills/forgeloop/` and
does not delete unknown files. Documentation checks run Skill freshness after
Agent Protocol Summary freshness.

## Compatibility

The Skill follows the portable `skills/forgeloop/SKILL.md` convention with only
`name` and `description` frontmatter. This is format compatibility, not
behavioral certification for every external harness. Existing native
`AGENTS.md`, `CLAUDE.md`, Cursor, and Copilot integration surfaces remain
intact.

## Safety Boundaries

Agents must discover tasks first, follow `next`, respect claims, require
preflight `READY`, preserve command provenance, distinguish `run-check` from
`record-check`, use supported recovery, require `complete -> VALID`, and query
`next` again for a terminal result. Tokens, credentials, private keys, and
authorization headers must never be persisted in ForgeLoop artifacts.

External Agent Skills tooling is not a ForgeLoop dependency and is not used in
CI. ForgeLoop adds no runtime Skill installation or synchronization command.

## Packaging

The generated Skill, this document, and the bounded generator ship in the npm
package as instruction/documentation content. They add no runtime dependency.
Harness-specific installed copies and caches are not shipped.

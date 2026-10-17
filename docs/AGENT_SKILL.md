# ForgeLoop Agent Skill

## Status

ForgeLoop ships a generated, portable Agent Skill at
[`skills/forgeloop/SKILL.md`](../skills/forgeloop/SKILL.md). It is operational
guidance, not protocol authority, and it does not certify any particular agent
harness.

## Purpose and Architecture

The documented precedence direction is:

```text
runtime protocol registries and validators
        -> canonical protocol documentation
        -> docs/AGENT_PROTOCOL_SUMMARY.md
        -> generated Skill
```

The Skill generator itself reads the generated summary and runtime protocol
metadata. It does not parse the canonical Markdown protocol documents.

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

## ForgeLoopAudit workspace guidance

The generated Skill documents the Audit component at `ForgeLoopAudit/` inside
the ForgeLoop repository, replacing the standalone repository and
`../ForgeLoopAudit`. It directs agents to
resolve the target project root before running commands: core ForgeLoop uses
the parent root; Audit uses its own directory, instructions, package scripts,
and configured protocol runtime. ForgeLoop is the source and contribution home
for both components; their package commands, task state, and receipt provenance
remain scoped to the target root. Audit remains a read-only auditor.

Maintain this guidance in `scripts/generate-forgeloop-skill.mjs`, then run
`npm run skill:generate` and `npm run skill:check`. An independently installed
Skill must be updated separately; generation only writes the repository copy.

## Safety Boundaries

Agents must discover tasks first, follow `next`, respect claims, require
preflight `READY`, preserve command provenance, distinguish `run-check` from
`record-check`, use supported recovery, require `complete -> VALID`, and query
`next` again for a terminal result. Tokens, credentials, private keys, and
authorization headers must never be persisted in ForgeLoop artifacts.

External Agent Skills tooling is not a ForgeLoop dependency and is not used in
CI. ForgeLoop adds no runtime Skill installation or synchronization command.

## Packaging

The optional [Cloudflare security audit companion](./SECURITY_AUDIT_SKILL.md)
ships separately at `skills/security-audit/`. The generated ForgeLoop Skill
points to it for requested security work without starting a full audit or
requiring installation. Its upstream files, license, and hash manifest remain
separate from the generated ForgeLoop Skill. Host discovery copies are opt-in
and are not synchronized by the generator or by `init`/`update`.

The generated Skill, this document, and the bounded generator ship in the npm
package as instruction/documentation content. They add no runtime dependency.
Harness-specific installed copies and caches are not shipped.

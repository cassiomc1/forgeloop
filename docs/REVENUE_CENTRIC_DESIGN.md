# Revenue-centric design companion

ForgeLoop includes an optional [revenue-centric design companion](../skills/forgeloop/references/revenue-centric-design/SKILL.md)
for product journeys, activation, pricing clarity and retention. It adapts
[heliocosta-dev/revenue-centric-design at the reviewed commit](https://github.com/heliocosta-dev/revenue-centric-design/tree/1942760c2242f609bf63ce2c97204f5a1791bd68),
a curation of Richard ([@richardrx](https://x.com/richardrx)).

## Availability and scope

The source and npm package include the focused skill, an offline journey
playbook, full upstream license and pin manifest under
`skills/forgeloop/references/revenue-centric-design/`. The original twelve
theme references are linked at an immutable upstream commit; media, updater
scripts, scraping dependencies and API configuration are excluded.

Ask an agent to read the companion at that package or source path for relevant
product work. It is not activated for ordinary protocol or storage maintenance.
Hosts requiring skill discovery can copy that complete directory into their
project skill directory after inspecting any existing destination. Preserve
its license, attribution and pin. `init`, `update` and the skill generator do
not install or synchronize this discovery copy.

```bash
node scripts/verify-revenue-design-skill.mjs
# From a consumer project with a local ForgeLoop installation:
node node_modules/@cassiomc1/forgeloop/scripts/verify-revenue-design-skill.mjs
```

The checker verifies the explicit file set and SHA-256 hashes with CRLF
normalized to LF for portable text checkouts. The pin detects drift against a
reviewed manifest; it is not a signature, sandbox or evidence of business impact.
For a copied directory, call the exported `verifyRevenueDesignSkill` function
with its absolute `rootDir`.

## Use with ForgeLoop

Inspect the actual user journey, identify observed friction and propose a
small reversible change. Pair a user-value metric with a guardrail such as
successful cancellation, accessibility, error recovery or price comprehension.
Treat principles, anecdotes and claimed statistics as hypotheses requiring
context and original-source verification. Browser checks establish behavior;
conversion and retention claims require appropriate real measurement.

For ForgeLoopAudit, relevant work concerns read-only project selection, a first
successful inspection, understandable evidence, useful errors and navigation.
This addition does not add commercial flows, tracking or paid experiments to
the auditor. Audit remains read-only and keeps its own verification commands.

The canonical contract, guide router, runtime, gates and validators retain
all authority. This companion adds no guide ID, runtime dependency, provider,
automatic gate or completion requirement. Its advice cannot establish
`COMPLETE` or `VALID`. Preserve informed choice: honest proof and pricing,
visible renewal terms, reversible defaults and usable cancellation/opt-out.

## Attribution and usage terms

The [complete upstream license](../skills/forgeloop/references/revenue-centric-design/LICENSE)
is retained unchanged. It requires attribution to Richard and the source,
preservation of its full terms in copies/derivatives, and excludes gambling,
betting, casino and real-money games-of-chance uses, including loot boxes.
These are source-available custom terms, not an OSI-approved open-source
license or ForgeLoop's PolyForm license. Copy the license with any adaptation.

The adaptation replaces the broad upstream entrypoint with a focused workflow
and local journey matrix. It links source themes progressively, keeps external
research unverified until checked, and preserves ForgeLoop authority and user
choice. To update it, review the upstream commit and terms, update the
adaptation and pin together, then verify integrity, documentation and package
contents. Do not run the upstream updater as part of a ForgeLoop release.

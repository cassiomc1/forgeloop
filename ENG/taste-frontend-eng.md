---
name: taste-frontend-eng
language: en
description: "Contextual visual-taste review for premium frontend and brand-heavy work."
version: "2026.09"
last-reviewed: "2026-10-16"
guide-id: taste
---

# Taste Skill for ForgeLoop Frontend Work

This is a contextual review guide for premium marketing sites, landing pages,
portfolios, brand surfaces, and high-finish redesigns. It is selected by the
ForgeLoop router only when the work has that visual context. It is advisory: it
does not create an approval gate, block an autonomous task, or require a
specific framework, font, layout, animation library, or visual tool.

The upstream inspiration is Taste Skill's design-read and anti-default
approach. ForgeLoop keeps the useful review vocabulary while applying its own
protocol boundaries: user evidence, accessibility, performance, security, and
the active product constraints have priority over aesthetic preference.

## Upstream Baseline and Intentional Differences

Reviewed baseline: [Taste Skill v2.0.0](https://github.com/Leonxlnx/taste-skill/tree/v2.0.0/skills/taste-skill),
released 2026-10-13 and reviewed for this adaptation on 2026-10-16. See the
[versioned instructions](https://github.com/Leonxlnx/taste-skill/blob/v2.0.0/skills/taste-skill/SKILL.md)
and [changelog](https://github.com/Leonxlnx/taste-skill/blob/v2.0.0/CHANGELOG.md).
This identifies the upstream reference, not full feature parity or automatic
synchronization. The guide's frontmatter version follows ForgeLoop's guide
versioning separately.

ForgeLoop adapts the content inventory, subject-specific concept, and screenshot
correction practices. It deliberately keeps direction selection contextual
rather than requiring a scripted draw. It does not adopt universal bans on
colors, gradients, borders, fonts, or headline line counts, or minimum image
and animated-element counts. Existing brand constraints, language expansion,
content needs, reduced motion, accessibility, and performance determine those
choices. An aesthetic preference never becomes lifecycle or completion
authority.

## Design Read

Before editing, describe the existing or proposed system in observable terms:

- What is the product promise, audience, and primary action?
- Which visual idea creates recognition, and which elements are merely
  decoration?
- What are the current typography roles, color roles, spacing rhythm, grid,
  image treatment, component shapes, and motion cues?
- Where does the hierarchy break at the first viewport, on a narrow viewport,
  or in a dense interaction state?

Separate observed evidence from inference. If the implementation is not yet
available, record the read as a hypothesis and keep it reversible.

## Client Content Inventory

Collect a small, source-backed inventory before choosing a visual direction:

- the client's actual product, audience, vocabulary, location, materials, and
  distinguishing constraints, where relevant and supported;
- available product views, photographs, illustrations, documents, and brand
  assets, with their source and permitted use;
- the content each requested section must deliver and the evidence supporting
  its claims;
- missing content, representative examples, and facts requiring confirmation.

Reuse the inventory from the premium website brief when it exists. Do not
invent a differentiator, price, metric, testimonial, customer, or asset to make
the direction work. Label representative content and keep unsupported proof
out of release claims. For each section, connect the visitor's question, the
proposed claim, and its supporting source before committing to a layout.

## Visual Concept

Write one sentence connecting an evidenced client detail to a concrete visual
decision and the visitor's goal. For example, an existing product workflow can
organize the page's composition and sequence. Explain how that decision
extends beyond the hero into supporting sections and narrow layouts.

Check whether the sentence would fit a nearby competitor unchanged. If it
would, refine it using the inventory rather than inventing a distinction.
Keep an established brand or design system when appropriate. Add a distinctive
interaction only when it serves the authorized scope and has an accessible
fallback; a new interaction is not required merely to make the page unusual.
Record reversible choices in the existing design artifact or contract
assumptions, following the normal decision policy.

## Design Dials

Use three lightweight dials to make an intentional decision rather than a
generic default:

- **Design variance:** familiar, distinctive, or experimental relative to the
  product category.
- **Motion intensity:** static, restrained, or expressive, limited by user
  preference and runtime budget.
- **Visual density:** quiet, balanced, or information-rich, tuned to the task
  and reading conditions.

Record the chosen direction in the design gate or contract assumptions when it
materially changes implementation. Do not randomize values to manufacture
novelty; deliberate variation should have a product or communication reason.

## Anti-Slop Checks

Review the whole page, not only the hero:

- The first viewport states what the product is, for whom, and what to do.
- Repeated sections have a reason and do not reuse one composition by habit.
- The strongest contrast, scale, and whitespace support the intended hierarchy.
- Decorative effects do not compete with content, controls, or error states.
- Images, icons, testimonials, logos, metrics, and claims are real or clearly
  marked as representative; never fabricate proof.
- Framework, component, and template defaults are changed only when the
  resulting system is more coherent and the change is justified.
- Empty, loading, error, focus, hover, pressed, disabled, consent, and form
  states belong to the same visual system.

## Typography Quality

Choose typography by role and reading need. Limit the number of families and
weights to what the product needs, keep running text at a comfortable measure,
and establish a clear display/body/metadata hierarchy. Verify the exact font
source, license, loading cost, fallback, and language coverage before adding an
external font. A distinctive type choice is optional; legibility and product
evidence are not.

## Layout Composition

Build hierarchy from relationships: container, grid, alignment, rhythm,
contrast, grouping, and breathing room. Vary section composition when that
clarifies a narrative, but preserve predictable navigation and interaction.
Use the smallest set of tokens that explains the system. Treat a deliberate
asymmetry, quiet section, oversized statement, or dense data region as a
decision to validate, not a rule to apply everywhere.

## Motion Restraint

Motion should explain change, guide attention, or provide feedback. Prefer
short, interruptible, seek-safe transitions and respect
`prefers-reduced-motion`, reduced-transparency preferences, focus, and input
latency. A static implementation is valid when it communicates better or
meets the performance budget. GSAP, scroll effects, canvas, WebGL, and shader
effects are optional implementation choices, never universal requirements.

## Responsive Composition

Design narrow and wide compositions as related states, not as a desktop page
scaled down. Re-check hierarchy, line length, touch targets, safe areas,
navigation, image crops, overflow, and the primary action at the smallest
supported viewport. Test intermediate widths when layout changes are likely;
do not invent a breakpoint merely to match a visual convention.

## Design-System Selection

Use the existing product system when one is present. If the target has no
system, choose a small coherent set of semantic tokens, components, states,
and usage rules that the team can maintain. A vendor guide, gallery, template,
or AI output can inform a direction, but it is not evidence of product fit,
license, accessibility, or performance. For external component, AI-interface,
or motion references — including React Bits, AIcss, beUI, and Transition Kit
when contextually applicable — follow the canonical adoption rules in
[`design-code-eng.md`](./design-code-eng.md) rather than treating a gallery
component as a project design-system default. Keep any external reference in
the task's source and attribution records; do not add a network dependency to
ForgeLoop runtime.

## Visual Pre-Flight

Before calling a visual task ready, check the smallest useful evidence set:

- hierarchy and primary action at wide and narrow viewports;
- keyboard focus, contrast, zoom, reduced motion, and semantic controls;
- loading/error/empty/form states that are in scope;
- image and font loading, console/runtime errors, and performance budget;
- consistency of tokens, spacing, type roles, component states, and content
  claims.

If visual evidence is unavailable, record `NOT_VERIFIED` or a bounded
limitation. Never turn an imagined screenshot or an unrun browser check into
an observed result.

## Screenshot Review

Use an already available, authorized browser to capture and inspect the real
page. A useful starting set is 1440, 768, and 390 CSS pixels wide; adapt it to
the supported device matrix and include required reflow, zoom, and interaction
checks. These widths do not replace accessibility requirements.

1. Record the tested URL or build, browser, viewport dimensions, relevant
   state, and screenshot references in the task's evidence.
2. Inspect each capture for hierarchy, content completeness, concept continuity,
   typography, contrast, crops, overflow, and obscured or missing content.
   Check interactive behavior separately; a screenshot alone cannot establish
   keyboard access, form behavior, or runtime performance.
3. Identify up to three actionable problems with their location, visible
   evidence, and user impact. Prioritize required acceptance criteria over
   stylistic preferences.
4. Correct the scoped issues through the existing ForgeLoop diagnosis and
   correction loop when verification fails. Re-run affected checks, capture
   the changed states, and inspect them again.

Use at most three review rounds by default, within the task contract's limits.
Stop earlier when the applicable criteria are satisfied. The round limit does
not waive a failure: report unresolved issues and their verification status,
then follow the canonical next action or blocker. Do not fabricate aesthetic
scores or claim browser, inspector, or screenshot evidence that was not
actually obtained. This procedure adds no separate approval gate.

## Optional Upstream Tools

The upstream v2 scripts, direction library, and reference collection are not
bundled with this guide or required by ForgeLoop runtime:

| Upstream tool | Optional purpose |
| --- | --- |
| `scripts/draw.mjs` | Propose directions and composition blueprints |
| `scripts/lint.mjs` | Review source against upstream style patterns |
| `scripts/inspect.mjs` | Measure a page in a browser and capture screenshots |
| `scripts/assets.mjs` | Find external media and record source and credit information |

Use a separately available, reviewed copy only when appropriate and authorized;
do not install, fetch, or execute it automatically. The reviewed inspector
requires Node 22+ and an installed Chrome, Edge, or Chromium; the other scripts
require Node 18+, and media discovery requires network access. Check the
selected copy's requirements and output paths before use. Upstream tools may
write project artifacts and user-level history outside ForgeLoop's evidence
store; those files do not become attested evidence merely by existing.

Prefer an available equivalent when it supports the same task checks. Treat
upstream style findings as contextual recommendations, not new ForgeLoop gates.
For external media, confirm the exact asset's license, attribution, and
relevance; search results alone do not establish reuse rights. Identify found
or generated imagery honestly rather than presenting it as the client's own.
Record the tool version and checks actually run, and mark unavailable required
evidence `NOT_VERIFIED` without claiming upstream tool coverage.

## Redesign Audit

For an existing interface, scan first and classify each issue as hierarchy,
typography, color/contrast, composition, content, interaction, responsive
behavior, accessibility, performance, or evidence. Fix the highest-leverage
issues in small coherent batches. Re-read the whole system after each batch so
local polish does not create a new inconsistency elsewhere.

The final decision remains protocol-owned: this guide can recommend a visual
change, but the contract, routing, gates, evidence, completion rules, and
user-authorized constraints decide whether the task may proceed or close.

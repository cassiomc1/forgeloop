---
name: premium-sites-studio-eng
language: en
description: "Complete process for building premium websites at major design-studio quality."
version: "2026.09"
last-reviewed: "2026-10-17"
guide-id: premium
requires-gates:
  - design
  - quality
completion-evidence:
  - responsive-validation
  - accessibility-validation
  - build
  - visual-validation
---

# Premium Websites at Studio Level — Complete Process

> This guide defines the production process. For detailed visual rules, also use [`design-code-eng.md`](./design-code-eng.md). For accessibility, code quality, testing, security, and performance, consult the related documents at the end. A high-end website is not only a beautiful interface: it is a coherent, useful, fast, accessible, measurable, and maintainable experience.
>
> **Tooling policy**: identify the stack, the stage, and the applicable checks; prefer an already available equivalent that produces compatible evidence. Installation or environment changes require authority; reuse scoped authorization already given rather than asking again. If no safe equivalent exists, record the required check as blocked and never claim that it passed. Do not install merely optional resources.

## 1. Quality bar

A website is ready only when it meets all of these criteria at the same time:

- **Clarity:** within seconds, people understand what it is, who it is for, and what action they can take.
- **Intent:** every section, image, animation, and word has a business or experience purpose.
- **Coherence:** brand, content, interface, motion, responsiveness, and behavior form one system.
- **Distinctiveness:** the solution has its own visual and narrative idea; it is not a recolored template.
- **Inclusion:** keyboard, screen reader, zoom, contrast, reduced motion, and different devices are considered from the start.
- **Performance:** the experience is fast on the audience's real devices and networks, not only on the developer's computer.
- **Reliability:** loading, error, empty, consent, form, and integration states behave predictably.
- **Operations:** someone can update content, measure results, fix problems, and evolve the site after launch.

## 2. How to use this guide

Follow the gates in order. Within each gate, use the canonical [Loop Engineering](../LOOP_ENGINEERING.md) cycle; do not start costly implementation before the previous gate has a verifiable output or recorded uncertainty.

1. **Brief and strategy:** objective, audience, positioning, offer, constraints, and metrics.
2. **Content and architecture:** content inventory, sitemap, navigation, journeys, and data model.
3. **Creative direction:** concept, references, tone, imagery, typography, color, composition, and motion.
4. **Design system:** tokens, components, states, breakpoints, usage rules, and recorded decisions.
5. **Prototype and validation:** test hierarchy, comprehension, navigation, and conversion before full implementation.
6. **Implementation:** build with semantic HTML, predictable components, real or representative data, and progressive enhancement.
7. **Quality:** run accessibility, performance, security, SEO, compatibility, functional testing, and visual regression.
8. **Launch and operations:** deploy with observability, rollback plan, analytics, documentation, and an accountable owner.

Each gate must have a verifiable output. If a decision remains ambiguous, record the hypothesis, risk, owner, and next test; do not hide uncertainty behind aesthetics.

These production stages do not create extra ForgeLoop lifecycle gates or
mandatory user approvals. In autonomous work, resolve reversible brief,
layout, and direction choices as recorded assumptions and continue. Ask only
for a genuine blocking decision under Loop Engineering. Client approval and
publication authority remain required when the actual engagement or requested
external action requires them; a generic checklist cannot invent that boundary.

## 3. Gate 1 — Brief, strategy, and success

Before choosing colors or components, produce a short brief:

```md
# Website brief

## Context
- Brand/product:
- Business problem:
- Why this website exists now:

## Audience
- Primary audience:
- Secondary audiences:
- Prior knowledge:
- Needs and objections:

## Desired outcome
- Primary action:
- Secondary actions:
- Primary metric:
- Quality metrics:

## Constraints
- Available content:
- Technology/CMS:
- Languages and regions:
- Timeline and team:
- Legal, accessibility, and security requirements:

## Non-goals
- What the website does not need to solve:
```

Rules:

- Do not invent positioning, testimonials, numbers, clients, awards, or claims to fill the page.
- Distinguish **objective**, **hypothesis**, and **metric**. “Look premium” is not a sufficient metric.
- Define one primary action per page. If everything is a priority, nothing is.
- Identify what must be approved by the client, user, or legal team before writing the interface.
- Define audience, device, network speed, language, location, and technology as context — not as end-stage details.

### Landing-page specialization

For a true landing page, narrow the brief further:

- identify one offer;
- identify the primary audience;
- identify one primary conversion action;
- define what counts as conversion;
- determine what visitors already know when they arrive;
- identify the most important objections;
- inventory available proof such as product screenshots, documented metrics, case studies, certifications, or real testimonials.

Apply normal ForgeLoop decision classification to missing information. Discover and infer first. A safe, local, reversible design choice is `NON_BLOCKING`: record the assumption and continue. Ask only when a missing fact is genuinely `BLOCKING`, such as real pricing, a regulated claim, a real customer endorsement, a legal guarantee, or external authority.

Choose page structure based on visitor knowledge and conversion friction rather than visual fashion. Useful structural modes include product-led classic, narrative/educational, minimal high-intent, and comparison/alternative-intent.

A common conversion narrative is:

```text
Hero → problem/context → benefits → how it works → proof → objection handling → final primary CTA
```

Adapt or remove stages according to the product. This is a decision framework, not a mandatory template.

Lead copy with supported outcomes, then explain features or mechanisms. Keep proof close to the claim it supports. Never invent metrics, testimonials, customer logos, guarantees, certifications, or regulated statements.

For long landing pages, implement one coherent section at a time when practical and verify it before multiplying the pattern across the page.

## 4. Gate 2 — Content, architecture, and journeys

### Content inventory

Before final layouts, organize a table with:

| Page/section | Purpose | Real content | Source/owner | Status | CTA | Media requirement |
| --- | --- | --- | --- | --- | --- | --- |
| Home/hero | Explain proposition | Headline, support, proof | Marketing | approved | Explore product | video/image |

Valid statuses: `draft`, `in review`, `approved`, `blocked`, `outdated`. Placeholder content cannot be treated as ready for visual or conversion QA.

### Information architecture

- Create sitemap, primary navigation, secondary navigation, footer, and return paths.
- Organize around user intent, not the company's internal structure.
- Give every page a title, promise, primary action, and success state.
- Avoid navigation that depends only on hover, gestures, horizontal scrolling, or animation.
- Plan readable URLs, titles, descriptions, headings, breadcrumbs, and social sharing from the architecture stage.
- For CMS sites, model content as reusable data; do not repeat the same copy in multiple components.
- For multilingual sites, treat translation, text expansion, locale, currency, date, SEO, and fallbacks as first-class requirements.

### Critical journeys

Map at least:

- first visit → understanding → exploration → primary action;
- search/navigation → detail page → conversion;
- form → validation → submission → confirmation → error recovery;
- slow mobile device → priority content → essential interaction;
- returning user → update, support, or next action.

## 5. Gate 3 — Creative direction

Produce creative direction before multiplying screens. It must answer:

- What is the experience's central idea?
- What feeling should remain after the visit?
- What visual contrast differentiates the brand?
- What is structural and what is decoration?
- Which references describe language, and which are merely visual copies that are prohibited?
- How does the idea work without imagery, audio, hover, and with reduced motion?

Recommended deliverables:

- an annotated moodboard, not just a collage;
- photography/illustration/3D direction and cropping rules;
- primary and supporting typography with license and fallback;
- semantic color palette and contrast examples;
- composition, rhythm, and density principles;
- storyboard for motion and video moments;
- an explicit list of anti-patterns that do not belong to the brand.

The [premium visual guide](./design-code-eng.md) provides palettes, typography, layout, components, and motion. Use it as an execution system, not as a substitute for strategic direction.

## 6. Gate 4 — Production design system

### Tokens

Define tokens before components:

- brand color, surfaces, text, border, focus, success, warning, error, and information;
- typography by function: display, heading, body, label, caption, and code;
- spacing, container, grid, radius, border, shadow, and elevation scales;
- breakpoints based on behavior, not specific devices;
- motion: duration, easing, distance, stagger, and reduction rules;
- z-index, layers, opacity, and interaction states.

Use semantic tokens (`color.text.primary`) instead of scattering raw values (`#111111`) across components. Dark mode and themes should swap tokens, not require a copied interface.

### Components

Every production component should have:

- purpose, anatomy, and usage rules;
- necessary variants, without infinite cosmetic variants;
- `default`, `hover`, `focus-visible`, `active`, `disabled`, `loading`, `error`, and `success` states when applicable;
- behavior on mobile, keyboard, zoom, long content, and missing media;
- HTML semantics and accessibility contract;
- realistic example data and known limits;
- a test or acceptance criterion;
- a recorded decision when there is a meaningful trade-off.

Do not turn every section into a single disposable component. Componentize real repeated patterns and preserve freedom for special compositions.

### Maturity criterion

A component is not ready because it exists in Figma. It is ready when another person can use it without asking the author how it should behave.

## 7. Gate 5 — UX, prototype, and validation

- Prototype hierarchy, navigation, and critical states first; visual detail comes later.
- Test with near-real content, including long titles, missing images, errors, and small screens.
- Validate five questions: “what is it?”, “is it for me?”, “why trust it?”, “what do I do now?”, and “what happens next?”.
- Observe where people hesitate, not only whether they can click.
- Record decisions and issues by severity: blocker, high, medium, low.
- “Works in my viewport” is not validation.

## 8. Gate 6 — Premium implementation

### Architecture

- Separate content, data, components, layout, tokens, integrations, and media.
- Keep components small, named, and searchable; follow [`clean-code-eng.md`](./clean-code-eng.md).
- Use semantic HTML before ARIA and progressive enhancement for essential content.
- Choose a rendering strategy (static, server-side, hybrid, or client-side) based on content, SEO, personalization, and interaction needs.
- Do not add a framework, animation library, 3D, or CMS just because it is fashionable.
- Treat dependencies, fonts, images, and external scripts as product and security decisions.
- Keep a single source for tokens and content; avoid drift between Figma, code, and CMS.

### Content and media

- Use images and video with documented license, attribution, and purpose.
- Define `alt`, captions, transcript, poster, aspect ratio, focal point, and fallback.
- Reserve media space before loading to avoid layout shift.
- Do not use video, 3D, custom cursors, or parallax to hide a weak proposition.
- Essential content must remain understandable when media is blocked or unavailable.

### Motion

- Motion should explain change, hierarchy, spatial relationship, or feedback; it should not exist only to impress.
- Use entry, continuity, exit, and error states consistently.
- Prefer `transform` and `opacity`, pause work outside the viewport, and respect `prefers-reduced-motion`.
- Every essential interaction must work without hover, pointer lock, audio, or complex gestures.
- For trailers, demos, and HTML motion graphics, use [HyperFrames](https://hyperframes.heygen.com) and follow the [official quickstart](https://hyperframes.heygen.com/quickstart). Preserve brand tokens and validate the render as a separate audiovisual product.

## 9. Gate 7 — Technical quality

This guide orchestrates the specialized guides; it does not duplicate them.

| Area | Minimum gate | Reference |
| --- | --- | --- |
| Code | lint, format, typing, architecture review, and dependency review | [`clean-code-eng.md`](./clean-code-eng.md) |
| Accessibility | keyboard, focus, semantics, contrast, zoom/reflow, screen reader, and `prefers-reduced-motion` | [`accessibility-eng.md`](./accessibility-eng.md) |
| Testing | unit, integration, E2E, accessibility, and visual regression | [`test-code-eng.md`](./test-code-eng.md) |
| Performance | baseline, budgets, Web Vitals, real network/device, and regression | [`perf-code-eng.md`](./perf-code-eng.md) |
| Security | secrets, headers, dependencies, forms, uploads, CSP, and third parties | [`sec-code-eng.md`](./sec-code-eng.md) |
| Design | tokens, components, responsiveness, real content, and Anti-Slop | [`design-code-eng.md`](./design-code-eng.md) |

### Minimum QA matrix

Test critical flows in a documented matrix that includes:

- wide desktop, smaller desktop, tablet, and mobile;
- Chromium/Chrome, Firefox, and Safari when they are in scope;
- keyboard, touch, mouse/trackpad, and screen reader when applicable;
- 200% zoom, reflow, dark mode, high contrast, and reduced motion;
- fast network, constrained network, cold cache, and low-performance device;
- short, long, translated, missing, invalid, and loading content;
- cookies/consent, third-party blocking, and CMS/API failure.

Record browser, device, version, steps, evidence, severity, owner, and status. A beautiful screenshot is not a reproducible test.

## 10. SEO, discovery, and trust

- Every page should have a search intent or a clear reason not to be indexed.
- Use coherent heading hierarchy, unique title/description, canonical, sitemap, robots, and structured data when appropriate.
- Write for people; do not sacrifice clarity for keywords.
- Ensure crawlable links, indexable error states when needed, Open Graph, favicon, manifest, and correct sharing.
- Do not publish claims, reviews, client logos, or structured data without source and authorization.
- Validate accessibility, performance, privacy, and SEO together: a growth tactic that harms trust is a regression.

## 11. Launch and operations

Before deployment, confirm:

- production environment, variables, and secrets are separated;
- domain, TLS, redirects, cache, CDN, and headers are correct;
- analytics has consent, named events, and a privacy plan;
- error monitoring, uptime, Web Vitals, conversion, and forms are monitored;
- CMS backup/export and rollback plan exist;
- editing documentation, owners, dependencies, and content expiry are documented;
- post-deploy smoke tests cover critical pages and journeys;
- there is a plan to update fonts, libraries, content, consent, and dependencies.

Launch is a transition stage, not the end of the project. Schedule a review after real data, stabilization fixes, and an evidence-based improvement cycle.

## 12. Studio anti-patterns

- Starting with the hero before understanding objective, content, and audience.
- Using lorem ipsum, invented numbers, or unlicensed images.
- Copying a visual reference without understanding the logic that makes it good.
- Creating a huge design system without enough product to justify its parts.
- Building every page with different tokens, spacing, and components.
- Using animation to delay content access or prevent navigation.
- Treating desktop as the only version and “responsive” as automatic shrinking.
- Performing QA only at the end, in one browser and on one computer.
- Measuring only local Lighthouse or only conversion, ignoring accessibility and quality.
- Delivering a site that only its author can maintain.

## 13. Template for `CLAUDE.md` / `AGENTS.md`

```md
## Premium website at studio level

- Read `premium-sites-studio-eng.md` before creating or reviewing pages.
- Close brief, content, architecture, and creative direction before full implementation.
- Use `design-code-eng.md` for tokens, layout, components, and motion.
- Use real or representative content; do not invent claims, logos, metrics, or testimonials.
- Keep content, tokens, components, integrations, and media separate.
- Preserve semantic HTML, keyboard, focus, contrast, zoom, reflow, and reduced motion.
- Validate desktop, mobile, Safari/Firefox/Chromium, constrained network, and long content.
- Run lint, format, tests, accessibility, performance, security, and visual regression checks.
- Document decisions, risks, exceptions, owners, and next tests.
- Before deployment, validate SEO, analytics/consent, headers, TLS, rollback, and smoke tests.
- If the project has HTML video or motion, consult HyperFrames and validate preview/render.
```

## 14. Final checklist

- [ ] Brief approved with objective, audience, primary action, metrics, and non-goals.
- [ ] Real content inventoried, reviewed, licensed, and assigned to an owner.
- [ ] Sitemap, journeys, URLs, and content model defined.
- [ ] Creative direction documented and distinct from copied references.
- [ ] Tokens, components, variants, states, and decisions recorded.
- [ ] Prototype validated with long content, error, loading, mobile, and reduced motion.
- [ ] Implementation has no unjustified dependencies or effects.
- [ ] Accessibility, testing, performance, and security approved.
- [ ] Technical SEO, sharing, analytics, and consent reviewed.
- [ ] QA executed in a documented matrix with evidence and severity.
- [ ] Deployment, rollback, monitoring, CMS, and owners documented.
- [ ] Post-launch review scheduled using real data.

## Related documents and references

- [Premium design](./design-code-eng.md)
- [Accessibility](./accessibility-eng.md)
- [Clean Code](./clean-code-eng.md)
- [Testing](./test-code-eng.md)
- [Performance](./perf-code-eng.md)
- [Security](./sec-code-eng.md)
- [HyperFrames](https://hyperframes.heygen.com)
- [Web Content Accessibility Guidelines (WCAG)](https://www.w3.org/TR/WCAG22/)
- [Web Vitals](https://web.dev/articles/vitals)
- [Google Search — SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)

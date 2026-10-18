---
name: design-code-eng
language: en
description: "Visual direction, UX, motion, and perceived performance for premium digital experiences."
version: "2026.09"
last-reviewed: "2026-10-17"
guide-id: design
requires-gates:
  - design
completion-evidence:
  - visual-validation
---

# Web Design Premium v2 — Practical Guidelines

> This guide provides starting points for a coherent interface. Preserve the product's existing tokens, components, platform conventions, and brand before selecting a new palette or font. Numeric values, example layouts, aesthetic bans, and snippets below are contextual defaults, not universal compliance rules or approval gates. Record meaningful departures with a short rationale and validate hierarchy, accessibility, and performance.
> **Related documents**: for the complete studio-level website production process, see [`premium-sites-studio-eng.md`](./premium-sites-studio-eng.md). For the quality/structure of the code that implements this design, see [`clean-code-eng.md`](./clean-code-eng.md). For accessibility/visual/E2E testing, see [`test-code-eng.md`](./test-code-eng.md). For form security, authentication, and client-side storage, see [`sec-code-eng.md`](./sec-code-eng.md). To translate visual direction into HTML video, see [HyperFrames](https://hyperframes.heygen.com). This file focuses exclusively on UI/UX/visuals — it does not repeat code, testing, or security rules.
>
> **Tooling policy**: identify the stack, the stage, and the applicable checks; prefer an already available equivalent that produces compatible evidence. Installation or environment changes require authority; reuse scoped authorization already given rather than asking again. If no safe equivalent exists, record the required check as blocked and never claim that it passed. Do not install merely optional resources.

## How to use this guide (strong default process)

Adopt this order as the default when creating a page from scratch; document an exception when the product, platform, or user requires a different sequence:

1. **Confirm semantic color roles** from the existing design system; use a sample palette when no system exists.
2. **Confirm typography roles and language coverage**; use a sample combination when appropriate.
3. **Define the section list from the content and user journey**; use the anatomy as a reference.
4. **Apply a coherent grid and spacing scale** with responsive content checks.
5. **Reuse components and their interaction states**; adapt sample specifications to the product.
6. **Add purposeful motion** only when it helps the experience, with reduced-motion and static fallbacks.
7. **Run the Anti-Slop Checklist** before considering it ready.
8. **Audit and polish the affected experience** with the available project tools and direct browser/device inspection. Impeccable is an optional aid when installed and relevant; its availability is not a completion gate. Preserve the design system and recheck the changed states.

Keep color and type decisions intentional. A familiar font, framework default, or repeated component is not a defect by itself; assess its fit, readability, hierarchy, and consistency in the actual interface.

> **This guide covers 3 contexts.** For web sites/products (desktop and mobile), follow the flow above normally. For **native mobile apps** (iOS/Android), go directly to the "Premium Mobile Apps" section. For **native desktop apps** (Windows/macOS), go to "Premium Desktop Apps". In the latter two cases, this guide's palettes and typography still serve as tone references, but platform guidelines (HIG, Material Design, Fluent) take priority over the generic values defined here.

---

## Principles (Anti-Slop)

- Fewer elements, more intention: each block must have a clear function.
- Avoid a template appearance: vary composition, rhythm, and hierarchy between sections (never repeat the same section layout 2x in a row).
- Visual consistency over effects: motion and 3D should reinforce the narrative, not distract.
- Premium finish = refined detail in typography, spacing, contrast, and microinteractions — not quantity of elements.
- **Golden rule of whitespace**: if you are wondering whether there is too much space, there is too little. Premium sites breathe.

---

## Ready-made semantic palettes (choose 1, do not mix)

Each palette implements **seven base semantic tokens**: `background-base`, `background-alt`, `text`, `text-secondary`, `primary`, `border/divider`, and `semantic-accent`. They provide function and contrast; they are not the same as optional decorative accents.

**A. Dark Editorial (fashion, architecture, luxury)**

- Background: `#0B0B0C` | Alt background: `#141416`
- Text: `#F5F4F1` | Secondary text: `#A8A7A3`
- Primary: `#C9A876` (matte gold)
- Border/divider: `#2A2A2C`
- Accent (rare use): `#D14F3E`

**B. Light Clean Corporate (SaaS, premium fintech)**

- Background: `#FAFAF8` | Alt background: `#F0EFEB`
- Text: `#141414` | Secondary text: `#5C5C5C`
- Primary: `#1F3D2B` (deep green)
- Border/divider: `#E3E1DB`
- Accent (rare use): `#C4623A`

**C. Minimal Warm Neutral (studios, portfolio, branding)**

- Background: `#F7F5F2` | Alt background: `#EDEAE4`
- Text: `#1C1B19` | Secondary text: `#726F68`
- Primary: `#3D3A34` (almost-black brown)
- Border/divider: `#DEDAD2`
- Accent (rare use): `#8A6E4B`

**D. Vibrant Dark Tech (digital product, AI, dev tools)**

- Background: `#08090C` | Alt background: `#101218`
- Text: `#EDEEF0` | Secondary text: `#8A8F98`
- Primary: `#6E6AF5` (indigo)
- Border/divider: `#1F2128`
- Accent (rare use): `#3EDBB8`

Color usage rules:

- Primary: used in CTAs, active links, key icons. Max. 10% of the visible area.
- Semantic accent: reserve it for a consistent role (for example, a state, short emphasis, or signal) and do not change its meaning between components.
- **Decorative** accents are extras, not tokens: as a default, limit them to 1–2 simultaneous accents per screen/view (for example, a badge or highlight). That limit does not count functional background, text, primary, or border tokens.
- Derived states (hover, focus, pressed, disabled, error, success, and selection) must preserve contrast, meaning, and coherence with their source tokens.
- As a default, use gradients of at most 2 colors and 5%–20% opacity over a solid background; document the exception and test contrast if the product requires more.

---

## Ready-made Typographic Combinations (choose 1)

Format: Display (headings) + Text (body). Families marked as Google Fonts can be loaded from that catalog; `General Sans`, `Clash Display`, and `Satoshi` are **not** Google Fonts and must not be assumed free by default.

1. **Classic editorial**: `Fraunces` (display, serif, weights 400/600) + `Inter` (body).
2. **Modern luxury**: `Playfair Display` (display) + `Manrope` (body).
3. **Tech/product**: `Space Grotesk` (Google Fonts) or `General Sans` (external, subject to license) as display + `Inter` (Google Fonts) as body.
4. **Warm minimal**: `Instrument Serif` (display, only for large headings) + neutral `Sans` such as `Public Sans` (body).
5. **Contemporary bold**: `Clash Display` (external, subject to license) as display + `Satoshi` (external, subject to license) as body.

Rules:

- Never use more than 2 font families on the entire page.
- Never use the display font for long paragraphs (only H1/H2/short highlight blocks).
- Typographic scale (rem, base 16px):
  - H1: `clamp(2.75rem, 5vw, 5rem)`, line-height `1.05`, letter-spacing `-0.02em`
  - H2: `clamp(2rem, 3.5vw, 3rem)`, line-height `1.1`, letter-spacing `-0.01em`
  - H3: `clamp(1.5rem, 2.2vw, 2rem)`, line-height `1.2`
  - Body: `1.125rem` (18px), line-height `1.6`
  - Small/caption: `0.875rem`, line-height `1.5`
- Maximum running-text width: `65ch`.
- Font weight: headings 500–700, body 400–450 (never 300 for body text, as it harms legibility).
- Before using an external font, record its source/vendor, license, and authorized files/weights; include an appropriate system fallback, for example `system-ui, -apple-system, "Segoe UI", sans-serif`. Do not assume a font seen in a gallery may be hosted or redistributed.

---

## Layout & Spacing (measurable defaults)

- Maximum container: `1280px`, centered, side padding `clamp(24px, 6vw, 96px)`.
- Grid: 12 columns, gap `24px` desktop / `16px` mobile.
- Spacing scale (use multiples of this scale as the default; document values outside it when they improve a concrete need):
  `4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192px`
- Vertical spacing between sections: minimum `96px` mobile, `160px` desktop.
- Section internal spacing (top/bottom padding): `64px` mobile, `120px` desktop.
- Breakpoints: mobile `< 640px`, tablet `640–1024px`, desktop `> 1024px`.
- Rhythm: alternate between "dense" sections (text + image + CTA) and "empty" sections (one large centered sentence, lots of space). Rule of thumb: every 2 dense sections, 1 breathing section.
- Consistent border-radius: choose 1 scale value and use it everywhere — `8px` (sober/corporate) or `16px` (soft/product) or `2px` (editorial/luxury). Never mix different radii in the same project.
- Standard shadow (use only 1 recipe per project, applied consistently):
  - Subtle: `0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06)`
  - Elevated (modals/dropdowns): `0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.08)`

---

## Web Mobile — Specifics (it is not just "shrinking desktop")

A premium mobile site is not a reduced desktop layout — hierarchy, density, and interaction change.

- **Viewport**: always `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`.
- **Safe areas**: use `env(safe-area-inset-top/bottom/left/right)` in fixed elements (nav, sticky CTA) to respect the notch/Dynamic Island/home indicator.
- **Touch, not hover**: every interactive element must have a minimum real touch area of `44x44px`, even if the visual element is smaller (use invisible padding to compensate).
- **Never depend on hover** to reveal essential information or interaction (tooltips, dropdown menus) — always have a touch/click equivalent.
- **Mobile nav**: prefer a fullscreen hamburger menu (see Components section) or fixed bottom nav for web apps/PWAs with few sections (3–5 items).
- **Sticky CTA**: on long conversion pages, consider a CTA fixed to the bottom of the mobile viewport (bar with 1 button, height `56–64px`, subtle upward shadow), with `env(safe-area-inset-bottom)` in the padding.
- **Content density**: reduce to 1 column, headline smaller than the desktop scale but still dominant (use the `clamp()` already defined — never set a fixed `px` value that ignores the clamp).
- **Forms**: inputs with minimum `font-size` of `16px` (prevents automatic zoom in iOS Safari), correct `inputmode`/`type` (`email`, `tel`, `numeric`) for the contextual keyboard.
- **Mobile-first performance**: always test using simulated 4G/3G network throttling; images on mobile must be smaller variants via `srcset`, never the same desktop image resized by CSS.
- **Gestures**: swipe in carousels/galleries must have a fallback of visible dots/arrows; never depend only on the gesture without a visual indication that more content exists.

---

## Premium Page Anatomy (recommended order)

Use this as the standard skeleton for landing pages; adapt it according to the product, but maintain the logic of "open strong → prove → convert".

1. **Nav**: logo on the left, 3–5 links in the center/right, 1 prominent CTA. Fixed or with a transparent background that gains blur while scrolling.
2. **Hero**: 1 strong headline (max. 8–10 words), 1 subheadline (1–2 sentences), 1 primary CTA + 1 secondary (text/link). Never more than 2 CTAs in the hero.
3. **Light social proof**: client/press logos in grayscale, single line, no embellishment.
4. **Value section (2–3 blocks)**: each block = 1 idea, icon or simple image, short title, 1–2 lines of text.
5. **Product/demo section**: real screenshot, mockup, or short video — never a generic stock illustration.
6. **Testimonials or data/numbers**: 2–4 real testimonials OR 3–4 large metrics with numbers.
7. **Intermediate conversion CTA**: breathing section, large centered sentence + 1 button.
8. **FAQ** (if applicable): simple accordion, 4–6 questions.
9. **Final CTA**: repeat the central value proposition + primary button.
10. **Footer**: organized link columns, social media, copyright. No excessive columns (max. 4).

Rule: never repeat the same "image left + text right" pattern in 2 consecutive sections — alternate sides, or switch to a centered layout.

---

## Color, Contrast, and Depth

- Minimum AA contrast: normal text ≥ 4.5:1, large text (≥24px) ≥ 3:1.
- Soft backgrounds and subtle gradients (opacity 5–20%, without banding).
- Depth built with light layers: blur (`8–24px`), subtle shadow, controlled overlay — never hard shadows (`0 0 20px black`).

### Liquid Glass, glassmorphism, and translucency

- **Glassmorphism** is a static approximation: transparency, `backdrop-filter: blur()`, a subtle border, and shadow. **Liquid Glass** describes a dynamic material that attempts to simulate refraction, specular highlights, tint, shadow, and deformation responsive to content or movement.
- Do not call CSS blur real refraction. On the web, refraction normally requires displacement or shaders, for example SVG, WebGL, or WebGPU; these are optional, costlier enhancements that require a fallback.
- Reserve transparency/refraction for one or two low-density floating surfaces — contextual navigation, toolbar, tab bar, sheet, popover, or a focused control. Body copy, long forms, prices, critical states, decisions, and essential CTAs remain on solid or predictably contrasting surfaces.
- Validate every state against the most complex background that could pass behind the surface. Glass over glass, long text over moving/refracted backgrounds, and transparency across every layer turn depth into noise.

### Normative progressive-enhancement contract for Canvas and Liquid Glass

This contract applies to Canvas UI, Canvas/WebGL/WebGPU, SVG displacement, and Liquid Glass; other sections only complement it.

1. **Functional base first:** deliver semantic HTML and real HTML controls before any effect. Content, action, and focus, hover, pressed, disabled, error, success, and selection states must work without JavaScript, WebGL, or a shader.
2. **Equivalent fallback:** without the enhancement, render an opaque surface with the same content, controls, actions, states, and predictable contrast. Do not transfer meaning to refraction, glare, transparency, motion, or pointer input.
3. **Preferences and compatibility:** detect capability and compatibility before loading effects; respect `prefers-reduced-motion` with a static version, and reduce or remove transparency for contrast/transparency preferences (`prefers-contrast`, `forced-colors`, or an equivalent control where no reliable media query exists).
4. **Runtime budget:** initialize on demand; pause outside the viewport and while the page is hidden; limit DPR/resolution, blur, multipass filters, and simultaneous animated effects/surfaces. Simplify or disable on a modest device before sacrificing interaction, readability, or initial load.
5. **Measurable acceptance:** test variants in supported browsers, on a modest device, with reduced motion, and against the worst plausible background (light, dark, complex image, and video). Record DPR, active surfaces, and the result for readability, equivalent states, and performance budget; if any fails, ship the opaque fallback.

---

## Motion (GSAP / ScrollTrigger)

Use this base reveal pattern as a strong default. Change it only for a user/product requirement or documented exception that preserves hierarchy, accessibility, and the progressive-enhancement contract:

```js
gsap.registerPlugin(ScrollTrigger);

gsap.utils.toArray('[data-reveal]').forEach((el) => {
  gsap.from(el, {
    y: 24,
    opacity: 0,
    duration: 0.8,
    ease: 'power3.out',
    scrollTrigger: {
      trigger: el,
      start: 'top 85%',
      toggleActions: 'play none none none',
    },
  });
});
```

### Motion for video with HyperFrames (optional)

When the output is a video, trailer, product demo, or motion graphic rendered from HTML, CSS, and JavaScript, consider [HyperFrames](https://hyperframes.heygen.com). It complements — and does not replace — this guide's visual rules.

- Preserve brand tokens (palette, typography, spacing, and radius) when adapting the interface to the frame; do not simply capture the entire page.
- Prefer deterministic, frame-controllable animation with a paused/seekable timeline so preview, tests, and rendering reproduce the same result.
- Keep text large enough for the output format, maintain AA contrast and safe areas, and do not make meaning depend on audio or motion.
- Respect `prefers-reduced-motion` in interactive previews and provide a static or reduced-motion alternative when appropriate.
- Start with the [official quickstart](https://hyperframes.heygen.com/quickstart). Use the project's pinned, already-installed CLI for `preview`, `lint`, `check`, and `render`, verifying the installed command help. Do not use an install-capable launcher merely to obtain a missing verifier; installation authority remains separate.

Motion rules:

- Vertical displacement: `16–32px` (never more than that — avoids a "flying" effect).
- Duration: `0.6–0.9s` for reveals, `0.2–0.35s` for hover/microinteractions.
- Easing: `power3.out` or `expo.out` for entrances; `power2.inOut` for state transitions.
- Stagger between elements in a list: `0.06–0.1s`.
- Never: bounce, elastic, exaggerated rotation, aggressive parallax (>30% of scroll speed), video autoplay with sound, infinite decorative loops that compete with the content.
- On Liquid Glass surfaces, elastic easing remains prohibited. Any internal micro-deformation, morphing, glare, or cursor/touch response is visual finish only: short and pausable, never required to understand, focus, or act. With `prefers-reduced-motion: reduce`, use a static surface.
- Wrap motion logic in this guard by default; a documented exception must still respect `prefers-reduced-motion` and the progressive-enhancement contract:

```js
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  // initialize animations
}
```

---

## 3D and Interactivity (Three.js) — optional, only if justified

- Use only if it reinforces the product/narrative (e.g., physical product, technical data, technology brand). If you are not sure it helps, do not use it.
- Keep elements subtle: light particles, simple shapes, soft lighting.
- For purely decorative 3D scenes, apply the progressive-enhancement contract: the 2D/opaque fallback must serve browsers without WebGL and people who reduce motion.
- Limit: <5000 particles, no heavy post-processing (bloom may stay, avoid SSAO/motion blur).
- Pause rendering when the canvas leaves the viewport (`IntersectionObserver`).

Canvas, WebGL, SVG displacement, and Liquid Glass effects follow the **normative progressive-enhancement contract** above. Apply it to decorative 3D scenes too; do not create an alternate interaction path.

---

## Premium Components (measurable defaults)

### Component state contract

Before polishing an interactive or data-bearing component, list the states it
can actually reach. Use only the applicable states; this is a review aid, not a
requirement to manufacture every variant.

- **Resting and interaction:** default, hover where supported, focus-visible,
  and active/pressed.
- **Availability:** disabled and loading when the operation or dependency is
  unavailable or in progress.
- **Data and outcome:** empty, selected, expanded/collapsed, success, and error
  when the component can display those conditions.

Every reachable state must preserve the component's semantic name, action,
focus behavior, contrast, and a non-color cue where color alone would be
ambiguous. Define the authoritative transition for asynchronous states,
including cancellation or a repeated request, so an interrupted operation
cannot leave stale loading, success, or error feedback. Verify reachable
transitions with interaction and semantic checks; a screenshot can show an
appearance but cannot prove the state behavior or accessibility.

**Primary button**

- Padding: `14px 28px` (mobile `12px 24px`)
- Border-radius: equal to the radius chosen in the project
- Font-weight: 500–600, font-size `1rem`
- Transition: `transform 0.2s ease` (change the background color immediately; use a slight `translateY(-1px)` on hover)
- Minimum touch area: `44x44px`
- Focus state: visible outline (`2px solid`, primary color, offset `2px`) — never `outline: none` without a replacement.

**Cards**

- Internal padding: `32px` (mobile `24px`)
- Border: `1px solid` palette border color, OR subtle shadow — choose 1 of the two, not both.
- Radius: equal to the project standard.
- Hover (if clickable): subtle elevation with `translateY(-2px)`; transition only `transform` for `0.25s ease`.

**Navigation**

- Height: `72–88px` desktop, `64px` mobile.
- Active item: subtle underline or primary color — never a fully colored background.
- Mobile menu: fullscreen overlay, fade+slide transition `0.3s`, with an instant/static alternative when reduced motion is active.

**Images**

- Use `object-fit: cover` with a fixed `aspect-ratio` only for editorial/decorative imagery (for example, a card photo or avatar). For logos, charts, screenshots, and informational content, use `contain` or preserve intrinsic proportion so information is not cropped.
- `border-radius` consistent with the rest of the UI.
- Never stretch/distort an image.

**Optional canvas/WebGL effects**

- For high-impact moments — such as heroes, reveals, and special interactions — consult [Canvas UI](https://canvasui.dev/) as an **adaptable reference**, never as automatically reusable source material.
- Before reusing any asset, text, image, or code, confirm provenance, authorship, license, and credit obligations; adapt tokens, composition, and behavior to the project's identity without copying a result or component.
- Keep text, navigation, controls, and every essential action as semantic, accessible HTML. Canvas follows the **normative progressive-enhancement contract** and is never the only communication channel.

**Liquid Glass surface (optional)**

- Use it for short-content controls or contextual navigation; keep the real element focusable and actionable in HTML.
- Prefer a simple shape, restrained tint/blur/highlights, and conventional focus states. Internal micro-deformation, glare, and pointer tracking follow the Liquid Glass rule in the Motion section and the progressive-enhancement contract.
- Do not apply chromatic aberration, distortion, or reflection to readable text, essential icons, fields, tables, or status messages.

**UI libraries and data visualization**

- For accessible, composable, and customizable web components, consult [shadcn/ui](https://ui.shadcn.com/); adapt tokens, states, and composition to the project's visual system instead of copying defaults without intent.
- For charts and data visualization, consult [TanStack Charts](https://github.com/TanStack/charts); preserve responsiveness, contrast, keyboard readability, and never rely on color alone to communicate series or states.
- For subtle interaction sounds, consult [Cuelume](https://cuelume-site.pages.dev/); provide volume/mute controls and never rely on audio to communicate essential information.

### Architecture and diagram design — Beautiful Mermaid

When a task benefits from a polished technical diagram — for example an
architecture flow, lifecycle, state machine, sequence, class, ER, or other
Mermaid-supported visualization — consider
[Beautiful Mermaid by Craft](https://agents.craft.do/mermaid) as an optional
design/rendering resource.

Use the live editor at
[agents.craft.do/mermaid/editor](https://agents.craft.do/mermaid/editor) to
preview and refine Mermaid source and, when appropriate, export a polished SVG.

Rules:

- Mermaid source remains the canonical editable artifact when the project
  already uses Mermaid-as-source.
- Prefer improving diagram structure and semantics before styling.
- Preserve technical accuracy; visual polish must never remove meaningful
  states, branches, trust boundaries, failure paths, or labels.
- Prefer local/versioned SVG assets for repository documentation rather than
  hotlinking externally rendered images.
- Treat Beautiful Mermaid as optional tooling, not as an implementation,
  verification, authority, or completion dependency.
- Do not install `beautiful-mermaid` merely to render a documentation asset
  when the browser editor or an already available equivalent is sufficient.
- If automated rendering is explicitly required, evaluate the open-source
  `beautiful-mermaid` library separately under the project's dependency and
  authorization policies before adding it.

## External design-reference map

Select references for a product problem; they do not override project tokens or semantics. Check every adoption for keyboard and focus access, contrast, reduced motion, touch behavior, bundle/runtime cost, and fallback behavior. Cursor, canvas, 3D, audio, and decorative motion are progressive enhancement only. Do not copy source or assets; check the license and current terms for each exact resource, and treat a catalog listing as no transfer of rights.

- **Technical diagrams and architecture flows**: for polished Mermaid-based architecture and workflow diagrams, use [Beautiful Mermaid by Craft](https://agents.craft.do/mermaid) when relevant; preserve canonical Mermaid source, local versioned SVG assets, and do not treat presentation tooling as a mandatory protocol gate or runtime dependency.
- **Component source and interaction inspiration**: use [21st.dev](https://21st.dev/) to study components and interactions; inspect each source, dependency, community contribution, and premium-material term before adoption.
- **AI-agent and conversational UI reference**: use [AIcss](https://www.aicss.dev/) to study specialized AI-agent and assistant interfaces (streaming responses, tool/action states, diffs, citations, structured outputs, agent inputs, and approval cards) when the target actually has an AI-agent surface.
- **React component and motion reference**: use [React Bits](https://reactbits.dev/) to discover animated React components and interaction patterns, and inspect the [React Bits source repository](https://github.com/DavidHDev/react-bits) before adopting code. Use it only when the target stack is React or when a deliberate, reviewed adaptation is appropriate. Prefer the smallest component or pattern that solves the product need; do not install or copy the entire library by default. Inspect the exact component source, transitive dependencies, license/usage terms, accessibility behavior, reduced-motion behavior, responsive behavior, and runtime cost before adoption. Adapt tokens, typography, spacing, states, semantics, and motion to the target project's design system instead of preserving React Bits defaults.
- **React and Next.js animated components**: use [beUI](https://beui.dev/) and its [source repository](https://github.com/starc007/ui-components) to study React/Next.js animated components built with Motion and Tailwind; prefer source-level adoption of the smallest matching component when the target stack fits.
- **Page and theme transitions**: use [Transition Kit](https://transition-kit.space/) and its [source repository](https://github.com/AbdullahMukadam/Transition-kit) as a reference for CSS-first page and theme transitions built around the View Transitions API; use as progressive enhancement only with functional fallback.
- **Component inspiration**: use [Fancy Components](https://www.fancycomponents.dev/) to study component composition; verify its terms separately from Motion, Tailwind, shadcn, or other dependencies.
- **Motion primitives**: use [Motion Primitives](https://motion-primitives.com/) to study discrete interaction patterns; distinguish documented open-source material from its Pro offering and verify component/dependency terms.
- **Component and design-system research**: use [Component Gallery](https://component.gallery/) for comparison, not for license assumptions.
- **Numeric feedback**: reserve [NumberFlow](https://number-flow.barvian.me/) for changing metrics, with locale-aware formatting and static or reduced-motion behavior.
- **Pointer enhancement**: activate [Cursify](https://cursify.ui-layouts.com/) only when `(hover: hover) and (pointer: fine)`; retain native controls and default cursor behavior, with equivalent tap interaction for touch/coarse pointers.
- **Typography discovery**: verify each [UNCUT](https://uncut.wtf/) font's author, license, weights, and hosting rights.
- **Creative coding and WebGL**: [cables.gl](https://cables.gl/) requires a semantic fallback, pause/offscreen behavior, a performance budget, and asset/operator provenance.

### External UI/component reference adoption

External galleries, component registries, motion libraries, and UI references are discovery inputs, not product requirements.

Before materially adopting an external component or interaction:

1. define the concrete UI need first;
2. confirm the target stack and existing design system;
3. inspect the exact component/source rather than relying on a gallery preview;
4. verify current license/terms and any premium/free boundary;
5. inspect runtime dependencies and avoid introducing a second animation or UI stack without a measured reason;
6. verify keyboard/focus semantics, contrast, responsive behavior, touch, loading/error/disabled states, and reduced motion;
7. evaluate bundle/runtime cost and browser/platform support;
8. adapt the smallest useful source into the target project's tokens, architecture, and component conventions;
9. record source/provenance when materially adopted;
10. re-run target-project verification after adaptation.

Do not install or copy an entire component library merely because one example looks useful. When React Bits, beUI, Motion Primitives, or another motion/component source could all satisfy the same need, choose one smallest compatible implementation; do not combine libraries for variety. ForgeLoop itself must not gain a dependency on any resource listed in this section.

#### External resource discovery workflow

When the needed design capability is not already available in the target project:

1. define the concrete capability first;
2. search the project's existing components/dependencies before external discovery;
3. use a curated index such as DesEngs when current alternatives would help;
4. shortlist at most 2–3 realistic candidates;
5. inspect each candidate's exact upstream source;
6. compare license, dependencies, accessibility, performance, compatibility, maintenance, and implementation cost;
7. choose the smallest compatible option;
8. do not install anything without the authority already required by ForgeLoop;
9. record provenance when materially adopting external code or assets.

Bound discovery effort: 2–3 candidates is the strong default; broader research is justified only for a genuinely high-risk architecture decision. External discovery is optional and proportional — it must never become a mandatory browsing gate.

#### Permanent reference admission rule

Do not add every useful external discovery to ForgeLoop's canonical guide. Add a named permanent reference only when it provides a recurring capability, workflow, or quality signal that is materially useful across projects and is not already covered by an existing reference. One-off discoveries remain target-project choices.

A meta-directory such as DesEngs may be used to rediscover current alternatives instead of expanding ForgeLoop into an exhaustive external-tools catalog.

### Design-engineering meta-discovery

- **DesEngs** — https://desengs.com/
  Optional meta-directory for discovering current design-engineering resources across reading, learning, UI/component exploration, interaction tooling, skills, creative coding, design systems, and implementation references. Use it when a concrete design need is not already satisfied by the target project's design system or a known compatible ForgeLoop reference.

  Treat DesEngs as a discovery index, not as an approval list. For any linked resource that may be materially adopted, inspect the exact upstream source, current license/terms, dependencies, accessibility, browser/platform support, performance cost, maintenance status, and premium/free boundary before use. The license or listing status of DesEngs does not grant reuse rights for the external projects it indexes.

### Optional pattern and asset references

External galleries and asset libraries are reconnaissance tools, not design authority. The target product's requirements, existing design system, accessibility, security, performance budget, and the rules in this guide take precedence.

Before using an external example:

1. identify the design problem it solves;
2. compare at least two structural options when practical;
3. choose based on content and interaction needs, not novelty;
4. rebuild the chosen pattern in the target project's own stack and tokens;
5. verify accessibility, responsiveness, states, and performance;
6. verify the current source/license before copying code, prompts, media, or other substantial material.

#### UI pattern reconnaissance

- **VibePrompt** — https://vibeprompts.dev/
  Optional pattern-vocabulary reference for common UI structures including heroes, pricing, FAQ, onboarding, dashboards, navigation, contact, feature sections, and supporting utility UI. Use it to compare section and interaction structures before implementing, and treat the examples as inspiration and vocabulary, not as canonical ForgeLoop markup. Do not treat Tailwind examples or prompts as canonical ForgeLoop markup; rebuild the selected pattern using the target project's own stack, components, semantic HTML, tokens, accessibility rules, responsive behavior, and performance budget. Verify the source terms before copying any prompt, snippet, or substantial text.

#### Illustration references

- **Kitbitz** — https://kitbitz.art/
  Optional hand-drawn illustration reference when the selected creative direction genuinely benefits from playful/editorial imagery (education, creative tools, games, maps, community products, illustrated onboarding). Do not make it a default asset source for every site, and do not assume a permanent license status: verify the current first-party license and the exact asset terms before use. Record source, license, purpose, and any required attribution. Prefer SVG when appropriate, optimize delivered assets, provide accessible alternatives, and ensure the page remains understandable if the illustration is unavailable.

#### Editorial strategy reference

- **Elaya Design — Landing Page Design**
  https://github.com/elayadesign/ai-design-skills/blob/main/skills/landing-page-design/SKILL.md

  Useful as an editorial reference for landing-page strategy, conversion structure, benefit-first copy, objection handling, proof placement, and section-by-section implementation. Its prescriptive visual system (specific fonts, palettes, motion recipes, and navigation styles) is not a ForgeLoop universal rule and does not override this guide or the target project's design system. ForgeLoop's own `NON_BLOCKING`/`BLOCKING` decision classification controls whether the user must be asked anything.

### React Bits — operational use for React interfaces

React Bits is an optional implementation/reference source for high-finish React interfaces. It is not a required ForgeLoop tool, protocol dependency, verification dependency, or design-system replacement.

Use it when:

- the target application uses React;
- a concrete interaction, text treatment, background, reveal, or UI component would materially improve the product experience;
- implementing the behavior from scratch would add unnecessary design or engineering cost;
- the effect fits the selected motion intensity and visual direction.

Do not use it when:

- the target is not React and adaptation would add more complexity than value;
- the component exists only as decoration without a product or communication purpose;
- the same result already exists in the target project's design system;
- the component violates the project's accessibility, performance, security, dependency, or browser-support constraints;
- a static or simpler CSS/HTML implementation communicates the same result more clearly.

Adoption workflow:

1. **Define the need first.** Identify the concrete UI or communication problem before browsing components.
2. **Confirm the target stack.** Verify React version, styling strategy, TypeScript/JavaScript choice, SSR/CSR boundary, and existing animation/runtime libraries.
3. **Inspect the source.** Review the exact component in the [React Bits repository](https://github.com/DavidHDev/react-bits), not only the visual demo.
4. **Check usage terms.** Verify the current license and any component-specific dependency or attribution requirements before copying or installing code.
5. **Choose the smallest variant.** Prefer one component/pattern and the variant matching the project (JS/TS and CSS/Tailwind); do not add unrelated components.
6. **Prefer local adaptation.** Adapt the component into the target project's component structure and semantic tokens rather than importing a visual identity wholesale.
7. **Preserve semantics.** Text, controls, navigation, forms, focus states, errors, status information, and primary actions must remain semantic and usable without decorative motion.
8. **Respect reduced motion.** Provide a static or substantially reduced alternative under `prefers-reduced-motion`; essential information must never depend on animation.
9. **Bound runtime cost.** Lazy-load expensive effects when practical, pause continuous animation outside the viewport or on hidden pages, and avoid adding duplicate animation/runtime libraries without justification.
10. **Verify the result.** Test keyboard/focus behavior, contrast, 320 CSS px reflow, touch behavior, reduced motion, console/runtime errors, and the project's performance budget.
11. **Record provenance.** When code or a material implementation pattern is adopted, record React Bits as an external source in the task/project attribution or source record when applicable.

ForgeLoop runtime must not gain a dependency on React Bits as a result of this guidance. Any installation belongs to the target project and remains subject to normal authorization and dependency policy.

### AIcss — contextual AI-agent and conversational UI reference

[AIcss](https://www.aicss.dev/) is a specialized reference for AI-agent and conversational product surfaces (streaming responses, tool/action execution states, diffs, citations, structured outputs, agent inputs, and approval/status cards).

Use AIcss as a candidate only when at least one of these is in scope:

- streamed assistant output;
- visible tool execution/status;
- source citations;
- file/code diffs;
- structured agent results;
- agent-specific input/approval interaction.

For ordinary SaaS, editorial, portfolio, or marketing UI without those surfaces, use general component/design references instead.

> [!IMPORTANT]
> **Safety and Hidden-Reasoning Boundary**: AIcss labels such as "thinking" or "reasoning" describe presentation patterns, not an evidence source. They do not authorize exposing private chain-of-thought or hidden model state. Prefer concise observable progress/status information that the target product is permitted to show.

### beUI — React/Next animated component source

[beUI](https://beui.dev/) and its source repository [starc007/ui-components](https://github.com/starc007/ui-components) provide copy-paste animated components for React/Next.js using Motion and Tailwind.

- **Smallest-Adoption Rule**: Prefer source-level adoption of the smallest matching component. Do not run its shadcn command, install its agent skill, or add Motion/Tailwind merely because the catalog is available. Any installation belongs to the target project and follows normal authorization and dependency policy.
- **Verification Expectations**: For any materially adopted animated component, verify keyboard/focus access, touch targets, reduced-motion behavior (`prefers-reduced-motion`), responsive reflow at 320 CSS px, loading/error/disabled states, console/runtime errors, and bundle/runtime impact.

### Transition Kit — progressive-enhancement page and theme transitions

[Transition Kit](https://transition-kit.space/) and its source repository [AbdullahMukadam/Transition-kit](https://github.com/AbdullahMukadam/Transition-kit) provide CSS-first page and theme transitions built around the View Transitions API.

For Transition Kit or any View Transitions API effect:

1. **Functional Base First**: The page navigation or theme switch action must work completely without the transition; enhancement never owns essential meaning or action.
2. **Implementation-Time Capability Check**: Check current target-browser support for the View Transitions API at implementation time rather than assuming static support tables.
3. **Graceful Fallback**: Unsupported browsers must receive a functional, immediate fallback without errors or layout shifts.
4. **Reduced Motion**: Under `prefers-reduced-motion`, provide an equivalent static or near-instant path.
5. **State Preservation**: Ensure focus management, navigation/history, scroll restoration, theme persistence, and interactive controls remain correct during and after transitions.
6. **Motion Budget**: Transition duration and easing must respect the product motion budget.
7. **No Protocol Dependency**: Adapt copied CSS/JS into the target project architecture instead of creating a ForgeLoop dependency.

### Target-Project React Diagnostics Cross-Reference

For React-specific supplemental diagnostics after implementation, including design-tagged findings when supported by the adopted version, see [`test-code-eng.md`](./test-code-eng.md). React Doctor is a verifier candidate, not a component/design source.

---

## UX, Accessibility, and Quality

- 100% functional keyboard navigation, focus always visible, no interaction traps.
- Minimum AA contrast (see Color section).
- Never communicate state through color alone (add an icon, text, or pattern).
- Test at 200% zoom and reflow at 320 CSS px wide.
- Every `<img>` with descriptive `alt`; decorative icons with `aria-hidden="true"`.
- When the platform exposes contrast or transparency preferences, including `prefers-contrast` and `forced-colors` where applicable, provide an opaque or less-transparent variant. Where no reliable media query exists, provide an equivalent in-product control.

---

## Performance

- For DOM/CSS animations, animate only `transform` and `opacity`; use `will-change` sparingly (remove after the animation). Shader/filter deformation or glare follows the progressive-enhancement contract.
- Images in `WebP`/`AVIF`, `srcset` + `loading="lazy"` (except the hero image, which must be eager/preload).
- Fonts: `font-display: swap`, preload only the critical hero font (1–2 files, max.).
- Performance budget: LCP < 2.5s, CLS < 0.1, and INP ≤ 200 ms at p75 in field data, reported separately for mobile and desktop, unless a different documented product target applies; motion/3D JS must not block the initial load (load via `defer`/lazy-init after interaction or scroll).

---

## Blacklist — Anti-Patterns (never do)

- Generic framework blue (`#007BFF`, `#3B82F6` default) as the primary color without intention.
- Generic shadow `box-shadow: 0 0 10px rgba(0,0,0,0.1)` on everything.
- `Inter` or `Roboto` as the site's only font without a display font.
- Generic stock-library icons (3D arrows, rocket emojis, "lightbulb").
- Centered text in long paragraph blocks.
- More than 2 font families or more than 2 simultaneous decorative accents; the seven functional semantic tokens do not count toward that limit.
- Sections all using the same grid/alignment pattern ("cloned template" look).
- Identical "fade in" animation applied indiscriminately to EVERYTHING without timing hierarchy.
- Buttons without a noticeable hover/focus state.
- Excessive badges, tags, and decorative "glassmorphism" without a function.
- Footer with 6+ columns of irrelevant links just to fill space.
- Glass over glass.
- More than two translucent layers without a semantic function.
- Long text over a moving/refracted background.
- Chromatic aberration on readable content.
- Decorative video behind controls.
- Blur-only presented as refraction.
- Reliance on glare, transparency, movement, or a mouse pointer to communicate state.

---

## Review Checklist (before publishing)

- [ ] I chose 1 semantic palette, did not mix in another palette, and documented the 1–2 additional decorative accents when used.
- [ ] I used at most 2 font families, following the defined scale.
- [ ] Spacing between sections follows the scale (minimum 96–160px).
- [ ] No section repeats the same layout as the previous one.
- [ ] Each section has 1 purpose and (when applicable) 1 clear CTA.
- [ ] Motion follows the defined snippets/patterns and respects `prefers-reduced-motion`.
- [ ] Text contrast passes AA.
- [ ] Buttons/links have visible focus and noticeable hover.
- [ ] The page works (visually and functionally) without motion/3D JS.
- [ ] I validated contrast and legibility against the worst possible background and at 200% zoom.
- [ ] The interface preserves content, focus, states, and actions without WebGL, SVG displacement, transparency, or motion.
- [ ] Canvas/Liquid Glass effects obey the contract: equivalent HTML and opaque fallback, no-JS/WebGL operation, preferences honored, pauses outside the viewport/on a hidden page, and recorded DPR/blur/effect budget.
- [ ] No more than two translucent layers compete on the same screen, and each has a clear contextual function.
- [ ] Where the platform exposes contrast/transparency preferences, including `prefers-contrast` or `forced-colors` when applicable, the opaque/less-transparent variant works; without a reliable media query, there is an equivalent in-product control.
- [ ] No item from the "Blacklist" is present.
- [ ] Tested at 320 CSS px reflow and desktop (1440px).
- [ ] Reviewed the affected interface and states with available tools and browser/device evidence; optional Impeccable findings were addressed when that tool was used.

---

## Premium Mobile Apps (iOS & Android)

> Native apps do NOT strictly follow this guide's web palette/typography guidelines. The priority is the platform's design language (Apple HIG / Material Design 3), ensuring that the app looks "premium native", not like a packaged website.

### iOS/iPadOS (Human Interface Guidelines)

- **Liquid Glass**: apply this guidance only when the target Apple platform and corresponding SDK/API apply. Build with the current Apple SDK and check API availability at runtime before using the material. When available, prefer native APIs and respect HIG, Reduce Transparency, and Increase Contrast. On earlier systems, retain legible conventional surfaces. Do not impose this aesthetic on Windows or Android.
- **Typography**: system font `SF Pro` (Display for large headings, Text for body). Use the system's dynamic styles (Dynamic Type) instead of fixed sizes, to support accessibility:
  - Large Title `34pt`, Title 1 `28pt`, Title 2 `22pt`, Title 3 `20pt`
  - Headline `17pt` (semibold), Body `17pt`, Callout `16pt`, Subhead `15pt`
  - Footnote `13pt`, Caption `12pt`
- **Spacing**: `8pt` grid. Safe screen margins: `16–20pt`. Always respect *safe areas* (notch, Dynamic Island, home indicator) via `safeAreaInsets`.
- **Navigation**: bottom Tab Bar for up to 5 main destinations; top Navigation Bar with a Large Title that collapses while scrolling. Avoid side-drawer navigation (drawer) — it is not an iOS standard.
- **Components**: use native controls (`UIButton`, `UISwitch`, `UISegmentedControl` or equivalent SwiftUI) and `SF Symbols` icons (never custom icons when an equivalent SF Symbol exists).
- **Minimum touch area**: `44x44pt`.
- **Color**: define semantic colors (`label`, `secondaryLabel`, `systemBackground`) that automatically adapt to Light/Dark Mode — never hardcode an absolute color in system elements.
- **Motion**: use native spring curves from UIKit/SwiftUI, duration `0.3–0.35s` for screen transitions, `0.2s` for microinteractions. Use haptics (`UIImpactFeedbackGenerator`) moderately, only for significant actions (confirmation, error, success).
- **Modals and sheets**: use `sheet`/`.presentationDetents` (native bottom sheet) instead of custom modals whenever possible.

### Android (Material Design 3 / Material You)

- **Typography**: `Roboto` (or a brand font registered in the theme) following the M3 type scale: Display, Headline, Title, Body, Label (each with a Large/Medium/Small variant).
- **Spacing**: `8dp` grid, screen margins `16dp` (`24dp` on large screens/tablets).
- **Navigation**: Bottom Navigation Bar (3–5 destinations) on phones; Navigation Rail or Navigation Drawer on tablets/large screens. Top App Bar with title and contextual actions.
- **Components**: use Material 3 components (`FilledButton`, `FAB`, `Card`, `Chip`, `NavigationBar`) with *tonal elevation* (surfaces with layers of color, not just shadow). Consider dynamic color (Material You) when it makes sense for the product.
- **Minimum touch area**: `48x48dp`.
- **Dark theme**: required to support (`isSystemInDarkTheme()` / `DayNight` theme), it is not optional in premium Android products.
- **Motion**: use M3 easing curves (`emphasized`, `standard`), durations `200–500ms` according to the size of the transition (small → fast, full screen → longer). Container transitions (`Container Transform`) for navigation between card and detail.
- **Icons**: `Material Symbols` (outlined by default, filled for active/selected state). For searching and discovering web/app icons, see also [Koboyo Icons](https://koboyo.com/icons).

### Common rules for both platforms

- Never clone 100% of one platform's visual style onto the other (e.g., an iOS-style Tab Bar inside an Android app). Adapt the same brand/palette to each OS's native language.
- Onboarding: maximum 3–4 screens, always with an option to skip.
- Empty, error, and loading states (skeleton screens) are mandatory on every screen with asynchronous data — never leave a blank screen during loading.
- Test on at least 1 small device (e.g., iPhone SE / compact Android) and 1 large device (Pro Max / Android tablet).
- System gestures (swipe back, notification shade) must never be blocked by app overlays.
- The app icon and splash screen follow each platform's official grids (Apple App Icon grid; Android Adaptive Icon with foreground/background layers).

**Quick checklist — Mobile Apps**

- [ ] I used native platform components/navigation (Tab Bar on iOS, Bottom Nav/Rail on Android), not a generic hybrid.
- [ ] Dynamic Type (iOS) / system font scale (Android) work without breaking the layout.
- [ ] Dark Mode implemented and tested on both platforms.
- [ ] Touch areas ≥ 44pt (iOS) / 48dp (Android).
- [ ] Loading, empty, and error states covered on all screens with data.
- [ ] Safe areas respected (notch, system gestures, home indicator).

---

## Premium Desktop Apps (Windows & macOS)

> Like mobile, native desktop apps should follow the operating system's visual language. A "premium" desktop app looks like part of the OS, not a resizable website window.

### Windows (Fluent Design / WinUI 3)

- **Typography**: `Segoe UI Variable` (Display for headings, Text for body), following the Fluent Type Ramp (Display, Title Large, Title, Subtitle, Body Large, Body, Caption).
- **Spacing**: `4px`/`8px` grid. Standard content padding `24px` in main panels.
- **Navigation**: `NavigationView` with a collapsible left rail/panel for apps with multiple sections; custom title bar optional, but always with the standard controls (minimize/maximize/close) in the correct corner.
- **Materials**: use `Mica` (main window) or `Acrylic` (floating panels, flyouts) for subtle translucent depth — do not overuse it, apply it to only 1–2 layers per screen.
- **Components**: native Fluent controls (`Button`, `ToggleSwitch`, `NavigationView`, `InfoBar`), radius `4–8px`, respecting the system's light/dark theme (`Windows.UI.ViewManagement`).
- **Keyboard and accessibility**: 100% navigation via `Tab`/arrows, shortcuts with accelerators (`Alt` underlines the menu letter), tooltips on every control without visible text.
- **Scaling**: test at 100%, 125%, 150%, and 200% Windows scaling (DPI scaling) without cutting off text/icons.

### macOS (Human Interface Guidelines)

- **Liquid Glass**: apply this guidance only when the target Apple platform and corresponding SDK/API apply. Build with the current Apple SDK and check API availability at runtime before using the material. When available, prefer native APIs and respect HIG, Reduce Transparency, and Increase Contrast. On earlier systems, retain legible conventional surfaces. Do not impose this aesthetic on Windows or Android.
- **Typography**: `SF Pro` (Display/Text), respecting system text sizes; support user text-size preferences when applicable.
- **Spacing**: `8pt` grid, generous margins (macOS tends to have more breathing room than Windows). Content padding `20–24pt`.
- **Navigation**: `NSSplitView`/left sidebar + contextual top toolbar; the system menu bar (top of the screen) must contain all of the app's main commands, not only shortcuts hidden in the UI.
- **Window**: respect the native traffic-light controls (close/minimize/maximize), system rounded corners, and support native full screen (`Full Screen` on macOS) and the system's Split View.
- **Materials**: `vibrancy`/blur (`NSVisualEffectView`) in sidebars and floating panels, moderately.
- **Components**: native AppKit/SwiftUI controls for macOS (do not reuse iOS components without adaptation — macOS has different density and affordances, e.g., mouse/trackpad use, hover states exist here unlike on mobile).
- **Keyboard shortcuts**: every relevant command should have a `Cmd+` shortcut, displayed in the menu itself. Full support for keyboard navigation.
- **Accent Color**: respect the accent color chosen by the user in the system when it makes sense for the product, instead of always forcing the brand color on all native controls.

### Common rules for both platforms

- Support window resizing with a defined minimum layout (never allow the UI to break below a reasonable minimum size, e.g. `960x600px`).
- Persist user preferences (window size/position, theme, open panels) between sessions.
- Dark Mode and Light Mode mandatory, following the system preference by default, with an option for manual override.
- Immediate visual feedback for every action (hover, pressed, disabled, loading) — on desktop, hover is a valid and expected affordance, unlike on mobile.
- Contextual menus (right-click) should expose the most-used actions for that element.
- Never use only custom modals when the OS standard (native file dialogs, system alerts) resolves the need with greater familiarity for the user.

**Quick checklist — Desktop Apps**

- [ ] Layout, typography, and materials follow the native language (Fluent on Windows, HIG on macOS), not a generic hybrid between the two.
- [ ] Window is resizable with a defined minimum and no layout breakage.
- [ ] Dark Mode and Light Mode work according to the system preference.
- [ ] 100% keyboard navigation, with shortcuts visible in menus.
- [ ] Hover/pressed/disabled/loading states implemented (desktop has cursor/hover).
- [ ] Tested at least 2 DPI scales (Windows) or 2 screen sizes (macOS).

---

## Sources and References (Base Skills)

- TasteSkill / Anti-Slop: https://github.com/Leonxlnx/taste-skill | https://www.tasteskill.dev/
- Emil Kowalski (Design Engineering / Motion): https://github.com/emilkowalski/skills
- GSAP: https://github.com/greensock/gsap-skills
- ScrollWorld: https://github.com/oso95/scroll-world
- Three.js: https://threejs.org/
- HyperFrames (HTML video and motion): https://hyperframes.heygen.com/ | https://github.com/heygen-com/hyperframes
- Koboyo Icons (Icon Search & Discovery): https://koboyo.com/icons
- Apple Human Interface Guidelines (iOS/macOS): https://developer.apple.com/design/human-interface-guidelines/
- Material Design 3 (Android): https://m3.material.io/
- Microsoft Fluent Design / WinUI 3 (Windows): https://learn.microsoft.com/windows/apps/design/
- shadcn/ui (accessible, composable web components): https://ui.shadcn.com/
- TanStack Charts (data visualization): https://github.com/TanStack/charts
- Cuelume (web interaction sounds): https://cuelume-site.pages.dev/
- Canvas UI (adaptable canvas/WebGL reference; confirm provenance, license, and credits before any reuse): https://canvasui.dev/
- Component source and interaction inspiration (inspect source/dependencies; separate free from premium material): https://21st.dev/ | https://reactbits.dev/ | https://www.fancycomponents.dev/ | https://motion-primitives.com/
- Component and design-system research (comparison, not license assumptions): https://component.gallery/
- Numeric feedback (changing metrics with locale-aware formatting and static/reduced-motion behavior): https://number-flow.barvian.me/
- Pointer enhancement (only when `(hover: hover) and (pointer: fine)`; retain native controls/default cursor and equivalent tap interaction for touch/coarse pointers): https://cursify.ui-layouts.com/
- Typography discovery (verify each font's author, license, weights, and hosting rights): https://uncut.wtf/
- Creative coding and WebGL (semantic fallback, pause/offscreen behavior, performance budget, and asset/operator provenance): https://cables.gl/
- Impeccable (interface auditing and polish): https://impeccable.style/
- Gradient Studio (external procedural gradient exploration with CSS, Tailwind, and SCSS export by Amit Gajare; validate current provenance, reuse terms, output contrast, and performance budgets before adoption): https://gradientsaas.blogspot.com/
- Liquid Glass Design (an independent inspiration gallery, not affiliated with Apple; not a specification or asset library): https://liquidglassdesign.com/
  - Guide to the material, glassmorphism, and web implementation: https://liquidglassdesign.com/what-is-liquid-glass
  - Design and development resources: https://liquidglassdesign.com/resources
  - Rights: the gallery's images and works are distinct from external resources it merely indexes. Consult the [terms](https://liquidglassdesign.com/terms); do not rehost, redistribute, or directly use images or works commercially without permission. For each external prompt or code resource, verify its license, provenance, credits, compatibility, and maintenance individually before use; being indexed does not transfer rights.
- Apple — Adopting Liquid Glass (official guidance for Apple platforms): https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass
- Liquid Glass React, SVG, and Studio (experimental implementations; assess license, compatibility, weight, and maintenance): https://github.com/rdev/liquid-glass-react | https://github.com/shuding/liquid-glass | https://github.com/iyinchao/liquid-glass-studio
- Beautiful Mermaid (technical diagram design and rendering): https://agents.craft.do/mermaid | https://agents.craft.do/mermaid/editor | https://github.com/lukilabs/beautiful-mermaid

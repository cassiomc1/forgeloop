---
name: accessibility-eng
language: en
description: "Practical WCAG 2.2-oriented accessibility protocol for web, mobile, and desktop."
version: "2026.09"
last-reviewed: "2026-10-17"
guide-id: accessibility
completion-evidence:
  - keyboard-navigation
  - focus-management
  - mobile-viewport
---

# Accessibility as a Baseline (A11Y)

> Accessibility instructions adapted from the [A11Y.md](https://github.com/fecarrico/A11Y.md) project (Felipe A. Carriço, MIT license) — a validation protocol and persistent context system for building accessible software from the very first line of code, informed by **WCAG 2.2** and **ISO 9241-171**. It can support evidence for applicable **ADA** or **EAA** obligations, but does not itself determine legal compliance.
> **Related documents**: for visual/UX direction (palettes, typography, motion), see [`design-code-eng.md`](./design-code-eng.md). For automated testing tools (axe-core, Lighthouse, visual regression), see [`test-code-eng.md`](./test-code-eng.md). For code quality/structure, see [`clean-code-eng.md`](./clean-code-eng.md). For HTML-based video and motion, also see [HyperFrames](https://hyperframes.heygen.com). This file is the canonical reference for **accessibility rules** (WCAG, ARIA, keyboard, focus, screen readers) — it does not repeat the content of the others.
> **Tooling policy**: identify the stack, the stage, and the applicable checks; prefer an already available equivalent that produces compatible evidence. Installation or environment changes require authority; reuse scoped authorization already given rather than asking again. If no safe equivalent exists, record the required check as blocked and never claim that it passed. Do not install merely optional resources.

## 0. Principle Zero: accessibility as a pre-condition

- Accessibility is not a feature or an incremental improvement; it is a **pre-condition for use**.
- If a user cannot complete a task due to an accessibility barrier, the feature is considered **technically broken**.
- **Task completion** success is our primary quality metric.

## 0.1. Compliance profiles

This document's default implementation target is **Standard (AA)**. Preserve a stronger existing requirement. If no profile is specified, record AA as a reversible assumption and continue; profile selection alone is not a user-approval gate. Ask only when a genuine blocking obligation cannot be established from project evidence, following Loop Engineering's decision classification. This guide supports WCAG-oriented implementation; it does not certify a product or establish automatic legal compliance. Certification and legal obligations depend on an assessment with defined scope, evidence, and the applicable jurisdiction.

| Profile | Target | Contrast (text / UI) | Min font† | Min target | Use case |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **🛡️ Shield (AAA)** | WCAG AAA | 7:1 / 3:1 (SC 1.4.6, 1.4.11) | 14px† | 44×44px (SC 2.5.5) · 48×48px† advised | Regulated industries, healthcare, gov |
| **⚖️ Standard (AA)** | WCAG AA | 4.5:1 / 3:1 (SC 1.4.3, 1.4.11) | 12px† | 24×24px (SC 2.5.8) · 44×44px† advised | Default. Production apps, public web |
| **🚀 Launchpad (A)** | WCAG A | 3:1† (house floor) | 10px† | 24×24px† | MVPs, internal tools, prototypes |

*† = **House Rule**, non-normative: this standard's ergonomic policy where WCAG requires less — or nothing — at that level. WCAG defines no minimum font size at any level; Level A defines no contrast or target-size criteria; 44–48px targets come from Apple HIG / Material Design. Skipping a **WCAG SC** at your target level MUST be logged in `EXCEPTIONS.md`; relaxing a **House Rule** is a product decision — record it in `A11Y-DECISIONS.md`.*

*The Launchpad profile additionally requires explicit `EXCEPTIONS.md` documentation for each criterion relaxed below AA.*

> ⚠️ The **Launchpad (A)** profile does NOT relax CRITICAL rules (Section 1). Keyboard operability remains a Level A WCAG requirement; semantic HTML and focus management remain mandatory baseline requirements of this guide at every profile.

## 1. Severity and impact model

Evaluate the impact of any design or implementation decision following these levels:

- 🔴 **CRITICAL:** **operation** failures. Blocks task completion or renders the function unusable (e.g., broken keyboard navigation, click on `div`/`span`, modal without focus management). **MUST FIX.**
- 🟠 **HIGH:** **perception and readability** failures. Significantly increases the error or abandonment rate (e.g., insufficient contrast, fonts < 12px in critical text, lack of dynamic feedback). **MUST FIX.**
- 🟡 **MEDIUM:** reduces **efficiency and satisfaction** (e.g., lack of optional keyboard shortcuts, lack of redundant labels). **SHOULD FIX.**
- 🔵 **LOW:** **cosmetic or polish** impact (e.g., micro-interactions without `aria-label`, improvements to focus indicators that are already visible). **MAY FIX.**

## 2. AI agent behavior contract

To ensure technical integrity, any AI interacting with the project **MUST**:

- **No inference:** never infer accessibility without direct evidence in the code or specification.
- **Reference APG:** prioritize patterns from the [WAI-ARIA Authoring Practices Guide (APG)](https://www.w3.org/WAI/ARIA/apg/).
- **Protocol for ambiguity:** follow the *Complex Component Protocol* (Section 5) in case of uncertainty.
- **Explain trade-offs:** explain impacts on Accessibility vs UX vs Business when suggesting changes.
- **UI component interrogation:** before adding `onClick` to non-semantic elements, **propose replacing them** with native elements or full ARIA patterns.
- **Framework adaptation:** examples use React/TSX syntax. On **web** frameworks, transpose patterns to the active project's framework while preserving semantic equivalence.
- **Platform awareness:** identify the target platform **before** applying any technical reference. The normative layer (Principle Zero, POUR, profiles, severity, governance) is platform-agnostic; the technical references are web-first. On native platforms (iOS, Android, React Native, Flutter), read web references as **semantic intent to translate — never implementation to copy**: no ARIA attributes or CSS pixels outside the web.
- **Component reuse:** before generating any interactive component, check for an existing implementation in the project or its design system and extend it. Generating a parallel implementation of an existing pattern is a violation.
- **Decision memory:** choices between equally conformant alternatives (e.g., `alertdialog` vs `dialog` for a destructive confirmation) MUST be recorded in `A11Y-DECISIONS.md` — indexed by pattern, never by screen — and reused in later turns.
- **Mode awareness:** when generating new code, apply all rules proactively. When reviewing existing code, identify violations, classify by severity (Section 1), and suggest targeted fixes — do not propose full rewrites unless the structural damage is CRITICAL. If an `EXCEPTIONS.md` exists, consult it: an entry there is a legitimate dispensation, but an entry past its expiry date MUST be flagged as 🟠 HIGH technical debt.

## 3. Technical standards (POUR framework)

### Perceivable

- **Contrast (SC 1.4.3, 1.4.6, 1.4.11):** at AA, normal text needs at least 4.5:1 and large-scale text at least 3:1; at AAA, those thresholds are 7:1 and 4.5:1. Use WCAG's large-scale definition and applicable exceptions, not an arbitrary heading label. Required non-text component/state and graphic contrast is 3:1 where SC 1.4.11 applies. Do not round a failing ratio up. See the [W3C contrast explanation](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html); prioritize luminance difference beyond hue.
- **Alt text (SC 1.1.1):** informative images **MUST** have a functional description in `alt`; decorative images use `alt=""` or `aria-hidden="true"`.
- **Channels beyond color (SC 1.4.1):** **MUST NOT** convey state, action, response, or information with color alone. Choose the additional channel appropriate to the meaning — visible text, icon, pattern, or programmatic semantics — without imposing the same visual redundancy in every case.
- **Visual patterns:** when differentiation in charts or dashboards depends on color, patterns, labels, textures, or distinct line styles **MUST** enable users to distinguish series without color.

### Operable

- **Keyboard (SC 2.1.1):** all functionality **MUST** be operable without a mouse. Prefer native controls and their built-in keyboard activation; do not add duplicate `onKeyDown` activation to a native button. Custom widgets need the complete applicable keyboard pattern. Where the function depends on the path of movement rather than only its endpoints, document why the WCAG exception applies and provide a practical alternative when possible.
- **Focus (SC 2.4.7, 2.4.11):** focus **MUST** be visible, never entirely obscured by author content (e.g., sticky headers/footers), persistent, and never suppressed via CSS (`outline: none` without fallback is forbidden).
- **SPA routing:** after client-side routing changes, focus **MUST** be managed and properly reset (e.g., sending focus to the top or an `h1`). Avoid lost focus on the screen.
- **Focus order and lifecycle (SC 2.4.3):** the sequential keyboard path **MUST** preserve meaning and operability. Prefer alignment between DOM order, reading order, and visual order when divergence would create confusing or illogical navigation. Avoid positive `tabindex` as a ForgeLoop accessibility best practice; repair the document structure whenever practical. When content is inserted, removed, expanded, collapsed, replaced, or routed, define the next logical focus destination and do not leave focus on a removed or unavailable node.
- **Modal dialog focus contract:** for a modal dialog, choose the initial focus target according to the modal task, move focus inside the modal, keep the inactive background out of the keyboard path, and remember the invoking control. On close, return focus to that control only when it still exists and is available; otherwise move focus to a documented logical fallback, such as the control that owns the resulting content or the newly exposed heading. A trigger removed during the operation is a lifecycle case, not permission to drop focus. Do not apply modal containment rules to non-modal dialogs.
- **Targets (SC 2.5.8):** interactive elements MUST have a minimum size of **24×24 CSS pixels** — the WCAG 2.2 AA floor — except when an equivalent larger target exists, sufficient spacing prevents accidental activation, or the target sits inline in text.
  **House Rule†:** design to **44×44px** (48×48 under Shield), the ergonomic floor shared by Apple HIG and Material Design. Under Shield, 44×44 is normative (SC 2.5.5 AAA).
- **Dragging (SC 2.5.7, AA):** all functionality operated by dragging MUST have a simple pointer alternative that does not require dragging, unless dragging is essential or the behavior is provided by the user agent and has not been modified by the author. The alternative cannot rely only on a path-based gesture.
- **Motion (SC 2.3.3 AAA — enforced as a House Rule† at every profile):** on the web, **MUST** respect `@media (prefers-reduced-motion)`; on native platforms, honor the equivalent system setting or provide a control to reduce non-essential interaction-triggered motion. Avoid heavy state animations during crucial transitions when that preference is active.

### Understandable

- **Labels (SC 1.3.1, 3.3.2):** forms **MUST** have explicit labels connected via `id`/`for`, or via tag wrapping. Avoid reinventions that break native browser events.
- **Predictability:** navigation behavior **MUST** be consistent and interactions must not cause unannounced sudden structural changes.
- **Consistent help (SC 3.2.6, A):** if a help mechanism — human contact, self-help, or automated contact — is repeated on multiple pages within a set, it MUST occur in the same order relative to the other content, unless the user initiated a change. The criterion does not require providing help.
- **Redundant entry (SC 3.3.7, A):** information previously entered by or provided to the user in the same process and required again MUST be auto-populated or available for selection, unless re-entry is essential, necessary for content security, or the information is no longer valid.
- **Accessible authentication — minimum (SC 3.3.8, AA):** do not require a cognitive function test to complete any authentication step without an alternative that does not use one or a mechanism that helps complete it. Supporting password managers and paste reduces memory and transcription burdens; treat only object recognition or user-provided non-text personal content as the listed exceptions.
- **Dynamic feedback (SC 4.1.3):** place the announcement region in the DOM before updating its message. Use `role="status"` or `aria-live="polite"` for non-urgent information and reserve `role="alert"` for urgent errors; test announcements in supported browser and assistive-technology combinations.

### Robust

- **Semantic HTML:** **MUST** prefer native (HTML5) elements over custom ones.
- **Interoperability:** the code **MUST** be compatible with current assistive technologies (ISO 9241-171).

### Composite visuals, code, and status

- When several DOM nodes together communicate one informative visual, expose one meaningful semantic representation and keep decorative fragments out of the accessibility tree. Do not make users traverse borders, connector lines, repeated labels, or illustration layers that add no information.
- A code example **MUST** remain available as text with code semantics. Line-number gutters, syntax decoration, and duplicate visual labels **SHOULD** be hidden from assistive technology when they do not add meaning. A copy or expand action **MUST** be a named, keyboard-operable control; its result belongs in the pre-mounted status region described above rather than only in a changed icon or color.
- A composite presentation is not evidence that its semantics work. Verify the accessible name, role, value, focus path, and status announcement in the supported browser and assistive-technology combinations; automated tree checks cover only part of this behavior.

## 4. Visual directives (strict UI criteria)

These directives combine WCAG requirements where identified and this guide's ergonomic recommendations. They support implementation but do not assure certification or legal compliance.

- **Focus indicator (SC 2.4.13, AAA):** when this criterion is applied, the visible indicator area MUST be at least equivalent to a 2 CSS pixel thick perimeter of the unfocused component or sub-component and have at least 3:1 contrast between the same pixels in focused and unfocused states. Applicable non-text contrast (SC 1.4.11) remains required. A solid 2px outline is a simple way to meet the area requirement, not the only one. (The AA floor is focus visible — SC 2.4.7 — and not entirely obscured by author content — SC 2.4.11.)
- **Typography (House Rule† — WCAG defines no minimum font size at any level):** text **MUST NOT** be smaller than the minimum font size of the active compliance profile (Section 0.1); 12px under the default Standard (AA).
  - *Density exception:* in complex dashboards or secondary metadata (badges), **min 10px** is allowed, provided the contrast is raised to **7:1** as mitigation — a trade-off defined by this standard's policy, not by WCAG — and the relaxation is documented in `EXCEPTIONS.md`.
- **Target spacing and hit area:** see *Section 3 — Targets* for the minimum size rule and exceptions. In dense UIs (e.g., tables), if the visual size is smaller than 44px, the **hit area** (invisible clickable area) **MUST** be expanded via CSS/padding. Adjacent targets **SHOULD** have 8px of spacing.

## 5. Complex component protocol

When identifying an unmapped or highly complex component (e.g., charts, dynamic grids):

1. **Identify:** look for a similar pattern in the [WAI-ARIA APG](https://www.w3.org/WAI/ARIA/apg/).
2. **Validate:** test the pattern in the supported screen-reader/browser combinations when available. If human validation is required and unavailable, record the exact unverified combination and owner action; continue independent work. An AI **MUST NOT** claim an unperformed test or fabricate its results.
3. **Document:** document the expected behavior (keyboard and announcements).
4. **Scale:** record the resolved pattern in `A11Y-DECISIONS.md` so future components reuse it instead of re-deriving it.

## 6. Anti-patterns (Do NOT do this)

- **Actions that are buttons:** use `<button>` for actions unless a documented technical impossibility prevents it. In that case, implement the complete APG button pattern: accessible role and name, appropriate `disabled` state, `aria-pressed` for a toggle when applicable, Enter and Space activation, focus management after activation, and manual assistive-technology testing in supported combinations.
- **Leaked focus traps:** **MUST NOT** create modals without managing focus. When a modal is open:
  - focus MUST move into the modal;
  - focus MUST be trapped within the modal;
  - focus MUST return to the triggering element when it still exists and remains available; otherwise focus MUST move to a documented logical fallback;
  - background content MUST NOT be interactive or reachable via keyboard.
- **Placeholder labels:** **MUST NOT** use `placeholder` as the sole form of label. Crucial instructions (like date formats) **MUST** be visible outside the field to prevent disappearance during filling.
- **ARIA soup:** **MUST NOT** add ARIA where native HTML already provides the semantics — no ARIA is better than bad ARIA. Forbidden by default: redundant roles (`role="button"` on a `<button>`), `aria-label` duplicating visible text (harmless today, but it drifts into an SC 2.5.3 failure when the text changes), and static ARIA states that are never updated (hardcoded `aria-expanded` — an SC 4.1.2 failure). ARIA is the fallback for gaps in native semantics ([First Rule of ARIA Use](https://www.w3.org/TR/using-aria/#rule1)), not a seasoning. The number of ARIA attributes is not evidence of accessibility; validate behavior, semantics, and assistive-technology support.
- **Decoration without an accessible role:** **MUST NOT** add `aria-label` to purely decorative content without an accessible role. Expose an accessible name only for a control, informative image, or other semantics that genuinely need to be announced.
- **Reinventing the complex wheel:** if you need complex components (autocomplete selects, treeviews, datepickers), it is strongly recommended to use robust and accessible libraries (e.g., Headless UI) rather than building proprietary logic from scratch.

## 7. Verification workflow (Definition of Done)

- [ ] **Technical check:** run the project's already configured static accessibility checks and engines such as `Axe` where applicable (see [`test-code-eng.md`](./test-code-eng.md) for tool selection). Do not install a tool solely to satisfy this item; record a required unavailable check as blocked.
- [ ] **Tab order:** `Tab` key path manually validated (ensures absence of frontend dead-ends).
- [ ] **Focus order and lifecycle:** sequential order preserves meaning and operability; DOM, reading, and visual order are aligned where divergence would create confusing or illogical navigation; no positive `tabindex` is used; inserted, removed, expanded, collapsed, replaced, and routed content has a defined logical focus destination; modal dialogs have intentional initial focus and a valid return or fallback target.
- [ ] **Focus (SC 2.4.13, AAA when applicable):** measure the area equivalent to a 2 CSS pixel perimeter and 3:1 contrast between the same pixels in focused and unfocused states; also verify applicable non-text contrast.
- [ ] **Dragging (SC 2.5.7, AA):** test every drag operation with a simple pointer alternative that does not require dragging; document the essentiality or user-agent exception, if any.
- [ ] **Consistent help (SC 3.2.6, A):** compare pages in the same set and confirm repeated help mechanisms retain the same relative order, unless the user initiated a change.
- [ ] **Redundant entry (SC 3.3.7, A):** run multi-step processes and confirm auto-population or selection of previously provided information, or record the applicable exception.
- [ ] **Authentication (SC 3.3.8, AA):** test the whole flow, including MFA, without requiring unassisted memorization, solving, or transcription; confirm password-manager and paste support when they are the chosen mechanism.
- [ ] **User flow and announcements:** manually test dynamic interactions without a mouse. Confirm DOM-present regions announce non-urgent messages through `role="status"` or `aria-live="polite"`, reserve `role="alert"` for urgent errors, and work in supported browser and assistive-technology combinations.
- [ ] **Composite content:** informative multi-node visuals have one meaningful representation, decorative fragments are not announced, code remains readable as text, code controls have names, and copy/result status is announced through the intended region.
- [ ] **Zoom and reflow:** text resizes up to 200% without loss of content or function (SC 1.4.4); content reflows at 320 CSS px width — equivalent to 400% zoom on a 1280px viewport — without two-dimensional scrolling (SC 1.4.10). Preserve flexibility using relative units (rem/em).
- [ ] **Color and perception:** no functional loss when color is unavailable; confirm the additional channel appropriate to the meaning without requiring universal visual redundancy.
- [ ] **Exceptions audit:** `EXCEPTIONS.md` reviewed — every active entry has a risk owner, approver, tracking issue, and expiry; no expired entries left unaddressed.

---

## References

- Original project: https://github.com/fecarrico/A11Y.md (MIT license — Felipe A. Carriço)
- WAI-ARIA Authoring Practices Guide (APG): https://www.w3.org/WAI/ARIA/apg/
- WAI: Understanding SC 2.4.13 Focus Appearance: https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html
- WAI: Understanding SC 2.5.7 Dragging Movements: https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html
- WAI: Understanding SC 3.2.6 Consistent Help: https://www.w3.org/WAI/WCAG22/Understanding/consistent-help.html
- WAI: Understanding SC 3.3.7 Redundant Entry: https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html
- WAI: Understanding SC 3.3.8 Accessible Authentication (Minimum): https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html
- WAI: ARIA22 technique for `role="status"`: https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA22.html
- WAI: ARIA19 technique for `role="alert"`: https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA19.html
- eBay MIND Patterns: https://ebay.github.io/mindpatterns/
- Deque Axe Core: https://github.com/dequelabs/axe-core
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- Optional templates from the original project: accessibility report (`REPORT.md`), exceptions log (`EXCEPTIONS.md`), and decisions log (`A11Y-DECISIONS.md`) — available under `docs/*/templates/` in the original repository.

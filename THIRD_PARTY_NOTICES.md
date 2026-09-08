# Third-Party Notices

This file records provenance and reuse boundaries for the external URLs cited
by the README and guides. A citation is a reference, not a declaration that a
resource is a dependency, bundled material, or available for reuse.

## Collection license

The CLI and validator code are licensed under the MIT License in `LICENSE`.
Original documentation is offered under CC BY 4.0 as described in
`LICENSE-DOCS.md`. Those notices do not apply to adapted or external material;
review the applicable source terms before redistributing such material.

## Adapted and editorial sources

### Elaya Design — Landing Page Design

- Project:
  [elayadesign/ai-design-skills](https://github.com/elayadesign/ai-design-skills).
- Referenced skill:
  [landing-page-design](https://github.com/elayadesign/ai-design-skills/blob/main/skills/landing-page-design/SKILL.md).
- License declared by the upstream repository: MIT.
- Use in this collection: editorial influence for landing-page strategy,
  conversion structure, proof/objection placement, benefit-first copy, and
  incremental section-by-section implementation.
- Boundary: ForgeLoop does not adopt the upstream skill's complete prescriptive
  visual system as a universal rule, and does not import its intake-question
  workflow over ForgeLoop's own decision classification. The strategy concepts
  are paraphrased; if substantial upstream text is copied or adapted in the
  future, preserve the applicable MIT notice and attribution.

### A11Y.md

- Project: [fecarrico/A11Y.md](https://github.com/fecarrico/A11Y.md).
- Identified author: Felipe A. Carriço.
- License identified by the upstream project: MIT.
- Use in this collection: adapted accessibility guidance with attribution
  preserved. Consult the upstream repository for its current license text and
  conditions.

### Clean Code for AI Agents

- Source: [Fabio Akita's article](https://akitaonrails.com/en/2026/04/20/clean-code-for-ai-agents/).
- Use in this collection: editorial influence for an original operational
  synthesis about clean code for AI agents.
- Boundary: consult the source before reusing its text or other material.

## External standards and public documentation

The guides cite standards and public technical documentation, including
[W3C](https://www.w3.org/TR/), Apple, Android, Microsoft, MDN, WHATWG, IETF,
OWASP, and Google documentation. They are technical references for
accessibility, platform behavior, security, performance, testing, and web
standards; their specifications, examples, names, and marks remain governed by
the applicable source.

## Software, package, and tool references

The guides also cite external software, package, framework, registry, and tool
documentation, including [HyperFrames](https://hyperframes.heygen.com/) and
the projects referenced by the design, game, performance, security, and testing
guides. These URLs support evaluation or implementation decisions only. Their
inclusion does not install, bundle, or declare any project as a dependency of
this collection. Check the specific project's current license, terms,
dependencies, version, and distribution conditions before adoption.

### Archify v2.15.0 — vendored documentation renderer

- Project/source: [tt-a1i/archify](https://github.com/tt-a1i/archify/tree/v2.15.0).
- Pinned source commit: `e1ac748f19cf805e44bf74fb93c796662152e273`.
- License declared by the upstream project: MIT; the vendored license is at
  `vendor/archify/v2.15.0/archify/LICENSE`.
- Use in this collection: deterministic generation and validation of the
  typed workflow diagram under `docs/diagrams/`.
- Boundary: this is a documentation-only vendored toolchain, not a ForgeLoop
  runtime dependency. It is not installed from a registry, and its exact pin,
  source, license, and raw-byte tree hashes are recorded in
  `vendor/archify/v2.15.0/PIN.json`; output hashes are recorded in the receipt.
  The vendor integrity check rejects modified, missing, extra, renamed, or
  symlinked files before the renderer is trusted.

### Superpowers

- Project: [Superpowers](https://github.com/obra/superpowers).
- License declared by the upstream project: [MIT](https://github.com/obra/superpowers/blob/main/LICENSE).
- Use in this collection: an editorial and process reference for approved
  workflow boundaries and public discoverability only.
- Boundary: this repository links to Superpowers as a reference; it is not a dependency of `ForgeLoop`, and `ForgeLoop` does not copy, bundle, install, or vendor any Superpowers source, skill, hook, plugin, runtime, dependency, credential, or provider.

### React Doctor

- Project: [millionco/react-doctor](https://github.com/millionco/react-doctor).
- Use in this collection: optional target-project React diagnostic/verifier
  reference.
- Boundary: React Doctor is not a ForgeLoop runtime dependency or universal
  completion gate. ForgeLoop does not automatically download, install, execute,
  configure, or enable its CI/agent integrations. Verify current upstream
  license, CLI, telemetry, network behavior, and dependencies before use.

### Runtime and validator boundary

The distributed CLI and repository validators use Node.js and Python standard
libraries plus the JSON Schema documents shipped in this repository. No
third-party runtime package, agent, provider, plugin, remote trace service, or
model is bundled or installed by `ForgeLoop`. A future host that adds one of
those capabilities must review its own license, dependency tree, credentials,
network behavior, and distribution terms separately.

## Visual, gradient, and gallery references

### Canvas UI and Liquid Glass Design

- References: [Canvas UI](https://canvasui.dev/) and
  [Liquid Glass Design](https://liquidglassdesign.com/).
- Use in this collection: visual-direction references.
- Boundary: check the provenance, author, license, attribution, and other
  conditions of a specific asset, image, prompt, text, code sample, or indexed
  work before reuse.

### Gradient Studio

- Source: [Gradient Studio](https://gradientsaas.blogspot.com/), identified in
  the guide as a project by Amit Gajare.
- Use in this collection: a reference for procedural CSS, Tailwind, and SCSS
  gradient exploration.
- Boundary: confirm the current source terms and the provenance of any output
  or asset before reuse.

## Design reference sites

The following sites are references in the design guide. None is a
dependency of this collection or a blanket permission to reuse code, assets,
fonts, templates, or other material.

- [21st.dev](https://21st.dev/): component and template registry; check the
  terms for the specific author, community contribution, or paid material.
- [AIcss](https://www.aicss.dev/): AI-agent interface pattern and component
  reference; verify current terms, provenance, dependencies, and reuse rights
  for the exact block before copying or redistributing it.
- [React Bits](https://reactbits.dev/): component and motion reference; keep
  public/free material, React Bits Pro, and dependency terms separate.
- [beUI](https://beui.dev/) / source
  [starc007/ui-components](https://github.com/starc007/ui-components):
  React/Next.js animated component reference; verify current terms, license,
  Motion/Tailwind dependencies, and accessibility/reduced-motion behavior before
  adoption.
- [Transition Kit](https://transition-kit.space/) / source
  [AbdullahMukadam/Transition-kit](https://github.com/AbdullahMukadam/Transition-kit):
  CSS-first page/theme transition reference around the View Transitions API;
  verify current terms, browser compatibility, and fallback behavior before
  adoption.
- [Fancy Components](https://www.fancycomponents.dev/): component reference;
  verify the linked source license and each dependency before reuse.
- [Motion Primitives](https://motion-primitives.com/): motion reference; keep
  documented open-source material, the Pro offering, and dependency terms
  separate.
- [Component Gallery](https://component.gallery/): comparison catalog; the
  design systems and examples it indexes retain their own terms.
- [NumberFlow](https://number-flow.barvian.me/): external software reference;
  verify the upstream license and dependency terms before adoption.
- [Cursify](https://cursify.ui-layouts.com/): pointer-enhancement reference;
  verify the component, source, and dependency terms before adoption.
- [UNCUT](https://uncut.wtf/): typography-discovery catalog; a listing is not a
  font license, so check the exact author, files, weights, hosting, and
  redistribution rights.
- [cables.gl](https://cables.gl/): creative-coding and WebGL reference; check
  the tool, exported patches or operators, code, and third-party assets
  separately before distribution.
- [VibePrompt](https://vibeprompts.dev/): optional UI-pattern and prompt
  reference for comparing common page/component structures. ForgeLoop does not
  bundle its prompts or snippets and does not make Tailwind a dependency.
  Verify the site's current terms and the provenance/license of any prompt,
  snippet, or substantial material before copying or redistributing it.
- [Kitbitz](https://kitbitz.art/): optional illustration and visual-asset
  reference. ForgeLoop does not bundle, mirror, or download its assets. Verify
  the current first-party license and asset-specific terms before use; record
  attribution when required and preserve asset provenance in the target
  project. A catalog listing is not a permanent license statement.
- [DesEngs](https://desengs.com/) / source
  [remvze/desengs](https://github.com/remvze/desengs):
  curated meta-directory for design-engineering resources. The upstream
  DesEngs repository currently declares MIT for its own software/material
  covered by that license. ForgeLoop uses the site only as an optional discovery
  index and does not bundle or mirror its catalog. Each external resource linked
  by DesEngs retains its own license, terms, authorship, dependencies, and
  premium/free boundary; inspect the exact upstream source before adoption.

### Qwen-MM-Plugins

- Project: [QwenLM/Qwen-MM-Plugins](https://github.com/QwenLM/Qwen-MM-Plugins).
- License declared by the upstream project: [Apache-2.0](https://github.com/QwenLM/Qwen-MM-Plugins/blob/main/LICENSE).
- Use in this collection: an optional reference for task-scoped multimodal capabilities that an active agent may install through its supported harness when a task requires them.
- Boundary: this repository links to the project but does not copy, vendor, or relicense its source, skills, MCP servers, models, or dependencies. Verify current upstream terms, dependencies, service costs, and harness instructions before installing or redistributing anything.

## Fonts, assets, and premium content

Fonts named in the design guide are examples only and are not bundled by this
collection. Do not host, redistribute, or infer rights for a font, image,
template, prompt, audio asset, or other premium material from a citation or
catalog listing. Verify the exact resource's author, license, attribution,
hosting, and current terms before use.

## Taste Skill

The contextual frontend taste guide is informed by Taste Skill:

- Taste Skill, Copyright (c) 2026 Leonxlnx, MIT License.
- Source: <https://github.com/leonxlnx/taste-skill>

ForgeLoop includes a short, adapted guide under `ENG/taste-frontend-eng.md`.
It does not vendor upstream runtime code, depend on its repository at runtime,
or make its prescriptive examples universal.

## Runtime dependencies with upstream notices

### Microsoft tgrep

- Project: [microsoft/tgrep](https://github.com/microsoft/tgrep).
- License declared by the upstream project: MIT.
- Use in this collection: the initially pinned native engine behind the
  ForgeLoop Repository Index and normalized Repository Search contract.
- Boundary: ForgeLoop verifies the exact release asset checksum and version
  before managed installation. The executable is provisioned outside the npm
  package; future redistribution must continue to include the MIT notice and
  verify any changed upstream asset.

### Model Context Protocol SDK (MCP package only)

- Packages: `@modelcontextprotocol/server` and `@modelcontextprotocol/client`
  (test/smoke only), used by `integrations/mcp`. Published from the canonical
  upstream repository:
  [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk).
- License declared by the upstream project: MIT.
- Use in this collection: official SDK transport/server primitives for the
  local stdio ForgeLoop MCP adapter.
- Boundary: the ForgeLoop core package (`@cassiomc1/forgeloop`) has no
  dependency on the MCP SDK; the SDK ships only inside
  `@cassiomc1/forgeloop-mcp`. Review upstream terms before redistribution.

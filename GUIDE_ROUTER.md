# Guide Router

> Select technical context for [Loop Engineering](./LOOP_ENGINEERING.md). This file decides **which** guides to consult; each guide defines **how** to work in its domain.

## Selection contract

1. Read the request, the nearest repository instructions, and [PROJECT_PROFILE.md](./PROJECT_PROFILE.md).
2. Confirm the actual stack from manifests and configuration.
3. Identify the surfaces that will change.
4. Activate the primary guide and every complementary guide required by the risks.
5. Locate relevant headings and keywords before loading a long guide.
6. Load only the sections needed for the current task.
7. Reassess the route if the scope changes during execution.

Activate a guide from a combination of intent, files, and risk. A word in documentation, a lockfile, or an example does not by itself prove a stack or activate a guide.

Useful questions:

- What behavior or artifact will change?
- Is there a human interface, sensitive data, critical path, or external system?
- Which files will change?
- Which checks will demonstrate the result?
- Did the user explicitly request a standard or domain?

## Canonical catalog

Guide frontmatter may declare protocol metadata in addition to its human
description:

```yaml
guide-id: premium
requires-gates:
  - design
completion-evidence:
  - build
```

`requires-gates` contributes to `forgeloop preflight`; each
`completion-evidence` identifier contributes to completion coverage. Metadata
is descriptive and local: it does not authorize tools, remote services, or
project commands.

| ID | Guide | Responsibility |
| --- | --- | --- |
| `premium` | [Premium websites](./ENG/premium-sites-studio-eng.md) | End-to-end delivery of high-quality websites and web experiences |
| `clean` | [Clean code](./ENG/clean-code-eng.md) | Structure, readability, observability, and maintenance |
| `test` | [Testing](./ENG/test-code-eng.md) | Risk-driven verification strategy and tooling |
| `security` | [Security](./ENG/sec-code-eng.md) | Web, API, mobile, desktop, data, and supply-chain security |
| `design` | [Design](./ENG/design-code-eng.md) | Visual direction, UX, motion, and perceived performance |
| `taste` | [Taste frontend](./ENG/taste-frontend-eng.md) | Contextual design-read, anti-slop, and visual pre-flight for premium frontend work |
| `performance` | [Performance](./ENG/perf-code-eng.md) | Measurement, diagnosis, budgets, and optimization |
| `accessibility` | [Accessibility](./ENG/accessibility-eng.md) | WCAG, keyboard access, focus, semantics, and assistive technology |
| `games` | [Web games](./ENG/games-code-design-web-eng.md) | Architecture and operation of 2D, 3D, and procedural web games |
| `documentation` | [Documentation quality](./ENG/documentation-quality-eng.md) | Accuracy, architecture, freshness, accessibility, and verifiable technical documentation |
| `flutter` | [Flutter application engineering](./ENG/flutter-development-eng.md) | Architecture, implementation, testing, performance, accessibility, platform integration, and release of production Flutter applications |
| `dotnet` | [.NET and ASP.NET Core development engineering](./ENG/dotnet-aspnetcore-development-eng.md) | Architecture, implementation, testing, performance, security, data access, hosting, observability, and release of production .NET applications |
| `nodejs` | [Node.js backend development engineering](./ENG/nodejs-backend-development-eng.md) | Architecture, implementation, testing, security, performance, observability, and release of production Node.js services and workers |
| `rust` | [Rust development engineering](./ENG/rust-development-eng.md) | Architecture, implementation, testing, security, performance, reproducibility, and release of production Rust applications, services, libraries, and workers |

## Domain rules

### `clean` — code and structure

**Activate when:** creating or modifying code, fixing a bug, refactoring, changing architecture, reviewing quality, or producing development instructions.

**Do not activate merely because:** documentation contains code snippets but no software behavior changes.

**Usually combine with:** `test`; add `security`, `performance`, `design`, or `accessibility` according to the affected surface.

Locate relevant sections first:

```bash
rg -n '^## (Style|Comments|Tests|Dependencies|Structure|Logging|Debugging)|responsibility|typing|errors' ENG/clean-code-eng.md
```

**Expected evidence:** a small readable diff, coherent interfaces, error handling, tests, and official checks.

### `test` — verification strategy

**Activate when:** behavior changes, a bug is fixed, an integration or release changes, executable configuration changes, or QA is requested.

**Do not activate merely because:** prose names a testing framework without executing or changing software.

**Usually combine with:** every guide that produces behavior; use the domain to choose test levels.

```bash
rg -n '^## |risk|regression|unit|integration|E2E|accessibility|load|CI' ENG/test-code-eng.md
```

**Expected evidence:** a RED reproduction when applicable, a GREEN targeted check, and proportional regression coverage.

### `security` — trust and external surfaces

**Activate when:** authentication, authorization, untrusted input, APIs, databases, uploads, secrets, dependencies, CI/CD, mobile or desktop platforms, cryptography, personal data, payments, or publication are involved.

**Do not activate merely because:** a reference mentions OWASP or security without changing a trust surface.

**Usually combine with:** `clean` and `test`; add `performance` when controls affect latency or availability.

```bash
rg -n '^## |authentication|authorization|upload|SSRF|CSP|OAuth|JWT|secrets|supply chain|mobile|desktop' ENG/sec-code-eng.md
```

**Expected evidence:** explicit trust boundaries, server-side validation, least privilege, no secrets in Git, and negative tests.

### `performance` — measurable cost

**Activate when:** the request involves latency, scale, a critical path, rendering, bundles, databases, networking, memory, battery, load, Web Vitals, FPS, or a budget.

**Do not activate merely because:** every task could theoretically be faster. Avoid speculative optimization without a risk or metric.

**Usually combine with:** the main domain guide and `test`.

```bash
rg -n '^## |baseline|budget|p75|p95|Web Vitals|profil|database|mobile|desktop|load' ENG/perf-code-eng.md
```

**Expected evidence:** a baseline, a hypothesis, comparable before-and-after measurement, and no functional regression.

### `design` — interface and experience

**Activate when:** creating, redesigning, or reviewing UI, layout, components, visual identity, motion, responsive behavior, mobile or desktop apps, or premium experiences.

**Do not activate merely because:** an interface-free API uses the word "design" in architecture documentation.

**Usually combine with:** `accessibility`, `test`, and `performance`; use `security` for forms, authentication, and external content.

```bash
rg -n '^## |palette|typography|layout|mobile|motion|components|checklist' ENG/design-code-eng.md
```

**Expected evidence:** complete states, coherent hierarchy, responsive behavior, visual validation, and fallbacks for optional enhancements.

### `accessibility` — inclusive completion

**Activate when:** work affects an interface, audiovisual content, navigation, forms, interactive components, games, mobile or desktop apps, or task completion.

**Do not activate merely because:** an internal service transports normalized data and changes neither user-facing content nor a consumed contract.

**Usually combine with:** `design` and `test`; add the interface domain guide.

```bash
rg -n '^## |WCAG|keyboard|focus|contrast|ARIA|screen reader|motion|Definition of Done' ENG/accessibility-eng.md
```

**Expected evidence:** semantics, keyboard operation, focus, contrast, zoom and reflow, reduced motion, and compatible manual or automated tests.

### `premium` — complete website production

**Activate when:** creating or comprehensively reviewing a landing page, institutional site, portfolio, campaign, or web experience that requires studio-quality delivery.

**Do not activate when:** the task is an isolated component, an API, or technical maintenance without a complete website process.

**Usually combine with:** `design`, `accessibility`, `clean`, `test`, `security`, and `performance`.

```bash
rg -n '^## [0-9]+\.|brief|content|direction|design system|implementation|quality|launch' ENG/premium-sites-studio-eng.md
```

**Expected evidence:** approved strategy, content, direction, production, quality, launch, and operation gates.

### `taste` — contextual frontend taste review

**Activate when:** the router selects a premium marketing site, landing page,
portfolio, brand-heavy surface, or high-finish redesign with a meaningful
visual composition.

**Do not activate when:** the task is backend, infrastructure, data, CLI,
documentation, or a nonvisual bug. A UI word in a technical description is not
enough context.

Use this guide as an advisory review. It does not add a user-approval gate,
require GSAP or a static-site approach, prescribe fonts/layouts, or override
accessibility, performance, security, or product evidence.

```bash
rg -n '^## (Design Read|Design Dials|Anti-Slop Checks|Typography Quality|Layout Composition|Motion Restraint|Responsive Composition|Design-System Selection|Visual Pre-Flight|Redesign Audit)' ENG/taste-frontend-eng.md
```

**Expected evidence:** a contextual design read, intentional dials, bounded
anti-slop review, and only the visual/accessibility/performance checks that are
in scope. Mark unavailable visual evidence `NOT_VERIFIED`.

### `games` — web game architecture and operation

**Activate when:** designing, implementing, testing, or operating a 2D or 3D web game, procedural generation, game loops, assets, input, multiplayer, or game distribution.

**Do not activate when:** "game" means lightweight gamification in an ordinary interface; use the UI and code guides instead.

**Usually combine with:** `clean`, `test`, `security`, `performance`, and `accessibility`; add `design` for UI and visual direction.

```bash
rg -n '^## |game loop|procedural|input|assets|audio|multiplayer|WASM|PWA|CI/CD' ENG/games-code-design-web-eng.md
```

**Expected evidence:** verifiable simulation, determinism when promised, capability fallbacks, budgets, accessibility, and release gates.

### `documentation` — technical documentation quality

**Activate when:** creating, modifying, reviewing, or restructuring README files, tutorials, how-to guides, technical reference, API/CLI/configuration documentation, architecture documentation, troubleshooting, migration guides, runbooks, or other project documentation; also activate when an implementation change explicitly affects a documentation surface.

**Do not activate merely because:** source code contains comments, a task description mentions documentation in passing, or code examples appear in an unrelated domain document without changing project documentation.

**Usually combine with:** the domain whose behavior is documented. Add `test` when commands, examples, generated docs, or executable references need verification; add `security` for authentication, authorization, secrets, privacy, or sensitive examples; use `accessibility` when the published documentation surface itself has accessibility requirements.

```bash
rg -n '^## |accuracy|completeness|Diátaxis|tutorial|how-to|reference|explanation|README|API|CLI|configuration|architecture|freshness|accessibility|Definition of Done' ENG/documentation-quality-eng.md
```

**Expected evidence:** documentation purpose and audience are clear, factual claims are cross-checked against canonical project sources, changed documentation surfaces are complete, relevant examples/links/builds are validated when available, and unavailable required checks are recorded as `NOT_VERIFIED`.

### `flutter` — Flutter application engineering

**Activate when:** a confirmed project root has a structurally parsed `pubspec.yaml` with `dependencies.flutter.sdk: flutter`, and the task scope intersects that root. Once the root is confirmed, every claim under it matches, including lockfiles, localization/configuration files, source, tooling, and native platform configuration; confirmed nested project roots remain isolated. The guide then provides the Flutter-specific architecture, implementation, testing, performance, accessibility, platform integration, and release context.

**Do not activate merely because:** prose, Markdown, a lockfile, a transitive package name, an arbitrary directory name, a hosted package named `flutter`, or an unrelated monorepo project mentions Flutter. `flutter_test` and platform/source signals are supporting evidence only; they cannot replace the primary SDK dependency signal.

**Usually combine with:** `clean` and `test`; add `design`, `accessibility`, `security`, or `performance` when the affected surface or risk requires them.

The route command obtains this evidence from `src/core/project-detection.js`. It walks bounded, non-symlinked project manifests, parses dependency structure, and matches task write claims against confirmed project roots. An unscoped route can inspect all detected projects; an explicit claim that does not reach a Flutter project produces `NO_FLUTTER_SCOPE_MATCH` and does not activate the guide. Documentation and UI-copy exclusions remain routing decisions, not project-detection heuristics.

```bash
rg -n '^## |architecture|testing|performance|accessibility|platform|release|Flutter' ENG/flutter-development-eng.md
```

**Expected evidence:** a confirmed affected Flutter project, a scoped route, platform-appropriate tests, measured performance or accessibility checks when relevant, and honest `NOT_VERIFIED` reporting for unavailable Flutter tooling.

### `dotnet` — .NET and ASP.NET Core development engineering

**Activate when:** a confirmed project root has a structurally parsed SDK-style `*.csproj`, `*.fsproj`, or `*.vbproj` using one of the supported SDKs below, and the task scope intersects that root:

- `Microsoft.NET.Sdk`, `Microsoft.NET.Sdk.Web`, `Microsoft.NET.Sdk.Worker`,
  `Microsoft.NET.Sdk.Razor`, or `Microsoft.NET.Sdk.BlazorWebAssembly`;
- `Aspire.AppHost.Sdk` or `MSTest.Sdk`;
- the equivalent `<Sdk Name="..." />` declaration in the project XML.

Web, Razor, or Blazor SDKs, or `FrameworkReference Include="Microsoft.AspNetCore.App"`, confirm ASP.NET Core context. A `Volo.Abp.*` package reference adds the ABP overlay while retaining the single `dotnet` guide ID.

**Do not activate merely because:** prose, Markdown, source snippets, a Dockerfile, a lockfile, an arbitrary directory name, a package cache, or an unrelated monorepo project mentions .NET, ASP.NET Core, or ABP. A malformed, oversized, non-SDK-style, or unsupported project file fails closed. Shared `Directory.Build.*`, `Directory.Packages.props`, `global.json`, and NuGet files apply only to descendant .NET projects in their directory scope; `.sln`/`.slnx` claims use exact solution membership.

**Usually combine with:** `clean` and `test`; add `security` for trust-boundary or dependency changes, `performance` for measured cost or critical paths, `documentation` for technical documentation, and the UI guides for Razor/Blazor or other user-facing changes.

The route command obtains this evidence from `src/core/project-detection.js`. It walks bounded, non-symlinked project manifests, parses direct XML SDK/target/reference structure without evaluating the full MSBuild graph, and matches task claims against project roots, shared configuration scope, or exact solution membership. ASP.NET Core and ABP are routing reasons on the specialist guide, not additional guide IDs.

Project discovery is fail-closed and bounded by default: at most 256 project
manifests, 64 solution files, 1 MiB per manifest, 256 supporting source files
with 512 KiB per source file, 4,096 visited directories, and 20,000 visited
entries. Symlinks and common generated/vendor directories are skipped. When a
budget is exhausted, the detector does not claim reliable project evidence.
These limits bound discovery work; they do not cap task ownership discovery.

The .NET routing reasons are `PROJECT_DOTNET_SDK_PROJECT`,
`PROJECT_DOTNET_BASELINE`, `PROJECT_ASPNETCORE_CONFIRMED`, and
`PROJECT_ABP_CONFIRMED`. The corresponding exclusions are
`NO_DOTNET_PROJECT_EVIDENCE`, `NO_DOTNET_SCOPE_MATCH`,
`NO_DOTNET_PRIMARY_EVIDENCE`, and `NO_DOTNET_EXECUTABLE_WORK`. The route
validator also requires `aspnetcore` and `abp` project-evidence overlays to be
accompanied by `dotnet`; it rejects standalone overlays rather than creating a
second specialist guide.

```bash
rg -n '^## |architecture|dependency injection|middleware|endpoints|configuration|authentication|authorization|EF Core|testing|WebApplicationFactory|workers|Blazor|ABP|publish|troubleshooting' ENG/dotnet-aspnetcore-development-eng.md
```

**Expected evidence:** a confirmed affected .NET project, a scoped route, compatible SDK/runtime decisions, focused and integration checks for changed boundaries, and honest `NOT_VERIFIED` reporting for unavailable .NET tooling or runtime environments.

### `nodejs` — Node.js backend development engineering

**Activate when:** a confirmed project root has a valid `package.json` with an
allowlisted runtime backend dependency (`express`, `fastify`, `@nestjs/core`,
`koa`, or `@hapi/hapi`), a direct `node`/`node.exe` runtime script, or bounded
source evidence importing or re-exporting a Node server/network built-in such
as `node:http`, `node:https`, `node:http2`, `node:net`, `node:tls`, or `node:dgram`
from a plausible runtime application surface, and the task scope intersects
that root.

**Do not activate merely because:** a `package.json`, `engines.node`, `type`,
`packageManager`, lockfile, `.nvmrc`, `.node-version`, `@types/node`,
TypeScript, `tsx`, Dockerfile, CI setup, frontend dependency, Next-only
dependency, prose mention, or development-only framework dependency exists.
Malformed or oversized manifests fail closed. The detector never executes
scripts or source code, follows symlinks, installs packages, or accesses the
network.

**Usually combine with:** `clean` and `test`; add `security` for input,
authentication, authorization, dependency, secret, external-service, or
publication risks; add `performance` for measured latency, throughput,
memory, event-loop, queue, or database work; add `documentation` when the API,
configuration, or operational contract changes.

The route command obtains this evidence from
`src/core/project-detection.js`. It walks bounded, non-symlinked manifests and
source files, isolates nested project roots across Flutter, .NET, Node.js, and
Rust,
recognizes workspace-root and shared lockfile scope, and preserves
`projectEvidence.schemaVersion: 1`. Node source evidence ignores comments,
template text, `import type`/`export type`, inline type-only specifiers,
declaration files, tooling/configuration filenames, and non-runtime directories
such as tests, fixtures, examples, docs, build output, scripts, tools, codegen,
and package caches. A mixed declaration counts only when a runtime value
specifier is safely recognized; unsupported complex declarations fail closed.
Runtime re-exports with a value specifier are included because the specialist
covers Node.js server/runtime library surfaces as well as services and workers.
Node.js execution used only for build, test, or configuration tooling is not
sufficient backend/runtime evidence. Mixed Flutter/.NET/Node repositories
retain each confirmed framework; claims and shared files stop at the same
nested ownership boundaries. A claim that does not reach a confirmed Node
project produces `NO_NODEJS_SCOPE_MATCH` or leaves the specialist excluded.

```bash
rg -n '^## |activation|runtime|architecture|Express|Fastify|NestJS|security|testing|performance|deployment|Definition of Done' ENG/nodejs-backend-development-eng.md
```

**Expected evidence:** a confirmed affected Node project, a scoped route,
validated inputs and configuration, bounded trust and resource controls,
focused plus integration/adversarial checks, observable failure and shutdown
behavior, and honest `NOT_VERIFIED` reporting for unavailable Node tooling.

### `rust` — Rust development engineering

**Activate when:** a confirmed project root has a bounded, structurally parsed
`Cargo.toml` with a valid `[package]` and/or `[workspace]` table, and the task
scope intersects that root. A package workspace and a virtual workspace are
both valid when the virtual workspace has at least one resolvable package
member; an empty or unresolved virtual workspace fails closed. A virtual
workspace contributes its confirmed package members as public project roots. A
package workspace may contain both tables, but `package.workspace` is mutually
exclusive with `[workspace]` and associates a package with another workspace.

**Do not activate merely because:** a `.rs` file, `Cargo.lock`,
`rust-toolchain`/`rust-toolchain.toml`, `.cargo/config.toml`, rustfmt or Clippy
configuration, a Tokio/Axum/Actix/other dependency name, a Dockerfile, CI
toolchain setup, or repository prose exists. `target/` and `vendor/` are
ignored. Build scripts, proc-macro crates, generated code, and native tooling
remain runtime/build context rather than a replacement for Cargo identity.

Cargo inheritance such as `package.edition.workspace = true` and
`package.rust-version.workspace = true` is accepted as package metadata;
`[workspace.package]` may enrich supporting signals. Workspace membership uses
only known discovered manifests and bounded `members`/`exclude` patterns: `*`
and `?` stay within one path segment, `**` may cross segments, and absolute or
parent-directory escape paths are rejected. Local package `path` dependencies
and explicitly used inherited workspace dependencies can associate a known
package with a workspace, while `[workspace.dependencies]` declarations alone
do not create active dependency edges. A valid `package.workspace` association
may point to a known workspace outside the package's directory subtree, but not
outside the repository; no additional traversal is triggered.

**Usually combine with:** `clean` and `test`; add `security` for unsafe/FFI,
untrusted input, secrets, dependencies, external services, or publication;
add `performance` for measured CPU, memory, latency, allocation, executor,
queue, or I/O work; add `documentation` when public APIs, configuration, or
operational contracts change.

The route command obtains this evidence from
`src/core/project-detection.js` and the conservative TOML recognizer in
`src/core/rust-project.js`. It performs bounded, non-symlinked discovery and
manifest reads, never runs Cargo or source code, and treats `Cargo.toml` as
primary evidence while edition, MSRV, resolver, features, dependencies,
lockfiles, toolchains, and configuration are supporting signals. Explicit
workspace members/excludes, nested workspaces, and confirmed Flutter, .NET,
Node.js, and Rust roots constrain claims and shared-file ownership. `Cargo.lock`
and configuration files apply only to their owning package/workspace scope; a
parent cannot absorb a child's shared file merely because its path is a
descendant.

Rust has no Node-style LTS channel. Keep active toolchain, MSRV
(`package.rust-version`), edition, and compilation target separate, and use
version-matched official Rust and Cargo documentation. Current stable is a
dated observation, not a universal migration target.

```bash
rg -n '^## |Cargo|toolchain|MSRV|edition|ownership|async|unsafe|FFI|security|testing|release|Definition of Done' ENG/rust-development-eng.md
```

**Expected evidence:** a confirmed affected Cargo package or workspace, a
scoped route, compatible toolchain/MSRV/edition/target decisions, focused plus
workspace checks, explicit resource and trust controls, and honest
`NOT_VERIFIED` reporting for unavailable Rust targets or toolchains.

## Work-type matrix

| Work | Primary guide | Common complements | Exclude when |
| --- | --- | --- | --- |
| Documentation change | `documentation` | Relevant domain; `test` for executable examples/commands; `security` for trust-sensitive docs | No documentation artifact or documented contract changes |
| UI copy or microcopy | `design` | `accessibility` | Users cannot observe the change |
| Code or bug without UI | `clean` | `test`; risk may add `security` or `performance` | The surface is unchanged |
| Backend, API, or data | `clean` | `test`, `security`; `performance` for a critical path | That layer does not exist |
| Web, mobile, or desktop UI | `design` | `accessibility`, `clean`, `test`; risk defines the rest | Users cannot observe the change |
| Flutter application | `flutter` | `clean`, `test`; add `design`, `accessibility`, `security`, or `performance` as applicable | No primary Flutter SDK dependency in the affected project scope |
| .NET / ASP.NET Core application | `dotnet` | `clean`, `test`; add `security`, `performance`, `documentation`, or UI guides as applicable | No supported SDK-style .NET project in the affected project scope |
| Node.js backend, API, worker, or server runtime | `nodejs` | `clean`, `test`; add `security`, `performance`, or `documentation` as applicable | No primary Node.js backend/runtime evidence in the affected project scope |
| Rust application, service, library, or worker | `rust` | `clean`, `test`; add `security`, `performance`, or `documentation` as applicable | No valid Cargo package/workspace in the affected project scope |
| Complete website | `premium` | `design`, `accessibility`, `clean`, `test`, `security`, `performance` | The deliverable is not a complete site |
| Web game | `games` | `clean`, `test`, `security`, `performance`, `accessibility`; `design` with UI | The product is not a game |
| HTML video or motion | `design` | `accessibility`, `performance`, `test`, `security` | There is no audiovisual composition |
| Infrastructure or CI/CD | `security` | `test`; `performance` when availability or cost changes | The change is non-executable prose |

HyperFrames is optional and may be used only when requested or already available and appropriate. A reference to it does not authorize installation.

## Deterministic route contract

The active agent may classify natural language, but it must pass declared
signals to the deterministic evaluator in `src/core/router.js`. The evaluator
does not parse natural language, call a model, or infer a stack from a word in
the repository. `runRoute` may also pass `projectEvidence` from
`src/core/project-detection.js`; that evidence is produced by structural
manifest parsing and scope intersection, not by prose or model confidence.

The first routing contract is versioned as `schemaVersion: 1`. It accepts:

- `workType`: `documentation`, `ui-copy`, `code`, `bug`, `refactor`, `backend`, `api`,
  `api-auth`, `complete-website`, `mobile-ui`, `web-game`, `html-video`,
  `infrastructure`, `security-review`, `performance`, `accessibility`,
  `test-only`, `dependency-update`, or `release`;
- `surfaces`: `ui`, `forms`, `api`, `auth`, `data`, `database`, `mobile`,
  `desktop`, `game`, `video`, `ci`, `config`, `critical-path`, or `documentation`;
- `risks`: `untrusted-input`, `personal-data`, `secrets`, `external-service`,
  `publication`, `critical-path`, `performance`, `accessibility`, `destructive`,
  `irreversible`, `production-deployment`, `credentials`, `payment`, or
  `migration`;
- `platforms`: `web`, `mobile`, `desktop`, `server`, `ci`, or
  `cross-platform`;
- optional boolean `behaviorChange` and `executableChange` signals.
- optional `projectEvidence` with a schema version, a scope result, detected
  framework IDs, affected project roots, primary signals, and supporting
  signals. The current framework IDs are `flutter`, `dotnet`, `aspnetcore`,
  `abp`, `nodejs`, and `rust`. Flutter's primary signal is an affected
  `dependencies.flutter.sdk: flutter` entry in `pubspec.yaml`. .NET's primary
  signal is a supported SDK-style project manifest; ASP.NET Core and ABP are
  structural overlays. Node.js primary signals are an allowlisted runtime
  dependency, direct Node runtime script, or narrow server-builtin source
  import in a valid `package.json` project. Rust's primary signals are a valid
  structural `[package]` and/or `[workspace]` table in `Cargo.toml`; Rust
  source, lockfiles, toolchain files, and dependencies are supporting context.

Rule precedence is deterministic: the work type establishes the primary
closure; affected surfaces add mandatory complements; risks add security,
performance, or accessibility; executable/behavior changes add clean and
test; required rules win over optional exclusions; and the evaluator preserves
canonical insertion order. A matching Flutter project adds `flutter` plus the
  `clean`/`test` baseline before ordinary work-type complements; documentation
  and UI-copy work do not activate the specialist. A matching .NET project adds
  `dotnet` plus the `clean`/`test` baseline and records ASP.NET Core/ABP reasons
  on that guide. A matching Node.js project adds `nodejs` plus the `clean`/`test`
  baseline and records `PROJECT_NODEJS_CONFIRMED`; dependency, direct-script,
  and server-runtime reasons are optional enrichments when the corresponding
  primary signals are present. A matching Rust project adds `rust` plus the
  `clean`/`test` baseline and records `PROJECT_RUST_CONFIRMED`; package and
  workspace roles are optional reason enrichments. The public `frameworks` field remains the
  authority for the confirmed framework; the router does not reverse-engineer
  Node selection from private signal substrings. Unknown or duplicate signals
  fail with a routing error.

Every selected guide has stable reason codes such as
`WORK_COMPLETE_WEBSITE`, `SURFACE_UI`, `RISK_UNTRUSTED_INPUT`, and
`CHANGE_EXECUTABLE_CONFIG`. Exclusions use stable codes such as
`NO_TRUST_BOUNDARY`, `NO_MEASURABLE_PERFORMANCE_RISK`, and
  `NO_DOCUMENTATION_SURFACE`. Flutter uses
  `PROJECT_FLUTTER_SDK_DEPENDENCY`, `PROJECT_FLUTTER_BASELINE`,
  `NO_FLUTTER_PRIMARY_EVIDENCE`, `NO_FLUTTER_SCOPE_MATCH`, and
  `NO_FLUTTER_EXECUTABLE_WORK`.
  Node.js uses `PROJECT_NODEJS_CONFIRMED`,
  `PROJECT_NODEJS_BACKEND_FRAMEWORK`,
  `PROJECT_NODEJS_RUNTIME_SCRIPT`, `PROJECT_NODEJS_SERVER_RUNTIME`,
  `PROJECT_NODEJS_BASELINE`, `NO_NODEJS_PRIMARY_EVIDENCE`,
  `NO_NODEJS_SCOPE_MATCH`, and `NO_NODEJS_EXECUTABLE_WORK`. Rust uses
  `PROJECT_RUST_CONFIRMED`, `PROJECT_RUST_CARGO_PACKAGE`,
  `PROJECT_RUST_CARGO_WORKSPACE`, `PROJECT_RUST_BASELINE`,
  `NO_RUST_PRIMARY_EVIDENCE`, `NO_RUST_SCOPE_MATCH`, and
  `NO_RUST_EXECUTABLE_WORK`.

The .NET specialist uses `PROJECT_DOTNET_SDK_PROJECT` and
`PROJECT_DOTNET_BASELINE`; confirmed ASP.NET Core and ABP overlays add
`PROJECT_ASPNETCORE_CONFIRMED` and `PROJECT_ABP_CONFIRMED`. Exclusions are
`NO_DOTNET_PROJECT_EVIDENCE`, `NO_DOTNET_SCOPE_MATCH`,
`NO_DOTNET_PRIMARY_EVIDENCE`, and `NO_DOTNET_EXECUTABLE_WORK`.

Platform signals are contextual, not automatic guide activators:

| Platform | Semantic effect | Stable reason |
| --- | --- | --- |
| `mobile` | With an existing UI surface, reinforces design/accessibility and adds performance constraints. | `PLATFORM_MOBILE` |
| `desktop` | With an existing UI surface, reinforces design/accessibility. | `PLATFORM_DESKTOP` |
| `server` | With `auth`, reinforces the trust boundary and adds testing. | `PLATFORM_SERVER` |
| `ci` | With `executableChange: true`, adds security to the existing change checks. | `PLATFORM_CI` |
| `web` | Informational-only; surface and risk signals remain authoritative. | — |
| `cross-platform` | Informational-only; it never selects a guide by itself. | — |

Equivalent normalized signal arrays produce identical JSON. A valid route has
no duplicate guides, a reason for every selected guide, an exclusion reason
for every excluded guide, no selected/excluded overlap, and a primary that is
either null or selected. The local `validate-protocol` command checks
cross-artifact relationships without executing task data.

Negative routing guarantees:

- a documentation mention of OAuth does not activate `security`;
- a backend refactor does not activate `design` or `accessibility`;
- static UI copy does not activate `security` without a trust-boundary signal;
- a package file alone does not prove that Node is an affected task surface;
- a valid `package.json` without an allowlisted runtime dependency, direct Node
  runtime script, or narrow server-builtin import from a plausible runtime
  surface does not activate `nodejs`;
- React/Vite, Next-only, engines-only, `@types/node`-only, devDependency-only,
  lockfile-only, Docker-only, and CI-only evidence does not activate `nodejs`;
- Node.js detection does not execute package scripts, import source, install
  dependencies, follow symlinks, read unbounded files, or make network calls;
- comments, template text, `import type`/`export type`, inline type-only
  specifiers, declaration files, tooling/configuration files, and
  test/fixture/example/documentation/build/script/tool/codegen/cache directories
  do not create Node.js runtime evidence;
- a `MATCH` or `UNSCOPED` public `projectEvidence` object whose frameworks
  include `nodejs` selects the Node.js guide for executable work even when its
  primary signal list is empty; signal details only enrich the reason list;
- a workspace root may scope confirmed Node descendants, but a frontend or
  unrelated nested package remains isolated, and nested project boundaries are
  applied consistently to Flutter, .NET, Node source scans, claims, and shared
  files;
- documentation, UI-copy, and mobile-only work do not activate the Node.js
  specialist even when the repository contains a confirmed Node package;
- `flutter_test`, a Flutter word in documentation, or a lockfile package does
  not replace the primary Flutter SDK dependency signal;
- a .NET word in documentation, a `Dockerfile`, `project.assets.json`, a
  package-lock file, or an arbitrary package name does not activate `dotnet`;
- a standalone `aspnetcore` or `abp` project-evidence overlay is invalid;
- a worker or library SDK selects the .NET specialist without claiming it is
  an ASP.NET Core application; web/Razor/Blazor SDK or framework-reference
  evidence is required for the ASP.NET Core reason;
- a malformed, oversized, unsupported, or non-SDK-style project manifest does
  not provide primary .NET evidence;
- ABP guidance is not added for a plain ASP.NET Core project without a
  structural `Volo.Abp.*` package reference;
- a shared MSBuild/NuGet file does not activate unrelated projects outside its
  directory scope, and a solution claim does not activate non-members;
- a `.rs` file, `Cargo.lock`, Rust toolchain/configuration file, or Rust
  dependency name does not replace a valid Cargo package/workspace manifest;
- a virtual workspace root is not exposed as a public package root, excluded
  workspace members remain out of an explicit workspace claim, and nested
  Cargo workspaces remain ownership boundaries;
- Rust shared files (`Cargo.lock`, toolchain, `.cargo/config*`, rustfmt, and
  Clippy configuration) apply only to their owning package/workspace scope;
- a `MATCH` or `UNSCOPED` public `projectEvidence` object whose frameworks
  include `rust` selects the Rust guide for executable work even when its
  primary signal list is empty; public framework identity is authoritative;
- documentation and UI-copy work do not activate the Rust specialist even
  when the repository contains a confirmed Cargo project;
- an unrelated monorepo project does not activate Flutter when task claims do
  not intersect its confirmed project root; nested project roots remain isolated;
- an explicit executable-change signal adds `clean` and `test` even when the
  semantic work type is documentation.

## Verifiable scenarios

Route comments are stable contracts for the validator. They contain IDs, not loading instructions.

### Premium landing page

<!-- route:landing-page-premium=premium,design,taste,accessibility,clean,test,security,performance -->

Verify the brief, content, responsive UI, states, WCAG coverage, build, tests, Web Vitals, forms, analytics, launch, and operation.

### Authenticated API

<!-- route:api-auth=clean,test,security,performance -->

Verify HTTP contracts, input validation, authentication and authorization, negative tests, persistence, rate limiting, observability, and critical-path latency.

### Bug without UI

<!-- route:bug-without-ui=clean,test -->

Start with reproduction and a regression test. Activate `security` or `performance` only if the cause or fix reaches those surfaces.

### Mobile app with UI

<!-- route:app-mobile-ui=clean,test,design,accessibility,security,performance -->

Verify the actual native or cross-platform target, states, gestures, keyboard and focus behavior, accessibility, storage, networking, battery, memory, and tests on a compatible target.

### Multiplayer web game

<!-- route:game-web-multiplayer=games,clean,test,security,performance,accessibility,design -->

Verify the game loop, authoritative server, reconciliation, input, assets, fallbacks, budgets, accessibility, security, and release process.

### Documentation

<!-- route:documentation=documentation -->

Verify Markdown, links, paths, commands, and examples.

### Flutter application feature

<!-- route:flutter-app-feature=flutter,clean,test -->

Verify the affected `pubspec.yaml` contains the Flutter SDK dependency, confirm
the task claim reaches that project, and cover widget/state behavior, platform
integration, accessibility, performance, and release checks according to the
changed surface. Supporting signals alone must leave `flutter` excluded.

### .NET / ASP.NET Core application feature

<!-- route:dotnet-app-feature=dotnet,clean,test -->

Verify the affected project uses a supported SDK-style .NET manifest, confirm
the claim scope or exact solution membership, and cover DI lifetimes, pipeline
ordering, endpoint contracts, validation, authorization, cancellation, data
access, observability, and integration behavior according to the changed
surface. A worker/library project remains on the same specialist guide but
does not receive an ASP.NET Core claim without structural web evidence.

### Node.js backend feature

<!-- route:nodejs-backend-feature=nodejs,clean,test -->

Verify the affected package has primary Node.js evidence, confirm the claim
reaches the correct package root or workspace descendant, and cover runtime and
module-system compatibility, input/configuration validation, authentication and
authorization, middleware order, timeouts/cancellation, persistence and
external-service boundaries, observability, shutdown, and adversarial tests.
Supporting package metadata and lockfiles alone must leave `nodejs` excluded.

### Rust application feature

<!-- route:rust-app-feature=rust,clean,test -->

Verify the affected `Cargo.toml` contains a valid `[package]` or `[workspace]`
table, confirm the claim reaches the correct package/workspace scope, and
cover toolchain/MSRV/edition/target compatibility, ownership and cancellation,
resource limits, unsafe/FFI/dependency boundaries, focused tests, and the
workspace checks required by the repository. Cargo metadata and Rust tooling
files alone must leave `rust` excluded.

## Route changes

If investigation reveals a new surface, update the guide set before editing that area. Record only the concise reason; do not create a versioned task log.

If an applicable guide is missing or inaccessible, use conservative defaults, do not invent its content, and disclose the limitation in the delivery.

## Execution profile routing

Guide selection and execution depth are separate deterministic decisions. The
persisted route also contains `executionProfile` with `requested`, `floor`,
`resolved`, `reasons`, and `escalated` fields. It is resolved from the same
declared route signals plus contract and task-scope metadata; no model
confidence, token estimate, or subjective complexity judgment is used.

The safety floor is `light` for narrow low-risk documentation, copy, and local
UI work; `balanced` for behavior or executable changes, ordinary application
engineering, data/configuration/CI surfaces, and moderate scope; and `full`
for authentication, critical paths, secrets, personal data, publication,
infrastructure, destructive or irreversible operations, and authority-sensitive
external mutations. A CLI request overrides project configuration only as a
request: it cannot lower the resolved safety floor.

Hosts should present `light` tasks with targeted guide sections, a compact
plan, focused checks, and bounded `next --compact` or `task-show --compact`
responses. Required gates, evidence, verification truth, lifecycle chronology,
and validator-backed completion remain unchanged. Historical protocol-v1
routes without the optional field remain valid and project to `balanced` for
compatibility without being rewritten.

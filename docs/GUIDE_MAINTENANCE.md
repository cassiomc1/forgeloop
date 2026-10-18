# Engineering guide maintenance

ForgeLoop's [guide registry](../src/config/guides.json) contains 23 guides.
The [router](../GUIDE_ROUTER.md) selects relevant context; a catalog entry is
not evidence that its toolchain is installed, its examples were executed, or
its target application is ready for release.

## Review scope and authority

The catalog consistency review dated 2026-10-17 covered every registered guide
for activation claims, precedence, optional-tool boundaries, verification
language, version handling, and related documentation. Local source and
validators govern routing, metadata, packaging, and evidence. Official
version-matched sources govern language/platform semantics. This review is
not a new certification of every API, release, framework, device, or external
link, and it does not execute consumer applications.

Use this precedence when maintaining guidance:

1. Preserve platform rules, the user's request, repository constraints, and
   the canonical ForgeLoop protocol.
2. Derive activation from `src/core/project-detection.js`, its specialist
   parsers, `src/core/router.js`, and the public project-evidence schemas.
3. Read guide gates and completion requirements from registered frontmatter;
   prose examples do not create extra lifecycle gates or protocol enums.
4. Preserve project versions and architecture. Dated release examples are
   reference material, not permission to upgrade a compiler or framework.
5. Treat named tools and aesthetic defaults as contextual choices. Do not
   install a missing optional tool or introduce a user-approval gate for a
   reversible local choice. Reuse scoped authority already given.
6. Keep unavailable checks and observations separate from passing evidence,
   legal compliance, publication, deployment, and production readiness.

## Catalog maintenance map

The focus column records the boundary inspected and retained, or the
substantive correction made. All rows remain subject to the review limits
above; retained guidance does not imply a fresh external release audit.

| ID | Guide | Maintenance focus |
| --- | --- | --- |
| `premium` | [Premium websites](../ENG/premium-sites-studio-eng.md) | Clarified production stages versus runtime gates and genuine client/publication authority |
| `clean` | [Clean code](../ENG/clean-code-eng.md) | Retained cohesion, public contracts, cancellation, observability, and risk-based dependency guidance; clarified existing installation authority |
| `test` | [Testing](../ENG/test-code-eng.md) | Retained proportional tests, protected checks, unavailable-tool reporting, and observed evidence; clarified existing installation authority |
| `security` | [Security](../ENG/sec-code-eng.md) | Retained threat-boundary gate, negative tests, and advisory Cloudflare companion boundary; clarified existing installation authority |
| `design` | [Design](../ENG/design-code-eng.md) | Preserved product tokens, made example styling and Impeccable contextual, and removed install-capable verifier examples |
| `taste` | [Taste frontend](../ENG/taste-frontend-eng.md) | Retained contextual v2 adaptation, source/asset provenance, no aesthetic authority, and screenshot-based review |
| `performance` | [Performance](../ENG/perf-code-eng.md) | Clarified async I/O versus CPU offloading; retained measured baselines, field/lab separation, and bounded resources |
| `accessibility` | [Accessibility](../ENG/accessibility-eng.md) | Defaulted missing profile to AA without an artificial approval gate; corrected contrast and native-control keyboard guidance |
| `games` | [Web games](../ENG/games-code-design-web-eng.md) | Retained bounded fixed-step simulation, authoritative resync, validated procedural generation, capability fallback, and deployment checks; clarified installation authority |
| `documentation` | [Documentation](../ENG/documentation-quality-eng.md) | Added guide-specific checks for factual activation, gates, defaults, optional tools, and release claims |
| `flutter` | [Flutter](../ENG/flutter-development-eng.md) | Replaced prospective routing instructions with implemented manifest detection and task-specific verification semantics |
| `dotnet` | [.NET](../ENG/dotnet-aspnetcore-development-eng.md) | Retained structural SDK project detection, scoped ASP.NET/ABP overlays, version compatibility, and build/release distinctions |
| `nodejs` | [Node.js](../ENG/nodejs-backend-development-eng.md) | Retained bounded backend evidence, module/runtime compatibility, cancellation, resource controls, and operational verification |
| `rust` | [Rust](../ENG/rust-development-eng.md) | Grounded the release review in primary Rust sources and narrowed safety/API claims; retained Cargo/MSRV and ownership boundaries |
| `c` | [C](../ENG/c-development-eng.md) | Retained bounded native build/source identity, pointer/ABI contracts, cleanup, sanitizers, and missing-tool limits |
| `cpp` | [C++](../ENG/cpp-development-eng.md) | Retained native identity, RAII/lifetime/ABI policy, bounded concurrency, and exact-standard verification |
| `java` | [Java](../ENG/java-development-eng.md) | Retained static Maven/Gradle/Bazel evidence, scoped topology, runtime/build separation, and bounded executor policy |
| `sql` | [SQL](../ENG/sql-development-eng.md) | Retained host-project overlay, dialect/version discovery, transaction/retry policy, and separate migration authority |
| `go` | [Go](../ENG/go-development-eng.md) | Retained bounded module/workspace topology, language/toolchain distinction, goroutine ownership, and race/fuzz evidence limits |
| `typescript` | [TypeScript](../ENG/typescript-development-eng.md) | Retained JSONC/config ownership, runtime-neutral identity, erased-type/runtime validation distinction, and compiler API migration boundary |
| `php` | [PHP](../ENG/php-development-eng.md) | Aligned the source fallback description with both `<?php` and `<?=` recognized by the parser |
| `swift` | [Swift](../ENG/swift-development-eng.md) | Retained SwiftPM/native target composition, source-backed identity, concurrency/FFI policy, and signing/platform evidence limits |
| `python` | [Python](../ENG/python-development-eng.md) | Explicitly documented reference-only status: automatic structural Python routing is not implemented |

## Revalidation procedure

For a guide change, inspect the registered path, frontmatter, related router
rules, representative valid/invalid fixtures, and affected consumer docs.
Check an external version-sensitive claim against the project's pinned
version and the relevant official source before revising it. Update
`last-reviewed` when that guide is materially revalidated; do not change dates
on untouched guides merely to make the catalog look fresh.

For policy changes, compare related guides as well: a safe default in one
document must not become a mandatory tool, approval, rewrite, or installation
in another. Preserve explicit user requirements and real blocking decisions.

Run proportional checks, including the existing documentation suite:

```bash
npm run docs:check
python3 scripts/validate_markdown.py
npm run pack:check
npm run security-skill:check
```

Use `npm run verify:fast` while editing and `npm run verify:prepush` before a
PR. Those commands verify repository consistency and applicable code/package
behavior; they do not run all 23 consumer toolchains. New documentation must
be registered in the documentation manifest and review matrix. Add
consumer-facing pages to the package allowlist, and derive generated content
through its existing generator.

## Primary reference points for changed guidance

- [WCAG contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
  and [ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/).
- [Node.js event-loop guidance](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop).
- [Official Rust 1.99.0 announcement](https://blog.rust-lang.org/2026/10/01/Rust-1.99.0/).
- ForgeLoop's [project detector](../src/core/project-detection.js),
  [PHP recognizer](../src/core/php-project.js),
  [guide registry](../src/config/guides.json), and
  [project-evidence schema](../schemas/routing-input.schema.json).
- [Repository dependency policy](https://github.com/cassiomc1/forgeloop/blob/main/scripts/check-dependency-policy.mjs) and
  [package metadata](../package.json) for runtime dependencies and versions.

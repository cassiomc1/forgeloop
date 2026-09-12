---
name: typescript-development-eng
language: en
description: "Specialist guidance for TypeScript applications, libraries, build configurations, and typed JavaScript boundaries."
version: "2026.09"
last-reviewed: "2026-09-12"
guide-id: typescript
requires-gates:
  - threat-boundary
completion-evidence:
  - typescript-validation
---

# TypeScript Development Engineering Guide

## Mission and activation

Use this runtime-neutral guide for TypeScript applications, libraries, tools,
and typed JavaScript boundaries. A valid bounded `tsconfig.json` is primary
evidence. A custom `tsconfig.*.json` is primary only when directly claimed or
referenced by a confirmed local config. `jsconfig.json`, `.ts` snippets,
`.d.ts` declarations, a TypeScript dependency, CI compiler setup, generated
declarations, and build/test configuration alone do not establish a TypeScript
project. A TypeScript config may coexist with Node.js at the same root; the
two specialists describe different concerns.

The detector uses a small JSONC recognizer for comments and trailing commas,
keeps references bounded to discovered configs, and never executes a config,
compiler, package script, or project code.

## Authority and precedence

Repository compiler/configuration, emitted module contract, runtime support,
public type compatibility, and build policy win over generic advice. Use the
matching repository TypeScript version/config first, then official TypeScript
documentation and release notes, then runtime/framework documentation. The
2026-09 plan snapshot records TypeScript 7.0 as the current reference. TS 7.0
uses the native Go-based toolset and does not provide a stable programmatic
compiler API; TS 6 compatibility can remain necessary for tooling. Do not
auto-migrate TS 6 projects or compiler integrations to TS 7.

## Configuration and project discovery

Treat `tsconfig.json` as a project root even when it has no source. Preserve
solution configs with `files: []` and local `references`; a reference may name
a directory containing `tsconfig.json` or a specific discovered config. Local
`extends` is shared configuration context, not permission to execute or walk
arbitrary packages. External package resolution and cyclic/unbounded config
graphs fail closed or remain unresolved.

Keep `include`/`exclude`, project references, `composite`, incremental state,
path mapping, module resolution, `module`/`target`, `lib`, JSX, decorators,
declaration emit, source maps, and `noEmit` as separate decisions. Build,
test, Vite, Webpack, and Node configuration is not backend identity.

## Architecture and type semantics

Keep runtime contracts distinct from type-level intent. Review inference and
narrowing, `unknown` versus `any`, `never`, unions/intersections,
discriminated unions, generics, conditional/mapped/template-literal types,
variance where relevant, assertions, `satisfies`, declaration merging, and
public declaration compatibility. Do not enable `strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, or a module-mode
migration as incidental cleanup.

Type erasure means TypeScript type correctness is not runtime input
validation. Validate JSON, network, environment, database, IPC, and persisted
data at runtime with an intentional boundary contract.

## Modules, async behavior, and security

Preserve the repository's ESM/CJS, package `exports`/`imports`, interop,
source-map, and loader behavior. Make promises, cancellation, timeouts,
back-pressure, worker ownership, and shutdown observable. Treat DOM/runtime
values, serialized data, file paths, environment variables, dynamic imports,
templates, and credentials as untrusted. Avoid leaking source maps, secrets,
or internal errors across public boundaries.

## Performance, build, and portability

Measure compiler graph size, incremental performance, emitted bundle size,
startup, memory, and runtime latency before optimizing. Keep generated output,
declaration emit, package manager lockfiles, platform APIs, browser/Node
globals, and target compatibility explicit. Do not infer runtime support from
the compiler target or from a build tool's Node process.

## Verification and Definition of Done

Run the affected config's type-check, project-reference build, tests, lint,
runtime validation, bundle/package checks, and security checks, then the
repository suite. Record compiler version, config path, module mode, target,
runtime, generated artifacts, and exact commands. Verify public library types
and clean-install behavior. Missing tooling is `NOT_VERIFIED`. ForgeLoop
performs bounded structural TypeScript analysis; it does not implement the
compiler, module resolver, path mapper, or build graph.

## Official sources

- [TypeScript handbook](https://www.typescriptlang.org/docs/)
- [What is a tsconfig.json?](https://www.typescriptlang.org/docs/handbook/tsconfig-json.html)
- [TypeScript TSConfig reference](https://www.typescriptlang.org/tsconfig/)
- [TypeScript 7.0 release announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- [TypeScript GitHub repository](https://github.com/microsoft/TypeScript)

---
name: rust-development-eng
language: en
description: "Specialist guidance for architecture, implementation, testing, security, performance, and release of production Rust applications, services, libraries, and workers."
version: "2026.09"
last-reviewed: "2026-09-11"
guide-id: rust
requires-gates:
  - threat-boundary
completion-evidence:
  - rust-validation
---

# Rust Development Engineering Guide

> Production-oriented guidance for Rust applications, services, libraries,
> command-line tools, workers, and systems components.
>
> This guide is activated only by a valid, structurally parsed `Cargo.toml`
> with a `[package]` and/or `[workspace]` table in the affected project scope.
> A Rust source file, `Cargo.lock`, toolchain file, rustfmt or Clippy config,
> Docker image, CI setup, or a dependency name alone is not project identity.
> The detector reads manifests and bounded project metadata without invoking
> Cargo, rustc, build scripts, procedural macros, package scripts, or network
> services. Build and test tooling around another stack is not backend/runtime
> evidence for that stack.

This guide complements [`clean-code-eng.md`](./clean-code-eng.md) for
maintainability, [`test-code-eng.md`](./test-code-eng.md) for verification,
[`sec-code-eng.md`](./sec-code-eng.md) for trust boundaries,
[`perf-code-eng.md`](./perf-code-eng.md) for measured optimization, and
[`documentation-quality-eng.md`](./documentation-quality-eng.md) for public
technical documentation.

Tooling policy: inspect the repository and use already-available tools first.
Do not install a Rust toolchain, target, linker, dependency, database,
container, browser, or global utility merely to satisfy a check. If a required
check cannot run, record `NOT_VERIFIED` or `BLOCKED`; never claim it passed.

## 1. Mission and activation contract

The Rust specialist exists to make changes that are:

- correct for the repository's active toolchain, edition, target, and MSRV;
- explicit about ownership, borrowing, concurrency, cancellation, and process
  boundaries;
- safe when input, dependencies, unsafe code, FFI, build scripts, and network
  peers are untrusted;
- testable with the narrowest check that proves the changed behavior and with
  broader checks where integration risk requires it;
- observable under success, error, timeout, retry, cancellation, and shutdown;
- reproducible from the exact workspace, lockfile, features, and toolchain that
  will ship.

Do not select Tokio, Axum, Actix Web, Rocket, Hyper, Tower, Tonic, Serde, an
allocator, an async runtime, or a deployment model because it is fashionable.
Use repository evidence and the smallest coherent change. These technologies
may enrich context inside this single Rust guide, but they are not public
specialist IDs.

### Cargo-first evidence

The project detector treats these as primary identity signals:

1. A bounded, valid `Cargo.toml` containing a structurally valid `[package]`
   table.
2. A bounded, valid `Cargo.toml` containing a structurally valid `[workspace]`
   table with at least one resolvable, in-repository package member. An empty
   or unresolved virtual workspace fails closed; a package workspace remains
   valid through its `[package]` identity.

A manifest can contain both tables. A virtual workspace has no package root of
its own; its confirmed package members are the public project roots. Workspace
`members`, `exclude`, `package.workspace`, known local `path` dependencies, and
nested workspace boundaries are used conservatively for claims and shared-file
ownership. Workspace globs are bounded path patterns: `*` and `?` do not cross
path separators, while `**` may; absolute paths and parent-directory escapes
are rejected. Only already discovered manifests participate; the detector does
not traverse dependency paths or execute Cargo to resolve workspace semantics.

Cargo package metadata may inherit `edition` and `rust-version` through
`edition.workspace = true` and `rust-version.workspace = true`. The detector
records those inheritance flags as supporting context, and may retain direct
`[workspace.package]` values for guidance. It does not require inherited values
to classify a package.

The following are supporting context only:

- `edition`, `rust-version`, `resolver`, features, dependency categories, and
  recognized runtime or server libraries in `Cargo.toml`;
- `Cargo.lock`, `rust-toolchain`, `rust-toolchain.toml`, `.cargo/config`,
  `.cargo/config.toml`, `rustfmt.toml`, `.rustfmt.toml`, `clippy.toml`, and
  `.clippy.toml`;
- `src/**/*.rs`, `build.rs`, proc-macro crates, generated code, Dockerfiles,
  CI configuration, documentation, and repository prose.

Source-only context does not replace Cargo identity. `target/` and `vendor/`
are ignored during bounded discovery; `.cargo/` remains visible as Rust
configuration. Confirmed nested Rust, Node.js, Flutter, and .NET roots remain
ownership boundaries. A parent project must not claim a nested child's
manifest, lockfile, configuration, source, or generated output.

## 2. Authority, discovery, and version truth

Resolve conflicts in this order:

1. Platform and safety rules.
2. The user's latest explicit request.
3. Repository-local instructions, including `AGENTS.md`, `PROJECT_PROFILE.md`,
   `LOOP_ENGINEERING.md`, and nested instructions.
4. Actual Cargo manifests, source, tests, CI, deployment configuration, and
   release metadata.
5. Existing public contracts and established architecture.
6. This guide.
7. Version-matched official Rust and Cargo documentation.
8. Community examples.

Use the official Rust documentation as the authority: the [Rust
Documentation](https://doc.rust-lang.org/stable/), [The Cargo
Book](https://doc.rust-lang.org/cargo/), [The Rust
Reference](https://doc.rust-lang.org/reference/), [The Edition
Guide](https://doc.rust-lang.org/edition-guide/), [The rustup
Book](https://rust-lang.github.io/rustup/), [The Rustonomicon](https://doc.rust-lang.org/nomicon/),
and official [Rust release and security
information](https://www.rust-lang.org/).

Rust does not have a Node-style LTS channel. Stable, beta, and nightly are
different release channels; a repository may additionally pin a toolchain or
target. The plan's observation of a current stable version is dated evidence,
not a universal migration target. Verify the current channel and support
policy before changing one.

Keep these four decisions separate:

- **Active toolchain:** the compiler and Cargo selected by `rust-toolchain`,
  `rust-toolchain.toml`, `rustup`, CI, or the build environment.
- **MSRV:** the oldest Rust version supported by the package, usually declared
  as `package.rust-version` and tested by the project policy.
- **Edition:** language and standard-library behavior selected by
  `package.edition`; it is not the compiler version or the MSRV.
- **Target:** the compilation and deployment target, linker, C ABI, OS, CPU,
  and cross-compilation environment.

Do not silently upgrade the active toolchain, MSRV, edition, target, lockfile,
or resolver while making an unrelated feature change. Record an intentional
compatibility change and validate it in the same environment used by CI and
release.

## 3. Cargo packages, crates, and workspaces

Treat Cargo structure as a set of explicit ownership boundaries:

- A **package** is described by a `Cargo.toml` `[package]` table and may contain
  one or more library, binary, example, test, or benchmark crates.
- A **crate** is a compilation unit; its crate type and entry point do not
  change package ownership.
- A **workspace** coordinates packages and can be a package workspace or a
  virtual workspace. Workspace dependencies, resolver settings, profiles,
  members, excludes, and lockfile placement affect reproducibility.
- A package may belong to a workspace while retaining its own package
  identity. Do not treat the virtual workspace root as a deliverable package.

Before editing a workspace:

- read the nearest package manifest and the workspace root manifest;
- determine whether membership is explicit, glob-based, or excluded;
- identify the lockfile and toolchain/config files that apply to the affected
  package;
- check whether a nested workspace is an independent boundary;
- preserve feature resolver and workspace dependency intent;
- avoid rewriting unrelated members or normalizing the whole workspace.

Do not edit `Cargo.lock` by hand. Use the repository's documented Cargo
command and review the resulting graph, features, checksums, and MSRV impact.
For applications, a committed lockfile is normally part of reproducibility;
for published libraries, follow the repository's established policy.

## 4. Architecture and ownership

Prefer modules that own a coherent capability. Make ownership visible in the
types and interfaces rather than hiding it behind global mutable state.

- Keep transport, application, domain, persistence, and external-service
  adapters separate where those boundaries are real.
- Let the composition root construct configuration, logging, pools, clients,
  channels, and servers explicitly.
- Keep domain code independent of HTTP, database, queue, and framework types
  when the repository's architecture permits it.
- Use traits at a meaningful substitution or ownership boundary; do not create
  traits only to make a concrete function look abstract.
- Prefer a small error type at each boundary and preserve the cause for logs
  without exposing secrets, tokens, SQL, paths, or topology to callers.
- Make startup failure visible and shutdown bounded. Handle termination and
  cancellation in the same design as the happy path.

### Ownership and borrowing

Use ownership as a design tool:

- pass borrowed data when the callee does not need to retain it;
- move values when the callee becomes the clear owner;
- avoid unnecessary `clone`, `Arc`, `Mutex`, and `'static` requirements;
- name lifetime parameters only when they communicate a real relationship;
- keep mutable aliases short-lived and local;
- model resource ownership with types that make invalid states difficult.

Do not fight the borrow checker by adding broad clones or locks without
examining the data flow. Conversely, do not contort a clear boundary into a
complex lifetime design when an owned value is the safer contract.

### Libraries, services, and workers

Libraries must keep public types, feature flags, MSRV, and error behavior
intentional. Services and workers additionally need:

- bounded request, message, body, queue, and concurrency limits;
- timeouts for network, database, and shutdown operations;
- cancellation propagation and no work acknowledged before durable success;
- idempotent retry and explicit dead-letter or partial-failure behavior;
- stable exit status, structured logs, and health/readiness semantics;
- graceful drain behavior for in-flight tasks and connections.

Do not describe a CLI, library, worker, or protocol implementation as an HTTP
backend unless its actual runtime boundary warrants that claim. The same Rust
guide covers all of these runtime surfaces.

## 5. Error handling and observability

Use `Result` for recoverable failure and `Option` for absence. Avoid `unwrap`,
`expect`, and panic-driven control flow at request, message, file, database,
configuration, and startup boundaries unless the invariant is local,
documented, and tested.

- Preserve error context at the boundary where it becomes actionable.
- Do not log secrets, credentials, personal data, full request bodies, or
  untrusted values without bounded redaction.
- Separate user-safe errors from operator diagnostics.
- Include correlation or operation identity where it helps trace a request
  across async tasks and external services.
- Record latency, queue depth, retry count, saturation, and failure class when
  those measures define service health.
- Test timeout, cancellation, retry exhaustion, malformed input, dependency
  failure, and shutdown paths—not only success.

## 6. Async, concurrency, and resources

Choose synchronous or asynchronous execution from measured workload and
dependency requirements. An async runtime is not automatically an architecture.

- Do not hold a blocking mutex, database transaction, file handle, or other
  scarce resource across an `.await` unless the ownership and contention are
  explicit and tested.
- Do not perform blocking filesystem, process, compression, or CPU-heavy work
  on an async executor thread without a deliberate boundary.
- Bound spawned tasks, channels, queues, retries, and connection pools.
- Propagate cancellation; do not leave detached tasks that outlive their
  owner without an explicit lifecycle contract.
- Understand `Send`, `Sync`, `Unpin`, executor affinity, and `Arc` ownership at
  the boundary where they matter.
- Close or drain streams and pools on shutdown; make the deadline observable.
- Prefer backpressure over unbounded buffering.

For network services, validate request sizes, framing, headers, encodings,
timeouts, redirects, peer identity, and response limits. For protocol code,
test partial reads, reordered input, duplicate messages, version skew, and
connection loss.

## 7. Input, configuration, and security

Treat command-line arguments, environment variables, configuration files,
HTTP requests, messages, files, database results, dependency metadata, and
FFI values as untrusted until validated.

- Parse at the boundary into a constrained type.
- Reject unknown or dangerous configuration where the contract requires it.
- Keep defaults explicit and safe; distinguish absent, empty, and invalid.
- Avoid path traversal, shell injection, unsafe deserialization, SSRF, and
  unbounded allocation.
- Use least-privilege credentials and avoid secrets in source, logs, lockfile
  comments, examples, generated artifacts, or error messages.
- Validate authorization in the application boundary, not only in a router or
  command wrapper.
- Keep cryptographic and protocol decisions tied to the repository's security
  requirements and official documentation.

### Unsafe, FFI, build scripts, and procedural macros

Treat `unsafe`, C/C++ FFI, `build.rs`, proc-macro crates, generated bindings,
linker flags, and native dependencies as explicit trust boundaries.

- Minimize the unsafe region and state the invariant it relies on.
- Validate ownership, alignment, initialization, aliasing, thread safety, and
  lifetime assumptions at the boundary.
- Audit both sides of an FFI call and test failure, ABI, and cleanup behavior.
- Keep build scripts deterministic, bounded, and free of undeclared network or
  environment assumptions.
- Review proc macros and generated code as build-time code with supply-chain
  impact; do not assume generated output is safe because it is generated.
- Use the repository's established lint policy; do not add a blanket unsafe
  prohibition or a blanket allow merely to make a check green.

## 8. Dependencies, features, and reproducibility

Before adding or upgrading a crate, inspect repository policy, MSRV, license,
advisories, maintenance, transitive graph, feature defaults, native build
requirements, and target support.

- Prefer the smallest dependency and feature set that satisfies the contract.
- Understand workspace dependency inheritance and resolver behavior.
- Avoid enabling a large default feature set for a small capability.
- Keep application builds reproducible with the intended lockfile policy.
- Use `--locked`, `--frozen`, or `--offline` when the repository or CI requires
  those guarantees; do not weaken them to hide a missing lockfile or network.
- Do not make network access part of detection or ordinary validation unless
  the repository explicitly requires it and the authority is clear.

Document a new dependency's role and runtime/build-time boundary. A Tokio,
Axum, Actix, Rocket, Hyper, Tower, Tonic, Serde, or database crate may provide
useful contextual guidance, but it does not create a new public framework
classification or specialist guide.

## 9. Framework and runtime overlays

Apply framework-specific advice only after Cargo and repository evidence have
confirmed the Rust project. Keep all overlays inside this guide:

- **Axum, Actix Web, Rocket, Poem:** validate extraction and serialization,
  middleware order, state ownership, rejection/error mapping, graceful
  shutdown, and route-level authorization.
- **Hyper and Tower:** preserve service composition, readiness, backpressure,
  body limits, timeout layers, and error semantics.
- **Tonic:** validate protobuf evolution, metadata/authentication, deadlines,
  streaming cancellation, status mapping, and compatibility.
- **Tokio or another async runtime:** configure worker behavior deliberately,
  keep blocking work off the executor, bound tasks and channels, and test
  cancellation and shutdown.
- **Serde and schema-facing code:** make unknown-field, numeric, enum, and
  versioning behavior explicit at the trust boundary.
- **Database or message clients:** use bounded pools, transaction ownership,
  cancellation, retry/idempotency rules, and migration compatibility.

The overlay never overrides the repository's active versions, security policy,
public contracts, or measured evidence.

## 10. Testing and validation

Run the repository's exact commands first. A conventional Cargo validation
sequence may include:

```text
cargo fmt --all -- --check
cargo check --workspace --all-targets --all-features
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
cargo doc --workspace --no-deps
```

Use only the subset that matches repository policy and the changed surface.
For a library, include public API and doctest coverage. For a service or
worker, include integration, protocol, shutdown, timeout, and operational
smoke checks. For a cross-compiled target, validate with the pinned linker and
target rather than claiming host validation is equivalent.

Tests should cover:

- valid, missing, malformed, and boundary configuration;
- ownership, concurrency, cancellation, timeout, retry, and shutdown;
- authorization and untrusted input rejection;
- feature combinations and MSRV-sensitive APIs;
- serialization compatibility and protocol version changes;
- FFI/build/proc-macro failure and cleanup paths where applicable;
- generated output and clean-room packaging where those artifacts ship.

Do not silence Clippy, skip a workspace member, remove a test, or broaden a
threshold to make a check green. Diagnose the failure and make the smallest
coherent correction. If a toolchain or target is unavailable, report the
exact command as `NOT_VERIFIED`.

## 11. Release and operational readiness

Before release, verify the exact commit, active toolchain, MSRV, edition,
target, feature set, lockfile, generated artifacts, package contents, and
release notes. For crates.io publication, follow the repository's trusted
publication workflow and confirm package metadata, README links, license,
included files, and provenance requirements.

For deployed applications and services, also verify:

- startup and readiness fail safely when configuration or dependencies are
  unavailable;
- logs and metrics are useful without exposing sensitive data;
- timeouts, limits, retries, and graceful shutdown are configured;
- rollback and schema/protocol compatibility are understood;
- the exact release artifact was built and tested with the intended target.

Do not confuse a green host build with production readiness, or local package
inspection with publication. Rust channel choice, release cadence, and target
support remain repository decisions; there is no universal Rust LTS target.

## 12. Definition of done

- Cargo structure and affected package/workspace ownership are confirmed.
- Active toolchain, MSRV, edition, target, resolver, features, and lockfile
  implications are recorded when relevant.
- The implementation preserves clear ownership, bounded resources, errors,
  cancellation, and shutdown behavior.
- Untrusted inputs, unsafe/FFI/build boundaries, secrets, and dependencies
  receive explicit controls.
- Focused regression tests pass, with broader workspace checks proportional to
  the changed risk.
- Formatting, compiler, lint, test, documentation, and packaging checks are
  run or honestly marked `NOT_VERIFIED`.
- Documentation and public contracts describe the actual behavior and version
  compatibility.
- Evidence is tied to the exact revision and no publication or deployment is
  claimed without its trusted external receipt.

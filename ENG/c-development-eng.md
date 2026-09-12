---
name: c-development-eng
language: en
description: "Specialist guidance for production C libraries, services, embedded components, and native build systems."
version: "2026.09"
last-reviewed: "2026-09-12"
guide-id: c
requires-gates:
  - threat-boundary
completion-evidence:
  - c-validation
---

# C Development Engineering Guide

## Mission and activation

Use this guide for C libraries, services, workers, embedded components, and
native integrations. ForgeLoop confirms C from an explicit CMake or Meson C
declaration, a native Bazel rule with owned implementation source, or a direct
claim to an owned `.c` file. `.h`/`.inc` files, a Makefile alone, compiler
flags, a Docker image, a package name, generated output, and vendored code are
not C project identity. C and C++ may be confirmed at the same root.

Detection is local, deterministic, bounded, and read-only. It does not invoke
CMake, Meson, Make, Bazel, a compiler, a linker, a generator, or project code.

## Authority and precedence

Repository architecture, supported platforms, compiler configuration, ABI,
warning policy, and minimum supported toolchain win over generic advice. Use
the matching repository standard and toolchain first, then the ISO/WG14
material and version-matched platform documentation. C23 (ISO/IEC 9899:2024)
is the current published reference in the 2026-09 plan snapshot; C2y remains
development work and is not an automatic migration target.

## Project and standard discovery

Read bounded build metadata and claimed/owned implementation files. Treat
`project(app LANGUAGES C)`, `project(app C)`, `enable_language(C)`, and
`project('app', 'c')` as explicit language evidence. CMake's omitted language
defaults are ambiguous to a static detector, so `project(app)` needs owned
implementation source before it establishes C. A `cc_*` Bazel rule needs owned
`.c` source because the rule may also build C++. A Makefile becomes meaningful
only with owned implementation source.

Keep the language standard, compiler mode (`-std=c23` versus `-std=gnu23`),
library/ABI, target triple, libc, warning policy, sanitizer configuration, and
runtime platform as separate decisions. A compiler's default is not a license
to migrate the repository.

## Architecture and semantics

Make ownership, lifetime, storage duration, pointer validity, allocation and
cleanup contracts explicit. Review array bounds, NUL termination, integer
conversion, signed/unsigned behavior, overflow, alignment, provenance, strict
aliasing, format strings, initialization, double-free, use-after-free, and
partial-failure paths. Do not silence a warning with a cast unless the
conversion is proven at the boundary.

Keep transport, parsing, domain, persistence, platform, and FFI adapters
separate where the repository does. Define an error convention that preserves
the cause without leaking secrets, and make cleanup work on every return path.

## I/O, concurrency, and security

Bound file, socket, parser, decompression, allocation, and message sizes.
Validate lengths before arithmetic and validate encodings and protocol state
before use. Treat environment values, files, IPC, network input, format
strings, and FFI data as hostile. Make timeouts, cancellation, signal handling,
thread ownership, locking, atomics, and shutdown behavior explicit; never
create unbounded work or share mutable state without a documented invariant.

## Performance and portability

Measure before optimizing. Preserve cache, allocation, syscall, and startup
budgets with benchmarks or profiling evidence. Keep platform adapters narrow;
document endianness, alignment, filesystem, clock, thread, and socket
assumptions. Sanitizers, fuzzers, static analysis, and cross-compilation
results are verification evidence, not project-detection evidence.

## Build, dependency, and interop policy

Keep compiler, linker, C library, SDK, feature, and generated-code versions
reproducible. Review third-party code and license/ABI consequences without
executing package-manager hooks during routing. For C++ or foreign-function
boundaries, specify ownership, layout, calling convention, error translation,
threading, and lifetime rules. Generated and vendored trees remain dependency
boundaries.

## Verification and Definition of Done

Run the narrowest compiler, warning, sanitizer, static-analysis, unit,
integration, fuzz, and cross-platform checks that prove the changed behavior,
then the repository checks. Record the exact source mode, target, compiler,
linker, sanitizer, and command. A missing tool is `NOT_VERIFIED`, not a pass.

Before completion, confirm ownership and cleanup paths, malformed/partial input
tests, resource and concurrency limits, security review, reproducibility, and
the exact artifact or binary contract. ForgeLoop performs bounded structural
native-project analysis, not preprocessing, compiler execution, ABI analysis,
or linker resolution.

## Official sources

- [ISO/IEC JTC 1/SC 22/WG14](https://www.open-std.org/jtc1/sc22/wg14/)
- [C23 project status](https://www.open-std.org/jtc1/sc22/wg14/www/projects)
- [GNU C Library manual](https://www.gnu.org/software/libc/manual/)
- [CMake project languages](https://cmake.org/cmake/help/latest/command/project.html)
- [Meson language reference](https://mesonbuild.com/Reference-manual_functions.html#project)
- [Bazel C/C++ rules](https://bazel.build/reference/be/c-cpp)

---
name: cpp-development-eng
language: en
description: "Specialist guidance for production C++ libraries, services, tools, and native build systems."
version: "2026.09"
last-reviewed: "2026-09-12"
guide-id: cpp
requires-gates:
  - threat-boundary
completion-evidence:
  - cpp-validation
---

# C++ Development Engineering Guide

## Mission and activation

Use this guide for production C++ libraries, services, workers, tools, and
native integrations. ForgeLoop confirms C++ from explicit CMake/Meson CXX or
cpp declarations, a native Bazel rule with owned `.cc`, `.cpp`, `.cxx`, `.c++`,
or `.C` source, or a direct claim to owned implementation source. Header-only
files, a Makefile alone, compiler versions, flags, package metadata, generated
output, and vendored code are insufficient without compatible project context.
C and C++ may be confirmed at one root.

Detection is bounded and static. It never executes a compiler, build generator,
package manager, test binary, macro, or code-generation step.

## Authority and precedence

Repository architecture, standard mode, ABI, supported compilers, target
platforms, and public compatibility policy win over generic best practice.
Use WG21, the actual compiler documentation, and version-matched platform
documentation after repository evidence. C++23 (ISO/IEC 14882:2024) is the
published reference in the 2026-09 plan snapshot. C++26 compiler support is
not permission to migrate a C++17/20/23 repository.

## Project and standard discovery

Treat `project(app LANGUAGES CXX)`, `enable_language(CXX)`, Meson's `cpp`
language, and an owned-source-backed `cc_*` Bazel rule as structural evidence.
CMake's default `project(app)` is ambiguous and requires owned implementation
source before it confirms C or C++. A `.C` extension is the conventional
case-sensitive C++ source form; `.h` remains ambiguous while `.hpp`, `.hh`,
`.hxx`, and `.inl` are contextual headers.

Keep language standard, compiler mode, standard library, ABI, target triple,
runtime, visibility, exception/RTTI policy, and vendor toolset separate. Do
not infer the repository standard from a host compiler's newest mode.

## Architecture and semantics

Make ownership and lifetime visible. Prefer RAII, value semantics, the rule of
zero, narrow interfaces, and explicit move/copy contracts. Review references,
temporary lifetime, dangling pointers, object slicing, virtual dispatch,
destruction, allocator behavior, iterator invalidation, alignment, strict
aliasing, undefined behavior, ODR/linkage, templates, concepts, ranges,
coroutines, modules, and C interoperability.

Do not mechanically replace every raw pointer with `shared_ptr`: raw pointers
can correctly express non-owning references, C APIs, intrusive structures, or
mapped memory. For public libraries, review symbols, layout, vtables,
standard-library ABI, exception ABI, visibility, and compiler/runtime
compatibility before changing types.

## Errors, concurrency, I/O, and security

Choose exceptions or error-return types deliberately and preserve causes.
Specify `noexcept` and cancellation behavior at boundaries. Make thread
ownership, atomics, memory ordering, locks, condition variables, queues,
coroutine cancellation, and shutdown bounded and observable. Protect parsers,
serialization, filesystem, IPC, network, environment, and FFI boundaries with
length, encoding, authorization, timeout, and resource checks.

## Performance and portability

Measure allocation, cache, syscall, queue, startup, and latency changes with
benchmarks or profiles. Keep platform adapters and compile-time feature
selection explicit. Record endianness, alignment, filesystem, clock, locale,
thread, linker, and standard-library assumptions. Sanitizers, fuzzing, and
static analysis prove selected paths; they do not establish universal safety.

## Build, dependencies, and interop

Keep CMake/Meson/Bazel configuration, compiler/linker flags, generated code,
package versions, and ABI policy reproducible. Treat build files as executable
configuration and never run them during routing. At C, Objective-C, Rust,
Swift, or other FFI boundaries document layout, ownership transfer, error
translation, calling convention, thread rules, and lifetime.

## Verification and Definition of Done

Run focused compiler, warning, sanitizer, static-analysis, unit, integration,
fuzz, ABI, and cross-platform checks for the exact target and standard, then
the repository checks. Record compiler, standard library, linker, flags, and
platform. Missing tooling is `NOT_VERIFIED`. Completion requires tested error,
cleanup, concurrency, resource, and compatibility behavior plus reproducible
packaging. ForgeLoop performs bounded structural native-project analysis, not
template instantiation, preprocessing, ABI compatibility analysis, or build
execution.

## Official sources

- [ISO C++ standards committee](https://isocpp.org/std/the-standard)
- [WG21 committee documents](https://www.open-std.org/jtc1/sc22/wg21/)
- [GCC C++ dialect options](https://gcc.gnu.org/onlinedocs/gcc/C-Dialect-Options.html)
- [Clang C++ language status](https://clang.llvm.org/cxx_status.html)
- [CMake project languages](https://cmake.org/cmake/help/latest/command/project.html)
- [Meson language reference](https://mesonbuild.com/Reference-manual_functions.html#project)
- [Bazel C/C++ rules](https://bazel.build/reference/be/c-cpp)

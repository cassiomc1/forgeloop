---
name: swift-development-eng
language: en
description: "Specialist guidance for production Swift applications, packages, services, and Apple-platform components."
version: "2026.09"
last-reviewed: "2026-09-12"
guide-id: swift
requires-gates:
  - threat-boundary
completion-evidence:
  - swift-validation
---

# Swift Development Engineering Guide

## Mission and activation

Use this guide for Swift applications, packages, services, workers, Apple
platform components, and command-line tools. A valid `Package.swift` is
SwiftPM topology; it does not by itself prove that a Swift target exists. The
specialist is confirmed by owned `.swift` source, explicit Swift in CMake or
Meson, bounded Xcode Swift markers, or a direct claim to Swift source. A direct
claim to `Package.swift` selects Swift guidance because the manifest itself is
Swift/PackageDescription code, including a native-only package. A C-only or
C++-only package remains native-only for unrelated source claims.

`Package.resolved`, package names, an Xcode image, Docker/CI setup, generated
or vendored source, and package-manager metadata alone are not Swift runtime
identity. Detection reads bounded text and never runs SwiftPM, Xcode, macros,
plugins, build scripts, tests, or network resolution.

## Authority and precedence

Repository package manifest, toolchain, deployment target, SDK, target triple,
entitlements, signing policy, ABI, and platform support win over generic
advice. Use version-matched Swift language, SwiftPM, Apple SDK, and Xcode
documentation after repository evidence. Swift 6.3 is the stable reference in
the 2026-09 plan snapshot; the online language book's 6.4 beta material is not
an automatic target.

Keep Swift language mode, compiler/toolchain, SDK, deployment target, runtime
OS, architecture, signing, entitlements, and package/platform compatibility
separate. Do not migrate an existing target because a newer toolchain is
available.

## Package, project, and target discovery

`Package.swift` must have a tools-version header and conservative
`PackageDescription`/`Package(` structure. The manifest is executable code, so
dynamic target declarations may remain unresolved. Use default SwiftPM source
conventions and already discovered files without evaluating the manifest.
`project.pbxproj` and CMake/Meson declarations are static context; an
`.xcworkspace` or package resolution file is aggregation/dependency context.

SwiftPM may contain separate Swift, C, and C++ targets. Preserve same-root
composition and nested package ownership; do not make languages mutually
exclusive or claim a native target as Swift without evidence.

## Architecture and language semantics

Keep UI, domain, persistence, networking, platform services, and package
targets separate where the repository does. Review value/reference semantics,
optionals, protocols, generics, associated types, error enums, `Codable`,
actors, structured concurrency, isolation, `Sendable`, ownership/lifetime,
ARC, retain cycles, unsafe pointers, existentials, and ABI/public API
compatibility.

Make async cancellation, task ownership, actor boundaries, executor use,
timeouts, back pressure, and shutdown observable. Do not hide mutable shared
state behind global actors or introduce `@unchecked Sendable` without a
proven invariant.

## I/O, security, and performance

Validate URL, file, IPC, decoded, keychain, network, and platform-service data
before use. Bound downloads, image/data decoding, queues, retries, tasks,
database resources, and logging. Protect credentials, entitlements, signing
material, user data, deep links, and IPC boundaries. Measure startup, memory,
allocation, rendering, battery, network, and concurrency behavior before
optimizing.

## Build, interop, and portability

Keep SwiftPM/Xcode build settings, SDKs, generated sources, macros, package
versions, platform deployment targets, and reproducible archives under review.
At C/C++/Objective-C/FFI boundaries specify layout, ownership, nullability,
error translation, thread/actor rules, and lifetime. Keep Apple-platform
conditional code and cross-platform abstractions explicit.

## Verification and Definition of Done

Run focused SwiftPM/Xcode compilation, unit/UI/integration tests, concurrency
checks, static analysis, package resolution/lockfile checks, signing and
entitlement checks, and platform matrix validation for the exact SDK and
target. Record command, toolchain, platform, and unavailable tools as
`NOT_VERIFIED`. Completion requires tested cancellation, failure, resource,
security, compatibility, and packaging behavior. ForgeLoop performs bounded
structural Swift package/project analysis, not full SwiftPM resolution, build
setting evaluation, macro execution, or Xcode build execution.

## Official sources

- [The Swift Programming Language](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/)
- [Swift.org documentation](https://www.swift.org/documentation/)
- [Swift Package Manager](https://github.com/swiftlang/swift-package-manager)
- [Swift Package Manager package description](https://docs.swift.org/package-manager/PackageDescription/PackageDescription.html)
- [CMake project languages](https://cmake.org/cmake/help/latest/command/project.html)
- [Apple developer documentation](https://developer.apple.com/documentation/)

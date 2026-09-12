---
name: java-development-eng
language: en
description: "Specialist guidance for production Java services, libraries, workers, and JVM build systems."
version: "2026.09"
last-reviewed: "2026-09-12"
guide-id: java
requires-gates:
  - threat-boundary
completion-evidence:
  - java-validation
---

# Java Development Engineering Guide

## Mission and activation

Use this guide for Java services, libraries, workers, command-line tools, and
JVM components. ForgeLoop uses owned `.java` source with structural Maven,
Gradle, or Bazel evidence, an unambiguous Java compiler/platform declaration,
or a direct `.java` claim. A `pom.xml`, Gradle wrapper/settings file, JDK
image, generic aggregator, dependency lock, plugin name, or `setup-java` CI
step alone is not a delivered Java project.

Detection is bounded and static. Maven, Gradle, Bazel, wrappers, plugins,
annotation processors, tests, Java code, and network resolution are never
executed. XML DTDs and external entities fail closed.

Gradle `settings.gradle` and `settings.gradle.kts` files contribute topology
only when top-level, unconditional, quoted `include` arguments connect to
already discovered Gradle builds. Conditional, interpolated, and dynamic
expressions remain unresolved. `java-gradle-plugin` is Java evidence because
it applies Gradle's Java Library plugin. `gradle.properties` is a shared
configuration surface, not an independent Java project; claims are scoped to
Gradle builds in its directory while nested independent Gradle settings
boundaries remain isolated.

## Authority and precedence

Repository architecture, toolchain/build configuration, source/target policy,
ABI, and supported runtime win over generic advice. Then use the matching Java
Language Specification/API, official Maven/Gradle/Bazel documentation, and
version-matched framework documentation. The 2026-09 plan snapshot identifies
JDK 26 as the current Java SE release and JDK 25 as the latest Oracle LTS;
neither is an automatic migration target.

Keep separate the JDK running the build tool, Java source level, `--release`,
bytecode target, compiler toolchain, runtime JRE/JDK, framework minimum,
vendor distribution, preview features, and target platform.

## Project and build discovery

`pom.xml` is parsed structurally. Owned Java source, compiler properties such
as `maven.compiler.release`/`source`/`target`, or the compiler plugin can
confirm Java. A `packaging` value of `pom` with modules is retained as
aggregator/topology context; the aggregator itself is not classified as a Java
application without Java evidence. A recognized Gradle `java`,
`java-library`, `java-platform`, `java-gradle-plugin`, `application`, or `war`
plugin is static Java build evidence. `java-platform` is intentionally
source-less Java ecosystem evidence. Literal Bazel `java_library`,
`java_binary`, `java_test`, `java_import`, and `java_plugin` rules are
supported. Generic wrappers, settings, and dependency metadata alone remain
insufficient.

Resolve only bounded, owned metadata. Do not run convention plugins, evaluate
profiles, follow arbitrary build logic, or recreate the dependency resolver.

## Architecture and language semantics

Keep transport, application, domain, persistence, messaging, and platform
adapters separate where the repository does. Make thread safety, ownership,
cancellation, timeouts, resource closure, class loading, reflection, and
serialization boundaries explicit. Review nullability, generics, variance,
records, sealed types, pattern matching, immutability, equality/hash contracts,
exception causes, class initialization, and API/binary compatibility.

Use a deliberate error model: preserve causes, distinguish retryable from
terminal failures, and avoid exposing credentials, SQL, stack traces, or
internal paths. Do not make checked/unchecked exception changes incidental.

## Concurrency, I/O, and security

Specify executor ownership, bounded queues, interruption, cancellation,
deadlines, back pressure, lock ordering, atomics, and shutdown. Avoid blocking
unknown work on shared pools. Bound request, file, decompression, serialization,
and database resources. Validate input before reflection, templates, SQL,
filesystem, process, deserialization, or network use; keep secrets out of
logs and error responses.

## Performance and portability

Measure allocation, garbage collection, startup, heap, thread, queue, I/O,
latency, and throughput changes with representative profiles or benchmarks.
Keep locale, charset, timezone, filesystem, native library, container, CPU, and
JVM assumptions explicit. Do not use a newer JDK's availability to silently
change source, bytecode, or runtime requirements.

## Dependencies, frameworks, and interop

Keep Maven/Gradle/Bazel files, lock/dependency policy, generated sources, and
reproducible build metadata under review. Spring, Quarkus, Micronaut, Jakarta,
Kotlin, SQL, JNI, and deployment platforms are contextual overlays, not public
ForgeLoop framework IDs. At JNI/FFI boundaries specify ownership, layout,
encoding, exceptions, thread attachment, and lifetime. Treat generated and
vendored code as dependency boundaries.

## Verification and Definition of Done

Run focused module compilation, unit/integration tests, static analysis,
dependency/security checks, and packaging for the exact JDK, profile, module,
and target. Check cancellation, timeout, malformed input, resource cleanup,
compatibility, and observability. Record unavailable tools as `NOT_VERIFIED`.
ForgeLoop performs bounded structural JVM project analysis, not complete
Maven/Gradle/Bazel resolution, profile evaluation, dependency solving, or build
execution.

## Official sources

- [Java SE and JDK documentation](https://docs.oracle.com/en/java/)
- [Java Language Specification](https://docs.oracle.com/javase/specs/)
- [Maven POM reference](https://maven.apache.org/pom.html)
- [Maven compiler plugin](https://maven.apache.org/plugins/maven-compiler-plugin/)
- [Gradle Java plugin](https://docs.gradle.org/current/userguide/java_plugin.html)
- [Gradle Java Platform plugin](https://docs.gradle.org/current/userguide/java_platform_plugin.html)
- [Bazel Java rules](https://bazel.build/reference/be/java)

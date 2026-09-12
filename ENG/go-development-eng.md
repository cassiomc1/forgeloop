---
name: go-development-eng
language: en
description: "Specialist guidance for production Go services, workers, CLIs, modules, and concurrent systems."
version: "2026.09"
last-reviewed: "2026-09-12"
guide-id: go
requires-gates:
  - threat-boundary
completion-evidence:
  - go-validation
---

# Go Development Engineering Guide

## Mission and activation

Use this guide for confirmed Go modules and workspaces, services, workers,
libraries, CLIs, and concurrent systems. ForgeLoop recognizes a valid bounded
`go.mod`, or a `go.work` that connects to already discovered repository-local
modules. `.go` source, `go.sum`, vendor metadata, a Docker image, a README, a
toolchain name, or a `setup-go` CI step alone is insufficient.

Detection parses structure only. It does not invoke `go`, resolve/download
modules, evaluate build tags, run generators, or execute project code. Go
workspace and path metadata never trigger new filesystem traversal.

## Authority and precedence

Repository module boundaries, supported Go versions, build tags, target
matrix, compatibility policy, and release process win over generic advice.
Use the matching Go specification, standard-library documentation, module and
workspace documentation, and official Go security guidance after repository
evidence. The 2026-09 plan snapshot uses Go 1.27/1.27.1 as a current reference;
that is not permission to upgrade a repository.

Keep the `go` language minimum directive distinct from `toolchain`, the build
tool's Go version, the release binary's runtime expectations, and the target
OS/architecture. A newer local toolchain does not change the supported module.

## Modules and workspaces

Keep `module`, `go`, `toolchain`, `require`, `replace`, `exclude`, `retract`,
`godebug`, and `use` semantics distinct. `go.work` membership is accepted only
when `use` paths resolve to known discovered local `go.mod` files. `replace`
and dependency metadata are context; ForgeLoop does not perform registry,
VCS, version, or feature resolution. Preserve nested modules and independent
workspace ownership in monorepos.

## Architecture and language semantics

Make package ownership, interfaces, zero values, pointer/value choices,
generics, methods, error wrapping, `panic`/`recover`, `defer`, and resource
cleanup explicit. Use `errors.Is`/`errors.As` for wrapped errors rather than
comparing error strings. Keep transport, domain, storage, messaging, and
subprocess adapters separate where the repository does.

Specify goroutine ownership, cancellation, channel direction and closure,
bounded worker pools, back pressure, lock ordering, atomics, race behavior,
deadlines, and graceful shutdown. Avoid goroutine leaks, unbounded creation,
copying synchronization primitives, deadlocks, and ambiguous channel owners.

## I/O, security, and performance

Bound request, file, decoding, compression, subprocess, queue, and database
resources. Treat network input, decoded data, module content, subprocess
output, environment values, and credentials as hostile. Validate before SQL,
filesystem, templates, deserialization, shell, or external-service calls.

Measure allocation, latency, throughput, queueing, startup, and memory before
optimizing. Review maps/slices and backing-array retention, pointer lifetimes,
HTTP timeouts, `net/http` shutdown, `database/sql` pool/transaction policy,
encoding, and cross-compilation/cgo assumptions.

## Dependencies and build policy

Keep `go.mod`, `go.sum`, vendoring, build tags, cgo flags, generated code,
licenses, and reproducible build commands under review. Do not treat a module
download, `go generate`, or a generator's output as routing authority. Keep
public APIs, error behavior, module compatibility, and toolchain policy
intentional.

## Verification and Definition of Done

Run focused package tests, table tests, fuzzing, benchmarks, `go vet`, the race
detector, and `govulncheck` where applicable, followed by repository checks.
Record exact Go version, module/workspace scope, tags, target, and commands.
Race-detector or fuzz success covers only exercised paths. Missing tools are
`NOT_VERIFIED`. ForgeLoop performs bounded structural Go topology analysis, not
complete module resolution, version solving, build-tag evaluation, or build
execution.

## Official sources

- [Go language specification](https://go.dev/ref/spec)
- [Go release history](https://go.dev/doc/devel/release)
- [Go modules reference](https://go.dev/ref/mod)
- [Go workspaces](https://go.dev/doc/tutorial/workspaces)
- [Go standard library](https://pkg.go.dev/std)
- [Go security policy and tooling](https://go.dev/security/)

# ForgeLoopAudit 1.6.1 Alignment Design

> Historical record. This document describes the repository state and implementation target at the time it was written. It is not the current ForgeLoopAudit specification. See the [current documentation index](../../README.md).

**Date:** 2026-08-28
**Status:** Approved for implementation
**Source:** `FORGELOOP_AUDIT_UPDATE_1_6_1.md` supplied for this task

## Goal

Align the read-only ForgeLoopAudit runtime and trusted protocol artifacts with
ForgeLoop v1.6.1 at immutable commit
`f331100cff175a4ce990fa843b397fcf720b40f5`, while accepting valid legacy
protocol-v1 execution artifacts and exposing persisted verification-execution
provenance without adding mutation or external-execution authority.

## Scope

The change has two coordinated parts:

1. Replace the vendored ForgeLoop 1.6.0 archive, regenerate the trusted schema
   provenance from the v1.6.1 release checkout, and prove execution-reader
   compatibility for both legacy and current protocol-v1 artifacts.
2. Preserve the additive `verificationExecutionIsolation` capability, model
   optional execution provenance fields, present recorded values in Executions,
   refresh generated demo fixtures, and update current-version documentation.

The implementation will remain one pull request with two logical commits so the
runtime/schema compatibility and the presentation changes are independently
reviewable.

## Architecture

ForgeLoop remains the semantic authority. Audit will consume the bundled
`@cassiomc1/forgeloop/integration` read-only surface, normalize the new
capability explicitly, and derive feature support only when the complete
version-1 isolation capability contract is advertised. Missing or incomplete
isolation capability will disable that optional presentation only; it will not
make an otherwise valid protocol-v1 project incompatible.

Trusted execution artifacts continue to pass through the existing strict Ajv
schema and path-boundary checks. The v1.6.1 schema is regenerated from the same
immutable upstream commit as the vendored runtime. The execution domain keeps
new provenance fields optional so legacy artifacts remain representable; no
missing field is converted into a guessed execution kind or isolation mode.

The Executions page will display only persisted metadata, using an explicit
“Not recorded by this artifact” state when data is absent. It will distinguish
the protocol project root from the execution cwd and will state that isolation
is recorded by ForgeLoop rather than created or attested by Audit.

## Components and data flow

- `vendor/` and package metadata identify the exact ForgeLoop 1.6.1 archive and
  its SHA-256.
- `scripts/generate-schema-provenance.mjs` and `schemas/` bind the trusted
  schemas to that upstream identity.
- `ExecutionReader` validates and returns current or legacy execution records
  without changing its fail-closed behavior for malformed records.
- Integration types and `buildAdapter()` normalize only known isolation modes
  and booleans, preserving the existing explicit transport boundary.
- Capability negotiation derives the optional feature independently from core
  compatibility.
- `ExecutionRecord` and `Executions.tsx` carry and render the recorded fields;
  raw JSON remains available and unchanged.
- The demo generator emits native and project-isolated verification examples;
  generated files are refreshed only through the canonical generator.

## Error handling and security

- Unknown top-level execution properties remain rejected by the authoritative
  schema; the validator will not be loosened as a workaround.
- Symlink, path-escape, size, count, malformed JSON, and invalid-schema guards
  remain unchanged.
- Audit will not call `run-check`, `run-action`, `reconcile-closure`, or any
  other mutating/external-execution command as part of this work.
- Audit will not invoke `createForgeLoopContext()` to become a verification
  adapter and will not reproduce ForgeLoop isolation invariants locally.

## Verification contract

The implementation must prove:

- the vendored package, lockfile, schema provenance, docs, and tests identify
  ForgeLoop 1.6.1 at the target commit;
- valid v1.6.1 native/project-isolated executions are accepted and preserve
  every isolation field;
- valid legacy protocol-v1 executions remain accepted and absent metadata is
  presented explicitly;
- unsupported properties remain withheld and counted;
- a complete isolation capability enables the optional feature while missing,
  incomplete, or unsupported capability data leaves compatibility at
  `INTEGRATION_V1` with that feature disabled;
- typecheck, lint, unit tests, schema verification, demo verification, build,
  and the repository's release/packaging gates pass as applicable.

## Delivery decision

This task requests implementation, pull-request creation, and merge. It does
not request a Audit release publication, tag, or version bump, so the existing
Audit package version remains unchanged unless a repository gate proves that a
version update is required for the requested code delivery.

# ForgeLoop Protocol Compatibility

ForgeLoopAudit supports protocol v1, schema v1 and Integration API v1 from
the pinned ForgeLoop source revision recorded in `schemas/provenance.json`
(ForgeLoop **2.0.0**, commit
`4ff11bb4bc4be39b095a151a323f1388dad0d819`). The runtime artifact registry
and `SUPPORTED_PROTOCOL.requiredSchemas` are contract-tested to remain
identical. See the [trusted schema boundary](../schemas/README.md) and
[vendored runtime lineage](../vendor/README.md) for their verification
procedures.

## SQLite storage boundary

Node.js 24.19.0 or newer is required. ForgeLoop 2.0.0 owns operational
SQLite records, ledger snapshots, storage-version validation and migration.
Audit uses only public Integration API projections and watches database/WAL
changes. It never opens SQLite, migrates projects, or promotes retained JSON
exports into current state. Unmigrated JSON projects use `ARTIFACT_ONLY`.
Native task summaries and inspectors use canonical status, contract, continuity
and ownership. Raw ledger/JSON previews remain unavailable; canonical History,
Trace and Audit UX views carry the supported observations.

ForgeLoop 2.0.0 additionally fixes snapshot-bound restoration of completed-task execution
provenance to a different directory, Windows first-run archive extraction and
contended task creation. Audit consumes those upstream behaviors through the
vendored public runtime; it does not rewrite execution roots or manufacture
restore evidence. Preserve the restore journal and retained snapshot when
inspecting a restored project. Storage restore does not install the kit or
project identity manifest: run the public `forgeloop init` in the restored
project before opening it in Audit. Audit never initializes it automatically.
The new-root restore regression verifies that
Audit reads the restored task catalog without modifying SQLite authority.

The exact published ForgeLoop 2.0.0 artifact is vendored rather than resolving npm's
mutable `latest` tag at application startup. Registry SHA-512 and `gitHead` match
the immutable upstream release. Core 2.0.0 is stable and advertises the supported
SQLite operational-writer boundary; production cutover and privileged external
writers remain separate concerns. Audit remains an unsigned preview and never
migrates an inspected project. See the upstream stable acceptance record for
source and validation limits.

The upstream review-correction fix preserves current-cycle diagnosis and fresh
verification. Audit displays the canonical result; it cannot record a finding,
authorize correction, create evidence or complete a task. Both optional bundled
security and revenue-design companions remain advisory, never provider calls or
commercial flows in Audit.

## Compatibility matrix

| Surface | ForgeLoop | ForgeLoopAudit handling |
| --- | --- | --- |
| Protocol | v1 | Read-only supported |
| Schema | v1 | Validated/read-only |
| Integration API | v1 | Supported |
| Audit UX read model (`task/audit-view`) | Current (`auditUx` v1) | Canonical projection consumed for task presentation when advertised; bounded, redacted, and never an authority |
| Provider Extensions (`providerExtensions` v1) | Current, experimental | Observation metadata only; provider-neutral, no public registry API, never invoked or installed by the auditor |
| Browser Verification | Current, optional host-injected | Capability boundary only; ForgeLoopAudit never launches a browser or runs Agent Browser |
| OpenSrc advisory context | Optional | Advisory metadata only; no recall execution, no lifecycle effect |
| Security Review provider | Optional | Findings would be shown with source attribution; the auditor never invokes a provider and never invents results |
| Emulated Services | Optional | Observation-only display; loopback/temporary-state semantics are ForgeLoop's |
| Task abandon | Current | History/state display, released claims via canonical recovery, never completion |
| Contract revise | Current | Historical/current contract display; dependent artifacts invalidated by the revision are never shown as current |
| Checkpoint revalidate | Current | Timeline/read-model display as a checkpoint refresh, never new execution or completion |
| Reviewing reconciliation bootstrap | Current | Canonical reconciliation result is displayed; the auditor never infers the bootstrap from file presence |
| Continuity `NOT_APPLICABLE` | Current | Supported as a canonical continuity state, distinct from invalid continuity |

| Project / Build | Integration API | Result |
| --- | --- | --- |
| Pinned ForgeLoop build (`2.0.0 @ 4ff11bb...`) | Integration API v1 valid (`INTEGRATION_V1`) | Full tested ForgeLoopAudit capability set, including the Audit UX read model, provider-extension boundaries, canonical handoffs v2 with exactly-once ledger-backed acceptance, advisory context providers v1, Repository Index/Search and multi-language/nested-project routing context; protocol/schema/API remain v1 |
| Other protocol-v1 / Integration API v1 build | Required core capabilities present; optional capability absent | Core support remains `INTEGRATION_V1`; optional panels and verification-execution provenance are enabled only when their individual capability contracts are advertised; the affected feature is unavailable |
| Any protocol-v1 build | Missing CORE required resources or capability drift | Rejected with `INCOMPATIBLE` (fails closed; missing core resources, unsupported recovery contract, or broken executor parity) |
| Protocol-v1 project | Integration API unavailable | Degraded mode (`ARTIFACT_ONLY`): visual reading + schema validation; canonical ownership and optional canonical projections are unavailable |
| ForgeLoop 1.3 / legacy protocol 1 | Integration API not applicable | `ARTIFACT_ONLY`: visual reading + schema validation; canonical ownership is never inferred from raw artifacts or the legacy CLI |
| Unknown protocol version | any | Rejected with an explicit incompatibility error (`INCOMPATIBLE`) |
| Incompatible schema version | any | Rejected with an explicit incompatibility error (`INCOMPATIBLE`) |
| Invalid ownership (e.g. `claimState=INCONSISTENT`) | API v1 | Project opens read-only with a prominent ownership inconsistency state |

### Capability degradation vs incompatibility

ForgeLoopAudit explicitly distinguishes core compatibility from additive optional features:

- **Missing CORE required resources or contract drift &rarr; `INCOMPATIBLE`**: Core resources (`protocol/info`, `project/tasks`, `task/status`, `task/ownership`, `task/contract`, `task/continuity`), Integration API version mismatch, broken executor parity, or incomplete `taskClaimRecovery` fail closed to `INCOMPATIBLE`.
- **Missing OPTIONAL resources or feature contracts &rarr; Affected feature unavailable**: Optional resources (`task/actions`, `task/action`, `task/approvals`, `task/metrics`, `task/evaluations`, `project/capability-policy`, `task/workspace-binding`, `task/handoffs`, `task/responsibility`, `task/verification-scope`, `task/attestation`) or observability command restrictions degrade individual panels/views gracefully without compromising core protocol compatibility.

ForgeLoop 2.0.0 retains the Repository Index/Search architecture introduced
in the prior capability line, together with the canonical handoff acceptance
and advisory context capability contracts and the additive workspace binding,
responsibility, differential verification scope and code attestation resources.
It adds the Audit UX read model, the provider-extension boundary, the explicit
abandonment/contract-revision/checkpoint-revalidation lifecycle events, and the
expanded specialist-guide set.
ForgeLoopAudit reads these resources through selected-task, read-only adapter methods
and keeps their failures independent. The additive features are not core
compatibility gates: when one is missing or incomplete, the project remains
`INTEGRATION_V1` and only that feature is unavailable. ForgeLoopAudit also displays
persisted verification-execution isolation provenance without creating or
attesting isolation environments.

### Provider extension boundary

ForgeLoop 2.0.0 retains `providerExtensions` v1 through `protocol/info` as a
provider-neutral, experimental capability with kinds such as `ADVISORY_CONTEXT`,
`VERIFICATION_EXECUTION`, `BROWSER_VERIFICATION`, `SECURITY_REVIEW` and
`PRESENTATION`. ForgeLoopAudit feature-detects this advertisement defensively
and displays it as observation metadata only. It does not import private
ForgeLoop provider modules, does not call `runBrowserVerification`,
`runSecurityReview` or emulated-services adapters, does not install providers,
and never promotes provider output to lifecycle state, ownership, claims,
evidence, publication or completion. Unknown future provider kinds and versions
degrade to unadvertised rather than being reinterpreted.

### Routing boundary

ForgeLoop 2.0.0 owns structured multi-language project detection,
monorepo scope matching and selection of the canonical specialist guides,
including C, C++, Java, SQL, Go, TypeScript, PHP, Swift, Node.js backend, Rust,
Flutter and .NET/ASP.NET Core routing.
ForgeLoopAudit accepts string-valued `guides` and `selectedGuideIds` such as
`["flutter", "clean", "test"]`, preserves their canonical order, and leaves
unknown additive guide IDs intact when the upstream schema permits them. The
auditor does not parse `pubspec.yaml`, maintain a guide registry, recompute
routing, or interpret a selected guide as evidence that tooling ran or that a
task is complete. When a route exposes the canonical
`MANDATORY_SAFETY_GUIDE` reason, the auditor preserves it verbatim and never
implies that a provider exclusion can override mandatory security guidance.

## Adaptive execution-profile context and efficiency observability

ForgeLoop 1.7.0 adds the canonical `task/context` projection for requested
profile, safety floor, resolved profile, escalation, bounded context policy and
context invariants. ForgeLoopAudit reads this projection only when the host advertises
the complete capability contract. Older hosts receive an explicit balanced
compatibility projection; an advertised but unavailable or malformed resource
remains unavailable. Usage is host/provider-reported or `UNKNOWN`; ForgeLoopAudit does
not estimate tokens, time or cost. Context inflation and benchmark regression
statuses are observational diagnostics and never change lifecycle authority.

## Canonical boundary resources

The optional resources are consumed from the ForgeLoop Integration API rather than reconstructed from local artifacts:

| Resource | ForgeLoopAudit presentation | Non-goal |
| --- | --- | --- |
| `task/workspace-binding` | Current binding status and bounded identity details | ForgeLoopAudit never binds or rebinds a workspace |
| `task/handoffs` | Immutable handoff snapshots and normalized acceptance in a separate Continuity surface | A handoff or acceptance receipt is not evidence, authority or delegation |
| `task/responsibility` | Responsibility status, frozen inputs, changed paths and errors | ForgeLoopAudit never sets responsibility |
| `task/verification-scope` | Persisted requested `AUTO`, `CHANGED`, `CLAIMED` or `FULL` mode and resolved `CHANGED`, `CLAIMED`, `FULL` or `UNRESOLVED` mode | ForgeLoopAudit never computes scope and never presents `IMPACTED` |
| `task/attestation` | Lazy status, trust level, signature state, signer and errors | ForgeLoopAudit never creates or signs attestations; external signing-provider verification is never automatic |

All boundary features degrade independently. A valid workspace or handoff
resource remains visible if responsibility is invalid, verification scope is
absent, or attestation is disabled.

## Canonical handoff acceptance and advisory context

`canonicalHandoffs v2` is supported only when ForgeLoop advertises immutable,
non-authoritative, non-evidence, exactly-once, ledger-backed acceptance through
the `handoff-accept` command and the statuses `OPEN`, `ACCEPTED`, `UNBOUND` and
`INCONSISTENT`. ForgeLoopAudit reads `handoff.acceptance` and renders an accepted
handoff as **Accepted — operational receipt only**. The receipt does not create
claims, evidence, authority, delegation or completion state, and ForgeLoopAudit has no
Accept control.

`advisoryContextProviders v1` is optional and supported only when the provider
is neutral, Integration API-only, lazy, opt-in, not persisted by ForgeLoop,
non-authoritative, non-evidence and non-executable. ForgeLoopAudit reports whether the
host advertises this contract but does not load memory, call recall, display
retrieved results or persist provider output. This includes the optional
host-injected Ripwire adapter remains an upstream capability
(`createRipwireAdvisoryContextProvider`): ForgeLoopAudit never creates the
provider, supplies an executable path or expected version, or invokes recall,
so Ripwire process execution is never triggered from the auditor. Missing or malformed trust fields
show **Not advertised**.

## Verification Scope vs Attestation Coverage

Verification scope records what ForgeLoop planned or resolved for a check. Resolved `UNRESOLVED` remains distinct from an unknown ForgeLoopAudit value. Attestation records the state of a code attestation and its completion-ledger binding. Scope is not coverage proof, and ForgeLoopAudit never promotes `AUTO`, `CHANGED`, `CLAIMED` or `FULL` into `PROCESSED`, `VERIFIED` or `ATTESTED`. ForgeLoopAudit never creates or signs attestations and may request canonical local content verification only when no external signing-provider execution is required. External signing-provider verification is never triggered automatically. An optional external Sigstore bundle is displayed only as bounded external data; its presence alone never produces `ATTESTED`.

## Continuity vs Canonical Handoff

Continuity is the mutable resume context for a task. A canonical handoff is an immutable ForgeLoop snapshot with its own identity and integrity semantics. ForgeLoopAudit presents both, but never merges them into one timeline or labels a handoff as review/completion evidence.

## Authority boundary

Semantic facts come exclusively from the bundled `@cassiomc1/forgeloop/integration` subpath:

- `protocol/info` — protocol/schema compatibility (`compatibility.schemaVersion`; there is no top-level `schemaVersion`);
- `project/tasks` — canonical task discovery; in `INTEGRATION_V1` it drives semantic task existence: filesystem namespaces only locate artifacts and produce diagnostics (extra namespaces are never promoted into tasks, corrupt namespaces never become synthetic `RECEIVED` tasks, and an unavailable discovery fails closed instead of falling back to the filesystem);
- `task/status`, `task/ownership`, `task/contract`, `task/continuity` — canonical per-task facts.
- `task/context` — optional ForgeLoop 1.7.0 execution-profile context; ForgeLoopAudit consumes the bounded canonical projection and never classifies work locally or infers provider usage.
- `task/workspace-binding`, `task/handoffs`, `task/responsibility`, `task/verification-scope`, `task/attestation` — optional ForgeLoop 1.10.0 boundary resources; ForgeLoopAudit consumes their canonical status without reimplementing workspace identity, handoff validation, responsibility validation, scope resolution or attestation verification.
- `task/audit-view` — optional ForgeLoop 2.0.0 bounded Audit UX read model (`auditUx` v1); when the complete contract is advertised, ForgeLoopAudit renders the canonical lifecycle, verification, completion, ownership, integrity and timeline context. It is redacted, paginated, and never treated as an authority or a source of locally derived findings.
- `canonicalHandoffs v2`, `advisoryContextProviders v1` — optional capability contracts; ForgeLoopAudit fails closed on incomplete trust fields and never invokes mutating handoff or recall operations.
- `executions/exec-*.json` — bounded read-only execution detail artifacts; ForgeLoopAudit validates and displays persisted verification provenance, including recorded isolation metadata when available, without deriving sandbox semantics.
- `history`, `trace`, `reflect`, `inspect` — canonical read-only observability projections; ForgeLoopAudit does not recompute their semantics.
- `task/actions`, `task/action`, `task/approvals`, `task/metrics`, `task/evaluations`, `project/capability-policy` — canonical read-only action, approval, policy and trajectory projections.

Policy status and the canonical `next` action also run through this boundary; in `INTEGRATION_V1` the external ForgeLoop CLI is never spawned for policy, status or next. Mutating commands such as action authorization, approval resolution, reconciliation, execution and recovery remain unavailable to the ForgeLoopAudit UI.

The ForgeLoopAudit never reimplements ForgeLoop rules (claim release, recovery validation, locks, CAS, transactions, migration). Direct `.forgeloop/` artifact reading remains available for detail views, previews, validation and diagnostics only; it never determines current owner, effective claims, `mutationAllowed`, or recovery validity.

Capability negotiation selects one of three compatibility modes: `INTEGRATION_V1`, `ARTIFACT_ONLY`, or `INCOMPATIBLE`. Any capability drift (Integration API version, executor parity, `taskClaimRecovery` feature flags, missing resources) fails closed to `INCOMPATIBLE`. There is no selectable legacy mode: ForgeLoop 1.3 projects carry no explicit legacy marker in their artifacts, so the ForgeLoopAudit never infers one — it degrades to `ARTIFACT_ONLY` instead of pretending to provide canonical semantics.

## Trusted schemas

Refresh the trusted schema set only from a controlled ForgeLoop checkout:

```bash
node scripts/generate-schema-provenance.mjs \
  --source .. \
  --commit 4ff11bb4bc4be39b095a151a323f1388dad0d819 \
  --package-version 2.0.0
npm run protocol:schemas:verify
```

The trusted set includes `task-recovery.schema.json`, `execution.schema.json`, `action.schema.json`, `approval.schema.json`, `capability-policy.schema.json`, `trajectory-evaluation.schema.json`, `workspace-binding.schema.json`, `handoff-envelope.schema.json`, `responsibility.schema.json`, `verification-scope.schema.json`, `code-manifest.schema.json`, `code-attestation.schema.json`, `in-toto-statement.schema.json` and `attestation-verification-result.schema.json`, together with their safe local `$ref` dependencies. Project-controlled `.forgeloop/schemas` content is never a ForgeLoopAudit trust authority. The external Sigstore bundle is intentionally not assigned a ForgeLoop schema. Signed distribution is not required for the current unsigned preview policy; checksums, provenance, and public post-publish verification are required instead.

Release publication and verification are documented separately in the
[release model](RELEASE_MODEL.md); a compatible local project is not evidence
that a public release has been published.

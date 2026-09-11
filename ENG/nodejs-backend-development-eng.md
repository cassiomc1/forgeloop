---
name: nodejs-backend-development-eng
language: en
description: "Specialist guidance for architecture, implementation, testing, security, performance, observability, and release of production Node.js backend services and workers."
version: "2026.09"
last-reviewed: "2026-09-11"
guide-id: nodejs
requires-gates:
  - threat-boundary
completion-evidence:
  - nodejs-validation
---

# Node.js Backend Development Engineering Guide

> Production-oriented guidance for Node.js APIs, HTTP services, workers,
> command-line backends, and event-driven applications.
>
> This guide is activated only by bounded structural evidence for an affected
> project root: an ordinary `package.json` with an allowlisted runtime backend
> dependency, a direct Node runtime script, or a valid runtime-surface source
> file that imports a Node server/network built-in. A `package.json` alone, a
> frontend package, a lockfile, `engines.node`, `@types/node`, a Dockerfile, or
> CI setup alone is not backend evidence. Node.js execution used only for build,
> test, or configuration tooling is not sufficient backend/runtime evidence.
> Detection is read-only, bounded, non-networking, and never executes package
> scripts or source code.
>
> This guide complements [`clean-code-eng.md`](./clean-code-eng.md) for
> maintainability, [`test-code-eng.md`](./test-code-eng.md) for verification,
> [`sec-code-eng.md`](./sec-code-eng.md) for trust boundaries,
> [`perf-code-eng.md`](./perf-code-eng.md) for measured optimization, and
> [`documentation-quality-eng.md`](./documentation-quality-eng.md) for public
> technical documentation.
>
> Tooling policy: inspect the repository and use already-available tools first.
> Do not install Node versions, package managers, dependencies, databases,
> containers, browsers, or global utilities merely to satisfy a check. If a
> required check cannot run, record `NOT_VERIFIED` or `BLOCKED`; never claim it
> passed.

## 1. Mission and activation contract

The Node.js specialist exists to make backend changes that are:

- correct for the repository's declared Node runtime and module system;
- explicit about request, process, worker, persistence, and external-service
  boundaries;
- safe when inputs, dependencies, configuration, and network peers are
  untrusted;
- testable at the narrowest level that proves the changed behavior and at
  broader levels where integration risk requires it;
- observable under success, failure, timeout, retry, cancellation, and
  shutdown paths;
- measurable when throughput, latency, memory, startup, queue depth, or
  connection cost is relevant;
- deployable with evidence from the exact code, configuration, and package
  graph that will ship.

Do not select a framework, package manager, ORM, transport, or deployment
model because it is fashionable. Prefer repository truth and the smallest
coherent change.

### Primary evidence

The project detector uses three independent strong signals:

1. A valid `package.json` contains a runtime backend dependency from the
   bounded allowlist: `express`, `fastify`, `@nestjs/core`, `koa`, or
   `@hapi/hapi`. Runtime dependencies are read from `dependencies` and
   `optionalDependencies`; development-only dependencies do not activate the
   specialist.
2. A valid `package.json` contains a direct script whose command begins with
   `node` or `node.exe`, including ordinary Node flags such as `--watch` or
   `--env-file`. The detector does not follow `npm`, `npx`, arbitrary wrappers,
   substring matches, or prose containing the word `node`.
3. A bounded JavaScript or TypeScript source scan finds a narrow import,
   re-export, `require`, or dynamic import of `node:http`, `node:https`,
   `node:http2`, `node:net`, `node:tls`, or `node:dgram`. Legacy bare
   equivalents are accepted only in the same narrow syntactic forms. Source-
   only confirmation also requires a plausible runtime application surface,
   such as `src`, `lib`, `server`, `worker`, `service`, `api`, `backend`, or a
   recognized runtime-entry filename; generic tooling/configuration surfaces
   do not qualify.

The source rule is deliberately conservative. Comments and template-literal
text do not count; `import type`, `export type`, `import { type X }`, and
`export { type X }` do not count when every specifier is type-only; mixed
declarations count only when a runtime value specifier is safely recognized;
unsupported complex declarations fail closed. Declaration files (`*.d.ts`,
`*.d.mts`, and `*.d.cts`) do not count. Source beneath `test`, `tests`,
`__tests__`, `fixtures`, `mocks`, `examples`, `docs`, `coverage`, `dist`,
`build`, `scripts`, `tools`, `tooling`, `config`, `configs`, `codegen`,
`generators`, `node_modules`, `.next`, `.turbo`, or Storybook directories does
not provide runtime evidence. Common `*.config.js`, `*.config.mjs`,
`*.config.cjs`, `*.config.ts`, `*.config.mts`, and `*.config.cts` files are
tooling/configuration surfaces and do not provide source-only evidence.
Bounded source and manifest reads are discovery signals only. Confirmed nested
Flutter, .NET, and Node project roots form framework-agnostic ownership
boundaries for scans, claims, and shared files. Runtime re-exports count when
they contain at least one safely classified value specifier because the guide
covers Node.js server/runtime library surfaces as well as services and workers.

`engines.node`, `type`, `packageManager`, workspaces, lockfiles, `.nvmrc`,
`.node-version`, `@types/node`, TypeScript, `tsx`, Docker, and CI are
supporting context. They can guide scope matching but cannot replace primary
evidence. Malformed or oversized manifests fail closed.

## 2. Authority, discovery, and scope

Resolve conflicts in this order:

1. Platform and safety rules.
2. The user's latest explicit request.
3. Repository-local instructions, including `AGENTS.md`, `PROJECT_PROFILE.md`,
   `LOOP_ENGINEERING.md`, and nested instructions.
4. Actual manifests, source, tests, CI, deployment configuration, and runtime
   evidence.
5. Existing public contracts and established architecture.
6. This guide.
7. Official documentation for the pinned Node version and framework.
8. Community examples.

Before implementation, inspect the smallest complete set of sources that can
explain the change:

- bounded `package.json` files from the affected package root and confirmed
  nested package roots;
- the lockfile and package-manager configuration that owns that root;
- `.nvmrc`, `.node-version`, `.tool-versions`, CI runtime setup, and container
  base images when they affect the executable environment;
- the application entry point, route modules, middleware, adapters, workers,
  jobs, event handlers, and shutdown hooks;
- configuration schemas, environment loaders, secret references, and
  deployment manifests;
- persistence registrations, migrations, repositories, transactions, and
  connection-pool settings;
- authentication, authorization, CORS, CSRF, rate limiting, request-size,
  proxy, and network-boundary configuration;
- unit, integration, contract, load, smoke, and operational tests;
- release notes and API documentation for changed public behavior.

Detection is discovery input, not proof that the service is healthy. A route
claim that names a nested package, lockfile, configuration file, source file,
or workspace root must activate only the confirmed Node project whose scope
contains that claim. A root workspace coordinator may select confirmed Node
descendants; unrelated frontend packages remain isolated.

## 3. Runtime and module-system decisions

Record the actual runtime range before changing APIs:

- inspect `engines.node`, version files, CI matrices, container images, and
  release policy together;
- preserve the supported major unless a runtime migration is an explicit
  deliverable;
- verify new built-ins and platform APIs against the oldest supported runtime,
  not only the local `node --version`;
- treat ESM/CommonJS interop, package `exports`, conditional exports, and
  test-runner behavior as public compatibility concerns;
- keep package-manager, lockfile, and workspace changes intentional and
  reproducible.

For ESM, use explicit file extensions where the repository requires them,
avoid deep imports that bypass package exports, and keep import-time side
effects small. For CommonJS, keep `require` boundaries consistent with the
existing package contract and do not mix module systems casually. For either
system, do not hide asynchronous initialization behind an import side effect.

## 4. Architecture and process lifecycle

### Request and process boundaries

Separate transport concerns from application decisions:

- route handlers translate HTTP input into a validated application command;
- application services enforce use-case invariants and coordinate boundaries;
- adapters own framework, database, filesystem, queue, and external-service
  details;
- serialization and status-code decisions remain at the transport boundary;
- domain errors are not allowed to leak stack traces, SQL, tokens, or internal
  topology to clients.

Keep the composition root explicit. Construct the logger, configuration,
clients, pools, repositories, queues, and server in a controlled startup path.
Make startup failure visible and make shutdown bounded and observable.

### Modular monoliths and service boundaries

Use modules that own a coherent capability rather than folders that mirror
technical layers without responsibility. Define imports between modules by
contract. Avoid importing a database model, framework request object, or
process-global mutable singleton across every feature.

If the repository is a monolith, do not create a distributed system merely to
hide coupling. If a service boundary is real, document the contract,
ownership, timeout, retry, idempotency, versioning, and failure behavior.

### Workers, jobs, and command-line processes

Workers and CLIs still require production discipline:

- parse arguments and environment values as untrusted input;
- make retries bounded and idempotent;
- acknowledge queue messages only after durable work completes;
- handle cancellation and termination signals;
- avoid overlapping work unless concurrency is explicit and safe;
- emit a stable exit status and actionable structured logs;
- make replay, dead-letter, and partial-failure behavior testable.

## 5. JavaScript and TypeScript implementation

Use the repository's established language and compiler policy. TypeScript is a
tool for expressing boundaries, not permission to rewrite a JavaScript module
without need.

- validate external data at the boundary before it enters typed code;
- prefer narrow interfaces and explicit return types for public adapters;
- keep `unknown` at trust boundaries and narrow it deliberately;
- avoid `any`, unsafe casts, ambient mutable state, and hidden coercion;
- preserve error causes with `new Error(message, { cause })` where supported;
- avoid floating promises; make ownership of every asynchronous operation
  clear;
- use `AbortSignal` for cancellable I/O where the dependency supports it;
- use `Promise.all` only when concurrent failure and resource pressure are
  understood; use bounded concurrency for collections;
- do not rely on timing, object-key order, locale, or implicit timezone in
  protocol behavior.

Linting and formatting are part of the repository contract. Do not weaken a
rule globally to make one change convenient; document a narrowly scoped
exception when the existing rule cannot express the correct code.

## 6. Framework and transport guidance

### Express

Keep middleware ordering explicit. Register request IDs and safe logging before
business middleware, parsers before routes that need them, authentication
before protected routes, and the error handler last. Set body-size, parameter,
header, timeout, and proxy-trust policy deliberately. Do not treat
`req.body`, `req.params`, `req.query`, or `req.headers` as validated data.

### Fastify

Use schemas for request and response boundaries and keep route registration
modular. Understand hook order, encapsulation, serializer behavior, and the
consequences of decorating the request or server. Do not bypass the framework's
validation and serialization pipeline without measuring the compatibility and
security impact.

### NestJS

Keep modules, providers, guards, pipes, interceptors, and filters aligned with
their responsibilities. Validate DTOs at the boundary, keep provider scopes
intentional, and make dynamic-module configuration explicit. Avoid leaking
request-scoped dependencies into singleton state or placing business rules in
decorator-heavy infrastructure where they cannot be tested directly.

### Koa and hapi

For Koa, make middleware `await next()` behavior and error propagation
explicit; a missing `await` can silently change the response lifecycle. For
hapi, keep route options, payload limits, validation, authentication, and
response schemas close to the route contract. In both frameworks, test
ordering, rejection, timeout, and malformed-input behavior.

### Raw Node HTTP and other adapters

When using `node:http` or another low-level transport, explicitly handle:

- header and body limits;
- request cancellation and socket errors;
- content type and character encoding;
- streaming backpressure;
- timeout and keep-alive policy;
- status, headers, and response termination exactly once;
- malformed requests and partial reads.

Do not build a second ad hoc framework in route handlers. Extract reusable
parsing, validation, and response contracts when the low-level adapter grows.

## 7. Configuration, environments, and secrets

Configuration is an input contract. Load it once at the composition root,
validate it against an explicit schema, normalize safe defaults, and pass the
result to components rather than reading `process.env` throughout the code.

- distinguish required values, optional values, and environment-specific
  defaults;
- reject invalid ports, URLs, durations, enum values, and pool sizes at
  startup;
- keep secret values out of logs, errors, snapshots, receipts, and test
  fixtures;
- never commit `.env` files or use a repository file as a secret store;
- make development defaults obviously non-production;
- document which system owns secret injection and rotation;
- test missing, malformed, and conflicting configuration without printing the
  secret itself.

When a configuration value controls a trust boundary—proxy trust, CORS,
redirects, callback URLs, TLS verification, debug output, or authorization—do
not use a permissive fallback merely to keep startup alive.

## 8. HTTP API and data contracts

Treat an API as a compatibility surface:

- define accepted methods, content types, encodings, size limits, and status
  codes;
- validate path, query, header, and body inputs with a single authoritative
  schema or parser;
- make optional, nullable, empty, and missing values distinct where the
  contract requires it;
- return stable machine-readable error codes and safe human messages;
- avoid reflecting arbitrary input into headers, HTML, logs, or error details;
- serialize only fields intentionally exposed by the public contract;
- document pagination, sorting, filtering, idempotency keys, and concurrency
  behavior;
- reject ambiguous duplicate parameters and conflicting content negotiation.

For changes to public behavior, add or update a contract test and record the
compatibility decision. A successful unit test of a controller does not prove
the wire contract.

## 9. Middleware, hooks, and cross-cutting behavior

Cross-cutting behavior must have an observable order and owner. For every
middleware or hook, document whether it can reject, mutate, short-circuit,
retry, stream, or call downstream code more than once.

At minimum, reason about:

- request correlation and structured logging;
- authentication and authorization;
- input parsing and validation;
- rate limiting and abuse controls;
- timeout and cancellation propagation;
- compression and response buffering;
- CORS, CSRF, and security headers;
- metrics and tracing without sensitive-cardinality explosions;
- centralized error mapping and safe response serialization.

Do not add a global hook for a local rule. Do not let a convenience middleware
silently trust forwarded headers, disable TLS verification, or swallow a
rejection.

## 10. Persistence, external services, and state

Make resource ownership explicit:

- create connection pools and clients once per process unless the library
  requires another lifecycle;
- close or drain them on shutdown;
- set connection, query, and request timeouts separately;
- bound retries and preserve idempotency across retries;
- keep transactions around the smallest unit that needs atomicity;
- make migration ownership and rollback expectations explicit;
- do not mix an external side effect into a database transaction without an
  outbox, compensation, or otherwise documented consistency strategy;
- avoid N+1 queries and unbounded result sets;
- redact connection strings, authorization headers, and provider error details.

For third-party APIs, define the contract, timeout, retry budget, circuit or
backoff policy, rate-limit behavior, and test double at the adapter boundary.
Never allow a provider outage to become an unbounded request queue.

## 11. Security and trust boundaries

Use [`sec-code-eng.md`](./sec-code-eng.md) as the complete security guide.
Node.js-specific review must still cover:

- prototype pollution through deep merge, query parsing, or unsafe object
  assignment;
- path traversal and unsafe filesystem paths;
- command injection through child-process arguments or shell invocation;
- SSRF through user-controlled URLs, redirects, DNS resolution, proxies, or
  cloud metadata endpoints;
- request smuggling, ambiguous transfer encoding, header injection, and
  parser differentials at proxy boundaries;
- ReDoS and unbounded parsing, decompression, JSON, multipart, and regex work;
- insecure deserialization and unsafe dynamic evaluation;
- token, cookie, session, CORS, CSRF, and authorization mistakes;
- WebSocket origin, authentication, message-size, and connection-lifetime
  controls;
- dependency confusion, typosquatting, lifecycle scripts, lockfile drift, and
  compromised transitive packages.

Prefer parameterized APIs and argument arrays over shell strings. Allowlist
outbound destinations when the product permits it. Resolve and validate URLs
before connecting, cap redirects, and test private-address and DNS-rebinding
cases. Set body, header, upload, decompression, and queue limits before adding
feature behavior.

Do not claim a security check merely because a package is present. Capture the
exact check, input boundary, result, and limitations.

## 12. Authentication, authorization, and sessions

Authentication answers who a principal is; authorization answers what that
principal may do in this context. Keep them separate and test both allow and
deny paths.

- verify issuer, audience, algorithm, key rotation, expiry, not-before, and
  clock-skew policy for signed tokens;
- keep session identifiers opaque, rotated, bounded, and revocable;
- use secure cookie attributes appropriate to the deployment topology;
- do not trust user-provided identity, role, tenant, or ownership fields;
- enforce object-level authorization after resource lookup and before output;
- make tenant, organization, and account boundaries explicit;
- rate-limit login, recovery, token exchange, and high-cost operations;
- avoid logging credentials, tokens, authorization headers, or sensitive claims.

Test expired, malformed, replayed, cross-tenant, insufficient-scope, and
missing-credential requests. A happy-path login test is not authorization
coverage.

## 13. Errors, logging, metrics, and tracing

Define an error taxonomy that distinguishes client input, authentication,
authorization, dependency, persistence, cancellation, timeout, and programmer
failures. Map internal failures to safe transport responses at one boundary.

Structured logs should include a correlation ID, operation, outcome, duration,
and stable error code. They should not include secrets or uncontrolled user
content. Use bounded field lengths and avoid high-cardinality labels.

Metrics should answer operational questions: request rate, error rate, latency
distribution, saturation, queue depth, retry count, pool utilization, and
shutdown duration. Traces should preserve causality across outbound calls and
queues without exporting sensitive payloads. Test that failures emit enough
context to diagnose them without exposing internals.

## 14. Performance, concurrency, and backpressure

Measure before optimizing. Establish a representative workload, runtime,
hardware or container limits, baseline, and acceptance threshold.

- keep the event loop free of unbounded synchronous CPU or filesystem work;
- stream large inputs and outputs when the contract permits it;
- bound concurrency for fan-out and batch work;
- propagate backpressure through streams and queues;
- use timeouts and cancellation for every external or potentially blocking
  operation;
- watch memory retention from closures, caches, listeners, timers, and request
  context;
- use connection pools and keep-alive settings deliberately;
- distinguish cold-start, warm-start, steady-state, and overload behavior.

Do not convert an asynchronous operation to synchronous I/O to simplify a test
or add a cache without an invalidation and memory policy. Performance evidence
must identify the measured path and environment; a local timing anecdote is not
a production claim.

## 15. Queues, events, WebSockets, and streams

For queues and events, specify delivery semantics, message identity, ordering,
retry/dead-letter behavior, visibility timeout, deduplication, and schema
versioning. Consumers should be idempotent and tolerant of redelivery.

For WebSockets and long-lived connections, define authentication lifetime,
origin policy, heartbeat, idle timeout, message-size limit, per-connection
memory, backpressure, reconnect, and shutdown behavior. Do not treat a socket
as a trusted authenticated session forever.

For streams, handle partial reads, aborts, errors, backpressure, and cleanup.
Test disconnects and downstream slowness, not just a complete happy stream.

## 16. Testing and verification

Choose tests by the risk they prove:

- pure unit tests for parsers, validation, policies, error mapping, and
  deterministic decisions;
- integration tests for middleware order, composition-root wiring, database
  boundaries, queues, and external adapters;
- contract tests for HTTP status, headers, schemas, errors, pagination, and
  compatibility;
- adversarial tests for malformed JSON, oversized inputs, unknown fields,
  prototype keys, path traversal, SSRF, timeouts, cancellation, retries,
  duplicate delivery, and partial shutdown;
- load or benchmark tests only when a measurable performance requirement exists;
- smoke tests against the packaged or built artifact when packaging is part of
  the change.

Tests must not execute untrusted package scripts as a side effect of detection.
Use isolated temporary projects for detector tests. Cover:

- Express, Fastify, NestJS, raw HTTP, CommonJS, and ESM positive evidence;
- worker or CLI `node` scripts;
- React/Vite, Next-only, engines-only, `@types/node`-only, devDependency-only,
  Docker-only, CI-only, lockfile-only, malformed, and oversized negatives;
- nested package roots, workspace-root claims, shared lockfiles, mixed
  Flutter/.NET/Node repositories, symlinks, and traversal budgets;
- documentation/UI-copy/mobile-only work exclusions and explicit no-match
  claims.

Run focused tests first, then proportional regression checks. Record the exact
command and observed result. Missing tools are `NOT_VERIFIED`, not green.

## 17. Deployment, containers, and CI

Align local, CI, container, and production runtimes. Pin or constrain the Node
major intentionally, use a reproducible lockfile, and install dependencies with
the package manager selected by the repository.

- use a non-root runtime user where the deployment supports it;
- keep build-time and runtime files separate;
- do not copy secrets into images or artifacts;
- use a minimal production dependency set without hiding native runtime needs;
- provide health and readiness checks that reflect real dependencies;
- implement graceful shutdown for the orchestrator's termination window;
- configure resource limits and observe event-loop, memory, and pool health;
- ensure CI checks the same package and generated artifacts that will ship.

Container or CI configuration alone does not prove that a project is a Node
backend, but it is important corroborating evidence after the affected package
has been confirmed.

## 18. Documentation and operational handoff

Document the reader's job, not the implementation trivia. For an API or worker,
cover:

- startup prerequisites and supported runtime;
- configuration names, types, defaults, and secret ownership;
- endpoints or job contracts, authentication, limits, and error codes;
- local development and focused verification commands;
- migrations, rollback, replay, dead-letter, and recovery procedures;
- health, readiness, metrics, logs, traces, and alert meanings;
- compatibility, deprecation, and versioning policy.

Keep examples runnable or label them clearly as pseudocode. Redact secrets and
avoid copying production identifiers. Update docs when behavior, configuration,
contracts, operational ownership, or package boundaries change.

## 19. Anti-patterns and failure modes

Reject these shortcuts during review:

- classifying any `package.json` as a backend;
- treating `engines.node`, TypeScript, `@types/node`, Docker, or CI as primary
  runtime evidence;
- allowing a frontend, workspace coordinator, or nested package to activate a
  sibling backend guide;
- executing package scripts, installing dependencies, importing source, or
  making network calls during project detection;
- reading unbounded manifests or source files, treating comments/type-only
  declarations or build/config tooling as runtime evidence, or following
  symlinks outside the target;
- placing business logic in framework middleware or a controller until it is
  impossible to test without the framework;
- swallowing promise rejections, timeout, abort, or shutdown errors;
- retrying non-idempotent work without an idempotency contract;
- logging request bodies, credentials, tokens, or provider responses by default;
- claiming performance, security, deployment, or production readiness from a
  unit test or a local build alone.

## 20. Node.js backend Definition of Done

Before completion, confirm the applicable items:

- [ ] The affected package and supported runtime/module system are identified.
- [ ] The route is based on primary evidence and explicit claim scope.
- [ ] Inputs, configuration, authentication, authorization, and outbound
      boundaries are validated and bounded.
- [ ] Errors, timeouts, cancellation, retries, shutdown, and partial failure
      behavior are explicit.
- [ ] Focused unit, integration, contract, and adversarial tests cover the
      changed risk; missing tooling is reported honestly.
- [ ] Performance claims have a baseline and measurement when relevant.
- [ ] Logs, metrics, traces, health, and operational recovery are adequate for
      the changed path.
- [ ] Documentation and package/lockfile changes match the shipped behavior.
- [ ] The exact final revision, checks, limitations, and publication/deployment
      state are reported separately.

## 21. Sources and further reading

Prefer the documentation for the pinned versions in the repository. Latest or
Current Node.js documentation is not an automatic production target: establish
the repository's runtime truth first, use documentation for the matching major,
and do not migrate merely because a newer Current release exists. For greenfield
production services, prefer a supported LTS release unless a documented
requirement justifies Current.

Useful primary references include:

- [Node.js documentation](https://nodejs.org/docs/latest/api/)
- [Node.js LLM documentation index](https://nodejs.org/docs/latest-v26.x/llms.txt)
- [Node.js release policy](https://nodejs.org/en/about/previous-releases)
- [Node.js HTTP](https://nodejs.org/api/http.html), [HTTP/2](https://nodejs.org/api/http2.html),
  [net](https://nodejs.org/api/net.html), and [TLS](https://nodejs.org/api/tls.html)
- [Node.js package exports](https://nodejs.org/api/packages.html)
- [Express](https://expressjs.com/), [Fastify](https://fastify.dev/docs/latest/),
  [NestJS](https://docs.nestjs.com/), [Koa](https://koajs.com/), and
  [hapi](https://hapi.dev/)
- [TypeScript handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [OWASP API Security Top 10](https://owasp.org/API-Security/editions/2023/en/0x11-t10/)
- [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP Node.js security guidance](https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html)
- [RFC 9110 HTTP semantics](https://www.rfc-editor.org/rfc/rfc9110)

These sources inform implementation decisions; they do not replace the
repository's pinned runtime, local policy, tests, or ForgeLoop evidence.

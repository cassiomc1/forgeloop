---
name: dotnet-aspnetcore-development-eng
language: en
description: "Specialist guide for architecture, implementation, testing, performance, security, data access, hosting, observability, and release of production .NET and ASP.NET Core applications."
version: "2026.09"
last-reviewed: "2026-09-11"
guide-id: dotnet
---

# .NET and ASP.NET Core Development Engineering Guide

> Production-oriented guidance for ForgeLoop-enabled agents and developers working on SDK-style .NET applications, ASP.NET Core services, workers, Razor, Blazor, and conditional ABP applications.
>
> This guide is activated by structural project evidence: an SDK-style `*.csproj`, `*.fsproj`, or `*.vbproj` using a deliberate supported SDK allowlist (`Microsoft.NET.Sdk` family, `Aspire.AppHost.Sdk`, or `MSTest.Sdk`). A web, Razor, Blazor, or `Microsoft.AspNetCore.App` signal confirms ASP.NET Core context. `Volo.Abp.*` package references add the ABP overlay. A README, source comment, Dockerfile, lockfile, directory name, or package name alone does not activate this guide.
>
> This guide complements, rather than replaces, ForgeLoop's general engineering guides. Use `clean-code-eng.md` for maintainability, `test-code-eng.md` for verification, `sec-code-eng.md` for trust boundaries, `perf-code-eng.md` for measured optimization, `documentation-quality-eng.md` for technical docs, and the interface guides when the application has a user-facing surface.
>
> Tooling policy: inspect the repository and use already-available tools first. Do not install an SDK, workload, package, database, container runtime, analyzer, or global utility merely to satisfy a check. Installation or environment mutation requires authority. If a required check cannot run, report it as `NOT_VERIFIED`; never claim it passed.

## 1. Mission

The .NET specialist exists to make changes that are:

- correct for the repository's actual target frameworks, SDK, hosting model, and package graph;
- compatible with the existing architecture and public contracts unless a migration is explicitly in scope;
- explicit about trust boundaries, lifetime boundaries, cancellation, persistence, and failure behavior;
- testable at the narrowest level that proves the requested behavior and at broader levels where integration risk requires it;
- measurable when latency, throughput, allocation, startup, database, or memory cost is relevant;
- releasable with evidence from the exact code and configuration that will ship.

Prefer repository truth over a generic ASP.NET Core template. Do not introduce a new framework, architecture, persistence model, serializer, hosting model, or ABP abstraction only because it is fashionable.

## 2. Authority and precedence

Resolve conflicts in this order:

1. Platform and safety rules.
2. The user's latest explicit request.
3. Repository-local instructions, including `AGENTS.md`, `PROJECT_PROFILE.md`, and `LOOP_ENGINEERING.md`.
4. The actual project files, target frameworks, package graph, tests, CI, deployment manifests, and source code.
5. Existing public contracts and established architecture.
6. This guide.
7. Official documentation and samples for the pinned SDK/runtime.
8. Community examples.

If the repository targets an older runtime, preserve supported behavior and verify any proposed API against that target. If a migration is needed, make it an explicit deliverable rather than silently changing the target framework.

## 3. Discovery before implementation

Inspect the smallest complete set of sources that can explain the change:

- all relevant `*.csproj`, `*.fsproj`, and `*.vbproj` files;
- `Directory.Build.props`, `Directory.Build.targets`, `Directory.Packages.props`, `global.json`, and `NuGet.config`/`nuget.config` in the applicable directory scope;
- `*.sln`/`*.slnx` membership when a solution is named or changed;
- `Program.cs`, `Startup.cs`, host builders, worker entry points, and test projects;
- controllers, minimal API route groups, endpoint classes, Razor/Blazor components, hubs, middleware, filters, and binders;
- options, configuration providers, secrets references, environment manifests, and deployment files;
- persistence registrations, `DbContext` types, migrations, repositories, units of work, and transaction boundaries;
- authentication, authorization, CORS, antiforgery, rate limiting, health checks, telemetry, and exception handling;
- `appsettings*.json`, launch settings, Dockerfiles, compose/orchestrator manifests, CI workflows, scripts, and release notes;
- existing unit, integration, contract, architecture, WebApplicationFactory, TestServer, worker, browser, and database tests.

Record, when discoverable:

- SDK and runtime version, target framework(s), and roll-forward policy;
- web, worker, Razor, Blazor, library, test, or mixed project topology;
- hosting model and environment-specific startup behavior;
- dependency-injection composition root and service lifetimes;
- public endpoints, event/message contracts, serialization settings, and compatibility constraints;
- data stores, migration ownership, transaction/unit-of-work strategy, and concurrency model;
- authentication and authorization scheme, external services, secrets boundary, and observability;
- the smallest checks that prove the requested behavior.

Use structural project evidence for routing, but use source and configuration inspection for implementation decisions. A detector result is discovery input, not proof that an application is healthy.

## 4. Version-sensitive decisions

Treat these as version-sensitive:

- `global.json`, SDK selection, target frameworks, trimming, Native AOT, single-file publish, and roll-forward;
- minimal APIs, endpoint filters, route groups, output caching, rate limiting, and hosting defaults;
- authentication handlers, authorization policies, antiforgery, CORS, and identity packages;
- JSON source generation, serializer defaults, OpenAPI generation, and contract versioning;
- EF Core providers, migrations, execution strategies, interceptors, compiled queries, and transaction behavior;
- HTTP resilience, `IHttpClientFactory`, diagnostics, logging, metrics, tracing, and health checks;
- Razor, Blazor Server, Blazor WebAssembly, interactive render modes, SignalR, and static assets;
- ABP modules, dependency injection, unit of work, object mapping, authorization, and distributed events.

Determine the pinned versions first. Verify version-sensitive behavior against the official documentation and package source actually used by the repository. Do not copy a current example into an older target without checking API availability and changed defaults.

## 5. Project mental model and topology

Model the application before editing it:

```text
host / composition root
  -> middleware and endpoint pipeline
      -> application use cases
          -> domain rules
              -> persistence and external services
```

Separate concerns only to the degree the repository's complexity needs. A small service may use feature folders and direct handlers; a larger system may have host, application, domain, infrastructure, contracts, and test projects. Preserve existing dependency direction, naming, namespaces, analyzers, and generated-code boundaries.

For multi-project repositories, identify the exact project and solution membership. Do not apply a root-level change to every project just because a shared file exists. Directory-scoped MSBuild and NuGet files affect descendants; verify which projects inherit them. ForgeLoop's detector treats a claimed `global.json` as shared .NET SDK-selection scope for confirmed descendant projects for routing purposes; it does not reproduce the complete MSBuild or .NET SDK resolution algorithm.

For monorepos, keep unrelated Flutter, JavaScript, native, and .NET applications isolated. Shared configuration is evidence of scope only when the changed claim is actually in the file's applicable directory boundary.

## 6. Architecture preservation

Before introducing layers or abstractions, trace the existing path from transport to use case to persistence/external service. Make the smallest coherent change that preserves:

- public route, event, CLI, and serialized contracts;
- domain invariants and ownership of business decisions;
- dependency direction and composition-root responsibilities;
- error, cancellation, transaction, and authorization semantics;
- deployment shape, health/readiness behavior, and observability;
- generated code and source-generator configuration.

Do not use a repository, service, mediator, CQRS, generic controller, base class, or wrapper as a goal in itself. Add an abstraction when it isolates a real boundary, improves testability, or protects a contract. Remove accidental duplication only when behavior remains explicit.

## 7. Dependency injection and lifetimes

Keep registration in the composition root or the repository's established module boundary. Choose lifetimes deliberately:

- singleton services must be thread-safe and must not capture scoped services;
- scoped services are appropriate for request/unit-of-work state;
- transient services should be cheap and stateless unless the repository documents otherwise.

Avoid captive dependencies: a singleton must not retain a scoped `DbContext`, request object, `HttpContext`, or other scoped service. Prefer constructor injection. Use keyed services, factories, or explicit scopes only when the target runtime supports them and the existing design warrants them.

Validate registrations early where supported, and test the composition root for required services. Do not hide required dependencies behind service location or `IServiceProvider` calls scattered through business code.

## 8. Hosting and the ASP.NET Core pipeline

Understand the actual order of:

1. host construction and configuration;
2. service registration;
3. exception handling and security headers;
4. forwarded headers and HTTPS policy;
5. static files, routing, CORS, authentication, authorization, antiforgery, rate limiting, output/response caching, and endpoints;
6. health checks, diagnostics, and graceful shutdown.

Middleware ordering is behavior. Place authentication before authorization, CORS where the selected policy requires it, and exception handling early enough to cover intended failures. Do not add middleware that bypasses endpoint metadata, hides failures, or changes production behavior without tests.

Use environment checks carefully. Development-only diagnostics, detailed exceptions, local certificates, and permissive CORS must not leak into production. Forwarded headers and proxy configuration must match the trusted deployment boundary.

## 9. Endpoints, APIs, and contracts

For controllers, minimal APIs, SignalR hubs, Razor endpoints, and endpoint groups:

- preserve route templates, verbs, status codes, content types, and documented headers unless change is explicit;
- bind only the input the endpoint needs; do not over-post domain entities;
- validate at the boundary, then enforce invariants in the application/domain layer;
- make response and error shapes stable and serializable;
- use precise status codes and consistent problem-details handling;
- define pagination, filtering, sorting, concurrency, idempotency, and retry behavior for collection or mutation endpoints;
- keep authorization attached to the server-side endpoint/policy, not merely to client visibility;
- document breaking changes and compatibility strategy.

Do not treat generated OpenAPI as proof that runtime behavior is correct. Test the actual route, binding, authorization, serialization, and failure paths.

## 10. Configuration and options

Use strongly typed options for cohesive configuration. Validate required values at startup or at the first safe boundary, with errors that name the configuration key but never reveal secret values.

Respect provider precedence and environment overrides. Keep defaults safe. Do not commit credentials, tokens, connection strings with passwords, private keys, or production configuration. Use the repository's existing secret provider and deployment mechanism.

When changing options, inspect all consumers and environment-specific files. A property rename can be a deployment-breaking change even when compilation succeeds. Test missing, malformed, boundary, and production-like values.

## 11. Authentication, authorization, and trust boundaries

Authentication answers who the caller is; authorization answers what the caller may do. Enforce authorization server-side for every protected operation, including background-triggered or direct API calls.

Inspect scheme selection, token/cookie validation, issuer/audience, clock skew, claims mapping, policy/role/resource checks, tenant boundaries, impersonation, and denial behavior. Keep authentication credentials out of logs and URLs.

For browser flows, evaluate antiforgery, SameSite, secure cookies, CORS, CSRF, redirect validation, clickjacking protection, and content security policy according to the actual deployment. Do not use `AllowAnyOrigin` with credentials. Do not turn off certificate or token validation to make a test pass.

Treat every request body, header, query value, uploaded file, URL, webhook, message, and database value as untrusted at the relevant boundary. Validate size, format, encoding, ownership, and authorization before processing.

## 12. Validation and error handling

Use layered validation:

- transport validation for shape, required fields, limits, and parseability;
- application validation for use-case rules and authorization context;
- domain validation for invariants that must hold regardless of transport;
- persistence constraints for final integrity enforcement.

Return safe, actionable errors to callers and detailed structured diagnostics to authorized operators. Do not expose stack traces, SQL, tokens, connection strings, internal paths, or PII in public errors. Map exceptions deliberately; avoid catch-all handlers that convert cancellations or programmer errors into false success.

Use a consistent problem-details or repository-specific error contract. Test malformed input, boundary values, unauthorized/forbidden access, not-found behavior, conflict/concurrency behavior, dependency failure, cancellation, and serialization failure.

## 13. Async, cancellation, and request context

Use asynchronous APIs for I/O and propagate `CancellationToken` from the request, message, or host lifetime to downstream operations. Do not block async code with `.Result`, `.Wait()`, or `GetAwaiter().GetResult()`. Do not use `async void` except framework-required event handlers.

Pass cancellation through EF Core, `HttpClient`, streams, channels, and external SDKs. Decide explicitly whether cancellation is expected control flow or an error to report. Do not swallow `OperationCanceledException` and claim work completed.

`HttpContext` is request-scoped and is not thread-safe. Read the required values during the request, copy immutable data into a command/value object, and do not retain `HttpContext`, `HttpRequest`, `HttpResponse`, scoped services, or request streams after the request. Do not access request context from fire-and-forget work.

## 14. HttpClient and external services

Use the repository's configured `IHttpClientFactory`/typed or named clients for outbound HTTP. Configure base address, timeouts, headers, resilience, authentication, and diagnostics centrally. Avoid creating a new `HttpClient` per request and avoid an unbounded retry policy.

Set explicit cancellation and response-size/time budgets. Treat status codes, malformed payloads, timeouts, partial results, rate limits, and dependency unavailability as designed outcomes. Retry only idempotent or safely repeatable operations, with bounded backoff and observability.

Validate external URLs and redirect behavior at trust boundaries. Do not allow user-controlled URLs to reach privileged networks without an explicit SSRF-safe design. Never log authorization headers, cookies, bearer tokens, or sensitive payloads.

## 15. EF Core, data access, and persistence

Inspect the provider, `DbContext` lifetime, migrations, conventions, interceptors, query filters, tenant behavior, and transaction ownership before changing data access.

- project only required columns for read paths;
- use `AsNoTracking` for read-only queries when identity tracking is not needed;
- avoid N+1 queries and unbounded `Include` graphs;
- paginate deterministically with a stable ordering and a bounded page size;
- keep database work cancellable and measure generated SQL when query shape changes;
- use parameterized queries and provider-supported APIs;
- enforce uniqueness, foreign keys, required fields, and concurrency at the database as well as in code;
- make migrations explicit, reviewed, ordered, and owned by the delivery process;
- do not silently create, delete, or rewrite production data.

Transactions should match a real consistency boundary. Define isolation, retry, idempotency, and failure behavior. Avoid holding a transaction across remote calls or user interaction. If the repository uses ABP unit of work, follow its established transaction boundary instead of adding an unrelated transaction abstraction.

## 16. Transactions, units of work, and concurrency

For each mutation, identify the aggregate/business boundary, transaction owner, commit point, and post-commit effects. Handle optimistic concurrency explicitly and return a stable conflict result. Do not catch a concurrency exception and overwrite another writer without a product decision.

Outbox, inbox, idempotency keys, distributed locks, and compensating actions are architectural choices. Add them only when the actual consistency or delivery requirement justifies them, and test duplicate, retry, crash-before-commit, and crash-after-commit paths.

## 17. Background services and workers

Use `BackgroundService`, hosted services, queues, or the repository's worker framework with a clear lifetime and shutdown contract. Create an explicit scope for scoped dependencies inside long-running work. Propagate `stoppingToken`, bound concurrency and queue growth, and handle poison messages.

Do not start untracked fire-and-forget tasks from a request. Record failures, expose health/readiness signals where appropriate, and make retries bounded and idempotent. Distinguish graceful cancellation from a failed job.

## 18. Caching and state

Define cache ownership, key composition, tenant/user boundaries, expiration, invalidation, stampede behavior, and failure fallback before adding a cache. Never cache secrets or data across authorization boundaries. Include contract/version inputs in keys when serialized shapes can change.

Use output/response caching only when the response is safe for the cache scope. Do not cache personalized or authorization-sensitive responses publicly. Measure hit rate, memory cost, staleness, and invalidation behavior.

## 19. Logging, metrics, tracing, and health

Use structured logs with stable event names and correlation/trace context. Log enough to diagnose the operation, but exclude secrets, tokens, passwords, full sensitive payloads, and unnecessary PII. Choose levels deliberately; a retry loop must not flood production logs.

For important paths, define useful counters, latency/error measurements, dependency spans, and health checks that reflect real readiness. Health endpoints must not leak internal configuration or become an expensive dependency fan-out. Preserve OpenTelemetry or repository-specific conventions.

## 20. Serialization, streaming, and uploads

Treat serializer settings as public contract. Inspect naming, null/default handling, enum representation, polymorphism, reference handling, date/time, culture, and source-generation configuration before changing them.

For large responses, streams, downloads, and uploads:

- impose request, file, body, and decompression limits;
- stream rather than buffering unbounded content;
- validate content type and file signature where relevant;
- store outside the web root or in an appropriate object store;
- generate safe server-side names and prevent path traversal;
- scan or quarantine content according to the trust model;
- authorize every download and avoid leaking existence through error differences when sensitive.

## 21. Performance and memory

Do not optimize by intuition alone. Establish a baseline, identify the bottleneck, make one bounded change, and compare equivalent measurements. Consider startup, throughput, p50/p95/p99 latency, allocations, GC, database duration, external calls, queue depth, and memory retention.

Avoid per-request allocations and serialization/database/network work that do not serve the contract. Bound collection sizes, concurrency, recursion, request bodies, regex complexity, cache size, and queue length. Avoid premature pooling or unsafe low-level code when a clear measurement does not justify it.

When performance is the requested risk or a critical path changes, activate the performance guide and preserve reproducible benchmark/load evidence. Mark unavailable production-scale evidence `NOT_VERIFIED`.

## 22. Testing strategy

Choose tests from the changed risk:

- unit tests for pure domain and application rules;
- service tests with explicit fakes or test doubles at external boundaries;
- integration tests for routing, DI, serialization, authentication, persistence, migrations, and real provider behavior;
- contract tests for public APIs/events and compatibility;
- worker tests for cancellation, retries, duplicates, poison work, and shutdown;
- performance or load tests only when a measurable budget or bottleneck is in scope.

Every behavior change should have a focused regression. Include negative cases: malformed input, missing configuration, unauthorized and forbidden callers, dependency timeouts, cancellation, duplicate delivery, concurrency conflict, empty/large payloads, and partial failure. Do not weaken production validation to make tests convenient.

## 23. WebApplicationFactory and integration boundaries

Use `WebApplicationFactory<TEntryPoint>`/`TestServer` or the repository's established host fixture for end-to-end application behavior. Keep test overrides explicit: database, authentication, clock, external clients, queues, and configuration.

Assert actual HTTP behavior, not only internal method calls: route selection, status, headers, content type, JSON shape, auth policy, antiforgery, problem details, database effects, and cancellation. Ensure test services are isolated and disposed. Avoid a test fixture that accidentally uses production credentials, external networks, or a developer's local database.

## 24. Database and migration tests

Test schema/migration compatibility and representative queries against the provider that matters. If a faster substitute is used, document which provider-specific behavior it cannot prove. Verify indexes, constraints, transaction behavior, concurrency, query limits, and tenant/soft-delete filters where applicable.

Do not run destructive migration or data-reset commands against an unspecified environment. A successful `dotnet build` does not prove migrations apply or queries work.

## 25. Razor, Blazor, and interactive UI

For Razor Pages, MVC views, Blazor Server, and Blazor WebAssembly:

- keep presentation components focused and preserve the existing render mode;
- validate and authorize on the server even when a client component hides controls;
- understand prerendering, interactive lifecycle, reconnection, circuit state, and client/server serialization;
- avoid blocking lifecycle methods and unbounded rendering work;
- handle loading, empty, error, offline, reconnecting, and permission states;
- preserve keyboard, focus, semantics, contrast, reduced motion, and responsive behavior;
- do not expose server-only configuration or secrets to WebAssembly.

Activate design and accessibility when the UI changes. Validate browser-visible behavior with the repository's available tools; do not claim visual or assistive-technology coverage when it was unavailable.

## 26. ABP conditional overlay

Apply this overlay only when structural project evidence shows a `Volo.Abp.*` package reference in the selected .NET project. Do not introduce ABP conventions into a plain ASP.NET Core project.

Inspect the module dependency graph, `[DependsOn]` declarations, conventional registration, application services, authorization permissions, object mapping, repositories, data filters, tenants, distributed events, and unit-of-work attributes/conventions. Preserve module boundaries and initialization order.

Use ABP's established unit-of-work and repository behavior where the application already depends on it. Make transaction ownership, `SaveChanges`, domain events, and post-commit work explicit. Test permission checks, tenant isolation, data filters, validation, localization, serialization, and module startup. When changing a module, verify both the module itself and the host composition that consumes it.

## 27. Legacy target frameworks

For .NET Framework or older .NET Core targets, first determine supported SDK, runtime, package, hosting, and deployment constraints. Do not silently modernize APIs, package versions, target frameworks, nullable settings, serializers, or hosting models. Prefer a compatible local fix and record a migration opportunity separately unless modernization is explicitly requested.

## 28. Build, test, publish, and tooling

Use repository scripts and pinned SDK behavior first. Typical commands, only when available and authorized, include:

```bash
dotnet --info
dotnet restore
dotnet build --no-restore
dotnet test --no-restore
dotnet format --verify-no-changes
dotnet publish --no-restore
```

Select the exact solution/project and configuration. Do not imply that `build` proves tests, packaging, migrations, deployment, or runtime health. If restore, SDK selection, workload, analyzer, database, browser, or container prerequisites are unavailable, report the exact check as `NOT_VERIFIED` and retain the failure output.

Inspect generated files and build artifacts before committing them. Do not edit generated output instead of its source. Use package lock/central-management conventions already present. Review dependency changes for license, compatibility, transitive behavior, and supply-chain risk; activate the security guide when dependencies or publication are affected.

## 29. Containers, deployment, and CI/CD

Inspect the actual Dockerfile, base image, build context, runtime user, ports, certificates, health checks, environment variables, startup command, and artifact provenance. Keep build and runtime images least-privileged and minimal without hiding diagnostics.

For deployment changes, verify configuration binding, secret injection, database migration ownership, readiness/liveness, graceful shutdown, forwarded headers, TLS, scaling, rollback, and compatibility with existing clients. A local publish is not a deployment. A green CI job is not proof of production health. Separate local verification, CI evidence, registry publication, deployment, and lifecycle completion in reporting.

## 30. Troubleshooting

Diagnose from the first meaningful failure and the exact target:

- SDK/restore failures: inspect `global.json`, target framework, feeds, lock/central management, and available SDKs;
- registration failures: inspect module/host startup, lifetimes, and environment-specific branches;
- routing/binding failures: inspect endpoint order, metadata, constraints, model shape, and content type;
- auth failures: inspect scheme, issuer/audience, claims, policy, cookies, CORS, and clock;
- EF failures: inspect provider, generated SQL, context lifetime, migration state, transaction, and concurrency;
- production-only failures: compare environment/configuration/proxy/secret/telemetry differences without printing secrets;
- flaky async/worker tests: inspect cancellation, shared state, time, retries, disposal, and unbounded concurrency.

Do not repeat an unchanged command without new evidence. Keep workaround and root cause separate, and add a focused regression when the cause is understood.

## 31. Definition of Done

A .NET/ASP.NET Core change is complete only when the applicable items are evidenced:

- the actual project, target framework, package graph, and scope were confirmed;
- architecture and public contracts were preserved or intentionally versioned;
- DI lifetimes, cancellation, error handling, and trust boundaries are explicit;
- input, output, auth, data, transaction, concurrency, and external-service behavior are tested;
- migration and deployment implications are understood;
- logs, metrics, traces, health, and sensitive-data handling are appropriate;
- focused tests and proportional build/test checks pass;
- unavailable checks are reported `NOT_VERIFIED`, not inferred as passing;
- documentation, changelog, and release evidence are updated when in scope;
- ForgeLoop evidence and lifecycle state are canonical and validator-backed.

## 32. Deterministic routing evidence

The repository router selects this guide when the selected project evidence contains `dotnet` and the scope is `MATCH` or `UNSCOPED` for executable/code work. It may add ASP.NET Core and ABP overlays as reasons on the same `dotnet` specialist guide; these are not separate guide IDs.

Accepted structural primary evidence:

- `Microsoft.NET.Sdk`, `Microsoft.NET.Sdk.Web`, `Microsoft.NET.Sdk.Worker`, `Microsoft.NET.Sdk.Razor`, `Microsoft.NET.Sdk.BlazorWebAssembly`, `Aspire.AppHost.Sdk`, or `MSTest.Sdk` in an SDK-style project;
- the equivalent `<Sdk Name="..." />` form;
- ASP.NET Core confirmation from a supported web/Razor/Blazor SDK or `FrameworkReference Include="Microsoft.AspNetCore.App"`;
- ABP confirmation from a `PackageReference Include="Volo.Abp..."`.

The router must not activate this guide from prose, source snippets, `Dockerfile`, `*.deps.json`, `project.assets.json`, package-lock files, an arbitrary package name, or an unrelated nested project. Documentation-only and UI-copy work does not activate project specialist guides by project evidence alone.

Official references for version-sensitive work:

- [ASP.NET Core best practices](https://learn.microsoft.com/aspnet/core/fundamentals/best-practices)
- [.NET SDK overview](https://learn.microsoft.com/dotnet/core/sdk)
- [`global.json` overview](https://learn.microsoft.com/dotnet/core/tools/global-json)
- [Customize the build by folder](https://learn.microsoft.com/visualstudio/msbuild/customize-by-directory)
- [Central Package Management](https://learn.microsoft.com/nuget/consume-packages/central-package-management)
- [.NET and .NET Core support policy](https://dotnet.microsoft.com/platform/support/policy/dotnet-core)
- [ASP.NET Core documentation](https://learn.microsoft.com/aspnet/core/)
- [EF Core documentation](https://learn.microsoft.com/ef/core/)
- [ABP documentation](https://abp.io/docs/latest)
- [ABP modularity](https://abp.io/docs/latest/framework/architecture/modularity/basics)
- [ABP unit of work](https://abp.io/docs/latest/framework/architecture/domain-driven-design/unit-of-work)

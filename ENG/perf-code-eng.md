---
name: perf-code-eng
language: en
description: "Performance measurement, diagnosis, and improvement for web, mobile, desktop, APIs, and data."
version: "2026.09"
last-reviewed: "2026-10-17"
guide-id: performance
completion-evidence:
  - performance-validation
---

# Performance Guide for Web, Mobile, Desktop, and Database Development

> Practical instructions for designing, measuring, diagnosing, and improving performance in web, mobile (iOS/Android), desktop (Windows/macOS), APIs, infrastructure, and databases. Use this document to guide AI agents and developers. Performance must be measured in real scenarios before and after the change — do not optimize based on assumptions.
> **Related documents**: for code structure and readability, see [`clean-code-eng.md`](./clean-code-eng.md). For functional, integration, and E2E testing, see [`test-code-eng.md`](./test-code-eng.md). For security and cache, secrets, and infrastructure trade-offs, see [`sec-code-eng.md`](./sec-code-eng.md). For perceived performance, UX, motion, and responsive design, see [`design-code-eng.md`](./design-code-eng.md). For HTML video preview and rendering performance, see [HyperFrames](https://hyperframes.heygen.com). This file is the canonical performance reference.
> **Tooling policy**: identify the stack, the stage, and the applicable checks; prefer an already available equivalent that produces compatible evidence. Installation or environment changes require authority; reuse scoped authorization already given rather than asking again. If no safe equivalent exists, record the required check as blocked and never claim that it passed. Do not install merely optional resources.

## General principles

- **Measure before optimizing**: reproduce the problem, record a baseline, find the bottleneck with profiling/telemetry, and only then change the code.
- **Define a performance budget** per product: startup time, API latency, bundle size, memory consumption, FPS, CPU, battery, and infrastructure cost.
- **Optimize the critical path**: prioritize what blocks the first render, the first interaction, the most-used operation, or the flow that has the greatest impact on the user.
- **Distribution metrics**: track median (p50), p75, p95, and p99. A healthy average can hide a minority of users with a very poor experience.
- **Perceived performance matters**: immediate feedback, skeleton/loading state, streaming, and progressive updates can improve the experience without masking a slow operation.
- **Do not block the main thread**: use asynchronous APIs for I/O and bound parsing, serialization, and CPU-heavy work. An `async` function or Promise does not move CPU work off the event loop. Measure whether partitioning work or a bounded worker/background pool improves responsiveness, including transfer and scheduling cost. See [Node.js event-loop guidance](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop).
- **Less work is better than faster work**: eliminate unnecessary calls, renders, queries, allocations, payloads, and initializations before micro-optimizing an algorithm.
- **Avoid speculative optimization**: do not add cache, pooling, memoization, or complexity without evidence of a bottleneck and without measuring invalidation, memory, and maintenance cost.
- **Control concurrency and resources**: use timeouts, queue limits, backpressure, quotas, circuit breakers, and cancellation to prevent slowness from becoming resource exhaustion.
- **Performance must not break security**: do not disable TLS, authentication, validation, isolation, or security controls to gain speed. Consult [`sec-code-eng.md`](./sec-code-eng.md) before optimizing sensitive flows.
- **Record the reason for the optimization**: document the affected metric, the reproduced scenario, and the accepted trade-off; remove temporary instrumentation after the investigation.

---

## Mandatory diagnostic process

1. **Define the scenario**: platform, version, hardware, network, data volume, user scale, and affected flow.
2. **Reproduce in a production/release build**: development builds, hot reload, and excessive logs distort results.
3. **Collect a baseline**: record p50/p95/p99, CPU, memory, I/O, network, errors, throughput, and battery consumption when applicable.
4. **Locate the bottleneck**: use a profiler, traces, structured logs, metrics, and flame graphs. Do not conclude that the problem is CPU without measuring CPU.
5. **Make a small change**: change one main variable at a time to attribute causality to the result.
6. **Test load and regression**: validate the optimized path with the same data and compare it with the baseline; run the tests from [`test-code-eng.md`](./test-code-eng.md).
7. **Validate under real conditions**: modest devices, slow network, cold/warm cache, realistic volume, and realistic concurrency.
8. **Monitor after publishing**: compare production RUM/telemetry, define alerts, and revert if the result degrades other indicators.

### General tools

- **Profiling**: Chrome DevTools/Lighthouse, Node.js `--prof`/clinic.js, Python `cProfile`/py-spy, .NET dotnet-trace/dotnet-counters, Java JFR/async-profiler, Go pprof, Instruments (Apple), Windows Performance Analyzer.
- **Observability**: OpenTelemetry for traces/metrics/logs, Prometheus + Grafana, Application Insights, CloudWatch, Datadog, or equivalent.
- **Load**: k6, Locust, Gatling, JMeter, or an equivalent tool. Use gradual load and scenarios close to production.
- **Benchmarks**: compare versions with fixed data and environment; do not use an isolated synthetic benchmark as the only evidence.

---

## Web — metrics and budget

### Core Web Vitals

Monitor lab data and real user data (RUM). To decide whether the experience meets Core Web Vitals, use first-party RUM or CrUX at the 75th percentile (p75) of page loads, segmented by mobile and desktop and by the relevant URL or URL group. As an initial reference, target the "good" thresholds recommended by web.dev:

- **LCP (Largest Contentful Paint)**: up to `2.5 s` — loading of the largest visible content.
- **INP (Interaction to Next Paint)**: up to `200ms` — interaction responsiveness.
- **CLS (Cumulative Layout Shift)**: up to `0.1` — visual stability.
- Also track **TTFB**, FCP, page weight, hydration time, and JavaScript errors.

Lighthouse is a lab diagnostic tool: reproduce and investigate issues in it, but do not treat it as proof of the real-user experience. RUM/CrUX at p75, with the segmentation above, is the evidence for deciding whether users' experience improved.

### Document delivery and network

- Use **HTTP/2 or HTTP/3**, modern TLS, and Brotli compression (or gzip as a fallback).
- Configure HTTP caching correctly (`Cache-Control`, `ETag`, `Last-Modified`) and use a CDN for static assets and cacheable content.
- Use asset name hashing (`app.[hash].js`) for long caching without serving old versions.
- Preload only critical resources from the initial path (critical font, LCP image); excessive preload competes for the same bandwidth.
- Use `preconnect` only for truly critical origins and `prefetch` for likely navigation, without wasting mobile data.
- Reduce TTFB with page/data cache, reused database connections, asynchronous processing, and an appropriate region choice.
- Stream HTML/data when the framework supports it and when it reduces time to useful content.
- Avoid network dependency chains: a critical resource should not depend on several sequential requests to appear.

### HTML, CSS, and images

- Deliver images in the required format and size: **AVIF/WebP**, appropriate compression, `srcset`, `sizes`, explicit dimensions, and `aspect-ratio`; do not assume these formats are compatible without a fallback.
- Prefer `<picture>` with `AVIF`/`WebP` in `<source>` and JPEG/PNG in the `<img>` fallback. Replace that markup with CDN format negotiation only after a support matrix proves that it honors `Accept`, returns the fallback, and varies caches correctly.

```html
<picture>
  <source srcset="/image.avif" type="image/avif">
  <source srcset="/image.webp" type="image/webp">
  <img src="/image.jpg" alt="Image description" width="1200" height="800">
</picture>
```

- Do not use `loading="lazy"` on the LCP image; use priority loading for above-the-fold content and lazy loading for the rest.
- Avoid layout shift: reserve space for images, ads, embeds, and fonts before they load.
- Minify CSS, remove unused CSS, and avoid excessively complex selectors or selectors that force broad recalculation.
- Prefer `transform` and `opacity` animations; avoid animating `top`, `left`, `width`, `height`, or properties that cause layout on every frame.
- Load fonts with `font-display: swap`, limit variants/weights, and use a fallback with compatible metrics to reduce layout shift.
- Replace large GIFs with optimized video when there is continuous animation.

### JavaScript / TypeScript in the browser

- Split the bundle by route/component (`code splitting`) and load non-critical resources on demand.
- Remove unused dependencies and code; analyze the bundle with `source-map-explorer`, `webpack-bundle-analyzer`, or an equivalent.
- Use `defer`/`async` correctly; do not block the parser with non-critical scripts in the `<head>`.
- Break long tasks into smaller parts and yield to the main thread; avoid large synchronous loops during interaction.
- Use Web Workers for parsing, compression, calculations, and processing that do not need to access the DOM.
- Debounce/throttle high-frequency events (scroll, resize, input), using passive listeners when appropriate.
- Avoid unnecessary renders: keep state close to where it is used, virtualize long lists, use memoization only after measuring, and stabilize props/callbacks when the framework requires it.
- Do not create a request waterfall: load in parallel when there is independence, use data cache, and prefer streaming/pagination to huge payloads.
- In SSR/hydration, reduce the JavaScript sent to the client; consider islands, partial components, or Server Components when appropriate.

### React / Next.js

- Prefer Server Components/SSR for content that does not need client-side interactivity; mark only what is necessary as client.
- Use `next/image`, `next/font`, route prefetching judiciously, and appropriate data caching/revalidation.
- Avoid turning the entire layout into a Client Component for convenience.
- Virtualize long tables/lists and avoid putting global state that causes the entire application to rerender.
- Measure hydration cost and use React DevTools Profiler before applying `memo`, `useMemo`, or `useCallback` broadly.

### Vue / Nuxt / Angular

- Vue/Nuxt: use `defineAsyncComponent`, lazy routes, `v-once`/memoization when proven, and avoid broad watchers.
- Angular: use `OnPush`, `trackBy`/`track`, lazy routes, deferrable views, and avoid heavy work in templates/change detection.
- In both: keep bundles per route and measure hydration/rendering cost with DevTools and framework profiling.

### WebAssembly, PWA, and Web Workers

- Use WebAssembly only for work that is genuinely CPU-bound; the cost of downloading, compiling, and copying data can outweigh the gain.
- PWA: define a service worker caching strategy, avoid caching sensitive data or incompatible versions, and limit precache size.
- Service workers must fail safely and allow predictable updates; never leave users stuck on an old shell.

---

## Backend and web APIs

### Common rules

- Perform network and disk I/O asynchronously; configure connection, read, and full-operation timeouts.
- Reuse connections with pools sized based on measurement; a pool that is too large causes contention and brings down the database.
- Pagination is mandatory for collections; prefer cursor/keyset pagination for large volumes over deep `OFFSET`.
- Limit payloads, uploads, response size, and query complexity; use compression when the payload justifies it.
- Avoid N+1 queries with eager loading, batching, or DataLoader, but do not load entire relationships unnecessarily.
- Use cache with TTL, explicit invalidation, and hit/miss metrics; never rely on cache as the single source of truth.
- Use queues/background jobs for slow tasks (email, reports, video processing), with idempotency and retries with backoff.
- Apply graceful degradation: if recommendations, analytics, or a secondary service fails, the main path continues working.
- Instrument latency by endpoint, status code, payload size, external dependency, and query; averages alone are not sufficient.

### Node.js / JavaScript / TypeScript

- Do not block the event loop with heavy CPU work, `JSON.parse` of huge payloads, catastrophic regex, or synchronous compression; move work to Worker Threads/queues.
- Use streams for large files and payloads instead of loading everything into memory.
- Configure database connection pools and reusable HTTP clients; do not create a client per request.
- Use `autocannon`, `clinic.js`, `0x`, or Node Profiler to find event-loop lag and hot paths.
- Avoid expensive global middleware on routes that do not need it; limit serialization of objects and returned fields.

### Python

- Use `asyncio`/ASGI for concurrent I/O when the application and libraries are genuinely asynchronous; do not mix blocking calls into the event loop.
- Use workers/processes for CPU-bound work and appropriate pools for I/O; measure before choosing threads or processes.
- Prefer pagination, generators, and streaming to huge in-memory lists.
- Profile with `cProfile`, `py-spy`, or `scalene`; use `pytest-benchmark` to prevent regressions in critical functions.
- Django: use `select_related`/`prefetch_related`, template/data cache judiciously, and avoid queries inside loops.
- FastAPI: use lean response models, async endpoints only when the I/O is async, and limit size/concurrency.

### .NET / ASP.NET Core

- Use `async`/`await` end to end for I/O; do not use `.Result`/`.Wait()` in request code.
- Use `IHttpClientFactory`, connection pooling, `ArrayPool<T>`/`MemoryPool<T>` only after measuring allocations and GC pressure.
- Configure output/response caching, compression, and pagination; avoid serializing entire entities when smaller DTOs are sufficient.
- Use `dotnet-counters`, `dotnet-trace`, PerfView, or Application Insights for CPU, GC, allocations, and latency.
- Avoid allocating closures/objects in hot paths unnecessarily; do not trade clarity for premature micro-optimization.

### Java / Spring

- Use JFR, async-profiler, and Micrometer/Actuator metrics to locate CPU, GC, locks, and latency.
- Configure pools (HikariCP, threads, HTTP clients) based on measured load; do not increase threads as an automatic response to slowness.
- Use pagination and DTO/JPA projections to avoid loading unnecessary entities and relationships.
- Control the cost of the Spring context: lazy initialization can improve startup, but must be evaluated against first-request latency.
- Adjust GC/heap only after observing allocation, pauses, and memory pressure in a representative environment.

### Go

- Use `pprof`, stdlib benchmarks, tracing, and metrics for CPU, heap, goroutines, and blocking.
- Reuse buffers/connections carefully; `sync.Pool` is for high-frequency temporary objects, not for hiding leaks.
- Propagate `context.Context` with deadline/cancellation and do not create goroutines without a shutdown strategy.
- Use streaming and backpressure; limit goroutines and queue size to prevent an explosion under load.

---

## Database

### Relational principles (PostgreSQL, MySQL, SQL Server)

- Analyze real queries with `EXPLAIN`/`EXPLAIN ANALYZE` (or equivalent) and use representative data; never create an index by intuition alone.
- Keep statistics up to date (`ANALYZE`, auto-analyze/equivalent update) so the optimizer chooses realistic plans.
- Create indexes aligned with real queries (`WHERE`, `JOIN`, `ORDER BY`), considering selectivity and column order in composite indexes.
- Do not index everything: indexes speed up reads, but increase the cost of `INSERT`/`UPDATE`/`DELETE`, space, and maintenance.
- Avoid `SELECT *`; select only necessary columns and consider covering/index-only scans when proven.
- Avoid functions/casts on the filtered column when they prevent index usage; prefer sargable queries.
- Use short transactions, maintain a consistent lock acquisition order, and investigate lock contention/deadlocks.
- Batch independent operations; avoid thousands of individual round trips (N+1 in the database).
- Use a connection pool sized according to database capacity and workload; more connections do not mean more throughput.
- Use cursor/keyset pagination for large tables; high `OFFSET` forces the database to scan and discard many rows.
- Partition tables only when volume, retention, or query pattern justifies it; partitioning adds operational complexity.
- Perform vacuum/maintenance, statistics updates, backups, and restore tests according to the database; monitor growth, bloat, and space.
- For large schema changes, use migrations compatible with reads/writes during deployment (expand/contract) and avoid prolonged locks.

### PostgreSQL

- Use `EXPLAIN (ANALYZE, BUFFERS)` in a safe environment to compare the estimated plan with actual execution; remember that `ANALYZE` executes the operation.
- Monitor `pg_stat_statements`, cache hit ratio, locks, I/O, vacuum, and slow queries.
- Prefer partial/composite indexes when they match the real workload; confirm usage before keeping them.
- Use JSONB, full-text search, materialized views, and partitioning only when the access pattern justifies them, not as a substitute for proper modeling.

### MySQL / MariaDB

- Use `EXPLAIN`/`EXPLAIN ANALYZE`, Performance Schema, and the slow query log.
- Check the engine, composite indexes, cardinality, `JOIN`, and implicit type conversions.
- Configure pooling and transactions with attention to InnoDB isolation and locks; avoid keeping a transaction open during external calls.

### SQL Server

- Use Actual Execution Plan, Query Store, DMVs, and Extended Events to identify regressions, waits, and expensive queries.
- Evaluate missing/overlapping indexes, parameter sniffing, statistics, and regressive plans before changing the schema.
- Use pagination and projections; do not solve a slow query by increasing `MAXDOP` or memory without measuring the complete workload.

### NoSQL, cache, and search

- **Redis**: define TTL, limit value size, avoid O(N) commands in critical requests, monitor memory/eviction, and use pipelining when several operations are independent.
- **MongoDB**: model according to the access pattern, create indexes based on `explain()`, limit documents, and avoid unbounded arrays; use projection and pagination.
- **Elasticsearch/OpenSearch**: limit returned fields, use structured filters instead of text queries when possible, use search-after pagination for large sets, and monitor shards/heap.
- Cache is acceleration, not a primary database: define behavior when it is cold, unavailable, or inconsistent.

---

## Mobile — iOS and Android

### Common rules

- Measure on real modest and recent devices, in a Release build, with slow/unstable network and less-than-ideal battery.
- Define goals for cold/warm start, time to first interactive screen, scroll/transition smoothness, memory, energy consumption, and app size.
- Do not perform heavy work at startup: initialize only what is necessary to show the first screen and defer the rest until after the first frame/interaction.
- Avoid blocking the UI thread/main thread; move I/O, parsing, database work, and calculations to the background and update the UI safely.
- Load lists and images on demand, use pagination, limited cache, controlled prefetch, and placeholders with stable dimensions.
- Reduce network work: compact payloads, compression, HTTP cache, grouped requests, and request cancellation when the screen no longer exists.
- Monitor crash-free rate, ANR/hangs, jank, startup, memory/battery consumption, and API latency in production.
- Never use permanent verbose profiling/logs in Release; instrumentation must preserve privacy and follow [`sec-code-eng.md`](./sec-code-eng.md).

### iOS (Swift / SwiftUI / UIKit)

- Use **Instruments** (Time Profiler, Allocations, Leaks, Energy Log, Network) and Xcode/MetricKit production metrics.
- Use `async/await`, URLSession, and background operations; never block the main thread with I/O or processing.
- SwiftUI: keep `body` cheap, control view identity, avoid global state that causes broad recomputation, and use `LazyVStack`/`LazyHStack` for large lists.
- UIKit: reuse cells (`UICollectionView`/`UITableView`), pre-calculate layout when necessary, and avoid heavy work in `cellForItem`/main thread.
- Reduce image cost: use appropriate dimensions, downsample before displaying, use memory-limited caching, and efficient formats.
- Use BackgroundTasks for deferrable work and respect the system's execution/energy limits.
- Control Auto Layout: avoid unnecessarily deep hierarchies and layout loops; measure with Instruments before restructuring.
- Use `os_signpost`/signposts to measure critical phases without leaving permanent prints in the app.

### Android (Kotlin / Jetpack Compose / Views)

- Use Android Studio Profiler, **Macrobenchmark**, **Microbenchmark**, JankStats, Perfetto, and Baseline Profiles.
- Use Baseline Profiles and Startup Profiles when applicable; validate gains on representative devices.
- Defer initialization of nonessential SDKs; use App Startup/on-demand initialization instead of initializing everything in the first frame.
- Kotlin: use appropriate coroutines/Dispatchers, lifecycle-bound cancellation, and no blocking I/O on the Main dispatcher.
- Jetpack Compose: minimize recompositions, keep state at the correct level, use `remember` judiciously, use `LazyColumn` for lists, and avoid heavy work inside composables.
- Views: reuse `RecyclerView`/ViewHolder, avoid deep hierarchies, and use `ConstraintLayout`/simple layouts with real measurement.
- Use WorkManager for guaranteed/deferrable work; respect Doze, background limits, and battery consumption.
- Reduce APK/AAB with R8/resource shrinking, use WebP/vector when appropriate, and load images with Coil/Glide at the appropriate dimensions.
- Track startup, jank, ANR, memory, battery, and crashes through Android Vitals/Play Console.

### React Native and Flutter

- **React Native**: reduce bridge traffic, avoid rendering entire lists, use `FlatList`/`FlashList` with virtualization, and move animations to the UI thread (Reanimated). Use React Native DevTools to profile renders and commits; use Android Studio and Xcode for native layers. Keep Flipper only for manual/legacy integration in older versions, not as the current default tool.
- **Flutter**: use DevTools (CPU/Memory/Performance), keep frames within the budget, prefer `const` widgets, `ListView.builder`, and appropriately sized images, and avoid broad rebuilds; use isolates for CPU-bound work.
- In both, measure the cost of the cross-platform layer and use native code only for proven hot paths.

---

## Desktop — Windows and macOS

### Common rules

- Measure cold start, warm start, time to first interactive window, latency of main actions, CPU, memory, I/O, network, and background consumption.
- Test on modest hardware, high DPI/Retina, multiple monitors, a resized window, a slow disk, and offline/intermittent connection.
- Do not block the UI thread: use async/await, workers, and queues for long operations; keep the window responsive during I/O.
- Load modules, screens, and data on demand; defer non-critical initializers until the first window is interactive.
- Release resources when minimizing/going to the background when possible: timers, streams, polling, images, and unnecessary connections.
- Control memory: watch for leaks, event references, unbounded caches, large documents, and multiple windows.
- Test the installer, update, first run, run after update, and uninstallation; startup performance includes the user's real path.

### Windows (WinUI 3, WPF, .NET, Win32)

- Use Windows Performance Analyzer/Recorder, Visual Studio Profiler, `dotnet-counters`, `dotnet-trace`, and ETW according to the stack.
- Measure Release on representative hardware, for both cold and warm startup, through the first truly interactive frame.
- Defer loading non-critical assemblies, services, data, and pages; perform long work asynchronously.
- WinUI/WPF: avoid deep visual trees, unnecessary renders, and lists without virtualization; use virtualization in `ListView`/`ItemsControl` when possible.
- Reduce allocations and GC pressure in hot paths; use pooling/structs/low-level optimizations only after profiling.
- Test DPI scaling (100%, 125%, 150%, 200%), multiple monitors, and resizing to detect expensive or broken layout.
- Use lean MSIX/packaging, remove unused assets/files, and do not initialize update/telemetry services before the first interaction.

### macOS (AppKit, SwiftUI, Catalyst)

- Use Instruments (Time Profiler, Allocations, Leaks, Energy Log, Network) and `os_signpost` to measure operations and startup.
- Respect the main thread; use Swift concurrency/DispatchQueue for I/O and long operations without blocking AppKit/SwiftUI.
- SwiftUI: reduce recomputations and complex hierarchies, use lazy containers for lists, and avoid state that invalidates entire windows.
- AppKit: reuse views/cells, virtualize tables/collections, limit redraws, and avoid layouts that recalculate the entire window.
- Use NSCache/URLCache or a custom cache with memory limits and an eviction policy; never keep unlimited documents/images in memory.
- Properly support Apple Silicon and Intel when necessary; validate the cost of translation/architecture and distribute appropriate binaries.
- Use BackgroundTasks/appropriate services and reduce work when the app is in the background to preserve energy.

### Electron / Tauri

- **Electron**: keep the renderer lightweight, disable unnecessary hidden windows, avoid `nodeIntegration` for security, use preload/context isolation, and do not perform CPU-bound work in the renderer; consider Worker Threads/processes.
- **Tauri**: keep the WebView lean, avoid serializing large payloads between the frontend and Rust, move processing to Rust commands when a measured gain exists, and limit repeated calls between layers.
- In both, measure main process + renderer/WebView startup, installer size, memory per window, and the cost of multiple windows.

---

## APIs, network, and distributed architecture

- Define latency, availability, and throughput SLOs per endpoint; monitor p50/p95/p99 separately.
- Reduce round trips: group independent requests, use HTTP/2 multiplexing, use GraphQL/BFF carefully, and provide endpoints that return exactly what is needed.
- Use layered caching (browser/CDN/API/data) with TTL and invalidation; document eventual consistency and cold-cache behavior.
- Use compression for large payloads, but measure CPU versus bandwidth; do not compress small responses.
- Use connection pooling and keep-alive; configure DNS, TLS handshake, timeout, and retry with backoff and jitter.
- Never retry blindly: retries multiply load. Use a retry budget, idempotency keys, and a circuit breaker.
- Use queues to decouple long tasks, with backpressure, a concurrency limit, and a dead-letter queue.
- Prefer streaming/pagination to huge responses; limit header, body, and response size.
- Use CDN/edge for suitable assets and content; do not put personalized/sensitive data in shared cache without control.

---

## Infrastructure, containers, and cloud

- Use autoscaling based on the right metrics (latency, queue, CPU, memory, requests), not CPU alone.
- Define CPU and memory requests/limits in containers; observe throttling, OOM kills, and eviction.
- Use small images and multi-stage builds; remove unused runtime tools and dependencies.
- Configure health checks that test essential dependencies without generating a traffic cascade; distinguish liveness from readiness.
- Prefer resources near users and databases in the same region/network when latency is relevant.
- Use CDN, object storage, and cache for static content; do not serve heavy assets from application instances.
- Monitor cost and performance together: a larger instance is not always the best solution; compare cost per request/completed action.
- Run load tests in representative staging and canary/gradual rollouts in production.
- Do not increase timeout, memory, or thread limits to hide a leak, slow query, or undersized queue; investigate the cause.

---

## Performance and security

- Caching authenticated data requires isolation by user/tenant; never allow shared cache to deliver another user's response.
- Do not remove validation, authorization, encryption, rate limiting, or auditing just to reduce latency.
- Limit payloads and request complexity to prevent uncontrolled CPU/memory consumption (application DoS).
- Do not log complete payloads, tokens, or PII when creating performance instrumentation; consult [`sec-code-eng.md`](./sec-code-eng.md).
- Profile with anonymized or synthetic data when real data contains sensitive information.

---

## Instruction template to include in CLAUDE.md / AGENTS.md

```
## Performance

- Measure before optimizing: reproduce the problem, record a baseline, perform
  profiling, identify the bottleneck, and only then change the code.
- Record p50/p95/p99, not just averages. Validate in a Release build and on
  representative hardware/network.
- Do not block the main thread/event loop/UI with heavy CPU, I/O, parsing, or
  serialization. Use appropriate async, workers, or background jobs.
- Avoid N+1 queries, huge payloads, `SELECT *`, unnecessary sequential
  requests, and lists without pagination/virtualization.
- Use cache only with TTL, invalidation, memory limits, and hit/miss metrics.
  Never treat cache as the single source of truth.
- Configure timeouts, cancellation, concurrency limits, backpressure, and
  retries with backoff/jitter. Do not retry indefinitely.
- Web: use LCP ≤ 2.5 s, INP ≤ 200 ms, and CLS ≤ 0.1 at the p75 of
  RUM/CrUX as initial targets—not binding release gates unless the product
  documents them—segmented by mobile/desktop and URL/group; use Lighthouse
  for diagnosis, responsive images with a fallback, code splitting, and a
  proven CDN.
- Mobile: measure startup, jank, ANR/hangs, memory, and battery on real devices;
  defer initialization and keep the UI thread free.
- Desktop: measure cold/warm startup, first interactive window, CPU/memory, and
  responsiveness on modest hardware, DPI/Retina, and multiple monitors.
- Database: use EXPLAIN/EXPLAIN ANALYZE, up-to-date statistics, indexes based
  on real queries, and a connection pool sized through measurement.
- Performance does not justify removing security controls. Do not disable
  TLS, authorization, validation, or rate limiting to gain speed.
- After optimizing, run the [`test-code-eng.md`](./test-code-eng.md) tests, compare with the baseline,
  check for regressions, and remove temporary instrumentation.
```

---

## Performance review checklist

### Measurement and diagnosis

- [ ] A reproducible baseline exists before the change.
- [ ] The bottleneck was confirmed by profiler/telemetry, not by assumption.
- [ ] p50/p75/p95/p99, CPU, memory, I/O, and network were evaluated when applicable.
- [ ] The change was isolated and compared with the same previous scenario.

### Web and APIs

- [ ] LCP, INP, and CLS were evaluated at the p75 of RUM/CrUX by mobile/desktop and URL/group; Lighthouse was used only for diagnosis.
- [ ] TTFB is within the defined budget.
- [ ] Assets have appropriate compression, dimensions, caching, and loading; AVIF/WebP has a JPEG/PNG fallback or proven CDN negotiation.
- [ ] The bundle was analyzed; unused code and dependencies were removed.
- [ ] Endpoints have pagination, timeout, payload limits, and observability.
- [ ] There are no N+1 queries, avoidable waterfalls, or excessively large responses.

### Mobile and desktop

- [ ] Startup and first interaction were measured in a Release build.
- [ ] The UI/main thread/event loop remains responsive during I/O and calculations.
- [ ] Memory, battery/energy, jank, and background resources were evaluated.
- [ ] Tests cover modest devices/hardware, different screens, and poor network.

### Database and infrastructure

- [ ] Critical queries were analyzed with an execution plan and representative data.
- [ ] Indexes, pools, cache, and limits were sized through measurement.
- [ ] A load test, canary, or gradual rollout was planned for high-risk changes.
- [ ] There is no OOM, throttling, lock contention, unbounded queue, or infinite retry.

### Security and quality

- [ ] The optimization did not remove security or privacy controls.
- [ ] Logs and traces do not expose secrets, tokens, or PII.
- [ ] Functional and performance tests run in CI according to [`test-code-eng.md`](./test-code-eng.md).
- [ ] The result and trade-offs are documented.

---

## Sources and references

- web.dev — Core Web Vitals, p75, and device segmentation: https://web.dev/articles/vitals
- web.dev — Field measurement, RUM, and CrUX: https://web.dev/articles/vitals-field-measurement-best-practices
- web.dev — Image performance and `<picture>` fallback: https://web.dev/learn/performance/image-performance
- React Native — React Native DevTools and native tooling: https://reactnative.dev/docs/react-native-devtools
- Android Developers — App performance guide: https://developer.android.com/topic/performance/overview
- Apple Developer — Performance and Instruments: https://developer.apple.com/documentation/xcode/improving-your-app-s-performance/
- Microsoft Learn — Windows app performance: https://learn.microsoft.com/windows/apps/develop/performance/
- PostgreSQL — Performance tips and EXPLAIN: https://www.postgresql.org/docs/current/performance-tips.html
- OpenTelemetry: https://opentelemetry.io/docs/
- k6: https://grafana.com/docs/k6/latest/

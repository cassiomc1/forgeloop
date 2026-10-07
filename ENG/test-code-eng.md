---
name: test-code-eng
language: en
description: "Risk-based testing strategy and tools for modern languages and platforms."
version: "2026.09"
last-reviewed: "2026-08-10"
guide-id: test
completion-evidence:
  - tests
---

# Risk-Based Testing Guide by Language and Technology

> Practical instructions for selecting, running, and approving software tests according to risk, stack, compatibility, and operational evidence.

**Related documents**: for general clean code principles (names, small functions, formatting), see [`clean-code-eng.md`](./clean-code-eng.md). For security, including SAST/DAST, see [`sec-code-eng.md`](./sec-code-eng.md). For accessibility, use the repository's specific guide together with [WCAG 2.2](https://www.w3.org/TR/WCAG22/). For HTML video and motion, see [HyperFrames](https://hyperframes.heygen.com). This file is the canonical reference for deciding the testing strategy by language and platform.

**Tooling policy**: identify the stack, the stage, and the applicable checks; prefer an already available equivalent that produces compatible evidence. Ask for authorization before installing a tool or changing the environment. If no safe equivalent exists, record the required check as blocked and never claim that it passed. Do not install merely optional resources.

## Start with risk, not a tool

Before writing or selecting tests, record:

- the protected asset, journey, or rule;
- failure impact on users, revenue, data, security, accessibility, and operations;
- regression probability, change complexity, and incident history;
- supported platforms, versions, devices, permissions, and network conditions;
- observable oracle, environment, data, and owner of the result;
- required evidence and reassessment date.

Classify each item locally. The labels below do not impose a fixed number of tests:

| Class | Example | Minimum approval evidence |
| --- | --- | --- |
| Critical | authentication, payment, data loss, authorization, destructive migration | unit/property tests for rules, realistic integration, contract, and an E2E journey; manual review when the oracle requires judgment |
| High | frequent flow, external integration, compatibility, or accessibility | relevant branch tests, integration/contract, and smoke on the affected platform |
| Standard | content, presentation, or reversible low-impact logic | checks focused on the change and regression proportional to its reach |

The testing pyramid is a cost heuristic, not a quota. Keep most confidence in fast, deterministic tests, but use integration, contract, UI, performance, security, and manual evaluation when only those layers can observe the risk.

## Coverage and suite strength

- Do not adopt universal coverage percentages or require one test per function. Define the repository contract from a measured baseline, criticality, language, and maintenance cost.
- Observe repository coverage, changed lines, branches/conditions, and critical paths separately. A change should not lower the applicable baseline without a rationale, owner, and accepted risk.
- For critical rules, list cases, boundaries, invalid states, and properties. Line coverage does not prove that assertions distinguish correct from incorrect behavior.
- Run **mutation testing** on modules where the cost is justified, using [Stryker](https://stryker-mutator.io/), [PIT](https://pitest.org/), or a stack-equivalent tool. Compare the mutation score with the project's own baseline and investigate relevant surviving mutants; do not turn a generic number into a universal target.
- Every bug fix should retain a regression test that fails in the defective state and passes with the fix, unless an impossibility is documented.

## Tool selection matrix

A tool is a candidate, not a ranking winner. Record the decision in the repository and use this order:

1. Eliminate options incompatible with the runtime, framework, browser, operating system, architecture, security policy, or CI.
2. In an existing project, keep the adopted tool when it covers the risk and receives maintenance compatible with the product lifecycle; migration needs a measured benefit and exit plan.
3. Run a proof with a critical journey. Measure execution and diagnosis time, stability, parallelism, artifacts, runner cost, and maintenance effort.
4. Pin versions, commands, supported platforms, owner, and reassessment date. Do not base the choice on satisfaction, popularity, or adoption from a single survey.

| Context | Candidates with official documentation | Reproducible decision basis |
| --- | --- | --- |
| Node.js/TypeScript | [`node:test`](https://nodejs.org/docs/latest-v24.x/api/test.html), [Vitest](https://vitest.dev/guide/), [Jest](https://jestjs.io/docs/getting-started) | existing framework/build, ESM/CJS, TypeScript, mocks, watch, coverage, and CI runtime |
| Components and browser | [Testing Library](https://testing-library.com/docs/), [Playwright](https://playwright.dev/docs/intro), [Cypress](https://docs.cypress.io/) | required browsers, isolation, failure artifacts, parallelism, accessibility, and app compatibility |
| Python | [pytest](https://docs.pytest.org/), [`unittest`](https://docs.python.org/3/library/unittest.html) | dependency policy, fixtures/plugins, Python versions, and existing integration |
| .NET | [xUnit.net](https://xunit.net/), [NUnit](https://docs.nunit.org/), [MSTest](https://learn.microsoft.com/dotnet/core/testing/unit-testing-mstest-intro) | .NET version, runner/IDE, fixture model, assertions, and existing projects |
| Java/JVM | [JUnit](https://docs.junit.org/current/overview.html), [TestNG](https://testng.org/) | Maven/Gradle build, extensions, parallelism, integration, and existing conventions |
| Go | [`testing`](https://pkg.go.dev/testing), [Testify](https://pkg.go.dev/github.com/stretchr/testify) | sufficient standard library or a proven need for helpers, suites, and mocks |
| Ruby | [RSpec](https://rspec.info/documentation/), [Minitest](https://ruby-doc.org/3.4/gems/minitest/Minitest.html) | Rails/Ruby conventions, fixtures, DSL, and existing suite |
| PHP | [PHPUnit](https://docs.phpunit.de/), [Pest](https://pestphp.com/docs/installation) | PHP/framework version, plugins, and migration cost |
| Real services | [Testcontainers](https://testcontainers.com/), stack-native harness | required fidelity, container availability, time, and CI isolation |
| HTTP/event contracts | [Pact](https://docs.pact.io/), OpenAPI/JSON Schema/GraphQL schema | consumer/provider ownership, versioning, and compatibility across deployments |
| Performance | [k6](https://grafana.com/docs/k6/latest/), [Gatling](https://docs.gatling.io/), [JMeter](https://jmeter.apache.org/usermanual/), or [Locust](https://docs.locust.io/) | protocol, load model, volume, distribution, metrics, and team operability |
| React code quality diagnostics | [React Doctor](https://github.com/millionco/react-doctor) plus the project's existing lint/test/type/a11y/security tools | candidate supplemental scan for React targets; evaluate framework compatibility, version pinning, network/install policy, telemetry policy, false positives, changed-code scope, and whether findings overlap existing gates |

Mocks, stubs, and fakes belong in isolated tests. For integration, prefer disposable dependencies equivalent to production when this reduces relevant differences. Typing, linting, and static analysis complement tests; they do not replace executing behavior.

## Operational matrix by domain and framework

Run only the rows applicable to the product and recorded risk. A tool name without a hypothesis, oracle, and gate is not a strategy.

| Context | Risk requiring evidence | Operational approach and gate | Official tools/sources |
| --- | --- | --- | --- |
| APIs and schemas | drift between implementation and contract, incompatible change, undocumented error/authorization | validate requests/responses and negative cases against the schema version; run consumer/provider contracts; block breaking changes without a compatible transition and provider verification | [OpenAPI](https://spec.openapis.org/oas/), [JSON Schema](https://json-schema.org/learn), [GraphQL](https://spec.graphql.org/), and [Pact](https://docs.pact.io/) |
| ASP.NET Core | routing, middleware, authentication, serialization, and persistence differences | test rules in isolation; use `WebApplicationFactory`/`TestServer` for the pipeline and a disposable real dependency when the database matters; approve only with status, headers, auth, persistence, and critical failures observed | [Microsoft — integration tests](https://learn.microsoft.com/aspnet/core/test/integration-tests) and [Testcontainers for .NET](https://dotnet.testcontainers.org/) |
| Spring Boot | a slice masks configuration, incorrect profile/security, divergent transaction or integration | use slices for focused feedback and `@SpringBootTest`/random port when risk crosses layers; validate profile, security chain, transactions, migration, and relevant dependencies | [Spring Boot — testing](https://docs.spring.io/spring-boot/reference/testing/spring-boot-applications.html) and [Testcontainers](https://java.testcontainers.org/) |
| Rails | callbacks, validations, routes, jobs, mailers, and system flow diverge | combine model/request/job/mailbox/system tests according to risk and use the supported database adapter in integration; the gate observes the rule, response, side effects, and at least the affected critical journey | [Rails — Testing Rails Applications](https://guides.rubyonrails.org/testing.html) |
| Laravel | middleware, validation, policies/auth, queues, and database are not exercised by a pure unit test | separate unit from feature/HTTP/database tests; fake only the boundary outside the oracle and verify persisted effects; approve a critical endpoint with applicable auth, validation, response, database, and job/event evidence | [Laravel — testing](https://laravel.com/docs/12.x/testing), [HTTP tests](https://laravel.com/docs/12.x/http-tests), and [database testing](https://laravel.com/docs/12.x/database-testing) |
| HTML and HyperFrames | invalid markup, overflow, nondeterministic timing, or an incorrect critical frame | validate HTML; run `hyperframes lint`/`hyperframes check` when exposed by the pinned version; preview/render declared formats and review critical frames/boundaries; any structural, timing, or layout error blocks | [WHATWG — validators](https://whatwg.org/validator/), [Nu HTML Checker](https://validator.w3.org/nu/), and [HyperFrames](https://hyperframes.heygen.com) |
| CSS and visual regression | cascade, responsiveness, theme, font, or environment changes layout/behavior | run Stylelint and semantic/interaction assertions; compare screenshots only in a controlled environment and risk matrix; diffs require explicit review and the gate does not depend on a generated CSS snapshot | [Stylelint](https://stylelint.io/user-guide/get-started/) and [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots) |
| React quality diagnostics | regressions in state/effects, performance, accessibility, security, or component architecture | run React Doctor when pinned/authorized; scope to changed files; triage findings against project risk and preserve exit code and findings as check evidence | [React Doctor](https://github.com/millionco/react-doctor) |
| Terraform | valid configuration produces unexpected replace/destroy, cost, exposure, or state | run `fmt`/`validate`, test module assertions, and review `plan`; use a dedicated account/environment for `terraform test` that creates resources; block unexpected actions and confirm cleanup of every test resource | [Terraform validate](https://developer.hashicorp.com/terraform/cli/commands/validate), [test](https://developer.hashicorp.com/terraform/cli/commands/test), and [plan](https://developer.hashicorp.com/terraform/cli/commands/plan) |
| Kubernetes and containers | a schema accepted locally fails in-cluster, or rollout/probe/rollback/image behavior diverges | use strict validation and server-side dry-run; use an ephemeral cluster when rollout/controller risk justifies it; run build checks and image smoke; the gate covers probes, resources, permissions, applicable rollback, and cleanup | [kubectl apply](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_apply/) and [Docker build checks](https://docs.docker.com/reference/build-checks/) |
| Ansible | a playbook is not idempotent, makes a destructive change, or reaches an incorrect state | run syntax/check when safe and a Molecule scenario with converge, verify, idempotence, and destroy according to risk; approve only if the second convergence causes no unintended change and the environment is cleaned | [Ansible Molecule](https://docs.ansible.com/projects/molecule/) and [test sequence](https://docs.ansible.com/projects/molecule/usage/) |

### React Doctor — optional supplemental React diagnostics

For a React target, [React Doctor](https://github.com/millionco/react-doctor) may be used as a supplemental static/quality scan when it is already available or its execution/install is explicitly authorized. It reports diagnostics across React correctness/state, performance, architecture, security, accessibility, and related design rules.

It does not replace the target's type checker, linter, unit/integration/E2E tests, security review, accessibility review, or performance evidence.

Before using it:

1. **Identify version**: Determine the exact pinned/adopted version.
2. **Follow authority policy**: Determine whether invocation downloads code or changes the environment; follow the target's authorization/network policy.
3. **Telemetry policy**: Review the tool's current telemetry behavior and disable telemetry when target policy requires it.
4. **Scope appropriately**: Select a scope that matches the task (`changed`/equivalent when supported) rather than turning an unrelated existing backlog into a new completion requirement.
5. **Preserve evidence**: Retain the actual findings, exit status, version, and command as evidence.
6. **Risk-based triage**: Triage findings by real project risk instead of treating the numeric score as the pass/fail oracle.

Command examples:

```bash
# If the project already has a pinned React Doctor command:
npm run react-doctor -- --verbose --scope changed

# If an authorized one-off remote invocation is explicitly allowed:
npx react-doctor@<PINNED_VERSION> --no-telemetry --verbose --scope changed
```

> [!NOTE]
> Verify current upstream CLI syntax before execution; external command flags are not part of the ForgeLoop protocol contract.

Evidence integration:

A successful observed run may be recorded through ForgeLoop's existing check mechanism:

```bash
forgeloop run-check \
  --task <task-id> \
  --id react-doctor-changed \
  --requirement react-quality \
  -- <project-owned-react-doctor-command>
```

- **Score Semantics**: A React Doctor score is diagnostic telemetry, not a universal gate. The target contract or project policy may define a versioned threshold, but absent such a contract ForgeLoop evaluates concrete findings against applicable correctness, accessibility, security, performance, and architecture requirements.
- **False Positives**: When a finding is disputed, inspect the exact rule and project context. A suppression/config change is a code-quality policy change and requires the same review as other lint/static-analysis configuration changes; do not disable a rule merely to make a score increase.

## Fixtures, cassettes, and oracles

- Prefer minimal synthetic data. When fixtures are derived from production, anonymize them irreversibly and review reidentification, retention, and licensing risk before committing.
- Control clock, locale, timezone, IDs, seeds, and order. Each test creates and removes its own state or uses proven isolation.
- VCR/VCR.py cassettes are versioned code. Before recording, filter tokens, cookies, authorization headers, parameters, request/response bodies, and all PII; run secret scanning before committing and prohibit automatic recording in CI.
- Define cassette expiration and rerecording so old responses do not hide contract changes. Recorded playback does not replace periodic tests against a real sandbox.
- A snapshot approves only a reviewed representation. A generated CSS snapshot is not a primary oracle: combine it with semantic assertions, interaction, and visual regression in relevant viewports/themes. Bulk updates require diff review and a reason.

## Accessibility: automation plus human evaluation

`axe-core` and Lighthouse detect only an automatable subset. A result with no violations means only that those checks found no failures; it does not prove WCAG conformance. W3C describes automated rules as partial checks and requires human judgment to cover all aspects of the criteria.

For each critical journey and reusable component:

- run automated `axe-core`/Lighthouse checks on visible states, including modals, errors, and dynamically loaded content;
- perform manual review against WCAG 2.2 at the product's adopted level;
- traverse everything with a keyboard and validate focus order/visibility, absence of traps, and focus return;
- test names, roles, states, announcements, and reading with representative assistive technologies, not just the accessibility tree;
- validate contrast, zoom, reflow, orientation, reduced motion, and magnification without loss of content or function;
- on native mobile, test a real device with VoiceOver/TalkBack and platform gestures, focus, external keyboard, text size, rotation, and controls.

Record browser/OS, assistive technology and version, WCAG criterion, result, evidence, and evaluator. Critical keyboard, focus, name/role/state, or journey-access defects block approval.

## Functional approval and critical journeys

An approved journey should cover happy, empty, invalid, denied, interrupted, and recovered states according to risk. Include when applicable:

- slow network, lost/resumed connectivity, timeout, idempotent retry, and offline operation;
- first run, upgrade, logout/login, session expiration, and account switching;
- permissions denied, granted later, and revoked during use;
- background/foreground, suspension, termination, and state restoration;
- locale, timezone, full storage, low memory, and unavailable dependencies;
- OS, browser, and device combinations defined by the support contract and telemetry, with real devices for risks emulators cannot reproduce.

The oracle must observe the user outcome and data invariants, not incidental implementation details.

## Performance and resilience

Before testing, turn expectations into pass/fail criteria tied to product SLOs or budgets:

- p95 and p99 latency per journey/endpoint, sustained throughput, and error rate;
- CPU, memory, energy, connection, and artifact-size consumption when relevant;
- volume, operation distribution, concurrency, dataset, and dependency limits;
- a regression budget relative to a comparable baseline, in addition to absolute SLO limits.

Document hardware, region, build, configuration, dataset, and interference. Separate **warm-up** from the measured window. When performance is relevant, use a capacity smoke and comparable baseline as minimum evidence. Add a **spike** only when bursts, rate limits, autoscaling, or recovery are risks; a **soak** only when duration, leaks, pools, queues, cache, or long sessions are hypotheses; stress/breakpoint only when limits, headroom, or failure mode must be known, always in an authorized environment. The frequency of each mode derives from the SLO, load profile, changes, and cost: there is no universal type or cadence. Fail the gate when a versioned threshold is missed; an isolated average does not replace p95/p99 or the distribution.

## Mobile and desktop

### Mobile

- Test logic and components with platform harnesses; cover native journeys with [XCTest/XCUITest](https://developer.apple.com/documentation/xctest), [Espresso](https://developer.android.com/training/testing/espresso), [Detox](https://wix.github.io/Detox/), or [`integration_test`](https://docs.flutter.dev/testing/integration-tests) only when compatible with the stack.
- Build the version, manufacturer, and device matrix from the support contract, telemetry, and hardware risks. Emulators accelerate feedback; real devices approve sensors, performance, accessibility, permissions, and OS behavior.
- Exercise install/upgrade, deep links, notifications, interruptions, degraded/offline connectivity, and background/foreground transitions.

### Windows

- Isolate WinUI/WPF/WinForms/MAUI logic through MVVM/MVU and test it with the adopted .NET runner.
- As of **2026-08-08**, the path maintained by the Appium ecosystem for Windows UI is the [Appium Windows Driver](https://github.com/appium/appium-windows-driver), installed and versioned as an Appium driver. It still proxies the WinAppDriver server, and its own documentation warns that the Microsoft server has not received regular maintenance for years.
- Treat a harness that starts **WinAppDriver directly** as legacy: preserve it only when an existing suite requires it, pin the version, and maintain a replacement plan. Do not create a new architecture directly coupled to the legacy server.
- Validate installer, privileges/UAC, DPI, multiple windows, shortcuts, and post-install smoke on compatible Windows runners; driver limitations must appear as risk, never as a silently omitted check.

### macOS and Electron

- For native Apple apps, use XCTest/XCUITest according to risk and validate signing, notarization, permissions, menus, shortcuts, and post-install smoke on real macOS.
- For Electron, select [Playwright Electron](https://playwright.dev/docs/api/class-electron) or [WebdriverIO Electron Service](https://webdriver.io/docs/desktop-testing/electron/) by version compatibility, required capabilities, and CI environment.

### Tauri

- Test the Rust backend with `cargo test` and the isolated frontend with the adopted web tool.
- For packaged-app E2E, as of **2026-08-08** Tauri documentation points to WebdriverIO with [`@wdio/tauri-service`](https://webdriver.io/docs/wdio-tauri-service/); the service can use an embedded server or `tauri-driver` on supported platforms. Pin versions and follow the published matrix.
- Do not describe Playwright attached to a Tauri window as a supported path. If a project retains its own experiment, it needs an owner, per-platform evidence, and explicit acceptance of maintenance cost.

## Database migrations and cross-version compatibility

- Test migrations against an empty database and a sanitized copy with production-like volume and distribution. Verify time, locks, indexes, constraints, integrity, and recovery after failure.
- Use **expand-migrate-contract** for incompatible changes: expand the schema without removing the old shape; release code that coexists with both shapes and migrate/backfill data; only after telemetry and the compatibility window, contract the schema in a separate deployment.
- During rollout, prove compatibility between old/new application and old/expanded schema. Test jobs, consumers, replication, and partial deployment.
- In production, prefer **roll-forward** by correcting the cause. A `down` is an option only when reversal is implemented, tested, and does not lose data; otherwise mark the migration irreversible and use the recovery runbook.
- A backup alone is insufficient: validate restore in an isolated environment, RPO/RTO, permissions, and operational sequence before a critical change.

## Flaky tests, retries, and quarantine

- A test that passes on retry remains **flaky**. Preserve the initial failure and artifacts; a limited retry is for diagnosis/known transients, never to turn the gate green or hide failure rate.
- Quarantine requires an issue, owner, reason, minimal scope, entry date, and removal deadline. The protected journey needs substitute evidence while the test is outside the gate.
- Expose flakiness count and rate per test/suite. Exceeding the local budget fails the gate or blocks suite expansion according to the recorded policy.
- Fix synchronization, isolation, state, dependency, and environment; do not use increasing `sleep` as a solution. Remove a redundant test only with proof of equivalent coverage.

## CI cadence and evidence

| Event | Expected gates |
| --- | --- |
| Every PR | applicable lint/typecheck, impacted unit and integration tests, smoke for affected critical journeys, automated accessibility/security checks, coverage/mutation according to risk |
| Merge/protected branch | contracts, broader integration, and reproducible artifacts; exception policies validated |
| Scheduled | broad suites selected by risk: platform matrix, E2E, external sandbox, expensive mutation testing, justified load modes, and extensive scans |
| Release | installer/upgrade/operational rollback, post-deploy smoke, completed manual accessibility evidence, restore/migration, and release SLO criteria; without that evidence, block the release or record a formal exception with an owner and deadline |

A broad suite need not run in full on every PR when its cost reduces feedback without lowering risk. Impact selection must be conservative, auditable, and backed by scheduled execution that detects gaps. A documented command must reproduce each gate; any unexecuted check is `blocked` or `not applicable` with a reason, never `approved`.

## Instruction template for CLAUDE.md / AGENTS.md

```markdown
## Testing

### Risk contract

- Critical journeys and owners: [links]
- Support contract: [OS/browser/device/runtime]
- SLOs and budgets: [p95/p99 latency, throughput, errors, resources]
- Baseline: [repository/change/branch coverage, mutation score, flakiness]

### Selection and commands

- Tools/versions and stack-compatible rationale: [record]
- PR smoke: `[command]`
- Scheduled broad suite: `[command]`
- Performance/accessibility/migration: `[commands or runbooks]`
- Domain gates (API/IaC/framework/HTML/CSS): `[applicable commands and evidence]`

### Gates

- Fixes preserve a red/green regression; changes cover branches and risks.
- Coverage does not regress against the applicable baseline without documented acceptance.
- Mutation testing applies to critical modules according to the local budget.
- Retry does not erase the initial failure; quarantine requires an issue, owner, and expiry.
- Cassettes contain no tokens, cookies, PII, or secrets in requests/responses.
- Accessibility combines automation with manual WCAG 2.2/AT evaluation.
- Migrations use expand-migrate-contract, roll-forward, and rehearsed restore.
- An unexecuted check is recorded as blocked or not applicable.
```

## Approval checklist

- [ ] The risk and protected journey are named, with an owner and oracle.
- [ ] Tool selection considers stack, compatibility, maintenance, runtime, existing project, and CI.
- [ ] Coverage uses repository/change/branch/critical-path baselines, without a universal percentage.
- [ ] For changed critical modules, mutation testing was run or rejected with a cost/risk rationale.
- [ ] PR smoke and scheduled broad suites have separate commands and evidence.
- [ ] SLOs/budgets include p95/p99, throughput, error rate, warm-up, and soak/spike where applicable.
- [ ] Every applicable domain/framework has a recorded risk, approach, tool, and operational gate.
- [ ] Journeys cover degraded/offline network, permissions, and background/foreground where relevant.
- [ ] The OS/device matrix includes real hardware where an emulator does not prove the risk.
- [ ] For affected user interfaces, automated accessibility was complemented by keyboard, AT, zoom/reflow, focus, contrast, and native-mobile checks where applicable.
- [ ] For Windows desktop applications, Appium Windows Driver was used; direct WinAppDriver use is recorded as legacy.
- [ ] For Tauri packaged-app E2E, use `@wdio/tauri-service`/`tauri-driver`, not Playwright attached to the window.
- [ ] Cassettes were redacted and scanned; CSS snapshots are not the primary oracle.
- [ ] Quarantine has an issue, owner, deadline, and substitute evidence; retries do not mask failures.
- [ ] Migrations follow expand-migrate-contract, roll-forward, compatibility, and restore; `down` is truly reversible.
- [ ] Exceptions, blocked checks, and reassessment dates are documented.

## Auditable official sources

Time-sensitive statements in this revision were verified on **2026-08-08**. Revalidate versions, maintenance, and platform support before adopting or updating a tool.

- [W3C — Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/): normative reference and the combination of automation with human evaluation.
- [W3C — Understanding ACT Rules](https://www.w3.org/WAI/WCAG22/Understanding/understanding-act-rules.html): automated rules are partial checks and a pass does not prove complete conformance.
- [Deque — axe-core](https://github.com/dequelabs/axe-core): automated scope, `incomplete` results, and the need for manual review.
- [Chrome for Developers — Lighthouse accessibility audits](https://developer.chrome.com/docs/lighthouse/accessibility/): automated checks and complementary manual items.
- [Appium — drivers](https://appium.io/docs/en/latest/ecosystem/drivers/) and [Appium Windows Driver](https://github.com/appium/appium-windows-driver): driver installation/support and WinAppDriver dependency/limitations.
- [Tauri — WebDriver](https://v2.tauri.app/develop/tests/webdriver/) and [WebdriverIO — Tauri Service](https://webdriver.io/docs/wdio-tauri-service/): `@wdio/tauri-service`, embedded server, and `tauri-driver`; Tauri page updated 2026-06-29.
- [W3C — WebDriver](https://www.w3.org/TR/webdriver2/): standardized protocol used by drivers.
- [Grafana k6 — thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/) and [test types](https://grafana.com/docs/k6/latest/testing-guides/test-types/): pass/fail criteria, percentiles, smoke, spike, and soak.
- [Playwright — retries](https://playwright.dev/docs/test-retries): distinguishes passed, flaky, and failed-after-retry outcomes.
- [VCR.py — filtering sensitive data](https://vcrpy.readthedocs.io/en/latest/advanced.html#filter-sensitive-data-from-the-request): filtering headers, query, body, and responses before recording.
- [Prisma — expand-and-contract migrations](https://docs.prisma.io/docs/guides/database/data-migration): expand, migrate data, and contract sequence for production.
- [Stryker — mutation testing](https://stryker-mutator.io/docs/): mutants used to evaluate the suite's detection ability.
- [Spring Boot testing](https://docs.spring.io/spring-boot/reference/testing/spring-boot-applications.html), [ASP.NET Core integration tests](https://learn.microsoft.com/aspnet/core/test/integration-tests), [Rails testing](https://guides.rubyonrails.org/testing.html), and [Laravel testing](https://laravel.com/docs/12.x/testing): official framework harnesses.
- [OpenAPI](https://spec.openapis.org/oas/), [JSON Schema](https://json-schema.org/learn), [GraphQL](https://spec.graphql.org/), and [Pact](https://docs.pact.io/): API schemas and contracts.
- [Terraform testing](https://developer.hashicorp.com/terraform/cli/test), [Kubernetes kubectl apply](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_apply/), [Ansible Molecule](https://docs.ansible.com/projects/molecule/), and [Docker build checks](https://docs.docker.com/reference/build-checks/): operational IaC/DevOps evidence.
- [Stylelint](https://stylelint.io/user-guide/get-started/), [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots), [WHATWG validators](https://whatwg.org/validator/), and [HyperFrames](https://hyperframes.heygen.com): CSS, visual, HTML, and composition checks.

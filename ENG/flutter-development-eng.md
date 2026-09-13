---
name: flutter-development-eng
language: en
description: "Specialist guide for architecture, implementation, testing, performance, accessibility, platform integration, and release of production Flutter applications."
version: "2026.09"
last-reviewed: "2026-09-09"
guide-id: flutter
---
# Flutter Development Engineering Guide

> Production-oriented Flutter specialist guidance for ForgeLoop-enabled AI coding agents and developers.
>
> This guide is an operational synthesis of the official Flutter documentation at `https://docs.flutter.dev/`, reviewed against the documentation baseline current on 2026-09-09. The Flutter documentation reviewed for this guide generally reports Flutter 3.47.2. Version-sensitive behavior MUST be verified against the project's pinned SDK and the current official documentation before changing code.
>
> This guide complements, rather than replaces, ForgeLoop's general engineering guides. For code structure and maintainability use `clean-code-eng.md`; for verification strategy use `test-code-eng.md`; for threat modeling and trust boundaries use `sec-code-eng.md`; for measured optimization use `perf-code-eng.md`; for visual design use `design-code-eng.md`; and for inclusive interfaces use `accessibility-eng.md`.
>
> Tooling policy: inspect the repository and use already-available tools first. Do not install Flutter, Dart, packages, plugins, SDK components, emulators, native toolchains, AI plugins, or global utilities merely to satisfy a check. Installation or environment mutation requires authority under ForgeLoop policy. If a required check cannot run, report it as blocked or `NOT_VERIFIED`; never claim it passed.

## 1. Mission

The Flutter specialist exists to make Flutter changes that are:

- idiomatic for the actual Flutter and Dart versions used by the repository;
- coherent with the project's existing architecture;
- correct across the target platforms that the project actually supports;
- testable at the appropriate level;
- accessible and adaptive where users interact with the result;
- measurable when performance is relevant;
- explicit about native, web, storage, networking, and security boundaries;
- releasable with evidence rather than assumption;
- minimal in scope while complete for the requested behavior.

The specialist MUST optimize for repository truth rather than generic Flutter preference.

## 2. Authority and precedence

Use the following precedence when instructions conflict:

1. Platform and safety rules.
2. The user's latest explicit request.
3. Repository-local instructions such as `AGENTS.md`, `CLAUDE.md`, `PROJECT_PROFILE.md`, and nested instructions.
4. The actual dependency graph, manifests, generated configuration, target platforms, tests, and source code.
5. The project's established architectural and style conventions.
6. This Flutter guide.
7. General examples from official documentation.
8. Community conventions and third-party package examples.

Do not rewrite a functioning architecture merely because another architecture is fashionable or appears in a tutorial.

## 3. Mandatory discovery before implementation

Before changing Flutter code, establish the real project state.

Inspect, when present:

- `pubspec.yaml`
- `pubspec.lock`
- `analysis_options.yaml`
- `lib/`
- `test/`
- `integration_test/`
- `android/`
- `ios/`
- `web/`
- `macos/`
- `windows/`
- `linux/`
- `assets/`
- `l10n.yaml`
- `.metadata`
- flavors, build scripts, Fastlane, CI configuration, Firebase configuration, and release scripts
- router configuration
- dependency-injection setup
- state-management setup
- generated-code configuration
- platform-channel or FFI code
- existing test helpers and golden infrastructure

Useful commands, only when already available and authorized:

```bash
flutter --version
dart --version
flutter doctor -v
flutter devices
flutter pub deps
git status --short
```

Record at least:

- Flutter SDK version and channel if discoverable;
- Dart version;
- package/app type;
- target platforms;
- current routing strategy;
- current state-management strategy;
- architecture pattern;
- code-generation tools;
- native integrations;
- CI and release surfaces;
- the smallest checks that can prove the requested change.

Do not infer a target platform merely because its generated folder exists. Confirm from project configuration, CI, release scripts, documentation, and user intent.

## 4. Version-sensitive decision rule

Flutter evolves quickly. Treat these areas as version-sensitive:

- navigation and deep linking;
- web rendering and WebAssembly;
- Material and Cupertino component behavior;
- platform embedding;
- native interop and FFI templates;
- plugin APIs;
- accessibility semantics;
- generated localization;
- build and deployment flags;
- DevTools workflows;
- AI/MCP/agent tooling.

For a version-sensitive change:

1. identify the project's actual Flutter version;
2. inspect current project usage;
3. verify the relevant official documentation for that version or migration path;
4. avoid speculative migrations;
5. document any compatibility assumption.

Never copy a current-doc example blindly into a substantially older project.

## 5. Flutter mental model

### 5.1 Declarative reactive UI

Flutter UI is a function of state. Prefer expressing the desired interface for the current state rather than manually mutating view elements.

A useful model is:

```text
state -> widget configuration -> element/render updates -> pixels
```

State changes trigger rebuild work. Rebuilds are expected; expensive work inside rebuilds is not.

### 5.2 Composition over inheritance

Prefer composing small widgets and behaviors instead of creating deep inheritance hierarchies.

Use inheritance when the framework contract requires it, such as:

- `StatelessWidget`
- `StatefulWidget`
- `ChangeNotifier`
- custom render objects
- delegates
- plugin/platform interfaces

Do not invent inheritance solely to share UI fragments that compose naturally.

### 5.3 Layout rule

The essential Flutter layout rule is:

```text
Constraints go down.
Sizes go up.
Parents set positions.
```

When debugging overflow, unexpected width/height, flex, scrolling, or nested layouts, reason from constraints before adding wrappers.

Do not use `Center`, `Expanded`, `SizedBox`, `IntrinsicWidth`, or `SingleChildScrollView` as random overflow fixes without understanding the constraint chain.

## 6. Architecture

### 6.1 Default architecture for scalable applications

For a feature-rich application, prefer the responsibilities recommended by Flutter's architecture guidance:

```text
UI layer
  View
  ViewModel

Data layer
  Repository
  Service

Optional domain layer
  Use cases / domain coordination where complexity justifies it
```

Typical dependency direction:

```text
View
  -> ViewModel
      -> Repository
          -> Service
              -> network / storage / platform / SDK
```

Keep dependencies pointing toward abstractions or lower-level responsibilities intentionally. Avoid circular feature dependencies.

### 6.2 Views

A view SHOULD contain:

- widget composition;
- layout;
- animation orchestration;
- presentation-only conditionals;
- simple route initiation;
- event wiring to view-model commands/actions.

A view SHOULD NOT own:

- network orchestration;
- persistence logic;
- retry policy;
- domain rules;
- data normalization;
- authentication logic;
- business validation beyond immediate presentation constraints.

Keep a view easy to render in a widget test.

### 6.3 ViewModels

A ViewModel SHOULD:

- expose the state required by one view or one tightly bounded UI surface;
- call repositories;
- transform model data for presentation;
- expose user actions/commands;
- own loading/error/success state relevant to its view;
- avoid direct widget dependencies whenever practical.

A ViewModel SHOULD NOT:

- know concrete widget instances;
- parse raw HTTP payloads;
- perform platform-channel calls directly when a service boundary is appropriate;
- become a global dumping ground for unrelated feature state.

### 6.4 Repositories

A repository is the app-facing source of truth for a model or cohesive data domain.

Repositories may own:

- cache policy;
- synchronization strategy;
- model composition;
- retry decisions;
- error normalization;
- merging local and remote sources;
- streams of shared app data.

Repositories SHOULD return application-meaningful models rather than transport DTOs when that separation improves clarity.

### 6.5 Services

Services wrap external data sources or platform APIs.

Examples:

- REST/GraphQL client;
- local database adapter;
- secure-storage adapter;
- file service;
- geolocation plugin wrapper;
- platform-channel adapter.

Services SHOULD have explicit inputs and outputs and SHOULD NOT silently own cross-feature application state.

### 6.6 Optional domain/use-case layer

Add a domain/use-case layer when:

- a business operation coordinates several repositories;
- the same rule is used by multiple ViewModels;
- transaction semantics are non-trivial;
- policy deserves a stable isolated test boundary.

Do not create one-line use-case wrappers around every repository method.

### 6.7 Dependency injection

Prefer constructor injection because dependencies remain visible and tests remain straightforward.

Example:

```dart
class AccountRepository {
  AccountRepository({required AccountApi api}) : _api = api;

  final AccountApi _api;
}

class AccountViewModel extends ChangeNotifier {
  AccountViewModel({required AccountRepository repository})
      : _repository = repository;

  final AccountRepository _repository;
}
```

A service locator or DI container can manage lifecycle at composition boundaries, but domain classes should not need to query a global container during ordinary work.

### 6.8 Existing architecture preservation

If the project already uses a coherent architecture such as BLoC, Riverpod-based feature modules, Redux, Clean Architecture, or another established pattern:

- preserve it unless the task requires an architectural change;
- map this guide's responsibilities onto the existing boundaries;
- avoid mixing competing state-management patterns inside one feature without a migration plan;
- test boundaries rather than renaming concepts to match this document.

## 7. Project organization

Prefer discoverability over a universal folder ideology.

For medium or large apps, feature-oriented structure is often easier to navigate:

```text
lib/
  app/
    app.dart
    router.dart
    theme/
  core/
    errors/
    networking/
    platform/
  features/
    account/
      data/
      presentation/
      domain/        # optional
    settings/
      data/
      presentation/
```

An architecture-oriented structure can also be valid:

```text
lib/
  ui/
  view_models/
  repositories/
  services/
  models/
```

Choose the structure already established by the repository unless there is a concrete navigation or dependency problem.

Generated code SHOULD be predictable and SHOULD NOT contain hand-edited business logic.

## 8. State management

### 8.1 Classify state before selecting a mechanism

Distinguish:

- ephemeral UI state: local selection, animation state, temporary expanded/collapsed state, focus;
- feature state: screen data, asynchronous status, form workflow;
- app state: authentication session, shared preferences, cart, global connectivity policy;
- persisted state: information that must survive process termination.

Do not make all state global.

### 8.2 Local state first

Use local widget state when state is:

- owned by one widget subtree;
- cheap to recreate;
- not needed outside that subtree;
- naturally tied to a widget lifecycle.

Use broader state management only when ownership or sharing requires it.

### 8.3 Existing package first

If the project already uses `provider`, Riverpod, BLoC/Cubit, Redux, Signals, or another established solution:

- follow the existing pattern;
- reuse established providers/blocs/notifiers/stores;
- preserve lifecycle and disposal conventions;
- add a second framework only with explicit architectural justification.

### 8.4 `ChangeNotifier`

`ChangeNotifier` remains suitable for straightforward ViewModels and observable state.

Use it carefully:

- mutate state in controlled methods;
- call `notifyListeners()` only after meaningful observable changes;
- prevent duplicate in-flight actions when needed;
- dispose owned resources;
- avoid enormous global notifiers.

### 8.5 Command-style actions

For repeated async action states, a command abstraction can separate:

- idle;
- running;
- success/result;
- error.

Example intent:

```dart
sealed class SaveState {
  const SaveState();
}

final class SaveIdle extends SaveState {}
final class SaveRunning extends SaveState {}
final class SaveSuccess extends SaveState {}
final class SaveFailure extends SaveState {
  const SaveFailure(this.error);
  final Object error;
}
```

The exact representation should match project conventions.

### 8.6 Result-style error flow

Across architectural boundaries, explicit result objects can make failure paths visible.

Example:

```dart
sealed class Result<T> {
  const Result();
}

final class Ok<T> extends Result<T> {
  const Ok(this.value);
  final T value;
}

final class Err<T> extends Result<T> {
  const Err(this.error);
  final AppError error;
}
```

Do not wrap every local programming error in a result type. Use results when callers are expected to handle domain or integration outcomes.

## 9. Widgets and UI composition

### 9.1 Prefer small cohesive widgets

Extract widgets when they:

- have an independent responsibility;
- have meaningful inputs;
- can be tested independently;
- reduce rebuild scope;
- clarify layout;
- are reused.

Do not extract every `Padding` or `Text` into a class without a semantic reason.

### 9.2 Use `const` where valid

Prefer `const` constructors and instances when inputs are compile-time constants.

Benefits include:

- clearer immutability;
- potential widget reuse;
- less unnecessary object construction.

Do not distort APIs just to maximize `const`.

### 9.3 Keys

Use keys intentionally.

Typical cases:

- preserve identity across reorder;
- distinguish same-type siblings;
- target widgets in tests;
- preserve state while moving widgets.

Avoid random `UniqueKey()` usage because it intentionally destroys identity and may recreate state.

### 9.4 Build methods

A `build()` method should be:

- deterministic for the same state and inherited context;
- free of network calls;
- free of persistence writes;
- free of one-time side effects;
- cheap enough to run frequently.

Do not trigger API calls, analytics mutation, dialogs, navigation, or persistence merely because a widget rebuilt.

### 9.5 Side effects

Run side effects from explicit lifecycle or action boundaries.

Examples:

- `initState()` for lifecycle-owned initialization when appropriate;
- a ViewModel initialization command;
- user action handlers;
- post-frame callbacks only when a frame-dependent side effect is truly required.

Treat `addPostFrameCallback` as a specialized mechanism, not a universal fix.

## 10. Layout, scrolling, and constraints

### 10.1 Flex

Use `Row`, `Column`, `Expanded`, and `Flexible` according to actual constraints.

Common failure:

```text
Column
  -> Expanded
inside an unbounded vertical scrollable
```

Understand whether the main axis is bounded before applying flex.

### 10.2 Scrolling

Choose based on content behavior:

- `ListView` for lists;
- `GridView` for grids;
- slivers for coordinated custom scrolling;
- `SingleChildScrollView` for small bounded content that must scroll as one unit.

Do not render thousands of children eagerly in `Column` + `SingleChildScrollView` when lazy lists are appropriate.

### 10.3 Intrinsic layout

Intrinsic measurement can require additional layout passes.

Use `IntrinsicHeight`/`IntrinsicWidth` only when the UX requires it and the measured cost is acceptable.

### 10.4 Safe areas

Respect system UI, display cutouts, and platform insets.

Use:

- `SafeArea` when the whole surface should avoid system intrusions;
- `MediaQuery` selectively for current environment data;
- padding/insets appropriate to keyboard and system UI behavior.

### 10.5 Large screens and foldables

Do not scale a phone layout indefinitely.

Consider:

- navigation rail or side navigation;
- multi-pane layouts;
- maximum content widths;
- readable line length;
- pointer/keyboard interaction;
- window resize;
- hinge/fold geometry when relevant.

## 11. Adaptive and responsive design

Responsive means fitting the interface to available space. Adaptive means selecting interaction and layout behavior suitable for the space and platform.

The specialist SHOULD:

1. abstract shared content/data;
2. measure the available space where the decision is made;
3. switch layout or interaction pattern at meaningful breakpoints;
4. preserve state across layout changes;
5. test narrow, medium, large, text-scaled, and orientation-changed states.

Avoid user-agent or device-name branching when capability or available size is the real requirement.

### 11.1 Platform idioms

Respect platform expectations where they improve usability:

- keyboard shortcuts;
- selectable text;
- pointer hover;
- context menus;
- scrollbars;
- menu bars;
- title bars;
- drag and drop;
- back behavior;
- text selection;
- control density.

A shared codebase does not require identical behavior everywhere.

## 12. Material, Cupertino, and theming

Flutter ships Material and Cupertino design-system widgets.

Use:

- Material widgets for Material applications;
- Cupertino widgets where iOS/macOS fidelity is a product requirement;
- adaptive widgets or platform-specific composition when behavior genuinely differs.

Centralize design tokens in theme configuration where possible:

- colors;
- typography;
- component themes;
- shape;
- spacing conventions;
- dark/light variants.

Avoid hard-coded one-off colors and text styles scattered through features.

Do not assume platform adaptation means replacing the entire visual identity. Adapt interaction idioms and system expectations intentionally.

## 13. Navigation and routing

### 13.1 Simple navigation

For small apps without complex deep linking, `Navigator` with explicit routes can be enough.

### 13.2 Complex navigation and deep links

For apps with:

- web URL synchronization;
- deep links;
- nested navigation;
- guarded routes;
- multiple navigators;
- complex restoration;

prefer a declarative Router-based solution such as `go_router` when consistent with the project.

Current Flutter documentation does not recommend named routes for most applications.

Do not migrate an existing stable router merely because `go_router` is common. Migrate only for a demonstrated requirement.

### 13.3 Route ownership

Keep:

- route configuration centralized or predictably feature-composed;
- route parameters typed/validated;
- authentication/authorization redirects explicit;
- deep-link behavior tested;
- web back/forward behavior verified for web targets.

Do not place business authorization exclusively in client-side route guards. Server-side authorization remains mandatory for protected data/actions.

### 13.4 Pageless routes

Dialogs, sheets, and imperative pushed routes can be pageless relative to declarative page stacks. Verify their behavior when parent page-backed routes change.

### 13.5 Deep links

For deep links, verify both:

- Flutter route parsing/behavior;
- platform association configuration.

Platform configuration may include:

- Android app links and `assetlinks.json`;
- iOS universal links and associated domains;
- web server rewrite/fallback behavior.

A local `adb` launch can prove app route handling but does not prove hosted association files are valid.

## 14. Forms and input

Separate:

- input presentation;
- field-level validation;
- domain validation;
- server validation.

Client validation improves UX but is not a security boundary.

For forms:

- preserve input state intentionally;
- provide labels and error messages;
- move focus predictably;
- support keyboard submit where expected;
- avoid destructive submit duplication;
- disable or deduplicate in-flight requests where required;
- expose recoverable errors;
- never log secret fields.

Use `TextEditingController`, `FocusNode`, and other lifecycle-owned objects with explicit disposal when the widget owns them.

## 15. Networking

The official Flutter guidance commonly uses the `http` package for straightforward cross-platform HTTP.

Regardless of client library:

- inject the client/service when testability benefits;
- use explicit timeouts;
- validate status codes;
- model transport errors separately from domain outcomes;
- cancel obsolete work when the chosen stack supports it;
- retry only safe transient failures;
- use idempotency strategies for repeated writes;
- never log credentials or full sensitive payloads.

Platform configuration may be required, such as Android internet permission and macOS entitlements.

### 15.1 Network boundaries

Preferred flow:

```text
ViewModel -> Repository -> API Service -> HTTP client
```

The UI should not parse raw JSON.

### 15.2 DTOs and models

Use separate DTO and domain model types when transport schemas and app semantics differ enough to justify it.

Avoid spreading `Map<String, dynamic>` through the application.

## 16. JSON and serialization

Choose manual serialization for:

- tiny models;
- stable schemas;
- low code-generation overhead requirements.

Choose generated serialization when:

- models are numerous;
- schemas evolve;
- correctness and maintainability benefit from generated mapping;
- the project already uses a generator.

Generated code must be reproducible through a documented command.

Never hand-edit generated serialization output.

Validate untrusted data assumptions. A successful JSON parse does not prove semantic validity.

## 17. Async work and isolates

Dart code commonly runs application work on one isolate. Expensive CPU work can block frame delivery.

Move CPU-heavy work off the UI isolate when measurement or known cost justifies it.

Examples:

- very large JSON parsing;
- image/data transformation;
- cryptographic or computational work;
- large local data processing.

`compute()` is suitable for simple isolate-offloaded functions.

Do not use isolates for ordinary async I/O merely because a function returns a `Future`. Network and file APIs are already asynchronous in typical usage.

Data passed across isolates must be transferable/serializable according to Dart isolate rules. Do not attempt to pass arbitrary active objects such as open clients or futures.

## 18. Persistence and offline-first behavior

Select persistence based on data characteristics:

- small settings/preferences;
- secure secrets/tokens;
- structured local database;
- files/blobs;
- caches.

Do not store secrets in plain preferences when a secure platform-backed mechanism is required.

For offline-first systems, define:

- source of truth;
- freshness;
- cache invalidation;
- conflict handling;
- synchronization trigger;
- retry policy;
- user-visible offline state;
- deletion semantics.

"Works offline" is a behavioral contract and requires tests.

## 19. Assets, images, icons, and fonts

Declare static assets predictably in `pubspec.yaml` unless the project uses another supported asset workflow.

For images:

- size assets appropriately;
- avoid decoding huge images to display tiny thumbnails;
- use cache sizing or resize hints when helpful;
- provide placeholders/error states for remote images;
- account for web CORS and hosting constraints;
- ensure meaningful images have appropriate semantics when accessibility requires it.

Use build-time asset transformation only when it is deterministic and integrated into project builds.

## 20. Internationalization and localization

For applications with localization requirements, prefer Flutter's generated localization workflow when consistent with the project:

- `flutter_localizations`;
- ARB resources;
- `l10n.yaml`;
- generated `AppLocalizations`;
- `flutter gen-l10n` or build-triggered generation.

Keep user-visible strings out of arbitrary source files when they are part of the localization contract.

Localize more than words:

- plurals;
- dates;
- numbers;
- currencies;
- text direction;
- layout assumptions;
- semantic labels.

For Flutter web with many locales, deferred locale loading can be considered when it materially improves startup cost; measure before adopting it.

## 21. Accessibility

Accessibility is part of completion for user-facing Flutter work.

At minimum verify relevant surfaces for:

- semantics and accessible names;
- logical focus order;
- keyboard operation where applicable;
- sufficient touch targets;
- large text/display scaling;
- color-independent meaning;
- contrast;
- error identification and correction;
- context changes;
- motion sensitivity;
- screen-reader behavior;
- orientation and responsive reflow.

Flutter guidance calls for tappable targets of at least 48x48 logical pixels in common accessible UI cases.

Do not hide a functional control from semantics unless another accessible representation exists.

Use semantic widgets and framework controls before building custom gesture-only interactions.

When a custom control is necessary, define:

- role/semantics;
- label/value;
- enabled/disabled state;
- action;
- focus behavior;
- keyboard equivalent.

## 22. Animations and motion

Prefer the simplest animation mechanism that satisfies the behavior:

- implicit animation widgets for state-driven transitions;
- built-in transitions such as fade/slide/size;
- `AnimatedBuilder`/`AnimatedWidget` for explicit control;
- `AnimationController` when lifecycle, sequencing, or interactive control requires it.

Dispose owned animation controllers.

Avoid:

- rebuilding large subtrees per tick unnecessarily;
- animation as a substitute for clear state;
- essential information available only through motion;
- expensive clipping/layer operations without profiling.

Respect reduced-motion requirements where relevant to the product and platform.

## 23. Platform integration

### 23.1 Use an existing supported plugin first

Before writing native code:

1. inspect current dependencies;
2. evaluate an existing maintained plugin if appropriate;
3. verify platform coverage and maintenance;
4. inspect permissions and native behavior;
5. prefer a project-owned wrapper around volatile or side-effecting plugins when that improves testability.

Do not add a package solely because it is popular.

### 23.2 Platform channels

Use platform channels when Flutter must invoke native platform APIs not exposed through suitable packages.

Flutter supports platform-specific integration with languages such as:

- Android: Kotlin/Java;
- iOS: Swift/Objective-C;
- Windows: C++;
- macOS: Objective-C family;
- Linux: C/C++-oriented native integration depending on API and plugin structure.

For type-safe channel contracts, consider Pigeon when consistent with the repository.

Keep channel names stable and namespaced.

Define:

- request schema;
- response schema;
- errors;
- threading assumptions;
- lifecycle;
- cancellation or stale-result behavior.

### 23.3 Native thread rules

Platform-channel calls have platform-thread requirements. Follow current official threading guidance for the target platform and Flutter version.

Do not run blocking native work on a platform main thread.

### 23.4 FFI

For C interoperability, prefer the current Flutter-recommended FFI template and build-hook flow for the project's SDK version.

As of the documentation reviewed in 2026, Flutter recommends the `package_ffi` approach with build hooks for typical new C interop use cases; the older `plugin_ffi` template is legacy and remains relevant only for specific requirements.

Always verify this recommendation against the project's Flutter version before migration.

### 23.5 Multiple Flutter engines

Plugin code must not assume one global plugin instance.

For multi-engine compatibility:

- keep engine-specific state on the plugin instance;
- clean resources when detached;
- coordinate access to shared native singletons explicitly;
- avoid static state that leaks across engine lifecycles.

### 23.6 Federated plugins

Use federated plugin architecture when a plugin needs independently maintained platform implementations.

Separate:

- app-facing API;
- platform interface;
- platform implementations.

Do not expose platform implementation packages directly to app code without a reason.

## 24. Add-to-app

When embedding Flutter into an existing native application:

- understand ownership of Flutter engine lifecycle;
- define navigation responsibility;
- coordinate native and Flutter state;
- avoid duplicated singleton assumptions;
- test warm/cold engine behavior;
- verify memory and startup impact;
- test platform back/navigation flows.

Treat add-to-app as an integration architecture, not just a build setting.

## 25. Flutter Web

Flutter web is appropriate when the product benefits from Flutter's app-centric UI model and cross-platform code sharing.

### 25.1 Web compilation

Production Flutter web can compile to optimized web output. Current Flutter supports WebAssembly builds using:

```bash
flutter build web --wasm
```

when compatible with the project and deployment environment.

Do not enable Wasm only because it is newer. Verify:

- browser support;
- package compatibility;
- hosting configuration;
- startup and runtime impact;
- fallback requirements.

### 25.2 Web navigation

For web targets:

- synchronize routes with browser URLs;
- test back/forward;
- support direct loading of deep URLs;
- configure server fallback/rewrite behavior;
- verify base href when hosting under a subpath.

### 25.3 Web semantics and browser expectations

A Flutter web app should still behave like a web application where users expect it:

- keyboard navigation;
- selectable text where appropriate;
- URL copy/share;
- pointer and hover;
- focus visibility;
- responsive layout;
- accessible semantics.

### 25.4 Web images and CORS

Remote images can fail because of browser CORS policy or hosting configuration even when they work on mobile.

Diagnose:

- request URL;
- response headers;
- canvas/rendering path;
- image host policy;
- browser console;
- deployment origin.

Do not treat a missing image as a Flutter widget problem until the network/browser evidence supports that conclusion.

## 26. Android

For Android-specific work, verify:

- `compileSdk`/`targetSdk` and Gradle/AGP/Kotlin compatibility;
- manifest permissions;
- app links;
- signing;
- flavors;
- ProGuard/R8 rules where applicable;
- notification/runtime permission behavior;
- predictive back where relevant;
- release artifact type.

Common release artifact:

```bash
flutter build appbundle
```

Do not modify signing secrets into tracked files.

## 27. iOS and macOS

For Apple-platform work, verify:

- deployment target;
- Xcode compatibility;
- bundle identifiers;
- entitlements;
- capabilities;
- Info.plist usage descriptions;
- universal links/associated domains;
- signing/provisioning;
- privacy-sensitive SDK requirements;
- CocoaPods or Swift Package Manager integration according to project state.

Do not replace an established dependency manager casually.

Release validation may require macOS/Xcode and valid signing credentials; report unavailable signing checks rather than simulating them.

## 28. Windows and Linux

Desktop Flutter work must account for:

- resizable windows;
- mouse/keyboard;
- focus;
- context menus;
- file system behavior;
- installers/distribution;
- native dependencies;
- plugin support;
- high-DPI scaling.

Do not assume a mobile-first interaction remains usable on desktop.

## 29. Packages and dependencies

Before adding or updating a package:

1. determine whether Flutter/Dart SDK already provides the capability;
2. inspect existing dependencies;
3. identify supported platforms;
4. inspect maintenance and compatibility;
5. evaluate transitive impact;
6. understand licenses when relevant;
7. update only what the task requires;
8. run affected tests/builds.

Prefer explicit package constraints compatible with project policy.

Do not run indiscriminate major dependency upgrades while implementing an unrelated feature.

### 29.1 Plugin/package authoring

A reusable package should expose a minimal stable public API.

Keep implementation under `lib/src/` where appropriate and export only intended surfaces from the package entrypoint.

For plugins:

- include platform implementations only where needed;
- test channel boundaries;
- support lifecycle correctly;
- use federated architecture for independently extensible platforms when justified.

## 30. Security

Flutter clients are untrusted clients from a server perspective.

Never rely on client code alone for:

- authorization;
- payment validation;
- entitlement enforcement;
- ownership checks;
- anti-fraud;
- secrets.

Assume app binaries and web assets can be inspected.

### 30.1 Secrets

Do not embed long-lived private secrets in Flutter apps.

Public client configuration is not automatically secret, but credentials that authorize privileged actions must remain server-side.

Never log:

- access tokens;
- refresh tokens;
- passwords;
- personal data without explicit safe handling;
- payment data;
- full API responses containing sensitive content.

### 30.2 Storage

Select storage based on data sensitivity. Authentication tokens and cryptographic material often require platform-secure storage and backend-side controls.

### 30.3 TLS and certificates

Do not disable certificate validation to "fix" connectivity.

Certificate pinning, if used, must include rotation and failure strategy.

### 30.4 AI features

If a Flutter app calls an AI provider:

- do not put privileged provider credentials in the client;
- use backend mediation for production-sensitive quota, authorization, billing, or policy enforcement;
- validate model-generated structured data;
- design failure and malformed-output paths.

## 31. Performance

Flutter apps are commonly performant when standard patterns are used. Optimize from evidence.

### 31.1 Profile in the right mode

Do not diagnose production performance from debug mode.

Use profile mode on supported targets:

```bash
flutter run --profile
```

Use:

- Flutter DevTools Performance view;
- timeline events;
- performance overlay;
- memory tooling;
- CPU profiler;
- browser tooling for Flutter web where appropriate.

### 31.2 Frame budget

A 60 Hz display provides approximately 16 ms per frame. Faster displays provide less time.

Treat 16 ms as a useful mental model, not a universal target independent of refresh rate.

### 31.3 Build cost

Reduce unnecessary rebuild cost by:

- extracting stable subtrees;
- using `const` where natural;
- watching/selecting only needed state where the state framework supports it;
- avoiding expensive computation in `build()`;
- keeping list/grid construction lazy.

### 31.4 Expensive operations

Review carefully:

- `saveLayer`;
- opacity;
- clipping;
- intrinsic layout;
- huge image decode;
- synchronous CPU work;
- shader-heavy custom effects;
- unnecessary layout passes.

Do not remove a visual effect solely because it can be expensive. Measure it on representative devices.

### 31.5 Lists and grids

Prefer lazy builders for large or unknown collections.

Use item extents or prototypes when they materially reduce layout work and match the UI.

### 31.6 Startup and bundle size

For startup/bundle work:

- establish baseline;
- identify dominant cost;
- measure release output;
- consider deferred loading where supported and beneficial;
- remove unused assets/dependencies only with evidence.

### 31.7 Performance evidence

A performance change is not complete without:

- baseline;
- scenario;
- device/platform;
- build mode;
- metric;
- after measurement;
- functional regression check.

## 32. Testing strategy

Flutter's main automated test levels are:

- unit tests;
- widget tests;
- integration tests.

A healthy application typically has many unit/widget tests and enough integration tests to cover critical user journeys.

### 32.1 Unit tests

Use unit tests for:

- model transformations;
- repository policy;
- ViewModel logic;
- validation;
- error mapping;
- pure functions;
- caching decisions.

Keep real network, disk, and platform dependencies out of unit tests unless the test is explicitly an integration boundary test.

### 32.2 Widget tests

Use widget tests for:

- rendering states;
- interactions;
- validation messages;
- navigation triggers;
- semantics;
- loading/error/success UI;
- responsive variants when practical.

Prefer stable semantic/findable elements over brittle text-only targeting when copy can legitimately change.

### 32.3 Integration tests

Use integration tests for:

- critical user journeys;
- route stacks;
- real plugin integration;
- startup;
- cross-layer flows;
- release-like behavior;
- performance scenarios.

The official `integration_test` package integrates with Flutter test APIs and can run on target devices.

Where native system UI interaction is required, a framework such as Patrol may be appropriate if already part of the project or explicitly approved.

### 32.4 Plugin tests

For plugins, test:

- Dart API behavior;
- platform interface behavior;
- native implementation where practical;
- at least one real integration path for each important channel call/platform;
- attach/detach lifecycle.

Mocking only the Dart side does not prove native communication.

### 32.5 Golden tests

Use golden tests when visual regressions are important and the project has a stable golden workflow.

Golden tests require control over:

- fonts;
- pixel ratio;
- platform rendering;
- locale;
- animation state;
- deterministic content.

Do not introduce a broad golden suite without considering maintenance cost.

### 32.6 Accessibility tests

Automated semantics checks are useful but do not replace screen-reader, keyboard, scaling, and real interaction checks when those are relevant.

## 33. Debugging

Diagnose before changing behavior.

Use evidence from:

- exception stack traces;
- Flutter inspector;
- DevTools;
- logs;
- network traces;
- browser console;
- native logs;
- analyzer diagnostics;
- failing tests.

### 33.1 Common layout failures

For overflow or unbounded constraints:

1. identify the offending render object;
2. trace parent constraints;
3. determine which axis is bounded;
4. inspect scroll/flex nesting;
5. make the smallest layout correction;
6. test relevant sizes/text scales.

### 33.2 Async lifecycle failures

Before calling `setState` or using context after an `await`, verify that the owner is still valid.

For widget state, use `mounted`/`context.mounted` as appropriate to the code pattern and Flutter version.

Prefer moving long-lived async state to a ViewModel/repository rather than accumulating lifecycle guards in views.

### 33.3 Duplicate work

If a request fires repeatedly, investigate:

- work started from `build()`;
- listener registered multiple times;
- provider/bloc recreated unexpectedly;
- route rebuild;
- retry loop;
- missing in-flight guard.

Fix ownership rather than merely debouncing symptoms unless debouncing is the intended UX.

## 34. Tooling and code quality

Use project-provided commands first.

Typical Flutter/Dart checks:

```bash
dart format --output=none --set-exit-if-changed .
flutter analyze
flutter test
```

Potential project checks:

```bash
flutter test --coverage
flutter test integration_test
flutter build web
flutter build apk
flutter build appbundle
flutter build ios --no-codesign
flutter build macos
flutter build windows
flutter build linux
```

Run only checks supported by the host OS, installed toolchain, project targets, and authority.

### 34.1 Analyzer

Treat analyzer errors as blocking for changed code.

Warnings and lints should follow repository policy. Do not mass-suppress lints to make CI green.

Prefer fixing the cause.

### 34.2 Formatting

Use Dart formatting rather than manually aligning code against formatter output.

### 34.3 Flutter Fix

`dart fix` / Flutter migration tooling can help with mechanical migrations, but inspect the diff before accepting it.

Do not run repository-wide automated fixes for an unrelated local task without scope justification.

## 35. DevTools

Use Flutter/Dart DevTools as evidence-producing tools.

Relevant views include:

- Inspector;
- Performance;
- CPU profiler;
- Memory;
- Network where supported;
- Debugger;
- logging;
- app-size tooling in appropriate workflows.

Use the tool that answers the current hypothesis; do not collect traces without a question.

## 36. Build modes

Use:

- debug for development and hot reload;
- profile for performance investigation;
- release for production-like output.

Do not compare debug timing against release goals.

Assertions and diagnostics differ by mode. Tests that depend on debug-only behavior are not release validation.

## 37. CI/CD

A Flutter CI pipeline should be proportional to project risk.

A common order is:

```text
dependency resolution
-> generated-code verification
-> formatting
-> static analysis
-> unit/widget tests
-> targeted integration tests
-> target build
-> packaging/signing/release
```

Do not run every platform build on every commit if it creates disproportionate cost without meaningful risk reduction. Use local/pre-merge/release separation according to ForgeLoop policy and repository needs.

### 37.1 Generated code in CI

Choose and document one policy:

- generated code is committed and CI verifies it is current; or
- generated code is produced deterministically in CI.

Do not leave generated-source ownership ambiguous.

### 37.2 Flavors

Use flavors when the app genuinely needs separate:

- identifiers;
- endpoints;
- configuration;
- icons/names;
- entitlements;
- release channels.

Do not encode production secrets into flavor files.

## 38. Deployment

Validate the actual target.

### Android

Potential evidence:

```bash
flutter build appbundle --release
```

### Web

Potential evidence:

```bash
flutter build web
```

or, when intentionally supported:

```bash
flutter build web --wasm
```

Test the built files through a real HTTP server, not only `file://`.

### Apple platforms

Release validation depends on Xcode, signing, provisioning, entitlements, and App Store configuration.

A no-codesign build can prove compilation in some situations but does not prove App Store readiness.

### Desktop

Verify installation/distribution expectations, native dependencies, signing where required, and behavior under resize/input conventions.

## 39. AI-assisted Flutter development

Current Flutter documentation includes official AI-development support.

The ecosystem includes:

- Flutter/Dart agent skills;
- Dart and Flutter MCP server;
- Developer Knowledge MCP;
- package-provided skills;
- specialized agents such as accessibility-focused workflows.

### 39.1 ForgeLoop usage

ForgeLoop may benefit from official Flutter/Dart agent tooling when already available or explicitly authorized.

The specialist SHOULD prefer live project evidence from analyzer/test/runtime tooling over model memory.

Do not automatically install external agent tooling.

### 39.2 Progressive disclosure

For large Flutter tasks:

1. detect the relevant domain;
2. load only the necessary guide sections;
3. inspect project state;
4. run targeted tooling;
5. expand context only when evidence requires it.

This matches both ForgeLoop's selective guide routing and Flutter's current AI-skill direction.

### 39.3 Package skills

A package may ship AI guidance with its package. Treat package skills as package-specific documentation, not higher authority than:

- repository instructions;
- actual API version;
- project tests;
- official package source.

## 40. Dependency and package selection policy

When choosing among packages, evaluate:

| Dimension | Question |
| --- | --- |
| Need | Does the SDK or current project already solve this? |
| Scope | Is the package proportional to the requirement? |
| Compatibility | Does it support the project's Flutter/Dart constraints? |
| Platforms | Does it support every required target? |
| Maintenance | Is it actively maintained enough for this risk? |
| API | Does it produce a stable, testable boundary? |
| Native impact | Does it add permissions, SDKs, build steps, or entitlements? |
| Security | Does it introduce credential or data-handling risk? |
| Size/performance | Is startup/bundle/runtime cost material? |
| Testability | Can behavior be verified without fragile global state? |
| Exit cost | Can it be wrapped/replaced if needed? |

Do not choose dependencies by popularity alone.

## 41. Code generation

Common generated-code categories include:

- JSON serialization;
- localization;
- routing;
- immutable models;
- dependency injection;
- database code.

For any generator:

- keep source-of-truth files clear;
- document the command;
- make output deterministic;
- verify generated output is current;
- avoid editing generated files;
- avoid triggering unrelated repository-wide generation unless needed.

## 42. Error handling

Errors should cross layers intentionally.

Example policy:

```text
transport exception
-> service-level failure
-> repository normalization
-> app/domain error
-> ViewModel state
-> user-visible safe message/action
```

Do not display raw exception strings to users.

Do not erase useful diagnostic classification by turning every failure into `"Something went wrong"` internally.

Use safe structured diagnostics while keeping sensitive values out of logs.

## 43. Lifecycle and resource ownership

Every long-lived resource needs an owner.

Examples:

- `AnimationController`;
- `TextEditingController`;
- `FocusNode`;
- `ScrollController`;
- stream subscription;
- timers;
- native handles;
- database clients;
- event listeners.

Ownership rules:

- create at a deterministic lifecycle boundary;
- dispose/cancel at the matching boundary;
- do not share a disposable object accidentally between unrelated owners;
- prevent callbacks into disposed objects.

## 44. Background execution

Differentiate:

- isolate computation;
- application background execution;
- operating-system scheduled work;
- background notifications;
- foreground services.

A Dart isolate does not by itself grant unrestricted execution while an app is backgrounded or terminated.

For OS background work, use platform-supported mechanisms and a compatible plugin/native integration.

Define platform constraints explicitly.

## 45. Observability

Client observability must be useful and safe.

Prefer structured events such as:

```text
event: profile.load.completed
result: success
duration_ms: 142
request_id: ...
source: cache
```

Never send sensitive values merely because telemetry is encrypted in transit.

Record:

- user-visible failure class;
- integration result;
- duration;
- version/build;
- platform;
- already-redacted context.

Do not emit raw state snapshots by default.

## 46. Recommended implementation playbook

For a normal Flutter feature:

1. Read ForgeLoop project instructions.
2. Confirm Flutter/Dart versions and targets.
3. Identify the current architecture and state-management pattern.
4. Activate `flutter` plus required complementary ForgeLoop guides.
5. Define behavior and acceptance evidence.
6. Locate the smallest feature boundary.
7. Add or update model/service/repository boundaries only when needed.
8. Implement ViewModel/state behavior.
9. Implement UI using existing design system.
10. Add accessibility semantics and adaptive behavior as required.
11. Add unit/widget tests.
12. Add integration coverage only for critical cross-layer behavior.
13. Format and analyze.
14. Run targeted tests.
15. Run proportional regressions.
16. Build the affected target when feasible.
17. Report unavailable target/signing/device checks explicitly.
18. Complete the ForgeLoop lifecycle with structured evidence.

## 47. Bug-fix playbook

1. Reproduce the failure.
2. Capture the smallest evidence that demonstrates it.
3. Identify whether the fault is:
   - UI/layout;
   - state ownership;
   - async lifecycle;
   - routing;
   - serialization;
   - repository/service;
   - plugin/native;
   - platform configuration;
   - deployment/hosting.
4. Add a regression test at the lowest level that proves the real failure.
5. Change the smallest owning layer.
6. Run the regression test.
7. Run proportional adjacent tests.
8. Build/launch affected target when required.
9. Do not refactor unrelated Flutter architecture inside the bug fix unless necessary for correctness.

## 48. Performance-fix playbook

1. Reproduce in profile/release-appropriate mode.
2. Record device, build mode, scenario, and baseline.
3. Use DevTools/browser/native profiling to identify the bottleneck.
4. Form one hypothesis.
5. Make one coherent optimization.
6. Rerun the same measurement.
7. Verify visual/functional behavior.
8. Keep the change only when the evidence supports it.

## 49. Platform-integration playbook

1. Verify no suitable current project abstraction exists.
2. Verify package/plugin options before custom native code.
3. Define the Dart-facing contract.
4. Define platform error behavior.
5. Implement platform-specific code.
6. Test Dart behavior with fakes/mocks.
7. Add integration coverage for the real boundary.
8. Test attach/detach and lifecycle.
9. Verify permissions/entitlements.
10. Build every affected target that the environment supports.

## 50. Web-fix playbook

For web-only failures:

1. reproduce in a supported browser;
2. inspect browser console;
3. inspect network requests and response headers;
4. verify route/base-path hosting;
5. verify CORS;
6. verify service worker/cache behavior when relevant;
7. compare debug versus production build behavior;
8. test direct deep URL load;
9. test back/forward;
10. verify responsive and keyboard behavior.

Do not assume a bug is in Flutter framework code until browser and deployment evidence are ruled out.

## 51. Review anti-patterns

| Anti-pattern | Why it is risky | Required action |
| --- | --- | --- |
| Network request in `build()` | Rebuilds can duplicate effects | Move work to lifecycle/ViewModel/repository boundary |
| Business logic in widgets | Hard to test and reuse | Move to ViewModel/domain/repository |
| `Map<String, dynamic>` everywhere | Weak contracts and runtime failures | Introduce typed DTO/model boundaries |
| Global mutable singleton state | Hidden coupling/lifecycle bugs | Make ownership and injection explicit |
| New state library per feature | Inconsistent architecture | Reuse established project state management |
| Named routes for complex web/deep-link apps | Limited route/deep-link behavior | Prefer Router-based/declarative routing when migration is justified |
| `UniqueKey()` as a rebuild fix | Destroys identity/state | Fix ownership/key semantics |
| `SingleChildScrollView` + huge `Column` | Eager layout and memory cost | Use lazy list/grid/slivers |
| `IntrinsicHeight/Width` everywhere | Extra layout passes | Redesign constraints; use intrinsic sizing only when justified |
| CPU-heavy parsing on UI isolate | Frame jank | Measure and use `compute()`/isolate when needed |
| Performance testing in debug mode | Misleading results | Profile in profile/release-appropriate mode |
| Raw exception shown to user | Leaks internals and poor UX | Normalize errors and expose safe messages |
| Sensitive value embedded in app | Client binaries are inspectable | Keep privileged credentials server-side |
| Client-only authorization | Bypassable | Enforce authorization server-side |
| Blind dependency upgrade | Large unrelated risk | Update only required packages and test impact |
| Hand-edit generated code | Regeneration destroys change | Edit source schema/config and regenerate |
| Platform folder existence treated as support | Generated folders can be unused | Confirm actual target from build/release evidence |
| Ignoring text scaling | Breaks accessibility | Test large scale and responsive reflow |
| Custom gesture control without semantics | Inaccessible | Use standard controls or implement semantics/focus/actions |
| Plugin assumes one Flutter engine | Lifecycle/global-state bugs | Keep engine-specific state per plugin instance |
| Random `setState` after `await` | Disposed-context failures | Check ownership/mounted or move async state out of view |
| Blanket `catch (_) {}` | Hides failures | Handle expected errors and preserve diagnostic class |
| Unbounded retry | Battery/network/server harm | Bound retries and use idempotency |
| Wasm enabled without compatibility evidence | Browser/package regressions | Validate support and measure |
| `adb` deep-link test treated as full app-link proof | Does not prove hosted association | Test hosted association and real external link |
| No release build evidence | Debug success is insufficient | Build affected target when feasible |
| Mass lint suppression | Hides defects | Fix root causes or document narrow exception |

## 52. Definition of Done

A Flutter task is complete only when the applicable items are satisfied.

### Repository understanding

- [ ] Flutter and Dart versions were identified or marked unknown.
- [ ] Actual target platforms were confirmed.
- [ ] Current architecture, router, and state-management strategy were respected.
- [ ] Generated code and native integration surfaces were identified.

### Architecture

- [ ] UI, state, data, and external effects have clear owners.
- [ ] No unnecessary new state-management or architecture framework was introduced.
- [ ] Dependencies are injectable/testable where risk justifies it.
- [ ] Resource lifecycle and disposal are correct.

### UI

- [ ] Layout follows Flutter constraint semantics.
- [ ] Loading, empty, error, success, and disabled states are handled when relevant.
- [ ] Adaptive behavior was tested at relevant sizes/platforms.
- [ ] Platform idioms were considered.

### Accessibility

- [ ] Semantic names/roles/actions are available.
- [ ] Touch/interaction targets are adequate.
- [ ] Keyboard/focus behavior works where relevant.
- [ ] Text/display scaling does not break task completion.
- [ ] Color is not the only carrier of meaning.
- [ ] Reduced-motion behavior was considered when motion is substantial.

### Data and integration

- [ ] External data is validated and typed.
- [ ] Network errors and timeouts are handled.
- [ ] Sensitive values are not logged.
- [ ] Native permissions/entitlements are correct.
- [ ] Plugin/channel lifecycle is tested when changed.

### Navigation

- [ ] Route parameters and redirects are valid.
- [ ] Deep-link behavior is verified when changed.
- [ ] Web back/forward and direct URL loading are verified for web route changes.
- [ ] Platform app/universal-link association is verified when relevant.

### Performance

- [ ] No expensive work was introduced into `build()`.
- [ ] Large collections use an appropriate lazy strategy.
- [ ] Performance claims have profile/release evidence.
- [ ] CPU-heavy work is offloaded only when justified.

### Tests

- [ ] A regression test exists for a bug fix when feasible.
- [ ] Unit tests cover logic changes.
- [ ] Widget tests cover changed UI behavior.
- [ ] Integration tests cover critical cross-layer/platform behavior when warranted.
- [ ] Plugin-native calls have real integration evidence when changed.

### Tooling

- [ ] Formatting passed or is explicitly blocked.
- [ ] `flutter analyze` passed or is explicitly blocked.
- [ ] Targeted tests passed.
- [ ] Proportional regression tests passed.
- [ ] A build for the affected target passed when feasible.
- [ ] Unavailable signing/device/platform checks are reported as `NOT_VERIFIED`.

### Release and ForgeLoop

- [ ] Release-sensitive configuration was reviewed.
- [ ] No secret was added to tracked client code.
- [ ] ForgeLoop evidence records the actual commands and outcomes.
- [ ] Completion is not claimed beyond available evidence.

## 53. ForgeLoop guide routing integration

This file is designed to live at:

```text
ENG/flutter-development-eng.md
```

To make the current ForgeLoop `GUIDE_ROUTER.md` select it automatically, the repository should add a canonical catalog entry similar to:

```markdown
| `flutter` | [Flutter development](ENG/flutter-development-eng.md) | Architecture, UI, state, platform integration, testing, performance, and release for Flutter applications |
```

Add a domain rule similar to:

```markdown
### `flutter` — Flutter application engineering

Activate when: designing, implementing, testing, debugging, profiling, integrating, or releasing a Flutter or Dart application where Flutter is an actual project stack.

Do not activate merely because: documentation mentions Flutter, a generated Flutter example exists, or a dependency name contains "flutter" without the affected application being a Flutter project.

Usually combine with: `clean` and `test`; add `design` and `accessibility` for user-facing UI, `security` for networking/auth/data/plugins/release, and `performance` for rendering/startup/memory/network critical paths.

    rg -n '^## |architecture|ViewModel|state|widget|layout|navigation|deep link|network|serialization|isolate|platform|plugin|FFI|web|accessibility|performance|test|release|Definition of Done' ENG/flutter-development-eng.md

Expected evidence: Flutter/Dart version awareness, architecture-consistent implementation, analyzer/test evidence, accessibility/adaptive checks for UI, platform-boundary validation where changed, and an affected-target build when feasible.
```

The deterministic router may also need an explicit stack signal or routing rule if the current schema cannot identify Flutter from verified project manifests. Do not make natural-language string matching the sole proof that a project is Flutter. A strong deterministic signal is the presence and parsed content of `pubspec.yaml` with an actual Flutter SDK dependency, combined with affected surfaces/platform signals.

## 54. Suggested deterministic Flutter stack evidence

A repository can be classified as Flutter when evidence such as the following is confirmed:

```yaml
dependencies:
  flutter:
    sdk: flutter
```

Useful supporting signals:

- `.metadata` identifies a Flutter project;
- Flutter platform runners exist and are part of build/release configuration;
- `flutter_test` is present under development dependencies;
- CI invokes Flutter tooling.

Do not classify as Flutter only because a lockfile contains a transitive package with "flutter" in its name.

## 55. Suggested completion evidence identifiers

If ForgeLoop's evidence schema is extended for Flutter, useful semantic identifiers may include:

```text
flutter-format
flutter-analyze
flutter-unit-widget-tests
flutter-integration-tests
flutter-target-build
flutter-accessibility-validation
flutter-performance-profile
flutter-native-integration
flutter-deep-link-validation
```

Do not add identifiers to ForgeLoop protocol schemas without updating validators, tests, documentation, and compatibility surfaces together.

## 56. Official documentation map

Primary official Flutter documentation areas used to synthesize this guide:

- Flutter documentation home  
  `https://docs.flutter.dev/`
- Learn Flutter  
  `https://docs.flutter.dev/learn`
- Architectural overview  
  `https://docs.flutter.dev/resources/architectural-overview`
- App architecture  
  `https://docs.flutter.dev/app-architecture`
- Architecture guide  
  `https://docs.flutter.dev/app-architecture/guide`
- Architecture design patterns  
  `https://docs.flutter.dev/app-architecture/design-patterns`
- State management  
  `https://docs.flutter.dev/data-and-backend/state-mgmt`
- Data and backend  
  `https://docs.flutter.dev/data-and-backend`
- Networking  
  `https://docs.flutter.dev/data-and-backend/networking`
- Serialization  
  `https://docs.flutter.dev/data-and-backend/serialization`
- Persistence  
  `https://docs.flutter.dev/data-and-backend/persistence`
- Widget catalog  
  `https://docs.flutter.dev/ui/widgets`
- Layout constraints  
  `https://docs.flutter.dev/ui/layout/constraints`
- Adaptive and responsive design  
  `https://docs.flutter.dev/ui/adaptive-responsive`
- Accessibility  
  `https://docs.flutter.dev/ui/accessibility`
- Internationalization  
  `https://docs.flutter.dev/ui/internationalization`
- Navigation and routing  
  `https://docs.flutter.dev/ui/navigation`
- Deep linking  
  `https://docs.flutter.dev/ui/navigation/deep-linking`
- Animations  
  `https://docs.flutter.dev/ui/animations`
- Assets  
  `https://docs.flutter.dev/ui/assets`
- Platform integration  
  `https://docs.flutter.dev/platform-integration`
- Platform channels  
  `https://docs.flutter.dev/platform-integration/platform-channels`
- Web support  
  `https://docs.flutter.dev/platform-integration/web`
- Desktop support  
  `https://docs.flutter.dev/platform-integration/desktop`
- Packages and plugins  
  `https://docs.flutter.dev/packages-and-plugins`
- Developing packages/plugins  
  `https://docs.flutter.dev/packages-and-plugins/developing-packages`
- Testing and debugging  
  `https://docs.flutter.dev/testing`
- Testing overview  
  `https://docs.flutter.dev/testing/overview`
- Integration tests  
  `https://docs.flutter.dev/testing/integration-tests`
- Performance best practices  
  `https://docs.flutter.dev/perf/best-practices`
- Performance profiling  
  `https://docs.flutter.dev/perf/ui-performance`
- Deployment  
  `https://docs.flutter.dev/deployment`
- Web deployment  
  `https://docs.flutter.dev/deployment/web`
- Tools and techniques  
  `https://docs.flutter.dev/tools`
- Flutter pubspec options  
  `https://docs.flutter.dev/tools/pubspec`
- Flutter and AI  
  `https://docs.flutter.dev/ai`
- AI development setup  
  `https://docs.flutter.dev/ai/get-started`
- Flutter/Dart agent skills  
  `https://docs.flutter.dev/ai/agent-skills`
- Flutter AI tooling architecture  
  `https://docs.flutter.dev/ai/tools`

## 57. Freshness policy

Because Flutter documentation and SDK behavior evolve:

- review this guide after major Flutter stable releases;
- review immediately when a project upgrades Flutter across significant versions;
- verify deprecated APIs against the project's actual SDK;
- prefer official migration guidance over stale blog posts;
- update the `last-reviewed` field when the guide is materially revalidated;
- do not silently rewrite historical project constraints to current defaults.

For tasks involving an API known to have changed recently, the agent should consult the current official documentation instead of relying solely on this guide.

## 58. Summary

A strong Flutter implementation is not defined by using the newest package or the largest architecture.

It is defined by:

- correct state ownership;
- predictable widget composition;
- explicit data and platform boundaries;
- architecture appropriate to project scale;
- accessible and adaptive interfaces;
- version-aware platform integration;
- measured performance;
- proportional automated testing;
- reproducible builds;
- safe release configuration;
- evidence-backed completion.

For ForgeLoop, Flutter expertise should remain a selectively loaded domain guide. Activate it from verified project evidence, combine it with the relevant risk guides, and complete work only to the level actually proven by analyzer, tests, platform checks, and builds.

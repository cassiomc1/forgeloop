---
name: games-code-design-web-eng
language: en
description: "Architecture, design, testing, and operation of 2D, 3D, and procedural web games."
version: "2026.09"
last-reviewed: "2026-10-17"
guide-id: games
requires-gates:
  - simulation
completion-evidence:
  - game-loop
  - accessibility-validation
---

# Web Game Development Guide — 2D, 3D, and Procedural Systems

> Practical instructions for designing, implementing, testing, shipping, and operating 2D and 3D games for the web. Use this document as a reference for AI coding agents and developers. Prefer measured, data-driven decisions, progressive enhancement, graceful degradation, and deterministic behavior over framework defaults or platform assumptions.
>
> **Related documents**: for general code structure, naming, dependency injection, and debugging, see [`clean-code-eng.md`](./clean-code-eng.md). For test strategy and tools such as Vitest and Playwright, see [`test-code-eng.md`](./test-code-eng.md). For browser security, CSP, dependency scanning, and multiplayer threat models, see [`sec-code-eng.md`](./sec-code-eng.md). For budgets, profiling, WebAssembly, PWA, CDN, and device performance, see [`perf-code-eng.md`](./perf-code-eng.md). For visual direction, UX, motion, and responsive design, see [`design-code-eng.md`](./design-code-eng.md). For WCAG 2.2-oriented implementation, assistive technology, and manual testing, see [`accessibility-eng.md`](./accessibility-eng.md). For HTML-based gameplay trailers, devlogs, and demos, see [HyperFrames](https://hyperframes.heygen.com). This guide focuses on game architecture and delivery; it does not replace those documents.
>
> **Tooling policy**: identify the stack, the stage, and the applicable checks; prefer an already available equivalent that produces compatible evidence. Installation or environment changes require authority; reuse scoped authorization already given rather than asking again. If no safe equivalent exists, record the required check as blocked and never claim that it passed. Do not install merely optional resources.

## How to use this guide (mandatory process)

1. Define the target devices, browsers, input methods, network model, visual style, game modes, and performance budget.
2. Choose the smallest rendering and game framework that satisfies the design: Canvas/Phaser/PixiJS for most 2D games; Three.js/Babylon.js/PlayCanvas for 3D; Godot Web export when the project benefits from Godot's editor and engine workflow.
3. Design the simulation independently from rendering and UI. Establish a fixed-step or explicitly documented timing model before adding content.
4. Treat content as data. Use procedural/data-driven generation whenever the content is variable, repeatable, large, streamed, or easy to describe with rules and constraints.
5. Define deterministic seeds, injectable random sources, generation stages, validation, versioning, and fallbacks before implementing procedural content.
6. Build a low-end fallback path before adding optional graphics, WebGPU, multiplayer enhancements, or WebAssembly.
7. Measure a production build on real desktop and mobile browsers, run automated tests and CI checks, and complete the review checklist before release.

The phrase **“always develop procedurally”** is an engineering instruction, not a requirement to replace every artist, designer, or writer. It means: default to procedural and data-driven systems where they improve scale, variation, reproducibility, streaming, or iteration; explicitly document an exception when authored content is the better tool.

---

## Principles

- **Simulation first**: rendering, audio, networking, input, and UI observe or submit commands to the simulation; they do not silently change game rules.
- **Determinism by design**: the same seed, algorithm version, input sequence, and initial state must produce the same result wherever deterministic replay is promised.
- **Progressive enhancement**: start with a playable Canvas/WebGL-compatible path, then enable WebGPU, richer effects, workers, WASM, and higher-resolution assets when supported and affordable.
- **Data over branching code**: represent entities, levels, tuning, encounters, recipes, and rules as validated data rather than large conditionals or duplicated scenes.
- **Critical content always has a safe path**: generated content must be validated and must have an authored or simpler fallback when failure would block onboarding, accessibility, progression, or recovery.
- **Main-thread discipline**: never allow asset decoding, world generation, serialization, pathfinding, or garbage-heavy work to cause avoidable frame stalls.
- **Server authority for competitive games**: the browser is a rendering/input client and must never be the sole authority for score, inventory, damage, matchmaking, or permissions.
- **Accessible by default**: keyboard, touch, gamepad, screen-reader-visible status, reduced motion, color-independent signals, and readable UI are game features, not post-processing.
- **Measure before optimizing**: profile release builds on representative devices and record the trade-off behind each optimization.

---

## Choose the platform and technology

### Rendering and game frameworks

| Need | Recommended starting point | Notes |
| --- | --- | --- |
| Small 2D game or custom renderer | **HTML Canvas** (`CanvasRenderingContext2D`) | Minimal dependency surface; implement batching, camera transforms, culling, and asset management yourself. |
| 2D game with scenes, input, physics integration, and tooling | **Phaser** | Strong fit for browser-first 2D games; use its scene lifecycle and loaders without coupling all domain rules to scenes. |
| 2D renderer/UI layer for a custom engine | **PixiJS** | High-performance WebGL/WebGPU-capable rendering layer; provide your own simulation, scene model, and gameplay systems. |
| 3D library with a flexible rendering and scene API | **Three.js** | Good for custom 3D experiences; own the application architecture, asset lifecycle, and fallback policy. |
| Full 3D engine with physics, tooling, and WebGL/WebGPU paths | **Babylon.js** | Suitable for larger 3D games and interactive scenes; keep engine-specific code behind adapters where portability matters. |
| Browser-based 3D editor and deployment workflow | **PlayCanvas** | Useful when collaborative web tooling and a browser-native editor are priorities; validate runtime and hosting constraints early. |
| Existing Godot project or editor-driven production | **Godot Web export** | Export to Web and test HTML5/Web requirements, threading, memory, input, audio, and browser limitations on target devices. |
| Maximum control or a lightweight prototype | Canvas + TypeScript | Keep the renderer replaceable so WebGL/WebGPU or a framework can be introduced without rewriting the simulation. |

Use **WebGL** as the broad compatibility baseline for accelerated rendering. Detect and use **WebGPU** for supported devices when it provides a measured benefit, but keep a WebGL or Canvas fallback. Do not make WebGPU the only path unless the product explicitly accepts its browser, device, and embedded-context support matrix.

For a new browser-first project, **TypeScript + Vite** is a strong default: strict types, fast development feedback, explicit asset imports, and a small production build. Vite is a build tool, not a game engine; keep the simulation independent of Vite and expose a predictable `npm run build` and `npm run preview` workflow.

### A practical selection rule

- Choose **Canvas 2D** for low-complexity 2D scenes, pixel art, board games, or custom renderers where a DOM UI is also important.
- Choose **Phaser** when a complete 2D game framework reduces implementation risk.
- Choose **PixiJS** when rendering flexibility matters more than a built-in game architecture.
- Choose **Three.js**, **Babylon.js**, or **PlayCanvas** for 3D; compare physics, editor needs, asset workflow, WebGPU maturity, team familiarity, and bundle/runtime cost rather than choosing by popularity alone.
- Choose **Godot Web export** when the existing project, editor workflow, and engine features outweigh export constraints.
- Choose **WebAssembly** only for measured CPU-bound code or when sharing a mature native/Rust library is valuable; it is not an automatic performance upgrade.

---

## Architecture and game loop

### Module boundaries

Keep these modules separately testable:

- `core`: time, deterministic PRNG, entity identifiers, math, commands, events, and serialization.
- `simulation`: world state, rules, collisions, physics integration, AI, progression, and win/loss conditions.
- `generation`: seed handling, staged generation, rules, constraints, validation, and chunk streaming.
- `rendering`: Canvas, WebGL, WebGPU, or engine adapter; it reads a render snapshot and owns GPU resources.
- `input`: keyboard, pointer, touch, `Gamepad`, and `Pointer Lock` adapters that emit normalized commands.
- `audio`: `AudioContext`, music, effects, voice, spatial audio, mute, and visibility handling.
- `assets`: manifests, loading, decoding, caching, versioning, eviction, and fallback assets.
- `network`: WebSockets/WebRTC transport, protocol validation, snapshots, reconciliation, and reconnect behavior.
- `presentation`: menus, HUD, settings, accessibility text, and non-gameplay DOM.

Do not let a rendering callback become the only place where gameplay state is updated. The same simulation should be runnable in a headless test or server process when practical.

### Fixed-step simulation with an accumulator

Use a fixed simulation step for physics, deterministic replays, and network prediction. Render at the display rate and interpolate between simulation states when appropriate.

The TypeScript-shaped pseudocode below assumes `simulation`, `input`, `network`, `telemetry`, and `session` adapters; their project contracts must expose the named operations and be tested.

```ts
type Clock = {
  previousMs: number;
  accumulatorMs: number;
};
type Snapshot = { tick: number; state: unknown };
type ResyncFailureReason = 'request_failed' | 'snapshot_rejected' | 'network_disconnected';

const stepMs = 1000 / 60;
const maxFrameMs = 250;
const maxStepsPerFrame = 5;
const clock: Clock = { previousMs: performance.now(), accumulatorMs: 0 };
let resyncPending = false;

function clearSimulationDebt(): void {
  clock.accumulatorMs = 0;
}

function enterSafeReconnect(reason: ResyncFailureReason): void {
  telemetry.record('resync_failed', { reason });
  clearSimulationDebt();
  resyncPending = true;
  simulation.pausePrediction();
  network.reconnectOrReturnToSafeMenu();
}

function requestAuthoritativeResync(): void {
  clearSimulationDebt();
  simulation.pausePrediction();
  if (resyncPending) return; // one request while a snapshot is pending

  resyncPending = true;
  try {
    network.requestAuthoritativeResync();
  } catch {
    enterSafeReconnect('request_failed');
  }
}

network.onAuthoritativeSnapshot((snapshot: Snapshot) => {
  try {
    simulation.applyAuthoritativeSnapshot(snapshot.state);
    input.discardPredictedCommandsThrough(snapshot.tick);
    clearSimulationDebt();
    resyncPending = false;
    simulation.resumePrediction();
  } catch {
    enterSafeReconnect('snapshot_rejected');
  }
});
network.onResyncError(() => enterSafeReconnect('request_failed'));
network.onDisconnect(() => enterSafeReconnect('network_disconnected'));

function frame(nowMs: number): void {
  const elapsedMs = Math.min(nowMs - clock.previousMs, maxFrameMs);
  clock.previousMs = nowMs;
  clock.accumulatorMs += elapsedMs;

  if (session.isMultiplayer && resyncPending) {
    clearSimulationDebt(); // every pending frame keeps alpha at 0
    simulation.pausePrediction();
    renderer.render(simulation.createRenderSnapshot(0)); // confirmed snapshot and safe reconnect UI
    requestAnimationFrame(frame);
    return;
  }

  let steps = 0;
  while (clock.accumulatorMs >= stepMs && steps < maxStepsPerFrame) {
    simulation.step(stepMs / 1000, input.consumeForStep());
    clock.accumulatorMs -= stepMs;
    steps += 1;
  }

  if (clock.accumulatorMs >= stepMs) {
    telemetry.record('slow_frame', { pendingMs: clock.accumulatorMs, steps });
    if (session.isMultiplayer) {
      requestAuthoritativeResync();
    } else {
      clock.accumulatorMs = Math.min(clock.accumulatorMs, stepMs);
    }
  }

  const alpha = clock.accumulatorMs / stepMs;
  renderer.render(simulation.createRenderSnapshot(alpha));
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
```

Rules:

- Clamp elapsed time to avoid a spiral of death after a tab is suspended.
- Define `maxStepsPerFrame` explicitly and never catch up without a bound. If the limit is reached, record a `slow_frame` telemetry/event with pending time and available cause, then follow a documented local recovery policy (for example, discard debt above one step) or request an authoritative snapshot/resync in multiplayer. While waiting for that snapshot, cap or clear local debt to keep `alpha <= 1` and deduplicate the pending request.
- `resyncPending` must be explicit state: set it before sending the request, pause simulation/prediction, and clear debt on **every** pending frame; render only the last confirmed snapshot and a safe reconnect UI. When the snapshot arrives, apply/reconcile state, discard predicted commands already covered by its tick, clear debt, and only then clear the flag and resume prediction. An error, disconnect, or reconciliation failure must keep simulation paused and trigger reconnect or a safe return; `alpha` must never exceed `1`.
- For `resync_failed`, record only a stable, enumerated `reason`, such as `request_failed`, `snapshot_rejected`, or `network_disconnected`; callbacks and `catch` blocks map to those codes without sending exceptions, payloads, or raw values to telemetry.
- Pause or reduce work when `document.visibilityState !== 'visible'`, but preserve required network/session behavior.
- Never use wall-clock time for gameplay rules that must be replayable. Inject a clock into systems that need real time.
- Use interpolation only for presentation; never feed interpolated render positions back into authoritative simulation state.
- Prefer command/event boundaries (`MovePlayer`, `FireWeapon`, `UseItem`) over direct mutation from UI handlers.

### ECS and data-oriented design

Use an Entity-Component-System (ECS) or a data-oriented layout when the game has many similar entities, frequent queries, streaming worlds, or measured bottlenecks.

- Keep components as plain data: position, velocity, health, collider, renderable, lifetime, and tags.
- Make systems operate on focused component sets, in a documented order.
- Store hot numeric data in contiguous arrays or typed arrays when profiling demonstrates cache, allocation, or iteration benefits.
- Use stable entity IDs/generations so destroyed entities cannot be accidentally addressed.
- Separate hot simulation data from cold metadata, debug labels, and editor-only data.
- Do not adopt a complex ECS solely because it is fashionable; a small explicit world model is often clearer for a small game.
- Preserve deterministic system ordering and avoid iteration over unordered object keys in deterministic paths.

---

## Procedural and data-driven generation (mandatory policy)

### Default decision

Whenever appropriate, use procedural/data-driven generation for terrain, dungeons, rooms, item rolls, enemy waves, foliage, particles, quests, loot tables, test fixtures, localization variants, and streaming content. “Appropriate” means the content benefits from variation, scale, replayability, runtime assembly, compression, or designer-controlled rules.

Do not implement random generation through scattered calls to `Math.random()`. Every generated result must be attributable to an explicit seed and an injectable PRNG.

### Required generation contract

Every procedural feature must define:

- `seed`: the user/session/world seed, represented as a stable string or integer and shown in debug tools when useful.
- `algorithmVersion`: an explicit version such as `caves-v3`; changing the algorithm must not silently change existing worlds.
- `prng`: an injectable deterministic generator with separate streams for independent domains such as terrain, loot, and decoration.
- `inputs`: normalized configuration, difficulty, biome, player progression, and neighboring chunk information.
- `output`: a serializable intermediate representation or data object before rendering.
- `validation`: structural, gameplay, reachability, budget, and safety checks.
- `fallback`: authored, cached, simplified, or previously validated content for critical failures.

Use a small interface so tests and tools can inject a known source:

```ts
export interface Prng {
  next(): number; // [0, 1)
  int(minInclusive: number, maxExclusive: number): number;
  fork(label: string): Prng;
}

export interface GenerationContext {
  seed: string;
  algorithmVersion: string;
  chunk: { x: number; y: number; size: number };
  prng: Prng;
}
```

Do not promise cross-language bit-for-bit determinism unless the PRNG, integer widths, floating-point operations, serialization, and algorithm are specified and tested. For client/server games, server-generated results or compact generation inputs are authoritative.

### Staged generation

Break generation into deterministic, inspectable stages instead of one opaque function:

1. **Normalize** configuration and derive a stable chunk/feature key.
2. **Plan** topology, biome, room graph, encounter budget, or spawn points.
3. **Carve/assemble** geometry and gameplay regions.
4. **Place** required objectives, entrances, exits, resources, and authored landmarks.
5. **Decorate** optional visuals, foliage, particles, and variation.
6. **Validate** constraints and repair or reject invalid output.
7. **Bake/cache** a versioned representation if regeneration would be expensive.
8. **Stream** the result into the active world and release distant chunks.

Each stage should be independently testable and should consume a named PRNG fork rather than depending on how many random calls a previous stage happened to make.

### Streaming, chunks, rules, and constraints

- Derive chunks from stable coordinates and the world seed so they can be generated in any order.
- Add a one-chunk border or equivalent neighbor context when rules depend on adjacent tiles.
- Generate a bounded radius around the player, prioritize visible/required chunks, and cancel stale work.
- Use Web Workers for expensive generation when it can be serialized safely; transfer typed arrays rather than cloning large object graphs.
- Define hard constraints: connectivity, minimum spawn distance, valid navigation, resource availability, difficulty bounds, collision-free placement, and memory limits.
- Define soft constraints with scores and a bounded repair strategy; do not loop indefinitely searching for a perfect result.
- Validate before exposing content to players. If validation fails, retry with a documented derived seed or use the fallback.
- Keep generation independent from frame timing. A slow device must receive the same valid chunk, not a different random result.

### Reproducibility and versioning

- Persist `seed`, `algorithmVersion`, generator configuration, and relevant content/schema versions in saves, replays, bug reports, and multiplayer session metadata.
- Add a debug command or URL/query parameter to load a seed and stage output.
- Capture failed seeds as regression fixtures.
- Never silently migrate an existing world to a new algorithm. Provide a migration, pin the old generator, or explicitly invalidate/rebuild the world.
- Version generated asset manifests and cache keys with the generator and content versions.
- Use golden snapshots only for stable intermediate representations; avoid brittle screenshots as the sole proof of procedural correctness.

### When not to use procedural generation

Do **not** use procedural generation as the default for:

- Critical onboarding, tutorials, first-run UX, recovery flows, or accessibility instructions where clarity and predictability are required.
- Directed narrative beats, authored pacing, cinematics, puzzles with deliberate solutions, and emotionally important set pieces.
- Competitive maps or encounters where fairness requires exact sightlines, spawn positions, and balance guarantees unless the generator is formally constrained and validated.
- Legal, safety, monetization, or compliance-critical text and interactions.
- Small content sets where authoring is cheaper, more expressive, and easier to review.
- Any content that cannot be validated or safely replaced when generation fails.

### Combining authored and procedural content

Use a hybrid approach:

- Author the critical spine: tutorial, entrances, exits, narrative landmarks, accessibility routes, guaranteed rewards, and recovery points.
- Generate the connective tissue: layout variations, optional rooms, enemy composition within budgets, decorations, side paths, and replayable rewards.
- Expose generator parameters and constraints to designers rather than requiring code changes for every tuning pass.
- Reserve authored landmarks with stable IDs and place them through deterministic anchors or sockets.
- Test authored guarantees after procedural assembly: a generated level must preserve the required route, objective, pacing envelope, and fallback affordances.
- Record which content was authored, generated, repaired, or replaced so debugging and support can explain what happened.

### Procedural generation tests

- Use property-based tests with **fast-check** or an equivalent tool to generate seeds, configurations, chunk coordinates, and edge cases.
- Assert invariants rather than only expected pictures: termination, bounds, connectivity, no invalid overlaps, deterministic replay, resource guarantees, and memory limits.
- Run a fixed corpus of adversarial seeds and newly discovered failure seeds in CI.
- Test the same seed repeatedly, in different chunk/request orders, after save/load, and with generation cancellation/retry.
- Test algorithm-version compatibility and migration behavior.
- Test fallback content by forcing PRNG failure, invalid configuration, worker failure, timeout, corrupted cache, and validation rejection.

---

## Input, camera, physics, and interaction

### Input

Normalize all devices into actions rather than letting gameplay systems inspect DOM events directly.

- Support keyboard and pointer for desktop, touch with visible controls for mobile, `Gamepad` for controllers, and `Pointer Lock` for first-person or camera-heavy games when appropriate.
- Define action maps (`move`, `aim`, `primary`, `secondary`, `pause`, `fullscreen`) and allow rebinding.
- Track pressed, just-pressed, released, analog value, and device source per simulation step.
- Use `KeyboardEvent.code` for physical layout-stable bindings and expose a localized label for the UI.
- Treat `pointerdown`/touch as user gestures when requesting fullscreen or starting `AudioContext`; never assume autoplay is allowed.
- Provide an escape path from `Pointer Lock`, a visible cursor/crosshair state, and a non-pointer alternative.
- Prevent browser defaults only on the canvas/game region and only when the action is captured; do not break page scrolling or assistive technology.
- Support `touch-action` deliberately, large touch targets, safe-area insets, and orientation changes.
- Handle Gamepad connection/disconnection, unstable indices, dead zones, remapping, optional vibration, and differing layouts; show the detected device rather than assuming button `0` always has the same role.
- Handle `pointerlockchange`, `pointerlockerror`, Escape, and focus loss; request Pointer Lock only after an explicit gesture and retain a drag/touch alternative.
- Clear pressed keys on focus/visibility loss and make camera smoothing, shake reduction, resize, and device-pixel-ratio behavior configurable.

### Camera and coordinate spaces

Document world, camera, screen, and UI coordinate spaces. Centralize transforms and test them at different device pixel ratios, zoom levels, and viewport sizes. Clamp camera movement to playable bounds and avoid using CSS scaling as a substitute for rendering at a correct internal resolution.

### Physics

- Choose a physics engine that matches the game: simple deterministic AABB/circle tests, an engine such as Matter.js for 2D, or a 3D physics integration such as Rapier when needed.
- Use fixed-step physics and explicit units; document meters/pixels, gravity, collision layers, masks, and solver iterations.
- Keep collision geometry simpler than visual geometry and generate collision data from validated assets or data.
- Avoid tunneling with continuous collision detection or swept tests for fast bodies.
- Do not make physics engine state the only save/replay format; serialize domain state explicitly.
- Validate third-party physics behavior under the target browser/WASM path and decide whether deterministic lockstep is actually supported.
- Never trust client collision for authoritative decisions; validate movement, range, cadence, area of effect, and allowed transitions on the server. Test high speed, stacked bodies, boundaries, moving platforms, teleport, pause, rollback/reconnect, and extreme scales.

---

## Assets, scenes, and content pipeline

- Maintain a versioned asset manifest containing URLs, hashes, origin/provenance, license, attribution, type, dimensions, compression, dependencies, and fallback assets. Attribution must identify the rights holder and any required text or destination when applicable.
- Load a small boot scene first; show progress and allow the user to understand what is loading.
- Prefer `WebP`/`AVIF` where supported, compressed texture formats when the renderer supports them, and appropriately sized atlases rather than many tiny requests.
- Use sprite sheets/atlases, mesh simplification, texture compression, mipmaps, LODs, and instancing based on profiling.
- For 3D, standardize on a tested interchange format such as `glTF`/`GLB`; validate materials, animations, skeletons, coordinate conventions, and texture limits in CI.
- Use `ImageBitmap`, workers, streaming, and incremental decoding where supported, with a non-worker fallback.
- Dispose GPU resources, object URLs, audio buffers, and worker data when scenes or chunks are removed.
- Do not trust asset metadata or downloaded content. Validate type, size, schema, and origin; see [`sec-code-eng.md`](./sec-code-eng.md) for supply-chain and browser security rules.
- Make asset cache keys include the build/content version so a PWA does not combine incompatible code and data.
- Generate distribution notices from the manifest and ship them with every game distribution; do not treat a license field as sufficient if the required attribution is absent.
- Preload in phases (boot shell, first scene, nearby content, optional content) and expose real progress rather than a fake bar; release GPU resources, object URLs, audio buffers, and worker data when scenes or chunks leave memory.

---

## Audio with Web Audio

Use **Web Audio** and `AudioContext` for game audio that needs mixing, effects, volume groups, spatialization, or precise scheduling.

- Create/resume `AudioContext` in response to a clear user gesture and expose a mute/volume control before playing nonessential audio.
- Separate master, music, effects, voice, and accessibility buses; persist user preferences without storing secrets.
- Use pooled short sound effects, decoded buffers for frequently played sounds, and streaming media for long music where appropriate.
- Handle `visibilitychange`, device changes, suspended contexts, and mobile interruptions.
- Use spatial audio only where it improves play; provide volume, subtitles, visual cues, and non-audio feedback for important events.
- Never make audio required to understand a critical instruction or state.
- Test latency, autoplay restrictions, Bluetooth/headphone changes, Safari behavior, and low-memory devices.

---

## 2D and 3D rendering rules

### HTML Canvas and WebGL

- Size the backing buffer using CSS dimensions and `devicePixelRatio`, capped by a configurable maximum to avoid mobile GPU/memory exhaustion.
- Clear, batch, sort, cull, and reuse draw resources; avoid creating objects or textures inside the frame loop.
- Use offscreen canvases or `OffscreenCanvas` only with a tested fallback and a clear transfer/lifecycle model.
- Handle context loss (`webglcontextlost`/`webglcontextrestored`) by rebuilding GPU resources and preserving CPU-side state.
- Use WebGL extensions only after feature detection and keep a baseline path without optional extensions.

### WebGPU with WebGL/Canvas fallback

- Feature-detect `navigator.gpu`, adapter/device creation, required limits, and required features; do not infer support from the user agent.
- Keep renderer selection behind an interface such as `Renderer`, with WebGPU, WebGL, and Canvas implementations where the product needs all three.
- Request only required WebGPU features and limits; handle device loss and allocation failure.
- Keep shader/material assets versioned and validate them during build or startup.
- If WebGPU initialization fails, times out, or exceeds the budget, fall back without losing the game state. Log a diagnostic reason without exposing sensitive data.
- Test WebGPU on Chromium, Firefox where enabled/supported, Safari, and mobile devices separately; feature availability changes by browser and OS.

### 3D-specific guidance

- Use frustum culling, occlusion strategy, LODs, instancing, texture budgets, compressed textures, and a bounded post-processing pipeline.
- Prefer baked lighting or simple lighting on low-end devices; make shadows, bloom, SSAO, reflections, and particles optional quality tiers.
- Pause or reduce rendering when the canvas is not visible through `IntersectionObserver` or page visibility state.
- Provide a 2D/static/image or low-fidelity fallback for unsupported graphics paths, reduced motion, low power, and initialization failure.
- Avoid using 3D merely as decoration. It must improve play, comprehension, or the product's purpose enough to justify its download and battery cost.

---

## Multiplayer: WebSockets and WebRTC

### Choose the transport

- Use **WebSockets** for authoritative client/server messages, lobbies, matchmaking, snapshots, chat, and games where the server must control state.
- Use **WebRTC** data channels for peer-to-peer or low-latency media/data when the product can operate a signaling service and handle NAT traversal through STUN/TURN. Do not assume peer-to-peer means trusted or cheaper.
- Use HTTP/fetch for account, configuration, content manifests, and non-real-time operations.

### Multiplayer architecture

- Define a versioned protocol with schemas, message sizes, sequence numbers, timestamps/ticks, acknowledgements where needed, and explicit disconnect/reconnect states.
- Validate every inbound message on the server and enforce rate, payload, frequency, and state-transition limits.
- Apply backpressure: bound queued messages, input frequency, payload size, synchronized entities, and messages per second; disconnect or degrade abusive clients rather than allowing unbounded work.
- Prefer server-authoritative simulation for competitive or persistent state. The client may predict local movement and interpolate snapshots, but the server resolves truth.
- Use client-side prediction, reconciliation, snapshot interpolation, interest management, and delta compression only after measuring latency and bandwidth.
- Make generated worlds reproducible from versioned seeds/algorithms, but do not trust a client-provided seed or generated result for rewards or competitive outcomes.
- Design reconnect, duplicate messages, late messages, clock drift, tab suspension, packet loss, and server restart behavior explicitly.
- Avoid sending the entire world to every client. Stream authorized chunks/entities and remove stale subscriptions.
- Protect matchmaking, chat, invites, and session tokens with the rules in [`sec-code-eng.md`](./sec-code-eng.md); WebSockets and WebRTC are not authorization boundaries.

### Multiplayer testing

Test deterministic simulation, protocol compatibility, malformed messages, packet loss, reordering, duplication, latency, jitter, disconnects, reconnects, clock differences, multiple players in one chunk, and server overload. Add a headless bot/load test before a public launch.

---

## WebAssembly, Rust, C++, and Emscripten

Use **WebAssembly** for a measured CPU-bound path, a mature native library, deterministic simulation shared between client/server, or code that benefits from Rust/C++ ownership and existing tests.

- **Rust**: use `wasm-bindgen` or a suitable Rust-to-WASM toolchain; keep the JS/WASM boundary coarse and explicit, and minimize repeated string/object copies.
- **C++**: use **Emscripten** when porting an existing C++ engine/library; audit filesystem, threading, exception, memory, and Web API assumptions in the Web build.
- Keep DOM, browser permissions, networking policy, and accessibility in TypeScript/JavaScript or explicit adapters; do not hide browser behavior inside an opaque native port.
- Prefer typed arrays and bulk calls over per-entity JS↔WASM calls.
- Measure download, compile, instantiate, memory, worker, and copy costs—not only inner-loop CPU time.
- Provide a JavaScript/TypeScript fallback for unsupported or failed WASM initialization when the feature is not critical.
- Use COOP/COEP and cross-origin isolation only when required by the chosen threading/shared-memory path, and verify that CDN, iframe, analytics, and third-party resources remain compatible.
- Version the WASM binary and generated bindings; run native and Web tests against the same fixtures when behavior should match.
- Serve `.wasm` with the correct MIME type, effective Brotli/gzip compression, and hash-based caching. Do not instantiate a large module on the critical path when the game can boot without it; initialize it progressively or on demand.

---

## Accessibility and inclusive game UX

Canvas pixels are not a sufficient accessibility API. Build a semantic DOM layer for menus, settings, dialogs, status, inventory, objectives, and essential instructions.

- Provide keyboard navigation, visible focus, remappable controls, and an input alternative for every essential action.
- Support `prefers-reduced-motion`, reduced flashing, pause controls, and a setting to disable camera shake, parallax, and nonessential effects.
- Do not communicate essential state through color, sound, vibration, or motion alone; combine text, shape, pattern, or a semantic status message.
- Provide captions/subtitles, text alternatives for important audio, readable contrast, scalable UI, and a high-contrast option when appropriate.
- Ensure pointer capture and `Pointer Lock` can be exited with a documented keyboard action.
- Use ARIA carefully on the DOM interface (`role="status"`, labels, live regions); do not attempt to make every animated sprite individually focusable.
- Make touch targets large enough, support landscape/portrait changes, and avoid controls hidden behind browser or device safe areas.
- Test with keyboard-only navigation, screen readers, zoom, reduced motion, high contrast, color-vision simulation, touch, gamepad, and a low-power device.
- Use `axe-core` only for the semantic DOM layer. Canvas/WebGL and gameplay require manual smoke flows for keyboard, assistive technology, zoom, and the game flow; automation finds only a subset of issues and does not prove conformance.
- Include accessibility acceptance criteria in content and procedural-generation validation: a generated level must preserve a reachable route, readable landmarks, and required fallback cues.

---

## Security and privacy

Game clients are untrusted. Apply [`sec-code-eng.md`](./sec-code-eng.md) and additionally:

- Never trust client-side scores, inventory, currency, damage, cooldowns, generated loot, collision claims, or permission checks.
- Validate and authorize WebSocket/WebRTC messages server-side; enforce message size, rate, session, and state limits.
- Use HTTPS, secure authentication/session handling, restrictive CSP, explicit CORS, and SRI for third-party CDN scripts where applicable.
- Do not put private API keys, signing secrets, admin capabilities, or authoritative rules only in the bundle. Obfuscation is not a security boundary.
- Treat imported mods, custom maps, save files, replay files, and generated content as untrusted data. Parse with schemas and bounded resource limits; never `eval` content.
- Avoid XSS in chat, player names, clan content, generated text, and debug URLs. Escape DOM output and sanitize only when rich text is truly required.
- Use short-lived, scoped tokens and never place sensitive tokens in URLs, logs, or `localStorage` when safer cookie/session designs are available.
- Minimize telemetry and disclose collection. Do not send raw input, microphone/camera data, or identifiers unless needed and consented.
- Pin/lock dependencies, scan npm/WASM/native assets, review CDN changes, and protect publish credentials in CI.

---

## Performance budgets and compatibility

### Suggested game budgets

Set project-specific values, then enforce them in release builds. Initial targets may include:

- 60 FPS where the design requires it, with a documented 30 FPS low-end tier; avoid relying only on average FPS.
- Frame-time budget of `16.67ms` at 60 FPS, including simulation, rendering, input, audio, and browser overhead.
- No avoidable long task over `50ms` during active play; generation and loading must be staged or moved off the main thread.
- A bounded initial download, decoded texture memory, GPU memory, entity count, active audio voices, and worker count.
- Measured cold start, time to first input, time to playable state, memory after 10–30 minutes, battery/thermal behavior, and network usage.

Use Chrome DevTools Performance/Memory, Firefox Performance, Safari Web Inspector, Lighthouse for the surrounding web shell, the browser GPU tools, and engine profilers. Compare p50/p95 frame time and long frames, not only a headline FPS number.

### Browser and device matrix

Test the actual release build on every browser and device in the documented
support contract. For a cross-browser game, begin with this default matrix:

- Chromium-based desktop and Android browser.
- Firefox desktop/Android where supported.
- Safari on macOS and iOS/iPadOS.
- A modest Android device and an older supported iPhone/iPad.
- Keyboard/mouse, touch, and at least one `Gamepad` where controller support is promised.
- Different `devicePixelRatio` values, viewport sizes, orientation, reduced motion, low power, background/foreground transitions, and slow/unstable networks.

Use feature detection and capability tiers, not user-agent branching. Check `Can I Use` and vendor documentation for WebGPU, WebGL, `OffscreenCanvas`, Web Audio, `Gamepad`, `Pointer Lock`, WebSockets, WebRTC, service workers, and storage. Document unsupported features and the fallback behavior.

### Mobile rules

- Avoid forcing maximum resolution; cap internal render scale and expose quality tiers.
- Respect battery, thermal throttling, memory pressure, safe-area insets, and browser UI changes.
- Pause or throttle inactive tabs and release distant chunks/assets.
- Use touch UI with visible controls; do not require hover, right-click, or precise pointer movement.
- Test iOS Safari gesture/fullscreen/audio behavior separately; mobile browsers are not miniature desktop browsers.

---

## PWA and CDN deployment

### PWA

Use a **Progressive Web App (PWA)** when offline launch, installability, or a reliable return experience benefits the game.

- Provide a valid web app manifest with name, icons, `start_url`, `display`, theme/background colors, and orientation only when justified.
- Register a service worker with a deliberate strategy: precache only the boot shell and critical assets; use runtime caching for versioned immutable content; use network-first or no-cache for accounts, multiplayer, and mutable state.
- Version the cache name and app/content manifest together. On update, notify the player and do not mix an old JavaScript shell with incompatible generated data or assets.
- Implement offline/poor-network states and a predictable recovery path when a cache is incomplete or corrupted.
- Never cache secrets, personalized responses, or authoritative multiplayer state as if they were immutable public assets.
- Test install, update while playing, rollback/recovery, storage quota exhaustion, private browsing, offline boot, and service-worker failure.
- Store local saves in IndexedDB or an appropriate mechanism, with a versioned schema, migrations, quota handling, optional export/import, and a fallback when storage is unavailable. Do not rely on `localStorage` for large, critical, or sensitive saves.

### CDN and static hosting

- Serve immutable hashed JS, WASM, textures, audio, and 3D assets with long-lived `Cache-Control`; serve the HTML shell and manifests with a revalidation policy that allows updates.
- Enable Brotli/gzip for text and WASM where effective, HTTP/2 or HTTP/3, TLS, range requests for large resources when supported, and correct MIME types.
- Configure CORS intentionally for WebGL textures, WASM, workers, fonts, and `glTF` dependencies.
- Use a CDN close to players, but keep an origin or fallback deployment and monitor cache misses, errors, bandwidth, and regional availability.
- Upload source maps privately or restrict access; do not expose secrets through source maps or build-time environment variables.
- Use SRI for external CDN scripts and lock versions. Prefer bundling critical dependencies when supply-chain and availability risk outweigh CDN benefits.
- If using cross-origin isolation for WASM threads, configure `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` deliberately and test every embedded/third-party resource.
- Deploy atomically: a manifest must point to one consistent asset version, and new HTML must never reference hashes that are not yet available on the CDN.

---

## Testing strategy

Follow the testing pyramid from [`test-code-eng.md`](./test-code-eng.md), with additional game-specific layers:

- **Pure unit tests**: math, collision helpers, state reducers, PRNG, command parsing, serialization, cooldowns, scoring rules, and accessibility preference logic.
- **Simulation tests**: fixed-step runs, deterministic replays, save/load, pause/resume, system ordering, physics boundaries, and server/client reconciliation.
- **Procedural property tests**: seeds/configurations/chunks satisfy invariants, terminate, remain bounded, preserve guarantees, and reproduce across request order.
- **Asset/content tests**: schema validation, missing dependencies, corrupted files, dimensions, texture/material limits, localization completeness, and fallback availability.
- **Renderer tests**: WebGL/WebGPU/Canvas capability detection, context/device loss, resize/DPR, shader/material failure, and renderer fallback. Keep most gameplay tests headless.
- **Input/audio tests**: action mapping, rebinding, keyboard/touch/gamepad normalization, pointer-lock exit, autoplay rejection, mute, visibility changes, and captions.
- **Network tests**: protocol schemas, malformed messages, ordering, reconnect, prediction/reconciliation, rate limiting, and compatibility across protocol versions.
- **E2E tests**: use **Playwright** for boot, menu, settings, keyboard/touch smoke flows, save/reload, fallback rendering, and a small multiplayer smoke test. Do not make every test depend on timing-sensitive animation.
- **Visual regression**: use fixed seeds, fixed viewport/DPR, stable fonts/assets, and `toHaveScreenshot()` only for selected deterministic scenes.
- **Performance tests**: release build startup, frame-time budgets, long tasks, memory growth, asset loading, and representative low-end device runs.
- **Accessibility tests**: `axe-core` only for the semantic DOM; manual smoke flows for keyboard, assistive technology, zoom, and the game flow; focus checks, contrast, reduced motion, captions, and generated-level accessibility guarantees. Automation does not prove conformance.

For TypeScript/Vite, a practical baseline is **Vitest** for unit/integration tests, **fast-check** for property-based generation tests, and **Playwright** for E2E/visual testing. Use `npm run lint`, `npm run format -- --check`, `npm run test`, `npm run test:e2e`, and `npm run build` when those scripts exist; document the project's exact commands in `README.md` and `CLAUDE.md`/`AGENTS.md`.

Never use uncontrolled randomness, real sleeps, system time, network availability, or test order as hidden inputs. Inject them or use fakes.

---

## CI/CD and release gates

Every push/PR should run, at minimum:

1. Install from the lockfile (`npm ci` for npm projects).
2. Typecheck (`npm run typecheck` or the project's equivalent).
3. Lint and formatting checks (`npm run lint`, `npm run format -- --check`).
4. Unit/integration/property tests with coverage (`npm run test -- --coverage` when configured).
5. Asset/schema/content validation, including the hash, origin/provenance, license, and attribution fields for every manifest item; generate notices and verify they accompany the distribution, as well as procedural seed corpus and fallbacks.
6. Production build (`npm run build`) and a served smoke test (`npm run preview` in a bounded CI job or an equivalent static server).
7. Playwright Chromium/Firefox/WebKit smoke tests where CI capacity permits.
8. Accessibility and Lighthouse CI checks for the shell and critical routes.
9. Dependency/SCA, SAST, secret, license, and WASM/native artifact scans according to [`sec-code-eng.md`](./sec-code-eng.md).
10. Bundle, initial download, asset, and performance budget checks; fail or require an explicit review when budgets regress.

Use a release artifact with hashed assets, a versioned manifest, source-map handling, and a rollback plan. Deploy to staging first, run real-browser smoke tests, then publish gradually when the product's risk warrants it. Keep generator versions, seeds, content manifests, and protocol versions traceable to the deployed commit.

---

## Instruction template for `CLAUDE.md` / `AGENTS.md`

```md
## Web Game Development

- Target supported browsers and devices explicitly. Use feature detection and capability tiers; never assume WebGPU, WebGL, audio autoplay, gamepad, Pointer Lock, WebAssembly, service workers, or WebRTC are available.
- Keep simulation independent from rendering, DOM UI, audio, networking, and engine adapters. Use a fixed-step simulation when physics, replays, or deterministic networking require it.
- Choose the smallest suitable stack: Canvas/Phaser/PixiJS for 2D; Three.js/Babylon.js/PlayCanvas for 3D; Godot Web export when its editor/engine workflow is justified; TypeScript + Vite for browser-first builds.
- Use WebGPU only through feature detection and always provide a tested WebGL or Canvas fallback when the product supports those devices.

## Procedural and Data-Driven Generation

- Interpret “always develop procedurally” as: use procedural/data-driven generation whenever it improves variation, scale, replayability, streaming, compression, or iteration. Do not use it for critical UX, authored narrative, deliberate puzzles, compliance content, or content that cannot be validated safely.
- Every generated feature has an explicit seed, injectable PRNG, algorithmVersion, normalized inputs, staged pipeline, constraints, validation, and a fallback.
- Never call Math.random() inside generation or simulation. Use named/forked deterministic PRNG streams and claim cross-runtime bit-for-bit determinism only when PRNG, integer width, floating point, serialization, and algorithm are specified and tested; client/server authority remains with the server or its compact generation inputs.
- Generate in deterministic stages: normalize, plan, assemble, place guarantees, decorate, validate, cache, and stream. Use chunks with stable coordinate keys and cancel stale work.
- Persist seed, generator/algorithm version, configuration, content/schema versions, and relevant protocol versions in saves, replays, bug reports, and multiplayer metadata.
- Author critical routes, onboarding, narrative landmarks, accessibility paths, and recovery content; use procedural systems for bounded variation around those authored guarantees.
- Validate generated output before showing it to players. Retry with a documented derived seed or use authored/simplified/cached fallback content on failure.
- Add property-based tests, deterministic replay tests, adversarial seed fixtures, cross-order chunk tests, migration tests, and forced-failure fallback tests.

## Runtime and Assets

- Use an accumulator/fixed-step loop, clamp elapsed time, set `maxStepsPerFrame`, and never update gameplay only from a renderer callback. At the cap, record `slow_frame` and apply local recovery or authoritative resync; never use unlimited catch-up. `resyncPending` must deduplicate the request, pause simulation/prediction, clear debt on every pending frame, and only resume after applying/reconciling the snapshot; error/disconnect goes to reconnect or a safe screen.
- Normalize keyboard, pointer, touch, Gamepad, and Pointer Lock into remappable actions. Provide keyboard/touch alternatives and an escape path from pointer capture. Prevent defaults only in the game region when the action is consumed, preserving page scrolling and assistive technology.
- Use Web Audio only after a user gesture, with mute/volume buses, captions/visual cues for important events, and mobile interruption handling.
- Version and validate asset manifests, including hash, origin/provenance, license, and attribution. Generate notices that ship with the distribution; use compressed, appropriately sized textures/audio/GLB assets, dispose resources, and include fallbacks.
- Validate GLB/glTF materials, animations, skeletons, coordinates, and texture limits in CI; serve WASM with correct MIME/compression/hash caching and defer large noncritical initialization.
- Move generation, parsing, and other CPU-heavy work to Web Workers or WebAssembly only after measuring; keep JS↔WASM calls coarse and provide a fallback when practical.

## Accessibility, Security, and Multiplayer

- Provide a semantic DOM UI for menus, HUD status, settings, objectives, captions, and essential instructions. Support keyboard navigation, visible focus, reduced motion, readable contrast, color-independent state, scalable UI, and touch targets. Run `axe-core` only on the DOM layer, then manually smoke keyboard, assistive technology, zoom, and the game flow; automation does not prove conformance.
- Treat the browser as untrusted. Server-authorize scores, inventory, damage, progression, generated loot, and permissions; validate every WebSockets/WebRTC message and apply rate/size limits.
- Follow [`sec-code-eng.md`](./sec-code-eng.md): HTTPS, restrictive CSP, explicit CORS, safe sessions, dependency scanning, no secrets in the bundle, schema validation for saves/mods/chat, and no unsafe HTML evaluation.
- Escape chat, names, generated text, and debug URLs at the DOM boundary; sanitize rich text only when necessary. Use short-lived, scoped tokens outside URLs, logs, and `localStorage` when a safer cookie/session design is available.
- Use WebSockets for authoritative client/server state and WebRTC only with explicit signaling, STUN/TURN, abuse controls, and a trust model. Design reconnect, ordering, loss, prediction, and protocol versioning.

## Validation and Release

- Required checks: `npm ci`, typecheck, `npm run lint`, `npm run format -- --check`, unit/property tests, asset validation, `npm run build`, Playwright smoke tests, accessibility checks, SCA/SAST/secrets/license/WASM-native scans, and performance/bundle budgets.
- Use Vitest, fast-check, and Playwright for TypeScript/Vite projects unless the repository documents an equivalent.
- Test release builds on every documented browser/device target; for a
  cross-browser game, include Chromium, Firefox, Safari, Android, iOS/iPadOS,
  modest hardware, different DPR/orientations, reduced motion, low power,
  offline/poor networks, and renderer fallback paths.
- For PWA/CDN deployments, version service-worker caches and manifests together; cache immutable hashed assets, never cache secrets, test updates/rollback/offline recovery, use versioned/migrated/quota-aware saves with export/import and a storage fallback instead of `localStorage` for large, critical, or sensitive data, configure CORS/SRI/COOP/COEP deliberately, and deploy HTML/manifests/assets atomically.
- Measure frame time, long tasks, startup, memory, network, and battery before claiming a performance improvement.
```

---

## Web game review checklist

### Architecture and simulation

- [ ] Target browsers, devices, inputs, network model, quality tiers, and budgets are documented.
- [ ] Simulation is independent from rendering, DOM, audio, and transport adapters.
- [ ] Timing model is fixed-step or explicitly justified; elapsed time is clamped and catch-up work is bounded.
- [ ] `maxStepsPerFrame`, `slow_frame` telemetry, and the recovery/resync policy at the cap are explicit; there is no unlimited catch-up. `resyncPending` deduplicates requests, pauses simulation/prediction, clears debt on every pending frame, and resumes only after snapshot reconciliation; error/disconnect reaches reconnect or a safe screen and `alpha <= 1`.
- [ ] ECS/data-oriented design is used only where it improves clarity or measured hot paths.
- [ ] Renderer selection supports the documented WebGPU/WebGL/Canvas fallback policy.

### Procedural/data-driven content

- [ ] Appropriate variable/streamed/replayable content uses data-driven/procedural systems.
- [ ] Every generator has a deterministic seed, injectable PRNG, named streams, and an `algorithmVersion`.
- [ ] Cross-runtime bit-for-bit determinism is claimed only with specified/tested PRNG, integer width, floating point, serialization, and algorithm; client/server authority remains with the server or its compact generation inputs.
- [ ] Generation is staged, chunk-aware, bounded, cancellable, and independent of request/frame timing.
- [ ] Rules, hard/soft constraints, validation, repair limits, and critical guarantees are explicit.
- [ ] Seed, algorithm, content/schema versions, and configuration are reproducible in saves/replays/bug reports.
- [ ] Authored content covers onboarding, directed narrative, critical UX, required routes, and recovery paths.
- [ ] Generated failures have tested authored, cached, simplified, or previously validated fallbacks.
- [ ] Property-based tests, adversarial seeds, deterministic replays, migration tests, and forced-failure tests run in CI.

### Input, physics, assets, and audio

- [ ] Keyboard, pointer, touch, Gamepad, and Pointer Lock behavior is normalized and remappable as applicable.
- [ ] Browser defaults are captured only in the game region for consumed actions; page scrolling and assistive technology remain functional.
- [ ] Every essential action has an accessible alternative; pointer capture can be exited.
- [ ] Physics uses documented units, fixed steps, collision layers, and validated/simple collision geometry.
- [ ] Asset manifests are versioned and validated for hash, origin/provenance, license, and attribution; generated notices ship with the distribution; assets are compressed, appropriately sized, and disposable; missing assets have fallbacks.
- [ ] GLB/glTF materials, animations, skeletons, coordinates, and texture limits are validated in CI; GPU resources, object URLs, audio buffers, and worker data are released with scenes/chunks; WASM MIME/compression/hash caching and deferred noncritical initialization are verified.
- [ ] Web Audio handles user gestures, autoplay rejection, mute, volume groups, captions/visual cues, visibility, and mobile interruptions.
- [ ] WebGL context loss and WebGPU device loss are handled without losing CPU-side game state.

### Accessibility and security

- [ ] Menus, HUD status, settings, objectives, and critical instructions have a semantic DOM representation.
- [ ] Keyboard focus, contrast, reduced motion, captions, scalable UI, touch targets, and color-independent feedback are tested; `axe-core` covers only the DOM and manual smoke covers keyboard, assistive technology, zoom, and the game flow. Automation is not treated as proof of conformance.
- [ ] Client data is never trusted for authority; WebSockets/WebRTC messages are authenticated, authorized, schema-validated, and rate-limited.
- [ ] CSP, HTTPS, CORS, SRI, dependency scanning, secret handling, save/mod/chat validation, and safe DOM output are configured.
- [ ] Chat, names, generated text, and debug URLs are protected from XSS; short-lived, scoped tokens do not appear in URLs, logs, or `localStorage` when a safer cookie/session design exists.
- [ ] Telemetry is minimized, documented, and free of unnecessary personal or sensitive data.

### Multiplayer and compatibility

- [ ] Transport choice is justified: WebSockets for authoritative server state, WebRTC only with signaling/STUN/TURN and an explicit trust model.
- [ ] Protocol versions, sequencing, reconnect, duplication, loss, jitter, prediction, reconciliation, and server authority are tested.
- [ ] Browser feature detection and capability tiers cover only capabilities
  that the documented support contract includes or the project uses (for
  example WebGPU/WebGL, Web Audio, Pointer Lock, Gamepad, WebAssembly, PWA,
  WebSockets, and WebRTC); each supported capability has a documented fallback
  or an explicit support-boundary decision.
- [ ] Release builds have evidence for every documented browser/device target;
  cross-browser games include desktop Chromium/Firefox/Safari, Android,
  iOS/iPadOS, modest devices, touch/gamepad, different DPR/orientations, and
  low-power conditions.

### Performance, testing, CI, and deployment

- [ ] Frame-time/long-task, startup, memory, network, battery, bundle, texture/audio, and worker budgets are measured on representative devices.
- [ ] Vitest/unit, property-based, simulation, asset, renderer, accessibility, Playwright E2E, and selected visual regression tests exist.
- [ ] CI runs typecheck, lint, formatting, tests, seed corpus, asset validation, production build, smoke tests, accessibility, SCA/SAST/secrets/license/WASM-native scans, and budget checks.
- [ ] PWA service-worker caches, manifests, updates, offline recovery, quota failure, and rollback are tested; saves use a versioned schema, migrations, quota handling, optional export/import, and a storage fallback, without `localStorage` for large, critical, or sensitive data.
- [ ] Deployment is atomic: HTML, manifest, and asset hashes reference a consistent version already available on the CDN.
- [ ] CDN uses hashed immutable assets, correct MIME/CORS, compression, cache policy, SRI for external scripts, and a rollback plan.
- [ ] Generator versions, seeds, content manifests, protocol versions, and release commit are traceable in production diagnostics.
- [ ] A versioned, hashed artifact passes staging, real-browser smoke, and gradual rollout when appropriate; release commit, generator, seeds, manifest, and protocol are traceable.

---

## Sources and references

- HTML Canvas: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API
- WebGL: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API
- WebGPU: https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
- WebGPU specification: https://www.w3.org/TR/webgpu/
- Phaser: https://phaser.io/
- PixiJS: https://pixijs.com/
- Three.js: https://threejs.org/
- Babylon.js: https://www.babylonjs.com/
- PlayCanvas: https://playcanvas.com/
- Godot Web export: https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html
- TypeScript: https://www.typescriptlang.org/
- Vite: https://vite.dev/
- Web Audio API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
- Gamepad API: https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API
- Pointer Lock API: https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API
- WebSockets API: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
- WebRTC API: https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API
- WebAssembly: https://webassembly.org/
- Rust and WebAssembly: https://rustwasm.github.io/docs/book/
- Emscripten: https://emscripten.org/
- Progressive Web Apps: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps
- Service Worker API: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
- web.dev — Ready Player Web: https://web.dev/articles/ready-player-web
- Web performance: https://web.dev/performance/
- Can I Use: https://caniuse.com/
- Vitest: https://vitest.dev/
- fast-check: https://fast-check.dev/
- Playwright: https://playwright.dev/
- axe-core: https://github.com/dequelabs/axe-core
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- Game Accessibility Guidelines (complementary community guidance, not a standard and not a replacement for WCAG): https://gameaccessibilityguidelines.com/
- OWASP Cheat Sheet Series: https://cheatsheetseries.owasp.org/
- MDN Web Docs — Web APIs: https://developer.mozilla.org/en-US/docs/Web/API

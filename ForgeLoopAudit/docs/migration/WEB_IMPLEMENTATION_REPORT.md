# ForgeLoopAudit web migration report

## Scope completed

ForgeLoopAudit `0.3.0-rc.3` now uses a local loopback web host and browser
renderer aligned to ForgeLoop `1.12.0` at commit
`ea362768dacfe885b1cc2729dd32ee661d60008f`. The vendored package is the local
archive `vendor/cassiomc1-forgeloop-1.12.0-ea36276.tgz`; its SHA-256 is
`b36b03bdbc79537af25e5d633962839c2e00cac3d9416cd014758852e31bcde1`.

ForgeLoop owns the new deterministic Flutter project detection and canonical
`flutter` guide routing. ForgeLoopAudit preserves canonical route/context guide
IDs without recomputing project classification or treating guide selection as
verification evidence.

The pre-migration state is preserved in
[`WEB_BASELINE.md`](WEB_BASELINE.md). That file is a historical record and is
not updated with post-migration values.

## Architecture delivered

- `src/server/cli.ts` starts the loopback server, resolves the trusted schema
  directory, accepts `--project` or `--demo`, and prints a bootstrap URL.
- `src/server/web-server.ts` owns explicit typed HTTP routes, bootstrap/session
  checks, security headers, static-file containment, SSE and managed exports.
- `src/server/runtime/audit-runtime.ts` owns project lifecycle, watcher updates,
  canonical read services, reports, history and Repository Index/Search.
- `src/renderer/lib/audit-client.ts` replaces the old renderer bridge with a
  same-origin typed HTTP client and EventSource subscription.
- Electron main, preload, IPC registration and Electron packaging paths were
  removed from the active product build. The browser remains an unprivileged
  client; the CLI/server owns filesystem access.

## Security and lifecycle boundary

The server binds to loopback, rejects disallowed hosts/origins, uses a random
bootstrap token and establishes an HttpOnly/SameSite=Strict session cookie. API
responses use safe error envelopes without internal details. Static assets are
contained below the renderer root. There is no generic command, file-read or
IPC dispatch endpoint.

Project paths are supplied by the CLI or reopened only from server-owned recent
project records. Report exports use a collision-resistant filename below the
application-data export directory. Recent projects and audit history remain
outside `.forgeloop/`.

## UI delivered

The renderer uses code-owned shadcn-style primitives for buttons, cards, badges,
inputs, separators and theme controls. `ThemeProvider` supports dark, light and
system themes, defaults to dark and persists only the visual preference. The
Settings page and title bar use the same provider.

The new Repository Search page is explicitly labelled **Discovery only**. It
displays the negotiated Repository Index health and search results without
promoting discovery output to evidence, findings authority or lifecycle state.
Reports display managed-storage behavior and no longer ask the browser for an
arbitrary destination path.

## Verification and delivery boundary

The current browser contract is covered by `tests/e2e/web-smoke.spec.ts` and
the screenshot capture uses the same built web server. CI runs the shared
`npm run verify:full` contract on Ubuntu, macOS and Windows, then runs the
Chromium smoke suite. The release workflow builds one npm web package, emits a
checksum and CycloneDX SBOM, and does not claim signing, deployment or
publication merely from a local build.

The following commands are the reproducible local verification entry points:

```bash
npm run verify:forgeloop-lineage
npm run protocol:schemas:verify
npm run typecheck
npm run lint
npm test
npm run test:web-smoke
npm run screenshots:readme
npm run screenshots:check
npm run docs:check
npm run verify:full
```

## Known limitations

- The browser cannot open an arbitrary local directory by itself; use the CLI
  `--project` option or a server-owned recent record.
- Repository Index/Search remains unavailable when ForgeLoop does not advertise
  the capability or its engine is unhealthy.
- The current release candidate is an unsigned preview. CI and package checks do
  not prove public registry publication, production deployment or signed trust.

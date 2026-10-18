# Troubleshooting

## The browser does not open

Run the server explicitly and copy the printed bootstrap URL into a browser:

```bash
npm run build:web
FORGELOOP_AUDIT_NO_OPEN=1 node dist/server/cli.mjs --demo --no-open
```

The server binds to `127.0.0.1`. Check the terminal for the origin, bootstrap
URL and application-data root. A browser request to a different host or origin
is intentionally rejected.

## Bootstrap or session failure

Use the complete URL printed by the same server process. The token is exchanged
for an HttpOnly/SameSite=Strict session cookie; do not copy it into local
storage or change the host from the printed loopback origin. Restart the server
to obtain a fresh token. Playwright tests may set
`FORGELOOP_AUDIT_TEST_REUSABLE_BOOTSTRAP=1`; do not use that setting for a user
run.

## Blank page or missing assets

Build both renderer and server bundles and verify that `dist/renderer/index.html`
and `dist/server/cli.mjs` exist:

```bash
npm run build:web
npm run build
```

Inspect the browser console and the server terminal. The product no longer uses
Electron preload errors, native window chrome or a localhost development
renderer in its production path.

## Open a different project

The browser cannot select an arbitrary local directory. Start the local host
with an explicit CLI path:

```bash
node dist/server/cli.mjs --project /absolute/path/to/project
```

The web UI may reopen only a server-owned recent-project record. This boundary
prevents browser code from becoming a general filesystem picker or uploader.

## Invalid ForgeLoop artifact

Record the artifact name and schema validation error. Invalid or unverified data
must remain visibly distinct from a valid protocol state. Verify the trusted
lineage and schemas:

```bash
npm run verify:forgeloop-lineage
npm run protocol:schemas:verify
```

## Diagnostics show a compatibility mode

Settings and Diagnostics report the negotiated mode verbatim:
`INTEGRATION_V1`, `ARTIFACT_ONLY` or `INCOMPATIBLE`. Missing optional resources
remain `UNAVAILABLE`; a `COMMIT_UNKNOWN` or unknown value is not inferred away.
The bundled Integration API is the canonical semantic channel.

## Ownership or workspace binding is unavailable

Canonical ownership comes from the ForgeLoop Integration API resource
`task/ownership`. Workspace binding is a separate optional projection. A
missing, malformed or unavailable resource stays unavailable; ForgeLoopAudit
does not infer authority from raw artifacts or phase names.

## Repository Index/Search is unavailable

Open Repository Search and inspect Index health and diagnostics. The capability
is optional and may report `UNAVAILABLE`, `ENGINE_MISSING`, `ENGINE_INVALID`,
`SERVER_DOWN` or `SERVER_UNHEALTHY`. Search output is discovery-only and never
becomes canonical evidence.

## Report export failed

Reports are written below application data, outside the audited `.forgeloop`
directory. Check disk permissions and the resolved application-data root. The
browser cannot provide an arbitrary destination path. Set
`FORGELOOP_AUDIT_DATA_DIR` to an owned temporary directory when isolating a
local run.

## Web smoke or screenshot failure

Install the Playwright browser once and rerun the built contract:

```bash
npx playwright install chromium
npm run test:web-smoke
npm run screenshots:readme
npm run screenshots:check
```

The screenshot capture uses the same web server and browser session as the
smoke suite. A local green run still does not prove Windows/Ubuntu CI,
publication, deployment or signed distribution.

## Vendored ForgeLoop lineage mismatch

`npm run verify:forgeloop-lineage` fails when the vendored archive, lockfile
entry, schema provenance or documented baseline disagree. The expected archive
name embeds the ForgeLoop version and the first seven characters of the pinned
source SHA, for example
`vendor/cassiomc1-forgeloop-2.0.0-4ff11bb.tgz`. Check out the pinned ForgeLoop
commit, run its `npm pack`, replace the archive, update `vendor/README.md` with
the new SHA-256, regenerate `schemas/provenance.json`, and rerun both
`npm run verify:forgeloop-lineage` and `npm run protocol:schemas:verify`. Do not
edit lockfile integrity hashes by hand.

## Schema provenance mismatch

`npm run protocol:schemas:verify` fails when a trusted schema byte differs from
its recorded hash, or when the trusted set no longer matches the artifact
registry. Regenerate provenance only from a controlled ForgeLoop checkout with
`scripts/generate-schema-provenance.mjs --source <forgeloop> --commit <sha>
--package-version <version>`.

## ForgeLoop storage migration and package access

ForgeLoop 2.0.0 uses SQLite for operational state. Audit does not migrate
real projects. Legacy JSON projects open in `ARTIFACT_ONLY`; stop all writers
and follow ForgeLoop's explicit `storage-migrate` procedure to obtain native
canonical projections. Pending cutover, invalid markers and missing selected
databases fail closed; retained JSON exports never replace native state.

Use Node.js 24.19.0 or newer. Native raw JSON and ledger previews are unavailable
through the public API; use canonical History, Trace and Audit UX views.
ForgeLoop is PolyForm Noncommercial 1.0.0 with public publish access. Audit
still installs its controlled local archive, which includes the upstream license.

## Unsupported or unavailable provider extension

`providerExtensions` is experimental and provider-neutral. When it is not
advertised — or when a future version, provider kind or authority flag does not
match the supported v1 contract — ForgeLoopAudit shows the feature as
`Not advertised` and continues in `INTEGRATION_V1`. ForgeLoopAudit never imports
private ForgeLoop provider modules, never installs a provider, and never calls
`runBrowserVerification`, `runSecurityReview` or emulated-services adapters.
Provider output is observation-only: it is never promoted to evidence,
ownership, claims, publication or completion.

## Task shows ABANDONED

Abandonment is a canonical ForgeLoop outcome (`TASK_ABANDONED`), not a failure
of the auditor and not a completion. The task keeps its last phase, canonical
ownership moves to released-by-recovery, and the claims captured by the
abandonment boundary are released. Resume requires an explicit ForgeLoop
recovery/resume command; ForgeLoopAudit never resumes a task on its own.

## Contract revision invalidates derived artifacts

After a canonical `CONTRACT_REVISED` event, plan, preflight, route and gate
artifacts bound to the previous contract fingerprint are stale. ForgeLoopAudit
shows the revision boundary in the event history and never presents invalidated
artifacts as current authoritative state. Re-run the canonical ForgeLoop
routing/planning commands; do not edit the artifacts by hand.

## Checkpoint revalidation state

A canonical `CHECKPOINT_REVALIDATED` event records repository-only drift and
refreshes the checkpoint binding. It is a provenance refresh, not new execution
and not completion. If a task's work-state fingerprint, phase, revision or
repository fingerprint disagrees with the revalidation, canonical validation
fails closed; resolve it in ForgeLoop rather than editing `events.ndjson`.

## Continuity NOT_APPLICABLE

`NOT_APPLICABLE` means the optional continuity record is absent, which is valid.
It is not the same as invalid continuity, which remains a fail-closed condition
and is surfaced as a finding.

## Restored SQLite project is not detected

An attachment-inclusive ForgeLoop 2.0.0 `storage-restore` activates the database and retained
restore provenance; it does not install project code or the kit/identity
manifest. After restoring through the public ForgeLoop CLI, run `forgeloop init`
in the restored directory, then open it in Audit. Audit remains read-only and
never runs initialization or migration on your behalf. Keep the restore journal
and retained snapshot; do not rewrite historical execution roots or hashes.

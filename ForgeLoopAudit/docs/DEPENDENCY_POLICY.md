# Dependency policy

The current dependency baseline is ForgeLoopAudit `0.3.0-rc.3` with ForgeLoop
`2.0.0` from `4ff11bb4bc4be39b095a151a323f1388dad0d819` (protocol v1, schema
v1, Integration API v1). The ForgeLoop dependency is a pinned local tarball;
the lockfile and archive are part of the review surface.

ForgeLoop package metadata is `license: PolyForm-Noncommercial-1.0.0` with
`publishConfig.access: public`. Audit continues to use the immutable local
archive and preserves its included license. Commercial use is not granted.
The supported Node.js baseline is 24.19.0 or newer, matching upstream SQLite
requirements; CI and release workflows use Node.js 24.19.0.

Production high/critical vulnerabilities block release. Development findings
require an owner and an upstream remediation path. The lockfile is mandatory,
and install scripts are explicitly reviewed through `package.json.allowScripts`.

Use the repository policy and production-audit gates:

```bash
npm ci
npm run dependency:policy
npm run audit:prod
npm run verify:forgeloop-lineage
```

Development-only findings are triaged with `npm audit --json`, checking
reachability, advisory severity and the first fixed version. Dependency families
are upgraded one at a time; `npm audit fix --force` is not an accepted release
procedure. Browser/UI dependencies are kept local and reproducible; no runtime
network package resolution is required.

## Upstream transitive advisory

The current production audit reports two moderate findings through upstream
`smol-toml` 1.8.0 (including the ForgeLoop dependency path), with no fix
available in the audit response. The upstream owner is ForgeLoop; refresh the
immutable runtime pin when upstream ships a compatible remediation. The
high/critical production gate remains enforced. Do not silently override the
packed runtime dependency and break its tested source lineage.

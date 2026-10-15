# Vendored ForgeLoop runtime dependency

`cassiomc1-forgeloop-2.0.0-rc.4-d05c17c.tgz` is the packed ForgeLoop `2.0.0-rc.4` runtime used
by ForgeLoopAudit through the public `@cassiomc1/forgeloop/integration`
subpath.

- Source repository: `cassiomc1/forgeloop`
- Pinned commit: `d05c17cddda6a09581d526732b08eb0789b9734f`
- Package version: `2.0.0-rc.4`
- SHA-256: `10253b24d2e3404603d51e467222b5855dd0c6becda837de0d7d7e7646c8eae6`

The archive is the exact public npm ForgeLoop 2.0.0-rc.4 artifact, verified against the registry
SHA-512 integrity and pinned release commit above. Its
package-boundary verifier confirms the canonical `flutter` guide and the
complete installable-guide file closure without making ForgeLoopAudit a guide
registry owner.

ForgeLoop package metadata declares `license: PolyForm-Noncommercial-1.0.0`
and `publishConfig.access: public`. The archive includes ForgeLoop's `LICENSE`;
commercial use is not granted. Metadata does not prove registry publication.
The local archive keeps runtime resolution offline and immutable.
Node.js 24.19.0 or newer is required for native SQLite storage.

ForgeLoopAudit uses its Integration API v1 for canonical audit resources and
the explicit Repository Index/Search operations. Repository discovery results
remain engineering navigation data, never lifecycle evidence or authority.

Packaged ForgeLoopAudit builds do not depend on a sibling ForgeLoop checkout, a
floating branch, or network package resolution at runtime.

Verify the complete package, lockfile, archive and schema lineage with:

```bash
npm run verify:forgeloop-lineage
npm run protocol:schemas:verify
```

To update, download the exact public version with
`npm pack @cassiomc1/forgeloop@<version>`, verify its registry SHA-512 and `gitHead`,
replace the archive and update the SHA-256 above. Copy trusted schema bytes
from that artifact and regenerate `schemas/provenance.json` for its release
commit. A local source pack must not be presented as the published artifact.
Run both verification commands again before committing. The vendored archive
must remain controlled, local and immutable from ForgeLoopAudit's point of view.

# ForgeLoop protocol schemas

This directory vendors the ForgeLoop protocol-v1 JSON Schemas used by ForgeLoopAudit's Ajv trust boundary. The files are shipped with the local web package so runtime checks do not silently fall back to handwritten shape checks.

The schema filenames and protocol version are bound by `src/main/core/protocol/artifact-registry.ts`. Refresh these files only from the matching ForgeLoop protocol-v1 schema set and rerun the artifact validation fixtures.

`provenance.json` currently pins ForgeLoop `2.0.0-rc.4` at commit
`d05c17cddda6a09581d526732b08eb0789b9734f` and records protocol v1, the
upstream path and SHA-256 for every trusted schema. Trusted schemas include
workspace binding, canonical handoffs, responsibility, verification scope,
code manifests, in-toto statements, code-attestation predicates and
attestation verification results, canonical handoff acceptance and advisory
context capability metadata. Provenance generation recursively includes
safe local `$ref` dependencies, rejects remote or escaping references and
keeps the external Sigstore bundle outside the ForgeLoop schema boundary.
ForgeLoop 2.0.0-rc.4 keeps the trusted schema bytes at Schema v1; its multi-language
specialist is a routing capability, not a schema or Integration API revision.

Verify the committed trust boundary with:

```bash
npm run protocol:schemas:verify
```

Regenerate it only from a controlled ForgeLoop checkout using
`scripts/generate-schema-provenance.mjs`; do not treat project-controlled
`.forgeloop/schemas` content as trusted schema authority. See
[protocol compatibility](../docs/PROTOCOL_COMPATIBILITY.md) for how these
schemas relate to the Integration API.

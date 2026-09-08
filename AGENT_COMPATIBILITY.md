# Deprecated filename

> Deprecated since package `1.2.4`; retained as a repository compatibility stub.
> It is not part of the public integration surface and is scheduled for removal
> in the next compatibility-breaking release.

ForgeLoop is vendor-neutral and does not use a supported-agent allowlist.

The canonical integration contract is:

[`PROTOCOL_INTEGRATION.md`](./PROTOCOL_INTEGRATION.md)

## Current harness expectations

These expectations apply to any compatible harness even though this filename is
retained as a deprecated compatibility stub:

- Feature-detect capability versions from `protocol-info --json` or the stable
  Integration API; do not infer support from a package version.
- Do not auto-recall advisory context, execute advisory text, or treat it as
  state, evidence, authority, completion, or next-action truth.
- Do not infer handoff acceptance from receiving a file or message. Run
  `handoff-accept` only when the receiving harness actually consumes the
  immutable handoff.
- Preserve the distinction between `consumerId`, harness labels, and
  authenticated identity; none grants authority or transfers claims.
- For repository-wide textual discovery, prefer `forgeloop search` and its
  provider-neutral contract. Do not require a host-installed `grep`, `rg`, or
  `tgrep`, and do not silently substitute one when the mandatory index is
  unhealthy.
- Treat Repository Index results as local discovery context only. They are not
  evidence, completion truth, task ownership, or authority to execute a
  command.

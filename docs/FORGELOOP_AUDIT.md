# ForgeLoop Audit

ForgeLoop Audit runs only in **ForgeLoop Cloud**, the paid team dashboard at
<https://forgeloop.monster/dashboard/>. The local `ForgeLoopAudit/` workspace
that lived in this repository is retired; its source moved to the private
ForgeLoop Cloud project and is not published.

## What the cloud Audit shows

The dashboard reads, through the ForgeLoop Evidence GitHub App:

- committed evidence bundles in `.forgeloop-evidence/` on each repository's
  default branch ([`EVIDENCE_BUNDLES.md`](./EVIDENCE_BUNDLES.md));
- bundles uploaded with `forgeloop evidence-publish` before they are merged;
- the "ForgeLoop evidence" check runs of open pull requests.

From them it shows projects, tasks, a per-task audit (checks, success criteria,
phase timing, changed files, revision range, digests and signature status),
deterministic findings, process quality and pull-request evidence. Evidence is
self-reported by the CLI that exported it; signatures are verified in CI, not
by the dashboard.

Live local task state (claims, events, ledger, policy, handoffs) is not sent to
the cloud. Cloud-sync snapshots ([`CLOUD_SYNC.md`](./CLOUD_SYNC.md)) are
encrypted on the client, and the dashboard never reads them.

## Local alternatives

The protocol never depends on the Audit. Locally, use the read-only
projections:

- `forgeloop history`, `trace`, `reflect` and `inspect`
  ([`EXECUTION_TRACE.md`](./EXECUTION_TRACE.md));
- `forgeloop audit` and `forgeloop report` for a task receipt;
- the `task/audit-view` Integration API resource ([`AUDIT_UX.md`](./AUDIT_UX.md)),
  the bounded read model any audit or operator UI can consume.

## Plans

ForgeLoop Cloud, including the Audit, cloud sync and evidence publishing, is
part of the commercial plan. See <https://forgeloop.monster/#pricing>.

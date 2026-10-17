# Cloudflare security audit companion

ForgeLoop bundles Cloudflare's optional
[`security-audit`](../skills/security-audit/SKILL.md) skill for source-based
security questions, focused vulnerability reviews, and explicitly requested
codebase audits. It provides a repeatable investigation workflow alongside
the canonical [security guide](../ENG/sec-code-eng.md).

The companion is instruction content with local report validators. It adds no
runtime dependency, scanner service, automatic scan, or ForgeLoop completion
gate. ForgeLoopAudit inspects protocol evidence; this companion investigates
source-level security boundaries. These are separate capabilities.

## Availability and setup

The complete skill directory ships in the source repository and core npm
package at `skills/security-audit/`. It includes the domain references,
findings schema, both validators, their tests, the upstream MIT license, and
ForgeLoop's pin manifest. The upstream files are unchanged.

From a ForgeLoop checkout, verify the copy before using it:

```bash
node scripts/verify-security-audit-skill.mjs
```

In a project with a local npm installation, use:

```bash
node node_modules/@cassiomc1/forgeloop/scripts/verify-security-audit-skill.mjs
```

Ask an agent to read the companion's `SKILL.md` at that package or checkout
path and use its guidance for the requested scope. Hosts that require skill
discovery can instead copy the **entire** `skills/security-audit/` directory
into their supported project skill directory, such as
`.agents/skills/security-audit/`. Inspect an existing destination first;
preserve local modifications rather than overwriting them. Keep all companion
files together, including `LICENSE` and `PIN.json`. Verify a copied directory
with `verifySecurityAuditSkill({ rootDir: absoluteSkillDirectory })`, exported
by the same checker module.

ForgeLoop `init` and `update` do not install or synchronize this skill into a
host's discovery directories. Updating ForgeLoop also does not update a copied
host skill. No global installation or external Skills CLI is required.

## Choose the appropriate mode

| Request | Mode and result |
| --- | --- |
| Explain a security control or investigate one suspected issue | Guidance mode; read relevant references, without automatically creating audit files or running all phases |
| Audit a codebase, perform a comprehensive security review, or produce audit reports | Full audit mode; follow all six upstream phases, including independent verification and coverage accounting |
| Fix a confirmed issue | A separately scoped ForgeLoop implementation contract with regression checks; the audit itself does not modify target source |

Example agent request for a focused review:

> Read the bundled security-audit skill. Review the authorization boundary in
> src/auth in guidance mode. Return source-grounded observations and exact
> unresolved facts.

Example agent request for a full audit:

> Read the bundled security-audit skill. Audit this repository, follow all six
> phases, and report partial coverage and unavailable capabilities explicitly.

For a full audit, select scope, source revision, profile, and an external
output directory under the upstream rules. Use an in-target output directory
only when the user explicitly chooses it and version control ignores the
entire directory. Respect host write permissions. Audit artifacts belong to
the audit output directory, outside ForgeLoop-owned task state.

Full audit mode requires independent delegated hunters and verifiers. A
single agent's self-review cannot satisfy that independence. Target-controlled
execution additionally requires the upstream OS-enforced sandbox: network
isolation, sanitized environment, read-only target/toolchain, assigned scratch
writes, and explicit resource limits. A generic terminal sandbox or a
`run-check` receipt does not establish all these controls. If a required
capability is unavailable, retain the exact blocker and incomplete or
`needs_validation` status as required upstream; do not weaken the evidence
bar. No live endpoint probing, dependency fetching, publication, or paid
service use is authorized by loading this skill.

## Findings and ForgeLoop authority

Preserve upstream verdicts:

- `confirmed`: a source-grounded boundary failure with the required validation;
  severity describes the demonstrated impact.
- `needs_validation`: an exact source-grounded hypothesis with a missing fact;
  it has no severity.
- `rejected`: a candidate disproved by validation.

The six phases produce architecture and coverage records, findings, independent
record verification, and reports. Run both upstream validators against the
artifacts using the argument contracts documented in the skill. They validate
report structure and consistency; passing them does not prove that the target
is secure, that every attack surface was covered, or that a finding is true.

Findings remain advisory observations. They cannot satisfy ForgeLoop gates,
change claims, advance phases, or establish `COMPLETE` or `VALID`. The
[Security Review provider](./SECURITY_REVIEW.md) is a separate host-injected
observation API; this bundle does not register a provider or import reports
into it. Its normalized finding contract is not interchangeable with the
upstream report schema.

When a finding requires a fix, inspect it, bind it to a scoped contract, and
verify the behavior through canonical ForgeLoop checks. Use `run-check` for
exact-command provenance where execution is authorized. Never copy a report
directly into task state or relabel it as ForgeLoop-owned evidence. The
canonical runtime and validators retain all completion authority.

## Provenance and maintenance

- Source: [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill).
- Pinned commit: `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8`.
- Upstream directory: `skills/security-audit/`; `LICENSE` comes from the
  upstream repository root.
- License: [MIT, copyright Cloudflare, Inc.](../skills/security-audit/LICENSE),
  retained separately from ForgeLoop's license.
- [PIN.json](../skills/security-audit/PIN.json) records SHA-256 hashes of every
  upstream file, including the license. The checker rejects changed, missing,
  extra, or symlinked entries without executing the skill.
  The repository's `.gitattributes` preserves the entire companion tree as
  bytes, including CJS validators and the license, across CRLF checkout settings.

The hashes detect drift against the reviewed manifest; they are not a
signature or a sandbox. Updating the companion is an explicit maintenance
change: review the exact upstream revision and license, replace the complete
upstream tree, regenerate its file hashes, update the documented pin, run the
integrity checker and both upstream validator suites, and verify package
contents. Do not silently fetch a newer revision during normal operation.

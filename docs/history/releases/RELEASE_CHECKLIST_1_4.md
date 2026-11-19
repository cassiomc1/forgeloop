# ForgeLoop 1.4.0 release checklist

This checklist prepares the validated claim-recovery capability for release. It does not authorize publication, tagging, or deployment.

## Ownership and recovery gates

- [ ] Fake, deleted, corrupt, schema-invalid, and mismatched `recovery.json` cases resolve to `INCONSISTENT`.
- [ ] `INCONSISTENT` preserves historical claims, disables mutation, blocks overlapping acquisition, and is visible in list/show/status/audit/inspect/next.
- [ ] Only a fully matched recovery artifact and append-only recovery history releases claims.
- [ ] `task-recover` remains restricted to `STALE` and `ABANDONED`; `RECOVERABLE` keeps its canonical reconciliation path.
- [ ] `task-resume` validates ownership, settles only an unchanged stale task lock, and reacquires claims under the project claims lock.
- [ ] Project claim locks classify `NONE`, `LIVE`, `STALE`, `UNKNOWN`, and `CORRUPT`, with CAS-safe stale settlement.
- [ ] Manually forged COMPLETE state cannot release claims.
- [ ] Canonically completed task does release claims.
- [ ] Corrupt/missing completion lifecycle proof retains historical claims.
- [ ] Task locks with incomplete identity classify UNKNOWN.
- [ ] Single COMPLETE/RECOVERED task can be inspected implicitly by READ commands.
- [ ] Single COMPLETE/RECOVERED task cannot be selected implicitly for mutation.
- [ ] Ownership ledger validation is not redundantly repeated inside one immutable snapshot.
- [ ] Legacy recovery repair CAS-settles only unchanged stale task locks.
- [ ] Legacy recovery repair refuses UNKNOWN/CORRUPT task locks.
- [ ] alreadyRepaired requires a fully valid canonical recovery relationship.
- [ ] No exported claim helper releases claims from COMPLETE phase alone.
- [ ] Legacy recovery migration v1 accepts only CALLER_ACKNOWLEDGED authority.

## Compatibility and package gates

- [ ] `package.json` and `package-lock.json` agree on `1.4.0`.
- [ ] `protocol-info --json` advertises `features.taskClaimRecovery.validatedClaimProjection=true` and task-recovery schema v1.
- [ ] Documentation states that active task-recovery schema v1 requires a recovery-aware ForgeLoop reader (`>=1.4.0`).
- [ ] The packed package contains the recovery schema, claim-state core, recovery-history core, and this checklist.
- [ ] `npm test && npm run lint && npm run coverage && npm run docs:check && npm run pack:check && npm run pack:smoke && npm run dependency:policy` passes once on the release candidate.
- [ ] `git diff --check` and the repository ForgeLoop audit pass.

## Publication boundary

- [ ] A separately authorized release workflow verifies the final commit, `v1.4.0` tag, npm metadata, tarball digests, and GitHub release identity.
- [ ] No actor treats caller acknowledgement as `HOST_ATTESTED` authority.

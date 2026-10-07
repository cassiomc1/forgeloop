import { iterateEvents } from "./events.js";
import { assertActionTransition, assertActionAuthorizationDetails } from "./action-model.js";
import { E_ACTION_EVIDENCE_INVALID } from "./error-codes.js";

function hasModernAuthorizationEvidence(details) {
  if (!details || typeof details !== "object") return false;
  if (!["ALLOW", "REQUIRE_AUTHORITY", "REQUIRE_APPROVAL"].includes(details.capabilityDecision)) return false;
  if (typeof details.capabilityPolicyFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(details.capabilityPolicyFingerprint)) return false;
  if (typeof details.policyLockDigest !== "string" || !details.policyLockDigest.startsWith("sha256:")) return false;
  if (typeof details.taskPolicyDigest !== "string" || !details.taskPolicyDigest.startsWith("sha256:")) return false;
  if (details.capabilityDecision === "ALLOW") return true;
  if (details.authorityKind !== "HOST_ATTESTED" || typeof details.authorityRef !== "string" || !details.authorityRef) return false;
  if (details.capabilityDecision === "REQUIRE_AUTHORITY") return true;
  if (details.capabilityDecision === "REQUIRE_APPROVAL") {
    return typeof details.approvalId === "string" && !!details.approvalId
      && typeof details.approvalFingerprint === "string" && /^[a-f0-9]{64}$/.test(details.approvalFingerprint);
  }
  return false;
}

function hasCanonicalVerificationEvidence(details) {
  return Boolean(
    details
    && typeof details.evidenceRef === "string" && details.evidenceRef.length > 0 && details.evidenceRef.length <= 256
    && details.evidenceKind === "FORGELOOP_EXECUTION"
    && typeof details.verifiedAt === "string",
  );
}

async function readActionChronology(target, packageRoot, taskId, actionId) {
  const chronology = [];
  for await (const event of iterateEvents(target, packageRoot, { taskId })) {
    if (event.details?.actionId === actionId) chronology.push(event);
  }
  return chronology;
}

function issue(code, message) {
  return { code, message };
}

/**
 * Deterministic replay of one durable action's chronology from the canonical
 * task-scoped events.ndjson. Detects forged or incomplete history: illegal
 * transitions, revision skips, fingerprint drift, STARTED without trusted
 * authorization, unverifiable VERIFIED claims, out-of-order reconciliation,
 * and artifact/projection divergence (T-DURABLE-07).
 *
 * Compatibility: legacy pre-hardening ACTION_AUTHORIZED events remain
 * ledger-valid for historical readability but are never trusted
 * authorization evidence for new required-action completion.
 */
export async function projectActionLedger({
  target,
  packageRoot,
  taskId,
  actionId,
  artifact = null,
}) {
  const chronology = await readActionChronology(target, packageRoot, taskId, actionId);
  const errors = [];

  const proposed = chronology.find((event) => event.event === "ACTION_PROPOSED");
  if (!proposed) {
    return {
      actionId,
      valid: false,
      state: null,
      revision: null,
      actionFingerprint: artifact?.actionFingerprint ?? null,
      authorization: { valid: false, details: null },
      verification: { valid: false, evidenceRef: null },
      reconciliation: { count: 0, latestOutcome: null },
      errors: [issue(E_ACTION_EVIDENCE_INVALID, `action ${actionId} has no matching ACTION_PROPOSED ledger event`)],
    };
  }

  const actionFingerprint = proposed.details.actionFingerprint;
  let state = "PROPOSED";
  let revision = 0;
  let authorization = { valid: false, details: null };
  let verification = { valid: false, evidenceRef: null };
  const reconciliation = { count: 0, latestOutcome: null };
  // A trusted COMMITTED reconciliation emits two events for one logical
  // transition: ACTION_RECONCILED(outcome=COMMITTED) owns the transition and
  // ACTION_COMMIT_RECORDED(reconciled=true) is a same-revision informational
  // mirror. Replay must apply exactly one transition (INV-FINAL-REPLAY-01).
  let pendingReconciledCommitMirror = null;

  for (const event of chronology) {
    const details = event.details ?? {};

    if (details.actionFingerprint !== actionFingerprint) {
      errors.push(issue(E_ACTION_EVIDENCE_INVALID, `action ${actionId}: event ${event.event} carries a different action fingerprint`));
      continue;
    }
    const isReconciledMirror = event.event === "ACTION_COMMIT_RECORDED" && details.reconciled === true;
    if (
      Number.isInteger(details.revision)
      && details.revision !== revision + 1
      && event.event !== "ACTION_RECONCILED"
      && !isReconciledMirror
    ) {
      errors.push(issue(E_ACTION_EVIDENCE_INVALID, `action ${actionId}: ${event.event} skipped revision (expected ${revision + 1}, got ${details.revision})`));
    }

    switch (event.event) {
      case "ACTION_PROPOSED":
        break;
      case "ACTION_AUTHORIZED": {
        try {
          assertActionTransition(state, "AUTHORIZED");
        } catch {
          errors.push(issue(E_ACTION_EVIDENCE_INVALID, `action ${actionId}: illegal transition ${state} -> AUTHORIZED`));
          continue;
        }
        // Structural validation always applies; legacy events are readable
        // but never satisfy trusted authorization.
        const isModern = hasModernAuthorizationEvidence(details);
        try {
          assertActionAuthorizationDetails({ ...details }, { legacyAllowed: true });
        } catch (error) {
          errors.push(issue(error.code ?? E_ACTION_EVIDENCE_INVALID, `action ${actionId}: invalid ACTION_AUTHORIZED details: ${error.message}`));
          continue;
        }
        state = "AUTHORIZED";
        revision += 1;
        authorization = { valid: isModern, details: isModern ? details : null };
        break;
      }
      case "ACTION_STARTED": {
        try {
          assertActionTransition(state, "STARTED");
        } catch {
          errors.push(issue(E_ACTION_EVIDENCE_INVALID, `action ${actionId}: ACTION_STARTED without a legal predecessor state (${state})`));
          continue;
        }
        if (!authorization.valid) {
          errors.push(issue(E_ACTION_EVIDENCE_INVALID, `action ${actionId}: ACTION_STARTED occurred without valid modern authorization evidence`));
        }
        state = "STARTED";
        revision += 1;
        break;
      }
      case "ACTION_COMMIT_RECORDED": {
        // Reconciled commit mirrors corroborate a preceding trusted COMMITTED
        // reconciliation; they never transition state again.
        if (details.reconciled === true) {
          const mirror = pendingReconciledCommitMirror;
          if (
            !mirror
            || details.revision !== mirror.revision
            || details.actionFingerprint !== mirror.actionFingerprint
            || details.fromState !== mirror.fromState
            || details.toState !== mirror.toState
          ) {
            errors.push(issue(
              E_ACTION_EVIDENCE_INVALID,
              `action ${actionId}: reconciled commit mirror does not match the preceding COMMITTED reconciliation`,
            ));
            break;
          }
          pendingReconciledCommitMirror = null;
          break;
        }
        try {
          assertActionTransition(state, "COMMITTED");
        } catch {
          errors.push(issue(E_ACTION_EVIDENCE_INVALID, `action ${actionId}: illegal transition ${state} -> COMMITTED`));
          continue;
        }
        state = "COMMITTED";
        revision += 1;
        break;
      }
      case "ACTION_VERIFIED": {
        try {
          assertActionTransition(state, "VERIFIED");
        } catch {
          errors.push(issue(E_ACTION_EVIDENCE_INVALID, `action ${actionId}: illegal transition ${state} -> VERIFIED`));
          continue;
        }
        if (!hasCanonicalVerificationEvidence(details)) {
          errors.push(issue(E_ACTION_EVIDENCE_INVALID, `action ${actionId}: ACTION_VERIFIED lacks canonical evidence`));
          state = "VERIFIED";
          revision += 1;
          verification = { valid: false, evidenceRef: details.evidenceRef ?? null };
          continue;
        }
        state = "VERIFIED";
        revision += 1;
        verification = { valid: true, evidenceRef: details.evidenceRef };
        break;
      }
      case "ACTION_FAILED": {
        try {
          assertActionTransition(state, "FAILED");
        } catch {
          errors.push(issue(E_ACTION_EVIDENCE_INVALID, `action ${actionId}: illegal transition ${state} -> FAILED`));
          continue;
        }
        state = "FAILED";
        revision += 1;
        break;
      }
      case "ACTION_CANCELLED": {
        try {
          assertActionTransition(state, "CANCELLED");
        } catch {
          errors.push(issue(E_ACTION_EVIDENCE_INVALID, `action ${actionId}: illegal transition ${state} -> CANCELLED`));
          continue;
        }
        state = "CANCELLED";
        revision += 1;
        break;
      }
      case "ACTION_COMMIT_UNKNOWN": {
        try {
          assertActionTransition(state, "COMMIT_UNKNOWN");
        } catch {
          errors.push(issue(E_ACTION_EVIDENCE_INVALID, `action ${actionId}: illegal transition ${state} -> COMMIT_UNKNOWN`));
          continue;
        }
        state = "COMMIT_UNKNOWN";
        revision += 1;
        break;
      }
      case "ACTION_RECONCILED": {
        reconciliation.count += 1;
        reconciliation.latestOutcome = details.outcome ?? null;
        if (state !== "COMMIT_UNKNOWN") {
          errors.push(issue(E_ACTION_EVIDENCE_INVALID, `action ${actionId}: ACTION_RECONCILED recorded while state was ${state}, not COMMIT_UNKNOWN`));
          continue;
        }
        const outcome = details.outcome;
        if (outcome === "UNKNOWN") {
          revision += 1;
          continue;
        }
        const nextState = outcome === "COMMITTED" ? "COMMITTED" : outcome === "NOT_COMMITTED" ? "PROPOSED" : null;
        if (!nextState) {
          errors.push(issue(E_ACTION_EVIDENCE_INVALID, `action ${actionId}: unknown reconciliation outcome ${String(outcome)}`));
          continue;
        }
        try {
          assertActionTransition("COMMIT_UNKNOWN", nextState);
        } catch {
          errors.push(issue(E_ACTION_EVIDENCE_INVALID, `action ${actionId}: reconciliation outcome ${outcome} maps to an illegal transition`));
          continue;
        }
        if (
          typeof details.authorityKind !== "string"
          || details.authorityKind !== "HOST_ATTESTED"
          || typeof details.authorityRef !== "string"
        ) {
          errors.push(issue(E_ACTION_EVIDENCE_INVALID, `action ${actionId}: settling reconciliation lacks trusted authority binding`));
        }
        state = nextState;
        revision += 1;
        if (outcome === "COMMITTED") {
          pendingReconciledCommitMirror = {
            revision: details.revision,
            actionFingerprint,
            fromState: "COMMIT_UNKNOWN",
            toState: "COMMITTED",
          };
        }
        break;
      }
      default:
        break;
    }
  }

  if (artifact) {
    if (artifact.state !== state) {
      errors.push(issue(E_ACTION_EVIDENCE_INVALID, `action ${actionId}: artifact state ${artifact.state} differs from projected ledger state ${state}`));
    }
    if (artifact.revision !== revision) {
      errors.push(issue(E_ACTION_EVIDENCE_INVALID, `action ${actionId}: artifact revision ${artifact.revision} differs from projected revision ${revision}`));
    }
    if (artifact.actionFingerprint !== actionFingerprint) {
      errors.push(issue(E_ACTION_EVIDENCE_INVALID, `action ${actionId}: artifact fingerprint differs from the immutable proposal fingerprint`));
    }
    // The artifact's evidence pointer must match the canonical verification
    // event when both claim a verified postcondition.
    if (
      artifact.lastEvidenceRef !== undefined
      && artifact.lastEvidenceRef !== null
      && verification.valid
      && state === "VERIFIED"
      && artifact.lastEvidenceRef !== verification.evidenceRef
    ) {
      errors.push(issue(E_ACTION_EVIDENCE_INVALID, `action ${actionId}: artifact lastEvidenceRef does not match the ACTION_VERIFIED evidence reference`));
    }
  }

  return {
    actionId,
    valid: errors.length === 0,
    state,
    revision,
    actionFingerprint,
    authorization,
    verification,
    reconciliation,
    errors,
  };
}

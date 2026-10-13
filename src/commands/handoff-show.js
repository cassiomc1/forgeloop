import { withProjectReadSnapshot } from "../storage/project-read-snapshot.js";
import { readCanonicalHandoff } from "../core/handoff.js";
import {
  readHandoffAcceptanceLedger,
  resolveHandoffAcceptance,
} from "../core/handoff-acceptance.js";

export async function runHandoffShow(options = {}) {
  return withProjectReadSnapshot(options.target, () => projectHandoffShow(options));
}

async function projectHandoffShow({ target, packageRoot, taskId, handoffId } = {}) {
  const artifact = await readCanonicalHandoff(target, { packageRoot, taskId, handoffId });
  const ledger = await readHandoffAcceptanceLedger(target, packageRoot, { taskId });
  const resolved = resolveHandoffAcceptance({
    events: ledger.events,
    handoff: artifact.value,
    ledgerValid: ledger.valid,
    ledgerErrors: ledger.errors,
  });
  const acceptance = {
    status: resolved.status,
    consumerId: resolved.consumerId ?? null,
    harness: resolved.harness ?? null,
    acceptedAt: resolved.acceptedAt ?? null,
    ...(resolved.reasonCodes ? { reasonCodes: [...resolved.reasonCodes] } : {}),
  };
  return {
    taskId,
    path: artifact.path,
    fingerprint: artifact.fingerprint,
    handoff: artifact.value,
    acceptance,
  };
}

export function formatHandoffShowResult(result) {
  const acceptanceLine = result.acceptance ? `\nacceptance: ${result.acceptance.status}` : "";
  return `FORGELOOP HANDOFF: VALID\nid: ${result.handoff.handoffId}\ntask: ${result.handoff.taskId}\ndigest: ${result.handoff.artifactDigest}\npath: ${result.path}${acceptanceLine}\n\n`;
}

import { withProjectReadSnapshot } from "../storage/project-read-snapshot.js";
import { listCanonicalHandoffs } from "../core/handoff.js";
import {
  readHandoffAcceptanceLedger,
  resolveHandoffAcceptance,
} from "../core/handoff-acceptance.js";

export async function runHandoffList(options = {}) {
  return withProjectReadSnapshot(options.target, () => projectHandoffList(options));
}

async function projectHandoffList({ target, packageRoot, taskId } = {}) {
  const handoffs = await listCanonicalHandoffs(target, { packageRoot, taskId });
  const ledger = await readHandoffAcceptanceLedger(target, packageRoot, { taskId });
  const handoffsWithAcceptance = handoffs.map((handoff) => {
    const resolved = resolveHandoffAcceptance({
      events: ledger.events,
      handoff,
      ledgerValid: ledger.valid,
      ledgerErrors: ledger.errors,
    });
    return {
      ...handoff,
      acceptance: {
        status: resolved.status,
        consumerId: resolved.consumerId ?? null,
        harness: resolved.harness ?? null,
        acceptedAt: resolved.acceptedAt ?? null,
        ...(resolved.reasonCodes ? { reasonCodes: [...resolved.reasonCodes] } : {}),
      },
    };
  });
  return { taskId, count: handoffs.length, handoffs: handoffsWithAcceptance };
}

export function formatHandoffListResult(result) {
  const lines = [`FORGELOOP HANDOFFS: ${result.count}`];
  for (const handoff of result.handoffs) {
    const status = handoff.acceptance?.status ? ` [${handoff.acceptance.status}]` : "";
    lines.push(`${handoff.handoffId} ${handoff.createdAt} ${handoff.artifactDigest}${status}`);
  }
  return `${lines.join("\n")}\n`;
}

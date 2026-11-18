import { publishEvidence } from "../core/evidence/publish.js";

export async function runEvidencePublish({ target, taskId, all, evidenceDirectory, remote, repository, env, fetchImpl } = {}) {
  return publishEvidence({
    target,
    taskIds: taskId ? [taskId] : [],
    all: all === true,
    ...(evidenceDirectory ? { directory: evidenceDirectory } : {}),
    remote,
    repository,
    ...(env ? { env } : {}),
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}

export function formatEvidencePublishResult(result) {
  const lines = [`FORGELOOP EVIDENCE PUBLISH: ${result.status}`, `REMOTE: ${result.remote}`, `REPOSITORY: ${result.repository}`];
  for (const item of result.results) lines.push(`${item.status} ${item.taskId}${item.message ? ` (${item.message})` : ""}`);
  if (result.queued > 0) lines.push(`QUEUED: ${result.queued} bundle(s) stay queued; run forgeloop evidence-publish again to retry.`);
  lines.push("");
  return lines.join("\n");
}

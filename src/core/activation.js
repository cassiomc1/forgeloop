import { randomUUID } from "node:crypto";

import { ARTIFACT_PATHS, writeJsonArtifact } from "./artifacts.js";
import { PROTOCOL_VERSION } from "./protocol.js";
import { sessionArtifactPath } from "./task-paths.js";
import { getOperationalStore } from "../storage/operational-context.js";
import { withTaskTransaction } from "./transaction.js";

export async function activateSession(target, packageRoot, options = {}) {
  if (!getOperationalStore(target)) {
    const { withProjectStorage } = await import("../storage/project-boundary.js");
    return withProjectStorage(target, () => activateSession(target, packageRoot, options));
  }
  const sessionId = options.sessionId ?? randomUUID();
  const value = {
    schemaVersion: 1,
    protocolVersion: PROTOCOL_VERSION,
    sessionId,
    activationMarker: options.activationMarker ?? `forgeloop-${randomUUID()}`,
    createdAt: options.createdAt ?? new Date().toISOString(),
  };
  const relativePath = sessionArtifactPath(sessionId);
  return withTaskTransaction({ target, taskId: sessionId, operation: "activate-session", packageRoot }, async () => {
    const written = await writeJsonArtifact(target, relativePath, value, "activation", packageRoot);
    await writeJsonArtifact(target, ARTIFACT_PATHS.session, value, "activation", packageRoot);
    return { ...written.value, path: relativePath };
  });
}

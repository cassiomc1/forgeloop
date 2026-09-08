import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { getPersistentTransportRoot } from "./constants.js";

function scopeHash(homeDirectory) {
  return createHash("sha256").update(String(homeDirectory)).digest("hex").slice(0, 20);
}

export function getPersistentTransportScopeId({ homeDirectory = os.homedir() } = {}) {
  return `user-${scopeHash(homeDirectory)}`;
}

export function getPersistentTransportPaths({ homeDirectory = os.homedir(), platform = process.platform } = {}) {
  const root = getPersistentTransportRoot({ homeDirectory });
  const scopeId = getPersistentTransportScopeId({ homeDirectory });
  return {
    root,
    scopeId,
    statePath: path.join(root, "state.json"),
    lockPath: path.join(root, "startup.lock"),
    endpoint: platform === "win32"
      ? `\\\\.\\pipe\\forgeloop-persistent-search-${scopeHash(homeDirectory)}`
      // macOS limits Unix-domain socket paths to a small fixed length. Keep
      // the user-scoped endpoint in the local temporary namespace while the
      // authoritative ownership state remains under the user's ForgeLoop
      // directory.
      : path.join(os.tmpdir(), `forgeloop-persistent-search-${scopeHash(homeDirectory)}.sock`),
  };
}

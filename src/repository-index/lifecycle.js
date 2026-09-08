import { lstat } from "node:fs/promises";
import path from "node:path";

/**
 * Repository-index provisioning is only automatic for an actual repository.
 * Keeping the candidate test narrow avoids turning ForgeLoop's fixture and
 * protocol-only targets into implicit native-tool installations.
 */
export async function isRepositoryCandidate(repositoryRoot) {
  try {
    const info = await lstat(path.join(repositoryRoot, ".git"));
    return info.isDirectory() || info.isFile();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

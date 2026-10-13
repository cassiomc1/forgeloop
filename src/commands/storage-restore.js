import path from "node:path";
import { restoreProjectStorageToFreshProject } from "../storage/project-restore.js";
import { replaceActiveProjectStorage } from "../storage/project-replacement.js";

export async function runStorageRestore({ target, source, writersQuiesced = false, replaceActive = false, packageRoot } = {}) {
  const restore = replaceActive === true ? replaceActiveProjectStorage : restoreProjectStorageToFreshProject;
  return restore(path.resolve(target, source), target, { writersQuiesced, packageRoot });
}

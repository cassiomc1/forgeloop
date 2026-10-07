import { resumeProjectStorageRestore } from "../storage/project-restore.js";
import { resumeActiveProjectReplacement } from "../storage/project-replacement.js";

export async function runStorageRestoreResume({ target, operationId, expectedOwnerId, writersQuiesced = false, replaceActive = false, packageRoot } = {}) {
  const resume = replaceActive === true ? resumeActiveProjectReplacement : resumeProjectStorageRestore;
  return resume(target, { operationId, expectedOwnerId, writersQuiesced, packageRoot });
}

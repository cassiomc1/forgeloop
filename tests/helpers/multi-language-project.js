import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function temporaryProject(prefix, callback) {
  const target = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await callback(target);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
}

export async function writeFiles(target, files) {
  for (const [relativePath, text] of Object.entries(files)) {
    const filePath = path.join(target, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, text, "utf8");
  }
}

export function frameworkEvidence(evidence, framework) {
  return evidence.frameworks.includes(framework);
}

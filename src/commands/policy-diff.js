import { readFile } from "node:fs/promises";
import path from "node:path";
import { isOperationalArtifactPath, needsExistingProjectScope, withExistingProjectScope } from "../storage/existing-project-scope.js";
import { getOperationalStore, readOperationalText } from "../storage/operational-context.js";
import { diffPolicies } from "../core/policy-diff.js";
import {
  loadEffectiveRules,
  readBaseline,
  readTaskPolicySnapshot,
} from "../core/policy-engine.js";

function canonicalInputPath(target, file) {
  return path.relative(target, path.resolve(target, file)).replaceAll("\\", "/");
}

async function readPolicyInput(target, file) {
  const relative = canonicalInputPath(target, file);
  const native = readOperationalText(target, relative);
  if (native.selected) {
    if (native.text === null) throw Object.assign(new Error(`Policy input does not exist: ${relative}`), { code: "ENOENT" });
    return JSON.parse(native.text);
  }
  if (getOperationalStore(target) && isOperationalArtifactPath(relative)) {
    throw Object.assign(new Error(`Unsupported canonical policy input: ${relative}`), { code: "E_STORAGE_OPERATION_UNSUPPORTED" });
  }
  return JSON.parse(await readFile(path.resolve(target, file), "utf8"));
}

export async function runPolicyDiff({
  target = process.cwd(),
  packageRoot,
  taskId = null,
  before = null,
  after = null,
} = {}) {
  if ([before, after].some(file => file && isOperationalArtifactPath(canonicalInputPath(target, file)))
    && await needsExistingProjectScope(target)) {
    return withExistingProjectScope(target, () => runPolicyDiff({ target, packageRoot, taskId, before, after }), { readOnly: true });
  }
  let beforePolicy;
  let afterPolicy;

  if (before) {
    beforePolicy = await readPolicyInput(target, before);
  } else if (taskId) {
    const snapshot = await readTaskPolicySnapshot(target, taskId, packageRoot);
    beforePolicy = snapshot ? { rules: snapshot.rules, baseline: { entries: [] } } : { rules: [], baseline: { entries: [] } };
  } else {
    beforePolicy = { rules: [], baseline: { entries: [] } };
  }

  if (after) {
    afterPolicy = await readPolicyInput(target, after);
  } else {
    const rules = await loadEffectiveRules(target, packageRoot);
    const baseline = await readBaseline(target, packageRoot);
    afterPolicy = { rules, baseline };
  }

  return diffPolicies(beforePolicy, afterPolicy);
}

export function formatPolicyDiffResult(result) {
  const lines = [
    `FORGELOOP POLICY DIFF: ${result.classification}`,
    `Changes: ${result.changes?.length ?? 0}`,
  ];
  for (const c of result.changes ?? []) {
    lines.push(`  - [${c.type}] ${c.path}: ${c.description}`);
  }
  return `${lines.join("\n")}\n`;
}

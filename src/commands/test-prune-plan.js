import { buildPrunePlan } from "../core/test-intelligence/prune.js";

export async function runTestPrunePlan({ target, packageRoot, taskId } = {}) { return buildPrunePlan({ target, packageRoot, taskId }); }
export function formatTestPrunePlanResult(result) { return `${JSON.stringify(result, null, 2)}\n`; }


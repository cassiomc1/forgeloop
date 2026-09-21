import { runTestUtility as analyze } from "../core/test-intelligence/service.js";

export async function runTestUtility({ target, packageRoot, taskId, semanticStatus } = {}) { return analyze({ target, packageRoot, taskId, semanticStatus }); }
export function formatTestUtilityResult(result) { return `${JSON.stringify(result, null, 2)}\n`; }


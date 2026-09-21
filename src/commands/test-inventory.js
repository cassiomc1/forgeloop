import { runTestInventory as inventory } from "../core/test-intelligence/service.js";

export async function runTestInventory({ target = process.cwd() } = {}) { return inventory({ projectRoot: target }); }
export function formatTestInventoryResult(result) { return `${JSON.stringify(result, null, 2)}\n`; }


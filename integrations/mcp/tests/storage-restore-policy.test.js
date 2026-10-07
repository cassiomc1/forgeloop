import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildToolRegistrations, commandToToolName } from "../src/tool-registry.js";
import { resolveLaunchPolicy, SERVER_MODES } from "../src/capability-policy.js";

test("restore commands require full MCP maintenance exposure and preserve canonical input gates", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-mcp-restore-policy-"));
  try {
    const commands = ["storage-restore", "storage-restore-resume"];
    for (const mode of [SERVER_MODES.READONLY, SERVER_MODES.SAFE, SERVER_MODES.FULL]) {
      const registrations = buildToolRegistrations({ projectRoot: target, policy: resolveLaunchPolicy({ mode }) });
      for (const command of commands) assert.equal(registrations.some(tool => tool.name === commandToToolName(command)), false);
    }
    const registrations = buildToolRegistrations({ projectRoot: target, policy: resolveLaunchPolicy({ mode: SERVER_MODES.FULL, allowMaintenance: true }) });
    for (const command of commands) {
      const tool = registrations.find(value => value.name === commandToToolName(command));
      assert.ok(tool);
      const result = await tool.handler({ source: "absent-backup", operationId: "not-a-uuid", expectedOwnerId: "not-a-uuid",
        authorityContext: { trustMode: "HOST_ATTESTED", hostSupplied: true } });
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result), /E_CLI_INVOCATION_INVALID/);
    }
    await assert.rejects(stat(path.join(target, ".forgeloop")), { code: "ENOENT" });
  } finally { await rm(target, { recursive: true, force: true }); }
});

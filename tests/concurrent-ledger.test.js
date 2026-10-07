import { ensureFixtureTask } from "./helpers/native-storage-fixture.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { appendProtocolEvent, readEvents } from "../src/core/events.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();

test("concurrent event writers serialize a shared ledger without duplicate sequence numbers", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-concurrent-ledger-"));
  try {
    await ensureFixtureTask(target, "concurrent-task", packageRoot);
    await Promise.all([
      appendProtocolEvent(target, { taskId: "concurrent-task", event: "OBSERVATION_A" }, packageRoot, { taskId: "concurrent-task" }),
      appendProtocolEvent(target, { taskId: "concurrent-task", event: "OBSERVATION_B" }, packageRoot, { taskId: "concurrent-task" }),
    ]);
    const events = await readEvents(target, packageRoot, { taskId: "concurrent-task" });
    assert.deepEqual(events.map((event) => event.seq), [1, 2]);
    assert.equal(new Set(events.map((event) => event.seq)).size, 2);
    assert.deepEqual(events.map(event => event.event).sort(), ["OBSERVATION_A", "OBSERVATION_B"]);
    assert.equal(events[0].previousHash, null);
    assert.equal(events[1].previousHash, events[0].hash);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

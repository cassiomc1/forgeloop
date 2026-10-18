import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyRevenueDesignSkill } from "../scripts/verify-revenue-design-skill.mjs";

const source = new URL("../skills/forgeloop/references/revenue-centric-design/", import.meta.url);
for (const mutation of ["license", "extra-file"]) test(`design companion refuses ${mutation} drift`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-design-pin-"));
  try {
    await cp(source, root, { recursive: true });
    assert.equal((await verifyRevenueDesignSkill({ rootDir: root })).valid, true);
    await writeFile(path.join(root, mutation === "license" ? "LICENSE" : "updater.py"), "unexpected content\n");
    await assert.rejects(verifyRevenueDesignSkill({ rootDir: root }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

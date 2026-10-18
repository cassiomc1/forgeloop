import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { verifySecurityAuditSkill } from "../scripts/verify-security-audit-skill.mjs";

const source = path.resolve("skills/security-audit");

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "security-audit-pin-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const rootDir = path.join(directory, "skill");
  await cp(source, rootDir, { recursive: true });
  return rootDir;
}

test("bundled Cloudflare skill matches its complete pinned upstream tree", async () => {
  const result = await verifySecurityAuditSkill();
  assert.equal(result.valid, true);
  assert.match(result.commit, /^[a-f0-9]{40}$/u);
  assert.ok(result.filesChecked >= 20);
  assert.match(await readFile(path.join(source, "LICENSE"), "utf8"), /MIT License/u);
});

test("integrity rejects changed bytes, missing files and extra files", async (t) => {
  for (const kind of ["changed", "missing", "extra"]) {
    await t.test(kind, async (t) => {
      const rootDir = await fixture(t);
      if (kind === "changed") await writeFile(path.join(rootDir, "SKILL.md"), "changed");
      if (kind === "missing") await rm(path.join(rootDir, "SKILL.md"));
      if (kind === "extra") await writeFile(path.join(rootDir, "injected.cjs"), "throw Error('must never execute')");
      await assert.rejects(verifySecurityAuditSkill({ rootDir }), /integrity|mismatch|missing|unexpected/iu);
    });
  }
});

test("integrity rejects symlinked content before reading it", async (t) => {
  const rootDir = await fixture(t);
  const outside = path.join(path.dirname(rootDir), "outside.md");
  await writeFile(outside, "untrusted");
  await rm(path.join(rootDir, "SKILL.md"));
  try {
    await symlink(outside, path.join(rootDir, "SKILL.md"));
  } catch (error) {
    if (process.platform === "win32" && ["EPERM", "EACCES"].includes(error.code)) {
      t.skip("Creating file symlinks requires Windows privileges unavailable on this host.");
      return;
    }
    throw error;
  }
  await assert.rejects(verifySecurityAuditSkill({ rootDir }), /regular file|symlink/iu);
});

test("integrity rejects traversal and malformed pins", async (t) => {
  for (const kind of ["traversal", "commit", "source", "digest"]) {
    await t.test(kind, async (t) => {
      const rootDir = await fixture(t);
      const pinPath = path.join(rootDir, "PIN.json");
      const pin = JSON.parse(await readFile(pinPath, "utf8"));
      if (kind === "traversal") pin.files["../outside.md"] = "a".repeat(64);
      if (kind === "commit") pin.commit = "main";
      if (kind === "source") pin.repository = "https://example.com/untrusted";
      if (kind === "digest") pin.files["SKILL.md"] = "invalid";
      await writeFile(pinPath, JSON.stringify(pin));
      await assert.rejects(verifySecurityAuditSkill({ rootDir }), /invalid|unsafe/iu);
    });
  }
});

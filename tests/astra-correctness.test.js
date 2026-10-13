import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { withTaskTransaction, findIncompleteTransactions } from "../src/core/transaction.js";
import { writeJsonArtifact } from "../src/core/artifacts.js";
import { getPackageRoot } from "../src/core/templates.js";
import { resolveExecutionProfile } from "../src/core/execution-profile.js";
import { runDoctor } from "../src/commands/doctor.js";

test("same task ID cannot join a transaction in a different project, including artifact writes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-project-boundary-"));
  const a = path.join(root, "a"), b = path.join(root, "b");
  try {
    await mkdir(a); await mkdir(b);
    await withTaskTransaction({ target: a, taskId: "same-id" }, async () => {
      await assert.rejects(withTaskTransaction({ target: b, taskId: "same-id" }, async (tx) => {
        await tx.stageText("wrong.txt", "must not be written");
      }), /different project/);
      await assert.rejects(writeJsonArtifact(b, "config.json", { schemaVersion: 1, protocolVersion: 1, complianceMode: "standard" }, "config", getPackageRoot(), { taskId: "same-id" }), /different project/);
    });
    for (const target of [a, b]) await assert.rejects(readFile(path.join(target, "wrong.txt")), { code: "ENOENT" });
  } finally { await removeTempTree(root); }
});

test("nested aliases of the same physical project retain transaction identity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-project-alias-"));
  try {
    const target = path.join(root, "project"), alias = path.join(root, "alias");
    await mkdir(target); await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
    await withTaskTransaction({ target, taskId: "same-id" }, async (outer) => {
      await withTaskTransaction({ target: alias, taskId: "same-id" }, async (inner) => assert.equal(inner, outer));
    });
    await mkdir(path.join(target, ".forgeloop"), { recursive: true });
    const database = path.join(target, ".forgeloop/state.sqlite");
    await writeFile(database, "retained canonical storage");
    await assert.rejects(withTaskTransaction({ target: alias, taskId: "same-id" }, () => assert.fail("A new operation must not bypass root symlink refusal")), /must not be a symlink/);
    assert.equal(await readFile(database, "utf8"), "retained canonical storage");
  } finally { await removeTempTree(root); }
});

test("doctor keeps incomplete legacy transaction evidence visible and unchanged", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-recovered-health-"));
  try {
    const root = path.join(target, ".forgeloop/.txn/probe");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "manifest.json"), JSON.stringify({ transactionId: "probe", status: "COMMITTING", writes: [] }));
    const before = await readFile(path.join(root, "manifest.json"), "utf8");
    assert.equal((await findIncompleteTransactions(target))[0].status, "COMMITTING");
    const doctor = await runDoctor({ target, packageRoot: getPackageRoot(), fix: true });
    assert.equal(doctor.findings.some((f) => f.code === "E_TRANSACTION_INCOMPLETE"), true);
    assert.equal(await readFile(path.join(root, "manifest.json"), "utf8"), before);
  } finally { await removeTempTree(target); }
});

test("profile obligations normalize structured and nested requirements without scanning exclusions", () => {
  const profile = (contract, risks = []) => resolveExecutionProfile({ routeInput: { workType: "documentation", risks }, contract });
  const publication = { id: "publish", text: "Publish documentation", type: "PUBLICATION" };
  for (const value of ["Publish documentation", publication, { text: "All outcomes", operator: "ALL", requirements: [publication] }]) {
    assert.equal(profile({ successCriteria: [value] }).floor, "full");
  }
  assert.equal(profile({ constraints: ["No publication, secrets or production migration"], stopConditions: ["Stop if publication is required"] }).floor, "light");
  assert.equal(profile({ constraints: ["No publication"] }, ["publication"]).floor, "full");
  assert.equal(profile({ successCriteria: [{ text: "Released artifact", type: "PUBLICATION" }] }).floor, "full");
});

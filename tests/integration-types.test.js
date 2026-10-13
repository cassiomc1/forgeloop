import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import * as integration from "../src/integration.js";
import { runNpm } from "../scripts/npm-command.mjs";
import { removeTempTree } from "./helpers/rm-safe.js";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

test("published integration declarations match runtime values and compile for a packed consumer", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeloop-types-"));
  t.after(() => removeTempTree(root));
  const packed = JSON.parse(runNpm(["pack", "--json", "--pack-destination", root], { cwd: repositoryRoot, encoding: "utf8" }))[0];
  const packageDirectory = path.join(root, "node_modules/@cassiomc1/forgeloop");
  await mkdir(packageDirectory, { recursive: true });
  execFileSync("tar", ["-xzf", packed.filename, "--strip-components=1", "-C", path.relative(root, packageDirectory).replaceAll("\\", "/")], { cwd: root });
  const declaration = await readFile(path.join(packageDirectory, "src/integration.d.ts"), "utf8");
  const declaredValues = [...declaration.matchAll(/^export declare (?:const|function|class) (\w+)/gmu)].map(match => match[1]);
  assert.deepEqual([...new Set(declaredValues)].sort(), Object.keys(integration).sort());
  await writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(path.join(root, "consumer.ts"), `
import { ${Object.keys(integration).join(", ")} } from "@cassiomc1/forgeloop/integration";
import type { ForgeLoopAuditUxCategory, ForgeLoopAuditUxResult, ForgeLoopSecurityReviewResult, ForgeLoopStructuralQualityProvider } from "@cassiomc1/forgeloop/integration";
const provider: ForgeLoopStructuralQualityProvider = { id: "custom", observe: async input => ({ taskId: input.taskId }) };
const registry = createStructuralQualityProviderRegistry({ providers: { custom: provider } });
void registry.resolve("custom", { projectPath: ".", taskId: "example", timeoutMs: 1000, maxOutputBytes: 4096 });
declare const securityReview: ForgeLoopSecurityReviewResult;
const securityFindingPath: string | undefined = securityReview.findings[0]?.path;
const securityTrust = [
  securityReview.authority,
  securityReview.evidenceAuthority,
  securityReview.actionability,
  securityReview.trustRole,
  securityReview.persisted,
  securityReview.lifecycleAuthority,
  securityReview.completionAuthority,
  securityReview.evidenceRequiresForgeLoopValidation,
];
void securityFindingPath;
void securityTrust;
declare const auditView: ForgeLoopAuditUxResult;
const auditCategory: ForgeLoopAuditUxCategory = "LIFECYCLE";
const auditProjection = [
  auditView.authority.readOnly,
  auditView.lifecycle.nextAction,
  auditView.timeline.items[0]?.sequence,
  auditView.timeline.cursor.nextAfterSequence,
  auditView.ownership.claimState,
  auditView.completion.valid,
];
void auditCategory;
void auditProjection;
void readForgeLoopIntegrationResource("task/audit-view", {
  taskId: "example",
  limit: 10,
  categories: [auditCategory],
}).then(result => result.data.integrity.valid);
// @ts-expect-error a provider must expose an observation implementation
const invalid: ForgeLoopStructuralQualityProvider = { id: "invalid" };
void invalid;
// @ts-expect-error task identity must be a string
void resolveStructuralQualityProvider({ target: ".", taskId: 42 });
`);
  execFileSync(process.execPath, [path.join(repositoryRoot, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--module", "NodeNext", "--target", "ES2022", "consumer.ts"], { cwd: root, stdio: "pipe" });
});

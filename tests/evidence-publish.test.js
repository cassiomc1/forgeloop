import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { runEvidencePublish } from "../src/commands/evidence-publish.js";
import { readPublishQueue } from "../src/core/evidence/publish.js";
import { CLI_COMMAND_DEFINITIONS } from "../src/core/cli-command-definitions.js";
import { classifyForgeLoopInvocation } from "../src/core/integration-invocation-policy.js";
import { writeFile } from "node:fs/promises";
import { removeTempTree } from "./helpers/rm-safe.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src/cli.js");
const TASK = "evidence-auto-sign";
const BEARER = "t".repeat(48);

async function fixture() {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-publish-"));
  await mkdir(path.join(target, ".forgeloop-evidence"));
  await copyFile(path.join(root, ".forgeloop-evidence", `${TASK}.json`), path.join(target, ".forgeloop-evidence", `${TASK}.json`));
  const env = { FORGELOOP_SYNC_TOKEN: BEARER, FORGELOOP_EVIDENCE_QUEUE_DIR: path.join(target, "queue") };
  return { target, env };
}

function fakeRemote(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return handler(calls.length, url, init);
  };
  return { calls, fetchImpl };
}

const publish = (context, options = {}) => runEvidencePublish({ target: context.target, repository: "acme/app", env: context.env, ...options });

test("a requested bundle is published once and republishing reports it unchanged", async () => {
  const context = await fixture();
  try {
    const seen = new Set();
    const remote = fakeRemote((_n, url, init) => {
      assert.equal(new URL(url).searchParams.get("repo"), "acme/app");
      assert.equal(init.headers.authorization, `Bearer ${BEARER}`);
      const digest = JSON.parse(init.body).digest;
      const status = seen.has(digest) ? "unchanged" : "published";
      seen.add(digest);
      return globalThis.Response.json({ ok: true, status });
    });
    const first = await publish(context, { taskId: TASK, fetchImpl: remote.fetchImpl });
    assert.equal(first.status, "PUBLISHED");
    assert.deepEqual(first.results.map((item) => item.status), ["PUBLISHED"]);
    assert.equal(remote.calls[0].url, "https://forgeloop.monster/api/evidence?repo=acme%2Fapp");
    const again = await publish(context, { all: true, fetchImpl: remote.fetchImpl });
    assert.deepEqual(again.results.map((item) => item.status), ["UNCHANGED"]);
    assert.deepEqual(await readPublishQueue(context.target, { env: context.env }), []);
  } finally { await removeTempTree(context.target); }
});

test("an unreachable remote keeps the bundle queued and a later run publishes it", async () => {
  const context = await fixture();
  try {
    const offline = fakeRemote(() => { throw new Error("getaddrinfo ENOTFOUND"); });
    const queued = await publish(context, { taskId: TASK, fetchImpl: offline.fetchImpl });
    assert.equal(queued.status, "QUEUED");
    assert.equal(queued.queued, 1);
    assert.deepEqual((await readPublishQueue(context.target, { env: context.env })).map((item) => item.taskId), [TASK]);
    const online = fakeRemote(() => globalThis.Response.json({ ok: true, status: "published" }));
    const flushed = await publish(context, { fetchImpl: online.fetchImpl });
    assert.equal(flushed.status, "PUBLISHED");
    assert.equal(flushed.queued, 0);
  } finally { await removeTempTree(context.target); }
});

test("a refused token stops publishing and keeps the queue; a rejected bundle is dropped", async () => {
  const context = await fixture();
  try {
    const refused = fakeRemote(() => globalThis.Response.json({ error: "This token is not allowed for the repository" }, { status: 403 }));
    await assert.rejects(publish(context, { taskId: TASK, fetchImpl: refused.fetchImpl }), (error) => error.code === "E_EVIDENCE_PUBLISH_UNAUTHORIZED" && error.queued === 1);
    assert.equal((await readPublishQueue(context.target, { env: context.env })).length, 1);
    const rejected = fakeRemote(() => globalThis.Response.json({ error: "Evidence bundle digest does not match its content" }, { status: 400 }));
    const result = await publish(context, { fetchImpl: rejected.fetchImpl });
    assert.equal(result.status, "INCOMPLETE");
    assert.equal(result.results[0].status, "REJECTED");
    assert.equal(result.queued, 0);
  } finally { await removeTempTree(context.target); }
});

test("publishing requires a token, something to publish, an https remote and a safe task ID", async () => {
  const context = await fixture();
  try {
    const never = fakeRemote(() => { throw new Error("must not be called"); });
    const config = (error) => error.code === "E_EVIDENCE_PUBLISH_CONFIG";
    await assert.rejects(publish({ ...context, env: { FORGELOOP_EVIDENCE_QUEUE_DIR: context.env.FORGELOOP_EVIDENCE_QUEUE_DIR } }, { taskId: TASK, fetchImpl: never.fetchImpl }), config);
    await assert.rejects(publish(context, { fetchImpl: never.fetchImpl }), config);
    await assert.rejects(publish(context, { taskId: TASK, remote: "http://example.com/api/evidence", fetchImpl: never.fetchImpl }), config);
    await assert.rejects(publish(context, { taskId: "../escape", fetchImpl: never.fetchImpl }), (error) => error.code === "E_EVIDENCE_BUNDLE_INVALID");
    assert.equal(never.calls.length, 0);
  } finally { await removeTempTree(context.target); }
});

test("the CLI publishes to a local remote and exits 1 while a bundle stays queued", async () => {
  const context = await fixture();
  const bodies = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      bodies.push(JSON.parse(body).taskId);
      response.writeHead(bodies.length === 1 ? 503 : 200, { "content-type": "application/json" });
      response.end(JSON.stringify(bodies.length === 1 ? { error: "unavailable" } : { ok: true, status: "published" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const remote = `http://127.0.0.1:${server.address().port}/api/evidence`;
  const run = (...args) => new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, "evidence-publish", "--path", context.target, "--repo", "acme/app", "--remote", remote, "--json", ...args], { env: { ...process.env, ...context.env } });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("close", (code) => resolve({ code, result: JSON.parse(stdout) }));
  });
  try {
    const first = await run("--task", TASK);
    assert.equal(first.code, 1);
    assert.equal(first.result.status, "QUEUED");
    const second = await run();
    assert.equal(second.code, 0);
    assert.equal(second.result.status, "PUBLISHED");
    assert.deepEqual(bodies, [TASK, TASK]);
    const queue = JSON.parse(await readFile(path.join(context.env.FORGELOOP_EVIDENCE_QUEUE_DIR, (await import("node:fs")).readdirSync(context.env.FORGELOOP_EVIDENCE_QUEUE_DIR).find((name) => name.endsWith(".json"))), "utf8"));
    assert.deepEqual(queue.items, []);
  } finally {
    server.close();
    await removeTempTree(context.target);
  }
});

test("evidence-publish is a mutating maintenance command for integrations", () => {
  assert.equal(CLI_COMMAND_DEFINITIONS["evidence-publish"].mutation, "MUTATING");
  assert.equal(classifyForgeLoopInvocation("evidence-publish", {}).riskClass, "MAINTENANCE");
});

test("queued bundles stay bound to their remote and --all skips unsafe file names", async () => {
  const context = await fixture();
  try {
    await writeFile(path.join(context.target, ".forgeloop-evidence", ".hidden.json"), "{}\n");
    const offline = fakeRemote(() => { throw new Error("offline"); });
    const queued = await publish(context, { all: true, fetchImpl: offline.fetchImpl });
    assert.deepEqual(queued.skipped, [".hidden.json"]);
    assert.deepEqual(queued.results.map((item) => item.taskId), [TASK]);
    const other = fakeRemote((_n, url) => { assert.match(url, /^https:\/\/other\.example\//u); return globalThis.Response.json({ ok: true, status: "published" }); });
    await assert.rejects(publish(context, { remote: "https://other.example/api/evidence", fetchImpl: other.fetchImpl }), (error) => error.code === "E_EVIDENCE_PUBLISH_CONFIG");
    assert.equal(other.calls.length, 0, "a queued bundle is never sent to a different remote");
    const queue = await readPublishQueue(context.target, { env: context.env });
    assert.deepEqual(queue.map((item) => [item.taskId, item.remote, item.repository]), [[TASK, "https://forgeloop.monster/api/evidence", "acme/app"]]);
  } finally { await removeTempTree(context.target); }
});

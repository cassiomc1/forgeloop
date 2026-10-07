import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { admitRunnerJob, assertRunnerEventAdmission } from "../scripts/ci-runner-admission.mjs";

const repository = { full_name: "cassiomc1/forgeloop" };
const environment = { GITHUB_REPOSITORY: repository.full_name, GITHUB_EVENT_NAME: "pull_request" };
const event = { repository, pull_request: { base: { repo: repository }, head: { repo: repository } } };

test("runner admission rejects forks, target events and substituted repositories", () => {
  assertRunnerEventAdmission(environment, event);
  for (const name of ["push", "workflow_dispatch", "schedule", "release"]) {
    assertRunnerEventAdmission({ ...environment, GITHUB_EVENT_NAME: name }, { repository });
  }
  const rejected = [
    [environment, { ...event, pull_request: { ...event.pull_request, head: { repo: { full_name: "outsider/forgeloop" } } } }],
    [environment, { ...event, pull_request: { head: { repo: repository } } }],
    [{ ...environment, GITHUB_REPOSITORY: "outsider/forgeloop" }, event],
    [environment, { ...event, repository: { full_name: "outsider/forgeloop" } }],
    [{ ...environment, GITHUB_EVENT_NAME: "pull_request_target" }, event],
    [{ ...environment, GITHUB_EVENT_NAME: "unknown" }, event],
    [environment, null],
  ];
  for (const [env, payload] of rejected) assert.throws(() => assertRunnerEventAdmission(env, payload), { code: "E_RUNNER_EVENT_UNTRUSTED" });
});

test("runner admission requires a bounded regular UTF-8 event file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "runner-admission-"));
  try {
    const filename = path.join(directory, "event.json");
    const env = { ...environment, GITHUB_EVENT_PATH: filename };
    await writeFile(filename, JSON.stringify(event));
    assert.equal((await admitRunnerJob(env)).event, "pull_request");
    await assert.rejects(admitRunnerJob({ ...env, GITHUB_EVENT_PATH: "event.json" }), { code: "E_RUNNER_EVENT_UNTRUSTED" });
    await writeFile(filename, Buffer.from([0xff]));
    await assert.rejects(admitRunnerJob(env), { code: "E_RUNNER_EVENT_UNTRUSTED" });
    await writeFile(filename, Buffer.alloc(1048577));
    await assert.rejects(admitRunnerJob(env), { code: "E_RUNNER_EVENT_UNTRUSTED" });
    await writeFile(filename, "{");
    await assert.rejects(admitRunnerJob(env), SyntaxError);
    const alias = path.join(directory, "alias.json");
    await symlink(filename, alias);
    await assert.rejects(admitRunnerJob({ ...env, GITHUB_EVENT_PATH: alias }), { code: "E_RUNNER_EVENT_UNTRUSTED" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

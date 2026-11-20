import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runContractCreate } from "../src/commands/contract-create.js";
import { runDiscover } from "../src/commands/discover.js";
import { runTaskCreate } from "../src/commands/task-create.js";
import { readContract } from "../src/core/contract.js";
import { testSemanticProvider } from "../src/core/decision/test-provider.js";
import { fetchApprovedTicketContract, resolveCloudUrl } from "../src/core/ticket-contract.js";
import { getPackageRoot } from "../src/core/templates.js";
import { removeTempTree } from "./helpers/rm-safe.js";

// A contract approved in ForgeLoop Cloud for a ticket from any tracker becomes
// the task's contract (contract-create --from-ticket).

const packageRoot = getPackageRoot();
const TEAM_TOKEN = `flmcp_${"a".repeat(64)}`;
const env = { FORGELOOP_CLOUD_TOKEN: TEAM_TOKEN };
const approvedContract = {
  schemaVersion: 1,
  protocolVersion: 1,
  taskId: "linear-eng-42",
  objective: "Reject expired sessions on /login. Users with an expired session can still call the API.",
  assumptions: [],
  deliverables: ["src/auth/session.js"],
  constraints: [],
  risks: ["Touches authentication or authorization: verify access is denied as well as granted."],
  verification: [{ id: "ticket-d472129ff4", text: "`npm test -- auth` passes", type: "VERIFICATION" }],
  successCriteria: ["GET /api/me returns 401 with an expired token"],
  stopConditions: ["A required check fails without a verified root cause"],
  unresolvedDecisions: [],
  sourceRefs: ["linear:ENG-42"],
};

function cloud(record, { status = 200 } = {}) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, authorization: init.headers.authorization });
    return globalThis.Response.json(record, { status });
  };
  return { fetchImpl, requests };
}

const stored = (overrides = {}) => ({ key: "linear:ENG-42", status: "approved", url: "https://linear.app/acme/issue/ENG-42", approved: { contract: approvedContract, by: "alice@acme.com", at: "2026-11-20T12:00:00.000Z" }, ...overrides });

test("the approved contract is fetched with the team token and bound to its ticket", async () => {
  const server = cloud(stored());
  const result = await fetchApprovedTicketContract("linear:ENG-42", { env, fetchImpl: server.fetchImpl });
  assert.equal(server.requests[0].url, "https://forgeloop.monster/api/contracts?key=linear%3AENG-42");
  assert.equal(server.requests[0].authorization, `Bearer ${TEAM_TOKEN}`);
  assert.equal(result.approvedBy, "alice@acme.com");
  assert.deepEqual(result.contract.sourceRefs, ["linear:ENG-42", "https://linear.app/acme/issue/ENG-42"]);
});

test("proposals, missing contracts, bad tokens and bad keys are refused", async () => {
  await assert.rejects(() => fetchApprovedTicketContract("linear:ENG-42", { env, fetchImpl: cloud(stored({ status: "proposed", approved: null })).fetchImpl }), (error) => error.code === "E_TICKET_CONTRACT_NOT_APPROVED");
  await assert.rejects(() => fetchApprovedTicketContract("linear:ENG-42", { env, fetchImpl: cloud({ error: "No contract" }, { status: 404 }).fetchImpl }), /compile and approve the ticket first/u);
  await assert.rejects(() => fetchApprovedTicketContract("linear:ENG-42", { env, fetchImpl: cloud({ error: "x" }, { status: 401 }).fetchImpl }), /refused the token/u);
  await assert.rejects(() => fetchApprovedTicketContract("linear:ENG-42", { env: {}, fetchImpl: cloud(stored()).fetchImpl }), (error) => error.code === "E_TICKET_CONTRACT_UNAVAILABLE" && /FORGELOOP_CLOUD_TOKEN/u.test(error.message));
  await assert.rejects(() => fetchApprovedTicketContract("ENG-42", { env, fetchImpl: cloud(stored()).fetchImpl }), /source:externalId/u);
  assert.throws(() => resolveCloudUrl("http://forgeloop.monster"), /https/u);
  assert.equal(resolveCloudUrl("http://localhost:3000"), "http://localhost:3000");
});

test("contract-create --from-ticket persists the approved contract under the local task ID", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-from-ticket-"));
  try {
    await writeFile(path.join(target, "README.md"), "fixture\n", "utf8");
    const taskId = "eng-42";
    await runTaskCreate({ target, packageRoot, taskId, claims: ["src"] });
    await runDiscover({ target, packageRoot, taskId });
    await runTaskCreate({ target, packageRoot, taskId: "eng-43", claims: ["docs"] });
    await runDiscover({ target, packageRoot, taskId: "eng-43" });
    const server = cloud(stored());
    await runContractCreate({ target, packageRoot, taskId, fromTicket: "linear:ENG-42", env, fetchImpl: server.fetchImpl, semanticProvider: testSemanticProvider });
    const contract = await readContract(target, packageRoot, { taskId });
    assert.equal(contract.value.taskId, taskId, "the local task ID wins over the suggested one");
    assert.equal(contract.value.objective, approvedContract.objective);
    assert.deepEqual(contract.value.successCriteria, approvedContract.successCriteria);
    assert.deepEqual(contract.value.sourceRefs, ["linear:ENG-42", "https://linear.app/acme/issue/ENG-42"]);
    await assert.rejects(() => runContractCreate({ target, packageRoot, taskId, fromTicket: "linear:ENG-42", preset: "feature", env, fetchImpl: server.fetchImpl }), /one of --preset, --contract-file or --from-ticket/u);
    const broken = cloud(stored({ approved: { contract: { ...approvedContract, objective: "" }, by: "x", at: "y" } }));
    await assert.rejects(
      () => runContractCreate({ target, packageRoot, taskId: "eng-43", fromTicket: "linear:ENG-42", env, fetchImpl: broken.fetchImpl, semanticProvider: testSemanticProvider }),
      "an approved contract that fails the contract schema is refused",
    );
  } finally {
    await removeTempTree(target);
  }
});

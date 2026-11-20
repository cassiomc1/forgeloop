import { E_TICKET_CONTRACT_NOT_APPROVED, E_TICKET_CONTRACT_UNAVAILABLE } from "./error-codes.js";

// Fetches the contract a team approved in ForgeLoop Cloud for a ticket from any
// tracker (GitHub, Linear, Jira, ...). The key is "source:externalId", for
// example "linear:ENG-42" or "github:acme/app#12". The token is the team's
// ForgeLoop Cloud MCP token (read scope is enough), read from the environment
// and never written anywhere.

export const DEFAULT_CLOUD_URL = "https://forgeloop.monster";
const KEY = /^[a-z][a-z0-9-]{1,31}:[A-Za-z0-9][A-Za-z0-9._#:/-]{0,127}$/u;
const REQUEST_TIMEOUT_MS = 30_000;

const unavailable = (message) => Object.assign(new Error(message), { code: E_TICKET_CONTRACT_UNAVAILABLE });

export function resolveCloudUrl(value) {
  let url;
  try { url = new URL(value || DEFAULT_CLOUD_URL); } catch { throw unavailable("FORGELOOP_CLOUD_URL must be a URL"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw unavailable("FORGELOOP_CLOUD_URL must use https (http is allowed only for localhost)");
  if (url.username || url.password || url.search || url.hash) throw unavailable("FORGELOOP_CLOUD_URL must not contain credentials, a query or a fragment");
  return url.origin;
}

async function approvedRecord(response, key) {
  let body = null;
  try { body = await response.json(); } catch { /* reported below */ }
  if (response.status === 404) throw unavailable(`ForgeLoop Cloud has no contract for ${key}; compile and approve the ticket first`);
  if (response.status === 401 || response.status === 403) throw unavailable(`ForgeLoop Cloud refused the token (HTTP ${response.status}); check FORGELOOP_CLOUD_TOKEN`);
  if (!response.ok || !body || typeof body !== "object") throw unavailable(`ForgeLoop Cloud returned HTTP ${response.status}${body?.error ? `: ${body.error}` : ""}`);
  if (body.status !== "approved" || !body.approved?.contract || typeof body.approved.contract !== "object") {
    throw Object.assign(new Error(`The contract for ${key} is ${body.status ?? "not stored"}, not approved; approve it in ForgeLoop Cloud (contract_approve) or on the ticket first`), { code: E_TICKET_CONTRACT_NOT_APPROVED });
  }
  return body;
}

export async function fetchApprovedTicketContract(key, { env = process.env, fetchImpl = fetch } = {}) {
  if (typeof key !== "string" || !KEY.test(key)) throw unavailable(`--from-ticket must be a ticket key "source:externalId", for example linear:ENG-42 (got ${key})`);
  const token = env.FORGELOOP_CLOUD_TOKEN ?? "";
  if (!/^[A-Za-z0-9._~+/-]{32,512}$/u.test(token)) throw unavailable("FORGELOOP_CLOUD_TOKEN must be set to a ForgeLoop Cloud MCP token for your team");
  const base = resolveCloudUrl(env.FORGELOOP_CLOUD_URL);
  let response;
  try {
    response = await fetchImpl(`${base}/api/contracts?key=${encodeURIComponent(key)}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: globalThis.AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw unavailable(`ForgeLoop Cloud is unreachable at ${base}: ${error.message}`);
  }
  const body = await approvedRecord(response, key);
  const sourceRef = body.url ?? key;
  const contract = body.approved.contract;
  return {
    contract: { ...contract, sourceRefs: [...new Set([...(Array.isArray(contract.sourceRefs) ? contract.sourceRefs : []), sourceRef])] },
    approvedBy: body.approved.by ?? null,
    approvedAt: body.approved.at ?? null,
  };
}

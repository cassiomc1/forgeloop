import { createServer as createNodeHttpServer } from "node:http";

import {
  createMcpHandler,
  hostHeaderValidationResponse,
  originValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
} from "@modelcontextprotocol/server";

import { buildForgeLoopMcpServer } from "./server.js";
import { resolveProjectContext } from "./project-context.js";
import { resolveLaunchPolicy, SERVER_MODES } from "./capability-policy.js";
import { createForgeLoopContext, FORGELOOP_INTEGRATION_API_VERSION } from "@cassiomc1/forgeloop/integration";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * Strict stateless MCP 2026 HTTP transport (hardening §6-8).
 *
 * - The project root stays server-pinned; never a request input.
 * - LOOPBACK ONLY. Non-loopback binds are refused with
 *   E_MCP_REMOTE_NOT_SUPPORTED until an authenticated remote design exists;
 *   Host/Origin validation is not authentication.
 * - Strict modern protocol: legacy-era traffic is rejected, never silently
 *   served by a fallback.
 * - Transport resource bounds: header/request/keepalive timeouts and an
 *   in-flight request ceiling are transport controls, not authority.
 * - No session identity exists: each request carries its own stateless
 *   exchange, so MCP transport metadata is never ForgeLoop authority.
 */
export const HTTP_TRANSPORT_BOUNDS = Object.freeze({
  headersTimeoutMs: 10_000,
  requestTimeoutMs: 30_000,
  keepAliveTimeoutMs: 5_000,
  maxInFlightRequests: 32,
});

export function validateHttpBind({ host = "127.0.0.1" } = {}) {
  if (LOOPBACK_HOSTS.has(host)) return host;
  throw new Error(`E_MCP_REMOTE_NOT_SUPPORTED: only loopback binds (127.0.0.1, localhost, ::1) are supported; authenticated remote access is not designed yet`);
}

export async function createForgeLoopHttpHandler({
  projectPath,
  mode = SERVER_MODES.SAFE,
  allowExternalExecution = false,
  allowApprovalResolution = false,
  allowActionReconciliationSettlement = false,
  allowMaintenance = false,
  allowRecovery = false,
  allowLegacyRepair = false,
  allowForceRecovery = false,
  maxExecutionTimeMs = 600000,
  packageRoot = undefined,
  allowedHosts = undefined,
  allowedOrigins = undefined,
} = {}) {
  if (FORGELOOP_INTEGRATION_API_VERSION !== 1) {
    throw new Error(`E_MCP_FORGELOOP_INTEGRATION_UNSUPPORTED: ForgeLoop integration API ${FORGELOOP_INTEGRATION_API_VERSION} is not supported (required: 1)`);
  }
  const projectContext = await resolveProjectContext(projectPath);
  const policy = resolveLaunchPolicy({
    mode,
    allowExternalExecution,
    allowApprovalResolution,
    allowActionReconciliationSettlement,
    allowMaintenance,
    allowRecovery,
    allowLegacyRepair,
    allowForceRecovery,
    maxExecutionTimeMs,
  });

  // Stateless strict-modern: a fresh product per request keeps no session
  // authority, and legacy-era traffic is rejected instead of served.
  const storageRuntimeContext = createForgeLoopContext({ persistentStorage: true });
  const mcp = createMcpHandler(
    () => buildForgeLoopMcpServer({ projectContext, policy, packageRoot, storageRuntimeContext }),
    { responseMode: "json", legacy: "reject" },
  );

  const hosts = allowedHosts ?? localhostAllowedHostnames();
  const origins = allowedOrigins ?? localhostAllowedOrigins();

  const handle = async function handleMcpHttpRequest(request) {
    const hostRejection = hostHeaderValidationResponse(request, hosts);
    if (hostRejection) return hostRejection;
    const originRejection = originValidationResponse(request, origins);
    if (originRejection) return originRejection;
    // Content negotiation follows the MCP specification: clients that offer
    // text/event-stream receive the protocol-native stream encoding, which
    // this bounded stateless endpoint closes after each single exchange.
    return mcp.fetch(request);
  };

  return Object.freeze({
    handle,
    close: async () => {
      try { await mcp.close(); } finally { await storageRuntimeContext.close?.(); }
    },
  });
}

const MAX_HTTP_BODY_BYTES = 4 * 1024 * 1024;

function readBodyBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let oversized = false;
    req.on("data", (chunk) => {
      if (oversized) return; // drain the rest so the client never hits EPIPE
      size += chunk.length;
      if (size > MAX_HTTP_BODY_BYTES) {
        oversized = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (oversized) {
        const error = new Error("HTTP request body exceeds the MCP size bound");
        error.code = "E_MCP_HTTP_BODY_TOO_LARGE";
        reject(error);
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

async function nodeRequestToWebRequest(req) {
  const hostHeader = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${hostHeader}`).toString();
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  if (req.method === "GET" || req.method === "HEAD") {
    return new Request(url, { method: req.method, headers });
  }
  // Buffer the body with a hard size bound: stateless JSON-RPC exchanges are
  // small, and buffering avoids unbounded stream lifetimes (plan §77).
  const body = await readBodyBuffer(req);
  return new Request(url, {
    method: req.method,
    headers,
    body: new Uint8Array(body),
  });
}

async function writeWebResponseToNode(webResponse, res) {
  const headers = {};
  webResponse.headers.forEach((value, name) => {
    headers[name] = value;
  });
  res.writeHead(webResponse.status, headers);
  const body = await webResponse.arrayBuffer();
  res.end(Buffer.from(body));
}

export async function startForgeLoopHttpServer({
  projectPath,
  host = "127.0.0.1",
  port = 0,
  // Test-only injection point (closing plan §25): an async hook awaited
  // inside the in-flight region so concurrency shedding can be exercised
  // deterministically. Never used by the production entrypoints.
  requestGate = undefined,
  ...serverOptions
} = {}) {
  const boundHost = validateHttpBind({ host });
  const { handle, close: closeHandler } = await createForgeLoopHttpHandler({ projectPath, ...serverOptions });

  let inFlight = 0;
  const httpServer = createNodeHttpServer(async (req, res) => {
    try {
      // Transport resource control (not authority): shed load when the
      // in-flight ceiling is reached instead of queueing unboundedly.
      if (inFlight >= HTTP_TRANSPORT_BOUNDS.maxInFlightRequests) {
        res.writeHead(503, { "content-type": "application/json", "retry-after": "1" });
        res.end(JSON.stringify({
          ok: false,
          error: { code: "E_MCP_HTTP_BUSY", message: "Too many in-flight MCP HTTP requests" },
        }));
        return;
      }
      inFlight += 1;
      try {
        if (requestGate) await requestGate(req);
        if (req.method !== "POST") {
          res.writeHead(405, { "content-type": "application/json", allow: "POST" });
          res.end(JSON.stringify({
            ok: false,
            error: { code: "E_MCP_HTTP_METHOD_NOT_ALLOWED", message: "Only POST is supported on the stateless MCP HTTP endpoint" },
          }));
          return;
        }
        const request = await nodeRequestToWebRequest(req);
        const response = await handle(request);
        await writeWebResponseToNode(response, res);
      } finally {
        inFlight -= 1;
      }
    } catch (error) {
      const status = error?.code === "E_MCP_HTTP_BODY_TOO_LARGE" ? 413 : 500;
      if (!res.headersSent) {
        res.writeHead(status, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({
        ok: false,
        error: { code: error?.code ?? "E_MCP_HTTP_INTERNAL", message: status === 413 ? error.message : "Internal MCP HTTP error" },
      }));
    }
  });

  // Transport resource bounds (hardening §8): these are connection hygiene
  // controls, never ForgeLoop authority.
  httpServer.headersTimeout = HTTP_TRANSPORT_BOUNDS.headersTimeoutMs;
  httpServer.requestTimeout = HTTP_TRANSPORT_BOUNDS.requestTimeoutMs;
  httpServer.keepAliveTimeout = HTTP_TRANSPORT_BOUNDS.keepAliveTimeoutMs;

  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, boundHost, resolve);
  });
  const address = httpServer.address();

  return Object.freeze({
    host: boundHost,
    port: typeof address === "object" ? address.port : port,
    transportBounds: Object.freeze({
      headersTimeoutMs: httpServer.headersTimeout,
      requestTimeoutMs: httpServer.requestTimeout,
      keepAliveTimeoutMs: httpServer.keepAliveTimeout,
      maxInFlightRequests: HTTP_TRANSPORT_BOUNDS.maxInFlightRequests,
    }),
    close: async () => {
      httpServer.closeAllConnections?.();
      await new Promise((resolve) => httpServer.close(resolve));
      await closeHandler();
    },
  });
}

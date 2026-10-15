import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, relative, resolve, sep } from 'node:path';
import type { AuditReportFormat, AuditExportOptions, AuditFindingFilter } from '@shared/audit';
import type { ProjectUpdate, RepositorySearchRequest } from '@shared/domain';
import { ForgeLoopAuditError } from '@shared/errors';
import { AuditRuntime } from './runtime/audit-runtime';

const MAX_BODY_BYTES = 256 * 1024;
const SESSION_TTL_MS = 60 * 60 * 1000;
const SESSION_COOKIE = 'forgeloop_audit_session';
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export interface AuditWebServerOptions {
  runtime: AuditRuntime;
  staticRoot: string;
  applicationDataRoot: string;
  host?: string;
  port?: number;
}

export interface AuditWebServerAddress {
  host: string;
  port: number;
  origin: string;
  bootstrapUrl: string;
}

interface Session {
  expiresAt: number;
}

export class AuditWebServer {
  private readonly runtime: AuditRuntime;
  private readonly staticRoot: string;
  private readonly applicationDataRoot: string;
  private readonly host: string;
  private readonly port: number;
  private readonly bootstrapToken = randomBytes(32).toString('base64url');
  private bootstrapConsumed = false;
  private readonly sessions = new Map<string, Session>();
  private server: Server | null = null;
  private origin: string | null = null;
  private streamClients = new Set<ServerResponse>();

  constructor(options: AuditWebServerOptions) {
    this.runtime = options.runtime;
    this.staticRoot = resolve(options.staticRoot);
    this.applicationDataRoot = resolve(options.applicationDataRoot);
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 0;
    if (!isLoopbackHost(this.host)) throw new Error('ForgeLoopAudit web server only binds to loopback hosts');
  }

  async start(): Promise<AuditWebServerAddress> {
    if (this.server) throw new Error('ForgeLoopAudit web server is already running');
    await assertStaticRoot(this.staticRoot);
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch((error: unknown) => {
        this.sendError(response, 500, error);
      });
    });
    await new Promise<void>((resolvePromise, reject) => {
      const server = this.server!;
      const onError = (error: Error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolvePromise();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(this.port, this.host);
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Web server did not report a TCP address');
    this.origin = `http://${this.host === '::1' ? '[::1]' : this.host}:${address.port}`;
    return {
      host: this.host,
      port: address.port,
      origin: this.origin,
      bootstrapUrl: `${this.origin}/?bootstrap=${encodeURIComponent(this.bootstrapToken)}`,
    };
  }

  async stop(): Promise<void> {
    for (const response of this.streamClients) response.end();
    this.streamClients.clear();
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  }

  getBootstrapUrl(): string {
    if (!this.origin) throw new Error('Web server has not started');
    return `${this.origin}/?bootstrap=${encodeURIComponent(this.bootstrapToken)}`;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.applySecurityHeaders(response);
    if (!request.url) return this.sendError(response, 400, new Error('Request URL is missing'));
    if (!this.isAllowedRequest(request)) return this.sendError(response, 403, new Error('Request origin is not allowed'));

    const url = new URL(request.url, this.origin ?? 'http://127.0.0.1');
    if (url.pathname === '/health' && request.method === 'GET') return this.sendJson(response, 200, { ok: true, data: { status: 'ready' } });
    if (url.pathname === '/api/v1/session/bootstrap') {
      return this.handleBootstrap(request, response, url);
    }
    if (url.pathname.startsWith('/api/v1/')) {
      if (!this.hasSession(request)) return this.sendError(response, 401, new Error('Web session is not established'));
      if (url.pathname === '/api/v1/events' && request.method === 'GET') return this.handleEvents(request, response);
      return this.handleApi(request, response, url);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return this.sendError(response, 405, new Error('Method not allowed'));
    return this.serveStatic(response, url.pathname, request.method === 'HEAD');
  }

  private async handleBootstrap(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    if (request.method !== 'POST') return this.sendError(response, 405, new Error('Method not allowed'));
    const body = await readJson(request);
    const token = typeof body === 'object' && body !== null && typeof (body as { token?: unknown }).token === 'string'
      ? (body as { token: string }).token
      : url.searchParams.get('token');
    if (!token || token !== this.bootstrapToken || (this.bootstrapConsumed && process.env.FORGELOOP_AUDIT_TEST_REUSABLE_BOOTSTRAP !== '1')) return this.sendError(response, 401, new Error('Invalid bootstrap token'));
    if (process.env.FORGELOOP_AUDIT_TEST_REUSABLE_BOOTSTRAP !== '1') this.bootstrapConsumed = true;
    const sessionId = randomBytes(32).toString('base64url');
    this.sessions.set(sessionId, { expiresAt: Date.now() + SESSION_TTL_MS });
    response.setHeader('Set-Cookie', `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
    this.sendJson(response, 200, { ok: true, data: { expiresAt: Date.now() + SESSION_TTL_MS } });
  }

  private async handleApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const path = url.pathname;
    const method = request.method ?? 'GET';
    const segments = path.split('/').filter(Boolean).slice(2);
    try {
      if (method === 'GET' && path === '/api/v1/app') return this.sendJson(response, 200, { ok: true, data: { version: this.runtime.getAppVersion() } });
      if (method === 'GET' && path === '/api/v1/project') return this.sendJson(response, 200, { ok: true, data: await this.runtime.getProjectState() });
      if (method === 'GET' && path === '/api/v1/project/snapshot') return this.sendJson(response, 200, { ok: true, data: await this.runtime.getProjectSnapshot() });
      if (method === 'GET' && path === '/api/v1/project/timeline') return this.sendJson(response, 200, { ok: true, data: await this.runtime.getProjectTimeline() });
      if (method === 'POST' && path === '/api/v1/project/demo') { await this.runtime.openDemoProject(); return this.sendJson(response, 200, { ok: true, data: await this.runtime.getProjectState() }); }
      if (method === 'POST' && path === '/api/v1/project/recent') { const body = await readJson(request); await this.runtime.openRecentProject(readString(body, 'path')); return this.sendJson(response, 200, { ok: true, data: await this.runtime.getProjectState() }); }
      if (method === 'POST' && path === '/api/v1/project/close') { await this.runtime.closeProject(); return this.sendJson(response, 200, { ok: true, data: null }); }
      if (method === 'GET' && path === '/api/v1/recent-projects') return this.sendJson(response, 200, { ok: true, data: await this.runtime.getRecentProjects() });
      if (method === 'POST' && path === '/api/v1/recent-projects') { await this.runtime.addRecentProject(await readJson(request) as never); return this.sendJson(response, 200, { ok: true, data: null }); }
      if (method === 'DELETE' && path === '/api/v1/recent-projects') { await this.runtime.removeRecentProject(requiredQuery(url, 'path')); return this.sendJson(response, 200, { ok: true, data: null }); }
      if (method === 'GET' && path === '/api/v1/workspace') return this.sendJson(response, 200, { ok: true, data: await this.runtime.getProjectWorkspace() });
      if (method === 'POST' && path === '/api/v1/workspace/projects') { const body = await readJson(request); return this.sendJson(response, 200, { ok: true, data: await this.runtime.openWorkspaceProject(readString(body, 'path')) }); }
      if (method === 'POST' && path === '/api/v1/workspace/projects/save') { const body = await readJson(request); return this.sendJson(response, 200, { ok: true, data: await this.runtime.saveWorkspaceProject(readString(body, 'path')) }); }
      if (method === 'DELETE' && path === '/api/v1/workspace/projects') return this.sendJson(response, 200, { ok: true, data: await this.runtime.removeWorkspaceProject(requiredQuery(url, 'path')) });
      if (method === 'POST' && path === '/api/v1/workspace/projects/refresh') return this.sendJson(response, 200, { ok: true, data: await this.runtime.refreshWorkspaceProject(requiredQuery(url, 'path')) });
      if (method === 'GET' && path === '/api/v1/workspace/timeline') return this.sendJson(response, 200, { ok: true, data: await this.runtime.getWorkspaceTimeline(requiredQuery(url, 'path')) });
      if (method === 'GET' && path === '/api/v1/kanban') return this.sendJson(response, 200, { ok: true, data: await this.runtime.getKanbanBoard(url.searchParams.get('project')) });
      if (method === 'POST' && path === '/api/v1/renderer-ready') { await this.runtime.notifyRendererReady(); return this.sendJson(response, 200, { ok: true, data: null }); }
      if (method === 'GET' && path === '/api/v1/diagnostics') return this.sendJson(response, 200, { ok: true, data: this.runtime.getDiagnostics() });

      if (method === 'GET' && path === '/api/v1/audit/project') return this.sendJson(response, 200, { ok: true, data: await this.runtime.getProjectAudit() });
      if (method === 'GET' && path === '/api/v1/audit/findings') return this.sendJson(response, 200, { ok: true, data: await this.runtime.getAuditFindings(parseFindingFilter(url)) });
      if (method === 'GET' && segments[0] === 'audit' && segments[1] === 'task' && segments.length === 3) return this.sendJson(response, 200, { ok: true, data: await this.runtime.getTaskAudit(decodeURIComponent(segments[2])) });
      if (method === 'GET' && segments[0] === 'audit' && segments[1] === 'quality' && segments.length === 3) return this.sendJson(response, 200, { ok: true, data: await this.runtime.getTaskStructuralQuality(decodeURIComponent(segments[2])) });
      if (method === 'GET' && path === '/api/v1/audit/history') return this.sendJson(response, 200, { ok: true, data: await this.runtime.listAuditHistory() });
      if (method === 'POST' && path === '/api/v1/audit/history/save') return this.sendJson(response, 200, { ok: true, data: await this.runtime.saveAuditBaseline() });
      if (method === 'POST' && path === '/api/v1/audit/history/compare') { const body = await readJson(request); return this.sendJson(response, 200, { ok: true, data: await this.runtime.compareAudits(readString(body, 'baseAuditId'), optionalString(body, 'currentAuditId')) }); }
      if (method === 'POST' && path === '/api/v1/audit/report') return this.handleReportExport(request, response);

      if (method === 'GET' && segments[0] === 'tasks' && segments.length === 2) return this.sendJson(response, 200, { ok: true, data: await this.runtime.getTask(decodeURIComponent(segments[1])) });
      if (method === 'GET' && segments[0] === 'tasks' && segments[1] === 'events' && segments.length === 3) return this.sendJson(response, 200, { ok: true, data: await this.runtime.getTaskEvents(decodeURIComponent(segments[2]), url.searchParams.get('cursor') ?? undefined, optionalInteger(url, 'limit')) });
      if (method === 'POST' && segments[0] === 'tasks' && segments[1] === 'ledger' && segments.length === 3) return this.sendJson(response, 200, { ok: true, data: await this.runtime.validateEventLedger(decodeURIComponent(segments[2])) });
      if (method === 'GET' && segments[0] === 'tasks' && segments[1] === 'policy' && segments.length === 3) return this.sendJson(response, 200, { ok: true, data: await this.runtime.getPolicyStatus(decodeURIComponent(segments[2])) });
      if (method === 'GET' && path === '/api/v1/policy') return this.sendJson(response, 200, { ok: true, data: await this.runtime.getPolicyStatus() });
      if (method === 'GET' && segments[0] === 'tasks' && segments[1] === 'raw-artifact' && segments.length === 3) return this.sendJson(response, 200, { ok: true, data: await this.runtime.getRawArtifact(JSON.parse(Buffer.from(decodeURIComponent(segments[2]), 'base64url').toString('utf8')) as never) });
      if (method === 'POST' && path === '/api/v1/raw-artifact') { const body = await readJson(request); return this.sendJson(response, 200, { ok: true, data: await this.runtime.getRawArtifact(body as never) }); }
      if (method === 'POST' && path === '/api/v1/raw-collection-artifact') { const body = await readJson(request); return this.sendJson(response, 200, { ok: true, data: await this.runtime.getRawCollectionArtifact(body as never) }); }

      if (method === 'GET' && segments[0] === 'tasks' && segments[1] === 'history' && segments.length === 3) return this.sendJson(response, 200, { ok: true, data: await this.runtime.getTaskHistory(decodeURIComponent(segments[2])) });
      if (method === 'GET' && segments[0] === 'tasks' && segments[1] === 'trace' && segments.length === 3) return this.sendJson(response, 200, { ok: true, data: await this.runtime.getTaskTrace(decodeURIComponent(segments[2])) });
      if (method === 'GET' && segments[0] === 'tasks' && segments[1] === 'reflection' && segments.length === 3) return this.sendJson(response, 200, { ok: true, data: await this.runtime.getTaskReflection(decodeURIComponent(segments[2])) });
      if (method === 'GET' && segments[0] === 'tasks' && segments[1] === 'inspection' && segments.length === 3) return this.sendJson(response, 200, { ok: true, data: await this.runtime.getTaskInspection(decodeURIComponent(segments[2])) });
      if (method === 'GET' && segments[0] === 'tasks' && segments[1] === 'actions' && segments.length === 3) return this.sendJson(response, 200, { ok: true, data: await this.runtime.getTaskActions(decodeURIComponent(segments[2])) });
      if (method === 'GET' && segments[0] === 'tasks' && segments[1] === 'action' && segments.length === 4) return this.sendJson(response, 200, { ok: true, data: await this.runtime.getTaskAction(decodeURIComponent(segments[2]), decodeURIComponent(segments[3])) });
      if (method === 'GET' && segments[0] === 'tasks' && segments[1] === 'approvals' && segments.length === 3) return this.sendJson(response, 200, { ok: true, data: await this.runtime.getTaskApprovals(decodeURIComponent(segments[2])) });
      if (method === 'GET' && segments[0] === 'tasks' && segments[1] === 'metrics' && segments.length === 3) return this.sendJson(response, 200, { ok: true, data: await this.runtime.getTaskMetrics(decodeURIComponent(segments[2])) });
      if (method === 'GET' && segments[0] === 'tasks' && segments[1] === 'evaluations' && segments.length === 3) return this.sendJson(response, 200, { ok: true, data: await this.runtime.getTaskEvaluations(decodeURIComponent(segments[2])) });
      if (method === 'GET' && path === '/api/v1/capability-policy') return this.sendJson(response, 200, { ok: true, data: await this.runtime.getCapabilityPolicy() });
      if (method === 'GET' && segments[0] === 'tasks' && segments[1] === 'workspace-binding' && segments.length === 3) return this.sendJson(response, 200, { ok: true, data: await this.runtime.getTaskWorkspaceBinding(decodeURIComponent(segments[2])) });
      if (method === 'GET' && segments[0] === 'tasks' && segments[1] === 'handoffs' && segments.length === 3) return this.sendJson(response, 200, { ok: true, data: await this.runtime.getTaskHandoffs(decodeURIComponent(segments[2])) });
      if (method === 'GET' && segments[0] === 'tasks' && segments[1] === 'continuity-lint' && segments.length === 3) return this.sendJson(response, 200, { ok: true, data: await this.runtime.getTaskContinuityLint(decodeURIComponent(segments[2])) });
      if (method === 'GET' && segments[0] === 'tasks' && segments[1] === 'responsibility' && segments.length === 3) return this.sendJson(response, 200, { ok: true, data: await this.runtime.getTaskResponsibility(decodeURIComponent(segments[2])) });
      if (method === 'GET' && segments[0] === 'tasks' && segments[1] === 'verification-scope' && segments.length === 3) return this.sendJson(response, 200, { ok: true, data: await this.runtime.getTaskVerificationScope(decodeURIComponent(segments[2])) });
      if (method === 'GET' && segments[0] === 'tasks' && segments[1] === 'attestation' && segments.length === 3) return this.sendJson(response, 200, { ok: true, data: await this.runtime.getTaskAttestation(decodeURIComponent(segments[2])) });
      if (method === 'GET' && segments[0] === 'tasks' && segments[1] === 'execution-profile' && segments.length === 3) return this.sendJson(response, 200, { ok: true, data: await this.runtime.getTaskExecutionProfileContext(decodeURIComponent(segments[2])) });
      if (method === 'GET' && segments[0] === 'tasks' && segments[1] === 'audit-view' && segments.length === 3) return this.sendJson(response, 200, { ok: true, data: await this.runtime.getTaskAuditView(decodeURIComponent(segments[2])) });
      if (method === 'GET' && segments[0] === 'tasks' && segments[1] === 'executions' && segments.length === 3) return this.sendJson(response, 200, { ok: true, data: await this.runtime.getTaskExecutions(decodeURIComponent(segments[2]), optionalInteger(url, 'limit')) });

      if (method === 'GET' && path === '/api/v1/repository/index-status') return this.sendJson(response, 200, { ok: true, data: await this.runtime.getRepositoryIndexStatus() });
      if (method === 'POST' && path === '/api/v1/repository/search') return this.sendJson(response, 200, { ok: true, data: await this.runtime.searchRepository(await readJson(request) as unknown as RepositorySearchRequest) });
      return this.sendError(response, 404, new Error('Route not found'));
    } catch (error) {
      this.sendError(response, 400, error);
    }
  }

  private async handleReportExport(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readJson(request);
    const format = readString(body, 'format') as AuditReportFormat;
    if (!['JSON', 'MARKDOWN', 'SARIF'].includes(format)) throw new Error('Unsupported report format');
    const extension = format === 'MARKDOWN' ? 'md' : format.toLowerCase();
    const filename = `audit-${new Date().toISOString().replace(/[^0-9]/gu, '').slice(0, 14)}-${randomBytes(6).toString('hex')}.${extension}`;
    const options: AuditExportOptions = {
      format,
      destinationPath: join(this.applicationDataRoot, 'exports', filename),
      includeDiff: typeof body === 'object' && body !== null && (body as { includeDiff?: unknown }).includeDiff === true,
      baseAuditId: optionalString(body, 'baseAuditId'),
    };
    this.sendJson(response, 200, { ok: true, data: await this.runtime.exportAuditReport(options) });
  }

  private async handleEvents(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.write(`event: ready\ndata: ${JSON.stringify({ type: 'ready', timestamp: new Date().toISOString() })}\n\n`);
    this.streamClients.add(response);
    const unsubscribe = this.runtime.subscribe((update) => {
      if (!response.writableEnded) response.write(`event: project-update\ndata: ${JSON.stringify(sanitizeProjectUpdate(update))}\n\n`);
    });
    const heartbeat = setInterval(() => {
      if (!response.writableEnded) response.write(`: heartbeat ${Date.now()}\n\n`);
    }, 20_000);
    heartbeat.unref();
    request.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      this.streamClients.delete(response);
    });
  }

  private async serveStatic(response: ServerResponse, pathname: string, headOnly: boolean): Promise<void> {
    const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const target = resolve(this.staticRoot, requested);
    const relativeTarget = relative(this.staticRoot, target);
    if (relativeTarget === '..' || relativeTarget.startsWith(`..${sep}`) || relativeTarget.includes(`..${sep}`)) return this.sendError(response, 403, new Error('Static path escapes the web root'));
    let stat;
    try { stat = await fs.stat(target); } catch { return this.sendError(response, 404, new Error('Static asset not found')); }
    if (!stat.isFile()) return this.sendError(response, 404, new Error('Static asset not found'));
    response.setHeader('Content-Type', contentType(extname(target)));
    response.setHeader('Cache-Control', pathname === '/' ? 'no-cache' : 'public, max-age=31536000, immutable');
    response.setHeader('Content-Length', stat.size);
    if (headOnly) {
      response.end();
      return;
    }
    createReadStream(target).pipe(response);
  }

  private hasSession(request: IncomingMessage): boolean {
    const cookies = parseCookies(request.headers.cookie);
    const value = cookies[SESSION_COOKIE];
    if (!value) return false;
    const session = this.sessions.get(value);
    if (!session || session.expiresAt < Date.now()) {
      this.sessions.delete(value);
      return false;
    }
    return true;
  }

  private isAllowedRequest(request: IncomingMessage): boolean {
    const host = (request.headers.host ?? '').split(':')[0].toLowerCase();
    if (!ALLOWED_HOSTS.has(host) || !this.origin) return false;
    const origin = request.headers.origin;
    return !origin || origin === this.origin;
  }

  private applySecurityHeaders(response: ServerResponse): void {
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  }

  private sendJson(response: ServerResponse, status: number, payload: unknown): void {
    if (response.writableEnded) return;
    const content = JSON.stringify(payload);
    response.statusCode = status;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Length', Buffer.byteLength(content));
    response.end(content);
  }

  private sendError(response: ServerResponse, status: number, error: unknown): void {
    if (response.writableEnded) return;
    const safe = safeError(error);
    this.sendJson(response, status, { ok: false, error: safe });
  }
}

async function assertStaticRoot(root: string): Promise<void> {
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error(`Web static root is not a directory: ${root}`);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new Error('Request body is too large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON object expected');
  return parsed as Record<string, unknown>;
}

function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${key} is required`);
  return value;
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${key} must be a string`);
  return value;
}

function requiredQuery(url: URL, key: string): string {
  const value = url.searchParams.get(key);
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function optionalInteger(url: URL, key: string): number | undefined {
  const value = url.searchParams.get(key);
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${key} must be an integer`);
  return parsed;
}

function parseFindingFilter(url: URL): AuditFindingFilter {
  const filter: AuditFindingFilter = {};
  const taskId = url.searchParams.get('taskId');
  if (taskId !== null) filter.taskId = taskId;
  const severity = url.searchParams.getAll('severity');
  if (severity.length > 0) filter.severity = severity.length === 1 ? severity[0] as AuditFindingFilter['severity'] : severity as AuditFindingFilter['severity'];
  const domain = url.searchParams.getAll('domain');
  if (domain.length > 0) filter.domain = domain.length === 1 ? domain[0] as AuditFindingFilter['domain'] : domain as AuditFindingFilter['domain'];
  const source = url.searchParams.getAll('source');
  if (source.length > 0) filter.source = source.length === 1 ? source[0] as AuditFindingFilter['source'] : source as AuditFindingFilter['source'];
  const canonical = url.searchParams.get('canonical');
  if (canonical !== null) filter.canonical = canonical === 'true';
  const limit = optionalInteger(url, 'limit');
  if (limit !== undefined) filter.limit = limit;
  return filter;
}

function parseCookies(header: string | undefined): Record<string, string> {
  return Object.fromEntries((header ?? '').split(';').map((part) => part.trim().split('=' as string, 2)).filter(([key, value]) => key && value).map(([key, value]) => [key, decodeURIComponent(value)]));
}

function sanitizeProjectUpdate(update: ProjectUpdate): ProjectUpdate {
  if (!update.data || typeof update.data !== 'object' || Array.isArray(update.data)) return update;
  const data = { ...(update.data as Record<string, unknown>) };
  if (data.event && typeof data.event === 'object' && !Array.isArray(data.event)) {
    const event = { ...(data.event as Record<string, unknown>) };
    delete event.path;
    delete event.filePath;
    delete event.absolutePath;
    data.event = event;
  }
  return { ...update, data };
}

function safeError(error: unknown): { source: string; code: string; message: string; retryable: boolean } {
  if (error instanceof ForgeLoopAuditError) return { source: 'forgeloop-audit', code: error.code, message: error.message, retryable: error.recoverable };
  if (error instanceof SyntaxError) return { source: 'local-web-server', code: 'INVALID_JSON', message: 'Request body is not valid JSON', retryable: false };
  if (error instanceof Error && /required|expected|unsupported|integer|too large|not allowed/iu.test(error.message)) return { source: 'local-web-server', code: 'INVALID_REQUEST', message: error.message, retryable: false };
  return { source: 'local-web-server', code: 'REQUEST_FAILED', message: 'The local web request could not be completed', retryable: true };
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function contentType(extension: string): string {
  switch (extension.toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.woff': return 'font/woff';
    case '.woff2': return 'font/woff2';
    default: return 'application/octet-stream';
  }
}

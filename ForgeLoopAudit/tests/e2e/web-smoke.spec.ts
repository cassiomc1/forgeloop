import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const SERVER_INFO = join(process.cwd(), 'test-results', 'web-server.json');
const SMOKE_TASK_ID = 'TASK-001';

function serverInfo(): { bootstrapUrl: string; origin: string; projectPath: string } {
  return JSON.parse(readFileSync(SERVER_INFO, 'utf8')) as { bootstrapUrl: string; origin: string; projectPath: string };
}

test.use({ colorScheme: 'dark' });

test.beforeEach(async ({ page }) => {
  const response = await page.request.get(`${serverInfo().origin}/health`);
  expect(response.ok()).toBeTruthy();
});

test('local web host bootstraps a same-origin session and renders the demo', async ({ page }) => {
  await page.goto(serverInfo().bootstrapUrl);
  await expect(page).toHaveTitle('ForgeLoopAudit');
  await expect(page.getByRole('heading', { name: 'Audit Summary' })).toBeVisible({ timeout: 20_000 });
  const projectResponse = await page.request.get(`${serverInfo().origin}/api/v1/project`);
  expect(projectResponse.ok()).toBeTruthy();
  const projectPayload = await projectResponse.json() as { data?: { detection?: { compatibilityMode?: string } } };
  expect(projectPayload.data?.detection?.compatibilityMode).toBe('ARTIFACT_ONLY');
});

test('light and dark themes switch through the shadcn-style theme control', async ({ page }) => {
  await page.goto(serverInfo().bootstrapUrl);
  const toggle = page.getByRole('button', { name: /Switch to light theme/i });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await expect(page.getByRole('button', { name: /Switch to dark theme/i })).toBeVisible();
});

test('web UI preserves the audit navigation and live watcher update', async ({ page }) => {
  const fixture = serverInfo().projectPath;
  await page.goto(serverInfo().bootstrapUrl);
  await expect(page.getByRole('heading', { name: 'Audit Summary' })).toBeVisible({ timeout: 15_000 });
  for (const name of ['Projects', 'Task Board', 'Project Timeline', 'Tasks', 'Findings', 'Evidence', 'Quality', 'Policy & Trust', 'Audit History', 'Reports', 'Repository Search', 'Diagnostics', 'Settings']) {
    await page.getByLabel('Main navigation').getByRole('button', { name, exact: true }).click();
    await expect(page.locator('h1'), `Expected a page heading after opening ${name}`).toBeVisible({ timeout: 15000 });
  }
  await page.getByLabel('Main navigation').getByRole('button', { name: 'Project Timeline', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Timeline/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Current Architecture', exact: true })).toBeVisible();
  await page.getByLabel('Main navigation').getByRole('button', { name: 'Tasks', exact: true }).click();
  await expect(page.getByText(SMOKE_TASK_ID, { exact: true }).first()).toBeVisible();
  await page.getByText(SMOKE_TASK_ID, { exact: true }).first().click();
  await page.getByLabel('Task detail navigation').getByRole('button', { name: 'Events', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Event Ledger' })).toBeVisible();
  await page.getByRole('button', { name: 'Validate ledger', exact: true }).click();
  await expect(page.getByText('Page schema: VALID')).toBeVisible();
  appendLiveEvent(fixture, SMOKE_TASK_ID, 'WEB_SMOKE_UPDATE');
  await expect(page.getByText('WEB_SMOKE_UPDATE')).toBeVisible({ timeout: 10_000 });
  // The webServer fixture owns and removes this temporary copy.
});

test('the task board shows every status column and filters by project', async ({ page }) => {
  await page.goto(serverInfo().bootstrapUrl);
  await page.getByLabel('Main navigation').getByRole('button', { name: 'Task Board', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Task Board' })).toBeVisible({ timeout: 15_000 });
  // The heading renders immediately; the columns appear once the board loads.
  for (const column of ['Backlog', 'Ready', 'In Progress', 'Review', 'Blocked', 'Complete']) {
    await expect(page.getByRole('region', { name: `${column} column` })).toBeVisible({ timeout: 15_000 });
  }
  await expect(page.getByText(SMOKE_TASK_ID, { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  const board = await boardFrom(page);
  expect(board.columns.map((column) => column.id)).toEqual(['backlog', 'ready', 'in-progress', 'review', 'blocked', 'complete']);
  expect(board.totalTasks).toBeGreaterThan(0);

  // Filtering to a single project must strictly reduce the board to that project.
  const onlyProject = board.projects[0].path;
  const filtered = await boardFrom(page, onlyProject);
  expect(filtered.filterProjectPath).toBe(onlyProject);
  expect(filtered.totalTasks).toBe(board.totalTasks);
  expect(filtered.columns.flatMap((column) => column.cards).every((card) => card.projectPath === onlyProject)).toBe(true);
});

test('a second project can be registered and a non-ForgeLoop path is refused', async ({ page }) => {
  const second = await createSecondProject();
  try {
    await page.goto(serverInfo().bootstrapUrl);
    await page.getByLabel('Main navigation').getByRole('button', { name: 'Projects', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

    await page.getByLabel('Project path').fill(second);
    await page.getByRole('button', { name: 'Open and save', exact: true }).click();
    // Opening a registered project switches the shell to its audit summary.
    await expect(page.getByRole('heading', { name: 'Audit Summary' })).toBeVisible({ timeout: 30_000 });

    const workspace = await requireWorkspace(page);
    expect(workspace.projects.map((project) => project.path)).toContain(second);
    expect(workspace.projects.find((project) => project.path === second)?.active).toBe(true);
    expect(workspace.watching).toBeGreaterThanOrEqual(2);

    // A directory without ForgeLoop state must be refused, never registered.
    const bare = dirname(second);
    const rejected = await page.request.post(`${serverInfo().origin}/api/v1/workspace/projects`, { data: { path: bare } });
    expect((await rejected.json()).ok).toBe(false);
    expect((await requireWorkspace(page)).projects.map((project) => project.path)).not.toContain(bare);
  } finally {
    // Unregister before deleting, so the shared host does not keep a dead path.
    await page.request.delete(`${serverInfo().origin}/api/v1/workspace/projects?path=${encodeURIComponent(second)}`).catch(() => undefined);
    rmSync(dirname(second), { recursive: true, force: true });
  }
});

test('a change in a background project is pushed live to the open session', async ({ page }) => {
  const second = await createSecondProject();
  try {
    // Wait for the same-origin session before using the API: the host is
    // session-scoped and the app establishes the cookie asynchronously.
    await page.goto(serverInfo().bootstrapUrl);
    await expect.poll(() => workspaceFrom(page), { timeout: 20_000 }).toBeTruthy();

    // Establish the open project explicitly so this test does not depend on
    // which project an earlier test left open.
    await page.request.post(`${serverInfo().origin}/api/v1/workspace/projects`, { data: { path: serverInfo().projectPath } });
    // Save the second project without switching to it, so it stays a background
    // project that this runtime watches on its own.
    await page.request.post(`${serverInfo().origin}/api/v1/workspace/projects/save`, { data: { path: second } });

    const workspace = await requireWorkspace(page);
    expect(workspace.projects.find((project) => project.path === second)?.active).toBe(false);
    expect(workspace.projects.find((project) => project.path === serverInfo().projectPath)?.active).toBe(true);

    const board = await boardFrom(page);
    expect(board.projects.some((project) => project.path === second)).toBe(true);

    // Record the live update stream, then touch the background project only.
    await startEventStream(page);
    await page.waitForTimeout(500);
    appendLiveEvent(second, SMOKE_TASK_ID, 'BACKGROUND_PROJECT_UPDATE');

    // The background change must reach the browser without reopening anything,
    // and it must be attributed to the project that produced it. Payloads are
    // parsed rather than matched as text because JSON escapes path separators.
    await expect.poll(
      async () => (await readWorkspaceUpdates(page)).some((update) => update.projectPath === second),
      { timeout: 20_000 },
    ).toBe(true);
    const updates = await readWorkspaceUpdates(page);
    expect(updates.some((update) => update.projectPath === second && update.eventType === 'event-appended')).toBe(true);

    // The cross-project board keeps every registered project listed throughout.
    expect((await boardFrom(page)).projects.some((project) => project.path === second)).toBe(true);

    await page.request.delete(`${serverInfo().origin}/api/v1/workspace/projects?path=${encodeURIComponent(second)}`);
  } finally {
    rmSync(dirname(second), { recursive: true, force: true });
  }
});

interface Page {
  request: APIRequestContext;
  evaluate: (fn: () => unknown) => Promise<unknown>;
}

interface WorkspaceUpdate {
  type: string;
  projectPath?: string;
  data?: { eventType?: string };
}

/** Subscribe to the host's server-sent update stream from inside the page. */
async function startEventStream(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as unknown as { __flaStream: string };
    target.__flaStream = '';
    void (async () => {
      const response = await fetch('/api/v1/events');
      const reader = response.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        target.__flaStream += decoder.decode(value, { stream: true });
      }
    })();
  });
}

/** Parse received `data:` payloads instead of matching raw text. */
async function readWorkspaceUpdates(page: Page): Promise<Array<{ projectPath: string; eventType: string }>> {
  const raw = await page.evaluate(() => (window as unknown as { __flaStream: string }).__flaStream) as Promise<string>;
  return raw
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => {
      try { return JSON.parse(line.slice(6)) as WorkspaceUpdate; } catch { return null; }
    })
    .filter((update): update is WorkspaceUpdate => update?.type === 'workspace-changed')
    .map((update) => ({ projectPath: update.projectPath ?? '', eventType: update.data?.eventType ?? '' }));
}

interface KanbanResponse {
  columns: Array<{ id: string; cards: Array<{ projectPath: string }> }>;
  projects: Array<{ path: string; name: string; taskCount: number }>;
  filterProjectPath: string | null;
  totalTasks: number;
}

/** API helpers reuse the browser context so they share the session cookie. */
async function boardFrom(page: Page, project?: string): Promise<KanbanResponse> {
  const query = project ? `?project=${encodeURIComponent(project)}` : '';
  const response = await page.request.get(`${serverInfo().origin}/api/v1/kanban${query}`);
  const payload = await response.json() as { ok: boolean; data: KanbanResponse };
  expect(payload.ok).toBe(true);
  return payload.data;
}

/**
 * Read the workspace through the page context so the request shares the
 * browser's session cookie. Returns `null` until the session is established.
 */
async function workspaceFrom(page: Page): Promise<WorkspaceResponse | null> {
  const response = await page.request.get(`${serverInfo().origin}/api/v1/workspace`);
  const payload = await response.json() as { ok: boolean; data?: WorkspaceResponse };
  return payload.ok && payload.data ? payload.data : null;
}

async function requireWorkspace(page: Page): Promise<WorkspaceResponse> {
  const workspace = await workspaceFrom(page);
  if (!workspace) throw new Error('The project workspace is unavailable.');
  return workspace;
}

/** A second, independent copy of the demo fixture to prove cross-project views. */
function createSecondProject(): string {
  const target = join(mkdtempSync(join(tmpdir(), 'forgeloop-audit-second-')), 'proj-2');
  cpSync('demo', target, { recursive: true });
  return target;
}

function appendLiveEvent(projectRoot: string, taskId: string, eventName: string): void {
  const eventPath = join(projectRoot, '.forgeloop', 'task-state', createHash('sha256').update(taskId).digest('hex'), 'events.ndjson');
  const lines = readFileSync(eventPath, 'utf8').trim().split('\n').filter(Boolean);
  const previous = JSON.parse(lines.at(-1) || '{}') as { seq: number; hash: string };
  const event = { seq: previous.seq + 1, schemaVersion: 1, protocolVersion: 1, taskId, event: eventName, at: new Date().toISOString(), previousHash: previous.hash, details: { source: 'web-smoke-test' } };
  const hash = createHash('sha256').update(JSON.stringify(canonicalize(event))).digest('hex');
  appendFileSync(eventPath, `${JSON.stringify({ ...event, hash })}\n`);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
  return value;
}

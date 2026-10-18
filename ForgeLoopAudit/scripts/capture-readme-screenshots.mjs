import { createNativeDemoFixture } from './demo/native-fixture.mjs';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, cpSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const screenDir = join(root, 'screen');
const manifest = JSON.parse(readFileSync(join(screenDir, 'manifest.json'), 'utf8'));
const width = manifest.viewport.width;
const height = manifest.viewport.height;
const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-audit-screenshots-'));
const infoFile = join(tempRoot, 'server.json');
let serverProcess;
let browser;

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function navigation(page, label) {
  return page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: label, exact: true });
}

async function waitForServerInfo() {
  const deadline = Date.now() + 15_000;
  while (!existsSync(infoFile)) {
    if (Date.now() >= deadline) throw new Error('Local web server did not publish its bootstrap information');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return JSON.parse(readFileSync(infoFile, 'utf8'));
}

async function stabilize(page, heading) {
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('region', { name: 'Demo project information' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Loading(?: canonical)?|Loading events\.\.\./)).toHaveCount(0, { timeout: 15_000 });
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(200);
  const viewport = page.viewportSize();
  assertCondition(viewport?.width === width && viewport?.height === height, `Expected ${width}x${height} viewport, got ${viewport?.width}x${viewport?.height}`);
  const bodyText = await page.locator('body').innerText();
  assertCondition(!/(?:\/Users\/|\/home\/|[A-Z]:\\Users\\)/u.test(bodyText), 'Screenshot page contains a local user path');
  assertCondition(!bodyText.includes('Demo drift'), 'Screenshot page contains demo drift');
}

async function openSurface(page, label, heading, taskId) {
  await navigation(page, label).click();
  await stabilize(page, heading);
  if (taskId) {
    const selector = page.getByRole('combobox').first();
    await selector.selectOption(taskId);
    await expect(selector).toHaveValue(taskId);
    await page.waitForTimeout(200);
  }
  await page.locator('main').evaluate((element) => element.scrollTo(0, 0));
  await stabilize(page, heading);
}

async function capture(page, file, assertion, scrollTarget) {
  if (scrollTarget) {
    await scrollTarget.scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
  }
  await assertion();
  await page.screenshot({ path: join(screenDir, file), animations: 'disabled' });
}

async function stopServer() {
  if (!serverProcess || serverProcess.killed) return;
  serverProcess.kill('SIGTERM');
  await new Promise((resolve) => serverProcess.once('exit', resolve));
}

const nativeDemo = createNativeDemoFixture(join(root, 'demo'));
serverProcess = spawn(process.execPath, ['dist/server/cli.mjs', '--demo', '--port', '0', '--no-open'], {
  cwd: root,
  env: {
    ...process.env,
    FORGELOOP_AUDIT_SMOKE: '1',
    FORGELOOP_AUDIT_FIXTURE_PROJECT: nativeDemo.root,
    FORGELOOP_AUDIT_DATA_DIR: join(tempRoot, 'app-data'),
    FORGELOOP_AUDIT_TEST_INFO_FILE: infoFile,
    FORGELOOP_AUDIT_TEST_REUSABLE_BOOTSTRAP: '1',
    FORGELOOP_AUDIT_NO_OPEN: '1',
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});
serverProcess.stdout.on('data', (chunk) => process.stdout.write(`[WebServer] ${chunk}`));

try {
  const server = await waitForServerInfo();
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height }, colorScheme: 'dark' });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto(server.bootstrapUrl);
  await page.addStyleTag({
    content: '*,:before,:after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; }',
  });

  await expect(page.getByRole('heading', { name: 'Audit Summary', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('region', { name: 'Demo project information' })).toContainText('ForgeShop');
  await expect(page.getByRole('region', { name: 'Demo project information' })).toContainText('errors are still real');
  await page.getByRole('button', { name: /Run audit|Retry audit/, exact: true }).click();
  await expect(page.getByText(/Audit score|Score unavailable/)).toBeVisible({ timeout: 15_000 });

  await capture(page, 'audit-summary.png', async () => {
    await expect(page.getByText('Integrity', { exact: true })).toBeVisible();
    await expect(page.getByText('Completion readiness', { exact: true })).toBeVisible();
    await expect(page.getByText('Audit coverage', { exact: true })).toBeVisible();
    await expect(page.getByText(/Audit score|Score unavailable/)).toBeVisible();
  });

  // Register a second, independent copy of the fixture so the workspace and the
  // cross-project board are captured with more than one project. The demo project
  // stays open, so the demo banner and every later capture are unchanged.
  const secondProject = join(tempRoot, 'forgeloop-demo-2');
  cpSync(join(root, 'demo'), secondProject, { recursive: true });
  const saved = await page.request.post(`${server.origin}/api/v1/workspace/projects/save`, { data: { path: secondProject } });
  assertCondition(saved.ok(), 'The second demo project could not be registered in the workspace');

  await openSurface(page, 'Projects', 'Projects');
  await capture(page, 'projects.png', async () => {
    await expect(page.getByText('Open and save', { exact: true })).toBeVisible();
    await expect(page.getByText('Save only', { exact: true })).toBeVisible();
    await expect(page.getByText('Available', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Demo', { exact: true })).toBeVisible();
  });

  await openSurface(page, 'Task Board', 'Task Board');
  await capture(page, 'kanban.png', async () => {
    for (const column of ['Backlog', 'Ready', 'In Progress', 'Review', 'Blocked', 'Complete']) {
      await expect(page.getByRole('region', { name: `${column} column` })).toBeVisible();
    }
    await expect(page.getByRole('group', { name: 'Project filter', exact: true })).toBeVisible();
    await expect(page.getByText('All projects', { exact: true })).toBeVisible();
    await expect(page.getByText('Read-only', { exact: true })).toBeVisible();
  });

  await openSurface(page, 'Project Timeline', 'demo Timeline');
  await capture(page, 'timeline.png', async () => {
    await expect(page.getByRole('heading', { name: 'Current architecture', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Timeline filters', exact: true })).toBeVisible();
    await expect(page.getByText('Evidence and details', { exact: true }).first()).toBeVisible();
  });

  await openSurface(page, 'Findings', 'Findings');
  await capture(page, 'findings.png', async () => {
    await expect(page.getByText('Canonical ForgeLoop results and explicitly labelled auditor observations.', { exact: true })).toBeVisible();
    await expect(page.getByRole('combobox').first()).toBeVisible();
  });

  await openSurface(page, 'Tasks', 'Tasks');
  await capture(page, 'task-audit.png', async () => {
    for (const taskId of ['TASK-001', 'TASK-002', 'TASK-003', 'TASK-004', 'TASK-005', 'TASK-006', 'TASK-007', 'TASK-008']) {
      await expect(page.getByText(taskId, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('Demo scenario', { exact: true })).toHaveCount(8);
    // Abandonment is rendered as its own label, never as completion.
    await expect(page.getByText('ABANDONED', { exact: true })).toBeVisible();
    await expect(page.getByText(/Audit (VALID|INCOMPLETE|STALE|INVALID|UNKNOWN)/).first()).toBeVisible();
  });

  await openSurface(page, 'Evidence', 'Evidence Matrix', 'TASK-002');
  await capture(page, 'evidence.png', async () => {
    await expect(page.getByRole('heading', { name: 'Verification Scope', exact: true })).toBeVisible();
    await expect(page.getByText('AUTO', { exact: true })).toBeVisible();
    await expect(page.getByText('CHANGED', { exact: true })).toBeVisible();
    await expect(page.getByText('not revision-range attestation coverage.', { exact: false })).toBeVisible();
  });

  await openSurface(page, 'Quality', 'Engineering Quality', 'TASK-001');
  await capture(page, 'quality.png', async () => {
    await expect(page.getByText('Canonical Structural Quality projection; ForgeLoopAudit never runs a provider.', { exact: true })).toBeVisible();
    await expect(page.getByText(/Structural quality unavailable|Current status/)).toBeVisible();
  });

  await openSurface(page, 'Policy & Trust', 'Policy & Trust', 'TASK-006');
  await capture(page, 'policy-trust.png', async () => {
    await expect(page.getByText('Canonical policy, ownership boundaries and evidence trust signals for the selected task.', { exact: true })).toBeVisible();
    await expect(page.getByText('Trust boundary projections', { exact: true })).toBeVisible();
    await expect(page.getByText('Operational receipts only; never evidence.', { exact: true })).toBeVisible();
  });

  await openSurface(page, 'Audit History', 'Audit History');
  await page.getByRole('button', { name: 'Save baseline', exact: true }).click();
  await expect(page.getByText('Baseline saved.', { exact: true })).toBeVisible({ timeout: 15_000 });
  await capture(page, 'history-diff.png', async () => {
    await expect(page.getByText('Manual snapshots are stored in application data, outside the audited project.', { exact: true })).toBeVisible();
    await expect(page.getByText('Save baseline', { exact: true })).toBeVisible();
  });

  await openSurface(page, 'Reports', 'Reports');
  await capture(page, 'report.png', async () => {
    await expect(page.getByText('Deterministic reports generated from already-read audit data.', { exact: true })).toBeVisible();
    await expect(page.getByText('Reports include ForgeLoop provenance, audit rules, timestamp, HEAD, fingerprint and [C]/[D]/[A] trust labels. The audited .forgeloop directory is protected by default. Browser clients cannot choose arbitrary host paths.', { exact: true })).toBeVisible();
  });

  await openSurface(page, 'Diagnostics', 'Diagnostics', 'TASK-004');
  await capture(page, 'diagnostics.png', async () => {
    await expect(page.getByText('Canonical history, trace, reflection and trajectory signals', { exact: true })).toBeVisible();
    await expect(page.getByText('BLOCKED', { exact: true })).toBeVisible();
    await expect(page.getByText('Canonical trajectory metrics', { exact: true })).toBeVisible();
  });

  await openSurface(page, 'Settings', 'Settings');
  await capture(page, 'settings.png', async () => {
    await expect(page.getByText(`ForgeLoopAudit v${packageVersion}`, { exact: true })).toBeVisible();
    const protocolPanel = page.getByRole('heading', { name: 'ForgeLoop protocol', exact: true }).locator('..');
    await expect(protocolPanel).toContainText('2.0.0');
    await expect(protocolPanel).toContainText('Advisory context providers');
    await expect(protocolPanel).toContainText('Supported by ForgeLoop');
    await expect(protocolPanel).toContainText('INTEGRATION_V1');
  }, page.getByRole('heading', { name: 'ForgeLoop protocol', exact: true }));
} finally {
  await browser?.close();
  await stopServer();
  nativeDemo.cleanup();
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log(`Captured ${manifest.screenshots.length} ForgeLoopAudit README screenshots at ${width}x${height}.`);

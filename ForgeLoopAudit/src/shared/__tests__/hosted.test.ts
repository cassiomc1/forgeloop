import { describe, expect, it } from 'vitest';
import fixture from '../../hosted/fixtures/dashboard-summary.json';
import { DashboardContractError, dashboardTotals, formatDuration, median, parseDashboardSummary } from '../hosted';
import { loadDashboard } from '../hosted-client';

const clone = () => JSON.parse(JSON.stringify(fixture));

describe('hosted dashboard contract', () => {
  it('parses the fixture and derives totals without inventing data', () => {
    const summary = parseDashboardSummary(clone());
    expect(dashboardTotals(summary)).toEqual({
      repositories: 2,
      tasks: 2,
      signedTasks: 1,
      invalidBundles: 1,
      pullRequests: 3,
      passingPullRequests: 1,
      failingPullRequests: 1,
      medianDurationMs: 1680000,
      totalVerificationCycles: 3,
      tasksWithRework: 1,
    });
  });

  it('keeps tasks without metrics and drops unknown metric fields', () => {
    const value = clone();
    value.accounts[0].repositories[0].tasks[0].metrics = null;
    value.accounts[0].repositories[0].tasks[1].metrics.phaseDurationsMs = { planning: -1, executing: 'x', unknown: 5 };
    const summary = parseDashboardSummary(value);
    expect(summary.accounts[0].repositories[0].tasks[0].metrics).toBeNull();
    expect(summary.accounts[0].repositories[0].tasks[1].metrics?.phaseDurationsMs).toEqual({});
    expect(dashboardTotals(summary).medianDurationMs).toBe(900000);
  });

  it('parses task source and signature status with safe fallbacks', () => {
    const value = clone();
    const [first, second] = value.accounts[0].repositories[0].tasks;
    Object.assign(first, { source: 'published', publishedAt: '2026-11-18T10:00:00.000Z', signatureStatus: 'verified' });
    Object.assign(second, { source: 'elsewhere', publishedAt: '2026-11-18T10:00:00.000Z', signatureStatus: 'trust-me' });
    const [parsedFirst, parsedSecond] = parseDashboardSummary(value).accounts[0].repositories[0].tasks;
    expect([parsedFirst.source, parsedFirst.publishedAt, parsedFirst.signatureStatus]).toEqual(['published', '2026-11-18T10:00:00.000Z', 'verified']);
    expect([parsedSecond.source, parsedSecond.publishedAt, parsedSecond.signatureStatus]).toEqual(['committed', null, 'unsigned']);
    const legacy = parseDashboardSummary(clone()).accounts[0].repositories[0].tasks;
    expect(legacy.map((task) => [task.source, task.signatureStatus])).toEqual([['committed', 'attached'], ['committed', 'unsigned']]);
    const invalid = clone();
    invalid.accounts[0].repositories[0].tasks[0].signatureStatus = 'invalid';
    expect(parseDashboardSummary(invalid).accounts[0].repositories[0].tasks[0].signatureStatus).toBe('invalid');
  });

  it('rejects malformed or unsafe payloads', () => {
    const cases: Array<(value: ReturnType<typeof clone>) => void> = [
      (value) => { value.schemaVersion = 2; },
      (value) => { value.accounts = {}; },
      (value) => { value.accounts[0].repositories[0].url = 'javascript:alert(1)'; },
      (value) => { value.accounts[0].repositories[0].pullRequests[0].url = 'https://evil.example/pull/1'; },
      (value) => { value.accounts[0].repositories[0].pullRequests[0].conclusion = 'maybe'; },
      (value) => { value.accounts[0].repositories[0].tasks[0].coveredPaths = -1; },
      (value) => { value.accounts[0].repositories[0].tasks[0] = 'x'; },
      (value) => { value.accounts[0] = null; },
      (value) => { value.accounts[0].repositories[0] = 3; },
      (value) => { value.accounts[0].repositories[0].pullRequests[0] = []; },
      (value) => { value.notes = [1]; },
    ];
    for (const mutate of cases) {
      const value = clone();
      mutate(value);
      expect(() => parseDashboardSummary(value)).toThrow(DashboardContractError);
    }
    expect(() => parseDashboardSummary(null)).toThrow(DashboardContractError);
  });

  it('formats durations and medians', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2])).toBe(2);
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(500)).toBe('500 ms');
    expect(formatDuration(45_000)).toBe('45 s');
    expect(formatDuration(900_000)).toBe('15 min');
    expect(formatDuration(5_400_000)).toBe('1 h 30 min');
  });

  it('keeps only github.com App installation links', () => {
    expect(parseDashboardSummary(clone()).installUrl).toBe('https://github.com/apps/forgeloop-evidence/installations/new');
    for (const unsafe of ['https://evil.example/apps/x', 'https://github.com.evil.example/apps/x', 'javascript:alert(1)', 'https://github.com/cassiomc1/forgeloop', 42]) {
      const value = clone() as Record<string, unknown>;
      value.installUrl = unsafe;
      expect(parseDashboardSummary(value).installUrl).toBeNull();
    }
    const value = clone() as Record<string, unknown>;
    delete value.installUrl;
    expect(parseDashboardSummary(value).installUrl).toBeNull();
  });

  it('defaults the viewer when absent', () => {
    const value = clone();
    delete value.viewer;
    expect(parseDashboardSummary(value).viewer).toEqual({ name: null, username: null });
  });
});

describe('hosted dashboard client', () => {
  const respond = (status: number, body: unknown = {}) => async () => new Response(JSON.stringify(body), { status });

  it('maps API states to explicit load results', async () => {
    expect((await loadDashboard(respond(200, clone()))).kind).toBe('ready');
    expect(await loadDashboard(respond(401))).toEqual({ kind: 'signin' });
    expect(await loadDashboard(respond(403))).toEqual({ kind: 'forbidden', account: null });
    expect(await loadDashboard(respond(403, { account: 'viewer@example.com' }))).toEqual({ kind: 'forbidden', account: 'viewer@example.com' });
    expect(await loadDashboard(async () => new Response('x', { status: 403 }))).toEqual({ kind: 'forbidden', account: null });
    expect(await loadDashboard(respond(503))).toEqual({ kind: 'unconfigured' });
    expect(await loadDashboard(respond(500))).toEqual({ kind: 'error', message: 'The dashboard API returned 500.' });
    expect((await loadDashboard(respond(200, { schemaVersion: 9 }))).kind).toBe('error');
    expect(await loadDashboard(async () => { throw new Error('offline'); })).toEqual({ kind: 'error', message: 'The dashboard API is unreachable.' });
    expect(await loadDashboard(async () => new Response('not json', { status: 200 }))).toMatchObject({ kind: 'error' });
  });
});

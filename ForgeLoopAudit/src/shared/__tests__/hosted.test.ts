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
    expect(await loadDashboard(respond(403))).toEqual({ kind: 'forbidden', userId: null });
    expect(await loadDashboard(respond(403, { userId: 'user_123' }))).toEqual({ kind: 'forbidden', userId: 'user_123' });
    expect(await loadDashboard(async () => new Response('x', { status: 403 }))).toEqual({ kind: 'forbidden', userId: null });
    expect(await loadDashboard(respond(503))).toEqual({ kind: 'unconfigured' });
    expect(await loadDashboard(respond(500))).toEqual({ kind: 'error', message: 'The dashboard API returned 500.' });
    expect((await loadDashboard(respond(200, { schemaVersion: 9 }))).kind).toBe('error');
    expect(await loadDashboard(async () => { throw new Error('offline'); })).toEqual({ kind: 'error', message: 'The dashboard API is unreachable.' });
    expect(await loadDashboard(async () => new Response('not json', { status: 200 }))).toMatchObject({ kind: 'error' });
  });
});

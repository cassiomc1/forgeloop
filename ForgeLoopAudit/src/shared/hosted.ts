// Hosted team dashboard contract. The hosted API (forgeloop-site) aggregates
// committed ForgeLoop evidence bundles and "ForgeLoop evidence" check runs
// across GitHub App installations; this module validates that JSON and derives
// display values. Everything here is self-reported evidence, never verification.

export type CheckConclusion = 'success' | 'failure' | 'neutral' | 'pending' | 'none';

export interface HostedPhaseDurations {
  planning?: number;
  executing?: number;
  verifying?: number;
  reviewing?: number;
}

export interface HostedTaskMetrics {
  completedAt: string | null;
  durationMs: number | null;
  phaseDurationsMs: HostedPhaseDurations;
  verificationCycles: number;
  diagnoses: number;
  checksPassed: number;
  checksFailed: number;
}

export interface HostedTask {
  taskId: string;
  objective: string | null;
  coveredPaths: number;
  signed: boolean;
  metrics: HostedTaskMetrics | null;
}

export interface HostedPullRequest {
  number: number;
  title: string;
  url: string;
  conclusion: CheckConclusion;
}

export interface HostedRepository {
  fullName: string;
  url: string;
  tasks: HostedTask[];
  invalidBundles: number;
  pullRequests: HostedPullRequest[];
  truncated: boolean;
}

export interface HostedAccount {
  login: string;
  repositories: HostedRepository[];
}

export interface DashboardSummary {
  schemaVersion: 1;
  generatedAt: string;
  viewer: { name: string | null; username: string | null };
  /** GitHub App installation page; null when the API does not provide one. */
  installUrl: string | null;
  accounts: HostedAccount[];
  notes: string[];
}

export interface DashboardTotals {
  repositories: number;
  tasks: number;
  signedTasks: number;
  invalidBundles: number;
  pullRequests: number;
  passingPullRequests: number;
  failingPullRequests: number;
  medianDurationMs: number | null;
  totalVerificationCycles: number;
  tasksWithRework: number;
}

export class DashboardContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DashboardContractError';
  }
}

const CONCLUSIONS = new Set<CheckConclusion>(['success', 'failure', 'neutral', 'pending', 'none']);

function fail(message: string): never {
  throw new DashboardContractError(message);
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, label: string): string => (typeof value === 'string' ? value : fail(`${label} must be a string`));
const optionalText = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const count = (value: unknown, label: string): number => (Number.isInteger(value) && (value as number) >= 0 ? (value as number) : fail(`${label} must be a non-negative integer`));
const optionalCount = (value: unknown): number | null => (Number.isInteger(value) && (value as number) >= 0 ? (value as number) : null);
const list = (value: unknown, label: string): unknown[] => (Array.isArray(value) ? value : fail(`${label} must be an array`));

function httpsUrl(value: unknown, label: string): string {
  const url = text(value, label);
  if (!url.startsWith('https://github.com/')) fail(`${label} must be a github.com URL`);
  return url;
}

function parseMetrics(value: unknown): HostedTaskMetrics | null {
  if (!isRecord(value)) return null;
  const phases: HostedPhaseDurations = {};
  const source = isRecord(value.phaseDurationsMs) ? value.phaseDurationsMs : {};
  for (const phase of ['planning', 'executing', 'verifying', 'reviewing'] as const) {
    const duration = optionalCount(source[phase]);
    if (duration !== null) phases[phase] = duration;
  }
  return {
    completedAt: optionalText(value.completedAt),
    durationMs: optionalCount(value.durationMs),
    phaseDurationsMs: phases,
    verificationCycles: optionalCount(value.verificationCycles) ?? 0,
    diagnoses: optionalCount(value.diagnoses) ?? 0,
    checksPassed: optionalCount(value.checksPassed) ?? 0,
    checksFailed: optionalCount(value.checksFailed) ?? 0,
  };
}

function parseTask(value: unknown): HostedTask {
  if (!isRecord(value)) fail('task must be an object');
  return {
    taskId: text(value.taskId, 'taskId'),
    objective: optionalText(value.objective),
    coveredPaths: count(value.coveredPaths, 'coveredPaths'),
    signed: value.signed === true,
    metrics: parseMetrics(value.metrics),
  };
}

function parsePullRequest(value: unknown): HostedPullRequest {
  if (!isRecord(value)) fail('pull request must be an object');
  const conclusion = CONCLUSIONS.has(value.conclusion as CheckConclusion) ? (value.conclusion as CheckConclusion) : fail('conclusion is unknown');
  return { number: count(value.number, 'number'), title: text(value.title, 'title'), url: httpsUrl(value.url, 'pull request url'), conclusion };
}

function parseRepository(value: unknown): HostedRepository {
  if (!isRecord(value)) fail('repository must be an object');
  return {
    fullName: text(value.fullName, 'fullName'),
    url: httpsUrl(value.url, 'repository url'),
    tasks: list(value.tasks, 'tasks').map(parseTask),
    invalidBundles: count(value.invalidBundles, 'invalidBundles'),
    pullRequests: list(value.pullRequests, 'pullRequests').map(parsePullRequest),
    truncated: value.truncated === true,
  };
}

const INSTALL_URL_PREFIX = 'https://github.com/apps/';

// Only a github.com App installation link is rendered; anything else is dropped.
function installUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith(INSTALL_URL_PREFIX)) return null;
  try {
    const url = new URL(value);
    return url.origin === 'https://github.com' && url.pathname.startsWith('/apps/') ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parseDashboardSummary(value: unknown): DashboardSummary {
  if (!isRecord(value) || value.schemaVersion !== 1) fail('Unsupported dashboard summary');
  const viewer = isRecord(value.viewer) ? value.viewer : {};
  return {
    schemaVersion: 1,
    generatedAt: text(value.generatedAt, 'generatedAt'),
    viewer: { name: optionalText(viewer.name), username: optionalText(viewer.username) },
    installUrl: installUrl(value.installUrl),
    accounts: list(value.accounts, 'accounts').map((account) => {
      if (!isRecord(account)) fail('account must be an object');
      return { login: text(account.login, 'login'), repositories: list(account.repositories, 'repositories').map(parseRepository) };
    }),
    notes: list(value.notes, 'notes').map((note) => text(note, 'note')),
  };
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function dashboardTotals(summary: DashboardSummary): DashboardTotals {
  const repositories = summary.accounts.flatMap((account) => account.repositories);
  const tasks = repositories.flatMap((repository) => repository.tasks);
  const pullRequests = repositories.flatMap((repository) => repository.pullRequests);
  const durations = tasks.map((task) => task.metrics?.durationMs).filter((value): value is number => typeof value === 'number');
  return {
    repositories: repositories.length,
    tasks: tasks.length,
    signedTasks: tasks.filter((task) => task.signed).length,
    invalidBundles: repositories.reduce((total, repository) => total + repository.invalidBundles, 0),
    pullRequests: pullRequests.length,
    passingPullRequests: pullRequests.filter((pull) => pull.conclusion === 'success').length,
    failingPullRequests: pullRequests.filter((pull) => pull.conclusion === 'failure').length,
    medianDurationMs: median(durations),
    totalVerificationCycles: tasks.reduce((total, task) => total + (task.metrics?.verificationCycles ?? 0), 0),
    tasksWithRework: tasks.filter((task) => (task.metrics?.verificationCycles ?? 0) > 1 || (task.metrics?.diagnoses ?? 0) > 0).length,
  };
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

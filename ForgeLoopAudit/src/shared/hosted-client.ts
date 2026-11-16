import { parseDashboardSummary, type DashboardSummary } from './hosted';

export type DashboardLoadResult =
  | { kind: 'ready'; summary: DashboardSummary }
  | { kind: 'signin' }
  | { kind: 'forbidden'; account: string | null }
  | { kind: 'unconfigured' }
  | { kind: 'error'; message: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const DASHBOARD_ENDPOINT = '/api/dashboard';

export async function loadDashboard(fetchImpl: FetchLike = fetch): Promise<DashboardLoadResult> {
  let response: Response;
  try {
    response = await fetchImpl(DASHBOARD_ENDPOINT, { credentials: 'same-origin', headers: { accept: 'application/json' } });
  } catch {
    return { kind: 'error', message: 'The dashboard API is unreachable.' };
  }
  if (response.status === 401) return { kind: 'signin' };
  if (response.status === 403) {
    const body: unknown = await response.json().catch(() => null);
    const account = body && typeof body === 'object' && typeof (body as { account?: unknown }).account === 'string' ? (body as { account: string }).account : null;
    return { kind: 'forbidden', account };
  }
  if (response.status === 503) return { kind: 'unconfigured' };
  if (!response.ok) return { kind: 'error', message: `The dashboard API returned ${response.status}.` };
  try {
    return { kind: 'ready', summary: parseDashboardSummary(await response.json()) };
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : 'Invalid dashboard response.' };
  }
}

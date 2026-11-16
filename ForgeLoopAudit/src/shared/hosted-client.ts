import { parseDashboardSummary, type DashboardSummary } from './hosted';

export type DashboardLoadResult =
  | { kind: 'ready'; summary: DashboardSummary }
  | { kind: 'signin' }
  | { kind: 'forbidden'; userId: string | null }
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
    const userId = body && typeof body === 'object' && typeof (body as { userId?: unknown }).userId === 'string' ? (body as { userId: string }).userId : null;
    return { kind: 'forbidden', userId };
  }
  if (response.status === 503) return { kind: 'unconfigured' };
  if (!response.ok) return { kind: 'error', message: `The dashboard API returned ${response.status}.` };
  try {
    return { kind: 'ready', summary: parseDashboardSummary(await response.json()) };
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : 'Invalid dashboard response.' };
  }
}

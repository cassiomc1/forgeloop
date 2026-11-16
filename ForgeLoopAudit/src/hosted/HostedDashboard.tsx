import { useEffect, useState } from 'react';
import { FolderGit2, GitPullRequest, ListChecks, LogIn, LogOut, Plus, RefreshCw, ShieldCheck, Timer } from 'lucide-react';
import { Badge, type BadgeVariant } from '../renderer/components/ui/badge';
import { Button } from '../renderer/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../renderer/components/ui/card';
import { EmptyState } from '../renderer/components/ui/EmptyState';
import { LoadingState } from '../renderer/components/ui/LoadingState';
import { MetricCard } from '../renderer/components/ui/MetricCard';
import { ThemeToggle } from '../renderer/components/ui/theme-toggle';
import { dashboardTotals, formatDuration, parseDashboardSummary, type CheckConclusion, type DashboardSummary, type HostedRepository } from '@shared/hosted';
import { loadDashboard, type DashboardLoadResult } from '@shared/hosted-client';
import demoSummary from './fixtures/dashboard-summary.json';

const CONCLUSION_BADGE: Record<CheckConclusion, { label: string; variant: BadgeVariant }> = {
  success: { label: 'Evidence passed', variant: 'success' },
  failure: { label: 'Evidence failed', variant: 'danger' },
  neutral: { label: 'Not enabled', variant: 'secondary' },
  pending: { label: 'Running', variant: 'warning' },
  none: { label: 'No check', variant: 'outline' },
};

const isDemo = () => new URLSearchParams(window.location.search).has('demo');

async function signOut() {
  await fetch('/api/auth/signout', { method: 'POST', credentials: 'same-origin' });
  window.location.assign('/dashboard/');
}

function StateMessage({ result, onRetry }: { result: Exclude<DashboardLoadResult, { kind: 'ready' }>; onRetry: () => void }) {
  if (result.kind === 'signin') {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <h2 className="text-xl font-semibold">Sign in to view your team's evidence</h2>
        <p className="max-w-md text-sm text-forge-text-secondary">Access is limited to allowlisted Google accounts. Evidence comes from repositories where the ForgeLoop Evidence GitHub App is installed.</p>
        <a className="btn-primary inline-flex items-center gap-2" href="/api/auth/authorize"><LogIn className="h-4 w-4" />Sign in with Google</a>
      </div>
    );
  }
  const copy = {
    forbidden: ['Access not granted', `Your Google account is signed in but not on this dashboard's allowlist.${result.kind === 'forbidden' && result.account ? ` Ask the owner to add ${result.account}, or sign out and use another account.` : ''}`],
    unconfigured: ['Dashboard not configured', 'The dashboard is waiting for its Sign in with Google and GitHub App settings.'],
    error: ['Could not load evidence', result.kind === 'error' ? result.message : ''],
  }[result.kind];
  return <EmptyState title={copy[0]} description={copy[1]} action={result.kind === 'error' ? { label: 'Retry', onClick: onRetry } : undefined} />;
}

function RepositoryCard({ repository }: { repository: HostedRepository }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <a className="hover:underline" href={repository.url} rel="noreferrer" target="_blank">{repository.fullName}</a>
          {repository.invalidBundles > 0 && <Badge variant="danger">{repository.invalidBundles} invalid bundle{repository.invalidBundles === 1 ? '' : 's'}</Badge>}
          {repository.truncated && <Badge variant="warning">Partial: limits reached</Badge>}
        </CardTitle>
        <CardDescription>{repository.tasks.length} task{repository.tasks.length === 1 ? '' : 's'} with committed evidence</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {repository.tasks.length === 0 ? (
          <p className="text-sm text-forge-text-secondary">No evidence bundles on the default branch yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-forge-text-secondary">
                <tr><th className="py-2 pr-4">Task</th><th className="py-2 pr-4">Files</th><th className="py-2 pr-4">Duration</th><th className="py-2 pr-4">Cycles</th><th className="py-2 pr-4">Checks</th><th className="py-2">Signature</th></tr>
              </thead>
              <tbody>
                {repository.tasks.map((task) => (
                  <tr className="border-t border-forge-border align-top" key={task.taskId}>
                    <td className="py-2 pr-4"><div className="font-mono text-xs">{task.taskId}</div>{task.objective && <div className="text-forge-text-secondary">{task.objective}</div>}</td>
                    <td className="py-2 pr-4">{task.coveredPaths}</td>
                    <td className="py-2 pr-4">{formatDuration(task.metrics?.durationMs ?? null)}</td>
                    <td className="py-2 pr-4">{task.metrics ? task.metrics.verificationCycles : '—'}</td>
                    <td className="py-2 pr-4">{task.metrics ? `${task.metrics.checksPassed} passed${task.metrics.checksFailed ? `, ${task.metrics.checksFailed} failed` : ''}` : '—'}</td>
                    <td className="py-2">{task.signed ? <Badge variant="success">Signature attached</Badge> : <Badge variant="secondary">Unsigned</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div>
          <h4 className="mb-2 text-sm font-semibold">Open pull requests</h4>
          {repository.pullRequests.length === 0 ? <p className="text-sm text-forge-text-secondary">No open pull requests.</p> : (
            <ul className="space-y-2">
              {repository.pullRequests.map((pull) => (
                <li className="flex flex-wrap items-center justify-between gap-2 text-sm" key={pull.number}>
                  <a className="hover:underline" href={pull.url} rel="noreferrer" target="_blank">#{pull.number} {pull.title}</a>
                  <Badge variant={CONCLUSION_BADGE[pull.conclusion].variant}>{CONCLUSION_BADGE[pull.conclusion].label}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function InstallAppLink({ url, primary = false }: { url: string; primary?: boolean }) {
  return (
    <a className={`${primary ? 'btn-primary' : 'btn-secondary'} inline-flex items-center gap-2`} href={url} rel="noreferrer" target="_blank">
      <Plus className="h-4 w-4" />Install GitHub App
    </a>
  );
}

function Dashboard({ summary }: { summary: DashboardSummary }) {
  const totals = dashboardTotals(summary);
  const repositories = summary.accounts.flatMap((account) => account.repositories);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Repositories" value={totals.repositories} icon={<FolderGit2 className="h-4 w-4" />} color="accent" />
        <MetricCard label="Tasks with evidence" value={`${totals.tasks} (${totals.signedTasks} with signature)`} icon={<ShieldCheck className="h-4 w-4" />} color="success" />
        <MetricCard label="PR evidence" value={`${totals.passingPullRequests} passed / ${totals.failingPullRequests} failed`} icon={<GitPullRequest className="h-4 w-4" />} color={totals.failingPullRequests ? 'warning' : 'info'} alert={totals.failingPullRequests > 0} />
        <MetricCard label="Median task duration" value={formatDuration(totals.medianDurationMs)} icon={<Timer className="h-4 w-4" />} color="info" />
      </div>
      <p className="flex items-center gap-2 text-sm text-forge-text-secondary">
        <ListChecks className="h-4 w-4" />
        {totals.tasks === 0 ? 'No tasks yet.' : `${totals.tasksWithRework} of ${totals.tasks} tasks needed rework (more than one verification cycle or a diagnosis).`}
      </p>
      {summary.notes.map((note) => <p className="text-xs text-forge-text-secondary" key={note}>{note}</p>)}
      {repositories.length === 0 ? (
        <div className="flex flex-col items-center gap-2">
          <EmptyState title="No repositories yet" description="Install the ForgeLoop Evidence GitHub App on an allowlisted account and choose the repositories to show here." />
          {summary.installUrl && <InstallAppLink url={summary.installUrl} primary />}
        </div>
      ) : repositories.map((repository) => <RepositoryCard key={repository.fullName} repository={repository} />)}
    </div>
  );
}

export function HostedDashboard() {
  const demo = isDemo();
  const [result, setResult] = useState<DashboardLoadResult | null>(null);
  const load = () => {
    setResult(null);
    if (demo) setResult({ kind: 'ready', summary: parseDashboardSummary(demoSummary) });
    else void loadDashboard().then(setResult);
  };
  useEffect(load, [demo]);
  const ready = result?.kind === 'ready' ? result.summary : null;
  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">ForgeLoop evidence {demo && <Badge variant="warning">Demo data</Badge>}</h1>
          <p className="text-sm text-forge-text-secondary">Team view of committed ForgeLoop evidence. Self-reported; signatures are verified by the ForgeLoop GitHub Action, not here.</p>
        </div>
        <div className="flex items-center gap-2">
          {ready?.installUrl && <InstallAppLink url={ready.installUrl} />}
          {ready?.viewer.username && <span className="text-sm text-forge-text-secondary">{ready.viewer.name ?? ready.viewer.username}</span>}
          <Button variant="ghost" size="icon" aria-label="Refresh" title="Refresh" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
          <ThemeToggle />
          {ready && !demo && <Button variant="ghost" onClick={() => void signOut()}><LogOut className="mr-2 h-4 w-4" />Sign out</Button>}
        </div>
      </header>
      {result === null ? <LoadingState /> : result.kind === 'ready' ? <Dashboard summary={result.summary} /> : <StateMessage result={result} onRetry={load} />}
    </div>
  );
}

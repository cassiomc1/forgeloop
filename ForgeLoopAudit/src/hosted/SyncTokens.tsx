import { useEffect, useState } from 'react';
import { Copy, KeyRound, Trash2 } from 'lucide-react';
import { Badge } from '../renderer/components/ui/badge';
import { Button } from '../renderer/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../renderer/components/ui/card';
import { issueSyncToken, listSyncTokens, revokeSyncToken, syncSetupCommands, type SyncTokenEntry } from '@shared/hosted-tokens';

// Cloud-sync token management. The issued token lives only in this
// component's state and disappears on reload; it is never persisted.
export function SyncTokens({ repositories, demo }: { repositories: string[]; demo: boolean }) {
  const [tokens, setTokens] = useState<SyncTokenEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [issued, setIssued] = useState<{ token: string; entry: SyncTokenEntry } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const result = await listSyncTokens();
    if (result.ok) { setTokens(result.value); setError(null); } else setError(result.message);
  };
  useEffect(() => { if (!demo) void refresh(); }, [demo]);

  const create = async () => {
    setBusy(true);
    const result = await issueSyncToken(name.trim(), selected);
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    setIssued(result.value);
    setName('');
    setSelected([]);
    setError(null);
    await refresh();
  };

  const revoke = async (entry: SyncTokenEntry) => {
    if (!window.confirm(`Revoke "${entry.name}"? Machines using it can no longer push or pull.`)) return;
    const result = await revokeSyncToken(entry.id);
    if (!result.ok) { setError(result.message); return; }
    if (issued?.entry.id === entry.id) setIssued(null);
    await refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" />Cloud sync tokens</CardTitle>
        <CardDescription>Tokens let <code>forgeloop sync-push</code> and <code>sync-pull</code> move a project&apos;s ForgeLoop state between machines. Only a hash is stored; each token is shown once.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {demo ? <p className="text-sm text-forge-text-secondary">Sign in to manage sync tokens. Demo mode never shows credentials.</p> : (
          <>
            {error && <p className="text-sm text-forge-danger" role="alert">{error}</p>}
            {issued && (
              <div className="space-y-2 rounded-md border border-forge-border p-3" role="status">
                <p className="text-sm font-semibold">Copy the token for &quot;{issued.entry.name}&quot; now. It is not shown again.</p>
                <pre className="overflow-x-auto whitespace-pre text-xs">{syncSetupCommands(issued.token)}</pre>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(issued.token)}><Copy className="mr-2 h-4 w-4" />Copy token</Button>
                  <Button variant="ghost" onClick={() => setIssued(null)}>Done</Button>
                </div>
              </div>
            )}
            <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void create(); }}>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Name</span>
                <input className="w-full rounded-md border border-forge-border bg-transparent px-3 py-2" maxLength={60} placeholder="e.g. laptop or ci" value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <fieldset className="text-sm">
                <legend className="mb-1 font-medium">Repositories</legend>
                {repositories.length === 0 ? <p className="text-forge-text-secondary">Install the GitHub App on a repository first.</p> : repositories.map((repo) => (
                  <label className="mr-4 inline-flex items-center gap-2" key={repo}>
                    <input type="checkbox" checked={selected.includes(repo)} onChange={(event) => setSelected(event.target.checked ? [...selected, repo] : selected.filter((item) => item !== repo))} />
                    {repo}
                  </label>
                ))}
              </fieldset>
              <Button type="submit" disabled={busy || !name.trim() || selected.length === 0}>Issue token</Button>
            </form>
            {tokens === null ? <p className="text-sm text-forge-text-secondary">Loading tokens…</p> : tokens.length === 0 ? <p className="text-sm text-forge-text-secondary">No sync tokens yet.</p> : (
              <ul className="space-y-2">
                {tokens.map((entry) => (
                  <li className="flex flex-wrap items-center justify-between gap-2 text-sm" key={entry.id}>
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="font-medium">{entry.name}</span>
                      {entry.repos.map((repo) => <Badge className="ml-1" key={repo} variant="outline">{repo}</Badge>)}
                      <span className="ml-2 text-forge-text-secondary">{entry.createdBy ?? 'unknown'} · {entry.createdAt ? new Date(entry.createdAt).toLocaleDateString() : '—'}</span>
                    </div>
                    <Button variant="ghost" size="sm" aria-label={`Revoke ${entry.name}`} onClick={() => void revoke(entry)}><Trash2 className="mr-1 h-4 w-4" />Revoke</Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

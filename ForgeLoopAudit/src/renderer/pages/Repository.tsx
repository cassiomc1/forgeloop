import { useCallback, useEffect, useState } from 'react';
import type { RepositoryIndexProjection, RepositorySearchResult } from '@shared/domain';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { auditApi } from '../lib/audit-client';

export function Repository() {
  const [status, setStatus] = useState<RepositoryIndexProjection | null>(null);
  const [result, setResult] = useState<RepositorySearchResult | null>(null);
  const [pattern, setPattern] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await auditApi.getRepositoryIndexStatus());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Repository Index status is unavailable.');
    }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  async function search() {
    const query = pattern.trim();
    if (!query) {
      setMessage('Enter a search pattern.');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      setResult(await auditApi.searchRepository({ pattern: query, fixedStrings: true, stats: true, maxCount: 200 }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Repository search failed.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-forge-text-primary">Repository Search</h1>
          <p className="text-sm text-forge-text-muted mt-1">Use ForgeLoop’s negotiated Repository Index/Search capability for bounded discovery.</p>
        </div>
        <Badge variant="outline">Discovery only</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Search the selected repository</CardTitle>
          <CardDescription>Results are advisory discovery context. They are never canonical audit evidence or lifecycle authority.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void search(); }}>
            <Input aria-label="Repository search pattern" value={pattern} onChange={(event) => setPattern(event.target.value)} placeholder="Search code, task IDs, or protocol fields" />
            <Button type="submit" disabled={loading}>{loading ? 'Searching…' : 'Search'}</Button>
          </form>
          {message && <p className="mt-3 text-sm text-forge-warning">{message}</p>}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card><CardContent className="p-5"><p className="text-xs uppercase tracking-wider text-muted-foreground">Index health</p><p className="mt-2 text-lg font-semibold text-foreground">{status?.health ?? 'Loading'}</p></CardContent></Card>
        <Card><CardContent className="p-5"><p className="text-xs uppercase tracking-wider text-muted-foreground">Engine</p><p className="mt-2 font-mono text-sm text-foreground">{status?.engine ?? 'Unavailable'}</p><p className="mt-1 text-xs text-muted-foreground">{status?.engineVersion ?? 'No version reported'}</p></CardContent></Card>
        <Card><CardContent className="p-5"><p className="text-xs uppercase tracking-wider text-muted-foreground">Indexed files</p><p className="mt-2 text-lg font-semibold text-foreground">{status?.index.files ?? '—'}</p><p className="mt-1 text-xs text-muted-foreground">{status?.index.complete ? 'Complete index' : 'Completeness not verified'}</p></CardContent></Card>
      </div>

      {status?.diagnostics.length ? <Card><CardContent className="p-5"><p className="text-sm font-semibold text-foreground">Index diagnostics</p><ul className="mt-3 space-y-2 text-sm text-muted-foreground">{status.diagnostics.map((diagnostic) => <li key={`${diagnostic.code}-${diagnostic.message}`}><span className="font-mono text-foreground">{diagnostic.code}</span> — {diagnostic.message}</li>)}</ul></CardContent></Card> : null}

      {result && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Search results</CardTitle>
                <CardDescription>{result.metrics?.matchCount ?? result.matches.length} matches across {result.metrics?.matchedFileCount ?? result.files.length} files.</CardDescription>
              </div>
              <Badge variant="secondary">{result.trust}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {result.matches.length === 0 ? <p className="text-sm text-muted-foreground">No matches found.</p> : <div className="space-y-2">{result.matches.map((match, index) => <div key={`${match.path}-${match.line}-${index}`} className="rounded-lg border border-border bg-muted/30 p-3"><p className="font-mono text-xs text-foreground">{match.path}:{match.line}{match.column ? `:${match.column}` : ''}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{match.text}</p></div>)}</div>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

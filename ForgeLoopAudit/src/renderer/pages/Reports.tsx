import { useState } from 'react';
import type { ProjectAuditSnapshot } from '@shared/audit';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { auditApi } from '../lib/audit-client';

export function Reports({ audit, onRefreshAudit }: { audit: ProjectAuditSnapshot | null; onRefreshAudit: () => void }) {
  const [format, setFormat] = useState<'JSON' | 'MARKDOWN' | 'SARIF'>('MARKDOWN');
  const [message, setMessage] = useState('');

  const exportReport = async () => {
    try {
      const result = await auditApi.exportAuditReport({ format, destinationPath: 'managed-by-local-server' });
      setMessage(`Exported ${result.format} report (${result.bytes} bytes) to the managed application export directory.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Report export failed.');
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-xl font-semibold text-forge-text-primary">Reports</h1>
        <p className="text-sm text-forge-text-muted mt-1">Deterministic reports generated from already-read audit data.</p>
      </div>
      {!audit ? (
        <Card className="border-forge-warning/30 bg-forge-warning/10">
          <CardContent className="p-5">
            <p className="text-sm text-forge-warning">No current audit loaded.</p>
            <Button variant="outline" className="mt-3" onClick={onRefreshAudit}>Run audit</Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Export an audit report</CardTitle>
                <CardDescription className="mt-2">The local web host chooses a private application-data destination for every export.</CardDescription>
              </div>
              <Badge variant="outline">Managed storage</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block text-sm text-forge-text-secondary">
              Format
              <select className="input mt-1" value={format} onChange={(event) => setFormat(event.target.value as typeof format)}>
                <option>MARKDOWN</option>
                <option>JSON</option>
                <option>SARIF</option>
              </select>
            </label>
            <p className="text-xs text-forge-text-muted">Reports include ForgeLoop provenance, audit rules, timestamp, HEAD, fingerprint and [C]/[D]/[A] trust labels. The audited .forgeloop directory is protected by default. Browser clients cannot choose arbitrary host paths.</p>
            <Button onClick={exportReport}>Export report</Button>
            {message && <p className="text-sm text-forge-text-secondary">{message}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

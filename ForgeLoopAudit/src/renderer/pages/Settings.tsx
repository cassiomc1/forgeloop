import { useEffect, useState } from 'react';
import { Settings as SettingsIcon, Monitor, Moon, Sun, Code, Palette } from 'lucide-react';
import { cn } from '../lib/utils';
import type { ForgeLoopFeatureSupport, ProjectDetectionResult, ProjectSnapshot, WatcherStatus } from '@shared/domain';
import { ProjectInformation } from '../components/project/ProjectInformation';
import { auditApi } from '../lib/audit-client';
import { useTheme, type Theme } from '../lib/theme';

const FEATURE_LABELS: Array<[keyof ForgeLoopFeatureSupport, string]> = [
  ['canonicalOwnership', 'Canonical ownership'],
  ['observability', 'Structured observability'],
  ['structuredDiagnostics', 'Structured diagnostics'],
  ['durableActions', 'Durable actions'],
  ['approvals', 'Approvals'],
  ['capabilityPolicy', 'Capability policy'],
  ['trajectoryMetrics', 'Trajectory metrics'],
  ['trajectoryEvaluations', 'Trajectory evaluations'],
  ['verificationExecutionIsolation', 'Verification isolation'],
  ['workspaceBinding', 'Workspace binding'],
  ['canonicalHandoffs', 'Canonical handoffs'],
  ['advisoryContextProviders', 'Advisory context providers'],
  ['responsibilityConstraints', 'Responsibility constraints'],
  ['differentialVerificationScope', 'Differential verification scope'],
  ['codeAttestation', 'Code attestation'],
  ['adaptiveExecutionProfiles', 'Adaptive execution profiles'],
  ['executionProfileContext', 'Execution profile context'],
  ['contextUsageObservability', 'Context usage observability'],
  ['repositoryIndex', 'Repository Index/Search'],
  ['auditUx', 'Audit UX read model'],
  ['providerExtensions', 'Provider extensions (observation only)'],
];

interface SettingsProps {
  snapshot?: ProjectSnapshot;
  detection?: ProjectDetectionResult | null;
  watcherStatus?: WatcherStatus;
}

export function Settings({ snapshot, detection, watcherStatus }: SettingsProps) {
  const api = auditApi;
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState({
    uiDensity: 'comfortable',
    reduceMotion: 'system',
    reopenLastProject: true,
    showTechnicalHashes: false,
    eventTimeFormat: 'relative',
    showRawArtifacts: false,
  });
  const [diagnosticsMessage, setDiagnosticsMessage] = useState('');
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    api.getAppVersion().then(setAppVersion).catch(() => setAppVersion(null));
  }, [api]);

  async function copyDiagnostics() {
    const diagnostics = await api.getDiagnostics();
    await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
    setDiagnosticsMessage('Diagnostics copied locally');
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-semibold text-forge-text-primary">Settings</h1>
        <p className="text-sm text-forge-text-muted mt-1">Application preferences</p>
      </div>

      {snapshot && <ProjectInformation snapshot={snapshot} detection={detection} watcherStatus={watcherStatus} />}

      <div className="space-y-6">
        <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
          <h3 className="text-sm font-semibold text-forge-text-primary mb-4 flex items-center gap-2">
            <Palette className="w-4 h-4 text-forge-text-muted" />
            Appearance
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-forge-text-secondary">Theme</p>
                <p className="text-xs text-forge-text-muted">Select application theme</p>
              </div>
              <div className="flex items-center gap-2">
                {[
                  { value: 'dark', icon: <Moon className="w-4 h-4" />, label: 'Dark' },
                  { value: 'light', icon: <Sun className="w-4 h-4" />, label: 'Light' },
                  { value: 'system', icon: <Monitor className="w-4 h-4" />, label: 'System' },
                ].map((themeOption) => (
                  <button
                    key={themeOption.value}
                    className={cn(
                      'flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-6 transition-colors',
                      theme === themeOption.value
                        ? 'bg-forge-accent/10 text-forge-accent'
                        : 'text-forge-text-muted hover:bg-forge-hover-surface hover:text-forge-text-primary'
                    )}
                    onClick={() => setTheme(themeOption.value as Theme)}
                  >
                    {themeOption.icon}
                    {themeOption.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-forge-text-secondary">UI Density</p>
                <p className="text-xs text-forge-text-muted">Adjust spacing and sizing</p>
              </div>
              <div className="flex items-center gap-2">
                {['comfortable', 'compact'].map((density) => (
                  <button
                    key={density}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium rounded-6 transition-colors',
                      settings.uiDensity === density
                        ? 'bg-forge-accent/10 text-forge-accent'
                        : 'text-forge-text-muted hover:bg-forge-hover-surface hover:text-forge-text-primary'
                    )}
                    onClick={() => setSettings({ ...settings, uiDensity: density })}
                  >
                    {density.charAt(0).toUpperCase() + density.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-forge-text-secondary">Reduce Motion</p>
                <p className="text-xs text-forge-text-muted">Minimize animations</p>
              </div>
              <select
                className="input w-32"
                value={settings.reduceMotion}
                onChange={(e) => setSettings({ ...settings, reduceMotion: e.target.value })}
              >
                <option value="system">System</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </div>
          </div>
        </div>

        <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
          <h3 className="text-sm font-semibold text-forge-text-primary mb-2">Privacy-safe diagnostics</h3>
          <p className="text-xs text-forge-text-muted mb-3">Only allowlisted runtime facts are copied; project contents and environment variables are excluded.</p>
          <button className="btn-secondary" onClick={copyDiagnostics}>Copy diagnostics</button>
          {diagnosticsMessage && <span className="ml-3 text-xs text-forge-text-muted">{diagnosticsMessage}</span>}
        </div>

        <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
          <h3 className="text-sm font-semibold text-forge-text-primary mb-4 flex items-center gap-2">
            <SettingsIcon className="w-4 h-4 text-forge-text-muted" />
            Behavior
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-forge-text-secondary">Reopen Last Project</p>
                <p className="text-xs text-forge-text-muted">Automatically open the last project on launch</p>
              </div>
              <button
                className={cn(
                  'w-10 h-6 rounded-full transition-colors',
                  settings.reopenLastProject ? 'bg-forge-accent' : 'bg-forge-border-strong'
                )}
                onClick={() => setSettings({ ...settings, reopenLastProject: !settings.reopenLastProject })}
              >
                <span className={cn(
                  'block w-4 h-4 rounded-full bg-white transform transition-transform',
                  settings.reopenLastProject ? 'translate-x-5' : 'translate-x-1'
                )} />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-forge-text-secondary">Event Time Format</p>
                <p className="text-xs text-forge-text-muted">How to display event timestamps</p>
              </div>
              <select
                className="input w-32"
                value={settings.eventTimeFormat}
                onChange={(e) => setSettings({ ...settings, eventTimeFormat: e.target.value })}
              >
                <option value="relative">Relative</option>
                <option value="absolute">Absolute</option>
                <option value="utc">UTC</option>
              </select>
            </div>
          </div>
        </div>

        <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
          <h3 className="text-sm font-semibold text-forge-text-primary mb-4 flex items-center gap-2">
            <Code className="w-4 h-4 text-forge-text-muted" />
            Developer
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-forge-text-secondary">Show Technical Hashes</p>
                <p className="text-xs text-forge-text-muted">Display full hash values</p>
              </div>
              <button
                className={cn(
                  'w-10 h-6 rounded-full transition-colors',
                  settings.showTechnicalHashes ? 'bg-forge-accent' : 'bg-forge-border-strong'
                )}
                onClick={() => setSettings({ ...settings, showTechnicalHashes: !settings.showTechnicalHashes })}
              >
                <span className={cn(
                  'block w-4 h-4 rounded-full bg-white transform transition-transform',
                  settings.showTechnicalHashes ? 'translate-x-5' : 'translate-x-1'
                )} />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-forge-text-secondary">Show Raw Protocol Artifacts</p>
                <p className="text-xs text-forge-text-muted">Enable raw JSON view for artifacts</p>
              </div>
              <button
                className={cn(
                  'w-10 h-6 rounded-full transition-colors',
                  settings.showRawArtifacts ? 'bg-forge-accent' : 'bg-forge-border-strong'
                )}
                onClick={() => setSettings({ ...settings, showRawArtifacts: !settings.showRawArtifacts })}
              >
                <span className={cn(
                  'block w-4 h-4 rounded-full bg-white transform transition-transform',
                  settings.showRawArtifacts ? 'translate-x-5' : 'translate-x-1'
                )} />
              </button>
            </div>
          </div>
        </div>

        <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
          <h3 className="text-sm font-semibold text-forge-text-primary mb-4">About</h3>
          <div className="space-y-2 text-sm text-forge-text-secondary">
            <p>ForgeLoopAudit {appVersion ? `v${appVersion}` : ''}</p>
            <p className="text-xs text-forge-text-muted">
              A read-only engineering auditor for ForgeLoop projects.
            </p>
            <p className="text-xs text-forge-text-muted">
              Read-only observer mode. ForgeLoop remains the source of truth.
            </p>
          </div>
        </div>

        <div className="bg-forge-primary-surface border border-forge-border-subtle rounded-10 p-4">
          <h3 className="text-sm font-semibold text-forge-text-primary mb-4">ForgeLoop protocol</h3>
          <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
            <div><p className="text-forge-text-muted">Package</p><p className="mt-1 font-mono text-forge-text-primary">{snapshot?.protocol.packageVersion || detection?.forgeLoopVersion || 'Unknown'}</p></div>
            <div><p className="text-forge-text-muted">Protocol</p><p className="mt-1 font-mono text-forge-text-primary">v{snapshot?.protocol.protocolVersion ?? detection?.protocolVersion ?? 'Unknown'}</p></div>
            <div><p className="text-forge-text-muted">Schema</p><p className="mt-1 font-mono text-forge-text-primary">v{snapshot?.protocol.schemaVersion ?? detection?.schemaVersion ?? 'Unknown'}</p></div>
            <div><p className="text-forge-text-muted">Compatibility</p><p className="mt-1 font-mono text-forge-text-primary">{snapshot?.protocol.compatibilityMode || (snapshot?.protocol.compatible ? 'COMPATIBLE' : 'UNKNOWN')}</p></div>
          </div>
          <p className="mt-4 text-xs text-forge-text-muted">ForgeLoop remains the source of truth. Protocol settings are read-only here; ForgeLoopAudit does not execute or edit project checkers, bindings, responsibilities, or attestation policy.</p>
          {snapshot?.protocol.featureSupport && <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">{FEATURE_LABELS.map(([key, label]) => {
            const supported = snapshot.protocol.featureSupport?.[key] === true;
            const value = key === 'advisoryContextProviders'
              ? supported
                ? 'Status: Supported by ForgeLoop / Host-provided / Not loaded by ForgeLoopAudit'
                : 'Not advertised'
              : key === 'providerExtensions'
                ? supported
                  ? 'Supported / observation metadata only / never invoked by ForgeLoopAudit'
                  : 'Not advertised'
                : key === 'auditUx'
                  ? supported
                    ? 'Supported / read-only canonical projection'
                    : 'Not advertised'
                  : supported ? 'Supported' : 'Unavailable';
            return <div key={key} className="flex items-center justify-between gap-3 rounded-8 bg-forge-secondary-surface px-3 py-2 text-xs"><span className="text-forge-text-secondary">{label}</span><span className={supported ? 'text-forge-success' : 'text-forge-text-muted'}>{value}</span></div>;
          })}</div>}
        </div>
      </div>
    </div>
  );
}

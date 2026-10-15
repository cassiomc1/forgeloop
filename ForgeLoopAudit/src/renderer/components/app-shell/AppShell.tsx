import { useState } from 'react';
import type { NavItemId } from '@renderer/App';
import type { WatcherStatus } from '@shared/domain';
import { FolderOpen, ChevronLeft, ChevronRight, X, GitBranch } from 'lucide-react';
import { clsx } from 'clsx';
import { NAV_ITEMS } from '@renderer/App';
import { TitleBar } from './TitleBar';
import { DemoProjectBanner } from '@renderer/components/demo/DemoProjectBanner';

interface AppShellProps {
  projectName: string;
  isDemoProject?: boolean;
  branch?: string;
  head?: string;
  protocolVersion: number;
  health: string;
  watcherStatus: WatcherStatus;
  activeNav: NavItemId;
  onNavChange: (nav: NavItemId) => void;
  sidebarCollapsed: boolean;
  onSidebarToggle: () => void;
  onCloseProject: () => void;
  navItems: typeof NAV_ITEMS;
  taskDetailItems: readonly { id: NavItemId; label: string; icon: string }[];
  selectedTaskId: string | null;
  isLoading: boolean;
  error?: { message: string; details?: string; code: string } | null;
  children: React.ReactNode;
}

const NAV_ICONS: Record<string, React.ReactNode> = {
  'layout-dashboard': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  ),
  'timeline': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeWidth={2} d="M6 4v16M6 8h8a4 4 0 010 8H6m8-8v-4m0 4v4" />
      <circle cx="6" cy="4" r="2" strokeWidth={2} />
      <circle cx="6" cy="20" r="2" strokeWidth={2} />
    </svg>
  ),
  'list-check': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
  'git-branch': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1m4 0h1M5 12h1m4 0h1m-9 4h1m4 0h1M5 8h1m4 0h1m0 8h1M5 4h1m4 0h1" />
    </svg>
  ),
  'file-text': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  'clipboard-check': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
  'history': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  'repeat': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  ),
  'activity': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12h4l2-8 4 16 2-8h6" />
    </svg>
  ),
  'shield': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  ),
  'zap': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
  'settings': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  'search': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="7" strokeWidth={2} />
      <path strokeLinecap="round" strokeWidth={2} d="m20 20-4-4" />
    </svg>
  ),
  'folder': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  ),
  'kanban': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="5" height="16" rx="1" strokeWidth={2} />
      <rect x="10" y="4" width="5" height="10" rx="1" strokeWidth={2} />
      <rect x="17" y="4" width="4" height="13" rx="1" strokeWidth={2} />
    </svg>
  ),
};

export function AppShell({
  projectName,
  isDemoProject,
  branch,
  head,
  protocolVersion,
  health,
  watcherStatus,
  activeNav,
  onNavChange,
  sidebarCollapsed,
  onSidebarToggle,
  onCloseProject,
  navItems,
  taskDetailItems,
  selectedTaskId,
  isLoading,
  error,
  children,
}: AppShellProps) {
  const [, setShowCloseConfirm] = useState(false);

  const getHealthColor = (status: string) => {
    switch (status) {
      case 'VALID': return 'text-forge-success';
      case 'INCOMPLETE': return 'text-forge-warning';
      case 'STALE': return 'text-forge-warning';
      case 'INCONSISTENT': return 'text-forge-danger';
      case 'INVALID': return 'text-forge-danger';
      default: return 'text-forge-text-muted';
    }
  };

  const getHealthIcon = (status: string) => {
    switch (status) {
      case 'VALID': return <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>;
      case 'INCOMPLETE':
      case 'STALE': return <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>;
      case 'INCONSISTENT':
      case 'INVALID': return <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>;
      default: return <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" /></svg>;
    }
  };

  return (
    <div className="flex h-screen w-full flex-col forge-background overflow-hidden">
      <TitleBar projectName={projectName} />

      <div className="flex flex-1 overflow-hidden">
      <aside
        className={clsx(
          'flex flex-col forge-primary-surface border-r forge-border-subtle transition-all duration-200',
          sidebarCollapsed ? 'w-16' : 'w-64'
        )}
      >
        <div className="flex h-10 items-center justify-end px-3">
          <button
            className="p-1.5 rounded-6 text-forge-text-muted hover:bg-forge-hover-surface hover:text-forge-text-primary transition-colors"
            onClick={onSidebarToggle}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
          </button>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto" role="navigation" aria-label="Main navigation">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={clsx(
                'w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-8 transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forge-accent focus-visible:ring-offset-2 focus-visible:ring-offset-forge-primary-surface',
                activeNav === item.id
                  ? 'bg-forge-accent/10 text-forge-accent'
                  : 'text-forge-text-secondary hover:bg-forge-hover-surface hover:text-forge-text-primary'
              )}
              onClick={() => onNavChange(item.id)}
              aria-current={activeNav === item.id ? 'page' : undefined}
              title={sidebarCollapsed ? item.label : undefined}
            >
              {NAV_ICONS[item.icon]}
              {!sidebarCollapsed && <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        {selectedTaskId && (
          <div className="border-t forge-border-subtle px-2 py-3">
            {!sidebarCollapsed && <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-forge-text-muted">Task detail · {selectedTaskId}</p>}
            <nav className="space-y-1" role="navigation" aria-label="Task detail navigation">
              {taskDetailItems.map((item) => (
                <button
                  key={item.id}
                  className={clsx(
                    'w-full flex items-center gap-3 px-3 py-1.5 text-xs font-medium rounded-8 transition-colors duration-150',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forge-accent focus-visible:ring-offset-2 focus-visible:ring-offset-forge-primary-surface',
                    activeNav === item.id
                      ? 'bg-forge-accent/10 text-forge-accent'
                      : 'text-forge-text-muted hover:bg-forge-hover-surface hover:text-forge-text-primary'
                  )}
                  onClick={() => onNavChange(item.id)}
                  aria-current={activeNav === item.id ? 'page' : undefined}
                  title={sidebarCollapsed ? item.label : undefined}
                >
                  {NAV_ICONS[item.icon]}
                  {!sidebarCollapsed && <span>{item.label}</span>}
                </button>
              ))}
            </nav>
          </div>
        )}

        <div className="p-3 border-t forge-border-subtle">
          <button
            className={clsx(
              'w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-8 transition-colors duration-150',
              'text-forge-text-secondary hover:bg-forge-hover-surface hover:text-forge-text-primary'
            )}
            onClick={onCloseProject}
            title={sidebarCollapsed ? 'Close project' : undefined}
          >
            <FolderOpen className="w-5 h-5" />
            {!sidebarCollapsed && <span>Close Project</span>}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-12 flex items-center justify-between px-4 border-b forge-border-subtle forge-primary-surface">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            {branch && (
              <span className="flex items-center gap-1.5 px-2 py-1 text-xs font-mono text-forge-text-muted bg-forge-secondary-surface rounded-6">
                <GitBranch className="w-3.5 h-3.5" />
                {branch}
              </span>
            )}
            {head && (
              <span className="px-2 py-1 text-xs font-mono text-forge-text-muted bg-forge-secondary-surface rounded-6">
                {head}
              </span>
            )}
          </div>

          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-6 bg-forge-secondary-surface">
              <span className="text-forge-text-muted">Protocol</span>
              <span className="font-mono text-forge-text-primary">v{protocolVersion}</span>
            </span>

            <span className={clsx('flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-6', getHealthColor(health))}>
              {getHealthIcon(health)}
              <span className="uppercase tracking-wider">{health}</span>
            </span>

            <span className={clsx('flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-6',
              watcherStatus.error ? 'bg-forge-danger/10 text-forge-danger' : watcherStatus.active ? 'bg-forge-success/10 text-forge-success' : 'bg-forge-border-subtle text-forge-text-muted'
            )} title={watcherStatus.error || (watcherStatus.lastEventType && watcherStatus.lastEventAt ? `Last monitored change: ${watcherStatus.lastEventType} at ${new Date(watcherStatus.lastEventAt).toLocaleTimeString()}` : 'Watching ForgeLoop project files')} aria-label={`File watcher: ${watcherStatus.error ? 'error' : watcherStatus.active ? 'live' : 'paused'}`}>
              <span className={clsx('w-1.5 h-1.5 rounded-full', watcherStatus.error ? 'bg-forge-danger' : watcherStatus.active ? 'bg-forge-success animate-pulse-subtle' : 'bg-forge-border-strong')} />
              <span>{watcherStatus.error ? 'Error' : watcherStatus.active ? 'Live' : 'Paused'}</span>
            </span>

            {watcherStatus.lastEventType && watcherStatus.lastEventAt && (
              <span className="hidden xl:inline text-[11px] text-forge-text-muted" title={watcherStatus.lastEventType}>
                Last change {new Date(watcherStatus.lastEventAt).toLocaleTimeString()}
              </span>
            )}

            {isLoading && (
              <svg className="w-5 h-5 text-forge-accent animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
          </div>
        </header>

        {isDemoProject && <DemoProjectBanner />}

        <main className="flex-1 overflow-auto p-4 md:p-6">
          {error && (
            <div className="mb-4 p-3 bg-forge-danger/10 border border-forge-danger/20 rounded-8 flex items-center justify-between animate-fade-in">
              <div className="flex items-center gap-2 text-sm text-forge-danger">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                <span>{error.message}</span>
              </div>
              <button className="p-1 text-forge-text-muted hover:text-forge-text-primary" onClick={() => setShowCloseConfirm(true)}>
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          {children}
        </main>
      </div>
      </div>
    </div>
  );
}

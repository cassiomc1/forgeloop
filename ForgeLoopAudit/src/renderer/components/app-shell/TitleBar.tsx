import { clsx } from 'clsx';
import { auditApi } from '../../lib/audit-client';
import { ThemeToggle } from '../ui/theme-toggle';
import { Menu } from 'lucide-react';

interface TitleBarProps {
  projectName?: string;
  className?: string;
  children?: React.ReactNode;
  navigationOpen?: boolean;
  onNavigationToggle?: () => void;
}

export function TitleBar({ projectName, className, children, navigationOpen, onNavigationToggle }: TitleBarProps) {
  const handleDoubleClick = () => {
    void auditApi.toggleMaximizeWindow().catch(() => undefined);
  };

  return (
    <div
      className={clsx(
        'audit-titlebar app-drag-region relative flex h-14 shrink-0 items-center gap-3 px-4 sm:px-6 border-b forge-border-subtle forge-primary-surface select-none',
        className
      )}
      onDoubleClick={handleDoubleClick}
    >
      {onNavigationToggle && (
        <button
          type="button"
          className="audit-mobile-menu app-no-drag"
          aria-label="Open navigation"
          aria-expanded={navigationOpen}
          aria-controls="audit-navigation"
          onClick={onNavigationToggle}
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
      )}
      <div className="flex items-center gap-2 pointer-events-none">
        <div className="w-7 h-7 rounded-8 bg-forge-accent flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        </div>
        <span className="text-sm font-semibold text-forge-text-primary whitespace-nowrap">ForgeLoopAudit</span>
      </div>

      {projectName && (
        <>
          <span className="w-px h-4 bg-forge-border-strong" />
          <span className="text-sm text-forge-text-secondary truncate">{projectName}</span>
        </>
      )}

      <div className="app-no-drag flex items-center gap-2 ml-auto min-w-0">
        <ThemeToggle />
        {children}
      </div>
    </div>
  );
}

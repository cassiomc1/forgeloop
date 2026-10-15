import { AlertCircle } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="empty-state animate-fade-in">
      <div className="empty-state-icon">
        {icon || (
          <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
      </div>
      <p className="empty-state-title">{title}</p>
      {description && <p className="empty-state-description">{description}</p>}
      {action && (
        <button className="btn-primary mt-4" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

export function NoProjectState({ onOpenProject }: { onOpenProject: () => void }) {
  return (
    <EmptyState
      title="No ForgeLoop project selected"
      description="Select a project directory containing a .forgeloop folder to begin visualizing your engineering loop."
      action={{ label: 'Open Project', onClick: onOpenProject }}
      icon={
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      }
    />
  );
}

export function NoTasksState({ onCreateTask }: { onCreateTask?: () => void }) {
  return (
    <EmptyState
      title="No ForgeLoop tasks yet"
      description="Create a task using the ForgeLoop CLI and it will appear here automatically."
      action={onCreateTask ? { label: 'Create Task', onClick: onCreateTask } : undefined}
      icon={
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      }
    />
  );
}

export function NoEventsState() {
  return (
    <EmptyState
      title="No lifecycle events recorded"
      description="Events will appear here as the task progresses through the ForgeLoop lifecycle."
      icon={
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      }
    />
  );
}

export function NoEvidenceState() {
  return (
    <EmptyState
      title="No verification evidence recorded"
      description="Evidence will appear here as verification checks are executed and recorded."
      icon={
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      }
    />
  );
}

export function UnsupportedProtocolState({ protocolVersion }: { protocolVersion: number }) {
  return (
    <EmptyState
      title="Unsupported protocol version"
      description={`This project uses ForgeLoop protocol version ${protocolVersion}, which is not supported by this version of ForgeLoopAudit.`}
      icon={
        <AlertCircle className="w-12 h-12 text-forge-danger" />
      }
    />
  );
}

export function ErrorState({ message, details, onRetry }: { message: string; details?: string; onRetry?: () => void }) {
  return (
    <div className="error-state animate-fade-in">
      <AlertCircle className="w-12 h-12 mb-3" />
      <p className="text-sm font-medium text-forge-danger mb-1">{message}</p>
      {details && <p className="text-xs text-forge-text-muted max-w-xs mb-4">{details}</p>}
      {onRetry && (
        <button className="btn-primary" onClick={onRetry}>
          Try Again
        </button>
      )}
    </div>
  );
}
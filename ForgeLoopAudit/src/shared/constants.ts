export const FORGELOOP_DIR_NAME = '.forgeloop';
export const CONFIG_FILE = 'config.json';
export const SOURCES_FILE = 'sources.json';
export const MANIFEST_FILE = 'manifest.json';
export const LEGACY_MANIFEST_FILE = '.manifest.json';
export const TASK_STATE_DIR = 'task-state';
export const SESSIONS_DIR = 'sessions';
export const POLICY_DIR = 'policy';
export const GATES_DIR = 'gates';
export const EXECUTIONS_DIR = 'executions';

export const PROTOCOL_INFO_COMMAND = ['protocol-info', '--json'];
export const TASK_LIST_COMMAND = ['task-list', '--json'];
export const TASK_SHOW_COMMAND = ['task-show', '--json'];
export const STATUS_COMMAND = ['status', '--json'];
export const PROGRESS_COMMAND = ['progress', '--json'];
export const CONTINUITY_COMMAND = ['continuity', '--json'];
export const NEXT_COMMAND = ['next', '--json'];
export const AUDIT_COMMAND = ['audit', '--json'];
export const REPORT_COMMAND = ['report', '--json'];
export const POLICY_STATUS_COMMAND = ['policy-status', '--json'];

export const ALLOWED_CLI_COMMANDS = [
  'protocol-info',
  'task-list',
  'task-show',
  'status',
  'progress',
  'continuity',
  'next',
  'audit',
  'report',
  'policy-status',
] as const;

export const CLI_TIMEOUT_MS = 30000;
export const CLI_MAX_STDOUT_BYTES = 1024 * 1024; // 1MB
export const JSON_MAX_SIZE_BYTES = 1024 * 1024; // 1MB
export const JSON_MAX_DEPTH = 100;
export const NDJSON_MAX_LINE_BYTES = 64 * 1024; // 64KB
export const EVENTS_BATCH_SIZE = 1000;
export const WATCHER_DEBOUNCE_MS = 100;
export const WATCHER_RETRY_MS = 500;
export const WATCHER_MAX_RETRIES = 3;

export const SUPPORTED_PROTOCOL_VERSIONS = [1] as const;

export const PHASE_LABELS: Record<string, string> = {
  RECEIVED: 'Received',
  DISCOVERING: 'Discovering',
  CONTRACT_READY: 'Contract Ready',
  ROUTED: 'Routed',
  DESIGNING: 'Designing',
  PLANNED: 'Planned',
  EXECUTING: 'Executing',
  VERIFYING: 'Verifying',
  DIAGNOSING: 'Diagnosing',
  CORRECTING: 'Correcting',
  REVIEWING: 'Reviewing',
  COMPLETE: 'Complete',
  BLOCKED: 'Blocked',
};

export const PHASE_ICONS: Record<string, string> = {
  RECEIVED: 'circle',
  DISCOVERING: 'search',
  CONTRACT_READY: 'file-text',
  ROUTED: 'git-branch',
  DESIGNING: 'pen-tool',
  PLANNED: 'list-check',
  EXECUTING: 'play',
  VERIFYING: 'check-circle',
  DIAGNOSING: 'stethoscope',
  CORRECTING: 'wrench',
  REVIEWING: 'eye',
  COMPLETE: 'check-circle-2',
  BLOCKED: 'alert-triangle',
};

export const EVIDENCE_KIND_LABELS: Record<string, string> = {
  OBSERVED: 'Observed',
  INFERRED: 'Inferred',
  NOT_VERIFIED: 'Not Verified',
  BLOCKED: 'Blocked',
  HYPOTHESIS: 'Hypothesis',
};

export const EVIDENCE_KIND_COLORS: Record<string, string> = {
  OBSERVED: 'text-forge-success',
  INFERRED: 'text-forge-info',
  NOT_VERIFIED: 'text-forge-text-muted',
  BLOCKED: 'text-forge-danger',
  HYPOTHESIS: 'text-forge-warning',
};

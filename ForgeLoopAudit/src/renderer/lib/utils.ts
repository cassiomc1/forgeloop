import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString();
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length - 3) + '...';
}

export function shortHash(hash: string, length = 8): string {
  return hash.slice(0, length);
}

export function getPhaseColor(phase: string): string {
  const colors: Record<string, string> = {
    RECEIVED: 'text-forge-text-muted',
    DISCOVERING: 'text-forge-info',
    CONTRACT_READY: 'text-forge-info',
    ROUTED: 'text-forge-info',
    DESIGNING: 'text-forge-warning',
    PLANNED: 'text-forge-warning',
    EXECUTING: 'text-forge-accent',
    VERIFYING: 'text-forge-success',
    DIAGNOSING: 'text-forge-warning',
    CORRECTING: 'text-forge-warning',
    REVIEWING: 'text-forge-info',
    COMPLETE: 'text-forge-success',
    BLOCKED: 'text-forge-danger',
  };
  return colors[phase] || 'text-forge-text-muted';
}

export function getPhaseBadgeClass(phase: string, isCurrent = false): string {
  const base = 'phase-badge';
  if (isCurrent) return `${base} phase-badge-current`;
  const completed = ['COMPLETE'];
  const failed = ['BLOCKED', 'DIAGNOSING', 'CORRECTING'];
  if (completed.includes(phase)) return `${base} phase-badge-completed`;
  if (failed.includes(phase)) return `${base} phase-badge-failed`;
  return `${base} phase-badge-pending`;
}

export function getEvidenceKindColor(kind: string): string {
  const colors: Record<string, string> = {
    OBSERVED: 'text-forge-success',
    INFERRED: 'text-forge-info',
    NOT_VERIFIED: 'text-forge-text-muted',
    BLOCKED: 'text-forge-danger',
    HYPOTHESIS: 'text-forge-warning',
  };
  return colors[kind] || 'text-forge-text-muted';
}

export function getEvidenceKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    OBSERVED: 'Observed',
    INFERRED: 'Inferred',
    NOT_VERIFIED: 'Not Verified',
    BLOCKED: 'Blocked',
    HYPOTHESIS: 'Hypothesis',
  };
  return labels[kind] || kind;
}

export function getCheckStatusColor(status: string): string {
  const colors: Record<string, string> = {
    passed: 'text-forge-success',
    failed: 'text-forge-danger',
    running: 'text-forge-accent',
    pending: 'text-forge-text-muted',
  };
  return colors[status] || 'text-forge-text-muted';
}

export function getGateStatusColor(status: string): string {
  const colors: Record<string, string> = {
    satisfied: 'text-forge-success',
    unverified: 'text-forge-text-muted',
    blocked: 'text-forge-danger',
  };
  return colors[status] || 'text-forge-text-muted';
}

export function getNextActionColor(type: string): string {
  const colors: Record<string, string> = {
    progress: 'text-forge-accent',
    recovery: 'text-forge-warning',
    blocker: 'text-forge-danger',
    inconsistency: 'text-forge-danger',
  };
  return colors[type] || 'text-forge-text-muted';
}
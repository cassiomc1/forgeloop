import * as React from 'react';
import { cn } from '../../lib/utils';

export type BadgeVariant = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'danger';

const variants: Record<BadgeVariant, string> = {
  default: 'border-transparent bg-primary text-primary-foreground',
  secondary: 'border-transparent bg-secondary text-secondary-foreground',
  outline: 'text-foreground',
  success: 'border-transparent bg-forge-success/10 text-forge-success',
  warning: 'border-transparent bg-forge-warning/10 text-forge-warning',
  danger: 'border-transparent bg-forge-danger/10 text-forge-danger',
};

export function Badge({ className, variant = 'default', ...props }: React.HTMLAttributes<HTMLDivElement> & { variant?: BadgeVariant }) {
  return <div className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors', variants[variant], className)} {...props} />;
}

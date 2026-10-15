import * as React from 'react';
import { cn } from '../../lib/utils';

export type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link';
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
  outline: 'border border-input bg-background shadow-sm hover:bg-accent/10 hover:text-foreground',
  ghost: 'hover:bg-accent/10 hover:text-foreground',
  destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
  link: 'text-primary underline-offset-4 hover:underline',
};

const sizeClasses: Record<ButtonSize, string> = {
  default: 'h-9 px-4 py-2',
  sm: 'h-8 rounded-md px-3 text-xs',
  lg: 'h-10 rounded-md px-8',
  icon: 'h-9 w-9',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant = 'default', size = 'default', type = 'button', ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn('inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50', variantClasses[variant], sizeClasses[size], className)}
      {...props}
    />
  );
});

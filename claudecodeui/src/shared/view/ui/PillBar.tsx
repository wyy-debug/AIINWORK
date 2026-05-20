import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../../../lib/utils';

type PillBarProps = {
  children: ReactNode;
  className?: string;
};

export function PillBar({ children, className }: PillBarProps) {
  return (
    <div className={cn('inline-flex items-center gap-[2px] rounded-lg bg-muted/60 p-[3px]', className)}>
      {children}
    </div>
  );
}

type PillProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  isActive: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
};

export function Pill({ isActive, onClick, children, className, ...buttonProps }: PillProps) {
  return (
    <button
      {...buttonProps}
      onClick={onClick}
      className={cn(
        'flex touch-manipulation items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150',
        isActive
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground active:bg-background/50',
        className,
      )}
    >
      {children}
    </button>
  );
}

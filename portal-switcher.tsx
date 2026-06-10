import { ReactNode } from "react";

interface MobileHeaderProps {
  title?: string;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
}

export function MobileHeader({ title, subtitle, left, right }: MobileHeaderProps) {
  return (
    <header className="bg-sidebar text-sidebar-foreground px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex w-10 justify-start">{left}</div>
        <div className="min-w-0 flex-1 text-center">
          {title && <div className="truncate text-sm font-semibold">{title}</div>}
          {subtitle && (
            <div className="truncate text-[11px] text-sidebar-foreground/70">{subtitle}</div>
          )}
        </div>
        <div className="flex w-10 justify-end">{right}</div>
      </div>
    </header>
  );
}

export function MobileIconButton({
  onClick,
  ariaLabel,
  children,
  title,
}: {
  onClick: () => void;
  ariaLabel: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-full p-2 text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
    >
      {children}
    </button>
  );
}

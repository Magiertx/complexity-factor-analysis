// The empty state of a view: what is missing and how to fill it.

import { cn } from "@/lib/utils";

/**
 * The one empty state of the app (docs/UI.md): what is missing and, where there is one, the way to
 * fill it, centred in a quiet tile. A busy state passes a spinner as its icon.
 */
export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg bg-tile/50 px-4 py-8 flex flex-col items-center gap-2 text-center text-sm", className)}>
      {icon && <div className="text-muted">{icon}</div>}
      {title && <div className="font-medium">{title}</div>}
      {children && <div className="max-w-md text-muted">{children}</div>}
      {action && <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

"use client";

// The notice of the app: a tinted box with an icon for an info, a warning, an error or a confirmation.

import { AlertCircle, AlertTriangle, Check, Info, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { IconButton } from "./icon-button";

/** The kind of a notice; it sets the colour and the icon. */
export type NoticeTone = "info" | "warn" | "error" | "success";

/** Box, icon and ink colour of each tone. */
const TONE: Record<NoticeTone, { box: string; icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>; ink: string }> = {
  info: { box: "bg-tile/70", icon: Info, ink: "text-muted" },
  warn: { box: "bg-warn/10 border-l-[3px] border-warn", icon: AlertTriangle, ink: "text-warn-ink" },
  error: { box: "bg-danger/10 border-l-[3px] border-danger", icon: AlertCircle, ink: "text-danger-ink" },
  success: { box: "bg-success/10 border-l-[3px] border-success", icon: Check, ink: "text-success-ink" },
};

/**
 * The one notice of the app (docs/UI.md): an info, a warning, an error or a confirmation, always with
 * its icon, in a tinted box that lines up with the content around it. A title and a line or two;
 * longer text belongs behind an (i). `role` makes it a live region where it appears by itself.
 */
export function Notice({
  tone = "info",
  title,
  children,
  action,
  icon,
  onDismiss,
  size = "md",
  role,
  id,
  className,
}: {
  tone?: NoticeTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  /** A button or link that deals with it, under the text. */
  action?: React.ReactNode;
  /** Instead of the icon of the tone, e.g. a spinner while something is on its way. */
  icon?: React.ReactNode;
  onDismiss?: () => void;
  /** "sm" for a line inside a form or a table's surroundings. */
  size?: "sm" | "md";
  role?: "status" | "alert";
  id?: string;
  className?: string;
}) {
  const t = useT();
  const { box, icon: Icon, ink } = TONE[tone];
  const small = size === "sm";
  return (
    <div
      id={id}
      role={role}
      className={cn(
        "rounded-lg flex items-start",
        small ? "gap-2 px-3 py-2 text-xs" : "gap-2.5 px-3.5 py-2.5 text-sm",
        box,
        className,
      )}
    >
      <span className={cn("shrink-0", small ? "mt-px" : "mt-0.5", ink)}>
        {icon ?? <Icon className={small ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden />}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className={cn("break-words", title ? "text-muted" : undefined)}>{children}</div>}
        {action && <div className="flex flex-wrap gap-2 pt-1">{action}</div>}
      </div>
      {onDismiss && (
        <IconButton size="sm" icon={X} name={t("common.dismiss")} onClick={onDismiss} className="-my-0.5 h-6 w-6" />
      )}
    </div>
  );
}

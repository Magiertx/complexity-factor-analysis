"use client";

// A text link with an icon that can be blocked with a reason, like IconButton.

import type { ComponentType } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useTip } from "./tip";

/**
 * A link in running text or beside a heading, with an icon, e.g. to a comparison. With a `reason`
 * it is inactive but stays focusable, and its tooltip says why, as a blocked button does.
 */
export function ActionLink({
  href,
  icon: Icon,
  more,
  reason,
  className,
  children,
}: {
  href: string | null;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  /** What the link opens, for stage 2 of its tooltip; a reason shows only with it. */
  more: string;
  /** Why it cannot be followed now. */
  reason?: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  const tip = useTip<HTMLElement>({ reason: reason ?? undefined, more });
  const look =
    "inline-flex items-center gap-1 rounded text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
  if (href && !reason) {
    return (
      <Link ref={tip} href={href} className={cn(look, "text-accent-ink hover:underline", className)}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {children}
      </Link>
    );
  }
  return (
    <span ref={tip} role="link" aria-disabled="true" tabIndex={0} className={cn(look, "text-muted cursor-default", className)}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {children}
    </span>
  );
}

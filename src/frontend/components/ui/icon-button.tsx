"use client";

import { useMemo, type ComponentType, type ButtonHTMLAttributes, type Ref } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { mergeRefs, useTip } from "./tip";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "name"> {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  /** What the button is, in one to three words: its accessible name and stage 1 of its tooltip. */
  name: string;
  /** What it does, a sentence or two: stage 2 of the tooltip. */
  more?: string;
  keyCap?: string;
  /** Why it cannot be used now, and the way out. The button stays focusable, so the reason can be read. */
  reason?: string | null;
  /** Shows a spinner instead of the icon. */
  busy?: boolean;
  /** "sm" for a dense row such as the settings row, "md" for a toolbar. */
  size?: "sm" | "md";
  /** On a tile like the other controls, or bare in a row of tools. */
  tone?: "bare" | "tile";
  ref?: Ref<HTMLButtonElement>;
}

/**
 * A button that shows only its icon, named by its tooltip. A reason makes it inactive but keeps it
 * hoverable and focusable (aria-disabled), so the reason can be shown.
 */
export function IconButton({
  icon: Icon,
  name,
  more,
  keyCap,
  reason,
  busy,
  size = "md",
  tone = "bare",
  className,
  onClick,
  ref,
  ...rest
}: IconButtonProps) {
  const tip = useTip<HTMLButtonElement>({ name, more, keyCap, reason: reason ?? undefined });
  const merged = useMemo(() => mergeRefs(ref, tip), [ref, tip]);
  const blocked = !!reason || rest["aria-disabled"] === true || rest["aria-disabled"] === "true";
  return (
    <button
      ref={merged}
      type="button"
      aria-label={name}
      {...rest}
      aria-disabled={blocked || undefined}
      onClick={(e) => {
        if (blocked) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      className={cn(
        "shrink-0 grid place-items-center rounded-md text-muted transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        size === "sm" ? "h-7 w-7" : "h-8 w-8",
        tone === "tile" ? "bg-tile hover:bg-accent/[0.08]" : "hover:bg-tile",
        "hover:text-fg aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted",
        "aria-expanded:bg-tile aria-expanded:text-fg aria-pressed:text-fg",
        className,
      )}
    >
      {busy ? (
        <Loader2 className={cn("animate-spin", size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4")} aria-hidden />
      ) : (
        <Icon className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden />
      )}
    </button>
  );
}

/** A thin line between groups of tools in a row. */
export function ToolSeparator({ className }: { className?: string }) {
  return <span aria-hidden className={cn("mx-1 h-5 w-px shrink-0 bg-border", className)} />;
}

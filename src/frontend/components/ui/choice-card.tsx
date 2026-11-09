"use client";

import { cn } from "@/lib/utils";
import { ChoiceMark, choiceTile } from "./choice";
import { useTip } from "./tip";

/**
 * A card to choose (docs/UI.md): the neutral tile with the accent ring once chosen and its check
 * mark, a radio among several or a checkbox. The label covers the card; its (i) sits in the top right
 * corner, outside the label, so a press on it does not choose the card. A `reason` blocks the card
 * and says why in the tooltip, while it stays focusable.
 */
export function ChoiceCard({
  type = "radio",
  name,
  label,
  checked,
  onChange,
  info,
  footer,
  describedBy,
  reason,
  size = "md",
  className,
  children,
}: {
  type?: "radio" | "checkbox";
  name?: string;
  /** The accessible name of the choice; the visible text may say more. */
  label: string;
  checked: boolean;
  onChange: () => void;
  /** The (i) of the card, or another small control. */
  info?: React.ReactNode;
  /** A line under the card's text with a link or a control of its own; outside the label, so it does not choose the card. */
  footer?: React.ReactNode;
  /** The id of the short line under the name, read as the description of the choice. */
  describedBy?: string;
  reason?: string | null;
  /** "sm" for a dense list, such as the datasets of a comparison. */
  size?: "sm" | "md";
  className?: string;
  children: React.ReactNode;
}) {
  const tip = useTip<HTMLLabelElement>(reason ? { name: label, reason } : null);
  return (
    <div className={cn("relative rounded-md min-w-0", choiceTile(checked), className)}>
      <label
        ref={tip}
        className={cn(
          "flex items-start gap-2.5 min-w-0",
          size === "sm" ? "px-2.5 py-2" : "px-3 py-2.5",
          reason ? "cursor-default" : "cursor-pointer",
          info && "pr-9",
        )}
      >
        <input
          type={type}
          name={name}
          className="sr-only"
          checked={checked}
          onChange={() => {
            if (!reason) onChange();
          }}
          aria-label={label}
          aria-describedby={describedBy}
          aria-disabled={reason ? true : undefined}
        />
        <ChoiceMark type={type} checked={checked} className="mt-0.5" />
        <span className="min-w-0 flex-1">{children}</span>
      </label>
      {info && <span className={cn("absolute right-2", size === "sm" ? "top-1.5" : "top-2")}>{info}</span>}
      {footer && <div className="-mt-1 pb-2 pl-[2.625rem] pr-3 text-xs">{footer}</div>}
    </div>
  );
}

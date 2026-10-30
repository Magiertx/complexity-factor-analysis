"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface Option<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
}

interface Props<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
  /** The label of the group, e.g. the id of a FieldLabel above it. */
  "aria-labelledby"?: string;
  /** The label of the group where no visible label has an id. */
  "aria-label"?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
  "aria-labelledby": labelledBy,
  "aria-label": label,
}: Props<T>) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));

  // The sliding pill is positioned by measuring the active button instead of
  // assuming equal segment widths; with `whitespace-nowrap` a long label
  // (e.g. the German source-mode strings) makes its flex item wider than its
  // siblings, so a pure 1/n calculation drifts off the text.
  const containerRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const btn = el.querySelectorAll<HTMLButtonElement>("button")[idx];
      if (!btn) return;
      const next = { left: btn.offsetLeft, width: btn.offsetWidth };
      setPill((prev) =>
        prev && prev.left === next.left && prev.width === next.width ? prev : next,
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [idx, options]);

  // A radiogroup with one tab stop (roving tabindex): the chosen option, or the first one that can
  // be chosen when none is. Arrow keys move to the next option and choose it, like native radios.
  const enabled = options.flatMap((o, i) => (o.disabled ? [] : [i]));
  const stop = enabled.includes(idx) ? idx : (enabled[0] ?? -1);
  const onKeyDown = (e: React.KeyboardEvent, from: number) => {
    let to: number | undefined;
    const at = enabled.indexOf(from);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") to = enabled[(at + 1) % enabled.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") to = enabled[(at - 1 + enabled.length) % enabled.length];
    else if (e.key === "Home") to = enabled[0];
    else if (e.key === "End") to = enabled[enabled.length - 1];
    if (to === undefined || at < 0) return;
    e.preventDefault();
    onChange(options[to].value);
    containerRef.current?.querySelectorAll<HTMLButtonElement>("button")[to]?.focus();
  };

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={label}
      className={cn(
        // As tall as the fields next to it (h-8 small, h-9 like inputs and selects), so a row lines up.
        "relative flex bg-tile rounded-md gap-1",
        size === "sm" ? "h-8 p-0.5" : "h-9 p-1",
        className,
      )}
    >
      {pill && (
        <div
          aria-hidden
          className={cn(
            // The chosen option, the same in every Segmented control (docs/UI.md): a raised neutral
            // pill without a ring, never an accent ring or fill.
            "absolute bg-pill shadow-sm rounded transition-all duration-300 ease-out pointer-events-none motion-reduce:transition-none",
            size === "sm" ? "top-0.5 bottom-0.5" : "top-1 bottom-1",
          )}
          style={{ width: pill.width, left: pill.left }}
        />
      )}
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
          disabled={o.disabled}
          title={o.title}
          aria-checked={value === o.value}
          tabIndex={i === stop ? 0 : -1}
          className={cn(
            "relative z-10 flex-1 font-medium transition-colors duration-200 whitespace-nowrap flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            size === "sm" ? "text-xs px-2.5 rounded" : "text-[13px] px-3 rounded-md",
            value === o.value ? "text-fg" : "text-muted hover:text-fg",
            o.disabled && "opacity-60 cursor-not-allowed hover:text-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

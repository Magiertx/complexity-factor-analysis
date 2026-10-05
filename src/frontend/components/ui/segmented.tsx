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
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
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

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex bg-tile rounded-md gap-1",
        size === "sm" ? "p-0.5" : "p-1",
        className,
      )}
    >
      {pill && (
        <div
          aria-hidden
          className={cn(
            "absolute bg-surface shadow-sm rounded transition-all duration-300 ease-out pointer-events-none",
            size === "sm" ? "top-0.5 bottom-0.5" : "top-1 bottom-1",
          )}
          style={{ width: pill.width, left: pill.left }}
        />
      )}
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          disabled={o.disabled}
          title={o.title}
          className={cn(
            "relative z-10 flex-1 font-medium transition-colors duration-200 whitespace-nowrap flex items-center justify-center gap-1",
            size === "sm"
              ? "text-[10px] py-1 px-2.5 rounded"
              : "text-[11px] py-1.5 px-3 rounded-md",
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

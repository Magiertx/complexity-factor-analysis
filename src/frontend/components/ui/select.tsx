"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  /** Said on hover, and by the trigger while the option is chosen. */
  title?: string;
  /** Options with the same group are listed under a small heading, in order of appearance. */
  group?: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  /** Shown when no option has the current value. */
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  /** Width and layout of the trigger, e.g. `min-w-[180px] w-auto`. */
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}

const MENU_MAX_HEIGHT = 288;

/**
 * Dropdown in the style of the other controls: a borderless tile with its own chevron and a
 * floating list instead of the browser's native popup. Keyboard: arrows, Home/End, Enter or
 * Space to pick, Escape to close, and typing a letter jumps to the next option starting with it.
 */
export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  id,
  disabled,
  className,
  ...aria
}: SelectProps) {
  const autoId = React.useId();
  const triggerId = id ?? `select-${autoId}`;
  const listId = `${triggerId}-list`;
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const [pos, setPos] = React.useState<{ left: number; top: number; width: number; up: boolean } | null>(null);

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;
  const enabled = (i: number) => i >= 0 && i < options.length && !options[i].disabled;

  const place = React.useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const up = below < Math.min(MENU_MAX_HEIGHT, options.length * 34 + 8) && r.top > below;
    setPos({ left: r.left, top: up ? r.top - 4 : r.bottom + 4, width: r.width, up });
  }, [options.length]);

  const openMenu = () => {
    if (disabled) return;
    place();
    setActive(enabled(selectedIndex) ? selectedIndex : options.findIndex((o) => !o.disabled));
    setOpen(true);
  };

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const pick = (i: number) => {
    if (!enabled(i)) return;
    if (options[i].value !== value) onValueChange(options[i].value);
    close();
  };

  React.useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!listRef.current?.contains(target) && !triggerRef.current?.contains(target)) close(false);
    };
    const onMove = () => place();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, place]);

  React.useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, listId]);

  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (enabled(i)) return i;
    return from;
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") setActive((a) => step(a, 1));
    else if (e.key === "ArrowUp") setActive((a) => step(a, -1));
    else if (e.key === "Home") setActive(step(-1, 1));
    else if (e.key === "End") setActive(step(options.length, -1));
    else if (e.key === "Enter" || e.key === " ") pick(active);
    else if (e.key === "Escape") close();
    else if (e.key === "Tab") close(false);
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      const ch = e.key.toLowerCase();
      const n = options.length;
      for (let k = 1; k <= n; k++) {
        const i = (active + k) % n;
        if (enabled(i) && options[i].label.toLowerCase().startsWith(ch)) {
          setActive(i);
          break;
        }
      }
    } else return;
    e.preventDefault();
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        disabled={disabled}
        title={selected?.title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        {...aria}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(e) => {
          if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
            e.preventDefault();
            openMenu();
          }
        }}
        className={cn(
          "relative h-9 w-full rounded-md bg-tile pl-3 pr-9 text-left text-sm transition",
          "hover:bg-accent/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
          "disabled:opacity-50 disabled:pointer-events-none",
          open && "ring-2 ring-accent/50",
          className,
        )}
      >
        <span className={cn("block truncate", !selected && "text-muted")}>{selected?.label ?? placeholder ?? ""}</span>
        <ChevronDown
          aria-hidden
          className={cn(
            "pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={aria["aria-labelledby"] ?? (aria["aria-label"] ? undefined : triggerId)}
            aria-label={aria["aria-label"]}
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            onKeyDown={onListKey}
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              minWidth: pos.width,
              maxHeight: MENU_MAX_HEIGHT,
              transform: pos.up ? "translateY(-100%)" : undefined,
            }}
            className="z-50 max-w-[min(420px,calc(100vw-16px))] overflow-y-auto rounded-md bg-surface p-1 shadow-xl ring-1 ring-border/70 focus:outline-none"
          >
            {options.map((o, i) => {
              const heading = o.group && o.group !== options[i - 1]?.group ? o.group : null;
              const isSelected = i === selectedIndex;
              return (
                <React.Fragment key={`${o.group ?? ""}:${o.value}`}>
                  {heading && (
                    <div
                      role="presentation"
                      className="px-2.5 pt-2 pb-1 text-xs font-medium text-muted"
                    >
                      {heading}
                    </div>
                  )}
                  <div
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={o.disabled || undefined}
                    title={o.title}
                    onMouseEnter={() => enabled(i) && setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(i)}
                    className={cn(
                      "flex items-center gap-2 rounded px-2.5 py-1.5 text-sm cursor-pointer select-none",
                      i === active && "bg-accent/[0.10]",
                      isSelected && "font-medium",
                      o.disabled && "opacity-40 cursor-default",
                    )}
                  >
                    <span className="flex-1 truncate">{o.label}</span>
                    {isSelected && <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-accent-ink" />}
                  </div>
                </React.Fragment>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

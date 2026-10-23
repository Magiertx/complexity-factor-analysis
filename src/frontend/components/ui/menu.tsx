"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { IconButton } from "./icon-button";

export interface MenuItem {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  /** A short second line, e.g. what a download holds or why the entry cannot be used now. */
  hint?: string | null;
  onSelect?: () => void;
  /** A link instead of an action, e.g. a download the browser makes itself. */
  href?: string;
  download?: boolean;
  /** The link opens in a tab of its own, e.g. a page to print, so the analysis stays where it is. */
  newTab?: boolean;
  disabled?: boolean;
  /** A thin line above the entry, to start a group. */
  separated?: boolean;
}

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

/**
 * A menu behind an icon button, e.g. the downloads of an analysis. The list floats in a portal under
 * the button (over it where there is no room), aligned to its right edge. Keyboard: Enter, Space or
 * the down arrow open it on the first entry; the arrows, Home and End move, Escape closes it back to
 * the button, and Tab goes on to what follows the button. Inactive entries stay in the list with
 * their reason, readable but not chosen.
 */
export function Menu({
  icon,
  name,
  more,
  items,
  busy,
  size,
  className,
  width = 260,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  /** The name of the button and of the menu. */
  name: string;
  more?: string;
  items: MenuItem[];
  busy?: boolean;
  size?: "sm" | "md";
  className?: string;
  width?: number;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const id = useId();
  const listId = `${id}-menu`;

  const place = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const w = Math.min(width, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    // The full height of the list, also while a max height cuts it short.
    const height = listRef.current?.scrollHeight ?? items.length * 44 + 8;
    const below = window.innerHeight - r.bottom - 4;
    const above = r.top - 4;
    // It opens to the side with room for all of it, else to the one with more; there it scrolls.
    const downward = below >= height + 12 || below >= above;
    const maxHeight = Math.max(80, (downward ? below : above) - 12);
    setPos(
      downward
        ? { left, top: r.bottom + 4, maxHeight }
        : { left, bottom: window.innerHeight - r.top + 4, maxHeight },
    );
  }, [items.length, width]);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const openAt = (index: number) => {
    place();
    setActive(Math.max(0, Math.min(items.length - 1, index)));
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!listRef.current?.contains(target) && !triggerRef.current?.contains(target)) close(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place, close]);

  // The entry with the arrow on it has the focus.
  useEffect(() => {
    if (!open || !pos) return;
    listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[active]?.focus();
  }, [open, pos, active]);

  const choose = (item: MenuItem) => {
    if (item.disabled) return;
    close(true);
    item.onSelect?.();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = items.length;
    if (e.key === "ArrowDown") setActive((a) => (a + 1) % n);
    else if (e.key === "ArrowUp") setActive((a) => (a - 1 + n) % n);
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(n - 1);
    else if (e.key === "Escape") close(true);
    else if (e.key === "Tab") {
      // The list sits at the end of the page; the next stop is the one after the button.
      const outside = Array.from(document.querySelectorAll<HTMLElement>(TABBABLE)).filter(
        (el) => el.tabIndex >= 0 && el.getClientRects().length > 0 && !listRef.current?.contains(el),
      );
      const at = triggerRef.current ? outside.indexOf(triggerRef.current) : -1;
      const next = e.shiftKey ? triggerRef.current : outside[at + 1];
      close(false);
      next?.focus();
    } else return;
    e.preventDefault();
  };

  return (
    <>
      <IconButton
        ref={triggerRef}
        icon={icon}
        name={name}
        more={more}
        busy={busy}
        size={size}
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close(true) : openAt(0))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            openAt(e.key === "ArrowUp" ? items.length - 1 : 0);
          }
        }}
      />
      {open &&
        createPortal(
          <div
            ref={listRef}
            id={listId}
            role="menu"
            aria-label={name}
            onKeyDown={onKeyDown}
            style={{
              position: "fixed",
              left: pos?.left ?? -9999,
              top: pos?.top,
              bottom: pos?.bottom,
              maxHeight: pos?.maxHeight,
              width: Math.min(width, typeof window === "undefined" ? width : window.innerWidth - 16),
              visibility: pos ? undefined : "hidden",
            }}
            className="z-50 overflow-y-auto overscroll-contain rounded-lg bg-surface p-1 shadow-xl ring-1 ring-border/70 focus:outline-none"
          >
            {items.map((item, i) => {
              const Icon = item.icon;
              const content = (
                <>
                  {Icon && <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted" aria-hidden />}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">{item.label}</span>
                    {item.hint && <span className="block text-[11px] leading-snug text-muted">{item.hint}</span>}
                  </span>
                </>
              );
              const cls = cn(
                "w-full flex items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition focus:outline-none",
                i === active && "bg-accent/[0.08]",
                item.disabled ? "opacity-50 cursor-default" : "hover:bg-accent/[0.08] cursor-pointer",
                item.separated && "mt-1 relative before:absolute before:-top-[3px] before:inset-x-2 before:h-px before:bg-border",
              );
              return item.href && !item.disabled ? (
                <a
                  key={item.id}
                  role="menuitem"
                  tabIndex={-1}
                  href={item.href}
                  download={item.download || undefined}
                  target={item.newTab ? "_blank" : undefined}
                  rel={item.newTab ? "noopener" : undefined}
                  onClick={() => close(true)}
                  onMouseEnter={() => setActive(i)}
                  className={cls}
                >
                  {content}
                </a>
              ) : (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  aria-disabled={item.disabled || undefined}
                  onClick={() => choose(item)}
                  onMouseEnter={() => setActive(i)}
                  className={cls}
                >
                  {content}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

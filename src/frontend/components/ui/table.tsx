"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The frame of a table in the one table style (`.data-table`, globals.css). A table that fits
 * lies flat on the page, so its header sticks under the settings row while the page scrolls; one
 * wider than the frame scrolls sideways inside it instead, focusable so the keyboard can scroll it.
 * `boxed` puts a long table into a box of its own height that scrolls, with the header at its top.
 */
export function TableFrame({
  label,
  boxed,
  className,
  children,
}: {
  /** Names the region while it scrolls. */
  label: string;
  /** A box that scrolls on its own, with a max height in `className`. */
  boxed?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Until it is measured, the table scrolls in its frame rather than widening the page.
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const frame = ref.current;
    const table = frame?.querySelector("table");
    if (!frame || !table || typeof ResizeObserver === "undefined") return;
    const update = () => setWide(table.offsetWidth > frame.clientWidth + 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    observer.observe(table);
    return () => observer.disconnect();
  }, []);
  const scrolls = boxed || wide;
  return (
    <div
      ref={ref}
      role={scrolls ? "region" : undefined}
      aria-label={scrolls ? label : undefined}
      tabIndex={scrolls ? 0 : undefined}
      className={cn(
        // relative: screen-reader texts of the cells stay inside a frame that scrolls.
        "table-frame relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        boxed && "table-frame--boxed overflow-auto",
        wide && !boxed && "overflow-x-auto",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A measure's full name, with places to break after underscores: "epa_normalized_sequence_entropy"
 * wraps between its parts rather than being cut off.
 */
export function MeasureName({ name }: { name: string }) {
  const parts = name.split("_");
  if (parts.length === 1) return <>{name}</>;
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <>
              _<wbr />
            </>
          )}
          {part}
        </Fragment>
      ))}
    </>
  );
}

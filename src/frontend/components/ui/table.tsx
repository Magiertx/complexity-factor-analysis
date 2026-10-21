"use client";

import { Fragment, createContext, useContext, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The measures to write as C with an index (the codes of log measures, lib/short-codes.ts), by
 * the text they are shown with. The view that shows the codes provides it for the tables below.
 */
const MeasureIndexes = createContext<ReadonlyMap<string, string> | null>(null);

/** A block of the page whose measure names are set with these indexes (`MeasureName`). */
export function MeasureScope({
  indexes,
  className,
  children,
}: {
  indexes: ReadonlyMap<string, string>;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <MeasureIndexes.Provider value={indexes}>
      <div className={className}>{children}</div>
    </MeasureIndexes.Provider>
  );
}

/**
 * The frame of a table in the one table style (`.data-table`, globals.css). A table that fits
 * lies flat on the page, so its header sticks under the settings row while the page scrolls; one
 * wider than the frame scrolls sideways inside it instead, focusable so the keyboard can scroll it.
 * `boxed` puts a long table into a box of its own height that scrolls, with the header at its top.
 * The frame's width is in `--frame-w`, for a row that must not scroll away (SectionRow).
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
    const update = () => {
      setWide(table.offsetWidth > frame.clientWidth + 1);
      // For what has to stay in view while the table scrolls sideways (SectionRow).
      frame.style.setProperty("--frame-w", `${frame.clientWidth}px`);
    };
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
        scrolls && "table-frame--scrolls",
        boxed ? "overflow-auto" : wide && "overflow-x-auto",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A measure's full name, with places to break after underscores: "epa_normalized_sequence_entropy"
 * wraps between its parts rather than being cut off. The code of a log measure is written as the
 * papers write it: C with the code as index.
 */
export function MeasureName({ name }: { name: string }) {
  const index = useContext(MeasureIndexes)?.get(name);
  if (index !== undefined) {
    return (
      <>
        C<sub>{index}</sub>
      </>
    );
  }
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

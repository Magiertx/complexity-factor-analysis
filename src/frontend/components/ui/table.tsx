"use client";

import { Fragment, createContext, useContext, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The measures to write as C with an index (the codes of log measures, lib/short-codes.ts), by
 * the text they are shown with. The view that shows the codes provides it for the tables below.
 */
const MeasureIndexes = createContext<ReadonlyMap<string, string> | null>(null);

/** What opens the fact sheet of a measure: the view that has the sheet provides it (`MeasureScope`). */
export interface MeasureOpener {
  /**
   * Opens the sheet of `measure`. `list` is the measures of the list the name stands in, in its order,
   * which the arrow keys of the sheet page through; null for the measures of the dataset. `from` is
   * the element the focus returns to when the sheet closes.
   */
  open: (measure: string, list: readonly string[] | null, from: HTMLElement) => void;
}

const MeasureOpenerContext = createContext<MeasureOpener | null>(null);
const MeasureListContext = createContext<readonly string[] | null>(null);

/**
 * A block of the page whose measure names are set with these indexes (`MeasureName`), and, with an
 * `opener`, whose names open the fact sheet of the measure.
 */
export function MeasureScope({
  indexes,
  opener,
  className,
  children,
}: {
  indexes: ReadonlyMap<string, string>;
  opener?: MeasureOpener | null;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <MeasureIndexes.Provider value={indexes}>
      <MeasureOpenerContext.Provider value={opener ?? null}>
        <div className={className}>{children}</div>
      </MeasureOpenerContext.Provider>
    </MeasureIndexes.Provider>
  );
}

/** A list of measures (the rows of a table or the cards of a view): the sheet of one of its names pages through them. */
export function MeasureListScope({ measures, children }: { measures: readonly string[]; children: React.ReactNode }) {
  return <MeasureListContext.Provider value={measures}>{children}</MeasureListContext.Provider>;
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
 * papers write it: C with the code as index. With the `measure` it is the name of (its key) and a
 * sheet to open, the name is a button that opens the fact sheet of the measure.
 */
export function MeasureName({ name, measure }: { name: string; measure?: string }) {
  const index = useContext(MeasureIndexes)?.get(name);
  const opener = useContext(MeasureOpenerContext);
  const list = useContext(MeasureListContext);
  let text: React.ReactNode;
  if (index !== undefined) {
    text = (
      <>
        C<sub>{index}</sub>
      </>
    );
  } else {
    const parts = name.split("_");
    text =
      parts.length === 1 ? (
        <>{name}</>
      ) : (
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
  if (!measure || !opener) return text;
  return (
    <button
      type="button"
      data-measure-link={measure}
      aria-haspopup="dialog"
      onClick={(e) => opener.open(measure, list, e.currentTarget)}
      className="measure-link inline text-left font-[inherit] rounded-sm hover:underline hover:decoration-dotted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {text}
    </button>
  );
}

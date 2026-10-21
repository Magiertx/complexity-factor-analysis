"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** What the button for the other measures of a long list does: unfold them, or fold them again. */
export interface Fold {
  open: boolean;
  onToggle: () => void;
}

/**
 * The title of the measures a long list folds below its notable ones, as a button: it names them
 * with their number and unfolds them ("Show") or folds them again ("Hide"). Shared by the list of
 * the MSA and the loadings, in a table row and in the card of a factor.
 */
export function FoldButton({ label, fold, className }: { label: string; fold: Fold; className?: string }) {
  const t = useT();
  return (
    <button
      type="button"
      aria-expanded={fold.open}
      onClick={fold.onToggle}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-sm text-left hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        className,
      )}
    >
      {fold.open ? (
        <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
      ) : (
        <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
      )}
      <span>{label}</span>
      <span className="ml-auto font-normal">{t(fold.open ? "factor.measures.hide_other" : "factor.measures.show_other")}</span>
    </button>
  );
}

/**
 * The header row of a section of a table of measures; with `fold` its title is the fold button.
 * The row spans the whole table, which is wider than the screen where the loadings scroll
 * sideways, so its content is as wide as the frame of the table (TableFrame) and stays at its
 * left edge: the label "Show" at the end of the button is never out of sight.
 */
export function SectionRow({ colSpan, label, fold }: { colSpan: number; label: string; fold?: Fold }) {
  return (
    <tr className="table-group">
      <th scope="colgroup" colSpan={colSpan}>
        <div className="sticky left-3 w-[calc(var(--frame-w,100%)-1.5rem)]">
          {fold ? <FoldButton label={label} fold={fold} /> : label}
        </div>
      </th>
    </tr>
  );
}

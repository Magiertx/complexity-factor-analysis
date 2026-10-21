"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { FACTOR_NAME_MAX } from "@/lib/factor-analysis";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { mergeRefs, useTip } from "@/components/ui/tip";

/**
 * The title of a factor that its reader can rename in place: a press opens a field, Enter keeps
 * the name, Esc leaves it as it was, and leaving the field keeps what was typed. An empty name
 * gives the factor back its number. On a card the title is the name, else "Factor 1"; at the head
 * of a column of the matrix it is "F1" with the name below.
 */
export function FactorTitle({
  index,
  name,
  onName,
  look,
}: {
  /** From 0. */
  index: number;
  name: string | null;
  onName: (text: string) => void;
  look: "card" | "column";
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Esc closes the field without keeping it; the blur that follows must not keep it either.
  const done = useRef(false);
  const numbered = t("factor.loadings.factor_n", { i: index + 1 });
  const tip = useTip<HTMLButtonElement>({
    name: name ? `${numbered}: ${name}` : numbered,
    more: t("factor.names.edit_more", { max: FACTOR_NAME_MAX }),
  });
  const ref = useMemo(() => mergeRefs(buttonRef, tip), [tip]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const open = () => {
    done.current = false;
    setDraft(name ?? "");
    setEditing(true);
  };
  const close = (keep: boolean, refocus: boolean) => {
    if (done.current) return;
    done.current = true;
    if (keep && draft !== (name ?? "")) onName(draft);
    setEditing(false);
    // Back to the title after Enter or Esc; a click elsewhere keeps the focus where it went.
    if (refocus) requestAnimationFrame(() => buttonRef.current?.focus());
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        maxLength={FACTOR_NAME_MAX}
        aria-label={t("factor.names.field", { i: index + 1 })}
        placeholder={numbered}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            close(true, true);
          } else if (e.key === "Escape") {
            // A dialog or a toast behind the field stays open.
            e.preventDefault();
            e.stopPropagation();
            close(false, true);
          }
        }}
        onBlur={() => close(true, false)}
        className={cn(
          "h-7 rounded-md bg-bg px-2 text-sm font-normal text-fg ring-1 ring-strong focus:outline-none focus:ring-2 focus:ring-accent",
          look === "card" ? "w-full min-w-0" : "w-32 text-left",
        )}
      />
    );
  }

  if (look === "column") {
    return (
      <button
        ref={ref}
        type="button"
        onClick={open}
        aria-label={name ? `${numbered}: ${name}` : numbered}
        className="group inline-flex flex-col items-end gap-0.5 rounded px-0.5 text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="inline-flex items-center gap-1">
          <Pencil className="h-3 w-3 text-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
          F{index + 1}
        </span>
        {name && <span className="block max-w-[7rem] truncate text-[11px] font-normal text-fg/80">{name}</span>}
      </button>
    );
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={open}
      aria-label={name ? `${numbered}: ${name}` : numbered}
      className="group inline-flex min-w-0 items-baseline gap-1.5 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {name ? (
        <>
          <span className="shrink-0 text-[11px] font-medium text-muted">F{index + 1}</span>
          <span className="min-w-0 break-words">{name}</span>
        </>
      ) : (
        <span>{numbered}</span>
      )}
      <Pencil
        className="h-3 w-3 shrink-0 self-center text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
        aria-hidden
      />
    </button>
  );
}

"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Hourglass, RotateCcw, Search } from "lucide-react";
import { matchesQuery } from "@/lib/measure-list";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { ChoiceMark, choiceTile } from "@/components/ui/choice";
import { useTip } from "@/components/ui/tip";

export interface FeatureGroup {
  key: string;
  name: string;
  description?: string;
  slow?: boolean;
}

export interface FeatureMeasure {
  key: string;
  name: string;
  description?: string;
  group: string;
}

/**
 * The log measures to compute, by feature group: a group is chosen as a whole with its box, which
 * is half filled while only some of its measures are, and unfolds to choose single measures. A
 * search over all measures unfolds the groups with a match and shows only the matches. A few
 * measures for a few logs are a few clicks, not a hundred.
 */
export function FeatureChecklist({
  heading,
  hint,
  groups,
  measures,
  selected,
  onChange,
  defaults,
}: {
  heading: string;
  hint: string;
  groups: FeatureGroup[];
  measures: FeatureMeasure[];
  /** The measures chosen, by key. */
  selected: string[];
  onChange: (keys: string[]) => void;
  /** The measures of the standard groups. */
  defaults: string[];
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const chosen = new Set(selected);
  const byGroup = useMemo(() => {
    const out = new Map<string, FeatureMeasure[]>();
    for (const m of measures) out.set(m.group, [...(out.get(m.group) ?? []), m]);
    return out;
  }, [measures]);
  const q = query.trim();
  const matches = (m: FeatureMeasure) => !q || matchesQuery(q, m.name, m.key);
  // Keeps the order of the catalog, so requests and tables are stable.
  const set = (next: Set<string>) => onChange(measures.map((m) => m.key).filter((k) => next.has(k)));
  const setMany = (keys: string[], on: boolean) => {
    const next = new Set(chosen);
    for (const k of keys) {
      if (on) next.add(k);
      else next.delete(k);
    }
    set(next);
  };
  const shown = groups.filter((g) => !q || (byGroup.get(g.key) ?? []).some(matches));
  const linkClass = "text-[11px] text-muted hover:text-fg transition inline-flex items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

  return (
    <fieldset className="space-y-2">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <legend className="text-sm font-semibold">
            {heading}{" "}
            <span className="text-xs font-normal text-muted">
              {t("factor.data.measures_selected", { n: selected.length, total: measures.length })}
            </span>
          </legend>
          <p className="text-xs text-muted mt-0.5 max-w-prose">{hint}</p>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" className={linkClass} onClick={() => set(new Set(measures.map((m) => m.key)))}>
            {t("factor.data.select_all")}
          </button>
          <button type="button" className={linkClass} onClick={() => set(new Set())}>
            {t("factor.data.select_none")}
          </button>
          <button type="button" className={linkClass} onClick={() => set(new Set(defaults))}>
            <RotateCcw className="h-3 w-3" aria-hidden />
            {t("factor.data.select_defaults")}
          </button>
        </div>
      </div>
      <label className="relative block max-w-xs">
        <span className="sr-only">{t("factor.data.measure_search")}</span>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.stopPropagation();
              setQuery("");
            }
          }}
          placeholder={t("factor.data.measure_search_placeholder")}
          className="h-8 w-full rounded-md bg-tile pl-8 pr-2 text-sm placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        />
      </label>
      <div className="grid gap-1.5 sm:grid-cols-2 items-start">
        {shown.map((g) => {
          const all = byGroup.get(g.key) ?? [];
          const visible = all.filter(matches);
          const n = all.filter((m) => chosen.has(m.key)).length;
          return (
            <GroupTile
              key={g.key}
              group={g}
              total={all.length}
              count={n}
              // A search unfolds the groups it found something in.
              open={!!q || open.has(g.key)}
              onOpen={(v) =>
                setOpen((s) => {
                  const next = new Set(s);
                  if (v) next.add(g.key);
                  else next.delete(g.key);
                  return next;
                })
              }
              onToggle={() => setMany(all.map((m) => m.key), n < all.length)}
            >
              {visible.map((m) => (
                <MeasureCheck key={m.key} measure={m} on={chosen.has(m.key)} onToggle={() => setMany([m.key], !chosen.has(m.key))} />
              ))}
            </GroupTile>
          );
        })}
      </div>
      {q && shown.length === 0 && <p className="text-xs text-muted">{t("factor.measures.none_match")}</p>}
    </fieldset>
  );
}

function GroupTile({
  group,
  total,
  count,
  open,
  onOpen,
  onToggle,
  children,
}: {
  group: FeatureGroup;
  total: number;
  count: number;
  open: boolean;
  onOpen: (open: boolean) => void;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const t = useT();
  const listId = useId();
  const box = useRef<HTMLInputElement>(null);
  const state = count === 0 ? false : count === total ? true : ("mixed" as const);
  useEffect(() => {
    if (box.current) box.current.indeterminate = state === "mixed";
  }, [state]);
  const slowTip = useTip<HTMLSpanElement>(group.slow ? { name: t("factor.data.slow_badge"), more: t("factor.data.slow_title") } : null);
  return (
    <div className={cn("rounded-md text-xs min-w-0", choiceTile(state !== false))}>
      <div className="flex items-start">
        <label className="flex-1 min-w-0 flex items-start gap-2.5 pl-2.5 py-2 cursor-pointer">
          <input ref={box} type="checkbox" checked={state === true} onChange={onToggle} className="sr-only" />
          <ChoiceMark checked={state} className="mt-px" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 flex-wrap">
              <span className="font-medium">{group.name}</span>
              {group.slow && (
                <span ref={slowTip} className="inline-flex text-muted">
                  <Hourglass className="h-3 w-3" aria-hidden />
                  <span className="sr-only">{t("factor.data.slow_badge")}</span>
                </span>
              )}
              <span className="text-[10px] text-muted tabular-nums">{t("factor.data.selected_count", { n: count, total })}</span>
            </span>
            {group.description && <span className="block text-[11px] text-muted mt-0.5 leading-snug">{group.description}</span>}
          </span>
        </label>
        <button
          type="button"
          onClick={() => onOpen(!open)}
          aria-expanded={open}
          aria-controls={listId}
          aria-label={t(open ? "factor.data.group_fold" : "factor.data.group_unfold", { group: group.name })}
          className="m-1 h-7 w-7 shrink-0 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-tile transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      </div>
      {/* A class, not the hidden attribute, which the grid's display would override. */}
      <ul id={listId} className={cn("px-2 pb-2 gap-0.5 sm:grid-cols-2", open ? "grid" : "hidden")}>
        {children}
      </ul>
    </div>
  );
}

function MeasureCheck({ measure, on, onToggle }: { measure: FeatureMeasure; on: boolean; onToggle: () => void }) {
  const tip = useTip<HTMLLabelElement>(measure.description ? { more: measure.description } : null);
  return (
    <li className="min-w-0">
      <label ref={tip} className="flex items-start gap-2 rounded px-1.5 py-1 cursor-pointer hover:bg-tile has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
        <input type="checkbox" checked={on} onChange={onToggle} className="sr-only" />
        <ChoiceMark checked={on} className="mt-px h-3.5 w-3.5" />
        <span className="min-w-0 break-words font-mono text-[11px]">{measure.name}</span>
      </label>
    </li>
  );
}

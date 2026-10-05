"use client";

import { useEffect, useState } from "react";
import { FileText, HelpCircle, Star } from "lucide-react";
import type { AlgorithmManifest } from "@/lib/api";
import { TOOL_TYPE_LABEL } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLocale, localizedAlgoDescription } from "@/lib/i18n";

const FAVORITES_KEY = "app.favorite-algorithms";

function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

interface Props {
  algorithms: AlgorithmManifest[];
  categories?: { id: string; label: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  // Optional: shows the ? button per algorithm; a click hands the manifest
  // to the parent, which opens the AlgorithmExplainerModal.
  onShowExplainer?: (algo: AlgorithmManifest) => void;
}

const ORDER: string[] = ["complexity"];

export function AlgorithmList({
  algorithms,
  categories = [],
  selectedId,
  onSelect,
  onShowExplainer,
}: Props) {
  const { locale, t } = useLocale();

  // Favorites are pinned in their own group at the top and additionally keep
  // their place in the regular categories (marked with a filled star).
  const [favorites, setFavorites] = useState<string[]>([]);
  useEffect(() => {
    setFavorites(loadFavorites());
  }, []);

  const toggleFavorite = (id: string) => {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      } catch {
        /* private mode / quota — keep in-memory state */
      }
      return next;
    });
  };

  const favoriteAlgos = favorites
    .map((id) => algorithms.find((a) => a.id === id))
    .filter((a): a is AlgorithmManifest => !!a);

  const groups = new Map<string, AlgorithmManifest[]>();
  for (const a of algorithms) {
    const t = a.tool_type ?? "analysis";
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t)!.push(a);
  }

  // Determine categories ordering and labels from props, fallback to defaults
  let orderedKeys: string[] = [];
  let categoryLabels: Record<string, string> = {};

  if (categories && categories.length > 0) {
    orderedKeys = categories.map((c) => c.id).filter((id) => groups.has(id));
    categoryLabels = Object.fromEntries(categories.map((c) => [c.id, c.label]));
  } else {
    orderedKeys = ORDER.filter((k) => groups.has(k));
    categoryLabels = TOOL_TYPE_LABEL;
  }

  // Append any unknown tool_types at the end.
  for (const k of groups.keys()) {
    if (!orderedKeys.includes(k)) {
      orderedKeys.push(k);
    }
  }

  // Counter across all algorithms: marks the very first ? button with
  // `data-tour="single-algo-help"` so the single-run tour can target it
  // before any algorithm is selected.
  let algoIdx = 0;

  const renderAlgo = (a: AlgorithmManifest) => {
    const active = a.id === selectedId;
    const isFirst = algoIdx === 0;
    algoIdx++;
    const isFavorite = favorites.includes(a.id);
    const shortName = a.name.split(" — ")[0];
    return (
      // Wrapper div so the select button and the icon buttons are siblings
      // instead of nested (nested buttons are invalid HTML).
      <div key={a.id} className="relative group/algo">
        <button
          onClick={() => onSelect(a.id)}
          className={cn(
            "block w-full text-left rounded-md px-3 py-2.5 transition relative appearance-none",
            active
              ? "bg-accent/[0.14] pl-3.5 before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:rounded-r before:bg-accent"
              : "hover:bg-accent/[0.10]",
          )}
        >
          <div className={cn("min-w-0", onShowExplainer ? "pr-14" : "pr-8")}>
            <div className="flex items-center gap-2 leading-tight">
              <FileText className="h-3.5 w-3.5 text-muted shrink-0" />
              <span className="text-sm font-medium truncate">{a.name}</span>
            </div>
            <p className="mt-1 text-xs text-muted overflow-hidden leading-[1rem] max-h-[2rem]">
              {localizedAlgoDescription(a, locale)}
            </p>
          </div>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(a.id);
          }}
          aria-pressed={isFavorite}
          aria-label={
            isFavorite
              ? t("algorithm_list.favorite_remove_aria", { name: shortName })
              : t("algorithm_list.favorite_add_aria", { name: shortName })
          }
          title={
            isFavorite
              ? t("algorithm_list.favorite_remove_title")
              : t("algorithm_list.favorite_add_title")
          }
          className={cn(
            "absolute top-2 h-6 w-6 grid place-items-center rounded transition appearance-none",
            onShowExplainer ? "right-9" : "right-2",
            isFavorite
              ? "text-accent hover:text-muted"
              : "text-muted hover:text-accent hover:bg-accent/[0.10] opacity-0 group-hover/algo:opacity-100 focus:opacity-100",
          )}
        >
          <Star className={cn("h-3.5 w-3.5", isFavorite && "fill-current")} />
        </button>
        {onShowExplainer && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onShowExplainer(a);
            }}
            data-tour={isFirst ? "single-algo-help" : undefined}
            aria-label={t("algorithm_list.what_is_aria", { name: shortName })}
            title={t("algorithm_list.what_does_title")}
            className="absolute top-2 right-2 h-6 w-6 grid place-items-center rounded text-muted hover:text-accent hover:bg-accent/[0.10] transition appearance-none opacity-50 group-hover/algo:opacity-100 focus:opacity-100"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  };

  return (
    <nav className="flex flex-col gap-5" data-tour="single-algo-list">
      {favoriteAlgos.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted px-1 flex items-center gap-1.5">
            <Star className="h-3 w-3 fill-current text-accent" />
            {t("algorithm_list.favorites_heading")}
          </div>
          {favoriteAlgos.map(renderAlgo)}
        </div>
      )}
      {orderedKeys.map((tt) => (
        <div key={tt} className="flex flex-col gap-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted px-1">
            {categoryLabels[tt] ?? tt}
          </div>
          {groups.get(tt)!.map(renderAlgo)}
        </div>
      ))}
    </nav>
  );
}

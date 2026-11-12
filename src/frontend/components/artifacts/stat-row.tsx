"use client";

// A row of key figures: a label above a value.

import type { Artifact } from "@/lib/api";
import { cn } from "@/lib/utils";
import { localizedAlgoText, useLocale, type Locale } from "@/lib/i18n";
import { formatNumber, formatPercent } from "@/lib/format";

type Stat = Extract<Artifact, { kind: "stat" }>;

interface Props {
  stats: Stat[];
}

const ACCENT: Record<NonNullable<Stat["accent"]>, string> = {
  default: "text-fg",
  success: "text-success-ink",
  warn: "text-warn-ink",
  danger: "text-danger-ink",
};

/** The figures of consecutive `stat` artifacts as one grid. */
export function StatRow({ stats }: Props) {
  const { t, locale } = useLocale();
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {stats.map((s, i) => {
        const color = ACCENT[s.accent ?? "default"];
        const value = formatValue(s, locale);
        return (
          <div key={i}>
            <div className="text-xs text-muted">{localizedAlgoText(s.label, t)}</div>
            <div className={cn("mt-1 text-2xl font-semibold font-mono", color)}>{value}</div>
          </div>
        );
      })}
    </div>
  );
}

/** A text as it is, a share as a percentage, a number with its unit, in the UI language. */
function formatValue(s: Stat, locale: Locale): string {
  if (typeof s.value === "string") return s.value;
  if (s.pct) return formatPercent(s.value, locale, 1);
  const formatted = formatNumber(s.value, locale, Number.isInteger(s.value) ? 0 : 3);
  return s.unit ? `${formatted} ${s.unit}` : formatted;
}

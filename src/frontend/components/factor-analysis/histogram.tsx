"use client";

// A small histogram of the values of one measure, for its fact sheet.

import type { Histogram as HistogramData } from "@/lib/api";
import { formatStatistic } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n";

/** Width of the drawing, in SVG units. */
const WIDTH = 320;
/** Height of the area of the bars, in SVG units. */
const BARS = 56;
/** Height of the strip under the bars that holds the smallest and the largest value, in SVG units. */
const AXIS = 16;

/**
 * The distribution of the values of a measure as a small histogram: neutral bars, a line at the
 * median, the smallest and the largest value under its ends. Drawn from the counts the server
 * keeps with the statistics; the numbers next to it in the sheet say the same in text.
 */
export function Histogram({
  histogram,
  median,
  measure,
}: {
  histogram: HistogramData;
  median: number | null;
  /** The name of the measure, for the text alternative. */
  measure: string;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { min, max, counts } = histogram;
  const bins = counts.length;
  const top = Math.max(...counts, 1);
  const slot = WIDTH / bins;
  const span = max - min;
  const at = (v: number) => (span > 0 ? ((v - min) / span) * WIDTH : WIDTH / 2);
  // The fullest bin, for the text alternative.
  const fullest = counts.indexOf(Math.max(...counts));
  const edge = (b: number) => min + (span * b) / bins;
  const label = t("factor.sheet.hist_aria", {
    measure,
    bins,
    min: formatStatistic(min, locale),
    max: formatStatistic(max, locale),
    top: counts[fullest],
    from: formatStatistic(edge(fullest), locale),
    to: formatStatistic(edge(fullest + 1), locale),
  });
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${BARS + AXIS}`}
      role="img"
      aria-label={label}
      className="block w-full h-auto"
      style={{ maxHeight: 96 }}
    >
      {counts.map((count, b) => {
        const h = count === 0 ? 0 : Math.max(1.5, (count / top) * (BARS - 4));
        return (
          <rect
            key={b}
            x={b * slot + 0.75}
            y={BARS - h}
            width={Math.max(1, slot - 1.5)}
            height={h}
            rx={1}
            style={{ fill: "rgb(var(--muted) / 0.55)" }}
          />
        );
      })}
      <line x1={0} x2={WIDTH} y1={BARS + 0.5} y2={BARS + 0.5} style={{ stroke: "rgb(var(--border-strong))" }} strokeWidth={1} />
      {median !== null && (
        <line
          x1={at(median)}
          x2={at(median)}
          y1={0}
          y2={BARS}
          style={{ stroke: "rgb(var(--fg))" }}
          strokeWidth={1.5}
          strokeDasharray="3 2"
        />
      )}
      <text x={0} y={BARS + 12} fontSize={10} style={{ fill: "rgb(var(--muted))" }}>
        {formatStatistic(min, locale)}
      </text>
      <text x={WIDTH} y={BARS + 12} fontSize={10} textAnchor="end" style={{ fill: "rgb(var(--muted))" }}>
        {formatStatistic(max, locale)}
      </text>
    </svg>
  );
}

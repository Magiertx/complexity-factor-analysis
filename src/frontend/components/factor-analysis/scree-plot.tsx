"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Table2 } from "lucide-react";
import { formatNumber, formatPercent } from "@/lib/format";
import { TableFrame } from "@/components/ui/table";
import { useLocale, useT } from "@/lib/i18n";

const HEIGHT = 260;
const M = { l: 44, r: 44, t: 28, b: 40 };
// Without "Show all", the plot ends after this many factors or twice the largest suggestion,
// whichever is more: past the elbow the eigenvalues of a hundred measures only crowd the axis.
const MIN_SHOWN = 20;

function niceStep(raw: number) {
  for (const s of [0.25, 0.5, 1, 2, 5, 10, 20, 50]) if (s >= raw) return s;
  return Math.ceil(raw / 100) * 100;
}

interface Props {
  eigenvalues: number[];
  /** Parallel analysis: the percentile of the eigenvalues of random data, one per eigenvalue. */
  random?: number[] | null;
  /** The percentile of `random`, e.g. 95. */
  percentile?: number;
  suggested: number;
  /** The largest count any criterion suggests; the plot shows at least twice as many factors. */
  largestSuggestion: number;
  selected: number;
  /** Largest factor count that may be picked by clicking a point. */
  maxSelectable: number;
  onSelect: (n: number) => void;
}

/**
 * Eigenvalues in descending order with the Kaiser line, the parallel analysis as a dashed line
 * and the cumulative share of the variance on a right axis; a point click sets the factor
 * count. For the keyboard the plot is one slider: arrow keys, Home and End change the count. A
 * table with every series is the text alternative.
 */
export function ScreePlot({
  eigenvalues,
  random,
  percentile = 95,
  suggested,
  largestSuggestion,
  selected,
  maxSelectable,
  onSelect,
}: Props) {
  const t = useT();
  const { locale } = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const titleId = useId();
  const descId = useId();
  const tableId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(260, Math.round(el.clientWidth)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const total = eigenvalues.length;
  if (total === 0) return null;

  // The eigenvalues of a correlation matrix add up to the number of measures, so their running
  // sum is the cumulative share of the variance.
  const sum = eigenvalues.reduce((a, v) => a + v, 0);
  const cumulative: number[] = [];
  let running = 0;
  for (const v of eigenvalues) {
    running += v / sum;
    cumulative.push(running);
  }
  const randomValues = random && random.length === total ? random : null;

  const limit = Math.max(MIN_SHOWN, 2 * Math.max(largestSuggestion, suggested, selected));
  const truncated = total > limit;
  const n = truncated && !showAll ? limit : total;
  const shown = eigenvalues.slice(0, n);

  const w = width - M.l - M.r;
  const h = HEIGHT - M.t - M.b;
  const max = Math.max(...shown, ...(randomValues?.slice(0, n) ?? []), 1);
  const step = niceStep((max * 1.1) / 4);
  const top = Math.ceil((max * 1.1) / step) * step;
  const x = (i: number) => M.l + ((i - 0.5) / n) * w;
  const y = (v: number) => M.t + h - (Math.max(0, v) / top) * h;
  const yShare = (share: number) => M.t + h - Math.min(1, Math.max(0, share)) * h;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Number(v.toFixed(4)));
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(w / 28))));
  const band = Math.min(selected, n);
  const above = eigenvalues.filter((v) => v > 1).length;

  const pick = (k: number) => onSelect(Math.max(1, Math.min(maxSelectable, k)));
  const onKeyDown = (e: React.KeyboardEvent) => {
    const next =
      e.key === "ArrowRight" || e.key === "ArrowUp"
        ? selected + 1
        : e.key === "ArrowLeft" || e.key === "ArrowDown"
          ? selected - 1
          : e.key === "Home"
            ? 1
            : e.key === "End"
              ? maxSelectable
              : null;
    if (next === null) return;
    e.preventDefault();
    pick(next);
    setHover(Math.max(1, Math.min(maxSelectable, next, n)));
  };

  const suggestedLabel = t("factor.factors.suggested_mark");
  const suggestedLabelLeft = x(suggested) + 11 + suggestedLabel.length * 6 > M.l + w;

  const tip = hover !== null && hover <= n ? hover : null;
  const tipLines = tip
    ? [
        t("factor.factors.eigen_point", { i: tip, value: formatNumber(eigenvalues[tip - 1], locale, 2) }),
        ...(randomValues
          ? [t("factor.factors.random_point", { value: formatNumber(randomValues[tip - 1], locale, 2) })]
          : []),
        t("factor.factors.cumulative_point", { pct: formatPercent(cumulative[tip - 1], locale) }),
      ]
    : [];
  const tipW = Math.max(...tipLines.map((l) => l.length), 0) * 6.2 + 16;
  const tipH = tipLines.length * 15 + 8;
  const line = (values: number[], scale: (v: number) => number) =>
    values
      .slice(0, n)
      .map((v, i) => `${x(i + 1)},${scale(v)}`)
      .join(" ");

  return (
    <div ref={ref} className="w-full space-y-2">
      <svg
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="slider"
        tabIndex={0}
        aria-labelledby={titleId}
        aria-describedby={descId}
        aria-valuemin={1}
        aria-valuemax={maxSelectable}
        aria-valuenow={selected}
        aria-valuetext={t("factor.factors.retained", { n: selected })}
        onKeyDown={onKeyDown}
        onFocus={() => setHover(Math.min(selected, n))}
        onBlur={() => setHover(null)}
        className="block max-w-full select-none rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <title id={titleId}>{t("factor.factors.scree_title")}</title>
        <desc id={descId}>
          {t("factor.factors.scree_desc", { n: above })}{" "}
          {eigenvalues.map((v, i) => `${i + 1}: ${formatNumber(v, locale, 2)}`).join(", ")}.{" "}
          {t("factor.factors.scree_desc_table")}
        </desc>

        {/* retained factors */}
        <rect x={M.l} y={M.t} width={(band / n) * w} height={h} className="fill-accent" fillOpacity={0.07} />
        <text x={M.l + 4} y={M.t - 10} fontSize={10} className="fill-muted">
          {t("factor.factors.retained", { n: selected })}
        </text>

        {ticks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={M.l + w} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={1} />
            <text x={M.l - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize={10} className="fill-muted">
              {formatNumber(v, locale, Number.isInteger(v) ? 0 : 2)}
            </text>
          </g>
        ))}

        {/* right axis: cumulative share of the variance */}
        {[0, 0.25, 0.5, 0.75, 1].map((share) => (
          <text
            key={share}
            x={M.l + w + 6}
            y={yShare(share)}
            dy="0.32em"
            fontSize={10}
            className="fill-muted"
          >
            {formatPercent(share, locale, 0)}
          </text>
        ))}

        {/* Kaiser criterion */}
        <line
          x1={M.l}
          x2={M.l + w}
          y1={y(1)}
          y2={y(1)}
          className="stroke-muted"
          strokeWidth={1.5}
          strokeDasharray="5 4"
        />
        <text x={M.l + w - 2} y={y(1) - 6} textAnchor="end" fontSize={10} className="fill-muted">
          {t("factor.factors.kaiser_line")}
        </text>

        <polyline
          points={line(cumulative, yShare)}
          fill="none"
          className="stroke-muted"
          strokeOpacity={0.9}
          strokeWidth={1.25}
          strokeLinejoin="round"
        />

        {randomValues && (
          <polyline
            points={line(randomValues, y)}
            fill="none"
            className="stroke-fg"
            strokeOpacity={0.7}
            strokeWidth={1.5}
            strokeDasharray="2 3"
            strokeLinejoin="round"
          />
        )}

        <polyline
          points={line(eigenvalues, y)}
          fill="none"
          className="stroke-accent"
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {suggested >= 1 && suggested <= n && (
          <g aria-hidden>
            <circle
              cx={x(suggested)}
              cy={y(eigenvalues[suggested - 1])}
              r={9}
              fill="none"
              className="stroke-fg"
              strokeOpacity={0.55}
              strokeWidth={1.5}
              strokeDasharray="3 2"
            />
            {/* Above and right of the point: below it sits the dashed line, since the suggested
                factor is the last one above an eigenvalue of 1, and the curve only falls to the
                right. Left of the point where the label would leave the plot. */}
            <text
              x={suggestedLabelLeft ? x(suggested) - 11 : x(suggested) + 11}
              y={y(eigenvalues[suggested - 1]) - 9}
              textAnchor={suggestedLabelLeft ? "end" : "start"}
              fontSize={10}
              className="fill-fg"
            >
              {suggestedLabel}
            </text>
          </g>
        )}

        {shown.map((v, i) => {
          const k = i + 1;
          const kept = k <= selected;
          return (
            <circle
              key={k}
              cx={x(k)}
              cy={y(v)}
              r={hover === k ? 6 : n > 60 ? 3 : 4.5}
              className={kept ? "fill-accent stroke-surface" : "fill-surface stroke-accent"}
              strokeWidth={n > 60 ? 1.5 : 2}
            />
          );
        })}

        {shown.map((_, i) =>
          (i + 1) % labelEvery === 0 || i === 0 ? (
            <text key={i} x={x(i + 1)} y={M.t + h + 16} textAnchor="middle" fontSize={10} className="fill-muted">
              {i + 1}
            </text>
          ) : null,
        )}
        <text x={M.l + w / 2} y={HEIGHT - 6} textAnchor="middle" fontSize={11} className="fill-muted">
          {t("factor.factors.axis_factor")}
        </text>
        <text
          transform={`translate(12 ${M.t + h / 2}) rotate(-90)`}
          textAnchor="middle"
          fontSize={11}
          className="fill-muted"
        >
          {t("factor.factors.axis_eigenvalue")}
        </text>

        {/* pointer targets, one column per factor; the keyboard uses the slider */}
        {shown.map((_, i) => {
          const k = i + 1;
          const pickable = k <= maxSelectable;
          return (
            <rect
              key={k}
              x={M.l + (i / n) * w}
              y={M.t}
              width={w / n}
              height={h}
              fill="transparent"
              className={pickable ? "cursor-pointer" : undefined}
              onMouseEnter={() => setHover(k)}
              onMouseLeave={() => setHover(null)}
              onClick={() => pickable && onSelect(k)}
            />
          );
        })}

        {tip && (
          <g aria-hidden pointerEvents="none">
            <line x1={x(tip)} x2={x(tip)} y1={M.t} y2={M.t + h} className="stroke-muted" strokeOpacity={0.4} />
            {(() => {
              const tx = Math.min(Math.max(x(tip) - tipW / 2, M.l), M.l + w - tipW);
              const ty = Math.max(y(eigenvalues[tip - 1]) - tipH - 14, 2);
              return (
                <g transform={`translate(${tx} ${ty})`}>
                  <rect width={tipW} height={tipH} rx={4} className="fill-surface stroke-border" />
                  {tipLines.map((l, j) => (
                    <text key={j} x={8} y={16 + j * 15} fontSize={11} className={j === 0 ? "fill-fg" : "fill-muted"}>
                      {l}
                    </text>
                  ))}
                </g>
              );
            })()}
          </g>
        )}
      </svg>

      <div className="flex items-center justify-between gap-x-4 gap-y-2 flex-wrap text-[11px] text-muted">
        <ul className="flex items-center gap-x-3 gap-y-1 flex-wrap" aria-hidden>
          <li className="flex items-center gap-1.5">
            <svg width="18" height="8">
              <line x1="0" x2="18" y1="4" y2="4" className="stroke-accent" strokeWidth={2} />
              <circle cx="9" cy="4" r="3" className="fill-accent" />
            </svg>
            {t("factor.factors.legend_eigenvalues")}
          </li>
          {randomValues && (
            <li className="flex items-center gap-1.5">
              <svg width="18" height="8">
                <line x1="0" x2="18" y1="4" y2="4" className="stroke-fg" strokeOpacity={0.7} strokeWidth={1.5} strokeDasharray="2 3" />
              </svg>
              {t("factor.factors.legend_parallel", { percentile })}
            </li>
          )}
          <li className="flex items-center gap-1.5">
            <svg width="18" height="8">
              <line x1="0" x2="18" y1="4" y2="4" className="stroke-muted" strokeWidth={1.25} />
            </svg>
            {t("factor.factors.legend_cumulative")}
          </li>
        </ul>
        <span className="flex items-center gap-3">
          {truncated && (
            <button
              type="button"
              // The label says what a press does; aria-pressed as well would read as the opposite state.
              onClick={() => setShowAll((v) => !v)}
              className="rounded text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {showAll ? t("factor.factors.show_first", { n: limit }) : t("factor.factors.show_all", { n: total })}
            </button>
          )}
          <button
            type="button"
            onClick={() => setTableOpen((v) => !v)}
            aria-expanded={tableOpen}
            aria-controls={tableId}
            className="inline-flex items-center gap-1 rounded hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Table2 className="h-3.5 w-3.5" aria-hidden />
            {tableOpen ? t("factor.factors.hide_table") : t("factor.factors.show_table")}
          </button>
        </span>
      </div>

      {/* A box of its own, so the table of a hundred factors scrolls inside it. */}
      <div id={tableId} hidden={!tableOpen}>
        <TableFrame label={t("factor.factors.table_caption")} boxed className="max-h-64">
          <table className="data-table">
            <caption className="sr-only">{t("factor.factors.table_caption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("factor.factors.axis_factor")}</th>
                <th scope="col" className="num">
                  {t("factor.factors.axis_eigenvalue")}
                </th>
                {randomValues && (
                  <th scope="col" className="num">
                    {t("factor.factors.col_random", { percentile })}
                  </th>
                )}
                <th scope="col" className="num">
                  {t("factor.factors.col_cumulative")}
                </th>
              </tr>
            </thead>
            <tbody>
              {eigenvalues.map((v, i) => (
                <tr key={i}>
                  <th scope="row" className={i < selected ? "font-semibold" : undefined}>
                    {i + 1}
                  </th>
                  <td className="num">{formatNumber(v, locale, 3)}</td>
                  {randomValues && <td className="num">{formatNumber(randomValues[i], locale, 3)}</td>}
                  <td className="num">{formatPercent(cumulative[i], locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatNumber } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n";

const HEIGHT = 260;
const M = { l: 44, r: 16, t: 28, b: 40 };

function niceStep(raw: number) {
  for (const s of [0.25, 0.5, 1, 2, 5, 10, 20, 50]) if (s >= raw) return s;
  return Math.ceil(raw / 100) * 100;
}

interface Props {
  eigenvalues: number[];
  suggested: number;
  selected: number;
  /** Largest factor count that may be picked by clicking a point. */
  maxSelectable: number;
  onSelect: (n: number) => void;
}

/**
 * Eigenvalues in descending order with the Kaiser line; a point click sets the factor count.
 * For the keyboard the plot is one slider: arrow keys, Home and End change the count.
 */
export function ScreePlot({ eigenvalues, suggested, selected, maxSelectable, onSelect }: Props) {
  const t = useT();
  const { locale } = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(260, Math.round(el.clientWidth)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = eigenvalues.length;
  if (n === 0) return null;

  const w = width - M.l - M.r;
  const h = HEIGHT - M.t - M.b;
  const max = Math.max(...eigenvalues, 1);
  const step = niceStep((max * 1.1) / 4);
  const top = Math.ceil((max * 1.1) / step) * step;
  const x = (i: number) => M.l + ((i - 0.5) / n) * w;
  const y = (v: number) => M.t + h - (Math.max(0, v) / top) * h;
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
    setHover(Math.max(1, Math.min(maxSelectable, next)));
  };

  const tip = hover !== null ? { i: hover, v: eigenvalues[hover - 1] } : null;
  const tipText = tip ? t("factor.factors.eigen_point", { i: tip.i, value: formatNumber(tip.v, locale, 2) }) : "";
  const tipW = tipText.length * 6.2 + 16;

  return (
    <div ref={ref} className="w-full">
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
          {eigenvalues.map((v, i) => `${i + 1}: ${formatNumber(v, locale, 2)}`).join(", ")}
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
          points={eigenvalues.map((v, i) => `${x(i + 1)},${y(v)}`).join(" ")}
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
            <text
              x={x(suggested)}
              y={y(eigenvalues[suggested - 1]) + 22}
              textAnchor="middle"
              fontSize={10}
              className="fill-fg"
            >
              {t("factor.factors.suggested_mark")}
            </text>
          </g>
        )}

        {eigenvalues.map((v, i) => {
          const k = i + 1;
          const kept = k <= selected;
          return (
            <circle
              key={k}
              cx={x(k)}
              cy={y(v)}
              r={hover === k ? 6 : 4.5}
              className={kept ? "fill-accent stroke-surface" : "fill-surface stroke-accent"}
              strokeWidth={2}
            />
          );
        })}

        {eigenvalues.map((v, i) =>
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
        {eigenvalues.map((_, i) => {
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
            <line
              x1={x(tip.i)}
              x2={x(tip.i)}
              y1={M.t}
              y2={M.t + h}
              className="stroke-muted"
              strokeOpacity={0.4}
            />
            {(() => {
              const tx = Math.min(Math.max(x(tip.i) - tipW / 2, M.l), M.l + w - tipW);
              const ty = Math.max(y(tip.v) - 36, 2);
              return (
                <g transform={`translate(${tx} ${ty})`}>
                  <rect width={tipW} height={22} rx={4} className="fill-surface stroke-border" />
                  <text x={8} y={15} fontSize={11} className="fill-fg">
                    {tipText}
                  </text>
                </g>
              );
            })()}
          </g>
        )}
      </svg>
    </div>
  );
}

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import type { FactorInterpretation, InterpretationStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

interface Props {
  status: InterpretationStatus | null;
  statusFailed: boolean;
  interpretation: FactorInterpretation | null;
  /** The interpretation was made for other settings or another language. */
  stale: boolean;
  running: boolean;
  error: string | null;
  /** The analysis on screen matches the settings, so it can be interpreted. */
  canRun: boolean;
  onInterpret: () => void;
  measureName: (key: string) => string;
}

const CONFIDENCE_STYLE = {
  high: "bg-success/15 text-success-ink",
  medium: "bg-surface text-fg",
  low: "bg-warn/15 text-warn-ink",
} as const;

export function InterpretationView({
  status,
  statusFailed,
  interpretation,
  stale,
  running,
  error,
  canRun,
  onInterpret,
  measureName,
}: Props) {
  const t = useT();
  const available = !!status?.available;
  const fresh = !!interpretation && !stale;
  const hintId = useId();

  // Tell screen readers when a requested interpretation has arrived.
  const [announcement, setAnnouncement] = useState("");
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running && interpretation && !error) {
      setAnnouncement(t("factor.interpretation.ready", { n: interpretation.factors.length }));
    } else if (running) {
      setAnnouncement("");
    }
    wasRunning.current = running;
  }, [running, interpretation, error, t]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted leading-relaxed max-w-3xl">{t("factor.interpretation.intro")}</p>

      {stale && (
        <div role="status" className="rounded-lg bg-warn/10 px-3.5 py-2.5 flex items-start gap-2.5 text-sm">
          <AlertTriangle className="h-4 w-4 text-warn-ink shrink-0 mt-0.5" />
          <span>
            {t("factor.interpretation.stale")}
            {available && ` ${t("factor.interpretation.stale_again")}`}
          </span>
        </div>
      )}
      {!fresh && (
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            size="sm"
            onClick={onInterpret}
            disabled={!available || !canRun || running}
            title={available ? undefined : t("factor.interpretation.needs_key")}
            aria-describedby={!available && !running ? hintId : undefined}
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {interpretation ? t("factor.interpretation.again") : t("factor.interpretation.button")}
          </Button>
          {running ? (
            <span role="status" className="text-xs text-muted">
              {t("factor.interpretation.running")}
            </span>
          ) : (
            !available && (
              <span id={hintId} className="text-xs text-muted">
                {statusFailed ? t("factor.interpretation.status_failed") : t("factor.interpretation.needs_key")}
              </span>
            )
          )}
        </div>
      )}
      {status?.precomputed_only && !interpretation && (
        <p className="text-xs text-muted max-w-3xl">{t("factor.interpretation.precomputed_only")}</p>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {error && (
        <p role="alert" className="text-xs text-danger-ink">
          {error}
        </p>
      )}

      {interpretation && (
        <div className={cn("space-y-4 transition-opacity", stale && "opacity-60")}>
          {interpretation.precomputed && (
            <span
              title={t("factor.interpretation.precomputed_title")}
              className="inline-flex rounded-md bg-accent/15 text-accent-ink px-2 py-0.5 text-xs font-medium"
            >
              {t("factor.interpretation.precomputed")}
            </span>
          )}
          <ol className="grid gap-3 md:grid-cols-2">
            {interpretation.factors.map((f) => (
              <li key={f.index} className="rounded-lg bg-tile p-4 space-y-2 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-muted">{t("factor.interpretation.factor", { n: f.index })}</div>
                    <h3 className="text-sm font-semibold leading-snug break-words">{f.name}</h3>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-md px-2 py-0.5 text-xs font-medium",
                      CONFIDENCE_STYLE[f.confidence],
                    )}
                  >
                    {t("factor.interpretation.confidence", {
                      level: t(`factor.interpretation.confidence_level.${f.confidence}`),
                    })}
                  </span>
                </div>
                <p className="text-sm leading-relaxed">{f.summary}</p>
                {f.driving_measures.length > 0 && (
                  <ul aria-label={t("factor.interpretation.driving")} className="flex flex-wrap gap-1.5">
                    {f.driving_measures.map((m) => (
                      <li key={m} className="rounded-md bg-surface px-2 py-0.5 text-xs">
                        {measureName(m)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>

          {interpretation.overall && (
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">{t("factor.interpretation.overall")}</h3>
              <p className="text-sm leading-relaxed max-w-3xl">{interpretation.overall}</p>
            </div>
          )}
          {interpretation.caveats.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">{t("factor.interpretation.caveats")}</h3>
              <ul className="list-disc pl-5 space-y-1 text-sm max-w-3xl">
                {interpretation.caveats.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-muted border-t border-border pt-3">
            {t("factor.interpretation.footer", { model: interpretation.model })}
          </p>
        </div>
      )}
    </div>
  );
}

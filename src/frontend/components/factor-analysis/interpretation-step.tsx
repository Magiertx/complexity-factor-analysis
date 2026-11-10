"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import type { AnalyzeOptions, FactorInterpretation, InterpretationLanguage, InterpretationStatus } from "@/lib/api";
import { countText } from "@/lib/factor-analysis";
import { chatKey } from "@/lib/interpretation-chat";
import {
  effortOptions,
  isStored,
  modelLabel,
  modelOptions,
  withModel,
  type InterpretationChoice,
  type StoredVariant,
} from "@/lib/interpretation-choice";
import { cn } from "@/lib/utils";
import { useT, useTMaybe } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { MeasureListScope, MeasureName } from "@/components/ui/table";
import { useTip, useTipZone } from "@/components/ui/tip";
import { InterpretationChat } from "./interpretation-chat";

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
  /** The model and effort in force; null while nothing can be chosen. */
  choice: InterpretationChoice | null;
  /** What is stored for the analysis on screen. */
  variants: StoredVariant[];
  onChoice: (choice: InterpretationChoice) => void;
  onInterpret: () => void;
  /** What a follow-up question needs besides the choice; null while the analysis is not on screen. */
  chat: { datasetId: string; options: AnalyzeOptions; language: InterpretationLanguage } | null;
  /** The text of an error of the API in the UI language. */
  errorText: (e: unknown, fallback: string) => string;
  measureName: (key: string) => string;
  /** What a measure measures, for its tooltip. */
  measureDescription: (key: string) => string | undefined;
}

/** Low confidence is worth a warning; the others are plain text. */
const CONFIDENCE_INK = {
  high: "text-muted",
  medium: "text-muted",
  low: "text-warn-ink",
} as const;

export function InterpretationView({
  status,
  statusFailed,
  interpretation,
  stale,
  running,
  error,
  canRun,
  choice,
  variants,
  onChoice,
  onInterpret,
  chat,
  errorText,
  measureName,
  measureDescription,
}: Props) {
  const t = useT();
  const tMaybe = useTMaybe();
  const effortName = (e: string) => tMaybe(`factor.interpretation.effort_name.${e}`) ?? e;
  const stored = (c: InterpretationChoice) => (isStored(variants, c) ? ` · ${t("factor.interpretation.stored")}` : "");
  const zone = useTipZone<HTMLOListElement>();
  const precomputedTip = useTip<HTMLSpanElement>({ more: t("factor.interpretation.precomputed_title") });
  const available = !!status?.available;
  const fresh = !!interpretation && !stale;
  const hintId = useId();

  // Tell screen readers when a requested interpretation has arrived.
  const [announcement, setAnnouncement] = useState("");
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running && interpretation && !error) {
      setAnnouncement(countText(t, "factor.interpretation.ready", interpretation.factors.length));
    } else if (running) {
      setAnnouncement("");
    }
    wasRunning.current = running;
  }, [running, interpretation, error, t]);

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1 text-xs text-muted">
        {t("factor.interpretation.sent_label")}
        <InfoTip size="xs" topic={t("factor.interpretation.sent_label")} text={t("factor.interpretation.intro")} width={400} />
      </p>

      {stale && (
        <Notice tone="warn" role="status">
          {t("factor.interpretation.stale")}
          {available && ` ${t("factor.interpretation.stale_again")}`}
        </Notice>
      )}
      {(!fresh || choice) && (
        <div className="flex items-center gap-3 flex-wrap">
          {!fresh && (
          <Button
            size="sm"
            onClick={onInterpret}
            disabled={!available || !canRun || running}
            aria-describedby={!available && !running ? hintId : undefined}
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {interpretation ? t("factor.interpretation.again") : t("factor.interpretation.button")}
          </Button>
          )}
          {status && choice && (
            <ChoiceControls
              status={status}
              choice={choice}
              variants={variants}
              disabled={running}
              onChoice={onChoice}
              modelText={(m, c) => `${modelLabel(m)}${stored({ ...choice, model: m, ...(c ?? {}) })}`}
              effortText={(e) => `${effortName(e)}${stored({ ...choice, effort: e })}`}
              modelAria={t("factor.interpretation.model_label")}
              effortAria={t("factor.interpretation.effort_label")}
              hint={[
                tMaybe(`factor.interpretation.model_hint.${choice.model}`),
                tMaybe(`factor.interpretation.effort_hint.${choice.effort}`),
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          )}
          {!fresh && (running ? (
            <span role="status" className="text-xs text-muted">
              {t("factor.interpretation.running")}
            </span>
          ) : (
            !available && (
              <span id={hintId} className="text-xs text-muted">
                {statusFailed ? t("factor.interpretation.status_failed") : t("factor.interpretation.needs_key")}
              </span>
            )
          ))}
        </div>
      )}
      {status?.precomputed_only && !interpretation && <Notice size="sm">{t("factor.interpretation.precomputed_only")}</Notice>}
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {error && (
        <Notice tone="error" size="sm" role="alert">
          {error}
        </Notice>
      )}

      {interpretation && (
        <div className={cn("space-y-4 transition-opacity", stale && "opacity-60")}>
          {interpretation.precomputed && (
            <span ref={precomputedTip} className="inline-flex items-center gap-1.5 text-xs text-muted">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              {t("factor.interpretation.precomputed")}
            </span>
          )}
          <MeasureListScope measures={[...new Set(interpretation.factors.flatMap((f) => f.driving_measures))]}>
            <ol ref={zone} className="grid gap-3 md:grid-cols-2">
              {interpretation.factors.map((f) => (
                <li key={f.index} className="rounded-lg bg-tile p-4 space-y-2 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-muted">{t("factor.interpretation.factor", { n: f.index })}</div>
                      <h3 className="text-sm font-semibold leading-snug break-words">{f.name}</h3>
                    </div>
                    <span className={cn("shrink-0 text-xs", CONFIDENCE_INK[f.confidence])}>
                      {t("factor.interpretation.confidence", {
                        level: t(`factor.interpretation.confidence_level.${f.confidence}`),
                      })}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed">{f.summary}</p>
                  {f.driving_measures.length > 0 && (
                    <p className="text-xs text-muted">
                      <span className="font-medium">{t("factor.interpretation.driving")}:</span>{" "}
                      {f.driving_measures.map((m, i) => (
                        <span key={m}>
                          {i > 0 && " · "}
                          <span className="text-fg/80" data-tip-more={measureDescription(m)}>
                            <MeasureName name={measureName(m)} measure={m} />
                          </span>
                        </span>
                      ))}
                    </p>
                  )}
                </li>
              ))}
            </ol>
            </MeasureListScope>

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
              {t("factor.interpretation.footer", {
                model: modelLabel(interpretation.model),
                effort: interpretation.effort ? effortName(interpretation.effort) : "?",
              })}
            </p>
          </div>
        )}

        {fresh && choice && chat && status?.chat && (
          <InterpretationChat
            key={chatKey(chat.datasetId, chat.options, chat.language, choice)}
            datasetId={chat.datasetId}
            options={chat.options}
            language={chat.language}
            choice={choice}
            errorText={errorText}
          />
        )}
        {fresh && status && !status.chat && (
          <p className="text-xs text-muted">{t("factor.interpretation.chat.needs_key")}</p>
        )}
      </div>
    );
  }

interface ChoiceControlsProps {
  status: InterpretationStatus;
  choice: InterpretationChoice;
  variants: StoredVariant[];
  disabled: boolean;
  onChoice: (choice: InterpretationChoice) => void;
  /** Option labels, with the mark for what is stored; `effort` is the one the model would get. */
  modelText: (model: string, effort?: { effort: string }) => string;
  effortText: (effort: string) => string;
  modelAria: string;
  effortAria: string;
  /** What the chosen model and effort mean. */
  hint: string;
}

/** Model and effort, as small selects; a single option, as without a key, is plain text. */
function ChoiceControls({
  status,
  choice,
  variants,
  disabled,
  onChoice,
  modelText,
  effortText,
  modelAria,
  effortAria,
  hint,
}: ChoiceControlsProps) {
  const models = modelOptions(status, variants);
  const efforts = effortOptions(status, variants, choice.model);
  const className = "h-8 w-auto min-w-[8rem]";
  return (
    <>
      {models.length > 1 ? (
        <Select
          aria-label={modelAria}
          className={className}
          disabled={disabled}
          value={choice.model}
          onValueChange={(model) => onChoice(withModel(status, variants, choice, model))}
          options={models.map((m) => ({
            value: m,
            label: modelText(m, { effort: withModel(status, variants, choice, m).effort }),
          }))}
        />
      ) : (
        <span className="text-xs text-muted">{modelLabel(choice.model)}</span>
      )}
      {efforts.length > 1 ? (
        <Select
          aria-label={effortAria}
          className={className}
          disabled={disabled}
          value={choice.effort}
          onValueChange={(effort) => onChoice({ model: choice.model, effort })}
          options={efforts.map((e) => ({ value: e, label: effortText(e) }))}
        />
      ) : (
        <span className="text-xs text-muted">{efforts.length ? effortText(efforts[0]) : ""}</span>
      )}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </>
  );
}

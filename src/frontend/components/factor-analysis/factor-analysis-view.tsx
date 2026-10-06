"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, HelpCircle, Loader2, Microscope, RotateCcw } from "lucide-react";
import {
  HttpError,
  abortTask,
  analyzeDataset,
  createDataset,
  downloadAnalysisZip,
  exportLoadings,
  fetchDataset,
  fetchFactorCatalog,
  fetchInterpretationStatus,
  interpretDataset,
  type CreateDatasetInput,
  type FactorAnalysis,
  type FactorCatalog,
  type FactorDataset,
  type FactorInterpretation,
  type FactorKind,
  type InterpretationStatus,
} from "@/lib/api";
import { PREVIEW_ROWS, defaultOptions, downloadBlob, type AnalysisOptions, type ExportFormat } from "@/lib/factor-analysis";
import { cn } from "@/lib/utils";
import { localizeCatalog, useLocale, useT, useTMaybe } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { OnboardingTour, useOnboarding } from "@/components/onboarding-tour";
import { DataForm, DataSummary } from "./data-step";
import { DatasetView } from "./dataset-step";
import { SuitabilityView } from "./suitability-step";
import { FactorsView } from "./factors-step";
import { LoadingsView } from "./loadings-step";
import { InterpretationView } from "./interpretation-step";
import { FactorTour } from "./factor-tour";
import {
  EmptyStep,
  StepBadge,
  StepSection,
  stepAnchor,
  type StepId,
  type StepState,
} from "./step-section";

const POLL_MS = 1500;
// Polling slows down while the browser tab is hidden.
const HIDDEN_POLL_MS = 15000;
const ANALYZE_DEBOUNCE_MS = 300;

/** What an interpretation was requested for; a change of any part makes it stale. */
function interpretationKey(datasetId: string, options: AnalysisOptions, locale: string) {
  return JSON.stringify([datasetId, options, locale]);
}

function messageOf(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** The message of an API error in the UI language if its code is known, else as sent. */
function useErrorText() {
  const tMaybe = useTMaybe();
  return useCallback(
    (e: unknown, fallback: string) =>
      (e instanceof HttpError && e.code && tMaybe(`factor.errors.${e.code}`, e.params)) || messageOf(e, fallback),
    [tMaybe],
  );
}

/**
 * The factor analysis workflow (data, dataset, suitability, factors, loadings, and the optional
 * interpretation), shared by the model and the log complexity tab.
 */
export function FactorAnalysisView({ kind }: { kind: FactorKind }) {
  const t = useT();
  const { locale } = useLocale();
  const errorText = useErrorText();
  // Effects read texts through refs, so a language switch does not refetch anything.
  const tRef = useRef(t);
  const errorTextRef = useRef(errorText);
  useEffect(() => {
    tRef.current = t;
    errorTextRef.current = errorText;
  }, [t, errorText]);
  const storageKey = `app.factor-dataset-${kind}`;

  const [rawCatalog, setCatalog] = useState<FactorCatalog | null>(null);
  const catalog = useMemo(() => rawCatalog && localizeCatalog(rawCatalog, locale), [rawCatalog, locale]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogAttempt, setCatalogAttempt] = useState(0);

  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [dataset, setDataset] = useState<FactorDataset | null>(null);
  const [datasetError, setDatasetError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [options, setOptions] = useState<AnalysisOptions>(() => defaultOptions(kind));
  // The last successful result stays visible while a new one is computed or after an error.
  const [analysis, setAnalysis] = useState<FactorAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const onboarding = useOnboarding();
  // The options of the analysis on screen; a stored interpretation is looked up for them.
  const [analyzedOptions, setAnalyzedOptions] = useState<AnalysisOptions | null>(null);

  const [interpStatus, setInterpStatus] = useState<InterpretationStatus | null>(null);
  const [interpStatusFailed, setInterpStatusFailed] = useState(false);
  const [interpretation, setInterpretation] = useState<{ key: string; result: FactorInterpretation } | null>(null);
  const [interpreting, setInterpreting] = useState(false);
  const [interpretError, setInterpretError] = useState<string | null>(null);
  const interpretationRef = useRef(interpretation);
  const datasetIdRef = useRef(datasetId);
  useEffect(() => {
    interpretationRef.current = interpretation;
    datasetIdRef.current = datasetId;
  }, [interpretation, datasetId]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchInterpretationStatus(ctrl.signal)
      .then(setInterpStatus)
      .catch(() => {
        if (!ctrl.signal.aborted) setInterpStatusFailed(true);
      });
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setCatalogError(null);
    fetchFactorCatalog(kind, ctrl.signal)
      .then(setCatalog)
      .catch((e) => {
        if (!ctrl.signal.aborted) setCatalogError(errorTextRef.current(e, tRef.current("factor.data.catalog_failed")));
      });
    return () => ctrl.abort();
  }, [kind, catalogAttempt]);

  // Datasets live in the server session; remember the last one per tab. A link from the
  // jobs list (?dataset=<id>) takes precedence once; it is removed from the address, so a
  // reload shows the dataset chosen last.
  useEffect(() => {
    const linked = new URLSearchParams(window.location.search).get("dataset");
    if (linked) window.history.replaceState(window.history.state, "", window.location.pathname);
    try {
      if (linked) localStorage.setItem(storageKey, linked);
      const saved = linked ?? localStorage.getItem(storageKey);
      if (saved) setDatasetId(saved);
    } catch {
      if (linked) setDatasetId(linked);
    }
  }, [storageKey]);

  const selectDataset = useCallback(
    (id: string | null) => {
      setDatasetId(id);
      setDataset(null);
      setDatasetError(null);
      setAnalysis(null);
      setAnalysisError(null);
      setAnalyzedOptions(null);
      setInterpretation(null);
      setInterpretError(null);
      // A request for the old dataset is aborted and would not reset this itself.
      setAnalyzing(false);
      // Keep rotation and thresholds, but exclusions and the factor count belong to the old data.
      setOptions((o) => ({ ...o, excluded: [], n_factors: null }));
      try {
        if (id) localStorage.setItem(storageKey, id);
        else localStorage.removeItem(storageKey);
      } catch {
        /* storage blocked */
      }
    },
    [storageKey],
  );

  // Load the dataset and poll while its measures are computed.
  useEffect(() => {
    if (!datasetId) return;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const interval = () => (document.hidden ? HIDDEN_POLL_MS : POLL_MS);
    const load = async () => {
      try {
        const d = await fetchDataset(datasetId, ctrl.signal, PREVIEW_ROWS);
        if (d.kind !== kind) {
          selectDataset(null);
          return;
        }
        setDataset(d);
        setDatasetError(null);
        if (d.status === "computing") timer = setTimeout(load, interval());
      } catch (e) {
        if (ctrl.signal.aborted) return;
        if (e instanceof HttpError && e.status === 404) {
          // Expired with the session or deleted; start over.
          selectDataset(null);
          return;
        }
        setDatasetError(errorTextRef.current(e, tRef.current("factor.data.load_failed")));
        timer = setTimeout(load, interval() * 4);
      }
    };
    load();
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [datasetId, kind, selectDataset]);

  const ready = !!dataset && dataset.status === "ready" && dataset.id === datasetId;

  // Re-run the analysis on every parameter change, debounced.
  useEffect(() => {
    if (!ready || !datasetId) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setAnalyzing(true);
      try {
        const res = await analyzeDataset(datasetId, options, ctrl.signal);
        setAnalysis(res);
        setAnalyzedOptions(options);
        setAnalysisError(null);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setAnalysisError(errorTextRef.current(e, tRef.current("factor.analysis.failed")));
      } finally {
        if (!ctrl.signal.aborted) setAnalyzing(false);
      }
    }, ANALYZE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [ready, datasetId, options]);

  // Show a stored interpretation of the analysis on screen without asking for a new one:
  // precomputed for a bundled dataset, or requested before. Never calls the model. Without a
  // key only bundled datasets can have one. The factor count of the analysis lets the server
  // look it up without running the analysis again.
  const lookupInterpretation =
    !!interpStatus && (interpStatus.available || (interpStatus.precomputed_only && dataset?.source === "bundled"));
  const analyzedFactors = analysis?.n_factors ?? null;
  useEffect(() => {
    if (!ready || !datasetId || !analyzedOptions || analyzedFactors === null || !lookupInterpretation) return;
    const key = interpretationKey(datasetId, analyzedOptions, locale);
    if (interpretationRef.current?.key === key) return;
    const ctrl = new AbortController();
    const lookup = { ...analyzedOptions, n_factors: analyzedFactors };
    interpretDataset(datasetId, lookup, locale, { cachedOnly: true, signal: ctrl.signal })
      .then((res) => {
        if (res) setInterpretation({ key, result: res });
      })
      .catch(() => {
        // Nothing to show; asking for an interpretation reports errors.
      });
    return () => ctrl.abort();
  }, [ready, datasetId, analyzedOptions, analyzedFactors, locale, lookupInterpretation]);

  // Only the analysis on screen can be interpreted or downloaded as a whole: during the
  // debounce after a change of the settings, `options` are already ahead of it.
  const analysisCurrent = !!analyzedOptions && analyzedOptions === options && !analyzing;

  const runInterpretation = async () => {
    if (!datasetId || !analyzedOptions || !analysisCurrent) return;
    const forDataset = datasetId;
    const forOptions = analyzedOptions;
    const key = interpretationKey(datasetId, forOptions, locale);
    setInterpreting(true);
    setInterpretError(null);
    try {
      const res = await interpretDataset(datasetId, forOptions, locale);
      if (res && datasetIdRef.current === forDataset) setInterpretation({ key, result: res });
    } catch (e) {
      if (datasetIdRef.current === forDataset) setInterpretError(errorText(e, t("factor.interpretation.failed")));
    } finally {
      setInterpreting(false);
    }
  };

  const updateOptions = useCallback(
    (patch: Partial<AnalysisOptions>) => {
      setOptions((o) => {
        const next = { ...o, ...patch };
        // Keep an explicit factor count below the number of measures left.
        if (patch.excluded && next.n_factors !== null && dataset) {
          const max = Math.max(1, dataset.measures.length - next.excluded.length - 1);
          next.n_factors = Math.min(next.n_factors, max);
        }
        return next;
      });
    },
    [dataset],
  );

  const submit = async (input: CreateDatasetInput) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await createDataset(input);
      selectDataset(res.dataset_id);
      setChoosing(false);
    } catch (e) {
      setSubmitError(errorText(e, t("factor.data.submit_failed")));
    } finally {
      setSubmitting(false);
    }
  };

  const cancelJob = async () => {
    if (dataset?.job_id && !(await abortTask(dataset.job_id))) {
      setDatasetError(t("factor.data.cancel_failed"));
      return;
    }
    selectDataset(null);
  };

  const runExport = async (format: ExportFormat) => {
    if (!datasetId) return;
    setExporting(format);
    setExportError(null);
    try {
      if (format === "zip") {
        // The button is enabled only while both are the same: the ZIP holds what is shown.
        await downloadAnalysisZip(datasetId, analyzedOptions ?? options, locale);
      } else {
        const { blob, filename } = await exportLoadings(datasetId, options, format);
        downloadBlob(blob, filename);
      }
    } catch (e) {
      setExportError(errorText(e, t("factor.loadings.export_failed")));
    } finally {
      setExporting(null);
    }
  };

  const names = useMemo(() => new Map((catalog?.measures ?? []).map((m) => [m.key, m.name])), [catalog]);
  const measureName = useCallback((key: string) => names.get(key) ?? key, [names]);

  const suitable = analysis ? analysis.bartlett.passed && analysis.kmo.passed : false;
  const interpretationStale =
    !!interpretation && (!datasetId || interpretation.key !== interpretationKey(datasetId, options, locale));
  const pendingAnalysis = ready && !analysis && !analysisError;
  const resultState: StepState = !ready
    ? "locked"
    : analysis
      ? "done"
      : analysisError
        ? "warn"
        : "busy";
  const states: Record<StepId, StepState> = {
    data: !dataset
      ? "active"
      : dataset.status === "computing"
        ? "busy"
        : dataset.status === "failed"
          ? "warn"
          : "done",
    dataset: ready ? "done" : dataset?.status === "computing" ? "busy" : "locked",
    suitability: resultState === "done" ? (suitable ? "done" : "warn") : resultState,
    factors: resultState,
    loadings: resultState,
    interpretation:
      resultState !== "done"
        ? "locked"
        : interpreting
          ? "busy"
          : interpretation
            ? interpretationStale
              ? "warn"
              : "done"
            : interpStatus?.available
              ? "active"
              : "locked",
  };
  // Locked for want of a key, not because an earlier step is missing.
  const stateLabels: Partial<Record<StepId, string>> =
    resultState === "done" && interpStatus && !interpStatus.available && !interpretation
      ? { interpretation: t("factor.interpretation.state_needs_key") }
      : {};

  const updating = analyzing ? (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" role="status">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      {t("factor.analysis.updating")}
    </span>
  ) : null;

  const lockedHint = (
    <EmptyStep>
      {dataset?.status === "computing" ? t("factor.empty.computing") : t("factor.empty.no_dataset")}
    </EmptyStep>
  );
  const resultPlaceholder = (
    <EmptyStep icon={pendingAnalysis ? <Loader2 className="h-5 w-5 animate-spin text-accent-ink" /> : undefined}>
      {pendingAnalysis ? t("factor.empty.analyzing") : t("factor.empty.after_error")}
    </EmptyStep>
  );
  // Results that no longer match the parameters are dimmed until the new ones arrive.
  const stale = cn("transition-opacity", (analyzing || analysisError) && "opacity-60");

  return (
    <div className="space-y-6">
      <OnboardingTour open={onboarding.open} onClose={onboarding.close} />
      <FactorTour kind={kind} run={tourOpen} onClose={() => setTourOpen(false)} />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{t(`factor.${kind}.title`)}</h1>
          <p className="text-sm text-muted mt-1 leading-relaxed">{t(`factor.${kind}.subtitle`)}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {kind === "model" && (
            <Link
              href="/inspect"
              title={t("factor.model.inspect_title")}
              className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md bg-tile hover:bg-accent/[0.08] transition text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Microscope className="h-3.5 w-3.5" />
              {t("factor.model.inspect_link")}
            </Link>
          )}
          <Button variant="outline" size="sm" onClick={() => setTourOpen(true)} title={t("factor.tour_title")}>
            <HelpCircle className="h-3.5 w-3.5" />
            {t("factor.tour_button")}
          </Button>
        </div>
      </header>

      <div className="lg:grid lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:gap-8 lg:items-start">
        <StepRail states={states} stateLabels={stateLabels} />

        <div className="space-y-6 min-w-0">
          <StepSection
            id="data"
            n={1}
            state={states.data}
            title={t("factor.steps.data")}
            description={t(`factor.step_desc.data_${kind}`)}
          >
            {catalogError ? (
              <div role="alert" className="rounded-lg bg-danger/10 px-3.5 py-3 flex items-start gap-2.5 text-sm">
                <AlertCircle className="h-4 w-4 text-danger-ink shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <div>{t("factor.data.catalog_error", { error: catalogError })}</div>
                  <Button size="sm" variant="outline" onClick={() => setCatalogAttempt((n) => n + 1)}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t("common.try_again")}
                  </Button>
                </div>
              </div>
            ) : !catalog ? (
              <div className="text-sm text-muted flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("common.loading")}
              </div>
            ) : choosing || !datasetId ? (
              <DataForm
                kind={kind}
                catalog={catalog}
                submitting={submitting}
                submitError={submitError}
                onSubmit={submit}
                onCancel={dataset && choosing ? () => setChoosing(false) : undefined}
              />
            ) : dataset ? (
              <DataSummary dataset={dataset} onChange={() => setChoosing(true)} onCancelJob={cancelJob} />
            ) : datasetError ? (
              <Button variant="outline" size="sm" onClick={() => selectDataset(null)}>
                {t("factor.data.change")}
              </Button>
            ) : (
              <div className="text-sm text-muted flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("common.loading")}
              </div>
            )}
            {datasetError && (
              <p role="alert" className="mt-3 text-xs text-danger-ink">
                {datasetError}
              </p>
            )}
          </StepSection>

          <StepSection
            id="dataset"
            n={2}
            state={states.dataset}
            title={t("factor.steps.dataset")}
            description={t("factor.step_desc.dataset")}
          >
            {ready && dataset ? <DatasetView dataset={dataset} measureName={measureName} /> : lockedHint}
          </StepSection>

          <StepSection
            id="suitability"
            n={3}
            state={states.suitability}
            title={t("factor.steps.suitability")}
            description={t("factor.step_desc.suitability")}
            actions={updating}
          >
            {!ready || !dataset ? (
              lockedHint
            ) : (
              <div className="space-y-4">
                {analysisError && (
                  <AnalysisError
                    message={analysisError}
                    stale={!!analysis}
                    options={options}
                    onOptions={updateOptions}
                  />
                )}
                <div className={stale}>
                  <SuitabilityView
                    dataset={dataset}
                    analysis={analysis}
                    options={options}
                    onOptions={updateOptions}
                    measureName={measureName}
                  />
                </div>
              </div>
            )}
          </StepSection>

          <StepSection
            id="factors"
            n={4}
            state={states.factors}
            title={t("factor.steps.factors")}
            description={t("factor.step_desc.factors")}
            actions={updating}
          >
            {!ready ? (
              lockedHint
            ) : analysis ? (
              <div className={stale}>
                <FactorsView analysis={analysis} options={options} onOptions={updateOptions} />
              </div>
            ) : (
              resultPlaceholder
            )}
          </StepSection>

          <StepSection
            id="loadings"
            n={5}
            state={states.loadings}
            title={t("factor.steps.loadings")}
            description={t("factor.step_desc.loadings")}
            actions={updating}
          >
            {!ready ? (
              lockedHint
            ) : analysis ? (
              <div className="space-y-3">
                {exportError && (
                  <p role="alert" className="text-xs text-danger-ink">
                    {exportError}
                  </p>
                )}
                <div className={stale}>
                  <LoadingsView
                    analysis={analysis}
                    options={options}
                    onOptions={updateOptions}
                    measureName={measureName}
                    onExport={runExport}
                    exporting={exporting}
                    zipReady={analysisCurrent}
                  />
                </div>
              </div>
            ) : (
              resultPlaceholder
            )}
          </StepSection>

          <StepSection
            id="interpretation"
            n={6}
            state={states.interpretation}
            title={t("factor.steps.interpretation")}
            description={t("factor.step_desc.interpretation")}
          >
            {!ready ? (
              lockedHint
            ) : analysis ? (
              <InterpretationView
                status={interpStatus}
                statusFailed={interpStatusFailed}
                interpretation={interpretation?.result ?? null}
                stale={interpretationStale}
                running={interpreting}
                error={interpretError}
                canRun={analysisCurrent}
                onInterpret={runInterpretation}
                measureName={measureName}
              />
            ) : (
              resultPlaceholder
            )}
          </StepSection>
        </div>
      </div>
    </div>
  );
}

function AnalysisError({
  message,
  stale,
  options,
  onOptions,
}: {
  message: string;
  stale: boolean;
  options: AnalysisOptions;
  onOptions: (patch: Partial<AnalysisOptions>) => void;
}) {
  const t = useT();
  return (
    <div role="alert" className="rounded-lg bg-danger/10 px-3.5 py-3 flex items-start gap-2.5 text-sm">
      <AlertCircle className="h-4 w-4 text-danger-ink shrink-0 mt-0.5" />
      <div className="space-y-2 min-w-0">
        <div>
          <div className="font-medium">{t("factor.analysis.failed_title")}</div>
          <div className="text-muted mt-0.5 break-words">{message}</div>
        </div>
        <p className="text-xs text-muted">
          {stale && `${t("factor.analysis.stale_note")} `}
          {t("factor.analysis.failed_hint")}
        </p>
        <div className="flex gap-2 flex-wrap">
          {options.n_factors !== null && (
            <Button size="sm" variant="outline" onClick={() => onOptions({ n_factors: null })}>
              {t("factor.analysis.reset_factors")}
            </Button>
          )}
          {options.excluded.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => onOptions({ excluded: [] })}>
              {t("factor.suitability.include_all")}
            </Button>
          )}
          {!options.auto_msa_filter && (
            <Button size="sm" variant="outline" onClick={() => onOptions({ auto_msa_filter: true })}>
              {t("factor.analysis.enable_filter")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

const STEP_IDS: StepId[] = ["data", "dataset", "suitability", "factors", "loadings", "interpretation"];

function StepRail({
  states,
  stateLabels,
}: {
  states: Record<StepId, StepState>;
  /** Replaces the generic text of a state for screen readers, e.g. why a step is locked. */
  stateLabels: Partial<Record<StepId, string>>;
}) {
  const t = useT();
  return (
    <nav aria-label={t("factor.steps.aria")} className="mb-6 lg:mb-0 lg:sticky lg:top-6">
      <ol className="flex lg:flex-col gap-1 overflow-x-auto no-scrollbar -mx-1 px-1 lg:mx-0 lg:px-0">
        {STEP_IDS.map((id, i) => {
          const state = states[id];
          return (
            <li key={id} className="relative shrink-0">
              {i < STEP_IDS.length - 1 && (
                <span aria-hidden className="hidden lg:block absolute left-[22px] top-10 bottom-[-0.5rem] w-px bg-border" />
              )}
              <a
                href={`#${stepAnchor(id)}`}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2 py-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  state === "locked" ? "text-muted hover:bg-surface/60" : "hover:bg-surface",
                )}
              >
                <StepBadge n={i + 1} state={state} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium whitespace-nowrap">{t(`factor.steps.${id}`)}</span>
                  <span className="hidden lg:block text-[11px] text-muted leading-snug">
                    {t(`factor.rail.${id}`)}
                  </span>
                  <span className="sr-only"> ({stateLabels[id] ?? t(`factor.state.${state}`)})</span>
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

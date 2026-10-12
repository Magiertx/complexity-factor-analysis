"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, HelpCircle, Info, Loader2, Microscope, RotateCcw, X } from "lucide-react";
import { analysisLinkQuery, parseAnalysisLink } from "@/lib/analysis-link";
import {
  HttpError,
  abortTask,
  isSuperseded,
  analyzeDataset,
  createDataset,
  deleteDataset,
  downloadAnalysisZip,
  exportLoadings,
  fetchDataset,
  fetchFactorCatalog,
  fetchInterpretationStatus,
  interpretDataset,
  listDatasets,
  saveDatasetOptions,
  type CreateDatasetInput,
  type DatasetSummary,
  type FactorAnalysis,
  type FactorCatalog,
  type FactorDataset,
  type FactorInterpretation,
  type FactorKind,
  type InterpretationStatus,
} from "@/lib/api";
import {
  PREVIEW_ROWS,
  countText,
  datasetName,
  defaultOptions,
  dimensionCount,
  downloadBlob,
  initialOptions,
  optionsFromSaved,
  publishedOptions,
  sameOptions,
  solutionNeedsAttention,
  unassignedMeasures,
  type AnalysisOptions,
  type ExportFormat,
} from "@/lib/factor-analysis";
import { formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { localizeCatalog, useLocale, useT, useTMaybe } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { UndoToast, type UndoNotice } from "@/components/ui/undo-toast";
import { useJobsDrawer } from "@/components/jobs-drawer";
import { OnboardingTour, useOnboarding } from "@/components/onboarding-tour";
import { PageHeader } from "@/components/page-header";
import { DataForm, DataSummary, type OpenPreset } from "./data-step";
import { DatasetView } from "./dataset-step";
import { SuitabilityView } from "./suitability-step";
import { FactorsView } from "./factors-step";
import { LoadingsView } from "./loadings-step";
import { InterpretationView } from "./interpretation-step";
import { FactorTour } from "./factor-tour";
import { SettingsRow } from "./settings-row";
import { StartHere } from "./start-here";
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
const SAVE_OPTIONS_DEBOUNCE_MS = 1000;

/** What an interpretation was requested for; a change of any part makes it stale. */
function interpretationKey(datasetId: string, options: AnalysisOptions, locale: string) {
  return JSON.stringify([datasetId, options, locale]);
}

function messageOf(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * The message of an API error in the UI language if its code is known, else as sent. Codes the
 * whole API shares, such as a full run quota, are translated under errors.*.
 */
function useErrorText() {
  const tMaybe = useTMaybe();
  return useCallback(
    (e: unknown, fallback: string) =>
      (e instanceof HttpError &&
        e.code &&
        (tMaybe(`factor.errors.${e.code}`, e.params) ?? tMaybe(`errors.${e.code}`, e.params))) ||
      messageOf(e, fallback),
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
  // The dataset that was open answered 404; said instead of starting over silently.
  const [gone, setGone] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // A link to an analysis of a bundled dataset, waiting for the catalog, and what became of it.
  const [linkRequest, setLinkRequest] = useState<URLSearchParams | null>(null);
  const [linkNotice, setLinkNotice] = useState<{ tone: "busy" | "info" | "error"; text: string } | null>(null);
  // The datasets of this kind in the session, offered for reopening in the data step.
  const [datasets, setDatasets] = useState<DatasetSummary[] | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Changes whenever jobs come or go, e.g. one deleted in the jobs drawer next to this view.
  const { count: jobCount } = useJobsDrawer();

  const [options, setOptions] = useState<AnalysisOptions>(() => defaultOptions(kind));
  const standard = useMemo(() => defaultOptions(kind), [kind]);
  // "Reset to standard" and "Use paper settings" can be undone once, from a toast.
  const [undo, setUndo] = useState<(UndoNotice & { previous: AnalysisOptions }) | null>(null);
  // The dataset whose saved options were applied, and the options the server has for it.
  const optionsAppliedFor = useRef<string | null>(null);
  // Settings chosen for a dataset about to open (the paper's or the standard), which replace
  // those saved with it.
  const openWith = useRef<{ id: string; options: AnalysisOptions; message: string } | null>(null);
  // The options of the moment, for callbacks that must not change with them.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);
  const savedOptions = useRef<{ id: string; json: string | null } | null>(null);
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

  // Datasets live in the server session; remember the last one per tab. A link to one
  // (?dataset=<id>) is opened by DatasetLink and takes precedence.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setDatasetId(saved);
    } catch {
      /* storage blocked */
    }
  }, [storageKey]);

  const selectDataset = useCallback(
    (id: string | null) => {
      setDatasetId(id);
      setDataset(null);
      setDatasetError(null);
      setDeleteError(null);
      if (id) setGone(false);
      setAnalysis(null);
      setAnalysisError(null);
      setAnalyzedOptions(null);
      setInterpretation(null);
      setInterpretError(null);
      setUndo(null);
      // A request for the old dataset is aborted and would not reset this itself.
      setAnalyzing(false);
      // Every dataset has its own options; those saved with it are applied once it has loaded.
      setOptions(defaultOptions(kind));
      optionsAppliedFor.current = null;
      try {
        if (id) localStorage.setItem(storageKey, id);
        else localStorage.removeItem(storageKey);
      } catch {
        /* storage blocked */
      }
    },
    [storageKey, kind],
  );

  // Opens a dataset of the session: from the list in the data step or from a link.
  const openDataset = useCallback(
    (id: string) => {
      setChoosing(false);
      if (id !== datasetIdRef.current) selectDataset(id);
    },
    [selectDataset],
  );

  // Deleted, or expired with the session: back to the form, with a note why.
  const datasetGone = useCallback(() => {
    selectDataset(null);
    setGone(true);
  }, [selectDataset]);

  // Load the dataset and poll while its measures are computed. Loaded again when jobs come or
  // go, since deleting the job of a computed dataset deletes the dataset as well.
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
        // Once per opening, start from the options saved with the dataset. Set together with
        // the dataset, so that the first analysis already uses them.
        if (d.status === "ready" && optionsAppliedFor.current !== d.id) {
          optionsAppliedFor.current = d.id;
          const saved = d.options ? JSON.stringify(optionsFromSaved(kind, d.options)) : null;
          savedOptions.current = { id: d.id, json: saved };
          const own = initialOptions(kind, d.options, d.measures);
          const chosen = openWith.current?.id === d.id ? openWith.current : null;
          openWith.current = null;
          if (chosen) {
            setOptions(chosen.options);
            // A copy reopened from the session had settings of its own; they are one click away.
            if (d.options && !sameOptions(own, chosen.options)) {
              setUndo({ id: Date.now(), message: chosen.message, previous: own, returnFocus: summaryTitle.current });
            }
          } else {
            setOptions(own);
          }
        }
        setDataset(d);
        setDatasetError(null);
        if (d.status === "computing") timer = setTimeout(load, interval());
      } catch (e) {
        if (ctrl.signal.aborted) return;
        if (e instanceof HttpError && e.status === 404) {
          datasetGone();
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
  }, [datasetId, kind, selectDataset, datasetGone, jobCount]);

  // The list for the data step: fetched again when the form opens, when jobs come or go and
  // when the open dataset is ready or failed. While the form shows a dataset that is computed,
  // it is polled, so that dataset does not stay "computing" once its job is done.
  const formOpen = choosing || !datasetId;
  const datasetStatus = dataset?.status;
  useEffect(() => {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      listDatasets(kind, ctrl.signal).then(
        (list) => {
          if (ctrl.signal.aborted) return;
          setDatasets(list);
          if (formOpen && list.some((d) => d.status === "computing")) {
            timer = setTimeout(load, document.hidden ? HIDDEN_POLL_MS : POLL_MS);
          }
        },
        () => {
          // Without the list the data step offers new data only.
          if (!ctrl.signal.aborted) setDatasets((list) => list ?? []);
        },
      );
    load();
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [kind, formOpen, jobCount, datasetStatus]);

  const ready = !!dataset && dataset.status === "ready" && dataset.id === datasetId;

  // Re-run the analysis on every parameter change, debounced. A change aborts the request before
  // it, and the server drops a request that a newer one of the session replaced (409
  // "superseded"). Replaced without a newer one of this page, e.g. by another tab on the same
  // dataset, it is tried once more before that counts as an error.
  useEffect(() => {
    if (!ready || !datasetId) return;
    const ctrl = new AbortController();
    const run = () =>
      analyzeDataset(datasetId, options, ctrl.signal).catch(async (e) => {
        if (!isSuperseded(e) || ctrl.signal.aborted) throw e;
        await new Promise((resolve) => setTimeout(resolve, ANALYZE_DEBOUNCE_MS));
        return analyzeDataset(datasetId, options, ctrl.signal);
      });
    const timer = setTimeout(async () => {
      setAnalyzing(true);
      try {
        const res = await run();
        setAnalysis(res);
        setAnalyzedOptions(options);
        setAnalysisError(null);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        if (e instanceof HttpError && e.status === 404) {
          datasetGone();
          return;
        }
        setAnalysisError(errorTextRef.current(e, tRef.current("factor.analysis.failed")));
      } finally {
        if (!ctrl.signal.aborted) setAnalyzing(false);
      }
    }, ANALYZE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [ready, datasetId, options, datasetGone]);

  // Remember the options of every new analysis with its dataset, so that reopening the dataset
  // starts from them. Nothing depends on the answer; a failure only costs that convenience.
  const pendingSave = useRef<(() => void) | null>(null);
  useEffect(() => {
    pendingSave.current = null;
    if (!datasetId || !analyzedOptions) return;
    const json = JSON.stringify(analyzedOptions);
    const saved = savedOptions.current;
    if (saved?.id === datasetId && saved.json === json) return;
    const save = () => {
      pendingSave.current = null;
      saveDatasetOptions(datasetId, analyzedOptions).then(
        () => {
          if (datasetIdRef.current === datasetId) savedOptions.current = { id: datasetId, json };
        },
        (e) => {
          // A dataset deleted meanwhile needs no options.
          if (!(e instanceof HttpError && e.status === 404)) console.error("Could not save the analysis options", e);
        },
      );
    };
    pendingSave.current = save;
    const timer = setTimeout(save, SAVE_OPTIONS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [datasetId, analyzedOptions]);

  // Leaving the tab, the page or the dataset sends a save still waiting for its debounce.
  useEffect(() => {
    const flush = () => pendingSave.current?.();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [datasetId]);

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

  // All settings at once, from the settings row; the toast offers to go back.
  const applyOptions = (next: AnalysisOptions, which: "standard" | "published") => {
    setUndo({
      id: Date.now(),
      message: t(which === "standard" ? "factor.settings.reset_done" : "factor.settings.paper_done"),
      previous: options,
      returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    });
    setOptions(next);
  };

  // Set when the form closes on a choice made in it: the focused button goes away with the
  // form, so the summary that replaces it takes the focus once it is shown.
  const focusSummary = useRef(false);
  const summaryTitle = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusSummary.current || formOpen || !dataset) return;
    focusSummary.current = false;
    summaryTitle.current?.focus();
  }, [formOpen, dataset]);

  const openChosen = (id: string) => {
    focusSummary.current = true;
    openDataset(id);
  };

  const cancelChoice = () => {
    focusSummary.current = true;
    setChoosing(false);
  };

  /** The settings a bundled dataset opens with, and what the toast says if they replace others. */
  const presetOptions = useCallback(
    (bundledId: string, preset: OpenPreset) => {
      const paper =
        preset === "published" ? publishedOptions(kind, rawCatalog?.bundled.find((b) => b.id === bundledId)) : null;
      return paper
        ? { options: paper, message: t("factor.data.opened_paper") }
        : { options: defaultOptions(kind), message: t("factor.data.opened_standard") };
    },
    [kind, rawCatalog, t],
  );

  /**
   * Opens a dataset the server created or, for a bundled one the session already has, handed
   * back; with `preset`, a bundled dataset opens with those settings.
   */
  const openCreated = useCallback(
    (id: string, preset: { options: AnalysisOptions; message: string } | null) => {
      if (id === datasetIdRef.current) {
        // The open dataset itself came back: it stays loaded, only the settings change.
        const current = optionsRef.current;
        if (preset && !sameOptions(current, preset.options)) {
          setUndo({ id: Date.now(), message: preset.message, previous: current, returnFocus: summaryTitle.current });
          setOptions(preset.options);
        }
        setChoosing(false);
        return;
      }
      openWith.current = preset && { id, ...preset };
      selectDataset(id);
      setChoosing(false);
    },
    [selectDataset],
  );

  // Opens the bundled dataset of a link (?bundled=...) with its settings, reusing the session's
  // copy if there is one. Settings that cannot be read give the standard and a notice.
  useEffect(() => {
    if (!linkRequest || !rawCatalog) return;
    setLinkRequest(null);
    const parsed = parseAnalysisLink(linkRequest, defaultOptions(kind), new Set(rawCatalog.measures.map((m) => m.key)));
    if (!parsed) return;
    const entry = rawCatalog.bundled.find((b) => b.id === parsed.bundledId);
    if (!entry) {
      setLinkNotice({ tone: "error", text: tRef.current("factor.link.unknown") });
      return;
    }
    const paper = parsed.preset === "published" ? publishedOptions(kind, entry) : null;
    const invalid = parsed.invalid || (parsed.preset === "published" && !paper);
    setLinkNotice({ tone: "busy", text: tRef.current("factor.link.opening") });
    createDataset({ kind, source: "bundled", bundledId: entry.id }).then(
      (res) => {
        focusSummary.current = true;
        openCreated(res.dataset_id, { options: paper ?? parsed.options, message: tRef.current("factor.link.opened") });
        setLinkNotice(invalid ? { tone: "info", text: tRef.current("factor.link.invalid") } : null);
      },
      (e) => setLinkNotice({ tone: "error", text: errorTextRef.current(e, tRef.current("factor.link.failed")) }),
    );
  }, [linkRequest, rawCatalog, kind, openCreated]);

  const submit = async (input: CreateDatasetInput, preset: OpenPreset) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await createDataset(input);
      focusSummary.current = true;
      openCreated(res.dataset_id, input.source === "bundled" && input.bundledId ? presetOptions(input.bundledId, preset) : null);
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

  // Set when the open dataset is deleted from its summary, the last one from the list in the
  // form, or the notice of a gone dataset is dismissed: the focused button goes away, so the
  // form that is shown then takes the focus.
  const focusForm = useRef(false);
  useEffect(() => {
    if (!focusForm.current || !formOpen || !datasets) return;
    focusForm.current = false;
    const step = document.getElementById(stepAnchor("data"));
    (step?.querySelector<HTMLElement>("input:checked") ?? step?.querySelector<HTMLElement>("button"))?.focus();
  }, [formOpen, datasets, gone]);

  const removeDataset = async (id: string) => {
    setDeleteError(null);
    try {
      await deleteDataset(id);
    } catch (e) {
      // Gone already is as good as deleted.
      if (!(e instanceof HttpError && e.status === 404)) {
        setDeleteError(errorText(e, t("factor.data.delete_failed")));
        return false;
      }
    }
    setDatasets((list) => list && list.filter((d) => d.id !== id));
    // With others left, the list hands the focus on itself.
    if (formOpen && datasets?.every((d) => d.id === id)) focusForm.current = true;
    if (id === datasetIdRef.current) {
      if (!formOpen) focusForm.current = true;
      selectDataset(null);
      setChoosing(false);
    }
    return true;
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
  // The tooltip of a measure: its full name, which a cell may cut off, and what it measures.
  const titles = useMemo(
    () =>
      new Map((catalog?.measures ?? []).map((m) => [m.key, m.description ? `${m.name}\n${m.description}` : m.name])),
    [catalog],
  );
  const measureTitle = useCallback((key: string) => titles.get(key) ?? key, [titles]);

  // The catalog entry of a bundled dataset, and the settings of its paper if it has them.
  const bundled = dataset?.bundled_id ? catalog?.bundled.find((b) => b.id === dataset.bundled_id) : undefined;
  const published = useMemo(() => publishedOptions(kind, bundled), [kind, bundled]);
  // Only for the analysis on screen, and only while the settings are still those it ran with.
  const match =
    analysis && analyzedOptions && sameOptions(analyzedOptions, options) ? (analysis.published_match ?? null) : null;
  const linkQuery = bundled ? analysisLinkQuery(bundled.id, options, standard, published) : null;

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
    factors: resultState === "done" && analysis && solutionNeedsAttention(analysis) ? "warn" : resultState,
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

  // One line per finished step for the step rail; settings are in the settings row instead.
  const summaries: Partial<Record<StepId, string>> = {};
  const finished = (id: StepId) => states[id] === "done" || states[id] === "warn";
  if (dataset && catalog && finished("data")) {
    summaries.data = bundled?.label ?? datasetName(dataset, t, catalog);
  }
  if (dataset && finished("dataset")) {
    summaries.dataset = [
      `${formatNumber(dataset.n_observations, locale)} × ${formatNumber(dataset.measures.length, locale)}`,
      dataset.dropped.length > 0 ? countText(t, "factor.rail_summary.removed", dataset.dropped.length) : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (analysis && finished("suitability")) {
    summaries.suitability = [
      t("factor.rail_summary.kmo", { value: formatNumber(analysis.kmo.overall, locale, 2) }),
      analysis.msa_filter.removed.length > 0
        ? countText(t, "factor.rail_summary.removed", analysis.msa_filter.removed.length)
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (analysis && finished("factors")) {
    summaries.factors = countText(t, "factor.rail_summary.factors", analysis.n_factors, {
      pct: formatPercent(analysis.variance.explained, locale),
    });
  }
  if (analysis && finished("loadings")) {
    const cross = analysis.cross_loadings?.length ?? 0;
    const unassigned = unassignedMeasures(analysis).length;
    summaries.loadings = [
      countText(t, "factor.rail_summary.dimensions", dimensionCount(analysis)),
      cross > 0 ? t("factor.rail_summary.cross", { n: cross }) : null,
      unassigned > 0 ? t("factor.rail_summary.unassigned", { n: unassigned }) : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

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
      <Suspense fallback={null}>
        <LinkReader onDataset={openDataset} onBundled={setLinkRequest} />
      </Suspense>

      <PageHeader
        title={t(`factor.${kind}.title`)}
        subtitle={t(`factor.${kind}.subtitle`)}
        actions={
          <>
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
          </>
        }
      />

      <div className="lg:grid lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:gap-8 lg:items-start">
        <StepRail states={states} stateLabels={stateLabels} summaries={summaries} />

        <div className="space-y-6 min-w-0">
          <StepSection
            id="data"
            n={1}
            state={states.data}
            title={t("factor.steps.data")}
            description={t(`factor.step_desc.data_${kind}`)}
          >
            {/* Always rendered, so screen readers announce the notices that appear in it. */}
            <div role="status">
              {linkNotice && (
                <div
                  className={cn(
                    "mb-4 rounded-lg px-3.5 py-2.5 flex items-start gap-2.5 text-sm",
                    linkNotice.tone === "error" ? "bg-danger/10" : "bg-tile",
                  )}
                >
                  {linkNotice.tone === "busy" ? (
                    <Loader2 className="h-4 w-4 text-accent-ink shrink-0 mt-0.5 animate-spin" />
                  ) : linkNotice.tone === "error" ? (
                    <AlertCircle className="h-4 w-4 text-danger-ink shrink-0 mt-0.5" />
                  ) : (
                    <Info className="h-4 w-4 text-muted shrink-0 mt-0.5" />
                  )}
                  <p className="flex-1 min-w-0">{linkNotice.text}</p>
                  {linkNotice.tone !== "busy" && (
                    <button
                      type="button"
                      onClick={() => setLinkNotice(null)}
                      aria-label={t("factor.data.dismiss_aria")}
                      className="h-6 w-6 -my-0.5 grid place-items-center rounded text-muted hover:text-fg hover:bg-accent/[0.08] transition shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
              {gone && (
                <div className="mb-4 rounded-lg bg-tile px-3.5 py-2.5 flex items-start gap-2.5 text-sm">
                  <Info className="h-4 w-4 text-muted shrink-0 mt-0.5" />
                  <p className="flex-1 min-w-0">{t("factor.data.gone")}</p>
                  <button
                    type="button"
                    onClick={() => {
                      // The button goes with the notice; the form below takes the focus.
                      focusForm.current = true;
                      setGone(false);
                    }}
                    aria-label={t("factor.data.dismiss_aria")}
                    className="h-6 w-6 -my-0.5 grid place-items-center rounded text-muted hover:text-fg hover:bg-accent/[0.08] transition shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
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
            ) : !catalog || (formOpen && !datasets) ? (
              <div className="text-sm text-muted flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("common.loading")}
              </div>
            ) : formOpen ? (
              <div className="space-y-5">
                <StartHere />
                <DataForm
                  kind={kind}
                  catalog={catalog}
                  datasets={datasets ?? []}
                  openId={datasetId}
                  submitting={submitting}
                  submitError={submitError}
                  onSubmit={submit}
                  onOpen={openChosen}
                  onDelete={removeDataset}
                  onCancel={dataset && choosing ? cancelChoice : undefined}
                />
              </div>
            ) : dataset ? (
              <DataSummary
                dataset={dataset}
                catalog={catalog}
                titleRef={summaryTitle}
                onChange={() => setChoosing(true)}
                onCancelJob={cancelJob}
                onDelete={() => removeDataset(dataset.id)}
              />
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
            {deleteError && (
              <p role="alert" className="mt-3 text-xs text-danger-ink">
                {deleteError}
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
            {ready && dataset ? <DatasetView dataset={dataset} measureName={measureName} measureTitle={measureTitle} /> : lockedHint}
          </StepSection>

          {/* Steps 3 to 5 share the settings row, which stays in view while they scroll by. A
              flex column, since gaps leave out the toast, which is fixed to the window. */}
          <div className="flex flex-col gap-6">
            {ready && dataset && (
              <SettingsRow
                options={options}
                standard={standard}
                published={published}
                publishedSource={bundled?.published_source}
                analysis={analysis}
                measureCount={dataset.measures.length}
                match={match}
                onApply={applyOptions}
                linkQuery={linkQuery}
              />
            )}
            {/* Shown at the bottom of the window, but next to the row in the tab order, so the
                "Undo" of a reset is a Tab away from the buttons that caused it. */}
            <UndoToast
              notice={undo}
              onUndo={() => {
                if (undo) setOptions(undo.previous);
                setUndo(null);
              }}
              onClose={() => setUndo(null)}
            />
            <StepSection
              id="suitability"
              n={3}
              stickyRow
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
                      kind={kind}
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
                      measureTitle={measureTitle}
                    />
                  </div>
                </div>
              )}
            </StepSection>

            <StepSection
              id="factors"
              n={4}
              stickyRow
              state={states.factors}
              title={t("factor.steps.factors")}
              description={t("factor.step_desc.factors")}
              actions={updating}
            >
              {!ready ? (
                lockedHint
              ) : analysis ? (
                <div className={stale}>
                  <FactorsView
                    analysis={analysis}
                    options={options}
                    onOptions={updateOptions}
                    paperFactors={published?.n_factors ?? null}
                  />
                </div>
              ) : (
                resultPlaceholder
              )}
            </StepSection>

            <StepSection
              id="loadings"
              n={5}
              stickyRow
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
                      measureTitle={measureTitle}
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
          </div>

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
                measureTitle={measureTitle}
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

/**
 * Opens the dataset of a link, also while the tab is already shown: one of the session
 * (?dataset=<id>, e.g. from a job card) or a bundled one with its settings (?bundled=<id>&...).
 * Removes the link from the address, so a reload shows the dataset chosen last. Its own
 * component, so that only it waits for the search params on the client.
 */
function LinkReader({
  onDataset,
  onBundled,
}: {
  onDataset: (id: string) => void;
  onBundled: (params: URLSearchParams) => void;
}) {
  const params = useSearchParams();
  const linked = params.get("dataset");
  const bundled = params.get("bundled");
  useEffect(() => {
    if (!linked && !bundled) return;
    const query = new URLSearchParams(window.location.search);
    // Without a state of its own, Next.js takes the new address over, so the same link opens
    // the dataset again later.
    window.history.replaceState(null, "", window.location.pathname);
    if (linked) onDataset(linked);
    else onBundled(query);
  }, [linked, bundled, onDataset, onBundled]);
  return null;
}

function AnalysisError({
  kind,
  message,
  stale,
  options,
  onOptions,
}: {
  kind: FactorKind;
  message: string;
  stale: boolean;
  options: AnalysisOptions;
  onOptions: (patch: Partial<AnalysisOptions>) => void;
}) {
  const t = useT();
  const defaultThreshold = defaultOptions(kind).msa_threshold;
  const fixes = {
    factors: options.n_factors !== null,
    excluded: options.excluded.length > 0,
    filter: !options.auto_msa_filter,
    // A threshold above the default can leave too few measures for the analysis.
    threshold: options.auto_msa_filter && options.msa_threshold > defaultThreshold,
  };
  const anyFix = Object.values(fixes).some(Boolean);
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
          {t(anyFix ? "factor.analysis.failed_hint" : "factor.analysis.failed_hint_no_fix")}
        </p>
        {anyFix && (
          <div className="flex gap-2 flex-wrap">
            {fixes.factors && (
              <Button size="sm" variant="outline" onClick={() => onOptions({ n_factors: null })}>
                {t("factor.analysis.reset_factors")}
              </Button>
            )}
            {fixes.excluded && (
              <Button size="sm" variant="outline" onClick={() => onOptions({ excluded: [] })}>
                {t("factor.suitability.include_all")}
              </Button>
            )}
            {fixes.filter && (
              <Button size="sm" variant="outline" onClick={() => onOptions({ auto_msa_filter: true })}>
                {t("factor.analysis.enable_filter")}
              </Button>
            )}
            {fixes.threshold && (
              <Button size="sm" variant="outline" onClick={() => onOptions({ msa_threshold: defaultThreshold })}>
                {t("factor.analysis.default_threshold", { value: defaultThreshold })}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const STEP_IDS: StepId[] = ["data", "dataset", "suitability", "factors", "loadings", "interpretation"];

/**
 * The step in view: the last one whose top has passed the upper third of the window, or the
 * last one on screen once the page cannot scroll further.
 */
function useStepInView(): StepId {
  const [active, setActive] = useState<StepId>("data");
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = window.innerHeight / 3;
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      let current: StepId = STEP_IDS[0];
      for (const id of STEP_IDS) {
        const top = document.getElementById(stepAnchor(id))?.getBoundingClientRect().top;
        if (top !== undefined && (top <= line || (atEnd && top < window.innerHeight))) current = id;
      }
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);
  return active;
}

function StepRail({
  states,
  stateLabels,
  summaries,
}: {
  states: Record<StepId, StepState>;
  /** Replaces the generic text of a state for screen readers, e.g. why a step is locked. */
  stateLabels: Partial<Record<StepId, string>>;
  /** What a finished step found, e.g. "KMO 0.75 · 2 removed"; else the step is described. */
  summaries: Partial<Record<StepId, string>>;
}) {
  const t = useT();
  const active = useStepInView();
  const listRef = useRef<HTMLOListElement>(null);
  // On a phone the rail scrolls sideways: keep the step in view visible in it, without moving
  // the page.
  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!list || !item || list.scrollWidth <= list.clientWidth) return;
    const left = item.offsetLeft - list.offsetLeft;
    if (left < list.scrollLeft || left + item.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollLeft = Math.max(0, left - 8);
    }
  }, [active]);
  return (
    <nav aria-label={t("factor.steps.aria")} className="mb-6 lg:mb-0 lg:sticky lg:top-6">
      <ol ref={listRef} className="flex lg:flex-col gap-1 overflow-x-auto no-scrollbar -mx-1 px-1 lg:mx-0 lg:px-0">
        {STEP_IDS.map((id, i) => {
          const state = states[id];
          const current = id === active;
          return (
            <li key={id} className="relative shrink-0">
              {i < STEP_IDS.length - 1 && (
                <span aria-hidden className="hidden lg:block absolute left-[22px] top-10 bottom-[-0.5rem] w-px bg-border" />
              )}
              <a
                href={`#${stepAnchor(id)}`}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2 py-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  state === "locked" ? "text-muted hover:bg-surface/60" : "hover:bg-surface",
                  current && "bg-surface",
                )}
              >
                <StepBadge n={i + 1} state={state} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium whitespace-nowrap">{t(`factor.steps.${id}`)}</span>
                  <span
                    className={cn(
                      "hidden lg:block text-[11px] leading-snug max-w-[9.5rem]",
                      summaries[id] ? "text-fg/80 line-clamp-2 break-words" : "text-muted",
                    )}
                    title={summaries[id]}
                  >
                    {summaries[id] ?? t(`factor.rail.${id}`)}
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

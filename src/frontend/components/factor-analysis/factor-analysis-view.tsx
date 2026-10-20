"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, Info, Loader2, RotateCcw, X } from "lucide-react";
import { analysisLinkQuery, parseAnalysisLink } from "@/lib/analysis-link";
import {
  HttpError,
  abortTask,
  isSuperseded,
  analyzeDataset,
  createDataset,
  datasetDownloadUrl,
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
import { ruleNote } from "@/lib/paper-notes";
import { CONTROL_STEPS, parseStep, stepFromHash, stepHref } from "@/lib/steps";
import { cn } from "@/lib/utils";
import { localizeCatalog, useLocale, useT, useTMaybe } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { UndoToast, type UndoNotice } from "@/components/ui/undo-toast";
import { useJobsDrawer } from "@/components/jobs-drawer";
import { OnboardingTour, useOnboarding } from "@/components/onboarding-tour";
import { PageHeader } from "@/components/page-header";
import { DataForm, DataSummary, type OpenPreset } from "./data-step";
import { DatasetView } from "./dataset-step";
import { DEFAULT_MEASURE_VIEW, SuitabilityView, type MeasureGroups, type MeasureView } from "./suitability-step";
import { FactorsView } from "./factors-step";
import { LoadingsView } from "./loadings-step";
import { InterpretationView } from "./interpretation-step";
import { FactorTour } from "./factor-tour";
import { SETTING_CONTROLS, SettingsRow, focusControl } from "./settings-row";
import { FactorToolbar, type ExportState } from "./toolbar";
import { StartHere } from "./start-here";
import { EmptyStep, StepSection, stepAnchor, type StepId, type StepState } from "./step-section";
import { StepBar, StepFooter, StepNavBar, StepRail, useStepNavigation, type StepLocks } from "./step-nav";

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
  const [linkRequest, setLinkRequest] = useState<{ params: URLSearchParams; step: StepId | null } | null>(null);
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
  // One step on screen at a time, named in the address (?step=...).
  const nav = useStepNavigation();
  const { goTo } = nav;
  // The step to open once a dataset just chosen is ready: the dataset step after "Use dataset" or
  // a link without a step of its own. Any navigation by hand before that cancels it.
  const [advance, setAdvance] = useState<{ id: string; to: StepId; replace: boolean } | null>(null);
  const go = useCallback(
    (step: StepId, opts?: Parameters<typeof goTo>[1]) => {
      setAdvance(null);
      goTo(step, opts);
    },
    [goTo],
  );
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
    goTo("data", { replace: true, focus: null });
  }, [selectDataset, goTo]);

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
          const applied = chosen ? chosen.options : own;
          // In the ref at once, not after the next render: a link to this dataset answered in
          // between compares its settings with these, and would else leave them in place.
          optionsRef.current = applied;
          setOptions(applied);
          // A copy reopened from the session had settings of its own; they are one click away.
          if (chosen && d.options && !sameOptions(own, chosen.options)) {
            setUndo({ id: Date.now(), message: chosen.message, previous: own, returnFocus: summaryTitle.current });
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
    setAdvance({ id, to: "dataset", replace: false });
  };

  // A dataset of the session from a link (?dataset=<id>, e.g. a job card): without a step of its
  // own the link opens the dataset step once the dataset is ready.
  const openLinked = useCallback(
    (id: string, step: StepId | null) => {
      openDataset(id);
      if (!step) setAdvance({ id, to: "dataset", replace: true });
    },
    [openDataset],
  );
  const openBundledLink = useCallback((params: URLSearchParams, step: StepId | null) => {
    setLinkRequest({ params, step });
  }, []);

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
        // The open dataset itself came back: it stays loaded, only the settings change. Still
        // loading, it takes them instead of its saved ones, like a dataset opened anew.
        const current = optionsRef.current;
        if (preset && optionsAppliedFor.current !== id) {
          openWith.current = { id, ...preset };
        } else if (preset && !sameOptions(current, preset.options)) {
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
    const { params, step } = linkRequest;
    const parsed = parseAnalysisLink(params, defaultOptions(kind), new Set(rawCatalog.measures.map((m) => m.key)));
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
        openCreated(res.dataset_id, {
          options: paper ?? parsed.options,
          message: tRef.current(invalid ? "factor.data.opened_standard" : "factor.link.opened"),
        });
        if (!step) setAdvance({ id: res.dataset_id, to: "dataset", replace: true });
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
      setAdvance({ id: res.dataset_id, to: "dataset", replace: false });
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
      goTo("data", { replace: true, focus: null });
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
  // What a measure measures, for the tooltip of its name, which a cell no longer cuts off.
  const descriptions = useMemo(
    () => new Map((catalog?.measures ?? []).map((m) => [m.key, m.description || undefined])),
    [catalog],
  );
  const measureDescription = useCallback((key: string) => descriptions.get(key), [descriptions]);
  // The feature groups of the log measures, for grouping the list of step 3; model measures have none.
  const measureGroups = useMemo<MeasureGroups | null>(() => {
    if (!catalog?.groups?.length) return null;
    const of = new Map(catalog.measures.map((m) => [m.key, m.group ?? null]));
    return { order: catalog.groups.map((g) => ({ key: g.key, name: g.name })), of: (m) => of.get(m) ?? null };
  }, [catalog]);
  // How the list of step 3 is shown, kept while other steps are open.
  const [measureView, setMeasureView] = useState<MeasureView>(DEFAULT_MEASURE_VIEW);

  // The catalog entry of a bundled dataset, and the settings of its paper if it has them.
  const bundled = dataset?.bundled_id ? catalog?.bundled.find((b) => b.id === dataset.bundled_id) : undefined;
  const published = useMemo(() => publishedOptions(kind, bundled), [kind, bundled]);
  // Only for the analysis on screen, and only while the settings are still those it ran with.
  const match =
    analysis && analyzedOptions && sameOptions(analyzedOptions, options) ? (analysis.published_match ?? null) : null;
  const linkQuery = bundled ? analysisLinkQuery(bundled.id, options, standard, published) : null;
  // Where the paper's dimension tables differ from the rule chosen, under the paper settings the
  // tables were made with; with other settings the paper says nothing about the groups.
  const assignmentNote =
    bundled && published && sameOptions({ ...options, assignment_rule: published.assignment_rule }, published)
      ? ruleNote(bundled.id, options.assignment_rule, t, locale)
      : null;

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

  // Why the steps after the data cannot be opened yet; they all need a dataset that is ready.
  const lockReason: string | null = ready
    ? null
    : !datasetId
      ? t("factor.nav.locked.no_dataset")
      : dataset?.id === datasetId && dataset.status === "computing"
        ? t("factor.nav.locked.computing")
        : dataset?.id === datasetId && dataset.status === "failed"
          ? t("factor.nav.locked.failed")
          : t("factor.nav.locked.loading");
  const locks: StepLocks = {
    data: null,
    dataset: lockReason,
    suitability: lockReason,
    factors: lockReason,
    loadings: lockReason,
    interpretation: lockReason,
  };
  const current = nav.step;

  // Open the step chosen for a dataset once it is ready; a dataset that failed stays on the data step.
  useEffect(() => {
    if (!advance) return;
    if (dataset?.id === advance.id && dataset.status === "failed") {
      setAdvance(null);
      return;
    }
    if (!ready || datasetId !== advance.id) return;
    setAdvance(null);
    goTo(advance.to, { replace: advance.replace });
  }, [advance, ready, datasetId, dataset, goTo]);

  // Once a step is on screen, its heading (or the control a chip of the settings row asked for)
  // takes the focus, and a step that begins above the window is scrolled to.
  const stepArea = useRef<HTMLDivElement>(null);
  const { takeFocus, visit } = nav;
  useEffect(() => {
    const focus = takeFocus();
    if (!focus) return;
    if (focus !== "heading") {
      focusControl(focus.control);
      return;
    }
    document.getElementById(`${stepAnchor(current)}-title`)?.focus({ preventScroll: true });
    const wide = window.matchMedia("(min-width: 1024px)").matches;
    const target = wide ? document.getElementById(stepAnchor(current)) : stepArea.current;
    if (!target) return;
    const pad = wide ? parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0 : 0;
    const top = target.getBoundingClientRect().top;
    if (top < pad) window.scrollBy({ top: top - pad });
  }, [visit, current, takeFocus]);

  // An anchor of the one-page layout before, followed inside the page, opens its step.
  useEffect(() => {
    const onHash = () => {
      const step = stepFromHash(window.location.hash);
      if (step) go(step, { replace: true });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [go]);

  /** A chip of the settings row: the step with its control, and the control focused. */
  const goToSetting = (chip: keyof typeof CONTROL_STEPS) => {
    const step = CONTROL_STEPS[chip];
    const control = SETTING_CONTROLS[chip];
    if (step === current) focusControl(control);
    else go(step, { focus: { control } });
  };

  // Start here and My datasets of the toolbar: the data step with its form open there.
  const [formRequest, setFormRequest] = useState<{ kind: "start" | "mine"; n: number } | null>(null);
  const formRequestHandled = useCallback(() => setFormRequest(null), []);
  const openForm = (which: "start" | "mine") => {
    go("data", { focus: null });
    if (dataset && !formOpen) setChoosing(true);
    setFormRequest({ kind: which, n: Date.now() });
  };

  // The tour opens the step of each stop, without an entry in the history for each.
  const tourStep = useCallback((step: StepId) => go(step, { replace: true, focus: null }), [go]);

  const updating = analyzing ? (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" role="status">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      {t("factor.analysis.updating")}
    </span>
  ) : null;

  const loadingDataset = !!datasetId && !ready && dataset?.status !== "computing" && dataset?.status !== "failed";
  const lockedHint = (
    <EmptyStep icon={loadingDataset ? <Loader2 className="h-5 w-5 animate-spin text-muted" /> : undefined}>
      <p>
        {!datasetId
          ? t("factor.empty.no_dataset")
          : dataset?.id === datasetId && dataset.status === "computing"
            ? t("factor.empty.computing")
            : dataset?.id === datasetId && dataset.status === "failed"
              ? t("factor.nav.locked.failed")
              : t("common.loading")}
      </p>
      {!loadingDataset && (
        <Button variant="outline" size="sm" className="mt-3" onClick={() => go("data")}>
          {t("factor.nav.to_data")}
        </Button>
      )}
    </EmptyStep>
  );
  const resultPlaceholder = (
    <EmptyStep icon={pendingAnalysis ? <Loader2 className="h-5 w-5 animate-spin text-accent-ink" /> : undefined}>
      {pendingAnalysis ? t("factor.empty.analyzing") : t("factor.empty.after_error")}
    </EmptyStep>
  );
  // Results that no longer match the parameters are dimmed until the new ones arrive.
  const stale = cn("transition-opacity", (analyzing || analysisError) && "opacity-60");

  const footer = (step: StepId) => (
    <StepFooter step={step} locks={locks} onGo={go} hideNext={step === "data" && formOpen} />
  );
  const navProps = { current, states, locks, stateLabels, onGo: go };

  const loadingsReason = !ready ? lockReason : !analysis ? t("factor.toolbar.wait_analysis") : null;
  const exports: ExportState = {
    datasetReason: ready ? null : lockReason,
    loadingsReason,
    // The ZIP holds what is on screen, so not while the analysis catches up with a change.
    zipReason: loadingsReason ?? (analysisCurrent ? null : t("factor.toolbar.wait_update")),
    datasetHref: ready && datasetId ? datasetDownloadUrl(datasetId) : null,
    exporting,
    onExport: runExport,
  };

  return (
    <div className="space-y-6">
      <OnboardingTour open={onboarding.open} onClose={onboarding.close} />
      <FactorTour kind={kind} run={tourOpen} onClose={() => setTourOpen(false)} onStep={tourStep} />
      <Suspense fallback={null}>
        <UrlReader onDataset={openLinked} onBundled={openBundledLink} onStep={nav.fromUrl} />
      </Suspense>

      <PageHeader
        title={t(`factor.${kind}.title`)}
        subtitle={t(`factor.${kind}.subtitle`)}
        actions={
          <FactorToolbar
            kind={kind}
            linkQuery={linkQuery && current !== "data" ? `${linkQuery}&step=${current}` : linkQuery}
            exports={exports}
            onStartHere={() => openForm("start")}
            onMyDatasets={() => openForm("mine")}
            myDatasetsReason={datasets && datasets.length > 0 ? null : t("factor.toolbar.mine_none")}
            onTour={() => setTourOpen(true)}
          />
        }
      />

      <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8 lg:items-start">
        <StepRail {...navProps} summaries={summaries} />

        <div ref={stepArea} className="min-w-0 flex flex-col gap-4">
          <StepBar {...navProps} />
          {exportError && (
            <p role="alert" className="flex items-start gap-1.5 text-xs text-danger-ink">
              <AlertCircle className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden />
              {exportError}
            </p>
          )}
          {/* At the top of every step once a dataset is ready, and in view while a step scrolls. */}
          {ready && dataset && (
            <SettingsRow
              options={options}
              standard={standard}
              published={published}
              publishedSource={bundled?.published_source}
              publishedScope={bundled?.published_scope}
              bundledId={bundled?.id}
              analysis={analysis}
              measureCount={dataset.measures.length}
              match={match}
              onApply={applyOptions}
              onGoToSetting={goToSetting}
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

          {/* The data step stays on the page while another is shown, so a form half filled in
              keeps its files and choices. */}
          <StepSection
            id="data"
            hidden={current !== "data"}
            title={t("factor.steps.data")}
            description={t(`factor.step_desc.data_${kind}`)}
            footer={footer("data")}
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
                    <IconButton
                      size="sm"
                      icon={X}
                      name={t("factor.data.dismiss_aria")}
                      onClick={() => setLinkNotice(null)}
                      className="h-6 w-6 -my-0.5"
                    />
                  )}
                </div>
              )}
              {gone && (
                <div className="mb-4 rounded-lg bg-tile px-3.5 py-2.5 flex items-start gap-2.5 text-sm">
                  <Info className="h-4 w-4 text-muted shrink-0 mt-0.5" />
                  <p className="flex-1 min-w-0">{t("factor.data.gone")}</p>
                  <IconButton
                    size="sm"
                    icon={X}
                    name={t("factor.data.dismiss_aria")}
                    onClick={() => {
                      // The button goes with the notice; the form below takes the focus.
                      focusForm.current = true;
                      setGone(false);
                    }}
                    className="h-6 w-6 -my-0.5"
                  />
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
                <StartHere
                  request={formRequest?.kind === "start" ? formRequest.n : undefined}
                  onRequestHandled={formRequestHandled}
                />
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
                  showMine={formRequest?.kind === "mine" ? formRequest.n : undefined}
                  onRequestHandled={formRequestHandled}
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

          {current === "dataset" && (
            <StepSection
              id="dataset"
              title={t("factor.steps.dataset")}
              description={t("factor.step_desc.dataset")}
              footer={footer("dataset")}
            >
              {ready && dataset ? (
                <DatasetView dataset={dataset} measureName={measureName} measureDescription={measureDescription} />
              ) : (
                lockedHint
              )}
            </StepSection>
          )}

          {current === "suitability" && (
            <StepSection
              id="suitability"
              title={t("factor.steps.suitability")}
              description={t("factor.step_desc.suitability")}
              actions={updating}
              footer={footer("suitability")}
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
                      measureDescription={measureDescription}
                      groups={measureGroups}
                      view={measureView}
                      onView={setMeasureView}
                    />
                  </div>
                </div>
              )}
            </StepSection>
          )}

          {current === "factors" && (
            <StepSection
              id="factors"
              title={t("factor.steps.factors")}
              description={t("factor.step_desc.factors")}
              actions={updating}
              footer={footer("factors")}
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
                    paperScope={bundled?.published_scope}
                  />
                </div>
              ) : (
                resultPlaceholder
              )}
            </StepSection>
          )}

          {current === "loadings" && (
            <StepSection
              id="loadings"
              title={t("factor.steps.loadings")}
              description={t("factor.step_desc.loadings")}
              actions={updating}
              footer={footer("loadings")}
            >
              {!ready ? (
                lockedHint
              ) : analysis ? (
                <div className={stale}>
                  <LoadingsView
                    analysis={analysis}
                    options={options}
                    onOptions={updateOptions}
                    measureName={measureName}
                    measureDescription={measureDescription}
                    assignmentNote={assignmentNote}
                  />
                </div>
              ) : (
                resultPlaceholder
              )}
            </StepSection>
          )}

          {current === "interpretation" && (
            <StepSection
              id="interpretation"
              title={t("factor.steps.interpretation")}
              description={t("factor.step_desc.interpretation")}
              footer={footer("interpretation")}
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
                  measureDescription={measureDescription}
                />
              ) : (
                resultPlaceholder
              )}
            </StepSection>
          )}
        </div>
      </div>
      <StepNavBar step={current} locks={locks} onGo={go} />
    </div>
  );
}

/**
 * Reads the address: the step (?step=...), and the dataset of a link, also while the tab is already
 * shown: one of the session (?dataset=<id>, e.g. from a job card) or a bundled one with its
 * settings (?bundled=<id>&...). A link leaves the address once it is read, so a reload shows the
 * dataset chosen last; its step stays. An anchor of the one-page layout before (#fa-step-loadings)
 * becomes the step it names. Its own component, so that only it waits for the search params on
 * the client.
 */
function UrlReader({
  onDataset,
  onBundled,
  onStep,
}: {
  onDataset: (id: string, step: StepId | null) => void;
  onBundled: (params: URLSearchParams, step: StepId | null) => void;
  onStep: (step: StepId, initial: boolean) => void;
}) {
  const params = useSearchParams();
  const linked = params.get("dataset");
  const bundled = params.get("bundled");
  const step = params.get("step");
  const first = useRef(true);
  useEffect(() => {
    const initial = first.current;
    first.current = false;
    const anchored = initial ? stepFromHash(window.location.hash) : null;
    if (anchored) {
      window.history.replaceState(null, "", stepHref(window.location.pathname, window.location.search, anchored));
      onStep(anchored, true);
      return;
    }
    onStep(parseStep(step) ?? "data", initial);
  }, [step, onStep]);
  useEffect(() => {
    if (!linked && !bundled) return;
    const query = new URLSearchParams(window.location.search);
    const target = parseStep(query.get("step"));
    // Without a state of its own, Next.js takes the new address over, so the same link opens
    // the dataset again later.
    window.history.replaceState(null, "", stepHref(window.location.pathname, "", target ?? "data"));
    if (linked) onDataset(linked, target);
    else onBundled(query, target);
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

"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Columns3,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Hourglass,
  Loader2,
  Network,
  Package,
  RotateCcw,
  ScrollText,
  Trash2,
  X,
} from "lucide-react";
import {
  DEFAULT_UPLOAD_LIMITS,
  type BundledDataset,
  type CreateDatasetInput,
  type DatasetCollection,
  type DatasetSource,
  type DatasetSummary,
  type FactorCatalog,
  type FactorDataset,
  type FactorKind,
  type InputsSummary,
  type SampleInput,
} from "@/lib/api";
import { MAX_COLUMNS, MIN_COLUMNS, compareHref, ownColumnKey } from "@/lib/compare";
import {
  MIN_MEASURES,
  MIN_OBSERVATIONS,
  tooFewKind,
  OBSERVATIONS_PER_MEASURE,
  countText,
  datasetEnded,
  datasetName,
  plainFailure,
  progressPercent,
  publishedOptions,
} from "@/lib/factor-analysis";
import { formatDateTime, formatFileSize, formatNumber, formatPercent, formatRelative, splitSentence } from "@/lib/format";
import { datasetNote, orderCollection, settingsSourceText } from "@/lib/paper-notes";
import { cn } from "@/lib/utils";
import { useLocale, useT, useTMaybe } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { ChoiceMark, choiceTile } from "@/components/ui/choice";
import { ChoiceCard } from "@/components/ui/choice-card";
import { IconButton } from "@/components/ui/icon-button";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoTip } from "@/components/ui/info-tip";
import { Notice } from "@/components/ui/notice";
import { Tip, mergeRefs, useTip, useTipZone } from "@/components/ui/tip";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { ScrollFade } from "@/components/ui/scroll-fade";
import { UploadZone } from "@/components/upload-zone";
import { FeatureChecklist } from "./feature-checklist";
import { EXAMPLE_CSV, startEntries, startEntryHref, type OpenPreset, type StartEntry } from "./start-here";

const SOURCE_ICON: Record<DatasetSource, React.ComponentType<{ className?: string }>> = {
  bundled: Database,
  csv: FileSpreadsheet,
  logs: FileText,
  pnml: Network,
};

const ACCEPT: Record<Exclude<DatasetSource, "bundled">, { accept: string; test: (name: string) => boolean; ext: string }> = {
  csv: { accept: ".csv", test: (n) => n.endsWith(".csv"), ext: ".csv" },
  logs: { accept: ".xes,.gz", test: (n) => n.endsWith(".xes") || n.endsWith(".xes.gz"), ext: ".xes / .xes.gz" },
  pnml: { accept: ".pnml", test: (n) => n.endsWith(".pnml"), ext: ".pnml" },
};

export type { OpenPreset } from "./start-here";

/** Where a load from the data step leads: the result (Get started, the paper settings) or the next step. */
export type LeadTo = "result" | "next";

/** The value of a card of Get started among the bundled cards. */
const START = "start:";

interface Props {
  kind: FactorKind;
  catalog: FactorCatalog;
  /** Datasets of this kind in the session, newest first; listed in their own tab. */
  datasets: DatasetSummary[];
  /** The dataset open on the tab, if any. */
  openId: string | null;
  submitting: boolean;
  submitError: { text: string; details: string | null } | null;
  /**
   * `preset` says which settings a bundled dataset with published settings opens with, `leadTo`
   * what the data step offers once it is loaded.
   */
  onSubmit: (input: CreateDatasetInput, preset: OpenPreset, leadTo: LeadTo) => void;
  onOpen: (id: string) => void;
  /** Resolves to whether the dataset was deleted. */
  onDelete: (id: string) => Promise<boolean>;
  /** Shown when a dataset already exists, to return to it without building a new one. */
  onCancel?: () => void;
}

export function DataForm({
  kind,
  catalog,
  datasets,
  openId,
  submitting,
  submitError,
  onSubmit,
  onOpen,
  onDelete,
  onCancel,
}: Props) {
  const t = useT();
  const router = useRouter();
  const sources = catalog.sources.filter((s) => kind === "model" || s !== "pnml");
  const [source, setSource] = useState<DatasetSource>(sources[0] ?? "bundled");
  // The own datasets come first when there are any; the tab goes away with the last of them.
  const [mineChosen, setMineChosen] = useState(datasets.length > 0);
  const mine = mineChosen && datasets.length > 0;
  const entries = useMemo(
    () => startEntries(kind).filter((e) => !e.bundledId || e.to !== kind || catalog.bundled.some((b) => b.id === e.bundledId)),
    [kind, catalog.bundled],
  );
  // A card of Get started (START + its id) or a bundled dataset; the first way in to begin with.
  const [choice, setChoice] = useState<string | null>(
    entries[0] ? START + entries[0].id : (catalog.bundled[0]?.id ?? null),
  );
  const entry = choice?.startsWith(START) ? (entries.find((e) => START + e.id === choice) ?? null) : null;
  const bundledId = choice && !entry ? choice : null;
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [logFiles, setLogFiles] = useState<File[]>([]);
  const [pnmlFiles, setPnmlFiles] = useState<File[]>([]);
  const [measures, setMeasures] = useState<string[]>(catalog.defaults.measures);
  const [miners, setMiners] = useState<string[]>(catalog.defaults.miners ?? []);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // Kept across the bundled datasets, so several open alike.
  const [preset, setPreset] = useState<OpenPreset>("standard");
  // Chosen sample per source; a sample replaces the uploaded files.
  const [sampleIds, setSampleIds] = useState<Partial<Record<DatasetSource, string>>>({});

  const files = source === "logs" ? logFiles : pnmlFiles;
  const setFiles = source === "logs" ? setLogFiles : setPnmlFiles;
  const limits = catalog.limits ?? DEFAULT_UPLOAD_LIMITS;
  const maxFiles = source === "logs" ? limits.max_log_files : source === "pnml" ? limits.max_pnml_files : 1;
  const samples = (catalog.samples ?? []).filter((s) => s.source === source);
  const sample = samples.find((s) => s.id === sampleIds[source]) ?? null;
  const nInputs = sample ? sample.files.length : files.length;
  const chooseSample = (id: string | null) =>
    setSampleIds((ids) => ({ ...ids, [source]: id ?? undefined }));

  const addFiles = (incoming: File[]) => {
    if (source === "bundled") return;
    const spec = ACCEPT[source];
    const messages: string[] = [];
    const ok: File[] = [];
    for (const f of incoming) {
      if (!spec.test(f.name.toLowerCase())) {
        messages.push(t("factor.data.wrong_type", { name: f.name, ext: spec.ext }));
      } else if (f.size > limits.max_file_bytes) {
        messages.push(t("factor.data.too_large", { name: f.name, mb: limits.max_file_bytes / (1024 * 1024) }));
      } else {
        ok.push(f);
      }
    }
    if (source === "csv") {
      if (ok[0]) setCsvFile(ok[0]);
    } else {
      const known = new Set(files.map((f) => `${f.name}:${f.size}`));
      const fresh = ok.filter((f) => !known.has(`${f.name}:${f.size}`));
      const room = maxFiles - files.length;
      if (fresh.length > room) {
        messages.push(t("factor.data.too_many_files", { max: maxFiles, n: fresh.length - Math.max(room, 0) }));
      }
      // The backend also counts decompressed .xes.gz files; this catches the obvious cases early.
      let total = files.reduce((acc, f) => acc + f.size, 0);
      const fitting: File[] = [];
      for (const f of fresh.slice(0, Math.max(room, 0))) {
        if (total + f.size > limits.max_total_bytes) continue;
        total += f.size;
        fitting.push(f);
      }
      if (fitting.length < Math.min(fresh.length, Math.max(room, 0))) {
        messages.push(t("factor.data.too_large_total", { mb: limits.max_total_bytes / (1024 * 1024) }));
      }
      setFiles([...files, ...fitting]);
    }
    // A few lines at most: the same message once, and of many the first three with a count.
    const distinct = [...new Set(messages)];
    setNotice(
      distinct.length > 0
        ? [...distinct.slice(0, 3), ...(distinct.length > 3 ? [t("toasts.more", { n: distinct.length - 3 })] : [])].join(" ")
        : null,
    );
  };

  // On the log tab the measures are chosen within their feature groups; a group with one measure
  // chosen is computed, and only the chosen measures are kept.
  const groupOf = useMemo(() => new Map(catalog.measures.map((m) => [m.key, m.group ?? null])), [catalog.measures]);
  const groups = useMemo(
    () => (catalog.groups ?? []).map((g) => g.key).filter((g) => measures.some((m) => groupOf.get(m) === g)),
    [catalog.groups, measures, groupOf],
  );
  const wholeGroups = useMemo(
    () => catalog.measures.filter((m) => m.group && groups.includes(m.group)).length === measures.length,
    [catalog.measures, groups, measures.length],
  );

  // How many rows the inputs give and how many measures; an observation is a log, a log with one
  // miner, or a net.
  const estimate = useMemo((): EstimateProps | null => {
    if (source === "logs" && kind === "model")
      return { unit: "log_miners", rows: nInputs * miners.length, cols: measures.length, logs: nInputs, miners: miners.length, limit: maxFiles };
    if (source === "logs") return { unit: "logs", rows: nInputs, cols: measures.length, limit: maxFiles };
    if (source === "pnml") return { unit: "nets", rows: nInputs, cols: measures.length, limit: maxFiles };
    return null;
  }, [source, kind, nInputs, miners.length, measures.length, maxFiles]);
  // Computed anyway, but too few rows for the measures: the analysis will not run.
  const tooFew = !!estimate && estimate.rows > 0 && estimate.cols > 0 && estimate.rows <= estimate.cols;

  const blocker: string | null = (() => {
    if (source === "bundled") return choice ? null : t("factor.data.need_bundled");
    if (source === "csv") return csvFile ? null : t("factor.data.need_csv");
    if (nInputs === 0) return t("factor.data.need_files");
    if (source === "logs" && kind === "model" && miners.length === 0) return t("factor.data.need_miner");
    if (source === "logs" && kind === "log") {
      return measures.length < MIN_MEASURES ? t("factor.data.need_measures", { n: MIN_MEASURES }) : null;
    }
    if (measures.length < MIN_MEASURES) return t("factor.data.need_measures", { n: MIN_MEASURES });
    return null;
  })();

  // The open-with choice, for a bundled dataset with the settings of its paper.
  const chosenBundled = catalog.bundled.find((b) => b.id === bundledId);
  const paper = source === "bundled" && !entry ? publishedOptions(kind, chosenBundled) : null;

  const submit = () => {
    if (blocker) return;
    if (source === "bundled" && entry) {
      // A comparison, or a dataset of the other tab: opened there.
      if (entry.to !== kind) {
        const href = startEntryHref(entry);
        if (href) router.push(href);
        return;
      }
      onSubmit({ kind, source: "bundled", bundledId: entry.bundledId }, entry.preset ?? "standard", "result");
      return;
    }
    const input: CreateDatasetInput = { kind, source, name: name.trim() || undefined };
    if (source === "bundled") input.bundledId = bundledId ?? undefined;
    if (source === "csv" && csvFile) input.files = [csvFile];
    if (source === "logs") {
      input.files = logFiles;
      if (sample) {
        input.files = undefined;
        input.bundledId = sample.id;
      }
      if (kind === "model") {
        input.miners = miners;
        input.measures = measures;
      } else {
        input.groups = groups;
        // Single measures only where they are not whole groups.
        if (!wholeGroups) input.measures = measures;
      }
    }
    if (source === "pnml") {
      input.files = sample ? undefined : pnmlFiles;
      if (sample) input.bundledId = sample.id;
      input.measures = measures;
    }
    // The paper's settings are an analysis to look at; anything else goes on step by step.
    onSubmit(input, preset, source === "bundled" && paper && preset === "published" ? "result" : "next");
  };

  const submitLabel =
    source === "bundled"
      ? entry?.to === "compare"
        ? t("factor.data.submit_compare")
        : t("factor.data.submit_bundled")
      : source === "csv"
        ? t("factor.data.submit_csv")
        : t("factor.data.submit_compute");

  const hint = t(
    mine
      ? "factor.data.source_hint.mine"
      : source === "logs"
        ? `factor.data.source_hint.logs_${kind}`
        : `factor.data.source_hint.${source}`,
  );
  const tabs = (
    <div className="flex items-center gap-1.5">
      <ScrollFade className="min-w-0">
        <Segmented<DatasetSource | "mine">
          aria-label={t("factor.data.source_aria")}
          className="min-w-max"
          value={mine ? "mine" : source}
          onChange={(s) => {
            setMineChosen(s === "mine");
            if (s !== "mine") setSource(s);
            setNotice(null);
          }}
          options={[
            ...(datasets.length > 0
              ? [
                  {
                    value: "mine" as const,
                    label: (
                      <>
                        <FolderOpen className="h-3.5 w-3.5" />
                        <span>{t("factor.data.source.mine")}</span>
                      </>
                    ),
                  },
                ]
              : []),
            ...sources.map((s) => {
              const Icon = SOURCE_ICON[s];
              return {
                value: s,
                label: (
                  <>
                    <Icon className="h-3.5 w-3.5" />
                    <span>{t(`factor.data.source.${s}`)}</span>
                  </>
                ),
              };
            }),
          ]}
        />
      </ScrollFade>
      <InfoTip topic={t(mine ? "factor.data.source.mine" : `factor.data.source.${source}`)} text={hint} />
    </div>
  );

  if (mine) {
    return (
      <div className="space-y-5">
        {tabs}
        <DatasetPicker
          kind={kind}
          catalog={catalog}
          datasets={datasets}
          openId={openId}
          onOpen={onOpen}
          onDelete={onDelete}
          onCancel={onCancel}
        />
      </div>
    );
  }

  return (
    // Anything the keyboard or a scroll brings into view stays clear of the button bar at the bottom.
    <div className="space-y-5 [&_:is(input,button,a)]:scroll-mb-32 lg:[&_:is(input,button,a)]:scroll-mb-20">
      {tabs}

      {source === "bundled" && (
        <BundledList kind={kind} catalog={catalog} entries={entries} selected={choice} onSelect={setChoice} />
      )}

      {paper && <PresetChoice kind={kind} dataset={chosenBundled} value={preset} onChange={setPreset} />}

      {source === "csv" && (
        <div className="space-y-2">
          {csvFile ? (
            <FileList files={[csvFile]} onRemove={() => setCsvFile(null)} />
          ) : (
            <UploadZone
              accept={ACCEPT.csv.accept}
              onFiles={addFiles}
              label={t("factor.data.csv_drop_label")}
              hint={t("factor.data.csv_drop_hint")}
            />
          )}
          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              {t("factor.data.csv_format_short")}
              <InfoTip size="xs" topic={t("factor.data.csv_format_short")} text={t("factor.data.csv_format")} />
            </span>
            <a
              href={EXAMPLE_CSV}
              download
              className="inline-flex items-center gap-1 rounded font-medium text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              {t("factor.start.example_csv")}
            </a>
            <InfoTip size="xs" topic={t("factor.start.example_csv")} text={t("factor.start.example_csv_hint")} />
          </div>
        </div>
      )}

      {(source === "logs" || source === "pnml") && sample && (
        <SampleTile sample={sample} chosen onToggle={() => chooseSample(null)} />
      )}

      {(source === "logs" || source === "pnml") && !sample && (
        <div className="space-y-2">
          {files.length < maxFiles && (
            <UploadZone
              multiple
              accept={ACCEPT[source].accept}
              onFiles={addFiles}
              label={t(source === "logs" ? "factor.data.logs_drop_label" : "factor.data.pnml_drop_label")}
              hint={t(source === "logs" ? "factor.data.logs_drop_hint" : "factor.data.pnml_drop_hint", {
                max: maxFiles,
              })}
            />
          )}
          {files.length > 0 && (
            <FileList
              files={files}
              onRemove={(i) => setFiles(files.filter((_, j) => j !== i))}
              onClear={() => setFiles([])}
            />
          )}
          {files.length === 0 &&
            samples.map((s) => <SampleTile key={s.id} sample={s} chosen={false} onToggle={() => chooseSample(s.id)} />)}
        </div>
      )}

      {notice && (
        <Notice tone="warn" size="sm" role="status">
          {notice}
        </Notice>
      )}

      {source === "logs" && kind === "model" && catalog.miners && (
        <Checklist
          heading={t("factor.data.miners_heading")}
          hint={t("factor.data.miners_hint")}
          items={catalog.miners.map((m) => ({ key: m.key, name: m.name, slow: m.slow }))}
          selected={miners}
          onChange={setMiners}
          defaults={catalog.defaults.miners ?? []}
        />
      )}

      {source === "logs" && kind === "log" && catalog.groups && (
        <FeatureChecklist
          heading={t("factor.data.groups_heading")}
          hint={t("factor.data.groups_hint")}
          groups={catalog.groups}
          measures={catalog.measures
            .filter((m) => m.group)
            .map((m) => ({ key: m.key, name: m.name, description: m.description, group: m.group as string }))}
          selected={measures}
          onChange={setMeasures}
          defaults={catalog.defaults.measures}
        />
      )}

      {kind === "model" && (source === "logs" || source === "pnml") && (
        <Checklist
          heading={t("factor.data.measures_heading")}
          hint={t("factor.data.measures_hint")}
          items={catalog.measures.map((m) => ({
            key: m.key,
            name: m.name,
            description: m.description,
            slow: m.slow,
          }))}
          selected={measures}
          onChange={setMeasures}
          defaults={catalog.defaults.measures}
        />
      )}

      {source !== "bundled" && (
        <div className="space-y-1.5 max-w-sm">
          <label htmlFor={`fa-name-${kind}`} className="text-xs font-medium text-muted">
            {t("factor.data.name_label")}
          </label>
          <Input
            id={`fa-name-${kind}`}
            value={name}
            maxLength={120}
            placeholder={t("factor.data.name_placeholder")}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      )}

      {estimate && estimate.rows > 0 && estimate.cols > 0 && <Estimate {...estimate} />}

      {submitError && (
        <Notice tone="error" role="alert">
          <span className="inline-flex items-start gap-1.5">
            {submitError.text}
            {submitError.details && (
              <InfoTip size="xs" topic={t("factor.data.details")} text={submitError.details} />
            )}
          </span>
        </Notice>
      )}

      {/* The one action of the step, at its end and in view while the cards scroll above it. */}
      <div className="sticky max-lg:[@media(max-height:600px)]:static bottom-[calc(3.5rem+env(safe-area-inset-bottom))] [@media(max-height:500px)]:bottom-0 lg:bottom-0 z-10 -mx-4 sm:-mx-5 -mb-5 px-4 sm:px-5 py-3 rounded-b-lg bg-surface/95 backdrop-blur border-t border-border flex items-center justify-end gap-3 flex-wrap">
        {blocker ? (
          <span className="text-xs text-muted mr-auto">{blocker}</span>
        ) : (
          tooFew && (
            <span className="text-xs text-warn-ink mr-auto flex items-start gap-1.5 max-w-prose">
              <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden />
              {t("factor.data.estimate_wont_run")}
            </span>
          )
        )}
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={submitting}>
            {t("common.cancel")}
          </Button>
        )}
        <Button onClick={submit} disabled={!!blocker || submitting}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {!submitting && entry?.to === "compare" && <Columns3 className="h-4 w-4" aria-hidden />}
          {submitting ? t("factor.data.submitting") : submitLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * The bundled source as one list of cards: first the ways in of Get started, each with a badge of
 * what it opens, then all bundled datasets, by paper. A click chooses a card; the button at the end
 * of the step loads it.
 */
function BundledList({
  kind,
  catalog,
  entries,
  selected,
  onSelect,
}: {
  kind: FactorKind;
  catalog: FactorCatalog;
  entries: StartEntry[];
  selected: string | null;
  onSelect: (value: string) => void;
}) {
  const t = useT();
  if (catalog.bundled.length === 0 && entries.length === 0) {
    return <EmptyState>{t("factor.data.bundled_empty")}</EmptyState>;
  }
  const collections = catalog.collections ?? [];
  const grouped = collections
    .map((c) => ({ collection: c, items: orderCollection(c.id, catalog.bundled.filter((b) => b.collection === c.id)) }))
    .filter((g) => g.items.length > 0);
  const loose = catalog.bundled.filter((b) => !collections.some((c) => c.id === b.collection));
  const name = `fa-bundled-${kind}`;
  const tile = (b: BundledDataset) => (
    <BundledTile key={b.id} name={name} dataset={b} chosen={b.id === selected} onSelect={() => onSelect(b.id)} />
  );
  return (
    <div role="radiogroup" aria-label={t("factor.data.source.bundled")} className="space-y-5">
      {entries.length > 0 && (
        <section aria-labelledby={`${name}-start`} className="space-y-2">
          <h3 id={`${name}-start`} className="text-xs font-semibold uppercase tracking-wide text-muted">
            {t("factor.start.title")}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {entries.map((e) => (
              <StartTile
                key={e.id}
                name={name}
                kind={kind}
                entry={e}
                chosen={selected === START + e.id}
                onSelect={() => onSelect(START + e.id)}
              />
            ))}
          </div>
        </section>
      )}
      {catalog.bundled.length > 0 && (
        <section aria-labelledby={`${name}-all`} className="space-y-3">
          <h3 id={`${name}-all`} className="text-xs font-semibold uppercase tracking-wide text-muted">
            {t("factor.data.all_bundled")}
          </h3>
          {grouped.map(({ collection, items }) => (
            <CollectionBlock key={collection.id} collection={collection} items={items}>
              {items.map(tile)}
            </CollectionBlock>
          ))}
          {loose.length > 0 && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{loose.map(tile)}</div>}
        </section>
      )}
    </div>
  );
}

const BADGE = "inline-flex items-center gap-1 rounded-full bg-tile px-2 py-0.5 text-xs font-medium text-muted";

/** A way in of Get started: its name, one short line, and a badge of what it opens. */
function StartTile({
  name,
  kind,
  entry,
  chosen,
  onSelect,
}: {
  name: string;
  kind: FactorKind;
  entry: StartEntry;
  chosen: boolean;
  onSelect: () => void;
}) {
  const t = useT();
  const shortId = useId();
  const title = t(`factor.start.scenario.${entry.id}.title`);
  const Icon = entry.to === "compare" ? Columns3 : entry.to === "log" ? ScrollText : Network;
  const badge =
    entry.to === "compare"
      ? t("factor.start.opens", { page: t("mode_bar.compare_label") })
      : entry.to !== kind
        ? t("factor.start.opens", { page: t(`mode_bar.${entry.to}_label`) })
        : t(`factor.data.preset.${entry.preset ?? "standard"}`);
  return (
    <ChoiceCard
      name={name}
      label={title}
      checked={chosen}
      onChange={onSelect}
      describedBy={shortId}
      info={<InfoTip size="xs" topic={title} text={t(`factor.start.scenario.${entry.id}.text`)} align="end" />}
    >
      <span className="block text-sm font-medium">{title}</span>
      <span id={shortId} className="block text-xs text-muted leading-snug">
        {t(`factor.start.scenario.${entry.id}.short`)}
      </span>
      <span className={cn(BADGE, "mt-1.5")}>
        {(entry.to === "compare" || entry.to !== kind) && <Icon className="h-3 w-3" aria-hidden />}
        {badge}
      </span>
    </ChoiceCard>
  );
}

/**
 * For a bundled dataset with published settings: whether it opens with the tool standard or with the
 * settings of its paper, as one compact switch; what each means is behind its (i).
 */
function PresetChoice({
  kind,
  dataset,
  value,
  onChange,
}: {
  kind: FactorKind;
  dataset: BundledDataset | undefined;
  value: OpenPreset;
  onChange: (preset: OpenPreset) => void;
}) {
  const t = useT();
  const paper = publishedOptions(kind, dataset);
  if (!paper) return null;
  const source = settingsSourceText(dataset?.published_source, dataset?.published_scope, t);
  const published = [
    paper.n_factors !== null ? countText(t, "factor.factors.criterion_count", paper.n_factors) : null,
    t(`factor.settings.rotation.${paper.rotation}`),
    t(`factor.settings.rule.${paper.assignment_rule}`),
  ]
    .filter(Boolean)
    .join(" · ");
  const help = [
    `${t("factor.data.preset.standard")}: ${t("factor.data.preset_standard_detail")}.`,
    `${t("factor.data.preset.published")}: ${published}${source ? ` (${source})` : ""}.`,
  ].join(" ");
  const labelId = `fa-preset-${kind}`;
  return (
    <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap">
      <span id={labelId} className="text-xs font-medium text-muted">
        {t("factor.data.preset_label")}
      </span>
      <Segmented<OpenPreset>
        size="sm"
        aria-labelledby={labelId}
        value={value}
        onChange={onChange}
        options={(["standard", "published"] as const).map((p) => ({ value: p, label: t(`factor.data.preset.${p}`) }))}
      />
      <InfoTip size="xs" topic={t("factor.data.preset_label")} text={help} />
    </div>
  );
}

/** One paper with its datasets: its name in a line, what it is and how to cite it behind its (i). */
function CollectionBlock({
  collection,
  items,
  children,
}: {
  collection: DatasetCollection;
  items: BundledDataset[];
  children: React.ReactNode;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard?.writeText(collection.citation ?? "").then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {},
    );
  // The size, said once where every dataset of the paper has the same shape.
  const sameSize = items.every((b) => b.observations === items[0].observations && b.measures === items[0].measures);
  const about = [
    collection.description,
    sameSize ? t("factor.data.bundled_size", { rows: items[0].observations, cols: items[0].measures }) : null,
    collection.license ? t("factor.data.license", { license: collection.license }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 min-w-0">
        <h4 className="min-w-0 truncate text-sm font-semibold">
          {collection.name}
          {collection.venue && <span className="ml-2 text-xs font-normal text-muted">{collection.venue}</span>}
        </h4>
        <InfoTip topic={collection.name} text={about} width={380}>
          <p>{collection.description}</p>
          <p className="text-muted">
            {[
              sameSize ? t("factor.data.bundled_size", { rows: items[0].observations, cols: items[0].measures }) : null,
              collection.license ? t("factor.data.license", { license: collection.license }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {collection.note && (
            <p className="flex items-start gap-1.5 text-warn-ink">
              <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden />
              {collection.note}
            </p>
          )}
        </InfoTip>
        {collection.note && (
          <Tip name={t("factor.data.collection_note")} more={collection.note}>
            <span tabIndex={0} className="inline-grid h-5 w-5 place-items-center rounded-full text-warn-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">{t("factor.data.collection_note")}</span>
            </span>
          </Tip>
        )}
        <span className="ml-auto flex items-center gap-0.5 shrink-0">
          {collection.citation && (
            <IconButton
              size="sm"
              icon={copied ? Check : Copy}
              name={copied ? t("factor.data.copied") : t("factor.data.copy_citation")}
              more={collection.citation}
              onClick={copy}
              className={copied ? "text-success-ink hover:text-success-ink" : undefined}
            />
          )}
          {collection.source_url && <SourceLink href={collection.source_url} />}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}

/** The source of a paper's data, opened in a new tab. */
function SourceLink({ href }: { href: string }) {
  const t = useT();
  const tip = useTip<HTMLAnchorElement>({ name: t("factor.data.source_link"), more: href });
  return (
    <a
      ref={tip}
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={t("factor.data.source_link")}
      className="h-7 w-7 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-tile transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
    </a>
  );
}

/** A bundled dataset as a card: its name and one short line (size, where it is analysed); the rest behind its (i). */
function BundledTile({
  name,
  dataset,
  chosen,
  onSelect,
}: {
  name: string;
  dataset: BundledDataset;
  chosen: boolean;
  onSelect: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const shortId = useId();
  const label = dataset.label ?? dataset.name;
  const note = datasetNote(dataset.id, t);
  const short = [
    `${formatNumber(dataset.observations, locale)} × ${formatNumber(dataset.measures, locale)}`,
    dataset.published_scope === "paper" || dataset.published_scope === "report"
      ? t(`factor.data.scope.${dataset.published_scope}`)
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const details = [
    dataset.description,
    t("factor.data.bundled_size", { rows: dataset.observations, cols: dataset.measures }),
    dataset.published_source ?? null,
    note,
  ].filter((x): x is string => !!x);
  return (
    <ChoiceCard
      name={name}
      label={label}
      checked={chosen}
      onChange={onSelect}
      describedBy={shortId}
      info={
        <InfoTip size="xs" topic={label} text={details.join(" · ")} align="end">
          {details.map((d) => (
            <p key={d}>{d}</p>
          ))}
        </InfoTip>
      }
    >
      <span className="block text-sm font-medium truncate">{label}</span>
      <span id={shortId} className="block text-xs text-muted">
        {short}
        {note && <span className="sr-only">. {note}</span>}
      </span>
    </ChoiceCard>
  );
}

/** The datasets of the session as choice tiles: one to reopen, any to delete. */
function DatasetPicker({
  kind,
  catalog,
  datasets,
  openId,
  onOpen,
  onDelete,
  onCancel,
}: {
  kind: FactorKind;
  catalog: FactorCatalog;
  datasets: DatasetSummary[];
  openId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const t = useT();
  // The newest dataset that is not open already; opening the open one only closes the form.
  const fallback = (datasets.find((d) => d.id !== openId) ?? datasets[0])?.id ?? null;
  const [selected, setSelected] = useState(fallback);
  // The chosen one can go, deleted here or with its job in the drawer; then the default again.
  const chosen = datasets.some((d) => d.id === selected) ? selected : fallback;
  const listRef = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);

  // A deleted tile takes the focus with it; hand it to the list.
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    const list = listRef.current;
    (list?.querySelector<HTMLInputElement>("input:checked") ?? list?.querySelector<HTMLInputElement>("input"))?.focus();
  }, [datasets]);

  const remove = async (id: string) => {
    refocus.current = true;
    if (!(await onDelete(id))) refocus.current = false;
  };

  // Several datasets side by side: the tiles turn into checkboxes, and the comparison opens with
  // one column each, of all their rows, with the settings saved with them.
  const [comparing, setComparing] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const ready = datasets.filter((d) => d.status === "ready");
  const pickedReady = picked.filter((id) => ready.some((d) => d.id === id));
  const compareTarget =
    pickedReady.length >= MIN_COLUMNS
      ? compareHref({
          columns: pickedReady.map((id) => ownColumnKey(id, { miner: ready.find((d) => d.id === id)?.options_miner ?? null })),
          rule: "largest",
          ...(kind === "log" ? { kind } : {}),
        })
      : null;
  const togglePicked = (id: string) =>
    setPicked((list) =>
      list.includes(id) ? list.filter((x) => x !== id) : list.length >= MAX_COLUMNS ? list : [...list, id],
    );
  const startComparing = () => {
    setComparing(true);
    // The chosen tile is a start; the focus stays in the list.
    setPicked(chosen && ready.some((d) => d.id === chosen) ? [chosen] : []);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLInputElement>("input")?.focus());
  };

  return (
    <div className="space-y-5">
      <div
        ref={listRef}
        role={comparing ? "group" : "radiogroup"}
        aria-label={comparing ? t("factor.data.compare_pick_aria") : t("factor.data.source.mine")}
        className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
      >
        {datasets.map((d) => (
          <DatasetTile
            key={d.id}
            name={`fa-mine-${kind}`}
            dataset={d}
            catalog={catalog}
            chosen={comparing ? picked.includes(d.id) : d.id === chosen}
            open={d.id === openId}
            onSelect={() => (comparing ? togglePicked(d.id) : setSelected(d.id))}
            onDelete={() => remove(d.id)}
            pick={
              comparing
                ? {
                    reason:
                      d.status !== "ready"
                        ? t("factor.data.compare_not_ready")
                        : !picked.includes(d.id) && picked.length >= MAX_COLUMNS
                          ? t("compare.columns.max", { max: MAX_COLUMNS })
                          : null,
                  }
                : undefined
            }
          />
        ))}
      </div>
      {comparing ? (
        <div className="flex items-center justify-end gap-3 flex-wrap pt-1">
          <span className="text-xs text-muted mr-auto">
            {t("factor.data.compare_hint", { min: MIN_COLUMNS, max: MAX_COLUMNS, n: pickedReady.length })}
          </span>
          <Button variant="ghost" onClick={() => setComparing(false)}>
            {t("common.cancel")}
          </Button>
          {compareTarget ? (
            <Link
              href={compareTarget}
              className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-md bg-accent text-accent-fg text-sm font-medium hover:opacity-90 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              <Columns3 className="h-4 w-4" aria-hidden />
              {t("factor.data.compare_go", { n: pickedReady.length })}
            </Link>
          ) : (
            <Button disabled>
              <Columns3 className="h-4 w-4" aria-hidden />
              {t("factor.data.compare_go", { n: pickedReady.length })}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-end gap-3 flex-wrap pt-1">
          {!chosen && <span className="text-xs text-muted mr-auto">{t("factor.data.need_mine")}</span>}
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
          )}
          {ready.length >= MIN_COLUMNS && (
            <Button variant="outline" onClick={startComparing}>
              <Columns3 className="h-4 w-4" aria-hidden />
              {t("factor.data.compare_start")}
            </Button>
          )}
          <Button onClick={() => chosen && onOpen(chosen)} disabled={!chosen}>
            {/* A stopped or failed dataset has no data to open. */}
            {t(datasets.find((d) => d.id === chosen && datasetEnded(d)) ? "factor.data.submit_show" : "factor.data.submit_open")}
          </Button>
        </div>
      )}
    </div>
  );
}

function DatasetTile({
  name,
  dataset,
  catalog,
  chosen,
  open,
  onSelect,
  onDelete,
  pick,
}: {
  name: string;
  dataset: DatasetSummary;
  catalog: FactorCatalog;
  chosen: boolean;
  /** The dataset is the one open on the tab. */
  open: boolean;
  onSelect: () => void;
  onDelete: () => Promise<void>;
  /** Picked for a comparison, a checkbox among several, instead of the one to open; with why it cannot be. */
  pick?: { reason: string | null };
}) {
  const t = useT();
  const { locale } = useLocale();
  const [confirming, setConfirming] = useState(false);
  const askRef = useRef<HTMLButtonElement>(null);
  const Icon = SOURCE_ICON[dataset.source];
  const { n_observations: rows, n_measures: cols } = dataset;
  const title = datasetName(dataset, t, catalog);
  // A computed dataset goes with the run that computed it.
  const withRun = !!dataset.job_id;
  const nameTip = useTip<HTMLSpanElement>({ more: title });
  const sizeTip = useTip<HTMLSpanElement>(
    rows !== null && cols !== null ? { more: t("factor.data.cleaned_size", { rows, cols }) } : null,
  );
  const timeTip = useTip<HTMLElement>({ more: formatDateTime(dataset.created_at, locale) });
  const pickTip = useTip<HTMLLabelElement>(pick?.reason ? { name: title, reason: pick.reason } : null);
  return (
    // min-w-0: a long name wraps instead of widening the grid column beyond the page.
    <div className={cn("rounded-md min-w-0", choiceTile(chosen), pick?.reason && "opacity-60")}>
      <div className="flex items-start">
        <label
          ref={pickTip}
          className={cn("flex-1 min-w-0 flex items-start gap-2.5 pl-3 py-2.5", pick?.reason ? "cursor-default" : "cursor-pointer")}
        >
          {pick ? (
            <input
              type="checkbox"
              className="sr-only"
              checked={chosen}
              aria-label={title}
              aria-disabled={pick.reason ? true : undefined}
              onChange={() => {
                if (!pick.reason) onSelect();
              }}
            />
          ) : (
            <input type="radio" name={name} className="sr-only" checked={chosen} onChange={onSelect} />
          )}
          <ChoiceMark type={pick ? "checkbox" : "radio"} checked={chosen} className="mt-0.5" />
          <span className="min-w-0 flex-1">
            {/* Two lines: names of one paper differ only at the end; the tooltip has all of it. */}
            <span ref={nameTip} className="block min-w-0 text-sm font-medium line-clamp-2 break-words">
              {title}
            </span>
            {/* What it is, how big and how old, as one line of text; the open one says so. */}
            <span className="mt-0.5 flex items-center gap-x-1.5 gap-y-0.5 flex-wrap text-xs text-muted">
              <Icon className="h-3 w-3 shrink-0" />
              <span>{t(`factor.data.source.${dataset.source}`)}</span>
              {/* Each separator wraps with the item after it, so none ends a line. */}
              {rows !== null && cols !== null && (
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden>·</span>
                  <span ref={sizeTip}>
                    {formatNumber(rows, locale)} × {formatNumber(cols, locale)}
                  </span>
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden>·</span>
                <time ref={timeTip} dateTime={dataset.created_at}>
                  {formatRelative(dataset.created_at, locale)}
                </time>
              </span>
              {(open || dataset.status !== "ready") && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 font-medium",
                    dataset.status === "failed" ? "text-danger-ink" : open ? "text-success-ink" : "text-fg",
                  )}
                >
                  <span aria-hidden className="text-muted font-normal">
                    ·
                  </span>
                  {dataset.status !== "ready" ? t(`factor.data.mine_${dataset.status}`) : t("factor.data.mine_open")}
                </span>
              )}
            </span>
          </span>
        </label>
        <IconButton
          ref={askRef}
          size="sm"
          icon={Trash2}
          name={t("factor.data.delete_aria", { name: title })}
          more={withRun ? t("factor.data.delete_with_run") : undefined}
          onClick={() => setConfirming((c) => !c)}
          aria-expanded={confirming}
          className="m-1.5 hover:text-danger-ink hover:bg-danger/10"
        />
      </div>
      {confirming && (
        <div className="px-3 pb-2.5 flex items-center justify-end gap-2 flex-wrap">
          <ConfirmDelete
            withRun={withRun}
            onConfirm={onDelete}
            onCancel={() => {
              setConfirming(false);
              askRef.current?.focus();
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The confirmation that replaces a delete button, as in the settings and the run history.
 * `withRun` says that the run that computed the dataset goes as well.
 */
function ConfirmDelete({
  withRun,
  onConfirm,
  onCancel,
}: {
  withRun: boolean;
  onConfirm: () => Promise<unknown>;
  onCancel: () => void;
}) {
  const t = useT();
  const [deleting, setDeleting] = useState(false);
  const confirm = async () => {
    setDeleting(true);
    try {
      await onConfirm();
    } finally {
      // Gone on success; back for another try after an error.
      setDeleting(false);
    }
  };
  return (
    <>
      <Button
        size="sm"
        variant="primary"
        className="bg-danger hover:bg-danger/90"
        onClick={confirm}
        disabled={deleting}
        autoFocus
      >
        {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {t(withRun ? "factor.data.delete_confirm_run" : "factor.data.delete_confirm")}
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel} disabled={deleting}>
        {t("common.cancel")}
      </Button>
    </>
  );
}

/** Bundled input files for the logs or PNML source; chosen, they replace the upload. */
function SampleTile({ sample, chosen, onToggle }: { sample: SampleInput; chosen: boolean; onToggle: () => void }) {
  const t = useT();
  const files = t(sample.files.length === 1 ? "factor.data.files_selected" : "factor.data.files_selected_plural", {
    n: sample.files.length,
  });
  const tip = useTip<HTMLLabelElement>(sample.citation ? { more: sample.citation } : null);
  return (
    <div className={cn("rounded-md px-3 py-2.5 flex items-center gap-3", choiceTile(chosen))}>
      <label ref={tip} className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer">
        <input type="checkbox" className="sr-only" checked={chosen} onChange={onToggle} />
        <ChoiceMark checked={chosen} />
        <Package className="h-4 w-4 text-muted shrink-0" />
        <span className="min-w-0">
          <span className="block text-sm font-medium truncate">
            {t("factor.data.sample_label")}: {sample.name}
            <span className="ml-2 align-middle rounded-full border border-border px-1.5 py-0.5 text-xs font-normal text-muted">
              {t("factor.data.sample_demo")}
            </span>
          </span>
          <span className="block text-xs text-muted truncate">
            {files}
            {sample.description && ` · ${sample.description}`}
          </span>
        </span>
      </label>
      <InfoTip size="xs" topic={t("factor.data.sample_demo")} text={t("factor.data.sample_demo_why")} align="end" />
      {chosen && (
        <Button variant="ghost" size="sm" onClick={onToggle} className="shrink-0">
          {t("factor.data.sample_own")}
        </Button>
      )}
    </div>
  );
}

function FileList({
  files,
  onRemove,
  onClear,
}: {
  files: File[];
  onRemove: (index: number) => void;
  onClear?: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const zone = useTipZone<HTMLUListElement>();
  const total = files.reduce((acc, f) => acc + f.size, 0);
  return (
    <div className="rounded-lg bg-tile">
      <div className="px-3 py-2 flex items-center justify-between gap-2 text-xs text-muted border-b border-border/60">
        <span>
          {t(files.length === 1 ? "factor.data.files_selected" : "factor.data.files_selected_plural", {
            n: files.length,
          })}{" "}
          · {formatFileSize(total, locale)}
        </span>
        {onClear && files.length > 1 && (
          <button type="button" onClick={onClear} className="hover:text-fg transition">
            {t("factor.data.clear_files")}
          </button>
        )}
      </div>
      <ul ref={zone} className="max-h-48 overflow-y-auto p-1.5 grid gap-1 sm:grid-cols-2">
        {files.map((f, i) => (
          <li key={`${f.name}:${f.size}`} className="flex items-center gap-2 rounded px-2 py-1 bg-bg/40 text-xs min-w-0">
            <FileText className="h-3.5 w-3.5 text-muted shrink-0" />
            <span className="truncate flex-1" data-tip={f.name}>
              {f.name}
            </span>
            <span className="text-xs text-muted shrink-0">{formatFileSize(f.size, locale)}</span>
            <IconButton
              size="sm"
              icon={X}
              name={t("factor.data.remove_file_aria", { name: f.name })}
              onClick={() => onRemove(i)}
              className="h-6 w-6 hover:text-danger-ink"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

interface ChecklistItem {
  key: string;
  name: string;
  description?: string;
  detail?: string;
  slow?: boolean;
}

function Checklist({
  heading,
  hint,
  items,
  selected,
  onChange,
  defaults,
  wide,
}: {
  heading: string;
  hint: string;
  items: ChecklistItem[];
  selected: string[];
  onChange: (keys: string[]) => void;
  defaults: string[];
  wide?: boolean;
}) {
  const t = useT();
  const chosen = new Set(selected);
  const toggle = (key: string) => {
    // Keep catalog order, so requests and tables are stable.
    const next = chosen.has(key) ? selected.filter((k) => k !== key) : [...selected, key];
    onChange(items.map((i) => i.key).filter((k) => next.includes(k)));
  };
  const linkClass = "min-h-6 px-1.5 text-xs text-muted hover:text-fg hover:bg-tile transition inline-flex items-center gap-1 rounded";
  return (
    <fieldset className="space-y-2">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <legend className="flex items-center gap-1 text-sm font-semibold">
          {heading}
          <span className="text-xs font-normal text-muted">
            {t("factor.data.selected_count", { n: selected.length, total: items.length })}
          </span>
          <InfoTip topic={heading} text={hint} />
        </legend>
        <div className="flex items-center gap-3">
          <button type="button" className={linkClass} onClick={() => onChange(items.map((i) => i.key))}>
            {t("factor.data.select_all")}
          </button>
          <button type="button" className={linkClass} onClick={() => onChange([])}>
            {t("factor.data.select_none")}
          </button>
          <button type="button" className={linkClass} onClick={() => onChange(defaults)}>
            <RotateCcw className="h-3 w-3" />
            {t("factor.data.select_defaults")}
          </button>
        </div>
      </div>
      <div className={cn("grid gap-1.5", wide ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3")}>
        {items.map((item) => (
          <ChecklistTile
            key={item.key}
            item={item}
            on={chosen.has(item.key)}
            onToggle={() => toggle(item.key)}
            wide={wide}
          />
        ))}
      </div>
    </fieldset>
  );
}

function ChecklistTile({
  item,
  on,
  onToggle,
  wide,
}: {
  item: ChecklistItem;
  on: boolean;
  onToggle: () => void;
  wide?: boolean;
}) {
  // A wide tile shows its description; a narrow one has it in the tooltip.
  const tip = useTip<HTMLLabelElement>(!wide && item.description ? { more: item.description } : null);
  return (
    <label ref={tip} className={cn("flex items-start gap-2.5 rounded-md px-2.5 py-2 text-xs", choiceTile(on))}>
      <input type="checkbox" checked={on} onChange={onToggle} className="sr-only" />
      <ChoiceMark checked={on} className="mt-px" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 flex-wrap">
          <span className="font-medium">{item.name}</span>
          {item.slow && <SlowMark />}
          {item.detail && <span className="text-xs text-muted">{item.detail}</span>}
        </span>
        {wide && item.description && (
          <span className="block text-xs text-muted mt-0.5 leading-snug">{item.description}</span>
        )}
      </span>
    </label>
  );
}

/** A miner, measure or group that takes noticeably longer: an hourglass, named by its tooltip. */
function SlowMark() {
  const t = useT();
  const tip = useTip<HTMLSpanElement>({ name: t("factor.data.slow_badge"), more: t("factor.data.slow_title") });
  return (
    <span ref={tip} className="inline-flex text-muted">
      <Hourglass className="h-3 w-3" aria-hidden />
      <span className="sr-only">{t("factor.data.slow_badge")}</span>
    </span>
  );
}

interface EstimateProps {
  /** What one row is: a log, a log with one miner, or a net. */
  unit: "logs" | "log_miners" | "nets";
  rows: number;
  cols: number;
  /** For logs with miners: how many of each. */
  logs?: number;
  miners?: number;
  /** The most files of the source. */
  limit: number;
}

/**
 * How many observations and measures the inputs give, and what that means: in plain words with
 * the numbers and the way out where there are too few observations for the measures, which a
 * factor analysis cannot work with. Computing stays possible, so the values can be looked at.
 */
function Estimate({ unit, rows, cols, logs, miners, limit }: EstimateProps) {
  const t = useT();
  const tooFew = rows <= cols;
  const thin = !tooFew && rows < OBSERVATIONS_PER_MEASURE * cols;
  return (
    <Notice role="status" size="sm" tone={tooFew || thin ? "warn" : "success"}>
      <div className="space-y-0.5 max-w-prose">
        {tooFew ? (
          <div>
            {tooFewKind(rows) === "any"
              ? countText(t, `factor.data.estimate_too_few_any.${unit}`, rows, { needed: MIN_OBSERVATIONS, logs: logs ?? 0, miners: miners ?? 0, limit })
              : t(`factor.data.estimate_too_few.${unit}`, { rows, cols, max: Math.max(0, rows - 1), logs: logs ?? 0, miners: miners ?? 0, limit })}
          </div>
        ) : (
          <div>{t("factor.data.estimate", { rows, cols })}</div>
        )}
        {thin && <div className="text-muted">{t("factor.data.estimate_thin", { target: OBSERVATIONS_PER_MEASURE * cols })}</div>}
      </div>
    </Notice>
  );
}

/** The way on from a loaded dataset: the result, or the next step; busy while the result is computed. */
export interface DataNext {
  label: string;
  busy: boolean;
  /** Why it waits, for its tooltip. */
  reason?: string | null;
  onGo: () => void;
}

/**
 * The data step once a dataset exists: what is loaded and with which settings, and the one way on
 * (the result or the next step); or the progress while it is computed. The step stays on screen
 * after a load, so the steps can be seen filling in.
 */
export function DataSummary({
  dataset,
  catalog,
  settings,
  next,
  titleRef,
  onChange,
  onCancelJob,
  onDelete,
  onRetry,
  retrying,
}: {
  dataset: FactorDataset;
  catalog: FactorCatalog;
  /** The settings it is analysed with, e.g. "Paper settings", once it is ready. */
  settings: string | null;
  next: DataNext | null;
  /** The title of the summary, which takes the focus when the summary replaces the form. */
  titleRef?: React.Ref<HTMLDivElement>;
  onChange: () => void;
  onCancelJob: () => void;
  onDelete: () => Promise<boolean>;
  /** Computes a stopped dataset again; null where what it was made from is gone. */
  onRetry?: (() => void) | null;
  retrying?: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const tMaybe = useTMaybe();
  const name = datasetName(dataset, t, catalog);
  const withRun = !!dataset.job_id;
  // Only a focus target for screen readers after a load: no ring around plain text.
  const title = "outline-none";
  const rows = dataset.n_observations;
  const cols = dataset.measures.length;
  const tooFewLoaded = dataset.status === "ready" && cols > 0 && (rows < MIN_OBSERVATIONS || rows <= cols);

  if (dataset.status === "computing") {
    const pct = progressPercent(dataset.progress);
    return (
      <div className="space-y-3" role="status" aria-live="polite">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0 space-y-1.5">
            <div ref={titleRef} tabIndex={-1} className={cn("flex items-center gap-2 text-sm font-medium", title)}>
              <Loader2 className="h-4 w-4 animate-spin text-accent-ink" />
              {t("factor.data.computing_title", { name })}
            </div>
            <InputChips dataset={dataset} catalog={catalog} />
          </div>
          {/* Deleting aborts the job as well; cancelling keeps the dataset, as aborted. */}
          <div className="flex items-center gap-2 flex-wrap">
            <DeleteDataset withRun={withRun} onDelete={onDelete} />
            <Button variant="outline" size="sm" onClick={onCancelJob}>
              {t("factor.data.cancel")}
            </Button>
          </div>
        </div>
        <div
          className="w-full bg-tile rounded-full h-2 overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct ?? undefined}
          aria-label={t("factor.data.computing_title", { name })}
        >
          {pct === null ? (
            <div className="h-full w-1/3 bg-accent/70 rounded-full animate-pulse" />
          ) : (
            <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
          )}
        </div>
        <p className="flex items-center gap-1 text-xs text-muted">
          {pct !== null && <span className="font-mono mr-1">{formatPercent(pct / 100, locale, 0)}</span>}
          {splitSentence(t("factor.data.computing_hint"))[0]}
          <InfoTip size="xs" topic={t("factor.data.computing_title", { name })} text={t("factor.data.computing_hint")} />
        </p>
      </div>
    );
  }

  if (dataset.status === "aborted") {
    return (
      <div className="space-y-3">
        <Notice
          tone="info"
          role="status"
          title={
            <div ref={titleRef} tabIndex={-1} className={title}>
              {t("factor.data.aborted_title")}
            </div>
          }
        >
          {t(onRetry ? "factor.data.aborted_hint" : "factor.data.aborted_hint_gone")}
        </Notice>
        {/* No data to open: compute again where what it was made from is still there. */}
        <div className="flex items-center gap-2 flex-wrap">
          {onRetry && (
            <Button size="sm" onClick={onRetry} disabled={retrying}>
              {retrying && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {t("factor.data.retry")}
            </Button>
          )}
          <DeleteDataset withRun={withRun} onDelete={onDelete} />
          <Button variant="outline" size="sm" onClick={onChange}>
            {t("factor.data.change")}
          </Button>
        </div>
      </div>
    );
  }

  if (dataset.status === "failed") {
    const failure = plainFailure(
      tMaybe,
      { code: dataset.error_code, params: dataset.error_params, message: dataset.error },
      t("errors.compute_failed"),
    );
    return (
      <div className="space-y-3">
        <Notice
          tone="error"
          role="alert"
          title={
            <div ref={titleRef} tabIndex={-1} className={title}>
              {t("factor.data.failed_title")}
            </div>
          }
        >
          <span className="inline-flex items-start gap-1.5">
            {failure.text}
            {failure.details && <InfoTip size="xs" topic={t("factor.data.details")} text={failure.details} />}
          </span>
        </Notice>
        {/* The same buttons, in the same order, as for a ready dataset. */}
        <div className="flex items-center gap-2 flex-wrap">
          <DeleteDataset withRun={withRun} onDelete={onDelete} />
          <Button variant="outline" size="sm" onClick={onChange}>
            {t("factor.data.change")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div data-summary className="rounded-lg bg-tile/50 p-4 space-y-4 scroll-mb-24">
      <div className="flex items-start gap-3 min-w-0">
        <div className="h-8 w-8 rounded-full bg-success/15 grid place-items-center shrink-0" aria-hidden>
          <Check className="h-4 w-4 text-success-ink" strokeWidth={2.5} />
        </div>
        <div className="min-w-0 space-y-1">
          <div ref={titleRef} tabIndex={-1} className={cn("text-sm font-medium break-words", title)}>
            {t("factor.data.loaded", { name })}
            {settings && <span className="font-normal text-muted"> · {settings}</span>}
          </div>
          <InputChips dataset={dataset} catalog={catalog} />
          <SkippedLine dataset={dataset} catalog={catalog} />
        </div>
      </div>
      {/* The estimate of the form, kept: the analysis will not run with so few observations. */}
      {tooFewLoaded && (
        <Notice role="status" size="sm" tone="warn">
          <div className="max-w-prose">
            {tooFewKind(rows) === "any"
              ? countText(t, "factor.data.loaded_too_few_any", rows, { needed: MIN_OBSERVATIONS })
              : t("factor.data.loaded_too_few", { rows, cols, max: Math.max(0, rows - 1) })}
          </div>
        </Notice>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <DeleteDataset withRun={withRun} onDelete={onDelete} />
        <Button variant="outline" size="sm" onClick={onChange}>
          {t("factor.data.change")}
        </Button>
        {next && <NextFromData next={next} />}
      </div>
    </div>
  );
}

/** The primary button of a loaded dataset: on to the result or to the next step. */
/** The feature groups that feeed could not compute for some log, as one line; the groups are in its (i). */
function SkippedLine({ dataset, catalog }: { dataset: FactorDataset; catalog: FactorCatalog }) {
  const t = useT();
  const tMaybe = useTMaybe();
  const skipped = dataset.skipped ?? [];
  if (skipped.length === 0) return null;
  const reasonOf = (code: string) =>
    tMaybe(`factor.data.skipped_reason.${code}`) ?? t("factor.data.skipped_reason.group_failed");
  const n = skipped.reduce((sum, g) => sum + g.measures.length, 0);
  const reasons = Array.from(new Set(skipped.map((g) => reasonOf(g.code)))).join(", ");
  const groups = skipped
    .map((g) =>
      t("factor.data.skipped_group", {
        name: catalog.groups?.find((x) => x.key === g.group)?.name ?? g.group,
        reason: reasonOf(g.code),
        inputs: g.inputs.join(", "),
      }),
    )
    .join("; ");
  return (
    <p className="flex items-center gap-1 text-xs text-warn-ink">
      {countText(t, "factor.data.skipped", n, { reason: reasons })}
      <InfoTip size="xs" topic={t("factor.data.details")} text={t("factor.data.skipped_info", { groups })} />
    </p>
  );
}

function NextFromData({ next }: { next: DataNext }) {
  const tip = useTip<HTMLButtonElement>(next.reason ? { name: next.label, reason: next.reason } : null);
  return (
    <Button
      ref={tip}
      aria-disabled={next.busy || undefined}
      onClick={() => !next.busy && next.onGo()}
      className="ml-auto aria-disabled:opacity-60 aria-disabled:cursor-wait"
    >
      {next.busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {next.label}
      {!next.busy && <ChevronRight className="h-4 w-4 -mr-1" aria-hidden />}
    </Button>
  );
}

const SOURCES: DatasetSource[] = ["bundled", "csv", "logs", "pnml"];

/** What a dataset was built from, as one line of text: source, inputs, miners or feature groups, size. */
function InputChips({ dataset, catalog }: { dataset: FactorDataset; catalog: FactorCatalog }) {
  const t = useT();
  const zone = useTipZone<HTMLUListElement>();
  const source = SOURCES.find((s) => s === dataset.source);
  const Icon = source ? SOURCE_ICON[source] : Database;
  const inputs: InputsSummary = dataset.inputs ?? { files: 0 };
  const names = (keys: string[], known: { key: string; name: string }[] | undefined) =>
    keys.map((k) => known?.find((x) => x.key === k)?.name ?? k).join(", ");
  const sample = inputs.sample_id ? catalog.samples?.find((s) => s.id === inputs.sample_id) : undefined;
  const parts: { key: string; text: string; more?: string }[] = [];
  if ((source === "logs" || source === "pnml") && inputs.files > 0) {
    parts.push({
      key: "files",
      text: countText(t, source === "logs" ? "factor.inputs.logs" : "factor.inputs.nets", inputs.files),
      more: sample && `${t("factor.data.sample_label")}: ${sample.name}`,
    });
  }
  if (inputs.miners?.length) {
    parts.push({
      key: "miners",
      text: countText(t, "factor.inputs.miners", inputs.miners.length),
      more: names(inputs.miners, catalog.miners),
    });
  }
  if (inputs.groups?.length) {
    parts.push({
      key: "groups",
      text: countText(t, "factor.inputs.groups", inputs.groups.length),
      more: names(inputs.groups, catalog.groups),
    });
    // Single measures of the groups rather than whole groups.
    const whole = catalog.measures.filter((m) => m.group && inputs.groups?.includes(m.group)).length;
    if (inputs.measures?.length && inputs.measures.length < whole) {
      parts.push({ key: "chosen", text: t("factor.inputs.measures_of", { n: inputs.measures.length, total: whole }) });
    }
  }
  if (dataset.status === "ready") {
    // After the cleaning, so it can be smaller than the size of a bundled dataset in the list.
    parts.push({
      key: "size",
      text: t("factor.data.cleaned_size", { rows: dataset.n_observations, cols: dataset.measures.length }),
    });
  } else if (dataset.kind === "model" && inputs.measures?.length) {
    // Until the matrix exists, the measures asked for.
    parts.push({
      key: "measures",
      text: countText(t, "factor.inputs.measures", inputs.measures.length),
      more: names(inputs.measures, catalog.measures),
    });
  }
  return (
    <ul ref={zone} aria-label={t("factor.data.inputs_aria")} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted">
      <li className="inline-flex items-center gap-1">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {source ? t(`factor.data.source.${source}`) : dataset.source}
      </li>
      {parts.map((p) => (
        <li key={p.key} className="inline-flex items-center gap-1.5">
          <span aria-hidden>·</span>
          <span data-tip-more={p.more}>{p.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** A ghost button that deletes the open dataset after a confirmation. */
function DeleteDataset({ withRun, onDelete }: { withRun: boolean; onDelete: () => Promise<boolean> }) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const askRef = useRef<HTMLButtonElement>(null);
  const askTip = useTip<HTMLButtonElement>(withRun ? { more: t("factor.data.delete_with_run") } : null);
  const mergedAsk = useMemo(() => mergeRefs(askRef, askTip), [askTip]);
  const refocus = useRef(false);
  // The confirmation replaces the button; after a cancel the focus goes back to it.
  useEffect(() => {
    if (!confirming && refocus.current) {
      refocus.current = false;
      askRef.current?.focus();
    }
  }, [confirming]);
  if (confirming) {
    return (
      <ConfirmDelete
        withRun={withRun}
        onConfirm={onDelete}
        onCancel={() => {
          refocus.current = true;
          setConfirming(false);
        }}
      />
    );
  }
  return (
    <Button
      ref={mergedAsk}
      variant="ghost"
      size="sm"
      className="text-muted hover:text-danger-ink hover:bg-danger/10"
      onClick={() => setConfirming(true)}
    >
      <Trash2 className="h-3.5 w-3.5" />
      {t("factor.data.delete")}
    </Button>
  );
}

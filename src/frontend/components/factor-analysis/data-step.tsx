"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Check,
  Copy,
  Database,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Loader2,
  Network,
  Package,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import {
  MAX_DATASET_FILES,
  MAX_DATASET_TOTAL_BYTES,
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
import { MIN_MEASURES, countText, datasetName, progressPercent, publishedOptions } from "@/lib/factor-analysis";
import { formatDateTime, formatFileSize, formatNumber, formatPercent, formatRelative } from "@/lib/format";
import { datasetNote, orderCollection, settingsSourceText } from "@/lib/paper-notes";
import { cn } from "@/lib/utils";
import { useLocale, useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { ChoiceMark, choiceTile } from "@/components/ui/choice";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { UploadZone } from "@/components/upload-zone";

const MAX_FILE_BYTES = 100 * 1024 * 1024;

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

/** The settings a bundled dataset opens with: the tool's standard, or those of its paper. */
export type OpenPreset = "standard" | "published";

interface Props {
  kind: FactorKind;
  catalog: FactorCatalog;
  /** Datasets of this kind in the session, newest first; listed in their own tab. */
  datasets: DatasetSummary[];
  /** The dataset open on the tab, if any. */
  openId: string | null;
  submitting: boolean;
  submitError: string | null;
  /** `preset` says which settings a bundled dataset with published settings opens with. */
  onSubmit: (input: CreateDatasetInput, preset: OpenPreset) => void;
  onOpen: (id: string) => void;
  /** Resolves to whether the dataset was deleted. */
  onDelete: (id: string) => Promise<boolean>;
  /** Shown when a dataset already exists, to return to it without building a new one. */
  onCancel?: () => void;
  /** Set by the toolbar: show My datasets with the focus on its list; `onRequestHandled` says it did. */
  showMine?: number;
  onRequestHandled?: () => void;
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
  showMine,
  onRequestHandled,
}: Props) {
  const t = useT();
  const sources = catalog.sources.filter((s) => kind === "model" || s !== "pnml");
  const [source, setSource] = useState<DatasetSource>(sources[0] ?? "bundled");
  // The own datasets come first when there are any; the tab goes away with the last of them.
  const [mineChosen, setMineChosen] = useState(datasets.length > 0);
  const mine = mineChosen && datasets.length > 0;
  const [bundledId, setBundledId] = useState<string | null>(catalog.bundled[0]?.id ?? null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [logFiles, setLogFiles] = useState<File[]>([]);
  const [pnmlFiles, setPnmlFiles] = useState<File[]>([]);
  const [measures, setMeasures] = useState<string[]>(catalog.defaults.measures);
  const [miners, setMiners] = useState<string[]>(catalog.defaults.miners ?? []);
  const [groups, setGroups] = useState<string[]>(catalog.defaults.groups ?? []);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // Kept across the bundled datasets, so several open alike.
  const [preset, setPreset] = useState<OpenPreset>("standard");
  // Chosen sample per source; a sample replaces the uploaded files.
  const [sampleIds, setSampleIds] = useState<Partial<Record<DatasetSource, string>>>({});

  const [focusMine, setFocusMine] = useState(false);
  useEffect(() => {
    if (!showMine) return;
    if (datasets.length > 0) {
      setMineChosen(true);
      setFocusMine(true);
    }
    onRequestHandled?.();
  }, [showMine, datasets.length, onRequestHandled]);

  const files = source === "logs" ? logFiles : pnmlFiles;
  const setFiles = source === "logs" ? setLogFiles : setPnmlFiles;
  const maxFiles = MAX_DATASET_FILES[source] ?? 1;
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
      } else if (f.size > MAX_FILE_BYTES) {
        messages.push(t("factor.data.too_large", { name: f.name }));
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
        if (total + f.size > MAX_DATASET_TOTAL_BYTES) continue;
        total += f.size;
        fitting.push(f);
      }
      if (fitting.length < Math.min(fresh.length, Math.max(room, 0))) {
        messages.push(t("factor.data.too_large_total", { mb: MAX_DATASET_TOTAL_BYTES / (1024 * 1024) }));
      }
      setFiles([...files, ...fitting]);
    }
    setNotice(messages.length > 0 ? messages.join(" ") : null);
  };

  // Measures computed for the chosen groups; only used for the size estimate on the log tab.
  const groupMeasureCount = useMemo(
    () => catalog.measures.filter((m) => m.group && groups.includes(m.group)).length,
    [catalog.measures, groups],
  );

  const estimate = useMemo(() => {
    if (source === "logs" && kind === "model") return { rows: nInputs * miners.length, cols: measures.length };
    if (source === "logs") return { rows: nInputs, cols: groupMeasureCount };
    if (source === "pnml") return { rows: nInputs, cols: measures.length };
    return null;
  }, [source, kind, nInputs, miners.length, measures.length, groupMeasureCount]);

  const blocker: string | null = (() => {
    if (source === "bundled") return bundledId ? null : t("factor.data.need_bundled");
    if (source === "csv") return csvFile ? null : t("factor.data.need_csv");
    if (nInputs === 0) return t("factor.data.need_files");
    if (source === "logs" && kind === "model" && miners.length === 0) return t("factor.data.need_miner");
    if (source === "logs" && kind === "log") return groups.length === 0 ? t("factor.data.need_group") : null;
    if (measures.length < MIN_MEASURES) return t("factor.data.need_measures", { n: MIN_MEASURES });
    return null;
  })();

  const submit = () => {
    if (blocker) return;
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
      }
    }
    if (source === "pnml") {
      input.files = sample ? undefined : pnmlFiles;
      if (sample) input.bundledId = sample.id;
      input.measures = measures;
    }
    onSubmit(input, preset);
  };

  const submitLabel =
    source === "bundled"
      ? t("factor.data.submit_bundled")
      : source === "csv"
        ? t("factor.data.submit_csv")
        : t("factor.data.submit_compute");

  const tabs = (
    <div className="space-y-2">
      <div className="overflow-x-auto no-scrollbar">
        <Segmented<DatasetSource | "mine">
          aria-label={t("factor.data.source_aria")}
          className="min-w-max sm:max-w-[560px]"
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
      </div>
      <p className="text-xs text-muted max-w-prose">
        {t(
          mine
            ? "factor.data.source_hint.mine"
            : source === "logs"
              ? `factor.data.source_hint.logs_${kind}`
              : `factor.data.source_hint.${source}`,
        )}
      </p>
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
          focus={focusMine}
          onFocused={() => setFocusMine(false)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {tabs}

      {source === "bundled" && (
        <BundledList kind={kind} catalog={catalog} selected={bundledId} onSelect={setBundledId} />
      )}

      {source === "bundled" && (
        <PresetChoice
          kind={kind}
          dataset={catalog.bundled.find((b) => b.id === bundledId)}
          value={preset}
          onChange={setPreset}
        />
      )}

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
          <p className="text-xs text-muted max-w-prose">{t("factor.data.csv_format")}</p>
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
        <p role="status" className="text-xs text-warn-ink flex items-start gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          {notice}
        </p>
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
        <Checklist
          heading={t("factor.data.groups_heading")}
          hint={t("factor.data.groups_hint")}
          items={catalog.groups.map((g) => ({
            key: g.key,
            name: g.name,
            description: g.description,
            slow: g.slow,
            detail: t("factor.data.group_measures", {
              n: catalog.measures.filter((m) => m.group === g.key).length,
            }),
          }))}
          selected={groups}
          onChange={setGroups}
          defaults={catalog.defaults.groups ?? []}
          wide
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

      {estimate && estimate.rows > 0 && estimate.cols > 0 && <Estimate rows={estimate.rows} cols={estimate.cols} />}

      {submitError && (
        <div role="alert" className="rounded-lg bg-danger/10 px-3.5 py-2.5 flex items-start gap-2.5 text-sm">
          <AlertCircle className="h-4 w-4 text-danger-ink shrink-0 mt-0.5" />
          <span>{submitError}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 flex-wrap pt-1">
        {blocker && <span className="text-xs text-muted mr-auto">{blocker}</span>}
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={submitting}>
            {t("common.cancel")}
          </Button>
        )}
        <Button onClick={submit} disabled={!!blocker || submitting}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitting ? t("factor.data.submitting") : submitLabel}
        </Button>
      </div>
    </div>
  );
}

function BundledList({
  kind,
  catalog,
  selected,
  onSelect,
}: {
  kind: FactorKind;
  catalog: FactorCatalog;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  if (catalog.bundled.length === 0) {
    return <p className="text-sm text-muted">{t("factor.data.bundled_empty")}</p>;
  }
  const collections = catalog.collections ?? [];
  const grouped = collections
    .map((c) => ({ collection: c, items: orderCollection(c.id, catalog.bundled.filter((b) => b.collection === c.id)) }))
    .filter((g) => g.items.length > 0);
  const loose = catalog.bundled.filter((b) => !collections.some((c) => c.id === b.collection));
  const tile = (b: BundledDataset, showSize: boolean) => (
    <BundledTile
      key={b.id}
      name={`fa-bundled-${kind}`}
      dataset={b}
      chosen={b.id === selected}
      showSize={showSize}
      onSelect={() => onSelect(b.id)}
    />
  );
  return (
    <div role="radiogroup" aria-label={t("factor.data.source.bundled")} className="space-y-3">
      {grouped.map(({ collection, items }) => {
        const sameSize = items.every(
          (b) => b.observations === items[0].observations && b.measures === items[0].measures,
        );
        return (
          <CollectionBlock key={collection.id} collection={collection} size={sameSize ? items[0] : null}>
            {items.map((b) => tile(b, !sameSize))}
          </CollectionBlock>
        );
      })}
      {loose.length > 0 && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{loose.map((b) => tile(b, true))}</div>}
    </div>
  );
}

/**
 * For a bundled dataset with published settings: whether it opens with the tool standard or
 * with the settings of its paper. Nothing for other datasets, which open with the standard.
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
  const details: Record<OpenPreset, string> = {
    standard: t("factor.data.preset_standard_detail"),
    published: [
      paper.n_factors !== null ? countText(t, "factor.factors.criterion_count", paper.n_factors) : null,
      t(`factor.settings.rotation.${paper.rotation}`),
      t(`factor.settings.rule.${paper.assignment_rule}`),
    ]
      .filter(Boolean)
      .join(" · "),
  };
  return (
    <div className="space-y-1.5">
      <div id={`fa-preset-${kind}`} className="text-xs font-medium text-muted">
        {t("factor.data.preset_label")}
      </div>
      <div role="radiogroup" aria-labelledby={`fa-preset-${kind}`} className="grid gap-2 sm:grid-cols-2 max-w-2xl">
        {(["standard", "published"] as const).map((p) => (
          <label key={p} className={cn("flex items-start gap-2.5 rounded-md px-3 py-2", choiceTile(value === p))}>
            <input
              type="radio"
              name="fa-open-preset"
              value={p}
              className="sr-only"
              checked={value === p}
              onChange={() => onChange(p)}
              aria-label={t(`factor.data.preset.${p}`)}
              aria-describedby={`fa-preset-${kind}-${p}`}
            />
            <ChoiceMark type="radio" checked={value === p} className="mt-0.5" />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{t(`factor.data.preset.${p}`)}</span>
              <span id={`fa-preset-${kind}-${p}`} className="block text-[11px] text-muted">
                {details[p]}
                {p === "published" && source && <span className="block">{source}</span>}
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** One paper with its datasets: what they are and how to cite them, said once. */
function CollectionBlock({
  collection,
  size,
  children,
}: {
  collection: DatasetCollection;
  /** Shown in the header when every dataset of the paper has the same shape. */
  size: { observations: number; measures: number } | null;
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
  // On a phone the labels are only hidden from view: they still name the icon buttons.
  const action =
    "h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-[11px] font-medium text-muted hover:text-fg hover:bg-accent/[0.08] transition";
  return (
    <section className="rounded-lg bg-tile/40 p-3.5 sm:p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 rounded-md bg-accent/[0.12] text-accent-ink grid place-items-center shrink-0">
          <BookOpen className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold leading-snug">
            {collection.name}
            {collection.venue && <span className="ml-2 text-xs font-normal text-muted">{collection.venue}</span>}
          </h4>
          <p className="text-xs text-muted mt-0.5 max-w-prose">{collection.description}</p>
          <div className="mt-1.5 flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-muted">
            {size && <span>{t("factor.data.bundled_size", { rows: size.observations, cols: size.measures })}</span>}
            {collection.license && <span>{t("factor.data.license", { license: collection.license })}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {collection.citation && (
            <button type="button" onClick={copy} title={collection.citation} className={action}>
              {copied ? <Check className="h-3.5 w-3.5 text-success-ink" /> : <Copy className="h-3.5 w-3.5" />}
              <span className="sr-only sm:not-sr-only">{copied ? t("factor.data.copied") : t("factor.data.copy_citation")}</span>
            </button>
          )}
          {collection.source_url && (
            <a href={collection.source_url} target="_blank" rel="noreferrer" className={action}>
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="sr-only sm:not-sr-only">{t("factor.data.source_link")}</span>
            </a>
          )}
        </div>
      </div>
      {collection.note && (
        <p className="text-[11px] text-warn-ink flex items-start gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 mt-px shrink-0" />
          {collection.note}
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

function BundledTile({
  name,
  dataset,
  chosen,
  showSize,
  onSelect,
}: {
  name: string;
  dataset: BundledDataset;
  chosen: boolean;
  showSize: boolean;
  onSelect: () => void;
}) {
  const t = useT();
  const noteId = useId();
  const label = dataset.label ?? dataset.name;
  const note = datasetNote(dataset.id, t);
  return (
    <label
      title={dataset.description}
      className={cn("flex items-center gap-2.5 rounded-md px-3 py-2.5", choiceTile(chosen))}
    >
      {/* Named by the label alone, so the note describes the choice rather than renaming it. */}
      <input
        type="radio"
        name={name}
        className="sr-only"
        checked={chosen}
        onChange={onSelect}
        aria-label={label}
        aria-describedby={note ? noteId : undefined}
      />
      <ChoiceMark type="radio" checked={chosen} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium truncate">{label}</span>
        {showSize && (
          <span className="block text-[11px] text-muted">
            {t("factor.data.bundled_size", { rows: dataset.observations, cols: dataset.measures })}
          </span>
        )}
        {note && (
          <span id={noteId} className="block text-[11px] text-muted leading-snug">
            {note}
          </span>
        )}
      </span>
    </label>
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
  focus,
  onFocused,
}: {
  kind: FactorKind;
  catalog: FactorCatalog;
  datasets: DatasetSummary[];
  openId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => Promise<boolean>;
  onCancel?: () => void;
  /** Give the chosen tile the focus, e.g. when the toolbar asked for My datasets. */
  focus?: boolean;
  onFocused?: () => void;
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

  useEffect(() => {
    if (!focus) return;
    const input = listRef.current?.querySelector<HTMLInputElement>("input:checked");
    input?.focus({ preventScroll: true });
    listRef.current?.scrollIntoView({ block: "nearest" });
    onFocused?.();
  }, [focus, onFocused]);

  return (
    <div className="space-y-5">
      <div
        ref={listRef}
        role="radiogroup"
        aria-label={t("factor.data.source.mine")}
        className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
      >
        {datasets.map((d) => (
          <DatasetTile
            key={d.id}
            name={`fa-mine-${kind}`}
            dataset={d}
            catalog={catalog}
            chosen={d.id === chosen}
            open={d.id === openId}
            onSelect={() => setSelected(d.id)}
            onDelete={() => remove(d.id)}
          />
        ))}
      </div>
      <div className="flex items-center justify-end gap-3 flex-wrap pt-1">
        {!chosen && <span className="text-xs text-muted mr-auto">{t("factor.data.need_mine")}</span>}
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        )}
        <Button onClick={() => chosen && onOpen(chosen)} disabled={!chosen}>
          {t("factor.data.submit_open")}
        </Button>
      </div>
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
}: {
  name: string;
  dataset: DatasetSummary;
  catalog: FactorCatalog;
  chosen: boolean;
  /** The dataset is the one open on the tab. */
  open: boolean;
  onSelect: () => void;
  onDelete: () => Promise<void>;
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
  return (
    // min-w-0: a long name wraps instead of widening the grid column beyond the page.
    <div className={cn("rounded-md min-w-0", choiceTile(chosen))}>
      <div className="flex items-start">
        <label className="flex-1 min-w-0 flex items-start gap-2.5 pl-3 py-2.5 cursor-pointer">
          <input type="radio" name={name} className="sr-only" checked={chosen} onChange={onSelect} />
          <ChoiceMark type="radio" checked={chosen} className="mt-0.5" />
          <span className="min-w-0 flex-1">
            <span className="flex items-start gap-1.5 min-w-0">
              {/* Two lines: names of one paper differ only at the end. */}
              <span className="min-w-0 text-sm font-medium line-clamp-2 break-words" title={title}>
                {title}
              </span>
              {open && (
                <span className="mt-0.5 rounded bg-success/15 text-success-ink px-1 text-[10px] font-medium shrink-0">
                  {t("factor.data.mine_open")}
                </span>
              )}
            </span>
            <span className="mt-0.5 flex items-center gap-x-1.5 gap-y-0.5 flex-wrap text-[11px] text-muted">
              <Icon className="h-3 w-3 shrink-0" />
              <span>{t(`factor.data.source.${dataset.source}`)}</span>
              {/* Each separator wraps with the item after it, so none ends a line. */}
              {rows !== null && cols !== null && (
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden>·</span>
                  <span title={t("factor.data.cleaned_size", { rows, cols })}>
                    {formatNumber(rows, locale)} × {formatNumber(cols, locale)}
                  </span>
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden>·</span>
                <time dateTime={dataset.created_at} title={formatDateTime(dataset.created_at, locale)}>
                  {formatRelative(dataset.created_at, locale)}
                </time>
              </span>
              {dataset.status !== "ready" && (
                <span
                  className={cn(
                    "rounded px-1 text-[10px] font-medium",
                    dataset.status === "failed" ? "bg-danger/15 text-danger-ink" : "bg-accent/[0.18] text-accent-ink",
                  )}
                >
                  {t(`factor.data.mine_${dataset.status}`)}
                </span>
              )}
            </span>
          </span>
        </label>
        <button
          ref={askRef}
          type="button"
          onClick={() => setConfirming((c) => !c)}
          aria-label={t("factor.data.delete_aria", { name: title })}
          aria-expanded={confirming}
          title={t(withRun ? "factor.data.delete_with_run" : "factor.data.delete")}
          className="m-1.5 h-7 w-7 grid place-items-center rounded-md text-muted hover:text-danger-ink hover:bg-danger/10 transition shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
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
  return (
    <div className={cn("rounded-md px-3 py-2.5 flex items-center gap-3", choiceTile(chosen))}>
      <label className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer" title={sample.citation}>
        <input type="checkbox" className="sr-only" checked={chosen} onChange={onToggle} />
        <ChoiceMark checked={chosen} />
        <Package className="h-4 w-4 text-muted shrink-0" />
        <span className="min-w-0">
          <span className="block text-sm font-medium truncate">
            {t("factor.data.sample_label")}: {sample.name}
          </span>
          <span className="block text-[11px] text-muted truncate">
            {files}
            {sample.description && ` · ${sample.description}`}
          </span>
        </span>
      </label>
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
      <ul className="max-h-48 overflow-y-auto p-1.5 grid gap-1 sm:grid-cols-2">
        {files.map((f, i) => (
          <li key={`${f.name}:${f.size}`} className="flex items-center gap-2 rounded px-2 py-1.5 bg-bg/40 text-xs min-w-0">
            <FileText className="h-3.5 w-3.5 text-muted shrink-0" />
            <span className="truncate flex-1" title={f.name}>
              {f.name}
            </span>
            <span className="text-[10px] text-muted shrink-0">{formatFileSize(f.size, locale)}</span>
            <button
              type="button"
              onClick={() => onRemove(i)}
              aria-label={t("factor.data.remove_file_aria", { name: f.name })}
              className="h-5 w-5 grid place-items-center rounded text-muted hover:text-danger-ink transition shrink-0"
            >
              <X className="h-3 w-3" />
            </button>
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
  const linkClass = "text-[11px] text-muted hover:text-fg transition inline-flex items-center gap-1";
  return (
    <fieldset className="space-y-2">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <legend className="text-sm font-semibold">
            {heading}{" "}
            <span className="text-xs font-normal text-muted">
              {t("factor.data.selected_count", { n: selected.length, total: items.length })}
            </span>
          </legend>
          <p className="text-xs text-muted mt-0.5 max-w-prose">{hint}</p>
        </div>
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
        {items.map((item) => {
          const on = chosen.has(item.key);
          return (
            <label
              key={item.key}
              title={item.description}
              className={cn("flex items-start gap-2.5 rounded-md px-2.5 py-2 text-xs", choiceTile(on))}
            >
              <input type="checkbox" checked={on} onChange={() => toggle(item.key)} className="sr-only" />
              <ChoiceMark checked={on} className="mt-px" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium">{item.name}</span>
                  {item.slow && (
                    <span
                      className="rounded bg-warn/15 text-warn-ink px-1 text-[10px] font-medium"
                      title={t("factor.data.slow_title")}
                    >
                      {t("factor.data.slow_badge")}
                    </span>
                  )}
                  {item.detail && <span className="text-[10px] text-muted">{item.detail}</span>}
                </span>
                {wide && item.description && (
                  <span className="block text-[11px] text-muted mt-0.5 leading-snug">{item.description}</span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function Estimate({ rows, cols }: { rows: number; cols: number }) {
  const t = useT();
  const tooFew = rows <= cols;
  const thin = !tooFew && rows < 5 * cols;
  return (
    <div
      className={cn(
        "rounded-lg px-3.5 py-2.5 text-xs flex items-start gap-2.5",
        tooFew ? "bg-danger/10" : thin ? "bg-warn/10" : "bg-tile",
      )}
    >
      {tooFew || thin ? (
        <AlertCircle className={cn("h-4 w-4 shrink-0", tooFew ? "text-danger-ink" : "text-warn-ink")} />
      ) : (
        <Check className="h-4 w-4 shrink-0 text-success-ink" />
      )}
      <div className="space-y-0.5">
        <div>{t("factor.data.estimate", { rows, cols })}</div>
        {tooFew && <div className="text-muted">{t("factor.data.estimate_too_few", { min: cols + 1 })}</div>}
        {thin && <div className="text-muted">{t("factor.data.estimate_thin", { target: 5 * cols })}</div>}
      </div>
    </div>
  );
}

/** The data step once a dataset exists: what is loaded, or the progress while it is computed. */
export function DataSummary({
  dataset,
  catalog,
  titleRef,
  onChange,
  onCancelJob,
  onDelete,
}: {
  dataset: FactorDataset;
  catalog: FactorCatalog;
  /** The title of the summary, which takes the focus when the summary replaces the form. */
  titleRef?: React.Ref<HTMLDivElement>;
  onChange: () => void;
  onCancelJob: () => void;
  onDelete: () => Promise<boolean>;
}) {
  const t = useT();
  const { locale } = useLocale();
  const name = datasetName(dataset, t, catalog);
  const withRun = !!dataset.job_id;
  const title =
    "rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

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
          {/* Deleting aborts the job as well; cancelling keeps the dataset, as failed. */}
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
        <p className="text-xs text-muted">
          {pct !== null && <span className="font-mono mr-2">{formatPercent(pct / 100, locale, 0)}</span>}
          {t("factor.data.computing_hint")}
        </p>
      </div>
    );
  }

  if (dataset.status === "failed") {
    return (
      <div className="space-y-3">
        <div role="alert" className="rounded-lg bg-danger/10 px-3.5 py-3 flex items-start gap-2.5">
          <AlertCircle className="h-4 w-4 text-danger-ink shrink-0 mt-0.5" />
          <div className="text-sm">
            <div ref={titleRef} tabIndex={-1} className={cn("font-medium", title)}>
              {t("factor.data.failed_title")}
            </div>
            {dataset.error && <div className="text-muted mt-1 break-words">{dataset.error}</div>}
          </div>
        </div>
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
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="flex items-start gap-3 min-w-0">
        <div className="h-9 w-9 rounded-md bg-success/10 grid place-items-center shrink-0">
          <Check className="h-4 w-4 text-success-ink" />
        </div>
        <div className="min-w-0 space-y-1.5">
          <div ref={titleRef} tabIndex={-1} className={cn("text-sm font-medium truncate", title)}>
            {name}
          </div>
          <InputChips dataset={dataset} catalog={catalog} />
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <DeleteDataset withRun={withRun} onDelete={onDelete} />
        <Button variant="outline" size="sm" onClick={onChange}>
          {t("factor.data.change")}
        </Button>
      </div>
    </div>
  );
}

const SOURCES: DatasetSource[] = ["bundled", "csv", "logs", "pnml"];

/** What a dataset was built from, as chips: source, inputs, miners or feature groups, size. */
function InputChips({ dataset, catalog }: { dataset: FactorDataset; catalog: FactorCatalog }) {
  const t = useT();
  const source = SOURCES.find((s) => s === dataset.source);
  const Icon = source ? SOURCE_ICON[source] : Database;
  const inputs: InputsSummary = dataset.inputs ?? { files: 0 };
  const names = (keys: string[], known: { key: string; name: string }[] | undefined) =>
    keys.map((k) => known?.find((x) => x.key === k)?.name ?? k).join(", ");
  const sample = inputs.sample_id ? catalog.samples?.find((s) => s.id === inputs.sample_id) : undefined;
  const chips: { key: string; text: string; title?: string }[] = [];
  if ((source === "logs" || source === "pnml") && inputs.files > 0) {
    chips.push({
      key: "files",
      text: countText(t, source === "logs" ? "factor.inputs.logs" : "factor.inputs.nets", inputs.files),
      title: sample && `${t("factor.data.sample_label")}: ${sample.name}`,
    });
  }
  if (inputs.miners?.length) {
    chips.push({
      key: "miners",
      text: countText(t, "factor.inputs.miners", inputs.miners.length),
      title: names(inputs.miners, catalog.miners),
    });
  }
  if (inputs.groups?.length) {
    chips.push({
      key: "groups",
      text: countText(t, "factor.inputs.groups", inputs.groups.length),
      title: names(inputs.groups, catalog.groups),
    });
  }
  if (dataset.status === "ready") {
    // After the cleaning, so it can be smaller than the size of a bundled dataset in the list.
    chips.push({
      key: "size",
      text: t("factor.data.cleaned_size", { rows: dataset.n_observations, cols: dataset.measures.length }),
    });
  } else if (dataset.kind === "model" && inputs.measures?.length) {
    // Until the matrix exists, the measures asked for.
    chips.push({
      key: "measures",
      text: countText(t, "factor.inputs.measures", inputs.measures.length),
      title: names(inputs.measures, catalog.measures),
    });
  }
  const chip = "inline-flex items-center gap-1 rounded-md bg-tile px-2 py-0.5 text-[11px] text-muted";
  return (
    <ul aria-label={t("factor.data.inputs_aria")} className="flex flex-wrap gap-1.5">
      <li className={chip}>
        <Icon className="h-3 w-3 shrink-0" />
        {source ? t(`factor.data.source.${source}`) : dataset.source}
      </li>
      {chips.map((c) => (
        <li key={c.key} className={chip} title={c.title}>
          {c.text}
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
      ref={askRef}
      variant="ghost"
      size="sm"
      className="text-muted hover:text-danger-ink hover:bg-danger/10"
      onClick={() => setConfirming(true)}
      title={withRun ? t("factor.data.delete_with_run") : undefined}
    >
      <Trash2 className="h-3.5 w-3.5" />
      {t("factor.data.delete")}
    </Button>
  );
}

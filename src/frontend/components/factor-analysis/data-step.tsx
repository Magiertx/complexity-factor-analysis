"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Check,
  Copy,
  Database,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Loader2,
  Network,
  Package,
  RotateCcw,
  X,
} from "lucide-react";
import {
  MAX_DATASET_FILES,
  MAX_DATASET_TOTAL_BYTES,
  type BundledDataset,
  type CreateDatasetInput,
  type DatasetCollection,
  type DatasetSource,
  type FactorCatalog,
  type FactorDataset,
  type FactorKind,
  type SampleInput,
} from "@/lib/api";
import { MIN_MEASURES, progressPercent } from "@/lib/factor-analysis";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
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

interface Props {
  kind: FactorKind;
  catalog: FactorCatalog;
  submitting: boolean;
  submitError: string | null;
  onSubmit: (input: CreateDatasetInput) => void;
  /** Shown when a dataset already exists, to return to it without building a new one. */
  onCancel?: () => void;
}

export function DataForm({ kind, catalog, submitting, submitError, onSubmit, onCancel }: Props) {
  const t = useT();
  const sources = catalog.sources.filter((s) => kind === "model" || s !== "pnml");
  const [source, setSource] = useState<DatasetSource>(sources[0] ?? "bundled");
  const [bundledId, setBundledId] = useState<string | null>(catalog.bundled[0]?.id ?? null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [logFiles, setLogFiles] = useState<File[]>([]);
  const [pnmlFiles, setPnmlFiles] = useState<File[]>([]);
  const [measures, setMeasures] = useState<string[]>(catalog.defaults.measures);
  const [miners, setMiners] = useState<string[]>(catalog.defaults.miners ?? []);
  const [groups, setGroups] = useState<string[]>(catalog.defaults.groups ?? []);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // Chosen sample per source; a sample replaces the uploaded files.
  const [sampleIds, setSampleIds] = useState<Partial<Record<DatasetSource, string>>>({});

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
    onSubmit(input);
  };

  const submitLabel =
    source === "bundled"
      ? t("factor.data.submit_bundled")
      : source === "csv"
        ? t("factor.data.submit_csv")
        : t("factor.data.submit_compute");

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="overflow-x-auto no-scrollbar">
          <Segmented
            className="min-w-max sm:max-w-[560px]"
            value={source}
            onChange={(s) => {
              setSource(s);
              setNotice(null);
            }}
            options={sources.map((s) => {
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
            })}
          />
        </div>
        <p className="text-xs text-muted max-w-prose">
          {t(source === "logs" ? `factor.data.source_hint.logs_${kind}` : `factor.data.source_hint.${source}`)}
        </p>
      </div>

      {source === "bundled" && (
        <BundledList kind={kind} catalog={catalog} selected={bundledId} onSelect={setBundledId} />
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
    .map((c) => ({ collection: c, items: catalog.bundled.filter((b) => b.collection === c.id) }))
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
              <span className="hidden sm:inline">{copied ? t("factor.data.copied") : t("factor.data.copy_citation")}</span>
            </button>
          )}
          {collection.source_url && (
            <a href={collection.source_url} target="_blank" rel="noreferrer" className={action}>
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("factor.data.source_link")}</span>
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
  return (
    <label
      title={dataset.description}
      className={cn("flex items-center gap-2.5 rounded-md px-3 py-2.5", choiceTile(chosen))}
    >
      <input type="radio" name={name} className="sr-only" checked={chosen} onChange={onSelect} />
      <ChoiceMark type="radio" checked={chosen} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium truncate">{dataset.label ?? dataset.name}</span>
        {showSize && (
          <span className="block text-[11px] text-muted">
            {t("factor.data.bundled_size", { rows: dataset.observations, cols: dataset.measures })}
          </span>
        )}
      </span>
    </label>
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
  const total = files.reduce((acc, f) => acc + f.size, 0);
  return (
    <div className="rounded-lg bg-tile">
      <div className="px-3 py-2 flex items-center justify-between gap-2 text-xs text-muted border-b border-border/60">
        <span>
          {t(files.length === 1 ? "factor.data.files_selected" : "factor.data.files_selected_plural", {
            n: files.length,
          })}{" "}
          · {(total / 1024 / 1024).toFixed(1)} MB
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
            <span className="text-[10px] text-muted shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
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
  onChange,
  onCancelJob,
}: {
  dataset: FactorDataset;
  onChange: () => void;
  onCancelJob: () => void;
}) {
  const t = useT();
  const sourceKey = (["bundled", "csv", "logs", "pnml"] as const).find((s) => s === dataset.source);
  const sourceLabel = sourceKey ? t(`factor.data.source.${sourceKey}`) : dataset.source;

  if (dataset.status === "computing") {
    const pct = progressPercent(dataset.progress);
    return (
      <div className="space-y-3" role="status" aria-live="polite">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Loader2 className="h-4 w-4 animate-spin text-accent-ink" />
            {t("factor.data.computing_title", { name: dataset.name })}
          </div>
          <Button variant="outline" size="sm" onClick={onCancelJob}>
            {t("factor.data.cancel")}
          </Button>
        </div>
        <div
          className="w-full bg-tile rounded-full h-2 overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct ?? undefined}
          aria-label={t("factor.data.computing_title", { name: dataset.name })}
        >
          {pct === null ? (
            <div className="h-full w-1/3 bg-accent/70 rounded-full animate-pulse" />
          ) : (
            <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
          )}
        </div>
        <p className="text-xs text-muted">
          {pct !== null && <span className="font-mono mr-2">{pct}%</span>}
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
            <div className="font-medium">{t("factor.data.failed_title")}</div>
            {dataset.error && <div className="text-muted mt-1 break-words">{dataset.error}</div>}
          </div>
        </div>
        <Button onClick={onChange}>{t("factor.data.change")}</Button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-9 w-9 rounded-md bg-success/10 grid place-items-center shrink-0">
          <Check className="h-4 w-4 text-success-ink" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{dataset.name}</div>
          <div className="text-xs text-muted">
            {sourceLabel} · {t("factor.data.bundled_size", { rows: dataset.n_observations, cols: dataset.measures.length })}
          </div>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onChange}>
        {t("factor.data.change")}
      </Button>
    </div>
  );
}

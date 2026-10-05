"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Database,
  FileSpreadsheet,
  FileText,
  Loader2,
  Network,
  RotateCcw,
  X,
} from "lucide-react";
import {
  MAX_DATASET_FILES,
  type CreateDatasetInput,
  type DatasetSource,
  type FactorCatalog,
  type FactorDataset,
  type FactorKind,
} from "@/lib/api";
import { MIN_MEASURES, progressPercent } from "@/lib/factor-analysis";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
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

  const files = source === "logs" ? logFiles : pnmlFiles;
  const setFiles = source === "logs" ? setLogFiles : setPnmlFiles;
  const maxFiles = MAX_DATASET_FILES[source] ?? 1;

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
      setFiles([...files, ...fresh.slice(0, Math.max(room, 0))]);
    }
    setNotice(messages.length > 0 ? messages.join(" ") : null);
  };

  // Measures computed for the chosen groups; only used for the size estimate on the log tab.
  const groupMeasureCount = useMemo(
    () => catalog.measures.filter((m) => m.group && groups.includes(m.group)).length,
    [catalog.measures, groups],
  );

  const estimate = useMemo(() => {
    if (source === "logs" && kind === "model") return { rows: logFiles.length * miners.length, cols: measures.length };
    if (source === "logs") return { rows: logFiles.length, cols: groupMeasureCount };
    if (source === "pnml") return { rows: pnmlFiles.length, cols: measures.length };
    return null;
  }, [source, kind, logFiles.length, miners.length, measures.length, groupMeasureCount, pnmlFiles.length]);

  const blocker: string | null = (() => {
    if (source === "bundled") return bundledId ? null : t("factor.data.need_bundled");
    if (source === "csv") return csvFile ? null : t("factor.data.need_csv");
    if (files.length === 0) return t("factor.data.need_files");
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
      if (kind === "model") {
        input.miners = miners;
        input.measures = measures;
      } else {
        input.groups = groups;
      }
    }
    if (source === "pnml") {
      input.files = pnmlFiles;
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
        <BundledList catalog={catalog} selected={bundledId} onSelect={setBundledId} />
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

      {(source === "logs" || source === "pnml") && (
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
        </div>
      )}

      {notice && (
        <p role="status" className="text-xs text-warn flex items-start gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          {notice}
        </p>
      )}

      {source === "logs" && kind === "model" && catalog.miners && (
        <Checklist
          heading={t("factor.data.miners_heading")}
          hint={t("factor.data.miners_hint")}
          items={catalog.miners.map((m) => ({ key: m.key, name: m.name }))}
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
          <AlertCircle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
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
  catalog,
  selected,
  onSelect,
}: {
  catalog: FactorCatalog;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState<string | null>(null);
  if (catalog.bundled.length === 0) {
    return <p className="text-sm text-muted">{t("factor.data.bundled_empty")}</p>;
  }
  return (
    <div role="radiogroup" aria-label={t("factor.data.source.bundled")} className="grid gap-3 md:grid-cols-2">
      {catalog.bundled.map((b) => {
        const active = b.id === selected;
        return (
          <div
            key={b.id}
            className={cn(
              "rounded-lg p-3.5 flex flex-col gap-2 transition",
              active ? "bg-accent/[0.14] ring-1 ring-accent/60" : "bg-tile",
            )}
          >
            <button
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onSelect(b.id)}
              className="text-left flex items-start gap-2.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0 rounded-full border grid place-items-center",
                  active ? "border-accent bg-accent text-accent-fg" : "border-strong",
                )}
              >
                {active && <Check className="h-2.5 w-2.5" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{b.name}</span>
                <span className="block text-xs text-muted mt-0.5 leading-relaxed">{b.description}</span>
              </span>
            </button>
            <div className="pl-6 flex items-center gap-2 flex-wrap text-[11px] text-muted">
              <span className="font-mono">
                {t("factor.data.bundled_size", { rows: b.observations, cols: b.measures })}
              </span>
              {b.license && (
                <span className="rounded bg-bg/70 px-1.5 py-0.5">{t("factor.data.license", { license: b.license })}</span>
              )}
            </div>
            {b.citation && (
              <div className="pl-6 flex items-start gap-2">
                <p className="text-[11px] italic text-muted leading-relaxed flex-1 min-w-0 break-words">{b.citation}</p>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(b.citation ?? "").then(
                      () => {
                        setCopied(b.id);
                        setTimeout(() => setCopied(null), 2000);
                      },
                      () => {},
                    );
                  }}
                  title={t("factor.data.copy_citation")}
                  aria-label={t("factor.data.copy_citation")}
                  className="h-6 w-6 shrink-0 grid place-items-center rounded text-muted hover:text-fg hover:bg-bg/70 transition"
                >
                  {copied === b.id ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            )}
          </div>
        );
      })}
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
              className="h-5 w-5 grid place-items-center rounded text-muted hover:text-danger transition shrink-0"
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
              className={cn(
                "flex items-start gap-2.5 rounded-md px-2.5 py-2 cursor-pointer transition text-xs",
                on ? "bg-accent/[0.12]" : "bg-tile hover:bg-accent/[0.06]",
              )}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(item.key)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-accent"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium">{item.name}</span>
                  {item.slow && (
                    <span
                      className="rounded bg-warn/15 text-warn px-1 text-[10px] font-medium"
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
        <AlertCircle className={cn("h-4 w-4 shrink-0", tooFew ? "text-danger" : "text-warn")} />
      ) : (
        <Check className="h-4 w-4 shrink-0 text-success" />
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
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
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
          <AlertCircle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
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
          <Check className="h-4 w-4 text-success" />
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

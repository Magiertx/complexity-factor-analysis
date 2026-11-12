"use client";

// Drop area for one event log in the single-run workbench; shows the chosen file once there is one.

import { Upload, FileCheck2, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useLocale } from "@/lib/i18n";
import { formatFileSize } from "@/lib/format";

/** `file` is the controlled selection; `onChange(null)` clears it. `accept` is the file picker's filter. */
interface Props {
  file: File | null;
  onChange: (f: File | null) => void;
  accept?: string;
}

// What POST /algorithms/{id}/analyze accepts; ".gz" stands for ".xes.gz", which a file picker cannot match.
export const LOG_ACCEPT = ".xes,.gz,.xml,.json";
/** The same formats as full extensions, for checks on file names. */
export const LOG_EXTENSIONS = [".xes", ".xes.gz", ".xml", ".json"];

/** Drop area or button that picks one file, and a chip with name and size once a file is chosen. */
export function FileDrop({ file, onChange, accept = LOG_ACCEPT }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const { t, locale } = useLocale();

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onChange(f);
  }, [onChange]);

  if (file) {
    return (
      <div className="rounded-lg bg-tile p-4 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-md bg-success/10 grid place-items-center">
            <FileCheck2 className="h-4 w-4 text-success-ink" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{file.name}</div>
            <div className="text-xs text-muted">{formatFileSize(file.size, locale)}</div>
          </div>
        </div>
        <button
          onClick={() => onChange(null)}
          aria-label={t("file_drop.remove_aria")}
          className="h-8 w-8 grid place-items-center rounded-md hover:bg-bg transition"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
      className={cn(
        "w-full rounded-lg border-2 border-dashed transition px-4 py-6 flex flex-col items-center gap-2 text-center",
        drag ? "border-accent bg-accent/5" : "border-strong hover:border-muted bg-surface",
      )}
    >
      <div className="h-8 w-8 rounded-full bg-bg grid place-items-center">
        <Upload className="h-4 w-4 text-muted" />
      </div>
      <div>
        <div className="text-xs font-medium">{t("file_drop.drop_label")}</div>
        <div className="text-xs text-muted mt-0.5">{t("file_drop.drop_hint")}</div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
    </button>
  );
}

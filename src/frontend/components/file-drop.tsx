"use client";

import { Upload, FileCheck2, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

interface Props {
  file: File | null;
  onChange: (f: File | null) => void;
  accept?: string;
}

export function FileDrop({ file, onChange, accept = ".xes,.json" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const t = useT();

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
            <FileCheck2 className="h-4 w-4 text-success" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{file.name}</div>
            <div className="text-xs text-muted">{(file.size / 1024).toFixed(1)} KB</div>
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
        drag ? "border-accent bg-accent/5" : "border-border hover:border-muted bg-surface",
      )}
    >
      <div className="h-8 w-8 rounded-full bg-bg grid place-items-center">
        <Upload className="h-4 w-4 text-muted" />
      </div>
      <div>
        <div className="text-xs font-medium">{t("file_drop.drop_label")}</div>
        <div className="text-[10px] text-muted mt-0.5">{t("file_drop.drop_hint")}</div>
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

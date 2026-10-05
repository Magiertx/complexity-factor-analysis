"use client";

import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

// Compact drop area in the FileDrop look (circular icon, primary
// label + muted hint, accent highlight while dragging). Callers keep their own
// selected-file list; this only covers the empty zone.

interface Props {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  /** Primary line; defaults to the shared file_drop.drop_label. */
  label?: string;
  /** Muted secondary line; defaults to the shared file_drop.drop_hint. */
  hint?: string;
}

export function UploadZone({ onFiles, accept = ".xes,.json", multiple = false, label, hint }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const t = useT();

  const emit = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    onFiles(multiple ? files : files.slice(0, 1));
  };

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        emit(e.dataTransfer.files);
      }}
      className={cn(
        "w-full rounded-lg border-2 border-dashed transition px-4 py-4 flex flex-col items-center gap-1.5 text-center",
        drag ? "border-accent bg-accent/5" : "border-border hover:border-muted bg-surface",
      )}
    >
      <div className="h-7 w-7 rounded-full bg-bg grid place-items-center">
        <Upload className="h-3.5 w-3.5 text-muted" />
      </div>
      <div>
        <div className="text-xs font-medium">{label ?? t("file_drop.drop_label")}</div>
        <div className="text-[10px] text-muted mt-0.5">{hint ?? t("file_drop.drop_hint")}</div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          emit(e.target.files);
          e.target.value = "";
        }}
      />
    </button>
  );
}

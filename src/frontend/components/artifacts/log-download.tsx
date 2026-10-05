"use client";

import { Download, FileCode2 } from "lucide-react";
import type { Artifact } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { downloadBase64 } from "@/lib/utils";
import { useT } from "@/lib/i18n";

type L = Extract<Artifact, { kind: "log" }>;

export function LogDownload({ artifact }: { artifact: L }) {
  const t = useT();
  const sizeKb = Math.max(1, Math.round((artifact.data_base64.length * 0.75) / 1024));
  return (
    <div className="rounded-md border border-border/60 bg-surface px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-9 w-9 rounded-md bg-accent/10 grid place-items-center shrink-0">
          <FileCode2 className="h-4 w-4 text-accent-ink" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{artifact.filename}</div>
          <div className="text-xs text-muted">{sizeKb} KB</div>
        </div>
      </div>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => downloadBase64(artifact.data_base64, artifact.filename, artifact.mime ?? "application/xml")}
      >
        <Download className="h-4 w-4" />
        {t("artifacts.log_download.download_button")}
      </Button>
    </div>
  );
}

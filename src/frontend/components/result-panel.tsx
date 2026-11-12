"use client";

// Panel with the artifacts of a finished single run and the download of the whole run as an archive.

import { BarChart3, FileArchive } from "lucide-react";
import type { AnalysisResult } from "@/lib/api";
import { API_BASE } from "@/lib/api";
import { Artifacts } from "./artifacts/artifacts";
import { Button } from "./ui/button";
import { localizedAlgoText, useT } from "@/lib/i18n";

/** `runId` is the job whose artifacts and archive download are shown; without it the download button is hidden. */
interface Props {
  result: AnalysisResult;
  runId?: string | null;
}

/** Result of one analysis: its artifacts and, for a stored run, the download of all of them. */
export function ResultPanel({ result, runId }: Props) {
  const t = useT();
  return (
    <div className="rounded-lg bg-surface">
      <div className="px-5 pt-5 pb-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <BarChart3 className="h-4 w-4 text-muted shrink-0" />
          <h2 className="text-base font-semibold tracking-tight">{t("result_panel.heading")}</h2>
          {result.summary && (
            <span className="text-xs text-muted truncate">· {localizedAlgoText(result.summary, t)}</span>
          )}
        </div>
        {runId && (
          <Button
            onClick={() => {
              const base = API_BASE;
              const link = document.createElement("a");
              link.href = `${base}/jobs/${runId}/download`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            }}
            variant="secondary"
            size="sm"
            className="shrink-0"
          >
            <FileArchive className="h-3.5 w-3.5" />
            {t("result_panel.download_all")}
          </Button>
        )}
      </div>
      <div className="p-5">
        <Artifacts artifacts={result.artifacts} runId={runId} />
      </div>
    </div>
  );
}

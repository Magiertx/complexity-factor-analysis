"use client";

import { Flag } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useTip } from "@/components/ui/tip";
import { useFeedback } from "./feedback-provider";

/**
 * "Report problem" beside an error: opens the feedback form as a bug, with the code of this
 * error in the technical details.
 */
export function ReportProblem({ code }: { code?: string | null }) {
  const t = useT();
  const { open } = useFeedback();
  const tip = useTip<HTMLButtonElement>({ more: t("feedback.report_title") });
  return (
    <button
      ref={tip}
      type="button"
      onClick={() => open({ kind: "bug", errorCode: code ?? null })}
      className="inline-flex min-h-6 items-center gap-1 rounded px-0.5 text-xs font-medium text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <Flag className="h-3.5 w-3.5" aria-hidden />
      {t("feedback.report")}
    </button>
  );
}

"use client";

import type { Step } from "react-joyride";
import { useMemo } from "react";
import { Tour } from "./tour";
import { useT } from "@/lib/i18n";

export function BatchTour({ run, onClose }: { run: boolean; onClose: () => void }) {
  const t = useT();
  const steps: Step[] = useMemo(
    () => [
      {
        target: "body",
        placement: "center",
        title: t("tours.batch.intro_title"),
        content: t("tours.batch.intro_content"),
      },
      {
        target: '[data-tour="batch-algo"]',
        placement: "bottom",
        title: t("tours.batch.algo_title"),
        content: t("tours.batch.algo_content"),
      },
      {
        target: '[data-tour="batch-logs"]',
        placement: "top",
        title: t("tours.batch.logs_title"),
        content: t("tours.batch.logs_content"),
      },
      {
        target: '[data-tour="batch-params"]',
        placement: "top",
        title: t("tours.batch.params_title"),
        content: t("tours.batch.params_content"),
      },
      {
        target: '[data-tour="batch-run"]',
        placement: "top",
        title: t("tours.batch.run_title"),
        content: t("tours.batch.run_content"),
      },
    ],
    [t],
  );
  return <Tour run={run} steps={steps} onClose={onClose} />;
}

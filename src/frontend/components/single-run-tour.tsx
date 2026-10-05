"use client";

import type { Step } from "react-joyride";
import { useMemo } from "react";
import { Tour } from "./tour";
import { useT } from "@/lib/i18n";

export function SingleRunTour({ run, onClose }: { run: boolean; onClose: () => void }) {
  const t = useT();
  const steps: Step[] = useMemo(
    () => [
      {
        target: "body",
        placement: "center",
        title: t("tours.single_run.intro_title"),
        content: t("tours.single_run.intro_content"),
      },
      {
        target: '[data-tour="single-algo-list"]',
        placement: "right",
        title: t("tours.single_run.algo_pick_title"),
        content: t("tours.single_run.algo_pick_content"),
      },
      {
        target: '[data-tour="single-algo-help"]',
        placement: "right",
        title: t("tours.single_run.algo_help_title"),
        content: t("tours.single_run.algo_help_content"),
      },
      {
        target: '[data-tour="single-logsource"]',
        placement: "top",
        title: t("tours.single_run.logsource_title"),
        content: t("tours.single_run.logsource_content"),
      },
      {
        target: '[data-tour="single-params"]',
        placement: "top",
        title: t("tours.single_run.params_title"),
        content: t("tours.single_run.params_content"),
      },
      {
        target: '[data-tour="single-run"]',
        placement: "top",
        title: t("tours.single_run.run_title"),
        content: t("tours.single_run.run_content"),
      },
    ],
    [t],
  );
  return <Tour run={run} steps={steps} onClose={onClose} />;
}

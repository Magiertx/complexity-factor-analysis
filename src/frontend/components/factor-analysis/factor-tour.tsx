"use client";

import type { Step } from "react-joyride";
import { useMemo } from "react";
import { Tour } from "@/components/tour";
import { useT } from "@/lib/i18n";
import type { FactorKind } from "@/lib/api";

const STEPS = ["data", "dataset", "suitability", "factors", "loadings"] as const;

export function FactorTour({ kind, run, onClose }: { kind: FactorKind; run: boolean; onClose: () => void }) {
  const t = useT();
  const steps: Step[] = useMemo(
    () => [
      {
        target: "body",
        placement: "center",
        title: t(`factor.${kind}.title`),
        content: t("tours.factor.intro"),
      },
      ...STEPS.map(
        (id): Step => ({
          target: `[data-tour="fa-${id}"]`,
          placement: "top",
          title: t(`factor.steps.${id}`),
          content: t(`tours.factor.${id}`),
        }),
      ),
    ],
    [t, kind],
  );
  return <Tour run={run} steps={steps} onClose={onClose} />;
}

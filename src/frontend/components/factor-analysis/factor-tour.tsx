"use client";

import type { Step } from "react-joyride";
import { useMemo } from "react";
import { Tour } from "@/components/tour";
import { useT } from "@/lib/i18n";
import type { FactorKind } from "@/lib/api";
import { STEP_IDS, type StepId } from "@/lib/steps";

/** Two frames: the step the tour opened is rendered and laid out before the tour looks for it. */
const rendered = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/**
 * The tour of a factor analysis tab: an introduction, then one stop per step. Each stop opens its
 * step first (`onStep`), since only one step is on screen at a time.
 */
export function FactorTour({
  kind,
  run,
  onClose,
  onStep,
}: {
  kind: FactorKind;
  run: boolean;
  onClose: () => void;
  onStep: (step: StepId) => void;
}) {
  const t = useT();
  const steps: Step[] = useMemo(
    () => [
      {
        target: "body",
        placement: "center",
        title: t(`factor.${kind}.title`),
        content: t("tours.factor.intro"),
      },
      ...STEP_IDS.map(
        (id): Step => ({
          target: `[data-tour="fa-${id}"]`,
          placement: "bottom",
          title: t(`factor.steps.${id}`),
          content: t(`tours.factor.${id}`),
          before: async () => {
            onStep(id);
            await rendered();
          },
        }),
      ),
    ],
    [t, kind, onStep],
  );
  return <Tour run={run} steps={steps} onClose={onClose} />;
}

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
 * Brings the target below what sticks to the top of the window (the settings row of a wide
 * screen, whose height is the scroll padding of the page) when it is under it or far down. The
 * tour's own scrolling does not know of the row, which would cover the top of the spotlight.
 */
function clearOfStickyRow(selector: string) {
  const target = document.querySelector(selector);
  if (!target) return;
  const covered = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  const top = target.getBoundingClientRect().top;
  if (top < covered + 8 || top > window.innerHeight * 0.55) window.scrollBy({ top: top - covered - 16 });
}

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
          // Scrolled below the settings row in `before`, not to the top of the window.
          skipScroll: true,
          title: t(`factor.steps.${id}`),
          content: t(`tours.factor.${id}`),
          before: async () => {
            onStep(id);
            await rendered();
            clearOfStickyRow(`[data-tour="fa-${id}"]`);
          },
        }),
      ),
    ],
    [t, kind, onStep],
  );
  return <Tour run={run} steps={steps} onClose={onClose} />;
}

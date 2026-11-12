"use client";

// The welcome dialog of the first visit (language choice and a short walk through the tabs), opened from the factor-analysis view.

import { useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  ListChecks,
  Network,
  Layers,
  History,
  Columns3,
  Microscope,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { LocaleSegmented } from "./locale-toggle";
import { useT } from "@/lib/i18n";
import { APP_NAME } from "@/lib/app-config";

/** localStorage key set once the onboarding has been finished or skipped. */
export const ONBOARDING_KEY = "app.onboarding-completed";
// Set by the settings page to show the onboarding again once.
const REPLAY_KEY = "app.onboarding-replay";

/**
 * Opens the onboarding once per browser. The settings page can force a replay by
 * writing the replay key before it navigates here.
 */
export function useOnboarding() {
  const [open, setOpen] = useState(false);
  // Each opening starts at the first step.
  useEffect(() => {
    try {
      if (localStorage.getItem(REPLAY_KEY)) {
        localStorage.removeItem(REPLAY_KEY);
        setOpen(true);
      } else if (!localStorage.getItem(ONBOARDING_KEY)) {
        setOpen(true);
      }
    } catch {
      /* storage blocked, skip the tour */
    }
  }, []);
  return { open, close: () => setOpen(false) };
}

// One page of the dialog.
interface Step {
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
}

/** The dialog itself: steps with Back, Next and Skip, arrow keys to move, Escape to close; closing marks it as done. */
export function OnboardingTour({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const [step, setStep] = useState(0);

  // Rebuilt when the language changes.
  const STEPS: Step[] = useMemo(
    () => [
      {
        icon: <Sparkles className="h-5 w-5" />,
        title: t("tours.onboarding.step0_title", { app: APP_NAME }),
        body: (
          <>
            <p>{t("tours.onboarding.step0_p1")}</p>
            <p className="text-muted">{t("tours.onboarding.step0_p2")}</p>
          </>
        ),
      },
      {
        icon: <Network className="h-5 w-5" />,
        title: t("tours.onboarding.step1_title"),
        body: (
          <>
            <p>{t("tours.onboarding.step1_p1")}</p>
            <p className="text-muted">{t("tours.onboarding.step1_p2")}</p>
          </>
        ),
      },
      {
        icon: <ListChecks className="h-5 w-5" />,
        title: t("tours.onboarding.step2_title"),
        body: (
          <>
            <p>{t("tours.onboarding.step2_p1")}</p>
            <p className="text-muted">{t("tours.onboarding.step2_p2")}</p>
          </>
        ),
      },
      {
        icon: <Layers className="h-5 w-5" />,
        title: t("tours.onboarding.step3_title"),
        body: (
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <Columns3 className="h-3.5 w-3.5 text-muted mt-1 shrink-0" />
              <span>{t("tours.onboarding.step3_compare")}</span>
            </li>
            <li className="flex items-start gap-2">
              <Microscope className="h-3.5 w-3.5 text-muted mt-1 shrink-0" />
              <span>{t("tours.onboarding.step3_inspect")}</span>
            </li>
            <li className="flex items-start gap-2">
              <History className="h-3.5 w-3.5 text-muted mt-1 shrink-0" />
              <span>{t("tours.onboarding.step3_history")}</span>
            </li>
          </ul>
        ),
      },
    ],
    [t],
  );

  // Keyboard: Escape closes, the arrow keys move between steps.
  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") setStep((s) => Math.min(STEPS.length - 1, s + 1));
      if (e.key === "ArrowLeft") setStep((s) => Math.max(0, s - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, STEPS.length]);

  if (!open) return null;

  const finish = () => {
    try {
      localStorage.setItem(ONBOARDING_KEY, "1");
    } catch {
      /* ignore */
    }
    onClose();
  };

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="absolute inset-0" onClick={finish} aria-hidden />

      <div className="relative w-full max-w-md rounded-lg bg-surface shadow-2xl ring-1 ring-border/70 overflow-hidden">
        <button
          type="button"
          onClick={finish}
          aria-label={t("common.close")}
          className="absolute top-3 right-3 h-7 w-7 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-tile transition"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-6 pt-3 space-y-4">
          {/* The same setting as the language of the page (the header, the settings). */}
          <div className="flex justify-end pr-9">
            <LocaleSegmented className="w-[104px]" />
          </div>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-md bg-tile text-muted grid place-items-center">
              {current.icon}
            </div>
            <h2 id="onboarding-title" className="text-base font-semibold tracking-tight">
              {current.title}
            </h2>
          </div>
          <div className="text-sm leading-relaxed space-y-3">
            {current.body}
          </div>
        </div>

        <div className="px-6 pb-5 pt-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5" aria-label={t("tours.onboarding.progress_aria")}>
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === step ? "w-5 bg-accent" : "w-1.5 bg-tile",
                )}
                aria-current={i === step ? "step" : undefined}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                variant="outline"
                size="sm"
                className="text-xs px-2.5 gap-1"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                {t("common.back")}
              </Button>
            )}
            {!isLast && (
              <Button
                type="button"
                onClick={finish}
                variant="ghost"
                size="sm"
                className="text-xs text-muted hover:text-fg px-2.5"
              >
                {t("common.skip")}
              </Button>
            )}
            <Button
              type="button"
              onClick={() => (isLast ? finish() : setStep((s) => s + 1))}
              variant="outline"
              size="sm"
              className="text-xs gap-1"
            >
              {isLast ? t("common.get_started") : (
                <>
                  {t("common.next")}
                  <ChevronRight className="h-3.5 w-3.5" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

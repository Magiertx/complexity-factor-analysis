"use client";

// Moving between the steps: the hook that keeps the step in the address, the rail of a wide screen, the bar of a phone and the Back and Next footer.

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  ChartLine,
  Check,
  ChevronLeft,
  ChevronRight,
  Database,
  Gauge,
  Grid3x3,
  KeyRound,
  Loader2,
  Sparkles,
  Table2,
} from "lucide-react";
import { STEP_IDS, neighbours, stepHref, type StepId, type StepState } from "@/lib/steps";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { useTip } from "@/components/ui/tip";

/** An icon component. */
type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

/** The sign of each step, in the rail, the bar on a phone and the heading of the step. */
export const STEP_ICONS: Record<StepId, Icon> = {
  data: Database,
  dataset: Table2,
  suitability: Gauge,
  factors: ChartLine,
  loadings: Grid3x3,
  interpretation: Sparkles,
};

/** Why a step cannot be opened yet, by step; null where it can. */
export type StepLocks = Record<StepId, string | null>;

/** Where the focus goes once a step is on screen: its heading, or a control inside it. */
export type StepFocus = "heading" | { control: string } | null;

/**
 * The step on screen and the address that names it (?step=...). `goTo` pushes an entry, so the
 * browser's back and forward move between steps; `fromUrl` follows an address that changed by
 * itself (the first load, back and forward, a link). The focus moves to the step's heading on
 * every navigation but the first load.
 */
export function useStepNavigation() {
  const [step, setStep] = useState<StepId>("data");
  const stepRef = useRef<StepId>("data");
  const focus = useRef<StepFocus>(null);
  // Changes with every navigation, so the focus moves even when the step stays the same.
  const [visit, setVisit] = useState(0);

  const goTo = useCallback((next: StepId, opts: { replace?: boolean; focus?: StepFocus } = {}) => {
    const href = stepHref(window.location.pathname, window.location.search, next);
    if (href !== window.location.pathname + window.location.search || window.location.hash) {
      if (opts.replace) window.history.replaceState(null, "", href);
      else window.history.pushState(null, "", href);
    }
    focus.current = opts.focus === undefined ? "heading" : opts.focus;
    stepRef.current = next;
    setStep(next);
    setVisit((v) => v + 1);
  }, []);

  const fromUrl = useCallback((next: StepId, initial: boolean) => {
    if (next === stepRef.current) return;
    focus.current = initial ? null : "heading";
    stepRef.current = next;
    setStep(next);
    setVisit((v) => v + 1);
  }, []);

  /** Where the focus should go now that the step is rendered; asked once per navigation. */
  const takeFocus = useCallback((): StepFocus => {
    const f = focus.current;
    focus.current = null;
    return f;
  }, []);

  /** The step on screen at this moment, for callbacks that must not wait for a render. */
  const getStep = useCallback(() => stepRef.current, []);

  return { step, visit, goTo, fromUrl, takeFocus, getStep };
}

/** What the rail and the bar share. */
interface NavProps {
  current: StepId;
  states: Record<StepId, StepState>;
  locks: StepLocks;
  /**
   * Steps that cannot be had in this setup, with why, e.g. the interpretation without an API key:
   * a key instead of a lock, and the reason instead of what the step is for.
   */
  unavailable: Partial<Record<StepId, string>>;
  /** Replaces the generic text of a state for screen readers, e.g. why a step is locked. */
  stateLabels: Partial<Record<StepId, string>>;
  onGo: (step: StepId) => void;
}

/**
 * A link to a step: a real address, so it opens in a new tab as well. A step that cannot be opened
 * yet stays focusable with its reason in the tooltip.
 */
function StepLink({
  id,
  current,
  state,
  lock,
  needsKey,
  stateLabel,
  onGo,
  iconOnly,
  more,
  className,
  children,
}: {
  id: StepId;
  current: boolean;
  state: StepState;
  lock: string | null;
  /** Can be opened, but waits for a key; the tooltip says so. */
  needsKey: boolean;
  stateLabel: string;
  onGo: (step: StepId) => void;
  /** Shows only its marker, so its tooltip names it. */
  iconOnly?: boolean;
  /** The whole summary of a step whose line is cut off, for the tooltip. */
  more?: string;
  className: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const pathname = usePathname();
  const name = t(`factor.steps.${id}`);
  const tip = useTip<HTMLAnchorElement>(
    lock
      ? { name, reason: lock, more }
      : needsKey
        ? { name, reason: stateLabel, more }
        : iconOnly
          ? { name, more }
          : more
            ? { more }
            : null,
  );
  return (
    <a
      ref={tip}
      href={lock ? undefined : stepHref(pathname, "", id)}
      role={lock ? "link" : undefined}
      tabIndex={lock ? 0 : undefined}
      aria-disabled={lock ? true : undefined}
      aria-current={current ? "step" : undefined}
      onClick={(e) => {
        // A new tab or window opens the step there.
        if (!lock && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)) return;
        e.preventDefault();
        if (!lock) onGo(id);
      }}
      onKeyDown={(e) => {
        if (lock && e.key === "Enter") e.preventDefault();
      }}
      className={className}
    >
      {children}
      <span className="sr-only">
        {" "}
        ({stateLabel ?? t(`factor.state.${state}`)})
      </span>
    </a>
  );
}

/** How long a finished step waits after the one before it as the steps fill in. */
const FILL_MS = 120;

/** Whether a step counts as finished. */
const finishedState = (state: StepState) => state === "done" || state === "warn";

/**
 * The states as the steps show them: steps that become done (or done with a warning) show so one
 * after another, FILL_MS apart, so the steps visibly fill in once a dataset is loaded; any other
 * change shows at once, and every change with reduced motion.
 */
function useFilling(states: Record<StepId, StepState>): Record<StepId, StepState> {
  const key = STEP_IDS.map((id) => states[id]).join(",");
  const [shown, setShown] = useState(states);
  const shownRef = useRef(states);
  useEffect(() => {
    const values = key.split(",") as StepState[];
    const target = Object.fromEntries(STEP_IDS.map((id, i) => [id, values[i]])) as Record<StepId, StepState>;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const before = shownRef.current;
    const now = { ...before };
    const later: StepId[] = [];
    for (const id of STEP_IDS) {
      if (!reduce && finishedState(target[id]) && !finishedState(before[id])) later.push(id);
      else now[id] = target[id];
    }
    const apply = (next: Record<StepId, StepState>) => {
      shownRef.current = next;
      setShown(next);
    };
    apply(now);
    const timers = later.map((id, i) =>
      setTimeout(() => apply({ ...shownRef.current, [id]: target[id] }), (i + 1) * FILL_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, [key]);
  return shown;
}

/**
 * The round marker of a step: its number, a check once done, the warning glyph for a step that
 * needs a look, a spinner while it is computed, a key for a step this setup cannot give. The step on
 * screen has the accent ring. Purely visual; the link says the state in words.
 */
function StepMarker({
  n,
  state,
  current,
  needsKey,
}: {
  n: number;
  state: StepState;
  current: boolean;
  needsKey: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums transition-colors duration-300 motion-reduce:transition-none",
        needsKey
          ? "bg-tile text-muted"
          : state === "done"
            ? "bg-success/15 text-success-ink"
            : state === "warn"
              ? "bg-warn/15 text-warn-ink"
              : current
                ? "bg-surface text-accent-ink"
                : "bg-tile text-muted",
        current && "ring-2 ring-accent ring-offset-2 ring-offset-bg",
      )}
    >
      {/* Keyed by the state, so a step that has just become done pops in. */}
      <span key={needsKey ? "key" : state} className="grid place-items-center motion-safe:animate-[marker-in_220ms_ease-out]">
        {needsKey ? (
          <KeyRound className="h-3.5 w-3.5" />
        ) : state === "done" ? (
          <Check className="h-4 w-4" strokeWidth={2.5} />
        ) : state === "warn" ? (
          <AlertTriangle className="h-3.5 w-3.5" />
        ) : state === "busy" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          n
        )}
      </span>
    </span>
  );
}

/** A summary longer than this is cut off in the rail; its tooltip has all of it. */
const SUMMARY_FITS = 24;

/**
 * The steps as a vertical stepper on a wide screen: a numbered marker per step, a line to the next,
 * and beside it the step's name with one line of what it found ("288 × 12", "KMO 0.75") or, before
 * that, what it is for. A step that cannot be opened yet is muted, with what it needs first in its
 * tooltip.
 */
export function StepRail({
  current,
  states,
  locks,
  unavailable,
  stateLabels,
  summaries,
  summaryMore,
  onGo,
}: NavProps & {
  /** What a finished step found, e.g. "KMO 0.75 · 2 removed"; else what the step is for. */
  summaries: Partial<Record<StepId, string>>;
  /** More than the line says, for its tooltip, e.g. the measures a warning is about. */
  summaryMore?: Partial<Record<StepId, string>>;
}) {
  const t = useT();
  const shown = useFilling(states);
  return (
    <nav aria-label={t("factor.steps.aria")} className="hidden lg:block lg:sticky lg:top-6">
      <ol className="flex flex-col">
        {STEP_IDS.map((id, i) => {
          const here = id === current;
          const lock = locks[id];
          const needsKey = !!unavailable[id];
          const state = shown[id];
          const next = STEP_IDS[i + 1];
          const summary = summaries[id] ?? t(`factor.rail.${id}`);
          const muted = !!lock && !here;
          return (
            <li key={id} className="relative">
              {/* The line to the next marker; between two finished steps in the tone of done. */}
              {next && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-[1.5rem] top-[calc(50%+17px)] h-[calc(100%-34px)] w-px -translate-x-1/2 rounded-full transition-colors duration-300",
                    finishedState(state) && finishedState(shown[next]) ? "bg-success/45" : "bg-border",
                  )}
                />
              )}
              <StepLink
                id={id}
                current={here}
                state={states[id]}
                lock={lock}
                needsKey={needsKey}
                stateLabel={stateLabels[id] ?? t(`factor.state.${states[id]}`)}
                onGo={onGo}
                more={summaryMore?.[id] ?? (summary.length > SUMMARY_FITS ? summary : undefined)}
                className={cn(
                  "group flex items-center gap-3 rounded-md px-2.5 py-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  lock ? "cursor-default" : "hover:bg-surface/70",
                )}
              >
                <StepMarker n={i + 1} state={state} current={here} needsKey={needsKey} />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-sm",
                      here ? "font-semibold text-fg" : muted || needsKey ? "font-medium text-muted" : "font-medium",
                    )}
                  >
                    {t(`factor.steps.${id}`)}
                  </span>
                  <span
                    className={cn(
                      "block truncate text-xs leading-snug",
                      summaries[id] && !needsKey ? "text-fg/75" : "text-muted",
                    )}
                  >
                    {summary}
                  </span>
                </span>
              </StepLink>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The steps on a phone: the same markers in a row, joined by lines, and under them which step is on
 * screen and which comes next. It fits a narrow screen without scrolling sideways.
 */
export function StepBar({ current, states, locks, unavailable, stateLabels, onGo }: NavProps) {
  const t = useT();
  const shown = useFilling(states);
  const { next } = neighbours(current);
  const at = STEP_IDS.indexOf(current) + 1;
  return (
    <nav aria-label={t("factor.steps.aria_compact")} className="lg:hidden">
      <ol className="flex items-center">
        {STEP_IDS.map((id, i) => {
          const here = id === current;
          const state = shown[id];
          const before = STEP_IDS[i - 1];
          return (
            <li key={id} className={cn("flex items-center", i > 0 && "min-w-0 flex-1")}>
              {before && (
                <span
                  aria-hidden
                  className={cn(
                    "mx-0.5 h-px min-w-2 flex-1 rounded-full transition-colors duration-300",
                    finishedState(state) && finishedState(shown[before]) ? "bg-success/45" : "bg-border",
                  )}
                />
              )}
              <StepLink
                id={id}
                current={here}
                state={states[id]}
                lock={locks[id]}
                needsKey={!!unavailable[id]}
                stateLabel={stateLabels[id] ?? t(`factor.state.${states[id]}`)}
                onGo={onGo}
                iconOnly
                className={cn(
                  "grid h-11 w-11 shrink-0 place-items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  locks[id] && !here ? "cursor-default" : "hover:bg-surface/70",
                )}
              >
                <StepMarker n={i + 1} state={state} current={here} needsKey={!!unavailable[id]} />
                {/* The name for screen readers; the line below names the step on screen. */}
                <span className="sr-only">{t(`factor.steps.${id}`)}</span>
              </StepLink>
            </li>
          );
        })}
      </ol>
      {/* Where the bar is: the step on screen and the one after it. */}
      <p className="mt-1 px-1 text-xs text-muted">
        {next
          ? t("factor.nav.summary", {
              n: at,
              total: STEP_IDS.length,
              step: t(`factor.steps.${current}`),
              next: t(`factor.steps.${next}`),
            })
          : t("factor.nav.summary_last", { n: at, total: STEP_IDS.length, step: t(`factor.steps.${current}`) })}
      </p>
    </nav>
  );
}

/** The step before and after `step`; a step that cannot be had in this setup is no next one. */
function reachable(step: StepId, unavailable: Partial<Record<StepId, string>>) {
  const { previous, next } = neighbours(step);
  return { previous, next: next && !unavailable[next] ? next : null };
}

/** The button to the next step: the primary action of a step, inactive with its reason while the next is locked. */
function NextButton({
  next,
  lock,
  onGo,
  compact,
  quiet,
}: {
  next: StepId;
  lock: string | null;
  onGo: (step: StepId) => void;
  compact?: boolean;
  /** Not the primary action, where the step has one of its own. */
  quiet?: boolean;
}) {
  const t = useT();
  const label = compact ? t("factor.nav.next") : t("factor.nav.next_to", { step: t(`factor.steps.${next}`) });
  const tip = useTip<HTMLButtonElement>(lock ? { name: label, reason: lock } : null);
  return (
    <Button
      ref={tip}
      size="sm"
      variant={quiet ? "outline" : "primary"}
      aria-disabled={lock ? true : undefined}
      onClick={() => !lock && onGo(next)}
      className="shrink-0 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:hover:opacity-50"
    >
      {label}
      <ChevronRight className="h-4 w-4 -mr-1" aria-hidden />
    </Button>
  );
}

/**
 * Back and Next at the end of a step on a wide screen. Next is left out where the step has a
 * primary action of its own that leads on, such as "Use dataset" in the data step's form.
 */
export function StepFooter({
  step,
  locks,
  unavailable,
  onGo,
  hideNext,
}: {
  step: StepId;
  locks: StepLocks;
  unavailable: Partial<Record<StepId, string>>;
  onGo: (step: StepId) => void;
  hideNext?: boolean;
}) {
  const t = useT();
  const { previous, next } = reachable(step, unavailable);
  const lock = next ? locks[next] : null;
  if (!previous && (!next || hideNext)) return null;
  return (
    <div className="hidden lg:flex items-center justify-between gap-3 px-5 py-4 border-t border-border">
      {previous ? (
        <Button variant="ghost" size="sm" onClick={() => onGo(previous)} className="-ml-2 text-muted hover:text-fg">
          <ChevronLeft className="h-4 w-4 -ml-1" aria-hidden />
          {t("factor.nav.back_to", { step: t(`factor.steps.${previous}`) })}
        </Button>
      ) : (
        <span />
      )}
      {next && !hideNext && (
        <span className="flex items-center gap-3 min-w-0">
          {lock && <span className="text-xs text-muted text-right">{lock}</span>}
          <NextButton next={next} lock={lock} onGo={onGo} />
        </span>
      )}
    </div>
  );
}

/**
 * Back and Next fixed at the bottom of a phone's screen, with the step on screen between them; the
 * step itself scrolls with the page above it.
 */
export function StepNavBar({
  step,
  locks,
  unavailable,
  onGo,
  hideNext = false,
}: {
  step: StepId;
  locks: StepLocks;
  unavailable: Partial<Record<StepId, string>>;
  onGo: (step: StepId) => void;
  /** The data step has its own way on, so the bar offers none there, as the footer of a wide screen. */
  hideNext?: boolean;
}) {
  const t = useT();
  const { previous, next: reachableNext } = reachable(step, unavailable);
  const next = hideNext ? null : reachableNext;
  const reason = next ? locks[next] : null;
  // The page keeps room for the bar at its end, so the bar never hides the last lines.
  useEffect(() => {
    document.body.classList.add("has-step-bar");
    return () => document.body.classList.remove("has-step-bar");
  }, []);
  return (
    <nav
      aria-label={t("factor.nav.aria")}
      className="lg:hidden fixed [@media(max-height:500px)]:static inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
    >
      <div className="h-14 px-4 flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => previous && onGo(previous)}
          disabled={!previous}
          className="shrink-0"
        >
          <ChevronLeft className="h-4 w-4 -ml-1" aria-hidden />
          {t("factor.nav.back")}
        </Button>
        {/* While Next waits for something, the middle says what, as the footer of a wide screen does. */}
        {reason ? (
          <span className="flex-1 min-w-0 text-center text-xs text-muted leading-snug line-clamp-2">{reason}</span>
        ) : (
          <span className="flex-1 min-w-0 text-center text-xs text-muted truncate">
            {t("factor.nav.position", { n: STEP_IDS.indexOf(step) + 1, total: STEP_IDS.length })}
          </span>
        )}
        {/* The data step has its own primary button (load, or on from the loaded dataset). */}
        {next ? (
          <NextButton next={next} lock={locks[next]} onGo={onGo} compact />
        ) : (
          <span className="w-[4.5rem]" />
        )}
      </div>
    </nav>
  );
}

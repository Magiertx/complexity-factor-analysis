"use client";

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
  Loader2,
  Lock,
  Sparkles,
  Table2,
} from "lucide-react";
import { STEP_IDS, neighbours, stepHref, type StepId, type StepState } from "@/lib/steps";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { useTip } from "@/components/ui/tip";

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

  return { step, visit, goTo, fromUrl, takeFocus };
}

function StateMark({ state }: { state: StepState }) {
  if (state === "done") return <Check className="h-3.5 w-3.5 shrink-0 text-success-ink" aria-hidden />;
  if (state === "warn") return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warn-ink" aria-hidden />;
  if (state === "busy") return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted" aria-hidden />;
  if (state === "locked") return <Lock className="h-3 w-3 shrink-0 text-muted" aria-hidden />;
  return null;
}

interface NavProps {
  current: StepId;
  states: Record<StepId, StepState>;
  locks: StepLocks;
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
  stateLabel,
  onGo,
  className,
  children,
}: {
  id: StepId;
  current: boolean;
  state: StepState;
  lock: string | null;
  stateLabel: string;
  onGo: (step: StepId) => void;
  className: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const pathname = usePathname();
  const tip = useTip<HTMLAnchorElement>(lock ? { name: t(`factor.steps.${id}`), reason: lock } : null);
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

/** The steps with what each found, as the navigation of a wide screen. */
export function StepRail({
  current,
  states,
  locks,
  stateLabels,
  summaries,
  onGo,
}: NavProps & {
  /** What a finished step found, e.g. "KMO 0.75 · 2 removed"; else what the step is for. */
  summaries: Partial<Record<StepId, string>>;
}) {
  const t = useT();
  return (
    <nav aria-label={t("factor.steps.aria")} className="hidden lg:block lg:sticky lg:top-6">
      <ol className="flex flex-col gap-0.5">
        {STEP_IDS.map((id) => {
          const Icon = STEP_ICONS[id];
          const here = id === current;
          const lock = locks[id];
          return (
            <li key={id}>
              <StepLink
                id={id}
                current={here}
                state={states[id]}
                lock={lock}
                stateLabel={stateLabels[id] ?? t(`factor.state.${states[id]}`)}
                onGo={onGo}
                className={cn(
                  "group flex items-start gap-2.5 rounded-md px-2.5 py-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  here ? "bg-accent/[0.08]" : lock ? "cursor-default" : "hover:bg-surface",
                )}
              >
                <Icon
                  className={cn("h-4 w-4 mt-0.5 shrink-0", here ? "text-accent-ink" : lock ? "text-muted/60" : "text-muted")}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm", here ? "font-semibold" : "font-medium", lock && "text-muted")}>
                    {t(`factor.steps.${id}`)}
                  </span>
                  <span className={cn("block text-[11px] leading-snug break-words", summaries[id] ? "text-fg/75" : "text-muted")}>
                    {summaries[id] ?? t(`factor.rail.${id}`)}
                  </span>
                </span>
                <span className="mt-1">
                  <StateMark state={states[id]} />
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
 * The steps on a phone: number and sign of each in one row, the name of the step on screen beside
 * its own. It fits a narrow screen without scrolling sideways.
 */
export function StepBar({ current, states, locks, stateLabels, onGo }: NavProps) {
  const t = useT();
  return (
    <nav aria-label={t("factor.steps.aria")} className="lg:hidden">
      <ol className="flex items-stretch gap-1">
        {STEP_IDS.map((id, i) => {
          const Icon = STEP_ICONS[id];
          const here = id === current;
          const lock = locks[id];
          const state = states[id];
          return (
            <li key={id} className={cn(here ? "min-w-0 flex-1" : "shrink-0")}>
              <StepLink
                id={id}
                current={here}
                state={state}
                lock={lock}
                stateLabel={stateLabels[id] ?? t(`factor.state.${state}`)}
                onGo={onGo}
                className={cn(
                  "h-11 flex items-center rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  here ? "w-full gap-2 px-2.5 bg-accent/[0.08]" : "w-9 flex-col justify-center gap-0.5",
                  !here && (lock ? "opacity-45 cursor-default" : "hover:bg-surface"),
                )}
              >
                <Icon className={cn("h-4 w-4 shrink-0", here ? "text-accent-ink" : "text-muted")} aria-hidden />
                {here ? (
                  <span className="min-w-0 flex items-baseline gap-1.5">
                    <span className="text-[11px] tabular-nums text-muted" aria-hidden>
                      {i + 1}
                    </span>
                    <span className="truncate text-sm font-semibold">{t(`factor.steps.${id}`)}</span>
                  </span>
                ) : (
                  <span
                    className={cn(
                      "text-[10px] leading-none tabular-nums",
                      state === "warn" ? "text-warn-ink font-semibold" : "text-muted",
                    )}
                    aria-hidden
                  >
                    {i + 1}
                  </span>
                )}
                {/* The name for screen readers, which the row only shows for the step on screen. */}
                {!here && <span className="sr-only">{t(`factor.steps.${id}`)}</span>}
                {here && (
                  <span className="ml-auto">
                    <StateMark state={state} />
                  </span>
                )}
              </StepLink>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The button to the next step: the primary action of a step, inactive with its reason while the next is locked. */
function NextButton({
  next,
  lock,
  onGo,
  compact,
}: {
  next: StepId;
  lock: string | null;
  onGo: (step: StepId) => void;
  compact?: boolean;
}) {
  const t = useT();
  const label = compact ? t("factor.nav.next") : t("factor.nav.next_to", { step: t(`factor.steps.${next}`) });
  const tip = useTip<HTMLButtonElement>(lock ? { name: label, reason: lock } : null);
  return (
    <Button
      ref={tip}
      size="sm"
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
  onGo,
  hideNext,
}: {
  step: StepId;
  locks: StepLocks;
  onGo: (step: StepId) => void;
  hideNext?: boolean;
}) {
  const t = useT();
  const { previous, next } = neighbours(step);
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
  onGo,
}: {
  step: StepId;
  locks: StepLocks;
  onGo: (step: StepId) => void;
}) {
  const t = useT();
  const { previous, next } = neighbours(step);
  // The page keeps room for the bar at its end, so the bar never hides the last lines.
  useEffect(() => {
    document.body.classList.add("has-step-bar");
    return () => document.body.classList.remove("has-step-bar");
  }, []);
  return (
    <nav
      aria-label={t("factor.nav.aria")}
      className="lg:hidden fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
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
        <span className="flex-1 min-w-0 text-center text-xs text-muted truncate">
          {t("factor.nav.position", { n: STEP_IDS.indexOf(step) + 1, total: STEP_IDS.length })}
        </span>
        {next ? <NextButton next={next} lock={locks[next]} onGo={onGo} compact /> : <span className="w-[4.5rem]" />}
      </div>
    </nav>
  );
}

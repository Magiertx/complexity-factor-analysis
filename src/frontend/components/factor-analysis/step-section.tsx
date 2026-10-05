"use client";

import { useId, useState } from "react";
import { AlertTriangle, Check, HelpCircle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

export type StepId = "data" | "dataset" | "suitability" | "factors" | "loadings" | "interpretation";
export type StepState = "locked" | "active" | "done" | "warn" | "busy";

export function stepAnchor(id: StepId) {
  return `fa-step-${id}`;
}

export function StepBadge({ n, state, className }: { n: number; state: StepState; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "h-7 w-7 shrink-0 rounded-full grid place-items-center text-xs font-semibold",
        state === "done" && "bg-success/15 text-success-ink",
        state === "warn" && "bg-warn/15 text-warn-ink",
        state === "busy" && "bg-accent/15 text-accent-ink",
        state === "active" && "bg-accent text-accent-fg",
        state === "locked" && "bg-tile text-muted",
        className,
      )}
    >
      {state === "done" ? (
        <Check className="h-3.5 w-3.5" />
      ) : state === "warn" ? (
        <AlertTriangle className="h-3.5 w-3.5" />
      ) : state === "busy" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        n
      )}
    </span>
  );
}

interface SectionProps {
  id: StepId;
  n: number;
  state: StepState;
  title: string;
  description: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export function StepSection({ id, n, state, title, description, actions, children }: SectionProps) {
  const anchor = stepAnchor(id);
  return (
    <section id={anchor} data-tour={`fa-${id}`} aria-labelledby={`${anchor}-title`} className="scroll-mt-6">
      <Card className="overflow-hidden">
        <div className="px-4 sm:px-5 pt-5 pb-4 border-b border-border flex items-start gap-3 flex-wrap">
          <StepBadge n={n} state={state} className="mt-0.5" />
          <div className="flex-1 min-w-[12rem]">
            <h2 id={`${anchor}-title`} className="text-base font-semibold tracking-tight">
              {title}
            </h2>
            <p className="text-sm text-muted mt-0.5">{description}</p>
          </div>
          {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
        </div>
        <div className="px-4 sm:px-5 py-5">{children}</div>
      </Card>
    </section>
  );
}

/** Placeholder for a step that has nothing to show yet; says what to do first. */
export function EmptyStep({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-8 flex flex-col items-center gap-2 text-center text-sm text-muted">
      {icon}
      <div className="max-w-md">{children}</div>
    </div>
  );
}

/**
 * A label with a "?" button that unfolds a short explanation below it. With `htmlFor` the
 * label is a <label> of that control.
 */
export function HelpLabel({
  label,
  help,
  as = "h3",
  htmlFor,
  className,
  extra,
}: {
  label: string;
  help: string;
  as?: "h3" | "span";
  htmlFor?: string;
  className?: string;
  extra?: React.ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className={className}>
      <div className="flex items-center gap-1.5 flex-wrap">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-semibold">
            {label}
          </label>
        ) : as === "span" ? (
          <span className="text-sm font-semibold">{label}</span>
        ) : (
          <h3 className="text-sm font-semibold">{label}</h3>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={t("factor.help_aria", { topic: label })}
          title={t("factor.help_aria", { topic: label })}
          className={cn(
            "h-6 w-6 rounded-full grid place-items-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            open ? "text-accent-ink bg-accent/10" : "text-muted hover:text-fg hover:bg-tile",
          )}
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
        {extra}
      </div>
      <p
        id={panelId}
        hidden={!open}
        className="mt-2 text-xs leading-relaxed text-fg/80 bg-tile/60 rounded-md px-3 py-2 max-w-prose"
      >
        {help}
      </p>
    </div>
  );
}

/** Pass/fail chip with an icon, so the state never depends on colour alone. */
export function PassBadge({ passed }: { passed: boolean }) {
  const t = useT();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        passed ? "bg-success/15 text-success-ink" : "bg-danger/15 text-danger-ink",
      )}
    >
      {passed ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {passed ? t("factor.suitability.passed") : t("factor.suitability.failed")}
    </span>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg bg-tile px-3.5 py-3 min-w-0" title={hint}>
      <div className="text-[11px] text-muted truncate">{label}</div>
      <div className="mt-1 text-xl font-semibold font-mono tabular-nums">{value}</div>
    </div>
  );
}

/** Number input that only reports valid values within its range. */
export function NumberField({
  id,
  value,
  onChange,
  min,
  max,
  step,
  className,
}: {
  id: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  className?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(String(value));
  }
  const parsed = Number(draft);
  const invalid = draft.trim() === "" || !Number.isFinite(parsed) || parsed < min || parsed > max;
  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={draft}
      aria-invalid={invalid || undefined}
      onChange={(e) => {
        setDraft(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value.trim() !== "" && Number.isFinite(v) && v >= min && v <= max) onChange(v);
      }}
      onBlur={() => setDraft(String(value))}
      className={cn(
        "h-8 w-20 rounded-md bg-bg px-2 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-accent/50 transition",
        invalid && "ring-2 ring-danger/60",
        className,
      )}
    />
  );
}

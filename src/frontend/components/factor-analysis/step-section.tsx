"use client";

import { useId, useState } from "react";
import { AlertTriangle, Check, Info } from "lucide-react";
import { stepAnchor, type StepId } from "@/lib/steps";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { Term, useTip } from "@/components/ui/tip";
import { formatInputNumber, parseInputNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useLocale, useT } from "@/lib/i18n";
import { STEP_ICONS } from "./step-nav";

export type { StepId, StepState } from "@/lib/steps";
export { stepAnchor } from "@/lib/steps";

interface SectionProps {
  id: StepId;
  title: string;
  description: string;
  actions?: React.ReactNode;
  /** Back and Next, under the step. */
  footer?: React.ReactNode;
  /** Kept on the page but not shown, e.g. the data step with a form half filled in. */
  hidden?: boolean;
  children: React.ReactNode;
}

/**
 * One step of the analysis as a card: its sign, its name (which takes the focus when the step is
 * opened) and what it is for, then its content and Back and Next.
 */
export function StepSection({ id, title, description, actions, footer, hidden, children }: SectionProps) {
  const anchor = stepAnchor(id);
  const Icon = STEP_ICONS[id];
  return (
    <section id={anchor} aria-labelledby={`${anchor}-title`} hidden={hidden}>
      <Card>
        {/* The tour points at the heading of the step, which is in view when the step opens. */}
        <div
          data-tour={`fa-${id}`}
          className="px-4 sm:px-5 pt-5 pb-4 border-b border-border flex items-start gap-3 flex-wrap"
        >
          <span aria-hidden className="h-8 w-8 rounded-md bg-tile text-muted grid place-items-center shrink-0">
            <Icon className="h-4 w-4" />
          </span>
          <div className="flex-1 min-w-[12rem]">
            <h2
              id={`${anchor}-title`}
              tabIndex={-1}
              className="w-fit text-base font-semibold tracking-tight rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              {title}
            </h2>
            <p className="text-sm text-muted mt-0.5">{description}</p>
          </div>
          {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
        </div>
        <div className="px-4 sm:px-5 py-5">{children}</div>
        {footer}
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

/** Explanations up to this length are a tooltip of their label; longer ones unfold below it. */
const LONG_HELP = 400;

/**
 * A label with its explanation: as the tooltip of the label (dotted under), or for a long
 * reference text as a panel that an info button unfolds below it. With `htmlFor` the label is a
 * <label> of that control.
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
  const long = help.length > LONG_HELP;
  const text = long ? label : <Term more={help}>{label}</Term>;
  return (
    <div className={className}>
      <div className="flex items-center gap-1.5 flex-wrap">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-semibold">
            {text}
          </label>
        ) : as === "span" ? (
          <span className="text-sm font-semibold">{text}</span>
        ) : (
          <h3 className="text-sm font-semibold">{text}</h3>
        )}
        {long && (
          <IconButton
            size="sm"
            icon={Info}
            name={t("factor.help_aria", { topic: label })}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={panelId}
            className={cn("h-6 w-6", open && "text-accent-ink hover:text-accent-ink")}
          />
        )}
        {extra}
      </div>
      {long && (
        <p
          id={panelId}
          hidden={!open}
          className="mt-2 text-xs leading-relaxed text-fg/80 bg-tile/60 rounded-md px-3 py-2 max-w-prose"
        >
          {help}
        </p>
      )}
    </div>
  );
}

/**
 * Whether a test passed, as an icon and a word, so the state never depends on colour alone. A
 * failed test is a warning: the analysis still runs.
 */
export function PassBadge({ passed }: { passed: boolean }) {
  const t = useT();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium",
        passed ? "text-success-ink" : "text-warn-ink",
      )}
    >
      {passed ? <Check className="h-3 w-3" aria-hidden /> : <AlertTriangle className="h-3 w-3" aria-hidden />}
      {passed ? t("factor.suitability.passed") : t("factor.suitability.failed")}
    </span>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  const tip = useTip<HTMLDivElement>(hint ? { more: hint } : null);
  return (
    <div ref={tip} className="rounded-lg bg-tile px-3.5 py-3 min-w-0">
      <div className="text-[11px] text-muted truncate">{label}</div>
      <div className="mt-1 text-xl font-semibold font-mono tabular-nums">{value}</div>
    </div>
  );
}

/**
 * Number field in the format of the UI language ("0,35" in German), whatever the browser's
 * locale. A text input, since type="number" formats by the browser; the arrow keys step like
 * a spin button. Only valid values within the range are reported.
 */
export function NumberField({
  id,
  value,
  onChange,
  min,
  max,
  step,
  className,
  describedBy,
}: {
  id: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  className?: string;
  /** Id of a note on the value, read out with the field. */
  describedBy?: string;
}) {
  const { locale } = useLocale();
  const shown = formatInputNumber(value, locale);
  const [draft, setDraft] = useState(shown);
  // The value the draft stands for. A value from outside or a language switch replaces the
  // draft; a value just typed does not, so "0," on the way to "0,4" is not cut to "0".
  const [synced, setSynced] = useState({ value, locale });
  if (value !== synced.value || locale !== synced.locale) {
    setSynced({ value, locale });
    setDraft(shown);
  }
  const parsed = parseInputNumber(draft);
  const invalid = parsed === null || parsed < min || parsed > max;
  const report = (v: number) => {
    setSynced({ value: v, locale });
    // "0,30" after "0,3" is no change, and would only run the analysis again.
    if (v !== value) onChange(v);
  };
  const stepBy = (direction: 1 | -1) => {
    // Rounded to the decimals of the step, so 0.35 + 0.05 is 0.4 and not 0.39999999999999997.
    const decimals = (String(step).split(".")[1] ?? "").length;
    const from = invalid || parsed === null ? value : parsed;
    const next = Math.min(max, Math.max(min, Number((from + direction * step).toFixed(decimals))));
    setDraft(formatInputNumber(next, locale));
    report(next);
  };
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      role="spinbutton"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={shown}
      value={draft}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      onChange={(e) => {
        setDraft(e.target.value);
        const v = parseInputNumber(e.target.value);
        if (v !== null && v >= min && v <= max) report(v);
      }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        stepBy(e.key === "ArrowUp" ? 1 : -1);
      }}
      onBlur={() => setDraft(shown)}
      className={cn(
        "h-8 w-20 rounded-md bg-bg px-2 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-accent/50 transition",
        invalid && "ring-2 ring-danger/60",
        className,
      )}
    />
  );
}

/** A threshold or level with its label and explanation above the field, alike in every step. */
export function ThresholdField({
  id,
  label,
  help,
  note,
  ...field
}: {
  id: string;
  label: string;
  help: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  /** A short note below the field, e.g. that another setting overrides its value. */
  note?: string | null;
}) {
  return (
    <div className="space-y-1.5">
      <HelpLabel htmlFor={id} label={label} help={help} />
      <NumberField id={id} {...field} describedBy={note ? `${id}-note` : undefined} />
      {note && (
        <p id={`${id}-note`} className="max-w-[11rem] text-[11px] text-muted">
          {note}
        </p>
      )}
    </div>
  );
}

/**
 * The label of a control without an explanation, as tall as a HelpLabel, so controls in one
 * row line up.
 */
export function FieldLabel({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <span id={id} className="flex items-center h-6 text-sm font-semibold">
      {children}
    </span>
  );
}

/** The notes of the analysis that concern a step, e.g. a failed test or too many factors. */
export function NoticeList({ heading, notes }: { heading: string; notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="rounded-lg bg-warn/10 px-3.5 py-3 flex items-start gap-2.5 text-sm">
      <AlertTriangle className="h-4 w-4 text-warn-ink shrink-0 mt-0.5" />
      <div className="min-w-0">
        <div className="font-medium">{heading}</div>
        <ul className="mt-1 text-xs text-muted space-y-0.5 list-disc pl-4">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

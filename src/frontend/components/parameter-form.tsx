"use client";

import { useState } from "react";
import { AlertCircle, Hourglass, RotateCcw, Search } from "lucide-react";
import type { ParameterSpec } from "@/lib/api";
import { ChoiceMark, choiceTile } from "@/components/ui/choice";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useT, useLocale, localizedParamHelp, localizedParamLabel } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** What the UI knows about an option of a multiple choice: its definition, and whether it is slow. */
export type OptionInfo = Record<string, { description?: string; slow?: boolean }>;

interface Props {
  schema: ParameterSpec[];
  values: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
  disabled?: boolean;
  errors?: Record<string, string>;
  /**
   * When true, only render parameters whose current value differs from
   * `spec.default`. Used in the past-job view so reviewers can spot at a glance
   * what the user actually changed from the algorithm's defaults.
   */
  diffOnly?: boolean;
  /** Enables the German overlay for `spec.help` (see lib/i18n/algo-content). */
  algorithmId?: string;
  /** Definitions and slow marks of the options of multiple choices, by option. */
  optionInfo?: OptionInfo;
}

export function ParameterForm({
  schema,
  values,
  onChange,
  disabled,
  errors = {},
  diffOnly = false,
  algorithmId,
  optionInfo,
}: Props) {
  const t = useT();
  const visible = diffOnly
    ? schema.filter((p) => !valuesEqual(values[p.name], p.default))
    : schema;

  if (diffOnly && visible.length === 0) {
    return (
      <p className="text-xs text-muted italic">
        {t("parameter_form.all_at_defaults")}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {visible.map((p) => (
        <Field
          key={p.name}
          spec={p}
          algorithmId={algorithmId}
          optionInfo={optionInfo}
          value={values[p.name]}
          onChange={(v) => onChange(p.name, v)}
          disabled={disabled}
          error={errors[p.name]}
        />
      ))}
    </div>
  );
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const sa = [...a].map(String).sort();
    const sb = [...b].map(String).sort();
    return sa.every((v, i) => v === sb[i]);
  }
  // Numeric form coercion: schema default may be a JSON number while the
  // submitted params can round-trip through strings (form input → JSON).
  if (typeof a === "number" || typeof b === "number") {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  }
  return String(a) === String(b);
}

/**
 * The choices of a multiple choice. A past run keeps a single choice as a plain string, since
 * the form sent one value; the backend reads a string as a comma-separated list, and so does this.
 */
export function choiceList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

function Field({
  spec,
  algorithmId,
  optionInfo,
  value,
  onChange,
  disabled,
  error,
}: {
  spec: ParameterSpec;
  algorithmId?: string;
  optionInfo?: OptionInfo;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
  error?: string;
}) {
  const [search, setSearch] = useState("");
  const { locale, t } = useLocale();
  const help = localizedParamHelp(algorithmId, spec, locale);
  const label = localizedParamLabel(algorithmId, spec, locale);
  const id = `p-${spec.name}`;
  const labelId = `${id}-label`;
  const hintId = help || spec.recommended ? `${id}-hint` : undefined;

  const hint = help || spec.recommended ? (
    <span id={hintId} className="block text-[11px] text-muted mt-1.5">
      {help}
      {spec.recommended && (
        <span className="block text-muted italic mt-0.5">
          {t("parameter_form.recommended", { value: spec.recommended })}
        </span>
      )}
    </span>
  ) : null;

  if (spec.type === "bool") {
    return (
      <div className={"flex items-center justify-between gap-3 py-1.5 " + (disabled ? "opacity-60" : "")}>
        <div>
          <Label id={labelId} htmlFor={id}>{label}</Label>
          {hint}
        </div>
        <Switch
          id={id}
          aria-labelledby={labelId}
          aria-describedby={hintId}
          checked={Boolean(value)}
          onCheckedChange={(v) => onChange(v)}
          disabled={disabled}
        />
      </div>
    );
  }

  if (spec.type === "enum") {
    return (
      <div className={disabled ? "opacity-60" : ""}>
        <Label id={labelId} htmlFor={id}>{label}</Label>
        <div className="mt-1.5">
          <Select
            id={id}
            value={String(value ?? "")}
            onValueChange={(v) => onChange(v)}
            disabled={disabled}
            aria-labelledby={labelId}
            aria-describedby={hintId}
            options={(spec.options ?? []).map((o) => ({ value: o, label: o }))}
          />
        </div>
        {hint}
        {error && (
          <span className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-danger-ink">
            <AlertCircle className="h-3 w-3 shrink-0" aria-hidden />
            {error}
          </span>
        )}
      </div>
    );
  }

  if (spec.type === "multi_enum") {
    const options = spec.options ?? [];
    const selected = choiceList(value);
    const defaults = Array.isArray(spec.default) ? (spec.default as string[]) : [];
    // In the order of the options, as the data step of the factor analysis keeps its lists.
    const choose = (next: string[]) => {
      if (!disabled) onChange(options.filter((o) => next.includes(o)));
    };
    const toggle = (opt: string) =>
      choose(selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt]);
    // The search only dims the options that do not match, so the tiles keep their places.
    const query = search.trim().toLowerCase();
    const matches = (opt: string) => !query || opt.toLowerCase().includes(query);
    const linkClass =
      "text-[11px] text-muted hover:text-fg transition inline-flex items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

    return (
      <fieldset className={cn("sm:col-span-2 space-y-2", disabled && "opacity-60")} aria-describedby={help ? hintId : undefined}>
        <div className="flex items-center justify-between gap-x-4 gap-y-2 flex-wrap">
          <legend className="flex items-center gap-1 text-sm font-semibold">
            {label}
            <span className="text-xs font-normal text-muted">
              {t("parameter_form.selected_count", { n: selected.length, total: options.length })}
            </span>
            {help && <InfoTip topic={label} text={help} />}
          </legend>
          {help && (
            <p id={hintId} className="sr-only">
              {help}
            </p>
          )}
          {!disabled && (
            <div className="flex items-center gap-3 flex-wrap ml-auto">
              <div className="relative flex items-center">
                <Search className="absolute left-2.5 h-3.5 w-3.5 text-muted pointer-events-none" aria-hidden />
                <input
                  type="search"
                  placeholder={t("parameter_form.search_placeholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label={t("parameter_form.search_options_aria", { label })}
                  className="h-7 pl-8 pr-2.5 text-xs rounded bg-tile text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 w-[150px] transition"
                />
              </div>
              <button type="button" className={linkClass} onClick={() => choose(options)}>
                {t("parameter_form.select_all")}
              </button>
              <button type="button" className={linkClass} onClick={() => choose([])}>
                {t("parameter_form.select_none")}
              </button>
              <button type="button" className={linkClass} onClick={() => choose(defaults)}>
                <RotateCcw className="h-3 w-3" aria-hidden />
                {t("parameter_form.select_defaults")}
              </button>
            </div>
          )}
        </div>
        <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {options.map((o) => {
            const on = selected.includes(o);
            const info = optionInfo?.[o];
            return (
              <label
                key={o}
                title={info?.description}
                className={cn(
                  "flex items-start gap-2.5 rounded-md px-2.5 py-2 text-xs",
                  choiceTile(on),
                  !matches(o) && "opacity-40",
                  disabled && "cursor-default",
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(o)}
                  disabled={disabled}
                  className="sr-only"
                />
                <ChoiceMark checked={on} className="mt-px" />
                <span className="min-w-0 flex-1 flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium">{o}</span>
                  {info?.slow && (
                    <span
                      className="inline-flex items-center gap-0.5 rounded bg-surface/70 text-muted px-1 text-[10px] font-medium"
                      title={t("parameter_form.slow_title")}
                    >
                      <Hourglass className="h-2.5 w-2.5" aria-hidden />
                      {t("parameter_form.slow_badge")}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
        {spec.recommended && (
          <p className="text-[11px] text-muted italic">
            {t("parameter_form.recommended", { value: spec.recommended })}
          </p>
        )}
        {error && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-danger-ink">
            <AlertCircle className="h-3 w-3 shrink-0" aria-hidden />
            {error}
          </span>
        )}
      </fieldset>
    );
  }

  if (spec.type === "string") {
    return (
      <div className={"sm:col-span-2 " + (disabled ? "opacity-60" : "")}>
        <Label id={labelId} htmlFor={id}>{label}</Label>
        <div className="mt-1.5">
          <Input
            id={id}
            type="text"
            disabled={disabled}
            value={value === undefined || value === null ? "" : String(value)}
            onChange={(e) => onChange(e.target.value)}
            aria-labelledby={labelId}
            aria-describedby={hintId}
          />
        </div>
        {hint}
        {error && (
          <span className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-danger-ink">
            <AlertCircle className="h-3 w-3 shrink-0" aria-hidden />
            {error}
          </span>
        )}
      </div>
    );
  }

  const step = spec.type === "float" ? "0.01" : "1";
  return (
    <div className={disabled ? "opacity-60" : ""}>
      <Label id={labelId} htmlFor={id}>{label}</Label>
      <div className="mt-1.5">
        <Input
          id={id}
          type="number"
          step={step}
          min={spec.min}
          max={spec.max}
          disabled={disabled}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
          aria-labelledby={labelId}
          aria-describedby={hintId}
        />
      </div>
      {hint}
      {error && (
          <span className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-danger-ink">
            <AlertCircle className="h-3 w-3 shrink-0" aria-hidden />
            {error}
          </span>
        )}
    </div>
  );
}

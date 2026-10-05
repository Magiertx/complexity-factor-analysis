"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import type { ParameterSpec } from "@/lib/api";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useT, useLocale, localizedParamHelp } from "@/lib/i18n";

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
}

export function ParameterForm({ schema, values, onChange, disabled, errors = {}, diffOnly = false, algorithmId }: Props) {
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

function Field({
  spec,
  algorithmId,
  value,
  onChange,
  disabled,
  error,
}: {
  spec: ParameterSpec;
  algorithmId?: string;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
  error?: string;
}) {
  const [search, setSearch] = useState("");
  const { locale, t } = useLocale();
  const help = localizedParamHelp(algorithmId, spec, locale);
  const id = `p-${spec.name}`;
  const labelId = `${id}-label`;
  const hintId = help || spec.recommended ? `${id}-hint` : undefined;

  const hint = help || spec.recommended ? (
    <span id={hintId} className="block text-[11px] text-muted mt-1.5 normal-case font-normal tracking-normal">
      {help}
      {spec.recommended && (
        <span className="block text-muted/70 italic mt-0.5">
          {t("parameter_form.recommended", { value: spec.recommended })}
        </span>
      )}
    </span>
  ) : null;

  if (spec.type === "bool") {
    return (
      <div className={"flex items-center justify-between gap-3 py-1.5 " + (disabled ? "opacity-60" : "")}>
        <div>
          <Label id={labelId} htmlFor={id}>{spec.label}</Label>
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
        <Label id={labelId} htmlFor={id}>{spec.label}</Label>
        <div className="mt-1.5">
          <Select
            id={id}
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            aria-labelledby={labelId}
            aria-describedby={hintId}
          >
            {(spec.options ?? []).map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </Select>
        </div>
        {hint}
        {error && <span className="block text-[11px] text-danger mt-1.5 font-medium">{error}</span>}
      </div>
    );
  }

  if (spec.type === "multi_enum") {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    const toggle = (opt: string) => {
      if (disabled) return;
      const next = selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt];
      onChange(next);
    };

    let regex: RegExp | null = null;
    try {
      // Escape special regex characters to make user search safe and ReDoS-immune
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      regex = escaped ? new RegExp(escaped, "i") : null;
    } catch {
      // Ignore invalid regex
    }

    const matches = (opt: string) => {
      if (!search) return true;
      if (regex) {
        return regex.test(opt);
      }
      return opt.toLowerCase().includes(search.toLowerCase());
    };

    const sortedOptions = [...(spec.options ?? [])].sort((x, y) => x.localeCompare(y));
    const groupA = sortedOptions.filter(matches);
    const groupB = search ? sortedOptions.filter((opt) => !matches(opt)) : [];
    const finalOptions = [...groupA, ...groupB];

    return (
      <div className={"sm:col-span-2 space-y-2 " + (disabled ? "opacity-60" : "")}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Label id={labelId}>{spec.label}</Label>
          {!disabled && (
            <div className="relative flex items-center shrink-0">
              <Search className="absolute left-2.5 h-3.5 w-3.5 text-muted pointer-events-none" />
              <input
                type="text"
                placeholder={t("parameter_form.search_placeholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label={t("parameter_form.search_options_aria", { label: spec.label })}
                className="h-7 pl-8 pr-2.5 text-xs rounded bg-tile text-fg placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent/40 min-w-[120px] max-w-[180px] transition"
              />
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={labelId} aria-describedby={hintId}>
          {finalOptions.map((o) => {
            const active = selected.includes(o);
            const isMatch = !search || groupA.includes(o);
            return (
              <button
                key={o}
                type="button"
                onClick={() => toggle(o)}
                disabled={disabled}
                aria-pressed={active}
                className={
                  "rounded-md px-2.5 h-8 text-xs font-mono transition " +
                  (active
                    ? "bg-accent/[0.45] text-fg "
                    : "bg-tile text-muted hover:text-fg hover:bg-accent/[0.14] ") +
                  (isMatch ? "" : "opacity-30 ")
                }
              >
                {o}
              </button>
            );
          })}
        </div>
        {hint}
        {error && <span className="block text-[11px] text-danger mt-1.5 font-medium">{error}</span>}
      </div>
    );
  }

  if (spec.type === "string") {
    return (
      <div className={"sm:col-span-2 " + (disabled ? "opacity-60" : "")}>
        <Label id={labelId} htmlFor={id}>{spec.label}</Label>
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
        {error && <span className="block text-[11px] text-danger mt-1.5 font-medium">{error}</span>}
      </div>
    );
  }

  const step = spec.type === "float" ? "0.01" : "1";
  return (
    <div className={disabled ? "opacity-60" : ""}>
      <Label id={labelId} htmlFor={id}>{spec.label}</Label>
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
      {error && <span className="block text-[11px] text-danger mt-1.5 font-medium">{error}</span>}
    </div>
  );
}

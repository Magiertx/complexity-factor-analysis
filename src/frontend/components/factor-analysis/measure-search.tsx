"use client";

// The search field and the notable-only switch above a long list of measures.

import { useEffect, useMemo, useRef } from "react";
import { Search } from "lucide-react";
import { useT } from "@/lib/i18n";
import { Switch } from "@/components/ui/switch";
import { InfoTip } from "@/components/ui/info-tip";
import { mergeRefs, useTip } from "@/components/ui/tip";

/**
 * The search field of a long list of measures. "/" anywhere but in a field goes to it, and Escape
 * clears it. Only one list is on screen at a time, so one field answers to the key.
 */
export function MeasureSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);
  const tip = useTip<HTMLInputElement>({ name: t("factor.measures.search"), keyCap: "/" });
  const refs = useMemo(() => mergeRefs(ref, tip), [tip]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement | null)?.isContentEditable) return;
      e.preventDefault();
      ref.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <label className="relative flex-1 min-w-[12rem] max-w-xs">
      <span className="sr-only">{t("factor.measures.search")}</span>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted" aria-hidden />
      <input
        ref={refs}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.stopPropagation();
            onChange("");
          }
        }}
        placeholder={t("factor.measures.search_placeholder")}
        className="h-8 w-full rounded-md bg-tile pl-8 pr-2 text-sm placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      />
    </label>
  );
}

/** The switch that narrows a list to its notable measures; `label` says what it counts, `help` what counts as notable. */
export function NotableSwitch({
  id,
  checked,
  onChange,
  label,
  help,
}: {
  id: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  help?: string;
}) {
  return (
    <span className="flex items-center gap-2 text-xs">
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-labelledby={`${id}-label`} />
      <label id={`${id}-label`} htmlFor={id} className="cursor-pointer">
        {label}
      </label>
      {help && <InfoTip size="xs" topic={label} text={help} />}
    </span>
  );
}

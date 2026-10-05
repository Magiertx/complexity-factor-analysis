"use client";

import { Languages } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function LocaleToggle({ className }: { className?: string }) {
  const { locale, setLocale, t } = useLocale();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const next = locale === "en" ? "de" : "en";
  const label =
    locale === "en" ? t("header.switch_to_german") : t("header.switch_to_english");
  const display = mounted ? locale.toUpperCase() : "EN";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setLocale(next)}
      className={cn(
        "h-9 px-2.5 inline-flex items-center gap-1.5 rounded-md border border-border hover:bg-surface transition text-xs font-medium text-muted hover:text-fg",
        className,
      )}
    >
      <Languages className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span aria-hidden>{display}</span>
    </button>
  );
}

export function LocaleSegmented({ className }: { className?: string }) {
  const { locale, setLocale, t } = useLocale();
  return (
    <div
      role="group"
      aria-label={t("header.locale_label")}
      className={cn(
        "inline-flex rounded-md border border-border overflow-hidden text-xs font-medium",
        className,
      )}
    >
      {(["en", "de"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          aria-pressed={locale === l}
          className={cn(
            "h-9 px-3 transition",
            locale === l
              ? "bg-accent text-accent-fg"
              : "text-muted hover:text-fg hover:bg-surface",
          )}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

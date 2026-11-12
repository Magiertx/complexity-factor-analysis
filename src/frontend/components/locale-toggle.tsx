"use client";

// Language switch (EN/DE): a button for the site header and a segmented control for the settings.

import { Languages } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocale, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Segmented } from "./ui/segmented";
import { useTip } from "./ui/tip";

/** Header button that switches between English and German; its label names the language it switches to. */
export function LocaleToggle({ className }: { className?: string }) {
  const { locale, setLocale, t } = useLocale();
  // The stored language is only known in the browser; until mounted the label shows EN.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const next = locale === "en" ? "de" : "en";
  const label =
    locale === "en" ? t("header.switch_to_german") : t("header.switch_to_english");
  const display = mounted ? locale.toUpperCase() : "EN";
  const tip = useTip<HTMLButtonElement>({ name: label });

  return (
    <button
      ref={tip}
      type="button"
      aria-label={label}
      onClick={() => setLocale(next)}
      className={cn(
        "h-9 px-2.5 inline-flex items-center gap-1.5 rounded-md hover:bg-tile transition text-xs font-medium text-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        className,
      )}
    >
      <Languages className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span aria-hidden>{display}</span>
    </button>
  );
}

/** The language as a toggle like the theme toggle beside it in the settings. */
export function LocaleSegmented({ className }: { className?: string }) {
  const { locale, setLocale, t } = useLocale();
  return (
    <Segmented<Locale>
      value={locale}
      onChange={setLocale}
      aria-label={t("header.locale_label")}
      className={cn("w-[120px]", className)}
      options={[
        { value: "en", label: "EN" },
        { value: "de", label: "DE" },
      ]}
    />
  );
}

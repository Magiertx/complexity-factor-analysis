"use client";

import Link from "next/link";
import { Settings as SettingsIcon, Code2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import { APP_INITIALS, APP_NAME } from "@/lib/app-config";
import { LocaleToggle } from "./locale-toggle";

export function SiteHeader() {
  const t = useT();
  return (
    <header className="border-b border-border">
      <div className="mx-auto max-w-[1920px] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-3">
            <div className="h-7 w-7 rounded-md bg-accent grid place-items-center text-accent-fg text-xs font-semibold">
              {APP_INITIALS}
            </div>
            <span className="font-semibold tracking-tight">{APP_NAME}</span>
          </Link>
          <span className="hidden sm:inline text-xs text-muted">
            {t("header.tagline")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <LocaleToggle />
          <Link
            href="/api-access"
            className="h-9 px-3 inline-flex items-center gap-1.5 rounded-md bg-tile hover:bg-accent/[0.08] transition text-xs font-medium whitespace-nowrap text-muted hover:text-fg"
            title={t("header.api_title", { app: APP_NAME })}
          >
            <Code2 className="h-3.5 w-3.5 shrink-0" />
            <span>{t("common.api")}</span>
          </Link>
          <Link
            href="/settings"
            aria-label={t("header.settings_label")}
            title={t("header.settings_title")}
            className="h-9 w-9 grid place-items-center rounded-md bg-tile hover:bg-accent/[0.08] transition text-muted hover:text-fg"
          >
            <SettingsIcon className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}

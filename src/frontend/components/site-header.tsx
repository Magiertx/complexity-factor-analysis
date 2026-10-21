"use client";

import Link from "next/link";
import { Settings as SettingsIcon, Code2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useTip } from "./ui/tip";
import { APP_INITIALS, APP_NAME } from "@/lib/app-config";
import { LocaleToggle } from "./locale-toggle";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  const t = useT();
  const apiTip = useTip<HTMLAnchorElement>({ name: t("common.api"), more: t("header.api_title", { app: APP_NAME }) });
  const settingsTip = useTip<HTMLAnchorElement>({ name: t("header.settings_title") });
  return (
    <header className="border-b border-border print:hidden">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="flex items-center gap-3 min-w-0">
            <div className="h-7 w-7 rounded-md bg-accent grid place-items-center text-accent-fg text-xs font-semibold shrink-0">
              {APP_INITIALS}
            </div>
            <span className="font-semibold tracking-tight leading-tight">{APP_NAME}</span>
          </Link>
          <span className="hidden lg:inline text-xs text-muted">
            {t("header.tagline")}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <LocaleToggle />
          <ThemeToggle />
          <Link
            ref={apiTip}
            href="/api-access"
            className="h-9 w-9 sm:w-auto sm:px-3 inline-flex items-center justify-center gap-1.5 rounded-md bg-tile hover:bg-accent/[0.08] transition text-xs font-medium whitespace-nowrap text-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label={t("common.api")}
          >
            <Code2 className="h-3.5 w-3.5 shrink-0" />
            {/* The icon alone on a phone, where the name of the app needs the room. */}
            <span className="hidden sm:inline" aria-hidden>
              {t("common.api")}
            </span>
          </Link>
          <Link
            ref={settingsTip}
            href="/settings"
            aria-label={t("header.settings_label")}
            className="h-9 w-9 grid place-items-center rounded-md bg-tile hover:bg-accent/[0.08] transition text-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <SettingsIcon className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Code2, Settings as SettingsIcon } from "lucide-react";
import { useT } from "@/lib/i18n";
import { HEADER_HREFS, activeHeaderLink, type HeaderLinkId } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { useTip } from "./ui/tip";
import { APP_INITIALS, APP_NAME } from "@/lib/app-config";
import { LocaleToggle } from "./locale-toggle";
import { ThemeToggle } from "./theme-toggle";

const ICONS: Record<HeaderLinkId, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  guide: BookOpen,
  api: Code2,
  settings: SettingsIcon,
};

/**
 * A page of the header: the guide and the API with their names from a small screen on, the
 * settings as an icon. The page on screen is marked (aria-current) like the tab of a page.
 */
function HeaderLink({ id, active, textFrom }: { id: HeaderLinkId; active: boolean; textFrom?: "sm" }) {
  const t = useT();
  const name = t(`header.${id}_label`);
  const tip = useTip<HTMLAnchorElement>({ name, more: t(`header.${id}_title`, { app: APP_NAME }) });
  const Icon = ICONS[id];
  return (
    <Link
      ref={tip}
      href={HEADER_HREFS[id]}
      aria-label={name}
      aria-current={active ? "page" : undefined}
      className={cn(
        "h-9 min-w-9 inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium whitespace-nowrap transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        textFrom === "sm" ? "px-2.5 sm:px-3" : "px-2.5",
        active ? "bg-tile text-fg" : "text-muted hover:text-fg hover:bg-tile",
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", active && "text-accent-ink")} aria-hidden />
      {/* The icon alone on a phone, where the name of the app needs the room. */}
      {textFrom === "sm" && (
        <span className="hidden sm:inline" aria-hidden>
          {name}
        </span>
      )}
    </Link>
  );
}

/**
 * The top of every page: the app, and on the right the pages that belong to no tab (the guide, the
 * API, the settings). Language and theme sit beside them from a small screen on; on a phone they
 * are in the settings, so the name of the app keeps its line. Below 400 px only the logo stays.
 */
export function SiteHeader() {
  const t = useT();
  const pathname = usePathname();
  const active = activeHeaderLink(pathname);
  return (
    <header className="border-b border-border print:hidden">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/"
            aria-label={APP_NAME}
            className="flex items-center gap-3 min-w-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="h-7 w-7 rounded-md bg-accent grid place-items-center text-accent-fg text-xs font-semibold shrink-0" aria-hidden>
              {APP_INITIALS}
            </span>
            <span className="hidden min-[400px]:block font-semibold tracking-tight leading-tight whitespace-nowrap truncate" aria-hidden>
              {APP_NAME}
            </span>
          </Link>
          <span className="hidden xl:inline text-xs text-muted truncate">{t("header.tagline")}</span>
        </div>
        <nav aria-label={t("header.nav_aria")} className="flex items-center gap-2 shrink-0">
          <span className="hidden sm:flex items-center gap-2">
            <LocaleToggle />
            <ThemeToggle />
            <span aria-hidden className="mx-1.5 h-5 w-px bg-border" />
          </span>
          <HeaderLink id="guide" active={active === "guide"} textFrom="sm" />
          <HeaderLink id="api" active={active === "api"} textFrom="sm" />
          <HeaderLink id="settings" active={active === "settings"} />
        </nav>
      </div>
    </header>
  );
}

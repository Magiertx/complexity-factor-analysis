"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { APP_NAME } from "@/lib/app-config";
import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/ui/info-tip";

/**
 * The heading of every page (docs/UI.md): the title, at most one short line on what the page is for,
 * a longer explanation behind the (i) beside the title, and the page's own actions on the right. It
 * also names the browser tab after the page in the language of the UI; the route's metadata can only
 * give the English title.
 */
export function PageHeader({
  title,
  subtitle,
  info,
  subtitleClassName,
  back,
  actions,
}: {
  title: string;
  /** One short line. */
  subtitle?: React.ReactNode;
  /** What the page is for at length, behind the (i) beside the title. */
  info?: string;
  /** For the sentence under the title, e.g. to hide it where room is short. */
  subtitleClassName?: string;
  /** For a page below another one: a link back to it above the title. */
  back?: { href: string; label: string };
  actions?: React.ReactNode;
}) {
  useEffect(() => {
    const text = `${title} · ${APP_NAME}`;
    const apply = () => {
      if (document.title !== text) document.title = text;
    };
    apply();
    // Next writes the English title of the route's metadata into the head when it hydrates,
    // which can come after this effect; the observer puts the title of the UI language back.
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);

  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 max-w-3xl">
        {back && (
          <Link
            href={back.href}
            className="mb-1.5 inline-flex items-center gap-1 rounded text-xs text-muted hover:text-fg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            {back.label}
          </Link>
        )}
        <div className="flex items-center gap-1.5">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{title}</h1>
          {info && <InfoTip topic={title} text={info} width={400} />}
        </div>
        {subtitle && <p className={cn("text-sm text-muted mt-1 leading-relaxed [@media(max-height:500px)]:hidden", subtitleClassName)}>{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </header>
  );
}

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Link2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import { Popover } from "@/components/ui/popover";

const COPIED_MS = 2000;

/**
 * Copies a link that opens the dataset with the current settings. Without clipboard access
 * (plain http on another host) it shows the link in a field to copy by hand. For own data it
 * stays focusable but inactive, so its tooltip and description can say why.
 */
export function CopyLink({ query, className }: { query: string | null; className?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const reasonId = useId();
  const panelId = useId();
  const titleId = useId();

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    if (!query) return;
    const url = `${window.location.origin}${window.location.pathname}?${query}`;
    if (!navigator.clipboard) {
      setManual(url);
      return;
    }
    navigator.clipboard.writeText(url).then(
      () => setCopied(true),
      () => setManual(url),
    );
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={copy}
        aria-disabled={!query || undefined}
        aria-describedby={query ? undefined : reasonId}
        aria-label={t("factor.link.copy")}
        aria-expanded={manual !== null ? true : undefined}
        aria-controls={manual !== null ? panelId : undefined}
        title={query ? t("factor.link.copy_title") : t("factor.link.own_data")}
        className={className}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-success-ink" aria-hidden /> : <Link2 className="h-3.5 w-3.5" aria-hidden />}
        <span aria-hidden className="hidden sm:inline">
          {copied ? t("factor.link.copied_short") : t("factor.link.copy_short")}
        </span>
      </button>
      {!query && (
        <span id={reasonId} className="sr-only">
          {t("factor.link.own_data")}
        </span>
      )}
      <span role="status" className="sr-only">
        {copied ? t("factor.link.copied") : ""}
      </span>
      <Popover
        open={manual !== null}
        onClose={(refocus) => {
          setManual(null);
          if (refocus) buttonRef.current?.focus();
        }}
        anchor={buttonRef}
        title={t("factor.link.fallback_title")}
        titleId={titleId}
        id={panelId}
      >
        <p className="text-muted">{t("factor.link.fallback_hint")}</p>
        <input
          readOnly
          value={manual ?? ""}
          aria-label={t("factor.link.field_label")}
          onFocus={(e) => e.currentTarget.select()}
          className="h-8 w-full rounded-md bg-tile px-2 font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-accent/50"
        />
      </Popover>
    </>
  );
}

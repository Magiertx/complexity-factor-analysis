"use client";

// The button that copies a link to the analysis on screen.

import { useEffect, useId, useRef, useState } from "react";
import { Check, Link2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import { IconButton } from "@/components/ui/icon-button";
import { Popover } from "@/components/ui/popover";

/** How long "Copied" stays on the button, in ms. */
const COPIED_MS = 2000;

/**
 * Copies a link that opens the dataset with the current settings and on the step on screen.
 * Without clipboard access (plain http on another host) it shows the link in a field to copy by
 * hand. For own data it stays focusable but inactive, and its tooltip says why. A page that
 * links to something else than a dataset says what in `more`.
 */
export function CopyLink({ query, more }: { query: string | null; more?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
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
      <IconButton
        ref={buttonRef}
        icon={copied ? Check : Link2}
        name={t("factor.link.copy")}
        more={more ?? t("factor.link.copy_title")}
        reason={query ? null : t("factor.link.own_data")}
        onClick={copy}
        aria-expanded={manual !== null ? true : undefined}
        aria-controls={manual !== null ? panelId : undefined}
        className={copied ? "text-success-ink hover:text-success-ink" : undefined}
      />
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
          className="h-8 w-full rounded-md bg-tile px-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-accent/50"
        />
      </Popover>
    </>
  );
}

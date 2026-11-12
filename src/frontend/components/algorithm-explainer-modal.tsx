"use client";

// Modal with the explanation of one algorithm of the workbench.

import { useEffect } from "react";
import { X, ExternalLink, HelpCircle, BookOpen, Compass, Wrench } from "lucide-react";
import type { AlgorithmManifest } from "@/lib/api";
import { getExplanation } from "@/lib/algorithm-explanations";
import { useLocale, localizedAlgoDescription, localizedAlgoName } from "@/lib/i18n";

// Modal with a detailed explanation of an algorithm, opened from the `?`
// button next to the algorithm picker. The texts come from
// algorithm-explanations.tsx; for an algorithm without an entry there we
// fall back to the manifest's `description`.

/** The explanation dialog for `algo`; renders nothing while `algo` is null. Escape or a click on the backdrop calls `onClose`. */
export function AlgorithmExplainerModal({
  algo,
  onClose,
}: {
  algo: AlgorithmManifest | null;
  onClose: () => void;
}) {
  const { locale, t } = useLocale();

  // Escape closes the dialog while it is open.
  useEffect(() => {
    if (!algo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [algo, onClose]);

  if (!algo) return null;

  const explanation = getExplanation(algo.id, locale);
  const name = localizedAlgoName(algo, locale);
  // The part of the name before the dash is the title; the full name goes below it.
  const shortName = name.split(" — ")[0];

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="explainer-title"
    >
      <div className="absolute inset-0" onClick={onClose} aria-hidden />

      <div className="relative w-full max-w-2xl max-h-[85vh] rounded-lg bg-surface shadow-2xl ring-1 ring-border/70 overflow-hidden flex flex-col">
        <div className="flex items-start justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-10 w-10 rounded-md bg-tile text-muted grid place-items-center shrink-0">
              <HelpCircle className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 id="explainer-title" className="text-base font-semibold tracking-tight truncate">
                {shortName}
              </h2>
              <div className="text-xs text-muted mt-0.5 truncate">{name}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("algorithm_explainer.close_aria")}
            className="shrink-0 h-7 w-7 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-tile transition appearance-none"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5 text-sm leading-relaxed">
          {explanation ? (
            <>
              <Section icon={<BookOpen className="h-4 w-4" />} title={t("algorithm_explainer.section_what")}>
                {explanation.what}
              </Section>
              <Section icon={<Compass className="h-4 w-4" />} title={t("algorithm_explainer.section_how")}>
                {explanation.how}
              </Section>
              <Section icon={<Wrench className="h-4 w-4" />} title={t("algorithm_explainer.section_when")}>
                {explanation.whenToUse}
              </Section>
              {explanation.paramNotes && (
                <Section icon={<Wrench className="h-4 w-4" />} title={t("algorithm_explainer.section_params")}>
                  {explanation.paramNotes}
                </Section>
              )}
            </>
          ) : (
            <Section icon={<BookOpen className="h-4 w-4" />} title={t("algorithm_explainer.section_about")}>
              {localizedAlgoDescription(algo, locale) || (
                <span className="text-muted italic">
                  {t("algorithm_explainer.no_explanation")}
                </span>
              )}
            </Section>
          )}

          {(algo.paper_url || algo.author) && (
            <div className="pt-3 border-t border-border/40 text-xs text-muted space-y-1">
              {algo.author && <div>{t("algorithm_explainer.author_label", { name: algo.author })}</div>}
              {algo.paper_url && (
                <a
                  href={algo.paper_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-accent-ink hover:underline"
                >
                  {t("algorithm_explainer.paper_link")} <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** A headed block of the dialog. */
function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-muted">
        <span className="text-accent-ink">{icon}</span>
        {title}
      </h3>
      <div className="text-fg">{children}</div>
    </section>
  );
}

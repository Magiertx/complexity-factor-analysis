"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { APP_NAME } from "@/lib/app-config";
import { COMPARE_HREF } from "@/lib/compare";
import { useT } from "@/lib/i18n";
import { useBackToAnalysis } from "@/components/back-link";
import { PageHeader } from "@/components/page-header";

interface GuideSection {
  id: string;
  /** Paragraphs before the list, then the list, then the paragraphs after it. */
  before: number;
  items?: string[];
  /** The items are steps one after the other. */
  ordered?: boolean;
  after?: number;
  /** Where in the tool the section leads. */
  links: { href: string; key: string }[];
}

// The texts are in the locales under guide.<id>; docs/GUIDE.md has the same guide in English.
const SECTIONS: GuideSection[] = [
  {
    id: "steps",
    before: 3,
    links: [
      { href: "/", key: "model" },
      { href: "/log", key: "log" },
    ],
  },
  {
    id: "bundled",
    before: 0,
    items: ["open", "choose", "settings"],
    ordered: true,
    after: 1,
    links: [{ href: "/?bundled=comfy-paper-inductive-miner&preset=published", key: "paper" }],
  },
  {
    id: "own",
    before: 1,
    items: ["logs", "nets", "csv"],
    after: 4,
    links: [
      { href: "/", key: "data" },
      { href: "/runs", key: "history" },
    ],
  },
  {
    id: "results",
    before: 0,
    items: ["dataset", "suitability", "correlations", "sheet", "factors", "loadings", "names", "interpretation"],
    links: [{ href: "/?step=dataset", key: "results" }],
  },
  {
    id: "compare",
    before: 1,
    items: ["columns", "own", "rule", "matrix", "dimensions", "pairs", "export"],
    after: 1,
    links: [{ href: COMPARE_HREF, key: "compare" }],
  },
  {
    id: "export",
    before: 1,
    items: ["zip", "report", "print", "tables"],
    after: 3,
    links: [{ href: "/?step=loadings", key: "loadings" }],
  },
  {
    id: "api",
    before: 1,
    links: [{ href: "/api-access", key: "api" }],
  },
];

/**
 * The user guide in the language of the UI: the tasks of the tool in a few sections, each with a
 * way to the place in the tool it describes. Reached by Guide in the header.
 */
export function GuideView() {
  const t = useT();
  const back = useBackToAnalysis();
  const paragraphs = (id: string, from: number, n: number) =>
    Array.from({ length: n }, (_, i) => (
      <p key={`${id}-p${from + i}`} className="text-sm leading-relaxed text-fg/90">
        {t(`guide.${id}.p${from + i}`, { app: APP_NAME })}
      </p>
    ));
  return (
    <div className="space-y-8 max-w-3xl">
      <PageHeader title={t("guide.title")} subtitle={t("guide.subtitle", { app: APP_NAME })} back={back} />

      <nav aria-label={t("guide.toc")} className="rounded-lg bg-tile/60 px-4 py-3">
        <h2 className="text-xs font-semibold text-muted mb-1.5">{t("guide.toc")}</h2>
        <ol className="grid gap-1 sm:grid-cols-2 text-sm list-decimal pl-5">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#guide-${s.id}`}
                className="rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {t(`guide.${s.id}.title`)}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {SECTIONS.map((s) => (
        <section key={s.id} id={`guide-${s.id}`} aria-labelledby={`guide-${s.id}-title`} className="space-y-3 scroll-mt-6">
          <h2 id={`guide-${s.id}-title`} className="text-base font-semibold tracking-tight">
            {t(`guide.${s.id}.title`)}
          </h2>
          {paragraphs(s.id, 1, s.before)}
          {s.items &&
            (() => {
              const items = s.items.map((item) => <li key={item}>{t(`guide.${s.id}.items.${item}`, { app: APP_NAME })}</li>);
              const list = "space-y-1.5 text-sm leading-relaxed text-fg/90 pl-5";
              // A task is a sequence of steps; the other lists name things side by side.
              return s.ordered ? <ol className={`${list} list-decimal`}>{items}</ol> : <ul className={`${list} list-disc`}>{items}</ul>;
            })()}
          {paragraphs(s.id, s.before + 1, s.after ?? 0)}
          <p className="flex gap-x-4 gap-y-1 flex-wrap text-sm">
            {s.links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="inline-flex items-center gap-1 rounded text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {t(`guide.links.${l.key}`)}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            ))}
          </p>
        </section>
      ))}
    </div>
  );
}

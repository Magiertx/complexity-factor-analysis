"use client";

import { useEffect, useState, type ComponentType } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  ChartScatter,
  ClipboardList,
  Columns3,
  Combine,
  Database,
  Download,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Grid3x3,
  LayoutGrid,
  ListChecks,
  ListOrdered,
  Network,
  Package,
  Pencil,
  Pin,
  Printer,
  ScrollText,
  Shuffle,
  Upload,
} from "lucide-react";
import { APP_NAME } from "@/lib/app-config";
import { COMPARE_HREF } from "@/lib/compare";
import { sentence, splitTerm } from "@/lib/guide";
import { useT, useTMaybe } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useBackToAnalysis } from "@/components/back-link";
import { STEP_ICONS } from "@/components/factor-analysis/step-nav";
import { PageHeader } from "@/components/page-header";
import { buttonClass } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { ScrollFade } from "@/components/ui/scroll-fade";

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

interface GuideItem {
  id: string;
  /** In the list of results: the item is a step of the analysis, with the sign of the step rail. */
  step?: boolean;
  icon?: Icon;
}

interface GuideSection {
  id: string;
  icon: Icon;
  /** How the items are laid out: steps one after the other, the results of the analysis one under the other, or tiles. */
  layout?: "stepper" | "results" | "tiles";
  /** Paragraphs before the items, the first of them the lead, then the items, then the paragraphs after them. */
  before: number;
  items?: GuideItem[];
  after?: number;
  /** Where in the tool the section leads. */
  links: { href: string; key: string }[];
}

// The texts are in the locales under guide.<id>; docs/GUIDE.md has the same guide in English. The icons
// of the items are those of the places in the app that the item describes.
const SECTIONS: GuideSection[] = [
  {
    id: "steps",
    icon: ListOrdered,
    before: 3,
    links: [
      { href: "/", key: "model" },
      { href: "/log", key: "log" },
    ],
  },
  {
    id: "bundled",
    icon: Package,
    layout: "stepper",
    before: 0,
    items: [{ id: "open" }, { id: "choose" }, { id: "settings" }],
    after: 1,
    links: [{ href: "/?bundled=comfy-paper-inductive-miner&preset=published", key: "paper" }],
  },
  {
    id: "own",
    icon: Upload,
    layout: "tiles",
    before: 1,
    items: [
      { id: "logs", icon: ScrollText },
      { id: "nets", icon: Network },
      { id: "csv", icon: FileSpreadsheet },
    ],
    after: 4,
    links: [
      { href: "/", key: "data" },
      { href: "/runs", key: "history" },
    ],
  },
  {
    id: "results",
    icon: BookOpenCheck,
    layout: "results",
    before: 0,
    items: [
      { id: "dataset", step: true, icon: STEP_ICONS.dataset },
      { id: "suitability", step: true, icon: STEP_ICONS.suitability },
      { id: "correlations", icon: ChartScatter },
      { id: "sheet", icon: ClipboardList },
      { id: "factors", step: true, icon: STEP_ICONS.factors },
      { id: "loadings", step: true, icon: STEP_ICONS.loadings },
      { id: "stability", icon: Shuffle },
      { id: "short_set", icon: ListChecks },
      { id: "names", icon: Pencil },
      { id: "interpretation", step: true, icon: STEP_ICONS.interpretation },
    ],
    links: [{ href: "/?step=dataset", key: "results" }],
  },
  {
    id: "compare",
    icon: Columns3,
    layout: "tiles",
    before: 1,
    items: [
      { id: "columns", icon: Database },
      { id: "own", icon: Pin },
      { id: "rule", icon: ListChecks },
      { id: "matrix", icon: Grid3x3 },
      { id: "dimensions", icon: LayoutGrid },
      { id: "pairs", icon: Combine },
      { id: "export", icon: Download },
    ],
    after: 1,
    links: [{ href: COMPARE_HREF, key: "compare" }],
  },
  {
    id: "export",
    icon: Download,
    layout: "tiles",
    before: 1,
    items: [
      { id: "zip", icon: FileArchive },
      { id: "report", icon: FileText },
      { id: "print", icon: Printer },
      { id: "tables", icon: FileSpreadsheet },
    ],
    after: 3,
    links: [{ href: "/?step=loadings", key: "loadings" }],
  },
];

const IDS = SECTIONS.map((s) => s.id);

/**
 * The section being read: the one that crosses a band near the top of the window, the first of them
 * where two do. A click on the table of contents sets it at once.
 */
function useCurrentSection(): [string, (id: string) => void] {
  const [current, setCurrent] = useState(IDS[0]);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const inBand = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id.replace(/^guide-/, "");
          if (entry.isIntersecting) inBand.add(id);
          else inBand.delete(id);
        }
        const first = IDS.find((id) => inBand.has(id));
        if (first) setCurrent(first);
      },
      { rootMargin: "-10% 0px -70% 0px" },
    );
    for (const id of IDS) {
      const el = document.getElementById(`guide-${id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);
  return [current, setCurrent];
}

/**
 * The table of contents: a column beside the guide from `lg` on, which follows the page, with a thin
 * accent bar at the section being read; below that a row of chips that scrolls sideways.
 */
function Contents({ current, onPick }: { current: string; onPick: (id: string) => void }) {
  const t = useT();
  return (
    <nav aria-label={t("guide.toc")} className="min-w-0 lg:sticky lg:top-6">
      <p className="mb-2 hidden text-xs font-semibold text-muted lg:block">{t("guide.toc")}</p>
      <ScrollFade className="lg:overflow-visible">
        <ol className="flex w-max gap-1.5 lg:w-auto lg:flex-col lg:gap-0 lg:border-l lg:border-border">
          {SECTIONS.map((s) => {
            const active = s.id === current;
            return (
              <li key={s.id} className="shrink-0">
                <a
                  href={`#guide-${s.id}`}
                  aria-current={active ? "location" : undefined}
                  onClick={() => onPick(s.id)}
                  className={cn(
                    "inline-flex min-h-8 items-center gap-2 rounded-md px-3 text-sm whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    "lg:flex lg:-ml-px lg:rounded-none lg:rounded-r-md lg:border-l-2 lg:py-1.5 lg:whitespace-normal",
                    active
                      ? "bg-tile font-medium text-fg lg:border-accent lg:bg-transparent"
                      : "text-muted hover:bg-tile hover:text-fg lg:border-transparent lg:hover:bg-transparent",
                  )}
                >
                  <s.icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span>{t(`guide.${s.id}.title`)}</span>
                </a>
              </li>
            );
          })}
        </ol>
      </ScrollFade>
    </nav>
  );
}

/** The sign of an item on a neutral tile in the muted colour (docs/UI.md). */
function Sign({ icon: Icon, className }: { icon: Icon; className?: string }) {
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center bg-tile text-muted", className)}>
      <Icon className="h-4 w-4" />
    </span>
  );
}

/** The steps of a task in the manner of the analysis stepper: a round numbered marker per step and a thin line to the next. */
function Stepper({ items, term, text }: { items: GuideItem[]; term: (item: GuideItem) => string; text: (item: GuideItem) => string }) {
  return (
    <ol role="list" className="grid gap-5 md:grid-cols-3 md:gap-6">
      {items.map((item, i) => (
        <li key={item.id} className="relative flex gap-3 md:block">
          {i < items.length - 1 && (
            <span
              aria-hidden
              className="absolute left-[13px] top-8 -bottom-4 w-px bg-border md:bottom-auto md:left-[34px] md:-right-[18px] md:top-[13px] md:h-px md:w-auto"
            />
          )}
          <span
            aria-hidden
            className="relative grid h-7 w-7 shrink-0 place-items-center rounded-full bg-tile text-xs font-semibold tabular-nums text-fg"
          >
            {i + 1}
          </span>
          <div className="min-w-0 md:mt-3">
            <h3 className="text-sm font-semibold leading-7 md:leading-snug">{term(item)}</h3>
            <p className="mt-0.5 text-sm leading-relaxed text-fg/90">{text(item)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * The results of the analysis one under the other, each with the sign of its step in the step rail; what
 * is not a step but belongs to one (the correlation map, the fact sheet, the names) has a smaller sign.
 */
function Results({ items, term, text }: { items: GuideItem[]; term: (item: GuideItem) => string; text: (item: GuideItem) => string }) {
  return (
    <ol role="list">
      {items.map((item, i) => (
        <li key={item.id} className="relative flex gap-3 pb-5 last:pb-0">
          {i < items.length - 1 && <span aria-hidden className="absolute left-4 top-8 bottom-1 w-px -translate-x-1/2 bg-border" />}
          <span className="grid h-8 w-8 shrink-0 place-items-center">
            {item.icon && <Sign icon={item.icon} className={item.step ? "h-8 w-8 rounded-full" : "h-6 w-6 rounded-full [&>svg]:h-3.5 [&>svg]:w-3.5"} />}
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-8">{term(item)}</h3>
            <p className="-mt-1 text-sm leading-relaxed text-fg/90">{text(item)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Things side by side: a small tile each, with its term and what it is. The tiles flow down two columns
 * from `sm` on, so a long text next to a short one leaves no empty tile.
 */
function Tiles({ items, term, text }: { items: GuideItem[]; term: (item: GuideItem) => string; text: (item: GuideItem) => string }) {
  return (
    <ul role="list" className="-mb-3 sm:columns-2 sm:gap-3">
      {items.map((item) => (
        <li key={item.id} className="mb-3 break-inside-avoid rounded-lg bg-tile/60 p-3.5">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            {item.icon && <item.icon className="h-4 w-4 shrink-0 text-muted" aria-hidden />}
            {term(item)}
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-fg/90">{text(item)}</p>
        </li>
      ))}
    </ul>
  );
}

/**
 * The user guide in the language of the UI: the tasks of the tool in a few sections, each a card with a
 * lead line, its items, a note on the rest and the ways to the place in the tool it describes. Reached by
 * Guide in the header.
 */
export function GuideView() {
  const t = useT();
  const tMaybe = useTMaybe();
  const back = useBackToAnalysis();
  const [current, setCurrent] = useCurrentSection();
  const paragraph = (id: string, n: number) => (
    <p key={`${id}-p${n}`}>{t(`guide.${id}.p${n}`, { app: APP_NAME })}</p>
  );
  return (
    // As wide as the header (logo to settings), like the pages of the tabs; the running text keeps
    // a line length that reads well.
    <div className="space-y-6">
      <PageHeader title={t("guide.title")} subtitle={t("guide.subtitle", { app: APP_NAME })} back={back} />

      <div className="space-y-6 lg:grid lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:items-start lg:gap-8 lg:space-y-0">
        <Contents current={current} onPick={setCurrent} />

        <div className="min-w-0 space-y-6">
          {SECTIONS.map((s) => {
            // An item names its term in its own text, or under terms.<item> where it does not.
            const split = (item: GuideItem) => {
              const text = t(`guide.${s.id}.items.${item.id}`, { app: APP_NAME });
              const own = tMaybe(`guide.${s.id}.terms.${item.id}`);
              if (own) return { term: own, body: text };
              const parts = splitTerm(text);
              return parts ? { term: parts.term, body: sentence(parts.body) } : { term: text, body: "" };
            };
            const term = (item: GuideItem) => split(item).term;
            const text = (item: GuideItem) => split(item).body;
            // The lead is the paragraph before the items; those after them, and the rest, are for the note.
            const rest = [
              ...Array.from({ length: Math.max(s.before - 1, 0) }, (_, i) => 2 + i),
              ...Array.from({ length: s.after ?? 0 }, (_, i) => s.before + 1 + i),
            ];
            return (
              <section key={s.id} id={`guide-${s.id}`} aria-labelledby={`guide-${s.id}-title`} className="scroll-mt-6">
                <Card>
                  <CardHeader className="flex items-center gap-3">
                    <Sign icon={s.icon} className="h-8 w-8 rounded-md" />
                    <CardTitle id={`guide-${s.id}-title`}>{t(`guide.${s.id}.title`)}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    {s.before > 0 && <p className="max-w-[80ch] text-base leading-relaxed">{t(`guide.${s.id}.p1`, { app: APP_NAME })}</p>}
                    {s.items && s.layout === "stepper" && <Stepper items={s.items} term={term} text={text} />}
                    {s.items && s.layout === "results" && <Results items={s.items} term={term} text={text} />}
                    {s.items && s.layout === "tiles" && <Tiles items={s.items} term={term} text={text} />}
                    {rest.length > 0 && (
                      <Notice title={t("guide.note")}>
                        <div className="max-w-[80ch] space-y-2 leading-relaxed">{rest.map((n) => paragraph(s.id, n))}</div>
                      </Notice>
                    )}
                  </CardContent>
                  <CardFooter className="flex flex-wrap gap-2">
                    {s.links.map((l) => (
                      <Link key={l.href} href={l.href} className={buttonClass("secondary", "sm", "h-auto min-h-8 py-1.5 text-left")}>
                        {t(`guide.links.${l.key}`)}
                        <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      </Link>
                    ))}
                  </CardFooter>
                </Card>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

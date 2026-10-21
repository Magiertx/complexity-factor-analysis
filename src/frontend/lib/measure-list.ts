// The list of measures in step 3: what became of each measure, and how the list is shown. Sorting,
// grouping and searching only change what the list shows: the order of the dataset's columns, on
// which the KMO of singular data depends, and the measures excluded by hand stay as they are.

import type { FactorAnalysis } from "./api";
import { analysisNotices, type AnalysisOptions } from "./factor-analysis";

/** What became of a measure in the analysis on screen. */
export type MeasureStatus = "used" | "removed" | "dependent" | "below" | "excluded" | "pending";

/** Statuses worth a look: the list shows these measures first. */
export const NOTABLE: readonly MeasureStatus[] = ["removed", "dependent", "below"];

export interface MeasureInfo {
  status: MeasureStatus;
  /** The MSA of the analysis, or the one at which the filter removed the measure. */
  msa: number | null;
  /** The round of the MSA filter that removed the measure. */
  round?: number;
  /** The other measures of its linearly dependent group. */
  partners?: string[];
}

/**
 * The groups of linearly dependent measures that the analysis names in its notice on a singular
 * correlation matrix ("a, b; c, d").
 */
export function dependentGroups(analysis: FactorAnalysis | null): string[][] {
  if (!analysis) return [];
  const notice = analysisNotices(analysis).find((n) => n.code === "singular");
  const groups = notice?.params.groups;
  if (typeof groups !== "string" || !groups.trim()) return [];
  return groups
    .split(";")
    .map((g) => g.split(",").map((m) => m.trim()).filter(Boolean))
    .filter((g) => g.length > 0);
}

/** What became of every measure of the dataset, by measure. */
export function measureInfo(
  measures: string[],
  analysis: FactorAnalysis | null,
  options: Pick<AnalysisOptions, "excluded" | "msa_threshold">,
): Map<string, MeasureInfo> {
  const excluded = new Set(options.excluded);
  const removed = new Map((analysis?.msa_filter.removed ?? []).map((r) => [r.measure, r]));
  const partners = new Map<string, string[]>();
  for (const group of dependentGroups(analysis)) {
    for (const m of group) partners.set(m, group.filter((x) => x !== m));
  }
  const threshold = analysis?.kmo.threshold ?? options.msa_threshold;
  const out = new Map<string, MeasureInfo>();
  for (const m of measures) {
    const filtered = removed.get(m);
    const msa = analysis?.kmo.per_measure[m] ?? filtered?.msa ?? null;
    if (excluded.has(m)) out.set(m, { status: "excluded", msa: null });
    else if (!analysis) out.set(m, { status: "pending", msa: null });
    else if (filtered) out.set(m, { status: "removed", msa, round: filtered.step });
    else if (partners.has(m)) out.set(m, { status: "dependent", msa, partners: partners.get(m) });
    else if (msa !== null && msa < threshold) out.set(m, { status: "below", msa });
    else out.set(m, { status: "used", msa });
  }
  return out;
}

export function isNotable(info: MeasureInfo | undefined): boolean {
  return !!info && NOTABLE.includes(info.status);
}

/** From this many measures on, a list can be searched, narrowed to the notable ones and folded. */
export const LONG_LIST = 20;

/** Whether a measure matches a search: each of its words is in the measure's name or key, in any case. */
export function matchesQuery(query: string, name: string, key: string): boolean {
  const text = `${name} ${key}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => text.includes(w));
}

export type MeasureSort = "dataset" | "name" | "msa";
export type MeasureGrouping = "none" | "group";

export interface ArrangeInput {
  /** The dataset's measures, in the order of its columns. */
  measures: readonly string[];
  info: Map<string, MeasureInfo>;
  name: (key: string) => string;
  /** The group of a measure (e.g. its feeed group), or null. */
  group: (key: string) => string | null;
  /** The groups in the order to show them. */
  groupOrder: readonly string[];
  sort: MeasureSort;
  grouping: MeasureGrouping;
  /** Words that the name or the key of a measure must all contain, in any case. */
  query: string;
  onlyNotable: boolean;
  /**
   * The measures shown among the notable ones. Kept by the caller while the list is in use, so a
   * measure that stops being notable (excluded, say) stays in place instead of moving away from
   * under the pointer.
   */
  notable: ReadonlySet<string>;
}

/** A part of the list: the notable measures, the other ones, all of them, or one group. */
export interface MeasureSection {
  id: "notable" | "other" | "all" | `group:${string}`;
  /** The group of a `group:` section; null for measures without a group. */
  group?: string | null;
  rows: string[];
}

/** The sections and rows of the list. Never changes `measures` or anything in `info`. */
export function arrangeMeasures(input: ArrangeInput): MeasureSection[] {
  const { measures, info, name, sort, grouping, notable } = input;
  const matches = (m: string) => matchesQuery(input.query, name(m), m);
  const index = new Map(measures.map((m, i) => [m, i]));
  const compare = (a: string, b: string) => {
    if (sort === "name") return name(a).localeCompare(name(b)) || index.get(a)! - index.get(b)!;
    if (sort === "msa") {
      const x = info.get(a)?.msa ?? null;
      const y = info.get(b)?.msa ?? null;
      if (x === null || y === null) return x === y ? index.get(a)! - index.get(b)! : x === null ? 1 : -1;
      return x - y || index.get(a)! - index.get(b)!;
    }
    return index.get(a)! - index.get(b)!;
  };
  let shown = measures.filter(matches);
  if (input.onlyNotable) shown = shown.filter((m) => notable.has(m));
  const sorted = (rows: string[]) => [...rows].sort(compare);

  if (grouping === "group") {
    const byGroup = new Map<string | null, string[]>();
    for (const m of shown) {
      const g = input.group(m);
      byGroup.set(g, [...(byGroup.get(g) ?? []), m]);
    }
    const order = [...input.groupOrder.filter((g) => byGroup.has(g)), ...[...byGroup.keys()].filter((g) => g !== null && !input.groupOrder.includes(g))];
    const sections: MeasureSection[] = order.map((g) => ({ id: `group:${g}`, group: g, rows: sorted(byGroup.get(g) ?? []) }));
    if (byGroup.has(null)) sections.push({ id: "group:", group: null, rows: sorted(byGroup.get(null) ?? []) });
    return sections;
  }
  const first = shown.filter((m) => notable.has(m));
  if (input.onlyNotable || first.length === 0 || first.length === shown.length) {
    return [{ id: input.onlyNotable ? "notable" : "all", rows: sorted(shown) }];
  }
  return [
    { id: "notable", rows: sorted(first) },
    { id: "other", rows: sorted(shown.filter((m) => !notable.has(m))) },
  ];
}

/** The measures excluded by hand with `measure` ticked or unticked; the others keep their order. */
export function toggleExcluded(excluded: readonly string[], measure: string): string[] {
  return excluded.includes(measure) ? excluded.filter((m) => m !== measure) : [...excluded, measure];
}

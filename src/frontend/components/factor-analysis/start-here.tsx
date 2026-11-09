import type { FactorKind } from "@/lib/api";
import { COMPARE_HREF, COMPARE_K4_K6_HREF } from "@/lib/compare";

/** The settings a bundled dataset opens with: the tool's standard, or those of its paper. */
export type OpenPreset = "standard" | "published";

/**
 * An entry of "Get started", the shortest ways into the tool for someone with little time, such as
 * a reviewer: a bundled dataset with given settings, opened on a tab, or a comparison. They head the
 * cards of the bundled source in the data step; a load from one of them offers its result.
 */
export interface StartEntry {
  id: string;
  /** Where it opens: an analysis tab, or the comparison. */
  to: FactorKind | "compare";
  /** The bundled dataset an analysis opens, and with which settings. */
  bundledId?: string;
  preset?: OpenPreset;
  /** The address of a comparison. */
  href?: string;
  /** Where its data come from, as a small link on its card: the paper, or the repository of the log measures. */
  source?: "paper" | "repo";
}

/** Important Factors: Complexity Dimensions for Petri Nets (ATAED 2026), the paper of the model datasets. */
export const IMPORTANT_FACTORS_URL = "https://ceur-ws.org/Vol-4236/paper14.pdf";

/**
 * Entries that need features still to come stay in the list, unavailable, so they are switched on
 * in one place.
 */
const ENTRIES: (StartEntry & { available: boolean })[] = [
  { id: "if_inductive", to: "model", bundledId: "comfy-paper-inductive-miner", preset: "published", source: "paper", available: true },
  { id: "log_standard", to: "log", bundledId: "comfy-log-pdc-training-logs", preset: "standard", source: "repo", available: true },
  { id: "if_four_miners", to: "compare", href: COMPARE_HREF, source: "paper", available: true },
  { id: "if_k4_k6", to: "compare", href: COMPARE_K4_K6_HREF, source: "paper", available: true },
  { id: "log_paper", to: "log", available: false },
];

/**
 * The entries on a tab: on the log tab only the analyses of log measures; the model tab, where the
 * app opens, has every way in, and an entry for the other tab opens it there.
 */
export function startEntries(kind: FactorKind): StartEntry[] {
  return ENTRIES.filter((e) => e.available && (kind === "model" || e.to === kind));
}

/**
 * The address an entry for another tab opens: the dataset with its settings, loaded on the data step
 * of that tab (step=data), which then offers the result as a load from Get started does.
 */
export function startEntryHref(entry: StartEntry): string | null {
  if (entry.href) return entry.href;
  if (!entry.bundledId || entry.to === "compare") return null;
  const path = entry.to === "log" ? "/log" : "/";
  return `${path}?bundled=${entry.bundledId}&preset=${entry.preset ?? "standard"}&step=data`;
}

/** A small synthetic table in the format of an own CSV upload. */
export const EXAMPLE_CSV = "/examples/example-measures.csv";

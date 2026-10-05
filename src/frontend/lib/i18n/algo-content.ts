// Locale overlay for backend-provided algorithm content. The manifest
// (GET /algorithms) ships English `description` and per-parameter `help`
// strings; this module returns the German translation when the UI locale is
// "de" and an entry exists, falling back to the English original otherwise.
// Algorithm names and parameter labels are intentionally NOT translated
// (project translation policy: process-mining vocabulary stays English).

import type { Locale } from "./provider";
import { ALGO_CONTENT_DE } from "./algo-content.de";

export interface AlgoContentOverride {
  /** German translation of the manifest `description`. */
  description?: string;
  /** German translations of `ParameterSpec.help`, keyed by parameter `name`. */
  params?: Record<string, string>;
}

export type AlgoContentMap = Record<string, AlgoContentOverride>;

export function localizedAlgoDescription(
  algo: { id: string; description?: string | null },
  locale: Locale,
): string {
  if (locale === "de") {
    const d = ALGO_CONTENT_DE[algo.id]?.description;
    if (d) return d;
  }
  return algo.description ?? "";
}

export function localizedParamHelp(
  algorithmId: string | undefined,
  spec: { name: string; help?: string | null },
  locale: Locale,
): string | undefined {
  if (locale === "de" && algorithmId) {
    const h = ALGO_CONTENT_DE[algorithmId]?.params?.[spec.name];
    if (h) return h;
  }
  return spec.help ?? undefined;
}

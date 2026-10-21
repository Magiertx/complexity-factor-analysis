// Short codes of the measures, as the papers print them (CNC, dens, C_mag, ...). A view setting:
// the switch in the toolbar shows them in the lists, the loadings, the figures and the LaTeX
// report; the full name is always in the tooltip. The codes come from the catalog
// (src/AlgoService/factor_analysis/short_codes.py).

import type { FactorKind, FactorMeasure } from "./api";

const STORAGE_KEY = "app.factor-short-codes";

/** The code of every measure of the catalog that has one, by its key. */
export function codesOf(measures: readonly FactorMeasure[]): Map<string, string> {
  return new Map(measures.filter((m) => m.short).map((m) => [m.key, m.short as string]));
}

/** Whether a code would change how any of these measures is shown. */
export function hasCodes(codes: ReadonlyMap<string, string>, measures: readonly string[]): boolean {
  return measures.some((m) => codes.has(m));
}

export interface MeasureLabels {
  /** What a list or table shows for the measure. */
  name: (key: string) => string;
  /** Its tooltip: with codes shown, the full name ahead of what it measures. */
  description: (key: string) => string | undefined;
}

/**
 * How measures are named on screen. With `on`, a measure with a code is shown by it, and its
 * tooltip starts with the name it stands for; a measure without one keeps its name.
 */
export function measureLabels(
  names: ReadonlyMap<string, string>,
  descriptions: ReadonlyMap<string, string | undefined>,
  codes: ReadonlyMap<string, string>,
  on: boolean,
): MeasureLabels {
  const full = (key: string) => names.get(key) ?? key;
  return {
    name: (key) => (on && codes.get(key)) || full(key),
    description: (key) => {
      const what = descriptions.get(key) || undefined;
      if (!on || !codes.has(key)) return what;
      return what ? `${full(key)}: ${what}` : full(key);
    },
  };
}

const NO_INDEXES: ReadonlyMap<string, string> = new Map();

/**
 * The log measures that are shown by their code and that the papers write with the code as an
 * index, C with "mag" below it. Keyed by the text shown, which MeasureName sets this way, so that
 * the lists, the loadings, the figures and the report agree. Model measures are written plain
 * (CNC), as are the names; nothing is set while the codes are off.
 */
export function codeIndexes(
  kind: FactorKind,
  codes: ReadonlyMap<string, string>,
  on: boolean,
): ReadonlyMap<string, string> {
  if (!on || kind !== "log") return NO_INDEXES;
  return new Map([...codes.values()].map((code) => [code, code]));
}

/** The setting as chosen last in this browser; off by default. */
export function loadShortCodes(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveShortCodes(on: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* storage blocked: the setting lasts for the page */
  }
}

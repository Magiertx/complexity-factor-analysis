// The steps of the factor analysis tabs and their place in the address: one step per view,
// ?step=suitability, with the data step as the default that needs no parameter.

export type StepId = "data" | "dataset" | "suitability" | "factors" | "loadings" | "interpretation";
export type StepState = "locked" | "active" | "done" | "warn" | "busy";

export const STEP_IDS: StepId[] = ["data", "dataset", "suitability", "factors", "loadings", "interpretation"];

/** The id of a step's section, also the anchor of the one-page layout before (#fa-step-loadings). */
export function stepAnchor(id: StepId) {
  return `fa-step-${id}`;
}

/** The step a ?step= value names, or null. */
export function parseStep(value: string | null | undefined): StepId | null {
  return STEP_IDS.find((s) => s === value) ?? null;
}

/** The step an anchor of the one-page layout names, e.g. "#fa-step-loadings", or null. */
export function stepFromHash(hash: string): StepId | null {
  const m = /^#fa-step-([a-z]+)$/.exec(hash);
  return m ? parseStep(m[1]) : null;
}

/**
 * The address of a step on the page at `pathname` with the query `search`: the other parameters
 * stay, the anchor goes, and the data step has no parameter of its own.
 */
export function stepHref(pathname: string, search: string, step: StepId): string {
  const params = new URLSearchParams(search);
  if (step === "data") params.delete("step");
  else params.set("step", step);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** The step before and after `step`, if any. */
export function neighbours(step: StepId): { previous: StepId | null; next: StepId | null } {
  const i = STEP_IDS.indexOf(step);
  return { previous: STEP_IDS[i - 1] ?? null, next: STEP_IDS[i + 1] ?? null };
}

/**
 * The step of each control a chip of the settings row leads to, so a chip opens that step first.
 * The keys are the ids of the chips (`SettingChip["id"]`).
 */
export const CONTROL_STEPS = {
  measures: "suitability",
  msa: "suitability",
  alpha: "suitability",
  factors: "factors",
  rotation: "factors",
  loading: "loadings",
  communality: "loadings",
  rule: "loadings",
} as const satisfies Record<string, StepId>;

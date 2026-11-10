/**
 * Which model and effort an interpretation is asked for or shown from. With a key on the server
 * the choice is the lists the server offers; without one only what is stored for the analysis
 * on screen can be shown.
 */

export interface InterpretationChoice {
  model: string;
  effort: string;
}

/** A model and effort an interpretation of the analysis on screen is stored for. */
export interface StoredVariant extends InterpretationChoice {
  precomputed: boolean;
}

/** The part of the server status the choice needs. */
export interface ChoiceStatus {
  available: boolean;
  model: string | null;
  effort?: string;
  models?: string[];
  efforts?: string[];
}

export const CHOICE_KEY = "app.interpretation-choice";

/** Order efforts are listed in, whatever order the server sends them. */
const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max"];

const MODEL_NAMES: Record<string, string> = {
  "claude-opus-5-5": "Opus 5.5",
  "claude-sonnet-5-5": "Sonnet 5.5",
};

/** A short name for a model id; an unknown model keeps its id. */
export function modelLabel(id: string): string {
  return MODEL_NAMES[id] ?? id;
}

export function choiceKey(choice: InterpretationChoice | null): string {
  return choice ? `${choice.model}|${choice.effort}` : "";
}

export function isStored(variants: StoredVariant[], choice: InterpretationChoice): boolean {
  return variants.some((v) => v.model === choice.model && v.effort === choice.effort);
}

/** What the server uses when the request names neither: its default model and effort. */
export function defaultChoice(status: ChoiceStatus): InterpretationChoice | null {
  const model = status.model ?? status.models?.[0] ?? null;
  const effort = status.effort ?? null;
  return model && effort ? { model, effort } : null;
}

function sortEfforts(efforts: string[]): string[] {
  const rank = (e: string) => {
    const i = EFFORT_ORDER.indexOf(e);
    return i < 0 ? EFFORT_ORDER.length : i;
  };
  return [...new Set(efforts)].sort((a, b) => rank(a) - rank(b));
}

/** Models that can be chosen, in the order of the server (without a key: of the stored ones). */
export function modelOptions(status: ChoiceStatus, variants: StoredVariant[]): string[] {
  return status.available ? (status.models ?? []) : [...new Set(variants.map((v) => v.model))];
}

/**
 * Efforts that can be chosen for `model`: the ones the server offers, or, without a key, the
 * ones stored for that model.
 */
export function effortOptions(status: ChoiceStatus, variants: StoredVariant[], model: string): string[] {
  return status.available
    ? sortEfforts(status.efforts ?? [])
    : sortEfforts(variants.filter((v) => v.model === model).map((v) => v.effort));
}

function allowed(status: ChoiceStatus, variants: StoredVariant[], choice: InterpretationChoice): boolean {
  return status.available
    ? !!status.models?.includes(choice.model) && !!status.efforts?.includes(choice.effort)
    : isStored(variants, choice);
}

/**
 * The choice in force: `wanted` (what the visitor picked or kept from earlier) if it is
 * offered, else the server's default if that is offered, else, without a key, the first stored
 * variant. Null while the status is unknown or when nothing can be chosen.
 */
export function resolveChoice(
  status: ChoiceStatus | null,
  variants: StoredVariant[],
  wanted: InterpretationChoice | null,
): InterpretationChoice | null {
  if (!status) return null;
  if (wanted && allowed(status, variants, wanted)) return wanted;
  const fallback = defaultChoice(status);
  if (fallback && allowed(status, variants, fallback)) return fallback;
  if (!status.available) {
    const first = [...variants].sort(
      (a, b) => modelOptions(status, variants).indexOf(a.model) - modelOptions(status, variants).indexOf(b.model),
    )[0];
    return first ? { model: first.model, effort: first.effort } : null;
  }
  return null;
}

/**
 * The choice after picking `model`. The effort stays if the model offers it; otherwise the
 * server's default effort, otherwise the first one offered.
 */
export function withModel(
  status: ChoiceStatus,
  variants: StoredVariant[],
  current: InterpretationChoice,
  model: string,
): InterpretationChoice {
  const efforts = effortOptions(status, variants, model);
  if (efforts.includes(current.effort)) return { model, effort: current.effort };
  const effort = status.effort && efforts.includes(status.effort) ? status.effort : (efforts[0] ?? current.effort);
  return { model, effort };
}

export function readChoice(): InterpretationChoice | null {
  try {
    const raw = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? "null");
    return raw && typeof raw.model === "string" && typeof raw.effort === "string"
      ? { model: raw.model, effort: raw.effort }
      : null;
  } catch {
    return null;
  }
}

export function saveChoice(choice: InterpretationChoice): void {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(choice));
  } catch {
    // Remembered for this page only.
  }
}

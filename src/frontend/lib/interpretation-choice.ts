/**
 * Which model and effort an interpretation is asked for or shown from. With a key on the server
 * the choice is the lists the server offers, plus whatever is stored for the analysis on screen
 * (it is served without a call); without a key only what is stored can be shown.
 */

/** A model and an effort. */
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

/** localStorage key of the remembered choice. */
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

/** The choice as one string, empty for none; for comparing and as a key. */
export function choiceKey(choice: InterpretationChoice | null): string {
  return choice ? `${choice.model}|${choice.effort}` : "";
}

/** Whether an interpretation is stored for this choice. */
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

/**
 * Models that can be chosen, in the order of the server, then the other stored ones: they are
 * served without a call, whatever the server offers. Without a key: the stored ones.
 */
export function modelOptions(status: ChoiceStatus, variants: StoredVariant[]): string[] {
  const stored = variants.map((v) => v.model);
  return [...new Set(status.available ? [...(status.models ?? []), ...stored] : stored)];
}

/**
 * Efforts that can be chosen for `model`: the ones the server offers if it offers the model
 * (and has a key), and the ones stored for that model, whatever the server offers.
 */
export function effortOptions(status: ChoiceStatus, variants: StoredVariant[], model: string): string[] {
  const stored = variants.filter((v) => v.model === model).map((v) => v.effort);
  const offered = status.available && !!status.models?.includes(model) ? (status.efforts ?? []) : [];
  return sortEfforts([...offered, ...stored]);
}

function allowed(status: ChoiceStatus, variants: StoredVariant[], choice: InterpretationChoice): boolean {
  if (isStored(variants, choice)) return true;
  return status.available && !!status.models?.includes(choice.model) && !!status.efforts?.includes(choice.effort);
}

/**
 * The choice in force: `wanted` (what the visitor picked or kept from earlier) if it is
 * offered or stored, else the server's default if that is offered or stored, else, without a
 * key, the first stored variant. Null while the status is unknown or when nothing can be chosen.
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

/** The choice remembered in the browser, or null. */
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

/** Remembers the choice in the browser. */
export function saveChoice(choice: InterpretationChoice): void {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(choice));
  } catch {
    // Remembered for this page only.
  }
}

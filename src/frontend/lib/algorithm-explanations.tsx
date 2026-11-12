// Long-form explanation per algorithm, shown in the explainer modal. Not a
// replacement for `description`/`paper_url` from the backend but the "how does
// it work" layer: what happens internally, what the options are for, which
// defaults make sense. Keyed by the manifest's `algorithm_id`; algorithms
// without an entry fall back to the manifest's `description`.

import type { ReactNode } from "react";
import type { Locale } from "@/lib/i18n";

/** The explainer text of one algorithm; `paramNotes` is optional. */
export interface AlgorithmExplanation {
  what: ReactNode;
  how: ReactNode;
  whenToUse: ReactNode;
  paramNotes?: ReactNode;
}

const EXPLANATIONS_DE: Record<string, AlgorithmExplanation> = {
  comfy: {
    what: (
      <>
        <strong>ComFy</strong> mined aus deinem Log mit den gewählten
        Discovery-Algorithmen ein Petri-Netz und bewertet jedes entstehende Netz
        dann mit strukturellen Komplexitätsmaßen.
      </>
    ),
    how: (
      <>
        Für jeden ausgewählten Miner wird ein Netz gefunden und darauf werden die
        gewählten Komplexitätsmaße berechnet (Größe, Dichte,
        Kontrollfluss-Komplexität und weitere). Das Ergebnis ist eine
        Tabellenzeile pro Miner, sodass sich vergleichen lässt, wie komplex die
        Modelle verschiedener Miner ausfallen. Einige Maße (Cross-Connectivity,
        Depth, Diameter, Cyclicity) sind langsam und standardmäßig nicht
        ausgewählt.
      </>
    ),
    whenToUse: (
      <>
        Wenn du quantifizieren und vergleichen willst, wie kompliziert die
        Prozessmodelle sind, die verschiedene Miner aus demselben Log erzeugen —
        etwa um zu begründen, dass ein Miner ein einfacheres, lesbareres Modell
        liefert.
      </>
    ),
  },
};

// English versions of the entries above, with the same keys and structure.
const EXPLANATIONS_EN: Record<string, AlgorithmExplanation> = {
  comfy: {
    what: (
      <>
        <strong>ComFy</strong> mines a Petri net from your log with the chosen
        discovery algorithms and then scores each resulting net with structural
        complexity measures.
      </>
    ),
    how: (
      <>
        For every selected miner it discovers a net and computes the chosen
        complexity measures on it (size, density, control-flow complexity, and
        more). Results come back as one table row per miner, so you can compare
        how complex the models from different miners are. Some measures
        (Cross-Connectivity, Depth, Diameter, Cyclicity) are slow and off by
        default.
      </>
    ),
    whenToUse: (
      <>
        When you want to quantify and compare how complicated the process models
        are that different miners produce from the same log — e.g. to argue that
        one miner yields a simpler, more readable model.
      </>
    ),
  },
};

/** The explanation for an algorithm in `locale`, else the one in the other language; undefined when there is none. */
export function getExplanation(
  algorithmId: string,
  locale: Locale,
): AlgorithmExplanation | undefined {
  const primary = locale === "de" ? EXPLANATIONS_DE : EXPLANATIONS_EN;
  const fallback = locale === "de" ? EXPLANATIONS_EN : EXPLANATIONS_DE;
  return primary[algorithmId] ?? fallback[algorithmId];
}

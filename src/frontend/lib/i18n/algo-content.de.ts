// German translations of the English algorithm names, descriptions, parameter
// labels and help texts from the backend manifest (source of truth: the adapter
// classes in src/AlgoService/algorithms/*.py). Keyed by algorithm id; `params`
// and `labels` keyed by parameter `name`. Anything missing here falls back to English.

import type { AlgoContentMap } from "./algo-content";

export const ALGO_CONTENT_DE: AlgoContentMap = {
  comfy: {
    name: "ComFy — Komplexität von Petri-Netzen",
    description:
      "Zum hochgeladenen Event-Log findet jeder gewählte Miner ein Petri-Netz. " +
      "Danach werden für jedes Netz Komplexitätsmaße berechnet.",
    labels: {
      discovery_algorithms: "Discovery-Algorithmen",
      complexity_measures: "Komplexitätsmaße",
    },
    params: {
      discovery_algorithms:
        "Welche Miner auf dem hochgeladenen Log laufen sollen.",
      complexity_measures:
        "Maße, die für jedes gefundene Netz berechnet werden. Cross-Connectivity, Depth, Diameter und Cyclicity sind langsam.",
    },
  },
};

/** German names and descriptions of the example logs of GET /sample-logs, by id. */
export const SAMPLE_LOGS_DE: Record<string, { name: string; description: string }> = {
  small_example: {
    name: "Kleines Beispiel-Log",
    description:
      "Sechs synthetische Traces über die Aktivitäten a bis e. Das reicht, um ein Modell zu finden und seine Komplexität zu berechnen.",
  },
};

// German translations of the English algorithm descriptions and parameter
// help texts from the backend manifest (source of truth: the adapter classes
// in src/AlgoService/algorithms/*.py). Keyed by algorithm id; `params` keyed
// by parameter `name`. Anything missing here falls back to English.

import type { AlgoContentMap } from "./algo-content";

export const ALGO_CONTENT_DE: AlgoContentMap = {
  comfy: {
    description:
      "Aus dem hochgeladenen Event-Log wird mit den gewählten Minern ein Petri-Netz entdeckt; " +
      "anschließend werden Komplexitätsmaße für jedes resultierende Netz berechnet.",
    params: {
      discovery_algorithms:
        "Welche Miner auf dem hochgeladenen Log ausgeführt werden sollen.",
      complexity_measures:
        "Maße, die für jedes entdeckte Netz berechnet werden. Cross-Connectivity, Depth, Diameter und Cyclicity sind langsam.",
    },
  },
};

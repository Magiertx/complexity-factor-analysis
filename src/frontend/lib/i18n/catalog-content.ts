// Locale overlay for the factor analysis catalog (GET /factor-analysis/catalog), in the
// style of algo-content.ts: the backend ships English descriptions, this module swaps in
// German ones. Measure, miner and dataset names stay as they are.

import type { FactorCatalog } from "../api";
import type { Locale } from "./provider";

interface CatalogContent {
  groups: Record<string, { name: string; description: string }>;
  /** Model measure descriptions by measure name. */
  measures: Record<string, string>;
  /** Description of a log measure; {group} is the name of its feature group. */
  logMeasure: string;
  /** Descriptions of bundled datasets and samples by id. */
  datasets: Record<string, string>;
}

const PAPER_MINER = (miner: string) =>
  `ComFy-Modellmaße der Netze, die der ${miner} aus den 288 Trainingslogs des Process Discovery Contest 2025 entdeckt hat, wie im Paper verwendet.`;

const DE: CatalogContent = {
  groups: {
    simple_stats: { name: "Einfache Statistiken", description: "Anzahl der Traces, Varianten und Events." },
    trace_length: { name: "Tracelänge", description: "Verteilung der Zahl der Events je Trace." },
    trace_variant: { name: "Tracevarianten", description: "Wie sich die Traces auf ihre Varianten verteilen." },
    activities: { name: "Aktivitäten", description: "Verteilung der Häufigkeiten der Aktivitäten." },
    start_activities: { name: "Startaktivitäten", description: "Verteilung der ersten Aktivität jedes Trace." },
    end_activities: { name: "Endaktivitäten", description: "Verteilung der letzten Aktivität jedes Trace." },
    eventropies: { name: "Entropien", description: "Entropiemaße der Traces, Präfixe und k-Blöcke." },
    epa_based: {
      name: "Erweiterter Präfixautomat",
      description: "Varianten- und Sequenzentropie auf dem erweiterten Präfixautomaten.",
    },
    trace_diversity: { name: "Tracediversität", description: "Einfache und erweiterte Tracediversität." },
    distinct_activities: {
      name: "Verschiedene Aktivitäten",
      description: "Verschiedene Aktivitäten je Trace, Eventdichte, Komplexitätsfaktor.",
    },
    repetitions: { name: "Wiederholungen", description: "Schleifen und wiederholte Aktivitäten innerhalb von Traces." },
    comparison_based: {
      name: "Tracevergleich",
      description: "Maße, die Traces paarweise vergleichen, z. B. die Editierdistanz.",
    },
    dfg_based: { name: "Directly-Follows-Graph", description: "Struktur des Directly-Follows-Graphen des Logs." },
  },
  measures: {
    Size: "Anzahl der Stellen und Transitionen.",
    "Connector Mismatch": "Ungleichgewicht zwischen öffnenden und schließenden Parallel- und Auswahlkonnektoren.",
    "Connector Heterogeneity": "Entropie der Konnektortypen (parallel oder Auswahl); ohne Konnektoren undefiniert.",
    "Cross-Connectivity": "Wie stark Knotenpaare über ihre Pfade verbunden sind.",
    "Token split": "Kanten, die Transitionen verlassen, minus die Zahl der Transitionen.",
    "Control flow complexity": "Parallele Splits plus die Kanten, die Auswahlsplits verlassen.",
    Separability: "Anteil der Knoten, die keine Artikulationspunkte des ungerichteten Netzes sind.",
    "Average connector degree": "Mittlere Zahl der Kanten an einem Konnektor.",
    "Maximum connector degree": "Größte Zahl der Kanten an einem Konnektor.",
    Sequentiality: "Anteil der Kanten zwischen zwei Knoten, die keine Konnektoren sind.",
    Depth: "Größte Schachtelungstiefe von Splits und Joins; braucht die Markierungen.",
    Diameter: "Längster azyklischer Pfad von einer anfangs zu einer am Ende markierten Stelle.",
    Cyclicity: "Anteil der Knoten, die auf einem Zyklus liegen.",
    "Coefficient of network connectivity": "Kanten je Knoten.",
    Density: "Kanten geteilt durch die größtmögliche Zahl der Kanten, 2·|T|·|P|.",
    "Number of duplicate tasks":
      "Wiederholungen von Transitionsbeschriftungen; stille Transitionen zählen als Wiederholungen einer Beschriftung.",
    "Number of empty sequence flows": "Stellen zwischen einem parallelen Split und einem parallelen Join.",
  },
  logMeasure: "{group} (feeed).",
  datasets: {
    "comfy-paper-inductive-miner": PAPER_MINER("Inductive Miner"),
    "comfy-paper-alpha-miner": PAPER_MINER("Alpha Miner"),
    "comfy-paper-alpha-plus-miner": PAPER_MINER("Alpha Plus Miner"),
    "comfy-paper-alpha-dollar-miner": PAPER_MINER("Alpha Dollar Miner"),
    "comfy-paper-heuristics-miner": PAPER_MINER("Heuristics Miner"),
    "comfy-paper-hybrid-ilp-miner": PAPER_MINER("Hybrid ILP Miner"),
    "comfy-paper-directly-follows-miner": PAPER_MINER("Directly Follows Miner"),
    "comfy-log-pdc-training-logs":
      "feeed-Maße der 2112 Trainingslogs der Process Discovery Contests 2020 bis 2025, wie im Paper „Cleaning Up the Measure Mess: A Factor Analysis on Event Log Measures“ verwendet. Mit einem älteren feeed berechnet: simple_trace_diversity, distinct_activities_mean, distinct_activities_std, event_density und complexity_factor weichen von Datensätzen ab, die der Dienst berechnet.",
    "pdc-sample-logs": "Trainingslogs der Process Discovery Contests 2020, 2023, 2024 und 2025, je 1000 Traces.",
    "pdc-sample-models":
      "32 Netze, mit dem Inductive Miner von pm4py bei Rauschschwellen von 0 bis 0,8 aus den vier Beispiellogs entdeckt (samples/make_sample_models.py).",
  },
};

const CONTENT: Partial<Record<Locale, CatalogContent>> = { de: DE };

/** The catalog with its descriptions in the given locale, where a translation exists. */
export function localizeCatalog(catalog: FactorCatalog, locale: Locale): FactorCatalog {
  const c = CONTENT[locale];
  if (!c) return catalog;
  const groupName = (key: string | undefined) => (key ? c.groups[key]?.name : undefined);
  return {
    ...catalog,
    measures: catalog.measures.map((m) => {
      const group = groupName(m.group);
      const description = m.group
        ? group && c.logMeasure.replace("{group}", group)
        : c.measures[m.key];
      return description ? { ...m, description } : m;
    }),
    groups: catalog.groups?.map((g) => ({ ...g, ...c.groups[g.key] })),
    bundled: catalog.bundled.map((b) => ({ ...b, description: c.datasets[b.id] ?? b.description })),
    samples: catalog.samples?.map((s) => ({ ...s, description: c.datasets[s.id] ?? s.description })),
  };
}

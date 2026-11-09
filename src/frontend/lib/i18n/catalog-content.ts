// Locale overlay for the factor analysis catalog (GET /factor-analysis/catalog), in the
// style of algo-content.ts: the backend ships English descriptions, this module swaps in
// German ones. Measure, miner and dataset names stay as they are. Log measures get their
// descriptions here in both languages: the backend names only their feature group.

import type { FactorCatalog } from "../api";
import type { Locale } from "./provider";

interface CatalogContent {
  groups: Record<string, { name: string; description: string }>;
  /** Model measure descriptions by measure name. */
  measures: Record<string, string>;
  /** Names of bundled datasets and samples by id. Collections keep theirs: they are paper titles. */
  names: Record<string, string>;
  /** Descriptions of bundled datasets and samples by id. */
  datasets: Record<string, string>;
  /** Short labels of bundled datasets by id, where they are not names. */
  labels: Record<string, string>;
  /** Descriptions, notes and license remarks of the dataset collections (papers) by id. */
  collections: Record<string, { description: string; note?: string; license?: string }>;
}

const PAPER_MINER = (miner: string, inPaper = true) =>
  `ComFy-Modellmaße der Netze, die der ${miner} aus den 288 Trainingslogs des Process Discovery Contest 2025 gefunden hat, ` +
  (inPaper
    ? "wie im Paper verwendet."
    : "aus den Reports des ComFy-Repositorys; das Paper wertet diesen Miner nicht aus.");

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
    Diameter: "Längster azyklischer Pfad von einer Stelle der Anfangsmarkierung zu einer der Endmarkierung.",
    Cyclicity: "Anteil der Knoten, die auf einem Zyklus liegen.",
    "Coefficient of network connectivity": "Kanten je Knoten.",
    Density: "Kanten geteilt durch die größtmögliche Zahl der Kanten, 2·|T|·|P|.",
    "Number of duplicate tasks":
      "Wiederholungen von Transitionsbeschriftungen; stille Transitionen zählen als Wiederholungen einer Beschriftung.",
    "Number of empty sequence flows": "Stellen zwischen einem parallelen Split und einem parallelen Join.",
  },
  names: {
    "comfy-log-pdc-training-logs": "Log-Maße der PDC-Trainingslogs",
    "pdc-sample-logs": "Vier PDC-Trainingslogs",
    "pdc-sample-models": "Petri-Netze der vier PDC-Logs",
  },
  // Miner names as ComFy spells them, like the miner list of the data step.
  datasets: {
    "comfy-paper-inductive-miner": PAPER_MINER("Inductive miner"),
    "comfy-paper-alpha-miner": PAPER_MINER("Alpha miner"),
    "comfy-paper-alpha-plus-miner": PAPER_MINER("Alpha Plus miner", false),
    "comfy-paper-alpha-dollar-miner": PAPER_MINER("Alpha Dollar miner", false),
    "comfy-paper-heuristics-miner": PAPER_MINER("Heuristics miner"),
    "comfy-paper-hybrid-ilp-miner": PAPER_MINER("Hybrid ILP miner"),
    "comfy-paper-directly-follows-miner": PAPER_MINER("Directly Follows miner"),
    "comfy-log-pdc-training-logs":
      "feeed-Maße der 2.112 Trainingslogs der Process Discovery Contests 2020 bis 2025. Mit einem älteren feeed berechnet: simple_trace_diversity, distinct_activities_mean, distinct_activities_std, event_density und complexity_factor weichen von Datensätzen ab, die der Dienst berechnet.",
    "pdc-sample-logs": "Trainingslogs der Process Discovery Contests 2020, 2023, 2024 und 2025, je 1.000 Traces.",
    "pdc-sample-models":
      "32 Netze, die der Inductive miner von pm4py aus den vier Beispiel-Logs bei Rauschschwellen von 0 bis 0,8 gefunden hat (samples/make_sample_models.py).",
  },
  labels: {
    "comfy-log-pdc-training-logs": "PDC-Trainingslogs 2020–2025",
  },
  collections: {
    "comfy-paper": {
      description:
        "ComFy-Modellmaße der Netze, die jeder Miner aus den 288 Trainingslogs des Process Discovery Contest 2025 gefunden hat.",
      license: "Keine Lizenzdatei im Original; die Erlaubnis der Autorin steht noch aus.",
    },
    "comfy-log-paper": {
      description: "feeed-Maße der 2.112 Trainingslogs der Process Discovery Contests 2020 bis 2025.",
      note: "Mit einem älteren feeed berechnet: simple_trace_diversity, distinct_activities_mean, distinct_activities_std, event_density und complexity_factor weichen von Datensätzen ab, die der Dienst berechnet.",
    },
  },
};

const CONTENT: Partial<Record<Locale, CatalogContent>> = { de: DE };

/**
 * Short definitions of feeed's log measures, as feeed computes them. Measures of a family
 * share a template. The entropy measures, the prefix automaton and the pairwise trace
 * comparisons are left to the description of their group, since one line cannot define them.
 */
interface LogMeasureText {
  /** Statistics by the suffix feeed gives them, e.g. "q1". */
  stats: Record<string, string>;
  /** Templates of a family by the prefix or suffix of its keys; {stat} is one of `stats`. */
  prefixes: Record<string, string>;
  suffixes: Record<string, string>;
  /** trace_len_hist1 to trace_len_hist10; {k} is the bin. */
  hist: string;
  measures: Record<string, string>;
  /** The line on the feature group; {group} is its name, {description} its description. */
  group: string;
}

const LOG_EN: LogMeasureText = {
  stats: {
    min: "Minimum",
    max: "Maximum",
    mean: "Mean",
    median: "Median",
    mode: "Mode",
    std: "Standard deviation",
    variance: "Variance",
    q1: "First quartile",
    q3: "Third quartile",
    iqr: "Interquartile range",
    geometric_mean: "Geometric mean",
    geometric_std: "Geometric standard deviation",
    harmonic_mean: "Harmonic mean",
    skewness: "Skewness",
    kurtosis: "Excess kurtosis",
    coefficient_variation: "Coefficient of variation",
  },
  prefixes: {
    trace_len_: "{stat} of the trace lengths (events per trace).",
    activities_: "{stat} of the activity frequencies (events per activity).",
    start_activities_: "{stat} of the start activity frequencies (traces per start activity).",
    end_activities_: "{stat} of the end activity frequencies (traces per end activity).",
    distinct_activities_: "{stat} of the number of distinct activities per trace.",
  },
  suffixes: {
    _variant_occurrence: "{stat} of the number of traces per variant.",
  },
  hist: "Density of bin {k} of 10 equal-width bins over the trace lengths.",
  measures: {
    n_traces: "Number of traces.",
    n_variants: "Number of variants (distinct activity sequences).",
    ratio_variants_per_number_of_traces: "Number of variants divided by the number of traces.",
    n_events: "Number of events.",
    trace_len_entropy: "Entropy of how the events spread over the traces.",
    trace_len_skewness_hist: "Skewness of the 10 bin densities of the trace lengths.",
    trace_len_kurtosis_hist: "Excess kurtosis of the 10 bin densities of the trace lengths.",
    ratio_most_common_variant: "Share of the traces that follow the most common variant.",
    ratio_top_1_variants: "Share of the traces covered by the most common 1% of the variants.",
    ratio_top_5_variants: "Share of the traces covered by the most common 5% of the variants.",
    ratio_top_10_variants: "Share of the traces covered by the most common 10% of the variants.",
    ratio_top_20_variants: "Share of the traces covered by the most common 20% of the variants.",
    ratio_top_50_variants: "Share of the traces covered by the most common 50% of the variants.",
    ratio_top_75_variants: "Share of the traces covered by the most common 75% of the variants.",
    heterogeneity_rate_variants: "Logarithm of the number of variants divided by the logarithm of the number of traces.",
    similarity_rate_variants:
      "Mean edit similarity (1 − edit distance / length of the longer one) over all pairs of different variants.",
    n_unique_activities: "Number of distinct activities.",
    n_unique_start_activities: "Number of distinct start activities.",
    rel_unique_start_activities: "Number of distinct start activities divided by the number of variants.",
    n_unique_end_activities: "Number of distinct end activities.",
    rel_unique_end_activities: "Number of distinct end activities divided by the number of variants.",
    simple_trace_diversity:
      "1 minus the mean number of distinct activities per trace divided by the number of activities.",
    advanced_trace_diversity: "Mean edit distance between the variants divided by the mean trace length.",
    event_density: "Mean number of distinct activities per trace divided by the mean trace length.",
    distinct_activities_non_overlap: "1 minus the mean Jaccard similarity of the activity sets of all pairs of traces.",
    complexity_factor:
      "log(variants) to the power of (1 − variant similarity + event density), times the mean number of distinct activities per trace.",
    n_traces_with_loop: "Number of traces in which an activity directly repeats itself (a self-loop).",
    avg_traces_with_loop: "Share of the traces with a self-loop.",
    avg_loops_per_trace: "Mean number of self-loops per trace.",
    max_loops_per_trace: "Largest number of self-loops in one trace.",
    avg_loop_size_per_trace: "Direct repetitions in all self-loops divided by the number of traces with a self-loop.",
    max_loop_size_per_trace: "Most direct repetitions of an activity in one self-loop.",
    n_traces_with_repetition: "Number of traces in which an activity recurs after other activities.",
    avg_traces_with_repetition: "Share of the traces in which an activity recurs after other activities.",
    n_nodes_dfg: "Number of nodes of the directly-follows graph: the activities plus a start and an end node.",
    n_edges_dfg: "Number of edges of the directly-follows graph, including those from the start and to the end node.",
    coeff_of_connectivity_dfg: "Edges per node of the directly-follows graph.",
    avg_node_degree_dfg: "Mean number of incoming and outgoing edges at a node of the directly-follows graph.",
    max_node_degree_dfg: "Largest number of incoming and outgoing edges at a node of the directly-follows graph.",
    density_dfg: "Edges divided by the largest possible number, n·(n − 1) for n nodes.",
    structure_dfg: "1 minus the edges divided by the squared number of nodes.",
    cyclomatic_number_dfg: "Edges minus nodes plus 1.",
    n_cut_vertices_dfg: "Number of cut vertices (articulation points) of the undirected graph.",
    separability_ratio_dfg: "Cut vertices divided by the number of nodes.",
    sequentiality_ratio_dfg:
      "Edges between nodes with at most one incoming and one outgoing edge, divided by the number of nodes.",
    cyclicity_dfg: "Share of the nodes on a cycle through other nodes.",
  },
  group: "{group} (feeed feature group): {description}",
};

const LOG_DE: LogMeasureText = {
  stats: {
    min: "Minimum",
    max: "Maximum",
    mean: "Mittelwert",
    median: "Median",
    mode: "Modus",
    std: "Standardabweichung",
    variance: "Varianz",
    q1: "Erstes Quartil",
    q3: "Drittes Quartil",
    iqr: "Interquartilsabstand",
    geometric_mean: "Geometrisches Mittel",
    geometric_std: "Geometrische Standardabweichung",
    harmonic_mean: "Harmonisches Mittel",
    skewness: "Schiefe",
    kurtosis: "Exzess-Kurtosis",
    coefficient_variation: "Variationskoeffizient",
  },
  prefixes: {
    trace_len_: "{stat} der Tracelängen (Events je Trace).",
    activities_: "{stat} der Aktivitätshäufigkeiten (Events je Aktivität).",
    start_activities_: "{stat} der Häufigkeiten der Startaktivitäten (Traces je Startaktivität).",
    end_activities_: "{stat} der Häufigkeiten der Endaktivitäten (Traces je Endaktivität).",
    distinct_activities_: "{stat} der Zahl verschiedener Aktivitäten je Trace.",
  },
  suffixes: {
    _variant_occurrence: "{stat} der Zahl der Traces je Variante.",
  },
  hist: "Dichte in Klasse {k} von 10 gleich breiten Klassen der Tracelängen.",
  measures: {
    n_traces: "Zahl der Traces.",
    n_variants: "Zahl der Varianten (verschiedene Aktivitätsfolgen).",
    ratio_variants_per_number_of_traces: "Zahl der Varianten geteilt durch die Zahl der Traces.",
    n_events: "Zahl der Events.",
    trace_len_entropy: "Entropie der Verteilung der Events auf die Traces.",
    trace_len_skewness_hist: "Schiefe der 10 Klassendichten der Tracelängen.",
    trace_len_kurtosis_hist: "Exzess-Kurtosis der 10 Klassendichten der Tracelängen.",
    ratio_most_common_variant: "Anteil der Traces, die der häufigsten Variante folgen.",
    ratio_top_1_variants: "Anteil der Traces, den die häufigsten 1 % der Varianten abdecken.",
    ratio_top_5_variants: "Anteil der Traces, den die häufigsten 5 % der Varianten abdecken.",
    ratio_top_10_variants: "Anteil der Traces, den die häufigsten 10 % der Varianten abdecken.",
    ratio_top_20_variants: "Anteil der Traces, den die häufigsten 20 % der Varianten abdecken.",
    ratio_top_50_variants: "Anteil der Traces, den die häufigsten 50 % der Varianten abdecken.",
    ratio_top_75_variants: "Anteil der Traces, den die häufigsten 75 % der Varianten abdecken.",
    heterogeneity_rate_variants: "Logarithmus der Zahl der Varianten geteilt durch den Logarithmus der Zahl der Traces.",
    similarity_rate_variants:
      "Mittlere Editierähnlichkeit (1 − Editierdistanz / Länge der längeren) über alle Paare verschiedener Varianten.",
    n_unique_activities: "Zahl der verschiedenen Aktivitäten.",
    n_unique_start_activities: "Zahl der verschiedenen Startaktivitäten.",
    rel_unique_start_activities: "Zahl der verschiedenen Startaktivitäten geteilt durch die Zahl der Varianten.",
    n_unique_end_activities: "Zahl der verschiedenen Endaktivitäten.",
    rel_unique_end_activities: "Zahl der verschiedenen Endaktivitäten geteilt durch die Zahl der Varianten.",
    simple_trace_diversity:
      "1 minus die mittlere Zahl verschiedener Aktivitäten je Trace geteilt durch die Zahl der Aktivitäten.",
    advanced_trace_diversity: "Mittlere Editierdistanz zwischen den Varianten geteilt durch die mittlere Tracelänge.",
    event_density: "Mittlere Zahl verschiedener Aktivitäten je Trace geteilt durch die mittlere Tracelänge.",
    distinct_activities_non_overlap: "1 minus die mittlere Jaccard-Ähnlichkeit der Aktivitätsmengen aller Tracepaare.",
    complexity_factor:
      "log(Varianten) hoch (1 − Variantenähnlichkeit + Eventdichte), mal die mittlere Zahl verschiedener Aktivitäten je Trace.",
    n_traces_with_loop: "Zahl der Traces, in denen sich eine Aktivität direkt wiederholt (Selbstschleife).",
    avg_traces_with_loop: "Anteil der Traces mit Selbstschleife.",
    avg_loops_per_trace: "Mittlere Zahl der Selbstschleifen je Trace.",
    max_loops_per_trace: "Größte Zahl der Selbstschleifen in einem Trace.",
    avg_loop_size_per_trace:
      "Direkte Wiederholungen in allen Selbstschleifen geteilt durch die Zahl der Traces mit Selbstschleife.",
    max_loop_size_per_trace: "Meiste direkte Wiederholungen einer Aktivität in einer Selbstschleife.",
    n_traces_with_repetition: "Zahl der Traces, in denen eine Aktivität nach anderen Aktivitäten wiederkehrt.",
    avg_traces_with_repetition: "Anteil der Traces, in denen eine Aktivität nach anderen Aktivitäten wiederkehrt.",
    n_nodes_dfg: "Zahl der Knoten des Directly-Follows-Graphen: die Aktivitäten plus ein Start- und ein Endknoten.",
    n_edges_dfg: "Zahl der Kanten des Directly-Follows-Graphen, einschließlich derer vom Start- und zum Endknoten.",
    coeff_of_connectivity_dfg: "Kanten je Knoten des Directly-Follows-Graphen.",
    avg_node_degree_dfg: "Mittlere Zahl der ein- und ausgehenden Kanten an einem Knoten des Directly-Follows-Graphen.",
    max_node_degree_dfg: "Größte Zahl der ein- und ausgehenden Kanten an einem Knoten des Directly-Follows-Graphen.",
    density_dfg: "Kanten geteilt durch die größtmögliche Zahl, n·(n − 1) bei n Knoten.",
    structure_dfg: "1 minus die Kanten geteilt durch das Quadrat der Zahl der Knoten.",
    cyclomatic_number_dfg: "Kanten minus Knoten plus 1.",
    n_cut_vertices_dfg: "Zahl der Schnittknoten (Artikulationspunkte) des ungerichteten Graphen.",
    separability_ratio_dfg: "Schnittknoten geteilt durch die Zahl der Knoten.",
    sequentiality_ratio_dfg:
      "Kanten zwischen Knoten mit höchstens einer ein- und einer ausgehenden Kante, geteilt durch die Zahl der Knoten.",
    cyclicity_dfg: "Anteil der Knoten auf einem Zyklus über andere Knoten.",
  },
  group: "{group} (Feature-Gruppe von feeed): {description}",
};

const LOG_TEXT: Record<Locale, LogMeasureText> = { en: LOG_EN, de: LOG_DE };

/** What a feeed measure computes, where one line can say it. */
function logMeasureText(key: string, text: LogMeasureText): string | undefined {
  if (text.measures[key]) return text.measures[key];
  const bin = /^trace_len_hist(\d+)$/.exec(key);
  if (bin) return text.hist.replace("{k}", bin[1]);
  for (const [prefix, template] of Object.entries(text.prefixes)) {
    const stat = key.startsWith(prefix) ? text.stats[key.slice(prefix.length)] : undefined;
    if (stat) return template.replace("{stat}", stat);
  }
  for (const [suffix, template] of Object.entries(text.suffixes)) {
    const stat = key.endsWith(suffix) ? text.stats[key.slice(0, -suffix.length)] : undefined;
    if (stat) return template.replace("{stat}", stat);
  }
  return undefined;
}

/** The catalog with its descriptions in the given locale, where a translation exists. */
export function localizeCatalog(catalog: FactorCatalog, locale: Locale): FactorCatalog {
  const c = CONTENT[locale];
  const groups = catalog.groups?.map((g) => ({ ...g, ...c?.groups[g.key] }));
  const groupOf = new Map((groups ?? []).map((g) => [g.key, g]));
  const logText = LOG_TEXT[locale];
  return {
    ...catalog,
    measures: catalog.measures.map((m) => {
      const group = m.group ? groupOf.get(m.group) : undefined;
      if (group) {
        // Two lines for the tooltip of the measure: what it computes, then its group.
        const groupLine = logText.group.replace("{group}", group.name).replace("{description}", group.description);
        return { ...m, description: [logMeasureText(m.key, logText), groupLine].filter(Boolean).join("\n") };
      }
      const description = c?.measures[m.key];
      return description ? { ...m, description } : m;
    }),
    groups,
    ...(c && {
      bundled: catalog.bundled.map((b) => ({
        ...b,
        name: c.names[b.id] ?? b.name,
        description: c.datasets[b.id] ?? b.description,
        label: c.labels[b.id] ?? b.label,
      })),
      collections: catalog.collections?.map((col) => ({ ...col, ...c.collections[col.id] })),
      samples: catalog.samples?.map((s) => ({
        ...s,
        name: c.names[s.id] ?? s.name,
        description: c.datasets[s.id] ?? s.description,
      })),
    }),
  };
}

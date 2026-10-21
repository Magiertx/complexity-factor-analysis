"""Short codes of the measures, as the papers print them in tables and figures.

- Model measures: the codes of "Important Factors: Complexity Dimensions for Petri Nets"
  (ATAED 2026), e.g. CNC for the coefficient of network connectivity. The paper uses 13 of the
  17 measures of ComFy; the codes of the other four follow the same style and are the tool's
  own (``TOOL_MODEL_CODES``).
- Log measures: the macros of ComFy for log measures (``LatexExporter.py``, commit 70837ce,
  https://github.com/Pati-nets/ComFy-for-Log-Measures), which the paper "Cleaning Up the Measure
  Mess" prints as C with the code as index, e.g. C_mag. The codes are kept as written there,
  including FREQ-A-IRQ for the interquartile range of the activity frequencies.

A code is shorter than the name and only names the measure within its kind; the full name stays
in the tooltip of the UI and next to the code in the exports.
"""

from __future__ import annotations

MODEL_CODES = {
    "Size": "size",
    "Connector Mismatch": "MM",
    "Connector Heterogeneity": "CH",
    "Cross-Connectivity": "CC",
    "Token split": "ts",
    "Control flow complexity": "CFC",
    "Separability": "sep",
    "Average connector degree": "acd",
    "Maximum connector degree": "mcd",
    "Sequentiality": "seq",
    "Depth": "depth",
    "Diameter": "diam",
    "Cyclicity": "cyc",
    "Coefficient of network connectivity": "CNC",
    "Density": "dens",
    "Number of duplicate tasks": "dup",
    "Number of empty sequence flows": "esf",
}

#: Model measures that Important Factors does not analyse; their codes are not from a paper.
TOOL_MODEL_CODES = {"Cross-Connectivity", "Depth", "Diameter", "Cyclicity"}

LOG_CODES = {
    # simple_stats
    "n_traces": "len",
    "n_variants": "DT-#",
    "ratio_variants_per_number_of_traces": "DT-%",
    "n_events": "mag",
    # trace_length
    "trace_len_min": "TL-min",
    "trace_len_max": "TL-max",
    "trace_len_mean": "TL-mean",
    "trace_len_median": "TL-med",
    "trace_len_mode": "TL-mode",
    "trace_len_std": "TL-dev",
    "trace_len_variance": "TL-var",
    "trace_len_q1": "TL-Q1",
    "trace_len_q3": "TL-Q3",
    "trace_len_iqr": "TL-IQR",
    "trace_len_geometric_mean": "TL-g-mean",
    "trace_len_geometric_std": "TL-g-dev",
    "trace_len_harmonic_mean": "TL-h-mean",
    "trace_len_skewness": "TL-skew",
    "trace_len_kurtosis": "TL-kurt",
    "trace_len_coefficient_variation": "TL-cvar",
    "trace_len_entropy": "TL-ent",
    "trace_len_hist1": "TL-hist1",
    "trace_len_hist2": "TL-hist2",
    "trace_len_hist3": "TL-hist3",
    "trace_len_hist4": "TL-hist4",
    "trace_len_hist5": "TL-hist5",
    "trace_len_hist6": "TL-hist6",
    "trace_len_hist7": "TL-hist7",
    "trace_len_hist8": "TL-hist8",
    "trace_len_hist9": "TL-hist9",
    "trace_len_hist10": "TL-hist10",
    "trace_len_skewness_hist": "TL-hist-skew",
    "trace_len_kurtosis_hist": "TL-hist-kurt",
    # trace_variant
    "ratio_most_common_variant": "FREQ-T-max-r",
    "ratio_top_1_variants": "FREQ-T-max-1%",
    "ratio_top_5_variants": "FREQ-T-max-5%",
    "ratio_top_10_variants": "FREQ-T-max-10%",
    "ratio_top_20_variants": "FREQ-T-max-20%",
    "ratio_top_50_variants": "FREQ-T-max-50%",
    "ratio_top_75_variants": "FREQ-T-max-75%",
    "mean_variant_occurrence": "FREQ-T-mean",
    "std_variant_occurrence": "FREQ-T-dev",
    "skewness_variant_occurrence": "FREQ-T-skew",
    "kurtosis_variant_occurrence": "FREQ-T-kurt",
    "coverage_variants": "DT-cov",
    "rel_coverage_variants": "DT-cov-%",
    "heterogeneity_rate_variants": "DT-het",
    "similarity_rate_variants": "DT-sim",
    # activities
    "n_unique_activities": "var",
    "activities_min": "FREQ-A-min",
    "activities_max": "FREQ-A-max",
    "activities_mean": "FREQ-A-mean",
    "activities_median": "FREQ-A-med",
    "activities_std": "FREQ-A-dev",
    "activities_variance": "FREQ-A-var",
    "activities_q1": "FREQ-A-Q1",
    "activities_q3": "FREQ-A-Q3",
    "activities_iqr": "FREQ-A-IRQ",
    "activities_skewness": "FREQ-A-skew",
    "activities_kurtosis": "FREQ-A-kurt",
    # start_activities
    "n_unique_start_activities": "A-start-#",
    "start_activities_min": "A-start-min",
    "start_activities_max": "A-start-max",
    "start_activities_mean": "A-start-mean",
    "start_activities_median": "A-start-med",
    "start_activities_std": "A-start-dev",
    "start_activities_variance": "A-start-var",
    "start_activities_q1": "A-start-Q1",
    "start_activities_q3": "A-start-Q3",
    "start_activities_iqr": "A-start-IQR",
    "start_activities_skewness": "A-start-skew",
    "start_activities_kurtosis": "A-start-kurt",
    "rel_unique_start_activities": "A-start-rel",
    # end_activities
    "n_unique_end_activities": "A-end-#",
    "end_activities_min": "A-end-min",
    "end_activities_max": "A-end-max",
    "end_activities_mean": "A-end-mean",
    "end_activities_median": "A-end-med",
    "end_activities_std": "A-end-dev",
    "end_activities_variance": "A-end-var",
    "end_activities_q1": "A-end-Q1",
    "end_activities_q3": "A-end-Q3",
    "end_activities_iqr": "A-end-IQR",
    "end_activities_skewness": "A-end-skew",
    "end_activities_kurtosis": "A-end-kurt",
    "rel_unique_end_activities": "A-end-rel",
    # eventropies
    "eventropy_trace": "ENT-trace",
    "eventropy_prefix": "ENT-pref",
    "eventropy_prefix_flattened": "ENT-pref-F",
    "eventropy_global_block": "ENT-g-block",
    "eventropy_global_block_flattened": "ENT-g-block-F",
    "eventropy_lempel_ziv": "ENT-LZ",
    "eventropy_lempel_ziv_flattened": "ENT-LZ-F",
    "eventropy_k_block_diff_1": "ENT-k-block-d1",
    "eventropy_k_block_diff_3": "ENT-k-block-d3",
    "eventropy_k_block_diff_5": "ENT-k-block-d5",
    "eventropy_k_block_ratio_1": "ENT-k-block-r1",
    "eventropy_k_block_ratio_3": "ENT-k-block-r3",
    "eventropy_k_block_ratio_5": "ENT-k-block-r5",
    "eventropy_knn_3": "ENT-knn-3",
    "eventropy_knn_5": "ENT-knn-5",
    "eventropy_knn_7": "ENT-knn-7",
    # epa_based
    "epa_variant_entropy": "epa-var",
    "epa_normalized_variant_entropy": "epa-n-var",
    "epa_sequence_entropy": "epa-seq",
    "epa_normalized_sequence_entropy": "epa-n-seq",
    "epa_sequence_entropy_linear_forgetting": "epa-seq-L",
    "epa_normalized_sequence_entropy_linear_forgetting": "epa-n-seq-L",
    "epa_sequence_entropy_exponential_forgetting": "epa-seq-E",
    "epa_normalized_sequence_entropy_exponential_forgetting": "epa-n-seq-E",
    # trace_diversity
    "simple_trace_diversity": "s-T-div",
    "advanced_trace_diversity": "a-T-div",
    # distinct_activities
    "distinct_activities_min": "DA-min",
    "distinct_activities_max": "DA-max",
    "distinct_activities_mean": "DA-avg",
    "distinct_activities_std": "DA-dev",
    "event_density": "DA-dens",
    "distinct_activities_non_overlap": "DA-ovrlp",
    "complexity_factor": "comp-fact",
    # repetitions
    "n_traces_with_loop": "loop-#",
    "avg_traces_with_loop": "loop-rel-#",
    "avg_loops_per_trace": "loop-avg-#",
    "max_loops_per_trace": "loop-max-#",
    "avg_loop_size_per_trace": "loop-avg-size",
    "max_loop_size_per_trace": "loop-max-size",
    "n_traces_with_repetition": "rep-#",
    "avg_traces_with_repetition": "rep-rel-#",
    # comparison_based
    "number_of_successions": "succ",
    "number_of_ties": "ties",
    "structure": "struct",
    "average_affinity": "affinity",
    "lempel_ziv_complexity": "LZ",
    "deviation_from_random": "dev-R",
    "average_edit_distance": "avg-dist",
    # dfg_based
    "n_nodes_dfg": "DFG-V",
    "n_edges_dfg": "DFG-E",
    "coeff_of_connectivity_dfg": "DFG-cnc",
    "avg_node_degree_dfg": "DFG-adeg",
    "max_node_degree_dfg": "DFG-mdeg",
    "density_dfg": "DFG-dens",
    "structure_dfg": "DFG-struct",
    "cyclomatic_number_dfg": "DFG-CN",
    "n_cut_vertices_dfg": "DFG-sep-#",
    "separability_ratio_dfg": "DFG-sep-r",
    "sequentiality_ratio_dfg": "DFG-seq-r",
    "cyclicity_dfg": "DFG-cyc",
}

CODES = {"model": MODEL_CODES, "log": LOG_CODES}


def short_code(kind: str, measure: str) -> str | None:
    """The code of a measure of the kind, or None for a measure without one, e.g. a column of
    an uploaded CSV that is not a measure of the catalog."""
    return CODES.get(kind, {}).get(measure)


def codes_for(kind: str, measures: list[str]) -> dict[str, str]:
    """The codes of those of ``measures`` that have one."""
    table = CODES.get(kind, {})
    return {m: table[m] for m in measures if m in table}


def label(kind: str, measure: str, short: bool) -> str:
    """What a table or figure calls a measure: its code if ``short`` and it has one, else its name."""
    return (short and short_code(kind, measure)) or measure

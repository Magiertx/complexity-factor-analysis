# constants for storing output files
INPUT_PATH = "./input/"
OUTPUT_PATH = "./output/"
LATEX_REPORT_PATH = "./output/"

# constants for handling event logs
case_specifier = 'case:concept:name'
activity_specifier = 'concept:name'
timestamp_specifier = 'time:timestamp'

# constants for printing on command line with color
SUCCESS_COLOR = "\033[92m"
FAILURE_COLOR = "\033[91m"
RESET_COLOR = "\x1b[0m"

# constants for the factor analysis
bartlett_p_value_threshold = 0.05
msa_threshold = 0.6
ignore_threshold = 0.5
communality_threshold = 0.5
number_of_decimals = 4

# We treat the Eigenvalue below as zero
eigenvalue_floor = 1e-10
# Fraction of an eigenvector's (unit) squared-loading total that its top variables must cover to be reported as a near-singularity's cause (see execute_Bartletts_test_of_sphericity).
eigenvector_loading_coverage_threshold = 0.8

# lists of analyzable log measures
simple_stats = ['n_traces', 'n_variants', 'ratio_variants_per_number_of_traces', 'n_events']
trace_length = ['trace_len_min', 'trace_len_max', 'trace_len_mean', 'trace_len_median',
                'trace_len_mode', 'trace_len_std', 'trace_len_variance', 'trace_len_q1',
                'trace_len_q3', 'trace_len_iqr', 'trace_len_geometric_mean',
                'trace_len_geometric_std', 'trace_len_harmonic_mean', 'trace_len_skewness',
                'trace_len_kurtosis', 'trace_len_coefficient_variation', 'trace_len_entropy',
                'trace_len_hist1', 'trace_len_hist2', 'trace_len_hist3', 'trace_len_hist4',
                'trace_len_hist5', 'trace_len_hist6', 'trace_len_hist7', 'trace_len_hist8',
                'trace_len_hist9', 'trace_len_hist10', 'trace_len_skewness_hist',
                'trace_len_kurtosis_hist']
trace_variant = ['ratio_most_common_variant', 'ratio_top_1_variants', 'ratio_top_5_variants',
                 'ratio_top_10_variants', 'ratio_top_20_variants', 'ratio_top_50_variants',
                 'ratio_top_75_variants', 'mean_variant_occurrence', 'std_variant_occurrence',
                 'skewness_variant_occurrence', 'kurtosis_variant_occurrence', 'coverage_variants',
                 'rel_coverage_variants', 'heterogeneity_rate_variants', 'similarity_rate_variants']
activities = ['n_unique_activities', 'activities_min', 'activities_max', 'activities_mean',
              'activities_median', 'activities_std', 'activities_variance', 'activities_q1',
              'activities_q3', 'activities_iqr', 'activities_skewness', 'activities_kurtosis']
start_activities = ['n_unique_start_activities', 'start_activities_min', 'start_activities_max',
                    'start_activities_mean', 'start_activities_median', 'start_activities_std',
                    'start_activities_variance', 'start_activities_q1', 'start_activities_q3',
                    'start_activities_iqr', 'start_activities_skewness', 'start_activities_kurtosis',
                    'rel_unique_start_activities']
end_activities = ['n_unique_end_activities', 'end_activities_min', 'end_activities_max',
                  'end_activities_mean', 'end_activities_median', 'end_activities_std',
                  'end_activities_variance', 'end_activities_q1', 'end_activities_q3',
                  'end_activities_iqr', 'end_activities_skewness', 'end_activities_kurtosis',
                  'rel_unique_end_activities']
eventropies = ['eventropy_trace', 'eventropy_prefix', 'eventropy_prefix_flattened',
               'eventropy_global_block', 'eventropy_global_block_flattened', 'eventropy_lempel_ziv',
               'eventropy_lempel_ziv_flattened', 'eventropy_k_block_diff_1', 'eventropy_k_block_diff_3',
               'eventropy_k_block_diff_5', 'eventropy_k_block_ratio_1', 'eventropy_k_block_ratio_3',
               'eventropy_k_block_ratio_5', 'eventropy_knn_3', 'eventropy_knn_5', 'eventropy_knn_7']
epa_based = ['epa_variant_entropy', 'epa_normalized_variant_entropy', 'epa_sequence_entropy',
             'epa_normalized_sequence_entropy', 'epa_sequence_entropy_linear_forgetting',
             'epa_normalized_sequence_entropy_linear_forgetting', 'epa_sequence_entropy_exponential_forgetting',
             'epa_normalized_sequence_entropy_exponential_forgetting']
trace_diversity = ['simple_trace_diversity', 'advanced_trace_diversity']
distinct_activities = ['distinct_activities_min', 'distinct_activities_max', 'distinct_activities_mean',
                       'distinct_activities_std', 'event_density', 'distinct_activities_non_overlap',
                       'complexity_factor']
repetitions = ['n_traces_with_loop', 'avg_traces_with_loop', 'avg_loops_per_trace', 'max_loops_per_trace',
               'avg_loop_size_per_trace', 'max_loop_size_per_trace', 'n_traces_with_repetition',
               'avg_traces_with_repetition']
comparison_based = ['number_of_successions', 'number_of_ties', 'structure', 'average_affinity',
                    'lempel_ziv_complexity', 'deviation_from_random', 'average_edit_distance']
dfg_based = ['n_nodes_dfg', 'n_edges_dfg', 'coeff_of_connectivity_dfg', 'avg_node_degree_dfg',
             'max_node_degree_dfg', 'density_dfg', 'structure_dfg', 'cyclomatic_number_dfg',
             'n_cut_vertices_dfg', 'separability_ratio_dfg', 'sequentiality_ratio_dfg', 'cyclicity_dfg']

all_measures = {'simple_stats': simple_stats,
                'trace_length':  trace_length,
                'trace_variant': trace_variant,
                'activities': activities,
                'start_activities': start_activities,
                'end_activities': end_activities,
                'eventropies': eventropies,
                'epa_based': epa_based,
                'trace_diversity': trace_diversity,
                'distinct_activities': distinct_activities,
                'repetitions': repetitions,
                'comparison_based': comparison_based,
                'dfg_based': dfg_based}

# Possible user responses when asked for the source of complexity scores.
# They are defined as global variables so we can access them from different functions.
calculate_scores = "I want to compute the complexity of the event logs in the folder " + INPUT_PATH + " and analyze these data."
use_data_from_file = "I want to analyze the complexity scores collected in a .csv file."

from pathlib import Path

# constants for storing output files
INPUT_PATH = "./input-logs/"
OUTPUT_PATH = "./output/"
LATEX_REPORT_PATH = "./output/report.tex"
prom4py_script_path = Path('path-to-your-ProM4Py-distribution')

# constants for measure calculation timeouts and abort behavior
timeout_seconds = 5
abort_key = {"code": '\x18', "label": 'Ctrl+X'}

# constants for handling event logs
case_specifier = 'case:concept:name'
activity_specifier = 'concept:name'
timestamp_specifier = 'time:timestamp'

# constants for printing on command line with color
SUCCESS_COLOR = "\033[92m"
FAILURE_COLOR = "\033[91m"
RESET_COLOR = "\x1b[0m"

# constants for links to papers
paper_hybrid_ilp_miner = "https://doi.org/10.1007/s00607-017-0582-5"

# constants for the factor analysis
bartlett_p_value_threshold = 0.05
msa_threshold = 0.6
ignore_threshold = 0.35
number_of_decimals = 4

"""The wall times of the parts of an analysis (core.analyze, "timings")."""

from __future__ import annotations

import pandas as pd

from factor_analysis import catalog as cat
from factor_analysis import core, storage


def _data() -> pd.DataFrame:
    entry = cat.bundled_entry("comfy-paper-alpha-miner")
    return storage.as_stored(core.clean_matrix(pd.read_csv(cat.DATASETS_DIR / entry["file"], index_col=0)).data)


def test_an_analysis_times_its_parts_and_says_what_came_from_the_cache():
    data = _data()
    # A rotation no other test asks for with three factors, so that the first fit is computed here.
    params = core.AnalysisParams(n_factors=3, rotation="quartimax", msa_threshold=0.55)
    first = core.analyze(data, params)["timings"]
    again = core.analyze(data, params)["timings"]
    assert set(first) == {"suitability_s", "parallel_analysis_s", "parallel_analysis_cached", "fit_s", "fit_cached", "total_s"}
    assert first["fit_cached"] is False and first["fit_s"] > 0
    # The fit and the random eigenvalues are cached; they keep the time their computation took.
    assert again["fit_cached"] is True and again["fit_s"] == first["fit_s"]
    assert again["parallel_analysis_cached"] is True
    assert again["parallel_analysis_s"] == first["parallel_analysis_s"] > 0
    assert 0 < first["suitability_s"] <= first["total_s"]

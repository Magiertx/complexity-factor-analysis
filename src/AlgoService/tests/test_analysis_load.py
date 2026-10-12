"""What keeps analyses from loading the server: the measure cap."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from factor_analysis import core


def _wide_csv(columns: int, rows: int = 12) -> bytes:
    rng = np.random.default_rng(1)
    table = pd.DataFrame(rng.normal(size=(rows, columns)), columns=[f"m{i}" for i in range(columns)])
    return table.to_csv(index_label="observation").encode()


def test_the_cap_counts_the_measures_left_after_excluding(monkeypatch):
    monkeypatch.setattr(core, "MAX_MEASURES", 5)
    data = pd.DataFrame(np.random.default_rng(0).normal(size=(40, 6)), columns=list("abcdef"))
    with pytest.raises(core.AnalysisError) as e:
        core.analyze(data, core.AnalysisParams())
    assert e.value.code == "too_many_measures_for_analysis"
    assert e.value.params == {"max": 5, "n": 6}
    core.analyze(data, core.AnalysisParams(excluded=["f"], auto_msa_filter=False, n_factors=1))


def test_an_analysis_over_400_measures_is_refused_before_anything_runs(client, monkeypatch):
    def no_fit(*args, **kwargs):
        raise AssertionError("fitted despite the cap")

    monkeypatch.setattr(core, "kmo", no_fit)
    monkeypatch.setattr(core, "_fit_factors", no_fit)
    r = client.post(
        "/factor-analysis/datasets",
        data={"kind": "model", "source": "csv"},
        files=[("files", ("wide.csv", _wide_csv(401), "text/csv"))],
    )
    assert r.status_code == 200, r.text
    url = f"/factor-analysis/datasets/{r.json()['dataset_id']}"

    r = client.post(f"{url}/analyze", json={})
    assert r.status_code == 400
    assert r.json()["code"] == "too_many_measures_for_analysis"
    assert r.json()["params"] == {"max": 400, "n": 401}
    assert "Exclude measures" in r.json()["detail"]
    # Saving such options is refused the same way.
    assert client.put(f"{url}/options", json={}).json()["code"] == "too_many_measures_for_analysis"
    # One excluded measure brings it down to the cap; then the 12 rows are too few.
    r = client.post(f"{url}/analyze", json={"excluded": ["m0"]})
    assert r.json()["code"] == "too_few_observations"

"""Where each measure comes from, as the catalog names it (factor_analysis/catalog.py): the sheet of
a measure points to the function that computes it instead of defining it in words of its own."""

from __future__ import annotations

import pytest

from factor_analysis import catalog as cat


def test_a_model_measure_is_the_function_of_comfy_its_class_calls():
    measures = {m["key"]: m for m in cat.catalog("model")["measures"]}
    assert len(measures) == 17 and all("source" in m for m in measures.values())
    size = measures["Size"]["source"]
    assert size == {
        "name": "ComFy",
        "function": "measure_size",
        "file": "modelcomplexity/ModelComplexity.py",
        "commit": "1dd6ea6",
        "url": "https://github.com/Pati-nets/ComFy/blob/1dd6ea6/modelcomplexity/ModelComplexity.py",
    }
    assert measures["Coefficient of network connectivity"]["source"]["function"] == "measure_coefficient_of_network_connectivity"
    # The function exists in the vendored copy of that file.
    from vendored.comfy.modelcomplexity import ModelComplexity

    for m in measures.values():
        assert callable(getattr(ModelComplexity, m["source"]["function"])), m["key"]


def test_every_log_measure_has_the_method_and_file_of_feeed_that_compute_it():
    from feeed import feature_extractor as fx

    measures = cat.catalog("log")["measures"]
    assert len(measures) == 146
    for m in measures:
        source = m["source"]
        # What feeed itself picks for the feature, found without importing it.
        klass = getattr(fx, fx.feature_type(m["key"]))
        assert source["function"] == f"{klass.__name__}.{m['key']}", m["key"]
        assert source["file"] == klass.__module__.replace(".", "/") + ".py", m["key"]
        assert source["url"] == f"https://github.com/andreamalhera/feeed/blob/b28fb49/{source['file']}"
        assert source["name"] == "feeed" and source["commit"] == "b28fb49"
    entropy = next(m for m in measures if m["key"] == "trace_len_max")
    assert entropy["source"]["file"] == "feeed/trace_length.py" and entropy["group"] == "trace_length"


def test_the_catalog_serves_the_sources(client):
    for kind in ("model", "log"):
        served = client.get("/factor-analysis/catalog", params={"kind": kind}).json()["measures"]
        assert all(m["source"]["url"].startswith("https://github.com/") for m in served)

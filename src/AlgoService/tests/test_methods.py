"""The methods paragraph and the BibTeX entries it cites (factor_analysis/methods.py).

The paragraph is read from the analysis: the first tests build it from a made-up result, so that
the whole text can be compared for three combinations of settings; the others run the routes and
compare the numbers in the text with those of the analysis."""

from __future__ import annotations

import re
import shutil
import subprocess

import pytest

from factor_analysis import methods

TOOL = {"name": "Complexity Factor Analysis", "version": "v0.12-3-gabcdef0", "commit": "0123456789abcdef0123"}
LIBRARIES = {"factor_analyzer": "0.5.1"}
IMPORTANT_FACTORS = {"citation": 'Data of the paper "Important Factors: Complexity Dimensions for Petri Nets" (ATAED 2026)'}


def _result(**changes) -> dict:
    """The parts of an analysis the paragraph reads: 15 measures, 3 of them removed by the MSA filter."""
    result = {
        "n_observations": 288,
        "n_factors": 4,
        "rotation": "varimax",
        "assignment_rule": "multi",
        "loading_threshold": 0.35,
        "communality_threshold": 0.3,
        "assignment": {
            "rule": "multi", "loading_threshold": 0.35, "loading_strict": True, "communality_threshold": 0.3,
            "cross_loading_gap": 0.15,
        },
        "bartlett": {"chi_square": 6822.441421, "df": 66, "p_value": 0.0, "alpha": 0.05, "passed": True, "regularised": False},
        "kmo": {"overall": 0.74667, "threshold": 0.6, "per_measure": {}},
        "msa_filter": {
            "enabled": True,
            "removed": [{"measure": "a", "msa": 0.5, "step": 1}, {"measure": "b", "msa": 0.55, "step": 1}, {"measure": "c", "msa": 0.58, "step": 2}],
        },
        "used_measures": [f"m{i}" for i in range(12)],
        "factor_count": {"kaiser": 2, "parallel_analysis": 3, "method": "pca", "seed": 20261012, "simulations": 100, "percentile": 95},
        "variance": {"cumulative": [0.37, 0.56, 0.74, 0.85123]},
        "loadings": {f"m{i}": [0.0] * 4 for i in range(12)},
        "unassigned_details": [{"measure": "m3", "reason": "low_loading"}],
        "miner": None,
    }
    result.update(changes)
    return result


def _dataset(**changes) -> dict:
    dataset = {
        "name": "Inductive miner", "kind": "model", "source": "bundled",
        "measures": [f"m{i}" for i in range(15)], "dropped": [{"name": "x", "reason": "constant"}],
    }
    dataset.update(changes)
    return dataset


def _cited(text: str) -> list[str]:
    return [key for group in re.findall(r"\\cite\{([^}]*)\}", text) for key in group.split(",")]


def test_the_published_settings_of_a_bundled_dataset():
    built = methods.methods(
        language="en", dataset=_dataset(), result=_result(), requested_factors=4, excluded=[], tool=TOOL,
        libraries=LIBRARIES, entry=IMPORTANT_FACTORS,
    )
    assert built.text == (
        'The dataset "Inductive miner" has 288 observations of 15 model complexity measures after cleaning, '
        "published with \\cite{schalk2026important}, whose measures were computed with \\cite{schalk_comfy}. "
        "1 measure was dropped in cleaning because it has no variance or repeats another measure. "
        "The factor analysis was run with Complexity Factor Analysis v0.12-3-gabcdef0 (commit 01234567)~\\cite{cfa_tool}, "
        "which extracts the factors with the minimum residual (minres)\\cite{harman1966} method of the Python package "
        "factor\\_analyzer 0.5.1~\\cite{factor_analyzer}. "
        "Bartlett's test of sphericity~\\cite{bartlett1950} was significant ($\\chi^2(66) = 6822.4$, $p < 0.001$, "
        "$\\alpha = 0.05$), and the overall Kaiser-Meyer-Olkin measure of sampling adequacy~\\cite{kaiser1974} was 0.75. "
        "Of the 15 measures that remained after cleaning, 12 entered the analysis "
        "(3 removed by the MSA filter, which drops measures below an MSA of 0.60, in 2 rounds). "
        "The number of factors was set to 4; the Kaiser criterion~\\cite{kaiser1960} suggests 2, parallel analysis~\\cite{horn1965} 3 "
        "(100 simulations, 95th percentile, seed 20261012). "
        "Variance explained by the factors: 85.1\\%. The factors were rotated with the varimax rotation~\\cite{kaiser1958}. "
        "Each measure was assigned to every factor on which its absolute loading exceeds 0.35 and lies at most 0.15 "
        "below its largest absolute loading, if its communality is at least 0.30 (multiple membership, after Lieben et al.~\\cite{lieben2018improved}); "
        "1 measure was assigned to no factor."
    )
    assert built.keys == [
        "schalk2026important", "schalk_comfy", "cfa_tool", "harman1966", "factor_analyzer", "bartlett1950",
        "kaiser1974", "kaiser1960", "horn1965", "kaiser1958", "lieben2018improved",
    ]
    assert sorted(_cited(built.text)) == sorted(built.keys)
    assert "lieben2018improved" in built.keys


def test_the_kaiser_criterion_in_german_with_an_oblique_rotation_and_the_filter_off():
    result = _result(
        rotation="promax", n_factors=2,
        msa_filter={"enabled": False, "removed": []},
        used_measures=[f"m{i}" for i in range(14)],
        variance={"cumulative": []},
        assignment={"rule": "largest", "loading_threshold": 0.35, "loading_strict": False, "communality_threshold": 0.0, "cross_loading_gap": 0.15},
        bartlett={"chi_square": 120.04, "df": 91, "p_value": 0.0123, "alpha": 0.01, "passed": False, "regularised": True},
        kmo={"overall": 0.5, "threshold": 0.6, "per_measure": {}},
        unassigned_details=[],
    )
    built = methods.methods(
        language="de", dataset=_dataset(name="Eigene & Daten", source="csv", dropped=[]), result=result, requested_factors=None,
        excluded=["m14"], tool={**TOOL, "version": None}, libraries=LIBRARIES,
    )
    assert built.text.startswith(
        "Der Datensatz \u201eEigene \\& Daten\u201c hat 288 Beobachtungen von 15 Komplexit\u00e4tsma\u00dfen von Modellen. "
        "Die Faktorenanalyse wurde mit"
    )
    for part in (
        "Die Faktorenanalyse wurde mit Complexity Factor Analysis (Commit 01234567)~\\cite{cfa_tool} durchgef\u00fchrt",
        "Bartletts Test auf Sph\u00e4rizit\u00e4t~\\cite{bartlett1950} war nicht signifikant ($\\chi^2(91) = 120{,}0$, $p = 0{,}012$, $\\alpha = 0{,}01$)",
        "Kaiser-Meyer-Olkin-Ma\u00df der Stichprobeneignung insgesamt~\\cite{kaiser1974} betrug 0,50.",
        "Die Korrelationsmatrix ist singul\u00e4r",
        "Von den 15 Ma\u00dfen, die nach der Bereinigung blieben, gingen 14 in die Analyse ein (1 von Hand ausgeschlossen; der MSA-Filter war aus).",
        "Die Zahl der Faktoren folgte dem Kaiser-Kriterium~\\cite{kaiser1960} und betrug 2; die Parallelanalyse~\\cite{horn1965} schl\u00e4gt 3 vor "
        "(100 Simulationen, 95. Perzentil, Seed 20261012).",
        "Die Faktoren wurden mit der Rotation Promax rotiert.",
        "wenn dieser mindestens 0,35 betr\u00e4gt; jedes Ma\u00df wurde zugeordnet.",
    ):
        assert part in built.text, part
    # An oblique rotation has no cumulative share, and nothing is said of one.
    assert "erkl\u00e4rte Varianz" not in built.text
    assert built.keys[-1] != "hair_multivariate" and "schalk_comfy" not in built.keys


def test_the_rule_of_hair_and_the_rows_of_a_miner_in_a_log_dataset():
    result = _result(
        n_observations=50, n_factors=3, rotation="none",
        assignment={"rule": "hair", "loading_threshold": 0.35, "loading_strict": True, "communality_threshold": 0.5, "cross_loading_gap": 0.15},
        miner={"name": "Alpha miner", "n_observations": 50, "n_measures": 12, "dropped": [{"measure": "z", "reason": "constant"}]},
        msa_filter={"enabled": True, "removed": []},
        unassigned_details=[{"measure": "m1", "reason": "cross_loading"}, {"measure": "m2", "reason": "low_communality"}],
    )
    entry = {"citation": "Data of ComFy for Log Measures by Patrizia Schalk"}
    built = methods.methods(
        language="en", dataset=_dataset(name="logs_1", kind="log"), result=result, requested_factors=3, excluded=[], tool=TOOL,
        libraries=LIBRARIES, entry=entry,
    )
    for part in (
        'The dataset "logs\\_1" has 50 observations of 12 event log complexity measures after cleaning (the rows of the Alpha miner), '
        "whose measures were computed with \\cite{schalk_comfy_log}.",
        "1 measure was dropped in cleaning",
        "(no measure fell below an MSA of 0.60)",
        "The factors were not rotated.",
        "(as in Table 17 of Important Factors, with the thresholds of Hair et al.~\\cite{hair_multivariate}); 2 measures were assigned to no factor.",
        "if that loading exceeds 0.35 and its communality is at least 0.50",
    ):
        assert part in built.text, part
    assert built.keys[-1] == "hair_multivariate" and "schalk_comfy_log" in built.keys


def test_the_hair_rule_names_the_second_loading_condition_in_full():
    result = _result(assignment={
        "rule": "hair", "loading_threshold": 0.35, "loading_strict": False, "communality_threshold": 0.5, "cross_loading_gap": 0.15,
    })
    for language, part in (
        ("en", "a measure with another loading that also is at least 0.35 and lies at most 0.15 below its largest was left out"),
        ("de", "ein Maß mit einer weiteren Ladung, die ebenfalls mindestens 0,35 beträgt und höchstens 0,15 darunter liegt, blieb unzugeordnet"),
    ):
        built = methods.methods(
            language=language, dataset=_dataset(), result=result, requested_factors=None, excluded=[], tool=TOOL,
            libraries=LIBRARIES, entry=None,
        )
        assert part in built.text, part


def test_uploaded_logs_are_described_as_measured_with_feeed():
    built = methods.methods(
        language="en", dataset=_dataset(kind="log", source="logs"), result=_result(), requested_factors=None, excluded=[],
        tool=TOOL, libraries=LIBRARIES, entry=None,
    )
    assert ", whose measures were extracted with feeed, as in \cite{schalk_comfy_log}" in built.text
    assert "computed with" not in built.text
    german = methods.methods(
        language="de", dataset=_dataset(kind="log", source="logs"), result=_result(), requested_factors=None, excluded=[],
        tool=TOOL, libraries=LIBRARIES, entry=None,
    )
    assert ", deren Maße wie in \cite{schalk_comfy_log} mit feeed berechnet wurden" in german.text


def test_a_communality_threshold_of_zero_is_not_stated():
    for rule in ("largest", "multi", "hair"):
        result = _result(assignment={
            "rule": rule, "loading_threshold": 0.35, "loading_strict": True, "communality_threshold": 0.0, "cross_loading_gap": 0.15,
        })
        for language in ("en", "de"):
            built = methods.methods(
                language=language, dataset=_dataset(), result=result, requested_factors=None, excluded=[], tool=TOOL,
                libraries=LIBRARIES, entry=None,
            )
            assert "ommunality" not in built.text and "Kommunalität" not in built.text, (rule, language)


def test_an_unknown_language_is_refused():
    with pytest.raises(ValueError):
        methods.methods(
            language="fr", dataset=_dataset(), result=_result(), requested_factors=None, excluded=[], tool=TOOL, libraries=LIBRARIES
        )


def test_the_entries_are_those_of_the_keys_cited():
    built = methods.methods(
        language="en", dataset=_dataset(), result=_result(), requested_factors=None, excluded=[], tool=TOOL,
        libraries=LIBRARIES, entry=IMPORTANT_FACTORS,
    )
    bib = methods.bibtex(built.keys, TOOL, LIBRARIES, 2026)
    assert re.findall(r"^@\w+\{([^,]+),", bib, flags=re.M) == built.keys
    # Well-known data as they are.
    assert "doi = {10.1007/BF02291575}" in bib and "pages = {141--151}" in bib
    # The tool as exported; the author of its history and no address.
    assert "note = {Version v0.12-3-gabcdef0, commit 0123456789abcdef0123}" in bib
    assert "version 0.5.1" in bib
    # What is not recorded is said, not filled in.
    assert re.search(r"^% .*complete the entry from the paper", bib, flags=re.M)
    # Every source the paragraph names has its entry, with the data checked against the sources.
    assert "@article{kaiser1958," in bib and "doi = {10.1007/BF02289233}" in bib
    assert "@article{harman1966," in bib and "doi = {10.1007/BF02289468}" in bib
    assert "@inproceedings{lieben2018improved," in bib and "pages = {49--62}" in bib
    assert "title = {{ComFy: A tool to perform factor analyses on complexity measures}}" in bib
    with pytest.raises(KeyError):
        methods.bibtex(["lieben2018"], TOOL, LIBRARIES, 2026)


def test_the_download_has_an_entry_for_every_key_cited():
    for language in methods.LANGUAGES:
        for rule in ("largest", "multi", "hair"):
            for rotation in ("varimax", "promax", "oblimin", "quartimax", "none"):
                result = _result(
                    rotation=rotation,
                    assignment={"rule": rule, "loading_threshold": 0.35, "loading_strict": True, "communality_threshold": 0.3, "cross_loading_gap": 0.15},
                )
                built = methods.methods(
                    language=language, dataset=_dataset(), result=result, requested_factors=None, excluded=[], tool=TOOL,
                    libraries=LIBRARIES, entry=IMPORTANT_FACTORS,
                )
                bib = methods.bibtex(built.keys, TOOL, LIBRARIES, 2026)
                assert sorted(re.findall(r"^@\w+\{([^,]+),", bib, flags=re.M)) == sorted(built.keys)
                assert sorted(set(_cited(built.text))) == sorted(built.keys)


@pytest.mark.parametrize("rotation, cited", [("varimax", True), ("promax", False), ("oblimin", False), ("quartimax", False)])
def test_only_varimax_cites_kaiser_1958(rotation, cited):
    built = methods.methods(
        language="en", dataset=_dataset(), result=_result(rotation=rotation), requested_factors=None, excluded=[],
        tool=TOOL, libraries=LIBRARIES, entry=IMPORTANT_FACTORS,
    )
    assert ("kaiser1958" in built.keys) is cited
    assert ("\\cite{kaiser1958}" in built.text) is cited


@pytest.mark.parametrize("language", methods.LANGUAGES)
def test_minres_cites_harman_and_jones_directly_after_its_name(language):
    built = methods.methods(
        language=language, dataset=_dataset(), result=_result(), requested_factors=None, excluded=[], tool=TOOL,
        libraries=LIBRARIES, entry=IMPORTANT_FACTORS,
    )
    assert "(minres)\\cite{harman1966}" in built.text and "harman1966" in built.keys


# --- the routes ----------------------------------------------------------------------------

BUNDLED = "comfy-paper-inductive-miner"
OPTIONS = {"n_factors": 4, "rotation": "varimax", "assignment_rule": "multi"}


@pytest.fixture
def url(client) -> str:
    r = client.post("/factor-analysis/datasets", data={"kind": "model", "source": "bundled", "bundled_id": BUNDLED})
    assert r.status_code == 200, r.text
    return f"/factor-analysis/datasets/{r.json()['dataset_id']}"


def test_the_paragraph_has_the_numbers_of_the_analysis(client, url):
    result = client.post(f"{url}/analyze", json=OPTIONS).json()
    body = client.post(f"{url}/export/methods", json=OPTIONS).json()
    text = body["text"]
    assert body["language"] == "en"
    assert f"{result['n_observations']} observations" in text
    assert f"$\\chi^2({result['bartlett']['df']}) = {result['bartlett']['chi_square']:.1f}$" in text
    assert f"was {result['kmo']['overall']:.2f}." in text
    assert f"{len(result['used_measures'])} entered the analysis" in text
    assert f"{len(result['msa_filter']['removed'])} removed by the MSA filter" in text
    assert "The number of factors was set to 4" in text
    assert f"{result['factor_count']['kaiser']}, parallel analysis" in text
    assert f"{result['variance']['cumulative'][-1] * 100:.1f}\\%" in text
    "\\cite{schalk2026important}" in text
    assert body["citation_keys"][:2] == ["schalk2026important", "schalk_comfy"]
    # German, with decimal commas.
    de = client.post(f"{url}/export/methods", json={**OPTIONS, "language": "de"}).json()["text"]
    assert f"betrug {result['kmo']['overall']:.2f}".replace(".", ",") + "." in de
    assert de.count("\\cite{") == text.count("\\cite{")


def test_the_settings_change_the_paragraph(client, url):
    kaiser = client.post(f"{url}/export/methods", json={"rotation": "promax", "assignment_rule": "hair"}).json()
    assert "followed the Kaiser criterion" in kaiser["text"]
    assert "promax rotation" in kaiser["text"] and "Variance explained" not in kaiser["text"]
    assert "hair_multivariate" in kaiser["citation_keys"]
    off = client.post(f"{url}/export/methods", json={**OPTIONS, "auto_msa_filter": False}).json()["text"]
    assert "the MSA filter was off" in off
    excluded = client.post(f"{url}/export/methods", json={**OPTIONS, "excluded": ["Density"]}).json()["text"]
    assert "1 excluded by hand" in excluded


def test_the_bibtex_matches_the_paragraph(client, url):
    keys = client.post(f"{url}/export/methods", json=OPTIONS).json()["citation_keys"]
    r = client.post(f"{url}/export/bibtex", json=OPTIONS)
    assert r.status_code == 200
    assert r.headers["content-disposition"].endswith('-references.bib"')
    assert re.findall(r"^@\w+\{([^,]+),", r.text, flags=re.M) == keys
    # An analysis that fails is the same error as for the other exports.
    bad = client.post(f"{url}/export/bibtex", json={"n_factors": 99})
    assert bad.status_code == 400


def test_a_dataset_that_does_not_exist_has_no_paragraph(client):
    r = client.post("/factor-analysis/datasets/00000000-0000-0000-0000-000000000000/export/methods", json={})
    assert r.status_code == 404


def _german_paragraph(**changes) -> str:
    result = _result(
        bartlett={"chi_square": 6822.4, "df": 66, "p_value": 0.0004, "alpha": 0.05, "passed": True, "regularised": False},
        kmo={"overall": 0.7467, "threshold": 0.6, "per_measure": {}},
        **changes,
    )
    return methods.methods(
        language="de", dataset=_dataset(), result=result, requested_factors=None, excluded=[], tool=TOOL,
        libraries=LIBRARIES,
    ).text


def test_german_numbers_inside_math_keep_their_comma_out_of_the_spacing():
    """In math LaTeX sets a space after a comma, so 6822,4 would read "6822, 4"."""
    text = _german_paragraph()
    spans = re.findall(r"\$[^$]*\$", text)
    assert spans and any("6822{,}4" in span for span in spans) and any("0{,}001" in span for span in spans)
    for span in spans:
        assert not re.search(r"\d,\d", span), span
    # Outside math the plain comma stays.
    assert "betrug 0,75." in text


@pytest.mark.skipif(shutil.which("pdflatex") is None, reason="no pdflatex; the paragraph is compiled where TeX is installed")
def test_the_german_paragraph_compiles_with_pdflatex(tmp_path):
    document = (
        "\\documentclass{article}\n\\usepackage[T1]{fontenc}\n\\usepackage{amsmath}\n\\begin{document}\n"
        + _german_paragraph()
        + "\n\\end{document}\n"
    )
    (tmp_path / "paragraph.tex").write_text(document, encoding="utf-8")
    run = subprocess.run(
        ["pdflatex", "-interaction=nonstopmode", "-halt-on-error", "paragraph.tex"],
        cwd=tmp_path, capture_output=True, text=True, timeout=120,
    )
    assert run.returncode == 0, run.stdout[-1500:]

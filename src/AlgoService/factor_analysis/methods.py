"""A methods paragraph for the analysis on screen, and the BibTeX entries it cites.

The paragraph is a template, not a text generator: every number and every setting in it is read
from the analysis (the dataset, the parameters it ran with and its result), and what the analysis
did not do is not mentioned. It is neutral and short, in English or in German, with LaTeX
``\\cite`` keys. ``bibtex`` writes the entries of the keys a paragraph cites, no others.

The references are of two kinds. Those with a source in this repository (the tool, the
published datasets of the catalog) or well-known bibliographic data (Kaiser, Bartlett, Horn, the
package ``factor_analyzer``) are given as they are known. Where a field is not recorded here (the
edition of a textbook, the authors of a paper beyond the one the catalog names) the entry says so in
a comment above it and leaves the field out, rather than filling it in. The sources of the
extraction (Harman and Jones), of the varimax rotation (Kaiser) and of the multiple-membership rule
(Lieben et al.) are cited where the paragraph names them; the other rotations are named without a key.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from version import REPOSITORY_URL

from .report import tex

LANGUAGES = ("en", "de")

#: Where the catalog of the bundled datasets says its data come from, by the title in the
#: citation of an entry (``datasets/manifest.json``): the key of that reference.
_COLLECTION_KEYS = (
    ("Important Factors", "schalk2026important"),
    ("Cleaning Up the Measure Mess", "measure_mess"),
)


@dataclass(frozen=True)
class Methods:
    """The paragraph and the keys it cites, in the order of their first citation."""

    language: str
    text: str
    keys: list[str]


# --- the references -----------------------------------------------------------------------


def _article(
    author: str, title: str, journal: str, volume: str, number: str, pages: str, year: str, doi: str
) -> list[tuple[str, str]]:
    return [
        ("author", author), ("title", title), ("journal", journal), ("volume", volume), ("number", number),
        ("pages", pages), ("year", year), ("doi", doi),
    ]


#: Fields of each reference, by key; ``type`` is the BibTeX entry type, ``comment`` says what the
#: repository or the entry does not record. Software has the type ``misc``, which every BibTeX
#: style knows.
REFERENCES: dict[str, dict[str, Any]] = {
    "kaiser1960": {
        "type": "article",
        "fields": _article(
            "Kaiser, Henry F.", "The Application of Electronic Computers to Factor Analysis",
            "Educational and Psychological Measurement", "20", "1", "141--151", "1960", "10.1177/001316446002000116",
        ),
    },
    "kaiser1974": {
        "type": "article",
        "fields": _article(
            "Kaiser, Henry F.", "An Index of Factorial Simplicity", "Psychometrika", "39", "1", "31--36", "1974",
            "10.1007/BF02291575",
        ),
    },
    "bartlett1950": {
        "type": "article",
        "fields": _article(
            "Bartlett, M. S.", "Tests of Significance in Factor Analysis",
            "British Journal of Statistical Psychology", "3", "2", "77--85", "1950", "10.1111/j.2044-8317.1950.tb00285.x",
        ),
    },
    "horn1965": {
        "type": "article",
        "fields": _article(
            "Horn, John L.", "A Rationale and Test for the Number of Factors in Factor Analysis", "Psychometrika",
            "30", "2", "179--185", "1965", "10.1007/BF02289447",
        ),
    },
    # The references of the stability, checked against Crossref (api.crossref.org/works/<doi>).
    "efron1993": {
        "type": "book",
        "fields": [
            ("author", "Efron, Bradley and Tibshirani, Robert J."), ("title", "An Introduction to the Bootstrap"),
            ("publisher", "Springer US"), ("year", "1993"), ("doi", "10.1007/978-1-4899-4541-9"),
        ],
    },
    "zhang2010bootstrap": {
        "type": "article",
        "fields": _article(
            "Zhang, Guangjian and Preacher, Kristopher J. and Luo, Shanhong",
            "Bootstrap Confidence Intervals for Ordinary Least Squares Factor Loadings and Correlations in "
            "Exploratory Factor Analysis",
            "Multivariate Behavioral Research", "45", "1", "104--134", "2010", "10.1080/00273170903504836",
        ),
    },
    "kuhn1955": {
        "type": "article",
        "fields": _article(
            "Kuhn, H. W.", "The Hungarian Method for the Assignment Problem", "Naval Research Logistics Quarterly",
            "2", "1--2", "83--97", "1955", "10.1002/nav.3800020109",
        ),
    },
    "lorenzoseva2006": {
        "type": "article",
        "fields": _article(
            "Lorenzo-Seva, Urbano and ten Berge, Jos M. F.",
            "Tucker's Congruence Coefficient as a Meaningful Index of Factor Similarity", "Methodology", "2", "2",
            "57--64", "2006", "10.1027/1614-2241.2.2.57",
        ),
    },
    "kaiser1958": {
        "type": "article",
        "fields": _article(
            "Kaiser, Henry F.", "The Varimax Criterion for Analytic Rotation in Factor Analysis", "Psychometrika",
            "23", "3", "187--200", "1958", "10.1007/BF02289233",
        ),
    },
    "harman1966": {
        "type": "article",
        "fields": _article(
            "Harman, Harry H. and Jones, Wayne H.", "Factor Analysis by Minimizing Residuals (Minres)",
            "Psychometrika", "31", "3", "351--368", "1966", "10.1007/BF02289468",
        ),
    },
    "lieben2018improved": {
        "type": "inproceedings",
        "fields": [
            ("author", "Lieben, Jonas and Jouck, Toon and Depaire, Beno{\\^\\i}t and Jans, Mieke"),
            ("title", "An Improved Way for Measuring Simplicity During Process Discovery"),
            ("booktitle", "EOMAS 2018"), ("series", "LNBIP"), ("pages", "49--62"), ("year", "2018"),
            ("doi", "10.1007/978-3-030-00787-4_4"),
        ],
    },
    "hair_multivariate": {
        "type": "book",
        "comment": (
            "Hair et al., after whom the rule of Tab. 17 of Important Factors is named. Edition, title, publisher and "
            "ISBN as in the references of Important Factors and Google Books, which name three authors; check the "
            "authors against the title page."
        ),
        "fields": [
            ("author", "Hair, Joseph F. and Black, William C. and Babin, Barry J. and Anderson, Rolph E."),
            ("title", "Multivariate Data Analysis: A Global Perspective"), ("edition", "7"),
            ("publisher", "Pearson Education"), ("year", "2010"), ("isbn", "9780135153093"),
        ],
    },
    "schalk2026important": {
        "type": "inproceedings",
        "comment": "As in the CEUR proceedings, Vol. 4236; the pages are not recorded: complete the entry from the paper.",
        "fields": [
            ("author", "Schalk, Patrizia"),
            ("title", "Important Factors: Complexity Dimensions for Petri Nets"),
            ("booktitle", "PETRI NETS 2026 Workshop Proceedings (ATAED'26)"),
            ("series", "CEUR Workshop Proceedings"), ("volume", "4236"), ("year", "2026"),
            ("url", "https://ceur-ws.org/Vol-4236/paper14.pdf"),
        ],
    },
    "measure_mess": {
        "type": "misc",
        "comment": (
            "Title as in datasets/manifest.json of this tool. Its authors, venue and year are not recorded there: "
            "complete the entry from the paper."
        ),
        "fields": [("title", "Cleaning Up the Measure Mess: A Factor Analysis on Event Log Measures")],
    },
    "schalk_comfy": {
        "type": "misc",
        "comment": "Name, author and address as in datasets/manifest.json of this tool, the year that of the first commit of the repository; the version is not recorded there.",
        "fields": [
            ("author", "Schalk, Patrizia"),
            ("title", "{ComFy: A tool to perform factor analyses on complexity measures}"), ("year", "2026"),
            ("howpublished", "\\url{https://github.com/Pati-nets/ComFy}"), ("note", "Software"),
        ],
    },
    "schalk_comfy_log": {
        "type": "misc",
        "comment": "Name, author and address as in datasets/manifest.json of this tool, the year that of the first commit of the repository; the version is not recorded there.",
        "fields": [
            ("author", "Schalk, Patrizia"), ("title", "ComFy for Log Measures"), ("year", "2026"),
            ("howpublished", "\\url{https://github.com/Pati-nets/ComFy-for-Log-Measures}"), ("note", "Software"),
        ],
    },
}

#: The package the factor model is fitted with; the author and address are those of its metadata.
_FACTOR_ANALYZER = {
    "type": "misc",
    "comment": "Author and address as in the package metadata of factor_analyzer; further contributors are not listed here.",
}


def _tool_reference(tool: dict[str, Any], year: int) -> dict[str, Any]:
    version = tool.get("version")
    commit = tool.get("commit")
    note = ", ".join(
        part for part in (f"Version {version}" if version else None, f"commit {commit}" if commit else None) if part
    )
    return {
        "type": "misc",
        "comment": (
            "The tool as exported: its name, version and commit are those of the running service; the author is the "
            "one of its git history and the year that of this export. Add co-authors once the tool has a DOI."
        ),
        "fields": [
            ("author", "Reichle, Jonas"), ("title", tool.get("name") or "Complexity Factor Analysis"),
            ("year", str(year)), *([("note", note)] if note else []), ("url", REPOSITORY_URL),
        ],
    }


def _library_reference(libraries: dict[str, str | None]) -> dict[str, Any]:
    version = libraries.get("factor_analyzer")
    return {
        **_FACTOR_ANALYZER,
        "fields": [
            ("author", "Biggs, Jeremy"), ("title", "factor\\_analyzer"),
            ("howpublished", "\\url{https://github.com/EducationalTestingService/factor_analyzer}"),
            ("note", f"Python package, version {version}" if version else "Python package"),
        ],
    }


def bibtex(keys: list[str], tool: dict[str, Any], libraries: dict[str, str | None], year: int) -> str:
    """The entries of ``keys`` (those a paragraph cites) in the order given, each with the comment
    on what its source does not record. An unknown key is an error."""
    entries = {
        **REFERENCES,
        "cfa_tool": _tool_reference(tool, year),
        "factor_analyzer": _library_reference(libraries),
    }
    out = [
        "% References cited by the methods paragraph of this analysis.",
        "% Only data recorded in this repository or well-known bibliographic data are given; a comment above an",
        "% entry says what is missing and has to be completed from the source.",
        "",
    ]
    for key in keys:
        entry = entries[key]
        if entry.get("comment"):
            out.append(f"% {entry['comment']}")
        fields = ",\n".join(f"  {name} = {{{value}}}" for name, value in entry["fields"])
        out += [f"@{entry['type']}{{{key},", fields, "}", ""]
    return "\n".join(out)


# --- the paragraph ------------------------------------------------------------------------


def _tex(text: Any) -> str:
    """``report.tex`` without the break points it allows in the names of a table."""
    return tex(text).replace("\\allowbreak{}", "")


def _number(value: float, decimals: int, language: str, *, math: bool = False) -> str:
    """The value with the decimal mark of the language. Inside ``$...$`` LaTeX takes a comma for a
    punctuation mark and sets a space after it, so there it is braced: ``6822{,}4``."""
    text = f"{value:.{decimals}f}"
    if text.startswith("-") and float(text) == 0:
        text = text[1:]
    if language != "de":
        return text
    return text.replace(".", "{,}" if math else ",")


def _p_value(value: float, language: str, *, math: bool = False) -> str:
    """With its relation sign, as the suitability step writes the value: three decimals, "< 0.001" below."""
    if value < 0.001:
        return "< " + _number(0.001, 3, language, math=math)
    return "= " + _number(value, 3, language, math=math)


def _percent(share: float, language: str) -> str:
    return _number(share * 100, 1, language) + ("~\\%" if language == "de" else "\\%")


def _rounds(n: int, language: str) -> str:
    if language == "de":
        return "1 Runde" if n == 1 else f"{n} Runden"
    return "1 round" if n == 1 else f"{n} rounds"


# The text is LaTeX: \cite keys, math for the statistics, escaped special characters. {reach} is a
# predicate on the loading, with its threshold.
_TEXTS: dict[str, dict[str, str]] = {
    "en": {
        "kind_model": "model complexity measures",
        "kind_log": "event log complexity measures",
        "data": 'The dataset "{name}" has {n} observations of {m} {kind}{after}',
        "data_after": " after cleaning",
        "data_miner": " (the rows of the {miner})",
        "data_published": ", published with {cite}",
        "data_source": ", whose measures were computed with {cite}",
        "data_source_feeed": ", whose measures were extracted with feeed, as in {cite}",
        "dropped_one": "1 measure was dropped in cleaning because it has no variance or repeats another measure.",
        "dropped_many": "{n} measures were dropped in cleaning because they have no variance or repeat another measure.",
        "tool": (
            "The factor analysis was run with {tool}{cite_tool}, which extracts the factors with the minimum "
            "residual (minres){cite_minres} method of the Python package factor\\_analyzer {library}{cite_library}."
        ),
        "bartlett_yes": "Bartlett's test of sphericity{cite} was significant",
        "bartlett_no": "Bartlett's test of sphericity{cite} was not significant",
        "bartlett_values": " ($\\chi^2({df}) = {chi}$, $p {p}$, $\\alpha = {alpha}$)",
        "kmo": ", and the overall Kaiser-Meyer-Olkin measure of sampling adequacy{cite} was {kmo}.",
        "singular": (
            "The correlation matrix is singular; eigenvalues near zero were clamped, so $\\chi^2$ reflects the "
            "clamping more than the data."
        ),
        "measures_from": "Of the {m} measures that remained after cleaning, {u} entered the analysis ({parts}).",
        "excluded": "{e} excluded by hand",
        "filter_removed": "{r} removed by the MSA filter, which drops measures below an MSA of {threshold}, in {rounds}",
        "filter_off": "the MSA filter was off",
        "filter_none": "no measure fell below an MSA of {threshold}",
        "count_set": "The number of factors was set to {k}",
        "count_kaiser": "The number of factors followed the Kaiser criterion{cite} and was {k}",
        "count_suggest_both": "; the Kaiser criterion{cite_kaiser} suggests {kaiser}, parallel analysis{cite_horn} {parallel}",
        "count_suggest_pa": "; parallel analysis{cite_horn} suggests {parallel}",
        "count_pa_details": " ({simulations} simulations, {percentile}th percentile, seed {seed})",
        "variance": "Variance explained by the factors: {share}.",
        "rotation_none": "The factors were not rotated.",
        "rotation": "The factors were rotated with the {rotation} rotation{cite}.",
        "rule_largest": (
            "Each measure was assigned to the factor on which its absolute loading is largest, if that loading "
            "{reach}{comm_and}"
        ),
        "rule_multi": (
            "Each measure was assigned to every factor on which its absolute loading {reach} and lies at most {gap} "
            "below its largest absolute loading{comm_if} (multiple membership, after Lieben et al.{cite})"
        ),
        "rule_hair": (
            "Each measure was assigned to the factor on which its absolute loading is largest, if that loading "
            "{reach}{comm_and}; a measure with another loading that also {reach} and lies at most {gap} "
            "below its largest was left out (after Hair et al.{cite})"
        ),
        "comm_and": " and its communality is at least {communality}",
        "comm_if": ", if its communality is at least {communality}",
        "reach_strict": "exceeds {loading}",
        "reach_loose": "is at least {loading}",
        "unassigned_none": "; every measure was assigned.",
        "unassigned_one": "; 1 measure was assigned to no factor.",
        "unassigned_many": "; {n} measures were assigned to no factor.",
        "stability": (
            "The stability of the solution was assessed on {samples} bootstrap samples of the observations"
            "{cite_bootstrap}, each fitted with the same measures, factor count and rotation; the factors of a "
            "sample were matched to those of the solution by Tucker's congruence coefficient with the Hungarian "
            "method{cite_kuhn}{left_out}{heywood}. {stable} of {measures} measures kept their assignment in at "
            "least "
            "{share} of the samples; the mean congruence per factor was between {phi_min} and {phi_max}"
            "{cite_reading}."
        ),
        "stability_left_out": ", leaving out {n} samples whose fit failed",
        "stability_heywood": "; in {n} samples a further measure reached the Heywood bound, and they were kept",
        "stability_none": (
            "The stability of the solution was assessed on {samples} bootstrap samples of the observations"
            "{cite_bootstrap}; the fit failed on every sample."
        ),
        "short_set": (
            "As a short set, each dimension is represented by its assigned measure with the largest difference "
            "between its absolute loading on the dimension and its largest absolute loading on any other: {members}."
        ),
    },
    "de": {
        "kind_model": "Komplexitätsmaßen von Modellen",
        "kind_log": "Komplexitätsmaßen von Event Logs",
        "data": "Der Datensatz „{name}“ hat {n} Beobachtungen von {m} {kind}{after}",
        "data_after": " nach der Bereinigung",
        "data_miner": " (die Zeilen des Miners {miner})",
        "data_published": ", veröffentlicht mit {cite}",
        "data_source": ", deren Maße mit {cite} berechnet wurden",
        "data_source_feeed": ", deren Maße wie in {cite} mit feeed berechnet wurden",
        "dropped_one": "1 Maß wurde bei der Bereinigung entfernt, weil es keine Varianz hat oder ein anderes Maß wiederholt.",
        "dropped_many": (
            "{n} Maße wurden bei der Bereinigung entfernt, weil sie keine Varianz haben oder ein anderes Maß "
            "wiederholen."
        ),
        "tool": (
            "Die Faktorenanalyse wurde mit {tool}{cite_tool} durchgeführt, das die Faktoren mit dem Minimum-"
            "Residual-Verfahren (minres){cite_minres} des Python-Pakets factor\\_analyzer {library}{cite_library} extrahiert."
        ),
        "bartlett_yes": "Bartletts Test auf Sphärizität{cite} war signifikant",
        "bartlett_no": "Bartletts Test auf Sphärizität{cite} war nicht signifikant",
        "bartlett_values": " ($\\chi^2({df}) = {chi}$, $p {p}$, $\\alpha = {alpha}$)",
        "kmo": ", und das Kaiser-Meyer-Olkin-Maß der Stichprobeneignung insgesamt{cite} betrug {kmo}.",
        "singular": (
            "Die Korrelationsmatrix ist singulär; Eigenwerte nahe null wurden angehoben, daher spiegelt $\\chi^2$ "
            "die Anhebung stärker als die Daten."
        ),
        "measures_from": "Von den {m} Maßen, die nach der Bereinigung blieben, gingen {u} in die Analyse ein ({parts}).",
        "excluded": "{e} von Hand ausgeschlossen",
        "filter_removed": "{r} vom MSA-Filter entfernt, der Maße unter einem MSA von {threshold} entfernt, in {rounds}",
        "filter_off": "der MSA-Filter war aus",
        "filter_none": "kein Maß lag unter einem MSA von {threshold}",
        "count_set": "Die Zahl der Faktoren wurde auf {k} festgelegt",
        "count_kaiser": "Die Zahl der Faktoren folgte dem Kaiser-Kriterium{cite} und betrug {k}",
        "count_suggest_both": "; das Kaiser-Kriterium{cite_kaiser} schlägt {kaiser} vor, die Parallelanalyse{cite_horn} {parallel}",
        "count_suggest_pa": "; die Parallelanalyse{cite_horn} schlägt {parallel} vor",
        "count_pa_details": " ({simulations} Simulationen, {percentile}. Perzentil, Seed {seed})",
        "variance": "Durch die Faktoren erklärte Varianz: {share}.",
        "rotation_none": "Die Faktoren wurden nicht rotiert.",
        "rotation": "Die Faktoren wurden mit der Rotation {rotation}{cite} rotiert.",
        "rule_largest": (
            "Jedes Maß wurde dem Faktor zugeordnet, auf dem der Betrag seiner Ladung am größten ist, wenn "
            "dieser {reach}{comm_and}"
        ),
        "rule_multi": (
            "Jedes Maß wurde jedem Faktor zugeordnet, auf dem der Betrag seiner Ladung {reach} und von seiner "
            "größten Ladung höchstens {gap} entfernt ist{comm_if} (Mehrfachzuordnung, nach Lieben et al.{cite})"
        ),
        "rule_hair": (
            "Jedes Maß wurde dem Faktor zugeordnet, auf dem der Betrag seiner Ladung am größten ist, wenn "
            "dieser {reach}{comm_and}; ein Maß mit einer weiteren Ladung, die ebenfalls {reach} und "
            "höchstens {gap} darunter liegt, blieb unzugeordnet (nach Hair et al.{cite})"
        ),
        "comm_and": " und seine Kommunalität mindestens {communality} beträgt",
        "comm_if": ", wenn seine Kommunalität mindestens {communality} beträgt",
        "reach_strict": "über {loading} liegt",
        "reach_loose": "mindestens {loading} beträgt",
        "unassigned_none": "; jedes Maß wurde zugeordnet.",
        "unassigned_one": "; 1 Maß wurde keinem Faktor zugeordnet.",
        "unassigned_many": "; {n} Maße wurden keinem Faktor zugeordnet.",
        "stability": (
            "Die Stabilität der Lösung wurde an {samples} Bootstrap-Stichproben der Beobachtungen geprüft"
            "{cite_bootstrap}, jede mit denselben Maßen, derselben Faktorzahl und Rotation angepasst; die Faktoren "
            "einer Stichprobe wurden denen der Lösung über Tuckers Kongruenzkoeffizienten mit der Ungarischen "
            "Methode zugeordnet{cite_kuhn}{left_out}{heywood}. {stable} von {measures} Maßen behielten ihre Zuordnung in "
            "mindestens {share} der Stichproben; die mittlere Kongruenz je Faktor lag zwischen {phi_min} und "
            "{phi_max}{cite_reading}."
        ),
        "stability_left_out": ", ohne {n} Stichproben, deren Anpassung fehlschlug",
        "stability_heywood": "; in {n} Stichproben erreichte ein weiteres Maß die Heywood-Grenze, sie blieben erhalten",
        "stability_none": (
            "Die Stabilität der Lösung wurde an {samples} Bootstrap-Stichproben der Beobachtungen geprüft"
            "{cite_bootstrap}; die Anpassung schlug bei jeder Stichprobe fehl."
        ),
        "short_set": (
            "Als Kurzset steht für jede Dimension das ihr zugeordnete Maß, dessen Betrag der Ladung auf der "
            "Dimension den größten Betrag seiner Ladungen auf anderen Dimensionen am weitesten übersteigt: {members}."
        ),
    },
}

#: The source each assignment rule is named after, where the paragraph cites one.
_RULE_SOURCES = {"hair": ("hair_multivariate",), "multi": ("lieben2018improved",)}

_ROTATIONS = {"en": {}, "de": {"promax": "Promax", "varimax": "Varimax", "oblimin": "Oblimin", "quartimax": "Quartimax"}}


def methods(
    *,
    language: str,
    dataset: dict[str, Any],
    result: dict[str, Any],
    requested_factors: int | None,
    excluded: list[str],
    tool: dict[str, Any],
    libraries: dict[str, str | None],
    entry: dict[str, Any] | None = None,
    stability: dict[str, Any] | None = None,
    short_set: bool = False,
) -> Methods:
    """The methods paragraph of an analysis.

    ``dataset`` is the record the report is made from (``name``, ``kind``, ``source``, ``measures``
    after cleaning and what cleaning ``dropped``), ``result`` the analysis (with ``miner`` for the
    rows of one miner), ``requested_factors`` the factor count asked for (None: the Kaiser
    criterion decides), ``excluded`` the measures left out by hand that the analysis knew,
    ``entry`` the catalog entry of a bundled dataset. A computed ``stability``
    (``stability.bootstrap``) and, with ``short_set``, the short set of the result add a sentence
    each; without them the paragraph is as before.
    """
    if language not in LANGUAGES:
        raise ValueError(f"No methods paragraph in '{language}'.")
    t = _TEXTS[language]
    keys: list[str] = []

    def cite(*names: str, tie: bool = True) -> str:
        for name in names:
            if name not in keys:
                keys.append(name)
        return ("~" if tie else "") + "\\cite{" + ",".join(names) + "}"

    def fill(template: str, /, **values: Any) -> str:
        return t[template].format(**values)

    kind = dataset["kind"]
    miner = result.get("miner")
    measures_after = miner["n_measures"] if miner else len(dataset["measures"])
    dropped = len(miner["dropped"]) if miner else len(dataset["dropped"])

    # The data.
    published = next(
        (key for title, key in _COLLECTION_KEYS if entry and title in (entry.get("citation") or "")), None
    )
    data = fill(
        "data", name=_tex(dataset["name"]), n=result["n_observations"], m=measures_after, kind=t[f"kind_{kind}"],
        after=t["data_after"] if dropped else "",
    )
    if miner:
        data += fill("data_miner", miner=_tex(miner["name"]))
    if published:
        data += fill("data_published", cite=cite(published, tie=False))
    if dataset.get("source") in ("bundled", "logs", "pnml"):
        # Uploaded logs are measured with feeed, in the way ComFy for Log Measures does; models run through ComFy.
        template = "data_source_feeed" if dataset.get("source") == "logs" and kind == "log" else "data_source"
        data += fill(template, cite=cite("schalk_comfy" if kind == "model" else "schalk_comfy_log", tie=False))
    sentences = [data + "."]
    if dropped:
        sentences.append(fill("dropped_one") if dropped == 1 else fill("dropped_many", n=dropped))

    # The tool and its fitting.
    version = tool.get("version")
    commit = (tool.get("commit") or "")[:8]
    described = _tex(tool.get("name") or "Complexity Factor Analysis")
    described += f" {_tex(version)}" if version else ""
    described += f" ({'Commit' if language == 'de' else 'commit'} {_tex(commit)})" if commit else ""
    sentences.append(
        fill(
            "tool", tool=described, cite_tool=cite("cfa_tool"), cite_minres=cite("harman1966", tie=False),
            library=_tex(libraries.get("factor_analyzer") or ""), cite_library=cite("factor_analyzer"),
        )
    )

    # Suitability, and the measures that stayed.
    bartlett = result["bartlett"]
    kmo = result["kmo"]
    threshold = _number(kmo.get("threshold", 0.6), 2, language)
    suitability = fill("bartlett_yes" if bartlett["passed"] else "bartlett_no", cite=cite("bartlett1950"))
    suitability += fill(
        "bartlett_values", df=bartlett["df"], chi=_number(bartlett["chi_square"], 1, language, math=True),
        p=_p_value(bartlett["p_value"], language, math=True),
        alpha=_number(bartlett.get("alpha", 0.05), 2, language, math=True),
    )
    suitability += fill("kmo", cite=cite("kaiser1974"), kmo=_number(kmo["overall"], 2, language))
    sentences.append(suitability)
    if bartlett.get("regularised"):
        sentences.append(fill("singular"))
    removed = result["msa_filter"]["removed"]
    parts = [fill("excluded", e=len(excluded))] if excluded else []
    if not result["msa_filter"]["enabled"]:
        parts.append(fill("filter_off"))
    elif removed:
        parts.append(
            fill("filter_removed", r=len(removed), threshold=threshold, rounds=_rounds(max(r["step"] for r in removed), language))
        )
    else:
        parts.append(fill("filter_none", threshold=threshold))
    sentences.append(fill("measures_from", m=measures_after, u=len(result["used_measures"]), parts="; ".join(parts)))

    # The number of factors, the share of variance and the rotation.
    counts = result.get("factor_count") or {}
    k = result["n_factors"]
    if requested_factors is None:
        count = fill("count_kaiser", cite=cite("kaiser1960"), k=k)
    else:
        count = fill("count_set", k=k)
    if "parallel_analysis" in counts:
        if requested_factors is None:
            count += fill("count_suggest_pa", cite_horn=cite("horn1965"), parallel=counts["parallel_analysis"])
        else:
            count += fill(
                "count_suggest_both", cite_kaiser=cite("kaiser1960"), kaiser=counts["kaiser"],
                cite_horn=cite("horn1965"), parallel=counts["parallel_analysis"],
            )
        count += fill(
            "count_pa_details", simulations=counts.get("simulations"), percentile=counts.get("percentile"),
            seed=counts.get("seed"),
        )
    sentences.append(count + ".")
    # Oblique rotations have no cumulative share: the factors overlap.
    cumulative = (result.get("variance") or {}).get("cumulative") or []
    if cumulative:
        sentences.append(fill("variance", share=_percent(cumulative[-1], language)))
    rotation = result["rotation"]
    if rotation == "none":
        sentences.append(fill("rotation_none"))
    else:
        sentences.append(fill(
                "rotation", rotation=_ROTATIONS[language].get(rotation, rotation),
                cite=cite("kaiser1958") if rotation == "varimax" else "",
            ))

    # The rule, with the thresholds it applied.
    assignment = result.get("assignment") or {}
    rule = assignment.get("rule", result.get("assignment_rule", "largest"))
    reach = fill(
        "reach_strict" if assignment.get("loading_strict", True) else "reach_loose",
        loading=_number(assignment.get("loading_threshold", result["loading_threshold"]), 2, language),
    )
    left_out = [u for u in result.get("unassigned_details", []) if u["measure"] in result["loadings"]]
    communality = assignment.get("communality_threshold", result["communality_threshold"])
    # A communality threshold of 0 filters nothing, so the paragraph does not state it.
    communality_text = _number(communality, 2, language)
    text = fill(
        f"rule_{rule}",
        reach=reach,
        comm_and=fill("comm_and", communality=communality_text) if communality else "",
        comm_if=fill("comm_if", communality=communality_text) if communality else "",
        gap=_number(assignment.get("cross_loading_gap", 0.15), 2, language),
        cite=cite(*_RULE_SOURCES[rule]) if rule in _RULE_SOURCES else "",
    )
    if not left_out:
        text += fill("unassigned_none")
    elif len(left_out) == 1:
        text += fill("unassigned_one")
    else:
        text += fill("unassigned_many", n=len(left_out))
    sentences.append(text)
    if stability is not None:
        sentences.append(_stability_sentence(stability, fill, cite, language))
    if short_set and result.get("short_set"):
        sentences.append(fill("short_set", members=", ".join(_tex(r["measure"]) for r in result["short_set"])))
    return Methods(language, " ".join(sentences), keys)


def _stability_sentence(stability: dict[str, Any], fill: Any, cite: Any, language: str) -> str:
    bootstrap = cite("efron1993", "zhang2010bootstrap")
    if not stability["valid"]:
        return fill("stability_none", samples=stability["samples"], cite_bootstrap=bootstrap)
    failed = stability["samples"] - stability["valid"]
    phis = [f["phi_mean"] for f in stability["factors"]]
    return fill(
        "stability",
        samples=stability["samples"],
        cite_bootstrap=bootstrap,
        cite_kuhn=cite("kuhn1955"),
        left_out=fill("stability_left_out", n=failed) if failed else "",
        heywood=fill("stability_heywood", n=stability["heywood"]) if stability.get("heywood") else "",
        stable=stability["summary"]["stable"],
        measures=stability["summary"]["measures"],
        share=_number(stability["summary"]["threshold"] * 100, 0, language) + ("~\\%" if language == "de" else "\\%"),
        phi_min=_number(min(phis), 2, language),
        phi_max=_number(max(phis), 2, language),
        cite_reading=cite("lorenzoseva2006"),
    )

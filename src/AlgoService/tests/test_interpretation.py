"""Interpretation of factor analyses by Claude, with a fake Anthropic client: no network."""

from __future__ import annotations

import io
import json
from types import SimpleNamespace

import anthropic
import httpx2
import numpy as np
import pandas as pd
import pytest
from anthropic.types.beta import BetaMessage

BUNDLED = "comfy-paper-inductive-miner"
KEY = "sk-ant-test-not-a-real-key"
SDK_SECRET = "upstream-detail-that-must-not-leak"


def _message(text: str | None, stop_reason: str = "end_turn", **extra) -> BetaMessage:
    content = [] if text is None else [{"type": "text", "text": text}]
    return BetaMessage.model_validate({
        "id": "msg_test",
        "type": "message",
        "role": "assistant",
        "model": extra.pop("model", "claude-opus-5-5"),
        "content": content,
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "usage": {"input_tokens": 10, "output_tokens": 10},
        **extra,
    })


def _answer_for(kwargs: dict) -> BetaMessage:
    """A valid interpretation of whatever analysis the request carries."""
    text = kwargs["messages"][0]["content"]
    payload = json.loads(text[text.index("{"):])
    factors = [
        {
            "index": i + 1,
            "name": f"Factor name {i + 1}",
            "summary": "Two sentences. About the factor.",
            "driving_measures": [m["measure"] for m in measures][:2] + ["Not a measure"],
            "confidence": "medium",
        }
        for i, measures in enumerate(payload["assignment"]["factors"].values())
    ]
    factors.append({**factors[0], "index": 99})
    return _message(json.dumps({"factors": factors, "overall": "Overall.", "caveats": ["A caveat."]}))


class FakeMessages:
    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.outcome = _answer_for

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome(kwargs) if callable(self.outcome) else self.outcome


class FakeClient:
    def __init__(self, messages: FakeMessages) -> None:
        self.beta = SimpleNamespace(messages=messages)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


@pytest.fixture
def no_precomputed(monkeypatch, tmp_path):
    from interpretation import store

    monkeypatch.setattr(store, "PRECOMPUTED_DIR", tmp_path / "precomputed")
    return tmp_path / "precomputed"


@pytest.fixture
def claude(monkeypatch, no_precomputed) -> FakeMessages:
    from interpretation import client, quota

    messages = FakeMessages()
    keys: list[str] = []

    def factory(key):
        keys.append(key)
        return FakeClient(messages)

    monkeypatch.setenv("ANTHROPIC_API_KEY", KEY)
    monkeypatch.setattr(client, "client_factory", factory)
    quota.reset()
    messages.keys = keys
    return messages


def _rng_table(labels: list[str]) -> pd.DataFrame:
    rng = np.random.default_rng(7)
    n = len(labels)
    a, b = rng.normal(size=n), rng.normal(size=n)
    columns = {
        "Size": a, "Density": a, "Diameter": a,
        "Cyclicity": b, "Separability": b, "Sequentiality": b,
    }
    return pd.DataFrame(
        {name: 7000 + 100 * (base + 0.4 * rng.normal(size=n)) for name, base in columns.items()},
        index=labels,
    )


LABELS = [f"PATIENT-XYZ-{i:04d}" for i in range(60)]
FILENAME = "secret-plant-data.csv"
DATASET_NAME = "Confidential customer study"


@pytest.fixture
def csv_dataset(client):
    table = _rng_table(LABELS)
    text = table.to_csv(index_label="observation", float_format="%.6f")
    r = client.post(
        "/factor-analysis/datasets",
        data={"kind": "model", "source": "csv", "name": DATASET_NAME},
        files={"files": (FILENAME, io.BytesIO(text.encode()), "text/csv")},
    )
    assert r.status_code == 200, r.text
    return r.json()["dataset_id"], text


def _bundled(client) -> str:
    r = client.post("/factor-analysis/datasets", data={"kind": "model", "source": "bundled", "bundled_id": BUNDLED})
    assert r.status_code == 200, r.text
    return r.json()["dataset_id"]


def _interpret(client, dataset_id: str, **body):
    return client.post(f"/factor-analysis/datasets/{dataset_id}/interpret", json=body)


# --- status -------------------------------------------------------------------------------


def test_status_without_key(client, monkeypatch, no_precomputed):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert client.get("/factor-analysis/interpretation/status").json() == {
        "available": False, "model": None, "precomputed_only": False,
    }
    no_precomputed.mkdir()
    (no_precomputed / f"{BUNDLED}.en.json").write_text("{}")
    assert client.get("/factor-analysis/interpretation/status").json()["precomputed_only"] is True


def test_status_with_key(client, claude):
    body = client.get("/factor-analysis/interpretation/status").json()
    assert body == {"available": True, "model": "claude-opus-5-5", "precomputed_only": False}
    assert KEY not in json.dumps(body)


# --- request and payload -------------------------------------------------------------------


def test_request_shape(client, claude, csv_dataset):
    r = _interpret(client, csv_dataset[0], auto_msa_filter=False, language="de")
    assert r.status_code == 200, r.text
    (call,) = claude.calls
    assert claude.keys == [KEY]
    assert call["model"] == "claude-opus-5-5"
    assert call["fallbacks"] == "default"
    assert call["betas"] == ["server-side-fallback-2026-07-01"]
    assert call["output_config"]["effort"] == "medium"
    assert call["output_config"]["format"]["type"] == "json_schema"
    assert call["output_config"]["format"]["schema"]["required"] == ["factors", "overall", "caveats"]
    assert "thinking" not in call and "temperature" not in call
    assert "German" in call["messages"][0]["content"]
    assert "exploratory factor analysis" in call["system"]


def test_payload_carries_aggregates_only(client, claude, csv_dataset):
    dataset_id, csv_text = csv_dataset
    assert _interpret(client, dataset_id, auto_msa_filter=False).status_code == 200
    sent = json.dumps(claude.calls[0], default=str)

    for secret in [*LABELS, FILENAME, "secret-plant-data", DATASET_NAME]:
        assert secret not in sent
    raw_values = [cell for line in csv_text.splitlines()[1:] for cell in line.split(",")[1:]]
    assert raw_values and not [v for v in raw_values if v in sent]

    text = claude.calls[0]["messages"][0]["content"]
    payload = json.loads(text[text.index("{"):])
    assert payload["kind"] == "model" and payload["n_observations"] == len(LABELS)
    assert set(payload["used_measures"]) == {"Size", "Density", "Diameter", "Cyclicity", "Separability", "Sequentiality"}
    assert payload["measure_definitions"]["Size"] == "Number of places and transitions."
    assert payload["factors"] == ["Factor 1", "Factor 2"] and len(payload["loadings"]["Size"]) == 2
    for key in ("bartlett", "kmo", "eigenvalues", "communalities", "variance", "assignment", "rotation"):
        assert key in payload
    assert set(payload) >= {"removed_measures", "n_factors"}


def test_own_column_names_are_sent_as_the_disclosure_says(client, claude):
    """Column headers of an own CSV go out as measure names, without a definition; the
    values and the row labels do not."""
    own = ["Plant A throughput", "Plant A rework", "Plant A scrap", "Line 7 delay", "Line 7 queue", "Line 7 idle"]
    table = _rng_table(LABELS)
    table.columns = own
    text = table.to_csv(index_label="observation", float_format="%.6f")
    r = client.post(
        "/factor-analysis/datasets",
        data={"kind": "model", "source": "csv"},
        files={"files": ("own.csv", io.BytesIO(text.encode()), "text/csv")},
    )
    assert _interpret(client, r.json()["dataset_id"], auto_msa_filter=False).status_code == 200

    content = claude.calls[0]["messages"][0]["content"]
    payload = json.loads(content[content.index("{"):])
    assert set(payload["used_measures"]) == set(own)
    assert payload["measure_definitions"] == dict.fromkeys(own)
    for secret in LABELS:
        assert secret not in content
    raw_values = [cell for line in text.splitlines()[1:] for cell in line.split(",")[1:]]
    assert not [v for v in raw_values if v in content]


def test_payload_never_quotes_dropped_values():
    from factor_analysis.core import AnalysisParams
    from interpretation.payload import build_payload

    result = {
        "n_observations": 10, "used_measures": ["a", "b", "c"],
        "msa_filter": {"enabled": True, "removed": []},
        "bartlett": {"chi_square": 1.0, "df": 3, "p_value": 0.01, "alpha": 0.05, "passed": True},
        "kmo": {"overall": 0.7, "per_measure": {"a": 0.7, "b": 0.7, "c": 0.7}, "threshold": 0.6, "passed": True},
        "eigenvalues": [2.0, 0.6, 0.4], "suggested_n_factors": 1, "n_factors": 1, "rotation": "none",
        "loadings": {"a": [0.9], "b": [0.8], "c": [0.7]}, "structure_loadings": None,
        "factor_correlations": None, "communalities": {"a": 0.81, "b": 0.64, "c": 0.49},
        "variance": {"ss_loadings": [1.94], "proportion": [0.65], "explained": 0.65},
        "loading_threshold": 0.35, "communality_threshold": 0.0,
        "factors": [{"index": 0, "measures": [{"measure": "a", "loading": 0.9}]}], "unassigned": [],
    }
    dropped = [{"measure": "d", "reason": "non_numeric", "detail": "contains the value 'PATIENT-7'",
                "params": {"value": "PATIENT-7"}}]
    payload = build_payload("model", result, AnalysisParams(), dropped)
    assert "PATIENT-7" not in json.dumps(payload)
    assert payload["removed_measures"]["dataset_cleaning"] == [{"measure": "d", "reason": "non_numeric"}]


def test_log_groups_are_sent_once():
    from factor_analysis import catalog as cat
    from interpretation.payload import measure_definitions

    group, names = next((g, n) for g, n in cat._LogConstants.all_measures.items() if len(n) > 1)
    definitions, groups = measure_definitions("log", [*names, "own column"])
    title, text = cat.LOG_GROUPS[group]
    assert groups == {title: text}
    assert all(definitions[n] == f"group: {title}" for n in names)
    assert definitions["own column"] is None


def test_response_is_tidied(client, claude, csv_dataset):
    body = _interpret(client, csv_dataset[0], auto_msa_filter=False).json()
    assert [f["index"] for f in body["factors"]] == [1, 2]
    assert all("Not a measure" not in f["driving_measures"] for f in body["factors"])
    assert body["overall"] == "Overall." and body["caveats"] == ["A caveat."]
    assert body["model"] == "claude-opus-5-5" and body["language"] == "en"
    assert body["cached"] is False and body["precomputed"] is False
    assert body["prompt_version"] and body["created_at"]


def test_default_params_match_the_api():
    from interpretation.payload import default_params
    from routes.factor_analysis import AnalyzeRequest

    for kind in ("model", "log"):
        assert default_params(kind) == AnalyzeRequest().params(kind)


# --- cache --------------------------------------------------------------------------------


def test_cache_hit_and_miss(client, claude, csv_dataset):
    dataset_id = csv_dataset[0]
    first = _interpret(client, dataset_id, auto_msa_filter=False).json()
    second = _interpret(client, dataset_id, auto_msa_filter=False).json()
    assert len(claude.calls) == 1
    assert second["cached"] is True and second["factors"] == first["factors"]
    # The factor count the analysis chose by itself is the same as asking for it.
    assert _interpret(client, dataset_id, auto_msa_filter=False, n_factors=2).json()["cached"] is True

    _interpret(client, dataset_id, auto_msa_filter=False, language="de")
    _interpret(client, dataset_id, auto_msa_filter=False, rotation="promax")
    assert len(claude.calls) == 3

    from factor_analysis import storage

    session = next(storage.root().iterdir())
    assert len(list((session / dataset_id / "interpretations").glob("*.json"))) == 3


def test_cache_key_follows_model_effort_and_prompt(client, claude, csv_dataset, monkeypatch):
    from interpretation import client as claude_client

    _interpret(client, csv_dataset[0], auto_msa_filter=False)
    monkeypatch.setattr(claude_client, "PROMPT_DIGEST", "test-next")
    _interpret(client, csv_dataset[0], auto_msa_filter=False)
    monkeypatch.setattr(claude_client, "MODEL", "claude-other")
    _interpret(client, csv_dataset[0], auto_msa_filter=False)
    monkeypatch.setattr(claude_client, "EFFORT", "low")
    _interpret(client, csv_dataset[0], auto_msa_filter=False)
    assert len(claude.calls) == 4


def test_prompt_digest_covers_prompt_schema_and_payload_format():
    from interpretation.client import OUTPUT_SCHEMA, PROMPT_DIGEST, prompt_digest
    from interpretation.payload import PAYLOAD_FORMAT
    from interpretation.prompt import SYSTEM_PROMPT

    assert prompt_digest(SYSTEM_PROMPT, OUTPUT_SCHEMA, PAYLOAD_FORMAT) == PROMPT_DIGEST
    assert prompt_digest(SYSTEM_PROMPT + " ", OUTPUT_SCHEMA, PAYLOAD_FORMAT) != PROMPT_DIGEST
    assert prompt_digest(SYSTEM_PROMPT, {**OUTPUT_SCHEMA, "title": "x"}, PAYLOAD_FORMAT) != PROMPT_DIGEST
    assert prompt_digest(SYSTEM_PROMPT, OUTPUT_SCHEMA, PAYLOAD_FORMAT + 1) != PROMPT_DIGEST


def test_cached_only_never_calls(client, claude, csv_dataset):
    r = _interpret(client, csv_dataset[0], auto_msa_filter=False, cached_only=True)
    assert r.status_code == 204 and claude.calls == []
    _interpret(client, csv_dataset[0], auto_msa_filter=False)
    r = _interpret(client, csv_dataset[0], auto_msa_filter=False, cached_only=True)
    assert r.status_code == 200 and r.json()["cached"] is True and len(claude.calls) == 1


def test_bundled_datasets_share_the_cache(isolated_jobs_dir, claude):
    from fastapi.testclient import TestClient
    from interpretation import store
    from srv_main import app

    with TestClient(app) as alice, TestClient(app) as bob:
        assert _interpret(alice, _bundled(alice)).json()["cached"] is False
        assert _interpret(bob, _bundled(bob)).json()["cached"] is True
    assert len(claude.calls) == 1
    assert len(list(store.shared_dir().glob("*.json"))) == 1


def test_own_datasets_do_not_share_the_cache(isolated_jobs_dir, claude):
    from fastapi.testclient import TestClient
    from srv_main import app

    text = _rng_table(LABELS).to_csv(index_label="observation")
    with TestClient(app) as alice, TestClient(app) as bob:
        for c in (alice, bob):
            r = c.post(
                "/factor-analysis/datasets",
                data={"kind": "model", "source": "csv"},
                files={"files": ("same.csv", io.BytesIO(text.encode()), "text/csv")},
            )
            assert _interpret(c, r.json()["dataset_id"], auto_msa_filter=False).json()["cached"] is False
    assert len(claude.calls) == 2


# --- precomputed --------------------------------------------------------------------------


def _precompute(monkeypatch, claude, language="en"):
    import asyncio

    from factor_analysis import catalog as cat
    from interpretation import store
    from scripts import precompute_interpretations as script

    entry = cat.bundled_entry(BUNDLED)
    store.write_precomputed(BUNDLED, language, asyncio.run(script.precompute(entry, language, KEY)))
    claude.calls.clear()
    monkeypatch.delenv("ANTHROPIC_API_KEY")


def test_precomputed_without_key(client, claude, monkeypatch):
    _precompute(monkeypatch, claude)
    dataset_id = _bundled(client)

    body = _interpret(client, dataset_id).json()
    assert body["precomputed"] is True and body["cached"] is True and body["factors"]
    # The frontend sends the defaults explicitly.
    explicit = dict(auto_msa_filter=True, msa_threshold=0.6, bartlett_alpha=0.05, n_factors=None,
                    rotation="varimax", loading_threshold=0.35, communality_threshold=0.0, excluded=[])
    assert _interpret(client, dataset_id, cached_only=True, **explicit).json()["precomputed"] is True
    assert claude.calls == []

    # Other parameters or another language would need the API.
    assert _interpret(client, dataset_id, cached_only=True, rotation="promax").status_code == 204
    r = _interpret(client, dataset_id, language="de")
    assert r.status_code == 503 and r.json()["code"] == "interpretation_unavailable"
    assert client.get("/factor-analysis/interpretation/status").json()["precomputed_only"] is True


def test_precomputed_needs_the_current_prompt(client, claude, monkeypatch):
    from interpretation import client as claude_client

    _precompute(monkeypatch, claude)
    dataset_id = _bundled(client)
    monkeypatch.setattr(claude_client, "PROMPT_DIGEST", "another prompt")
    assert _interpret(client, dataset_id, cached_only=True).status_code == 204


def test_precomputed_needs_the_same_data(client, claude, monkeypatch):
    _precompute(monkeypatch, claude)
    from factor_analysis import catalog as cat

    columns = list(pd.read_csv(cat.DATASETS_DIR / cat.bundled_entry(BUNDLED)["file"], index_col=0, nrows=1).columns)
    r = client.post("/factor-analysis/datasets", data={
        "kind": "model", "source": "bundled", "bundled_id": BUNDLED, "measures": json.dumps(columns[1:]),
    })
    r = _interpret(client, r.json()["dataset_id"], cached_only=True)
    assert r.status_code == 204, r.text


def test_script_matrix_equals_the_stored_one(client):
    from factor_analysis import catalog as cat
    from factor_analysis import storage
    from interpretation.payload import data_hash
    from scripts import precompute_interpretations as script

    dataset_id = _bundled(client)
    session = next(storage.root().iterdir()).name
    data, _ = script.bundled_matrix(cat.bundled_entry(BUNDLED))
    assert data_hash(data) == data_hash(storage.load_matrix(session, dataset_id))


def test_script_skips_existing_files(claude, monkeypatch, no_precomputed, capsys):
    from scripts import precompute_interpretations as script

    assert script.main(["--dataset", BUNDLED, "--language", "en"]) == 0
    assert script.main(["--dataset", BUNDLED, "--language", "en"]) == 0
    assert "skip" in capsys.readouterr().out and len(claude.calls) == 1
    assert script.main(["--dataset", BUNDLED, "--language", "en", "--force"]) == 0
    assert len(claude.calls) == 2
    assert (no_precomputed / f"{BUNDLED}.en.json").is_file()

    monkeypatch.delenv("ANTHROPIC_API_KEY")
    assert script.main(["--dataset", BUNDLED]) == 2


# --- errors -------------------------------------------------------------------------------


def test_without_key(client, monkeypatch, no_precomputed, csv_dataset):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    r = _interpret(client, csv_dataset[0], auto_msa_filter=False)
    assert r.status_code == 503
    assert r.json()["code"] == "interpretation_unavailable" and "ANTHROPIC_API_KEY" in r.json()["detail"]


def _request() -> httpx2.Request:
    return httpx2.Request("POST", "https://api.anthropic.com/v1/messages")


def _status_error(cls, status: int):
    return cls(SDK_SECRET, response=httpx2.Response(status, request=_request()), body={"error": SDK_SECRET})


@pytest.mark.parametrize(
    "error, status, code",
    [
        (lambda: _status_error(anthropic.AuthenticationError, 401), 502, "interpretation_auth"),
        (lambda: _status_error(anthropic.PermissionDeniedError, 403), 502, "interpretation_auth"),
        (lambda: _status_error(anthropic.RateLimitError, 429), 429, "interpretation_upstream_limited"),
        (lambda: _status_error(anthropic.InternalServerError, 500), 503, "interpretation_upstream_unavailable"),
        (lambda: _status_error(anthropic.OverloadedError, 529), 503, "interpretation_upstream_unavailable"),
        (lambda: _status_error(anthropic.BadRequestError, 400), 502, "interpretation_failed"),
        (lambda: anthropic.APIConnectionError(message=SDK_SECRET, request=_request()), 503, "interpretation_unreachable"),
        (lambda: anthropic.APITimeoutError(request=_request()), 504, "interpretation_timeout"),
    ],
)
def test_sdk_errors_are_mapped(client, claude, csv_dataset, error, status, code):
    claude.outcome = error()
    r = _interpret(client, csv_dataset[0], auto_msa_filter=False)
    assert r.status_code == status and r.json()["code"] == code
    assert SDK_SECRET not in r.text and KEY not in r.text
    # Nothing is cached, so the next try calls again.
    claude.outcome = _answer_for
    assert _interpret(client, csv_dataset[0], auto_msa_filter=False).json()["cached"] is False


def test_slow_answer_times_out(client, claude, csv_dataset, monkeypatch):
    import asyncio

    from interpretation import client as claude_client

    async def never(**kwargs):
        await asyncio.sleep(10)

    monkeypatch.setattr(claude_client, "TIMEOUT_S", 0.05)
    monkeypatch.setattr(claude_client, "MIN_CALL_S", 0.0)
    claude.create = never
    r = _interpret(client, csv_dataset[0], auto_msa_filter=False)
    assert r.status_code == 504 and r.json()["code"] == "interpretation_timeout"


def test_no_call_without_time_left(client, claude, csv_dataset, monkeypatch):
    """The analysis ran first; a call that could not finish in the request is not started."""
    from interpretation import client as claude_client

    monkeypatch.setattr(claude_client, "MIN_CALL_S", claude_client.TIMEOUT_S + 1)
    r = _interpret(client, csv_dataset[0], auto_msa_filter=False)
    assert r.status_code == 504 and r.json()["code"] == "interpretation_timeout"
    assert claude.calls == []


@pytest.mark.parametrize("text", [None, '{"factors": [{"index": 1, "na'])
def test_refusal(client, claude, csv_dataset, text):
    """Before or after partial output; the stop reason is checked before the content."""
    claude.outcome = _message(text, "refusal", stop_details={"type": "refusal", "category": "bio"})
    r = _interpret(client, csv_dataset[0], auto_msa_filter=False)
    assert r.status_code == 422 and r.json()["code"] == "interpretation_refused"
    assert _interpret(client, csv_dataset[0], auto_msa_filter=False, cached_only=True).status_code == 204


def test_answer_of_the_fallback_model(client, claude, csv_dataset):
    answer = _answer_for
    claude.outcome = lambda kwargs: answer(kwargs).model_copy(update={"model": "claude-opus-4-8"})
    assert _interpret(client, csv_dataset[0], auto_msa_filter=False).json()["model"] == "claude-opus-4-8"


@pytest.mark.parametrize(
    "message, code",
    [
        (lambda: _message('{"factors": [', "max_tokens"), "interpretation_incomplete"),
        (lambda: _message("not json"), "interpretation_failed"),
        (lambda: _message(None), "interpretation_failed"),
        (lambda: _message('{"factors": []}'), "interpretation_failed"),
        (lambda: _message('{"factors": [], "overall": "Nothing.", "caveats": []}'), "interpretation_failed"),
    ],
)
def test_unusable_answers(client, claude, csv_dataset, message, code):
    claude.outcome = message()
    r = _interpret(client, csv_dataset[0], auto_msa_filter=False)
    assert r.status_code == 502 and r.json()["code"] == code


def test_incomplete_answer_is_not_cached(client, claude, csv_dataset):
    def first_factor_only(kwargs):
        answer = json.loads(_answer_for(kwargs).content[0].text)
        answer["factors"] = answer["factors"][:1]
        return _message(json.dumps(answer))

    claude.outcome = first_factor_only
    r = _interpret(client, csv_dataset[0], auto_msa_filter=False)
    assert r.status_code == 502 and r.json()["code"] == "interpretation_failed"
    assert _interpret(client, csv_dataset[0], auto_msa_filter=False, cached_only=True).status_code == 204


@pytest.mark.parametrize("limit, value", [("MAX_FACTORS", 1), ("MAX_MEASURES", 5), ("MAX_MESSAGE_CHARS", 1000)])
def test_oversized_analysis_never_reaches_the_api(client, claude, csv_dataset, monkeypatch, limit, value):
    from limits import parse

    from interpretation import client as claude_client
    from interpretation import quota

    default = getattr(claude_client, limit)
    monkeypatch.setattr(claude_client, limit, value)
    monkeypatch.setattr(quota, "session_limit_enabled", True)
    monkeypatch.setattr(quota, "SESSION_LIMIT", parse("1/hour"))
    r = _interpret(client, csv_dataset[0], auto_msa_filter=False)
    assert r.status_code == 422 and r.json()["code"] == "interpretation_too_large"
    assert r.json()["params"]["factors"] == claude_client.MAX_FACTORS
    assert claude.calls == []
    # No quota was used.
    monkeypatch.setattr(claude_client, limit, default)
    assert _interpret(client, csv_dataset[0], auto_msa_filter=False).status_code == 200


def test_long_measure_names_are_refused(client, claude):
    long_name = "x" * 121
    table = _rng_table(LABELS).rename(columns={"Size": long_name})
    r = client.post(
        "/factor-analysis/datasets",
        data={"kind": "model", "source": "csv"},
        files={"files": ("t.csv", io.BytesIO(table.to_csv(index_label="observation").encode()), "text/csv")},
    )
    r = _interpret(client, r.json()["dataset_id"], auto_msa_filter=False)
    assert r.status_code == 422 and r.json()["code"] == "interpretation_too_large"
    assert claude.calls == []


def test_analysis_errors_come_first(client, claude, csv_dataset):
    r = _interpret(client, csv_dataset[0], excluded=["Size", "Density", "Diameter", "Cyclicity"])
    assert r.status_code == 400 and r.json()["code"] == "too_few_measures"
    assert claude.calls == []


def test_unknown_language(client, claude, csv_dataset):
    assert _interpret(client, csv_dataset[0], language="fr").status_code == 422


# --- concurrency --------------------------------------------------------------------------


def test_key_lock_stays_while_someone_waits():
    """After a failed holder releases, a waiter and a newcomer share one lock, so two paid
    calls for the same key never run at once; the entry goes with the last user."""
    import asyncio

    from routes import interpretation as route

    async def scenario():
        order: list[str] = []
        a_inside = asyncio.Event()
        release_a = asyncio.Event()

        async def a():
            try:
                async with route._key_lock("k"):
                    a_inside.set()
                    await release_a.wait()
                    raise RuntimeError("call failed")
            except RuntimeError:
                order.append("a failed")

        async def user(name: str):
            async with route._key_lock("k"):
                order.append(f"{name} in")
                await asyncio.sleep(0.01)
                order.append(f"{name} out")

        task_a = asyncio.create_task(a())
        await a_inside.wait()
        task_b = asyncio.create_task(user("b"))
        await asyncio.sleep(0)
        release_a.set()
        await task_a
        task_c = asyncio.create_task(user("c"))
        await asyncio.gather(task_b, task_c)
        assert order == ["a failed", "b in", "b out", "c in", "c out"]
        assert route._LOCKS == {}

    asyncio.run(scenario())


def test_concurrent_requests_make_one_call(client, claude, csv_dataset):
    """Two requests in the event loop of the app, as in the server: the second arrives while
    the first waits for the model, waits for the lock and gets the stored answer."""
    import asyncio

    from srv_main import app

    answer = _answer_for

    async def slow(**kwargs):
        claude.calls.append(kwargs)
        in_call.set()
        await asyncio.sleep(0.3)
        return answer(kwargs)

    async def both():
        transport = httpx2.ASGITransport(app=app)
        async with httpx2.AsyncClient(transport=transport, base_url="http://testserver", cookies=dict(client.cookies)) as c:
            url = f"/factor-analysis/datasets/{csv_dataset[0]}/interpret"
            first = asyncio.create_task(c.post(url, json={"auto_msa_filter": False}))
            await in_call.wait()
            second = await c.post(url, json={"auto_msa_filter": False})
            return await first, second

    in_call = asyncio.Event()
    claude.create = slow
    first, second = client.portal.call(both)
    assert first.status_code == 200 and first.json()["cached"] is False
    assert second.status_code == 200 and second.json()["cached"] is True
    assert len(claude.calls) == 1


# --- limits -------------------------------------------------------------------------------


def test_session_limit_counts_live_calls_only(client, claude, csv_dataset, monkeypatch):
    from limits import parse

    from interpretation import quota

    monkeypatch.setattr(quota, "session_limit_enabled", True)
    monkeypatch.setattr(quota, "SESSION_LIMIT", parse("1/hour"))
    dataset_id = csv_dataset[0]
    assert _interpret(client, dataset_id, auto_msa_filter=False).status_code == 200
    assert _interpret(client, dataset_id, auto_msa_filter=False).json()["cached"] is True
    r = _interpret(client, dataset_id, auto_msa_filter=False, language="de")
    assert r.status_code == 429 and r.json()["code"] == "rate_limited"
    assert len(claude.calls) == 1


def test_daily_cap_over_all_sessions(isolated_jobs_dir, claude, monkeypatch):
    from fastapi.testclient import TestClient
    from limits import parse

    from interpretation import quota
    from srv_main import app

    monkeypatch.setattr(quota, "DAILY_LIMIT", parse("1/day"))
    with TestClient(app) as alice, TestClient(app) as bob:
        assert _interpret(alice, _bundled(alice)).status_code == 200
        r = _interpret(bob, _bundled(bob), language="de")
    assert r.status_code == 429 and r.json()["code"] == "interpretation_daily_cap"
    assert len(claude.calls) == 1

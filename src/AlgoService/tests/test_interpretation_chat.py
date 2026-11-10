"""Follow-up questions about an interpretation, with the fake Anthropic client of
test_interpretation.py: no network."""

from __future__ import annotations

import json

import pytest

from .test_interpretation import (  # noqa: F401  (fixtures and helpers)
    FILENAME, KEY, LABELS, SDK_SECRET, _answer_for, _message, _status_error, claude, csv_dataset, no_precomputed,
)

OPTIONS = {"auto_msa_filter": False}
ASK = [{"role": "user", "content": "Why does Size load on factor 1?"}]
# The digest the precomputed interpretations are being regenerated against. Follow-up
# questions have a prompt of their own and must not change it.
PINNED_PROMPT_DIGEST = "9158359519b49f0e"


def _chat(client, dataset_id: str, messages=ASK, **body):
    return client.post(
        f"/factor-analysis/datasets/{dataset_id}/interpret/chat",
        json={**OPTIONS, "messages": messages, **body},
    )


def _interpreted(client, claude, dataset_id: str, **body) -> None:
    claude.outcome = _answer_for
    r = client.post(f"/factor-analysis/datasets/{dataset_id}/interpret", json={**OPTIONS, **body})
    assert r.status_code == 200, r.text
    claude.calls.clear()
    claude.outcome = _message("Because the loading is high.", model="claude-opus-5-5")


@pytest.fixture
def ready(client, claude, csv_dataset):
    """A dataset with a stored interpretation; the next answer is a chat answer."""
    _interpreted(client, claude, csv_dataset[0])
    return csv_dataset[0]


def test_prompt_digest_is_unchanged():
    from interpretation.client import PROMPT_DIGEST

    assert PROMPT_DIGEST == PINNED_PROMPT_DIGEST


# --- status -------------------------------------------------------------------------------


def test_status_says_whether_questions_are_possible(client, claude, monkeypatch):
    assert client.get("/factor-analysis/interpretation/status").json()["chat"] is True
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    assert client.get("/factor-analysis/interpretation/status").json()["chat"] is False


# --- the answer ---------------------------------------------------------------------------


def test_answer_shape(client, claude, ready):
    r = _chat(client, ready)
    assert r.status_code == 200, r.text
    assert r.json() == {
        "answer": "Because the loading is high.",
        "model": "claude-opus-5-5",
        "requested_model": "claude-opus-5-5",
        "effort": "medium",
    }
    assert KEY not in r.text


def test_answer_of_the_fallback_model(client, claude, ready):
    claude.outcome = _message("Answer.", model="claude-fallback")
    body = _chat(client, ready).json()
    assert body["model"] == "claude-fallback" and body["requested_model"] == "claude-opus-5-5"


def test_request_shape(client, claude, ready):
    messages = [
        {"role": "user", "content": "First?"},
        {"role": "assistant", "content": "One."},
        {"role": "user", "content": "Second?"},
    ]
    _interpreted(client, claude, ready, language="de")
    assert _chat(client, ready, messages, language="de").status_code == 200
    (call,) = claude.calls
    assert call["model"] == "claude-opus-5-5"
    assert call["fallbacks"] == "default" and call["betas"] == ["server-side-fallback-2026-07-01"]
    assert call["output_config"] == {"effort": "medium"}
    assert "thinking" not in call and "temperature" not in call
    assert "Maß" in call["system"] and "plain paragraphs" in call["system"].lower()
    first, second, third = call["messages"]
    context, question = first["content"]
    assert context["cache_control"] == {"type": "ephemeral"} and "cache_control" not in question
    assert question == {"type": "text", "text": "First?"}
    assert "Answer in German" in context["text"]
    assert second == {"role": "assistant", "content": "One."}
    assert third == {"role": "user", "content": "Second?"}


def test_context_holds_the_payload_and_the_stored_interpretation(client, claude, ready):
    _chat(client, ready)
    text = claude.calls[0]["messages"][0]["content"][0]["text"]
    payload = json.loads(text[text.index("{"):text.index("\n\nInterpretation")])
    assert set(payload["used_measures"]) >= {"Size", "Density"}
    assert "Factor name 1" in text


@pytest.mark.parametrize("effort, tokens", [("low", 16000), ("medium", 16000), ("high", 24000), ("xhigh", 32000)])
def test_output_budget_follows_the_effort(client, claude, csv_dataset, effort, tokens):
    _interpreted(client, claude, csv_dataset[0], effort=effort)
    assert _chat(client, csv_dataset[0], effort=effort).status_code == 200
    (call,) = claude.calls
    assert call["max_tokens"] == tokens and call["output_config"]["effort"] == effort


def test_model_and_effort_select_the_stored_interpretation(client, claude, csv_dataset):
    _interpreted(client, claude, csv_dataset[0], model="claude-sonnet-5-5", effort="high")
    claude.outcome = _message("Sonnet.", model="claude-sonnet-5-5")
    r = _chat(client, csv_dataset[0], model="claude-sonnet-5-5", effort="high")
    assert r.status_code == 200 and r.json()["requested_model"] == "claude-sonnet-5-5"
    assert claude.calls[0]["model"] == "claude-sonnet-5-5"
    # Only the default combination was not interpreted.
    assert _chat(client, csv_dataset[0]).json()["code"] == "interpretation_required"


def test_payload_sent_has_no_observation_labels(client, claude, csv_dataset):
    dataset_id, csv_text = csv_dataset
    _interpreted(client, claude, dataset_id)
    assert _chat(client, dataset_id).status_code == 200
    sent = json.dumps(claude.calls[0], default=str)
    for secret in [*LABELS, FILENAME, "secret-plant-data", "Confidential customer study"]:
        assert secret not in sent
    raw_values = [cell for line in csv_text.splitlines()[1:] for cell in line.split(",")[1:]]
    assert raw_values and not [v for v in raw_values if v in sent]


def test_question_and_answer_are_not_logged(client, claude, ready):
    import logging

    from config import logger

    records: list[str] = []

    class Collect(logging.Handler):
        def emit(self, record):
            records.append(record.getMessage())

    claude.outcome = _message("The secret-answer-text is fine.")
    handler = Collect(logging.DEBUG)
    logger.addHandler(handler)
    try:
        r = _chat(client, ready, [{"role": "user", "content": "Is PATIENT-ZZ-QUESTION a problem?"}])
    finally:
        logger.removeHandler(handler)
    assert r.status_code == 200
    assert records and not [x for x in records if "PATIENT-ZZ" in x or "secret-answer" in x]


# --- validation ---------------------------------------------------------------------------


def _conversation(n: int) -> list[dict]:
    return [{"role": "user" if i % 2 == 0 else "assistant", "content": f"m{i}"} for i in range(n)]


@pytest.mark.parametrize(
    "messages, code",
    [
        ([], "interpretation_chat_count"),
        (_conversation(21), "interpretation_chat_count"),
        (_conversation(2), "interpretation_chat_order"),
        ([{"role": "assistant", "content": "x"}], "interpretation_chat_order"),
        (
            [{"role": "user", "content": "a"}, {"role": "user", "content": "b"}, {"role": "user", "content": "c"}],
            "interpretation_chat_order",
        ),
        ([{"role": "system", "content": "a"}], "interpretation_chat_order"),
        ([{"role": "user", "content": ""}], "interpretation_chat_empty"),
        ([{"role": "user", "content": "  \n "}], "interpretation_chat_empty"),
        (
            [{"role": "user", "content": "q"}, {"role": "assistant", "content": ""}, {"role": "user", "content": "q"}],
            "interpretation_chat_empty",
        ),
        ([{"role": "user", "content": "x" * 2001}], "interpretation_chat_question_too_long"),
    ],
)
def test_invalid_conversations_are_refused_before_anything_is_used(client, claude, ready, messages, code):
    r = _chat(client, ready, messages)
    assert r.status_code == 422 and r.json()["code"] == code
    assert claude.calls == []


def test_limits_are_inclusive(client, claude, ready):
    assert _chat(client, ready, [{"role": "user", "content": "x" * 2000}]).status_code == 200
    assert _chat(client, ready, _conversation(19)).status_code == 200


def test_total_length_is_bounded(client, claude, ready):
    big = [
        {"role": "user", "content": "q"},
        {"role": "assistant", "content": "a" * 40_000},
        {"role": "user", "content": "q"},
    ]
    r = _chat(client, ready, big)
    assert r.status_code == 422 and r.json()["code"] == "interpretation_chat_too_long"
    assert claude.calls == []


def test_a_long_answer_of_the_model_is_not_a_long_question(client, claude, ready):
    long_answer = [
        {"role": "user", "content": "q"},
        {"role": "assistant", "content": "a" * 30_000},
        {"role": "user", "content": "q"},
    ]
    assert _chat(client, ready, long_answer).status_code == 200


def test_missing_messages_are_a_count_error(client, claude, ready):
    r = client.post(f"/factor-analysis/datasets/{ready}/interpret/chat", json=OPTIONS)
    assert r.status_code == 422 and r.json()["code"] == "interpretation_chat_count"


# --- preconditions ------------------------------------------------------------------------


def test_needs_a_stored_interpretation(client, claude, csv_dataset):
    r = _chat(client, csv_dataset[0])
    assert r.status_code == 409 and r.json()["code"] == "interpretation_required"
    assert claude.calls == []


def test_needs_the_interpretation_of_exactly_this_analysis_and_language(client, claude, ready):
    assert _chat(client, ready, language="de").json()["code"] == "interpretation_required"
    assert _chat(client, ready, n_factors=1).json()["code"] == "interpretation_required"
    assert claude.calls == []


def test_without_key(client, claude, ready, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    r = _chat(client, ready)
    assert r.status_code == 503 and r.json()["code"] == "interpretation_unavailable"
    assert claude.calls == []


@pytest.mark.parametrize("choice", [{"model": "claude-other"}, {"effort": "max"}])
def test_choice_outside_the_allowed_lists(client, claude, ready, choice):
    r = _chat(client, ready, **choice)
    assert r.status_code == 422 and r.json()["code"] == "interpretation_choice_not_allowed"
    assert claude.calls == []


def test_oversized_analysis_never_reaches_the_api(client, claude, ready, monkeypatch):
    from interpretation import client as claude_client

    monkeypatch.setattr(claude_client, "MAX_FACTORS", 1)
    r = _chat(client, ready)
    assert r.status_code == 422 and r.json()["code"] == "interpretation_too_large"
    assert claude.calls == []


def test_analysis_errors_come_first(client, claude, ready):
    r = _chat(client, ready, excluded=["Size", "Density", "Diameter", "Cyclicity"])
    assert r.status_code == 400 and r.json()["code"] == "too_few_measures"
    assert claude.calls == []


def test_unknown_dataset(client, claude):
    assert _chat(client, "no-such-dataset").status_code == 400


# --- quota --------------------------------------------------------------------------------


def test_every_question_claims_the_quota_once(client, claude, ready, monkeypatch):
    from interpretation import quota

    claimed: list[str] = []
    monkeypatch.setattr(quota, "claim", lambda session_id: claimed.append(session_id))
    assert _chat(client, ready).status_code == 200
    assert len(claimed) == 1
    assert _chat(client, ready).status_code == 200
    assert len(claimed) == 2 and len(claude.calls) == 2


def test_no_quota_for_a_refused_question(client, claude, ready, monkeypatch):
    from interpretation import quota

    claimed: list[str] = []
    monkeypatch.setattr(quota, "claim", lambda session_id: claimed.append(session_id))
    _chat(client, ready, [])
    _chat(client, ready, language="de")
    _chat(client, ready, model="claude-other")
    assert claimed == []


def test_session_limit_applies_to_questions(client, claude, ready, monkeypatch):
    from limits import parse

    from interpretation import quota

    monkeypatch.setattr(quota, "session_limit_enabled", True)
    monkeypatch.setattr(quota, "SESSION_LIMIT", parse("1/hour"))
    assert _chat(client, ready).status_code == 200
    r = _chat(client, ready)
    assert r.status_code == 429 and r.json()["code"] == "interpretation_rate_limited"
    assert len(claude.calls) == 1


def test_no_call_without_the_counters(client, claude, ready, monkeypatch):
    from interpretation import quota

    def redis_down(*args):
        raise ConnectionError("redis is down")

    monkeypatch.setattr(quota._limiter, "hit", redis_down)
    r = _chat(client, ready)
    assert r.status_code == 503 and r.json()["code"] == "interpretation_limits_unavailable"
    assert claude.calls == []


# --- failures of the call -----------------------------------------------------------------


def _refusal(text: str | None, **details):
    return _message(text, "refusal", stop_details={"type": "refusal", "category": "bio", **details})


@pytest.mark.parametrize(
    "message, status, code",
    [
        (lambda: _refusal(None), 422, "interpretation_chat_refused"),
        (lambda: _refusal("partial"), 422, "interpretation_chat_refused"),
        (lambda: _refusal(None, recommended_model="claude-other"), 503, "interpretation_fallback_unavailable"),
        (lambda: _message("A cut-off ans", "max_tokens"), 502, "interpretation_chat_incomplete"),
        (lambda: _message(None), 502, "interpretation_failed"),
        (lambda: _message("   "), 502, "interpretation_failed"),
        (lambda: _message("x", "pause_turn"), 502, "interpretation_failed"),
    ],
)
def test_unusable_answers(client, claude, ready, message, status, code):
    claude.outcome = message()
    r = _chat(client, ready)
    assert r.status_code == status and r.json()["code"] == code
    assert "cut-off" not in r.text and "partial" not in r.text


def test_sdk_errors_are_mapped(client, claude, ready):
    import anthropic

    claude.outcome = _status_error(anthropic.RateLimitError, 429)
    r = _chat(client, ready)
    assert r.status_code == 429 and r.json()["code"] == "interpretation_upstream_limited"
    assert SDK_SECRET not in r.text and KEY not in r.text


def test_slow_answer_times_out(client, claude, ready, monkeypatch):
    import asyncio

    from interpretation import client as claude_client

    async def never(**kwargs):
        await asyncio.sleep(10)

    monkeypatch.setattr(claude_client, "TIMEOUT_S", 0.05)
    monkeypatch.setattr(claude_client, "MIN_CALL_S", 0.0)
    claude.create = never
    r = _chat(client, ready)
    assert r.status_code == 504 and r.json()["code"] == "interpretation_timeout"


def test_no_call_without_time_left(client, claude, ready, monkeypatch):
    from interpretation import client as claude_client

    monkeypatch.setattr(claude_client, "MIN_CALL_S", claude_client.TIMEOUT_S + 1)
    r = _chat(client, ready)
    assert r.status_code == 504 and r.json()["code"] == "interpretation_timeout"
    assert claude.calls == []

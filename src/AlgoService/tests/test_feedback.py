"""The feedback form: stored first, mailed after, nothing about the sender kept.

No test reaches a mail server: smtplib is replaced by a recorder for the whole file."""

from __future__ import annotations

import asyncio
import importlib
import json
import smtplib

import pytest
from sqlalchemy import delete, select

import database
import env_config
import feedback_mail
import models
from config import limiter

MAIL_VARS = (
    "FEEDBACK_SMTP_HOST", "FEEDBACK_SMTP_PORT", "FEEDBACK_SMTP_USER", "FEEDBACK_SMTP_PASSWORD",
    "FEEDBACK_SMTP_FROM", "FEEDBACK_TO", "FEEDBACK_SMTP_TLS",
)


class Smtp:
    """Records what would have gone to a mail server, for both SMTP and SMTP_SSL."""

    def __init__(self) -> None:
        self.connections: list[dict] = []
        self.fail: Exception | None = None

    def server(self, ssl: bool):
        outer = self

        class Server:
            def __init__(self, host, port, timeout=None, context=None):
                self.info = {"host": host, "port": port, "ssl": ssl, "calls": [], "sent": []}
                outer.connections.append(self.info)

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def starttls(self, context=None):
                self.info["calls"].append("starttls")

            def login(self, user, password):
                self.info["calls"].append(("login", user, password))

            def send_message(self, msg):
                if outer.fail:
                    raise outer.fail
                self.info["sent"].append(msg)

        return Server

    @property
    def sent(self) -> list:
        return [m for c in self.connections for m in c["sent"]]


@pytest.fixture(autouse=True)
def smtp(monkeypatch):
    """No FEEDBACK_* variable of the developer's shell, and no real mail server."""
    monkeypatch.setattr(env_config, "OVERRIDES", dict(env_config.OVERRIDES))
    for var in MAIL_VARS:
        monkeypatch.delenv(var, raising=False)
    fake = Smtp()
    monkeypatch.setattr(smtplib, "SMTP", fake.server(ssl=False))
    monkeypatch.setattr(smtplib, "SMTP_SSL", fake.server(ssl=True))
    return fake


@pytest.fixture
def mail(monkeypatch):
    monkeypatch.setenv("FEEDBACK_SMTP_HOST", "mail.example.org")
    monkeypatch.setenv("FEEDBACK_SMTP_USER", "robot")
    monkeypatch.setenv("FEEDBACK_SMTP_PASSWORD", "s3cret-pw")
    monkeypatch.setenv("FEEDBACK_SMTP_FROM", "cfa@example.org")
    monkeypatch.setenv("FEEDBACK_TO", "owner@example.org")


def _query(fn):
    async def run():
        async with database.AsyncSessionLocal() as session:
            return await fn(session)

    return asyncio.run(run())


async def _all(session):
    return list((await session.scalars(select(models.Feedback).order_by(models.Feedback.id))).all())


@pytest.fixture
def inbox(client):
    """The rows of the feedback table, emptied before the test."""

    async def wipe(session):
        await session.execute(delete(models.Feedback))
        await session.commit()

    _query(wipe)
    return lambda: _query(_all)


def _post(client, **fields):
    body = {"kind": "bug", "message": "The matrix stays empty.", "contact": "", "context": None, "website": ""}
    return client.post("/feedback", json={**body, **fields})


def test_a_message_is_stored(client, inbox):
    context = {
        "route": "/log", "step": "loadings", "language": "de", "user_agent": "UA/1.0",
        "error_code": "xes_invalid", "dataset": "rows,of,data", "version": "9.9.9",
    }
    r = _post(client, message="  The matrix stays empty.\n", contact=" me@example.org ", context=context)
    assert r.status_code == 200 and r.json() == {"ok": True}
    (row,) = inbox()
    assert (row.kind, row.message, row.contact, row.delivered) == ("bug", "The matrix stays empty.", "me@example.org", False)
    # Only what the form may send, and the tool's own version, never one the browser names.
    assert set(row.context) == {"version", "commit", "route", "step", "language", "user_agent", "error_code"}
    assert row.context["version"] != "9.9.9" and row.context["route"] == "/log"


def test_a_message_without_details_has_no_context(client, inbox):
    _post(client, kind="idea", contact=None)
    (row,) = inbox()
    assert row.kind == "idea" and row.contact is None and row.context is None


def test_the_mail_is_sent_when_it_is_set_up(client, inbox, smtp, mail):
    _post(client, context={"route": "/log", "error_code": "xes_invalid"}, contact="me@example.org")
    (conn,) = smtp.connections
    assert (conn["host"], conn["port"], conn["ssl"]) == ("mail.example.org", 587, False)
    assert conn["calls"] == ["starttls", ("login", "robot", "s3cret-pw")]
    (msg,) = smtp.sent
    assert (msg["From"], msg["To"]) == ("cfa@example.org", "owner@example.org")
    assert msg["Subject"] == "[XCom feedback] bug: The matrix stays empty."
    body = msg.get_content()
    assert body.startswith("The matrix stays empty.\n")
    assert "Contact: me@example.org" in body
    assert "  route: /log" in body and "  error_code: xes_invalid" in body and "  version: " in body
    assert [row.delivered for row in inbox()] == [True]


def test_ssl_is_an_option(client, inbox, smtp, mail, monkeypatch):
    monkeypatch.setenv("FEEDBACK_SMTP_TLS", "ssl")
    monkeypatch.setenv("FEEDBACK_SMTP_PORT", "465")
    _post(client)
    (conn,) = smtp.connections
    assert (conn["port"], conn["ssl"], "starttls" in conn["calls"]) == (465, True, False)
    assert [row.delivered for row in inbox()] == [True]


def test_no_mail_without_settings(client, inbox, smtp, monkeypatch):
    assert _post(client).status_code == 200
    assert smtp.connections == []
    assert [row.delivered for row in inbox()] == [False]
    # A host without a recipient is no setup either.
    monkeypatch.setenv("FEEDBACK_SMTP_HOST", "mail.example.org")
    _post(client)
    assert smtp.connections == []


def test_the_form_learns_whether_mail_is_set_up(client, monkeypatch):
    """Without mail the form opens a GitHub issue instead (a kept message would reach nobody)."""
    answer = client.get("/feedback").json()
    assert answer["mail"] is False and answer["version"] and answer["commit"]
    monkeypatch.setenv("FEEDBACK_SMTP_HOST", "mail.example.org")
    assert client.get("/feedback").json()["mail"] is False  # a host without a recipient is no setup
    monkeypatch.setenv("FEEDBACK_TO", "owner@example.org")
    assert client.get("/feedback").json()["mail"] is True


def test_a_failed_mail_keeps_the_row(client, inbox, smtp, mail, caplog):
    smtp.fail = smtplib.SMTPException("relay denied")
    with caplog.at_level("WARNING", logger="algoservice"):
        r = _post(client)
    assert r.status_code == 200 and r.json() == {"ok": True}
    (row,) = inbox()
    assert row.delivered is False and row.message == "The matrix stays empty."
    assert "was stored but its mail was not sent" in caplog.text and "relay denied" in caplog.text
    assert "s3cret-pw" not in caplog.text


def test_a_filled_honeypot_stores_nothing(client, inbox, smtp, mail):
    r = _post(client, website="https://spam.example")
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert inbox() == [] and smtp.connections == []


@pytest.mark.parametrize(
    "fields, code",
    [
        ({"kind": "complaint"}, "feedback_kind"),
        ({"kind": ""}, "feedback_kind"),
        ({"message": ""}, "feedback_empty"),
        ({"message": " \n\t "}, "feedback_empty"),
        ({"message": "x" * 4001}, "feedback_too_long"),
        ({"contact": "x" * 201}, "feedback_contact_too_long"),
    ],
)
def test_bad_input_is_refused_and_not_stored(client, inbox, smtp, mail, fields, code):
    r = _post(client, **fields)
    assert r.status_code == 422 and r.json()["code"] == code
    assert inbox() == [] and smtp.connections == []


def test_the_limits_are_inclusive(client, inbox):
    assert _post(client, message="x" * 4000, contact="c" * 200).status_code == 200
    assert _post(client, message="a\x00b").status_code == 200
    rows = inbox()
    assert len(rows[0].message) == 4000 and len(rows[0].contact) == 200
    assert rows[1].message == "ab"


def test_the_sender_is_not_recorded(client, inbox):
    r = client.post(
        "/feedback",
        json={"kind": "other", "message": "Hello", "context": {}},
        headers={"X-Forwarded-For": "203.0.113.7", "User-Agent": "Secret-Agent/1"},
    )
    assert r.status_code == 200 and "set-cookie" not in r.headers
    columns = {c.name for c in models.Feedback.__table__.columns}
    assert columns == {"id", "created_at", "kind", "message", "contact", "context", "delivered"}
    (row,) = inbox()
    stored = json.dumps([getattr(row, name) for name in columns if name != "created_at"], default=str)
    assert "203.0.113.7" not in stored and "testclient" not in stored and "Secret-Agent" not in stored


def test_a_header_cannot_be_injected(client, inbox, smtp, mail, monkeypatch):
    monkeypatch.setenv("FEEDBACK_TO", "owner@example.org\r\nBcc: evil@example.org")
    _post(
        client,
        message="Hi\r\nBcc: attacker@example.org\r\nSubject: spam\nmore text",
        contact="a@b.example\r\nBcc: x@y.example",
        context={"user_agent": "UA\r\nBcc: z@z.example", "route": "/log"},
    )
    (msg,) = smtp.sent
    assert msg["Bcc"] is None
    for header in ("Subject", "From", "To"):
        assert "\r" not in msg[header] and "\n" not in msg[header]
    assert msg["Subject"] == "[XCom feedback] bug: Hi Bcc: attacker@example.org Subject: spam more text"
    body = msg.get_content()
    assert "Contact: a@b.example Bcc: x@y.example\n" in body
    assert "  user_agent: UA Bcc: z@z.example\n" in body


def test_the_subject_has_sixty_characters_of_the_message():
    subject = feedback_mail.subject("idea", "w" * 100)
    assert subject == "[XCom feedback] idea: " + "w" * 60


def test_the_form_is_rate_limited(client, inbox, monkeypatch):
    monkeypatch.setattr(limiter, "enabled", True)
    limiter.reset()
    try:
        codes = [_post(client).status_code for _ in range(6)]
        assert codes == [200] * 5 + [429]
        assert _post(client).json()["code"] == "rate_limited"
        assert len(inbox()) == 5
    finally:
        limiter.reset()


def _cli(*argv):
    cli = importlib.import_module("scripts.feedback")
    return cli.main(list(argv))


def test_the_cli_lists_and_filters(client, inbox, capsys):
    _post(client, message="First one", kind="bug", contact="me@example.org", context={"route": "/log"})
    _post(client, message="Second\nline", kind="idea")

    async def deliver_first(session):
        (await session.scalars(select(models.Feedback).order_by(models.Feedback.id))).first().delivered = True
        await session.commit()

    _query(deliver_first)
    assert _cli("list") == 0
    out = capsys.readouterr().out
    assert "bug    sent" in out and "idea   NOT SENT" in out
    assert "  First one" in out and "  Second\n  line" in out
    assert "Contact: me@example.org" in out and "route: /log" in out

    assert _cli("list", "--undelivered", "--brief") == 0
    out = capsys.readouterr().out
    assert "Second line" in out and "First one" not in out and "\n  " not in out

    assert _cli("list", "--since", "1h") == 0
    assert "First one" in capsys.readouterr().out
    assert _cli("list", "--since", "2999-01-01") == 0
    assert "First one" not in capsys.readouterr().out


def test_the_cli_sends_the_undelivered_again(client, inbox, smtp, capsys, monkeypatch):
    _post(client)
    assert _cli("resend") == 1  # mail is not set up
    assert "not set up" in capsys.readouterr().err and smtp.connections == []

    monkeypatch.setenv("FEEDBACK_SMTP_HOST", "mail.example.org")
    monkeypatch.setenv("FEEDBACK_TO", "owner@example.org")
    smtp.fail = smtplib.SMTPException("down")
    assert _cli("resend") == 1 and [r.delivered for r in inbox()] == [False]
    smtp.fail = None
    assert _cli("resend") == 0
    assert [r.delivered for r in inbox()] == [True] and len(smtp.sent) == 1
    capsys.readouterr()
    assert _cli("resend") == 0 and len(smtp.sent) == 1

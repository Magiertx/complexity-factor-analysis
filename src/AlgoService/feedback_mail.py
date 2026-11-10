"""The mail that carries a feedback message to the owner.

Configured only through ``FEEDBACK_*`` variables (docs/DEPLOYMENT.md); without a host and a
recipient there is no mail and the messages are just kept. Standard library only. The settings
are read when a mail is sent, not at import: the host, user and recipient are not for the
startup log that ``env_config`` fills.
"""

from __future__ import annotations

import os
import re
import smtplib
import ssl
from dataclasses import dataclass
from datetime import datetime
from email.message import EmailMessage
from typing import Any

from config import APP_NAME
from env_config import choice, positive_int

#: Seconds to wait for the mail server, so a dead one cannot hold a background task for long.
TIMEOUT = 20

SUBJECT_CHARS = 60

_LINE_BREAKS = re.compile(r"[\r\n]+")


@dataclass(frozen=True)
class MailSettings:
    host: str
    port: int
    user: str
    password: str
    sender: str
    to: str
    tls: str  # "starttls" or "ssl"


def settings() -> MailSettings | None:
    """The mail settings, or None where mail is not set up (no host or no recipient).

    A malformed port or TLS mode raises ``ConfigError`` like the other settings.
    """
    host = os.environ.get("FEEDBACK_SMTP_HOST", "").strip()
    to = os.environ.get("FEEDBACK_TO", "").strip()
    if not host or not to:
        return None
    user = os.environ.get("FEEDBACK_SMTP_USER", "").strip()
    return MailSettings(
        host=host,
        port=positive_int("FEEDBACK_SMTP_PORT", 587),
        user=user,
        password=os.environ.get("FEEDBACK_SMTP_PASSWORD", ""),
        sender=os.environ.get("FEEDBACK_SMTP_FROM", "").strip() or user or to,
        to=to,
        tls=choice("FEEDBACK_SMTP_TLS", "starttls", ("starttls", "ssl")),
    )


def one_line(value: object) -> str:
    """``value`` without CR and LF: what goes into a header, and into a line of the body that
    must not be split by what a visitor typed."""
    return _LINE_BREAKS.sub(" ", str(value)).strip()


def subject(kind: str, message: str) -> str:
    return f"[{APP_NAME} feedback] {one_line(kind)}: {one_line(message)[:SUBJECT_CHARS]}"


def compose(
    mail: MailSettings,
    *,
    feedback_id: int,
    kind: str,
    message: str,
    contact: str | None,
    context: dict[str, Any] | None,
    created_at: datetime,
) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = subject(kind, message)
    msg["From"] = one_line(mail.sender)
    msg["To"] = one_line(mail.to)
    lines = [
        message,
        "",
        "--",
        f"Feedback #{feedback_id}, {kind}, {created_at:%Y-%m-%d %H:%M} UTC",
        f"Contact: {one_line(contact) if contact else '(none given)'}",
    ]
    if context:
        lines.append("Context:")
        lines += [f"  {one_line(key)}: {one_line(value)}" for key, value in context.items()]
    else:
        lines.append("Context: (not sent)")
    msg.set_content("\n".join(lines) + "\n")
    return msg


def send(mail: MailSettings, msg: EmailMessage) -> None:
    """Send one message; raises what smtplib raises. Blocking: call it off the event loop."""
    tls = ssl.create_default_context()
    if mail.tls == "ssl":
        server: smtplib.SMTP = smtplib.SMTP_SSL(mail.host, mail.port, timeout=TIMEOUT, context=tls)
    else:
        server = smtplib.SMTP(mail.host, mail.port, timeout=TIMEOUT)
    with server:
        if mail.tls != "ssl":
            server.starttls(context=tls)
        if mail.user:
            server.login(mail.user, mail.password)
        server.send_message(msg)

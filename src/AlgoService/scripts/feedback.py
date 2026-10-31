"""Read the messages of the feedback form on the server, and send the undelivered ones again.

The messages are in the ``feedback`` table whether or not mail is set up. Run from the
AlgoService directory, in the container as the algoservice runs:

    docker compose exec algoservice python -m scripts.feedback list
    docker compose exec algoservice python -m scripts.feedback list --since 7d --undelivered
    docker compose exec algoservice python -m scripts.feedback resend

``--since`` takes a date (2026-10-31), a date and time (2026-10-31T14:30) or an age (36h, 7d),
all in UTC. ``resend`` mails every message whose mail did not go out, or the one given by
``--id``, and needs the ``FEEDBACK_*`` settings of the service.
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import feedback_mail  # noqa: E402
import feedback_store  # noqa: E402
import models  # noqa: E402

_AGE = re.compile(r"^(\d+)([hd])$")


def parse_since(value: str) -> datetime:
    """A moment in UTC from ``7d``, ``36h``, ``2026-10-31`` or ``2026-10-31T14:30``."""
    age = _AGE.match(value.strip())
    if age:
        step = timedelta(days=int(age[1])) if age[2] == "d" else timedelta(hours=int(age[1]))
        return datetime.now(timezone.utc).replace(tzinfo=None) - step
    try:
        return datetime.fromisoformat(value.strip())
    except ValueError:
        raise argparse.ArgumentTypeError(f"{value!r} is not a date, a date and time, or an age such as 7d") from None


def render(row: models.Feedback, brief: bool) -> str:
    state = "sent" if row.delivered else "NOT SENT"
    head = f"#{row.id}  {row.created_at:%Y-%m-%d %H:%M}  {row.kind:<5}  {state}"
    if brief:
        return f"{head}  {feedback_mail.one_line(row.message)[:70]}"
    lines = [head, *("  " + line for line in row.message.splitlines())]
    if row.contact:
        lines.append(f"  Contact: {feedback_mail.one_line(row.contact)}")
    for key, value in (row.context or {}).items():
        lines.append(f"  {key}: {feedback_mail.one_line(value)}")
    return "\n".join(lines) + "\n"


async def list_command(args: argparse.Namespace) -> int:
    rows = await feedback_store.listing(since=args.since, undelivered=args.undelivered)
    for row in rows:
        print(render(row, args.brief))
    print(f"{len(rows)} message(s).", file=sys.stderr)
    return 0


async def resend_command(args: argparse.Namespace) -> int:
    if feedback_mail.settings() is None:
        print("Mail is not set up: FEEDBACK_SMTP_HOST and FEEDBACK_TO are empty.", file=sys.stderr)
        return 1
    rows = await feedback_store.listing(undelivered=True)
    if args.id is not None:
        rows = [row for row in rows if row.id == args.id]
    sent = 0
    for row in rows:
        ok = await feedback_store.deliver(row.id)
        sent += ok
        print(f"#{row.id}: {'sent' if ok else 'failed (see the log of the service for the reason)'}")
    print(f"{sent} of {len(rows)} sent.", file=sys.stderr)
    return 0 if sent == len(rows) else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m scripts.feedback", description=__doc__.split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    show = commands.add_parser("list", help="print the messages, oldest first")
    show.add_argument("--since", type=parse_since, help="only messages from this moment on (UTC)")
    show.add_argument("--undelivered", action="store_true", help="only messages whose mail did not go out")
    show.add_argument("--brief", action="store_true", help="one line per message")
    show.set_defaults(run=list_command)
    again = commands.add_parser("resend", help="mail the undelivered messages again")
    again.add_argument("--id", type=int, help="only this message")
    again.set_defaults(run=resend_command)
    args = parser.parse_args(argv)
    return asyncio.run(args.run(args))


if __name__ == "__main__":
    sys.exit(main())

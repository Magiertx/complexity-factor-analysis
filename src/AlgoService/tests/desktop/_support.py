"""Shared values and helpers of the desktop launcher's tests."""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

#: src/desktop, where the launcher's package lies.
DESKTOP = Path(__file__).resolve().parents[3] / "desktop"
if str(DESKTOP) not in sys.path:
    sys.path.insert(0, str(DESKTOP))

PORT = 8765
ORIGIN = f"http://127.0.0.1:{PORT}"
TOKEN = "instance-token-for-the-tests"
BEARER = {"Authorization": f"Bearer {TOKEN}"}
INSTANCE = {"pid": 1234, "port": PORT, "app": "test"}

#: As scripts/build-export.mjs writes them, shortened.
PAGE_HEADERS = {
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
}
API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"

HTML = {"accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"}

EXPORT_FILES = {
    "index.html": "<!doctype html><title>index page</title>",
    "index.txt": "0:index payload",
    "log.html": "<!doctype html><title>log page</title>",
    "log.txt": "0:log payload",
    "404.html": "<!doctype html><title>page not found</title>",
    "_next/static/chunks/main-abc123.js": "console.log(1)",
    "_next/static/chunks/module-abc123.mjs": "export {}",
    "_next/static/css/app-abc123.css": "body{}",
    "_next/static/media/font-abc123.woff2": "wOF2",
    "icon.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>",
    "favicon.ico": "ico",
    "logo.png": "png",
    "data.json": "{}",
    "examples/example-measures.csv": "a,b\n1,2\n",
}


def make_export(root: Path) -> Path:
    """A small static export in ``root``, laid out like ``src/frontend/out``."""
    for name, content in EXPORT_FILES.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    (root / "_headers.json").write_text(json.dumps(PAGE_HEADERS), encoding="utf-8")
    return root


def cookie_session_id(set_cookie: str) -> str | None:
    """The session id in a ``session_id`` Set-Cookie value (base64 JSON, then the signature)."""
    if not set_cookie.startswith("session_id="):
        return None
    payload = set_cookie.split("=", 1)[1].split(";", 1)[0].split(".", 1)[0]
    payload += "=" * (-len(payload) % 4)
    return json.loads(base64.b64decode(payload))["session_id"]


def asgi_get(app, path: str, query: str = "", headers: dict[str, str] | None = None):
    """``GET path`` straight into the ASGI ``app`` with ``path`` as the server has it (decoded),
    which an HTTP client cannot send for a path that starts with ``//``. Returns the status and
    the response headers (lowercase names)."""
    import anyio

    sent: dict = {}
    host = f"127.0.0.1:{PORT}"
    raw = [(b"host", host.encode())] + [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "GET", "scheme": "http",
        "path": path, "raw_path": path.encode(), "query_string": query.encode(), "root_path": "",
        "headers": raw, "client": ("127.0.0.1", 5), "server": ("127.0.0.1", PORT),
    }

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        if message["type"] == "http.response.start":
            sent["status"] = message["status"]
            sent["headers"] = {k.decode().lower(): v.decode("latin-1") for k, v in message["headers"]}

    async def run():
        await app(scope, receive, send)

    anyio.run(run)
    return sent["status"], sent["headers"]

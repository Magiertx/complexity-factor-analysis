"""One ASGI app for the whole tool: the API under ``/api``, the pages everywhere else.

``/api/<path>`` reaches the backend's ``/<path>``, as the rewrite of next.config.mjs does in the
Docker build. Around both, the checks a server on 127.0.0.1 needs, since every web page the
user opens can send requests to it:

- :class:`HostCheck`: only ``127.0.0.1:<port>`` and ``localhost:<port>``, against DNS rebinding
  (a foreign name that resolves to 127.0.0.1 arrives with its own name in ``Host``).
- :class:`SameOriginCheck`: POST, PUT, PATCH and DELETE only from the app's own pages. A form
  post or a multipart upload of another site is a "simple" request that CORS does not stop.
- :class:`NoCors`: no ``Access-Control-*`` header leaves the app, so no other origin can read
  an answer (the backend's own CORS setting is for the Docker build).
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
from urllib.parse import urlsplit

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .pages import PageServer, SessionCookies, without_trailing_slash

logger = logging.getLogger("desktop")

API_PREFIX = "/api"
#: Answers another start of the launcher whether this is the instance it looks for.
INSTANCE_PATH = "/_desktop/instance"
INSTANCE_HEADER = b"x-desktop-instance"

STATE_CHANGING = frozenset({"POST", "PUT", "PATCH", "DELETE"})

#: On the answers the launcher gives itself (refusals, redirects, the instance check), like the API's.
_OWN_HEADERS = [
    (b"content-type", b"application/json"),
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"),
    (b"cache-control", b"no-store"),
]

#: Longest a page waits for its session cookie (lib/session-cookie.ts).
SESSION_TIMEOUT_S = 2.0


def own_hosts(port: int) -> frozenset[str]:
    return frozenset({f"127.0.0.1:{port}", f"localhost:{port}"})


def own_origins(port: int) -> frozenset[str]:
    return frozenset(f"http://{host}" for host in own_hosts(port))


def _header(scope: Scope, name: bytes) -> str | None:
    for key, value in scope["headers"]:
        if key == name:
            return value.decode("latin-1")
    return None


async def _refuse(send: Send, status: int, detail: str, extra: list[tuple[bytes, bytes]] | None = None) -> None:
    body = json.dumps({"detail": detail}).encode()
    headers = [*_OWN_HEADERS, (b"content-length", str(len(body)).encode()), *(extra or [])]
    await send({"type": "http.response.start", "status": status, "headers": headers})
    await send({"type": "http.response.body", "body": body})


class HostCheck:
    """Only requests addressed to this server by its own name and port.

    Starlette's ``TrustedHostMiddleware`` compares the name only; this one compares the port as
    well, which a browser always sends for a port other than 80.
    """

    def __init__(self, app: ASGIApp, port: int) -> None:
        self.app = app
        self.hosts = own_hosts(port)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in ("http", "websocket") and (_header(scope, b"host") or "").lower() not in self.hosts:
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 1008})
                return
            await _refuse(send, 400, "Invalid host header.")
            return
        await self.app(scope, receive, send)


class SameOriginCheck:
    """POST, PUT, PATCH and DELETE only with the app's own ``Origin``, or ``Referer`` where a
    browser sends no ``Origin``.

    Browsers send ``Origin`` with every such request, ``null`` from an opaque origin, which is
    refused. A request with neither header comes from a program, not from a web page (the smoke
    test, curl), and passes.
    """

    def __init__(self, app: ASGIApp, port: int) -> None:
        self.app = app
        self.origins = own_origins(port)

    def allowed(self, scope: Scope) -> bool:
        origin = _header(scope, b"origin")
        if origin is not None:
            return origin.lower() in self.origins
        referer = _header(scope, b"referer")
        if referer is not None:
            parts = urlsplit(referer)
            return f"{parts.scheme}://{parts.netloc}".lower() in self.origins
        return True

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] in STATE_CHANGING and not self.allowed(scope):
            await _refuse(send, 403, "Cross-origin request refused.")
            return
        await self.app(scope, receive, send)


class NoCors:
    """Drops every ``Access-Control-*`` header, so that the browser lets no other origin read
    an answer, and refuses preflight requests of other origins."""

    def __init__(self, app: ASGIApp, port: int) -> None:
        self.app = app
        self.origins = own_origins(port)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        origin = _header(scope, b"origin")
        if (
            scope["method"] == "OPTIONS"
            and origin is not None
            and origin.lower() not in self.origins
            and _header(scope, b"access-control-request-method") is not None
        ):
            await _refuse(send, 403, "Cross-origin request refused.")
            return

        async def strip(message: Message) -> None:
            if message["type"] == "http.response.start":
                message["headers"] = [
                    (k, v) for k, v in message.get("headers", []) if not k.lower().startswith(b"access-control-")
                ]
            await send(message)

        await self.app(scope, receive, strip)


def api_scope(scope: Scope) -> Scope:
    """``scope`` as the API sees it: the full path, with ``/api`` as the root path, so that the
    API's routes match on what follows ``/api`` and its links (OpenAPI) keep the prefix."""
    child = dict(scope)
    child["root_path"] = scope.get("root_path", "") + API_PREFIX
    return child


class Router:
    """``/api`` to the API, the instance check to the launcher, the rest to the pages."""

    def __init__(self, api: ASGIApp, pages: PageServer | ASGIApp, instance: dict | None, token: str) -> None:
        self.api = api
        self.pages = pages
        self.instance = instance
        self.token = token

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        kind = scope["type"]
        if kind == "lifespan":
            await self.api(scope, receive, send)
            return
        if kind != "http":
            await send({"type": "websocket.close", "code": 1000})
            return

        path: str = scope["path"]
        if path == API_PREFIX or path.startswith(API_PREFIX + "/"):
            if path.endswith("/"):
                await _refuse(send, 308, "Permanent redirect.", [(b"location", without_trailing_slash(scope))])
                return
            await self.api(api_scope(scope), receive, send)
            return
        if path == INSTANCE_PATH:
            await self._instance(scope, send)
            return
        await self.pages(scope, receive, send)

    async def _instance(self, scope: Scope, send: Send) -> None:
        given = _header(scope, INSTANCE_HEADER)
        if self.instance is None or given is None or not secrets.compare_digest(given.encode(), self.token.encode()):
            await _refuse(send, 404, "Not Found")
            return
        body = json.dumps(self.instance).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 200,
                "headers": [*_OWN_HEADERS, (b"content-length", str(len(body)).encode())],
            }
        )
        await send({"type": "http.response.body", "body": body})


def session_cookie_fetcher(api: ASGIApp) -> SessionCookies:
    """The Set-Cookie headers of the API's ``GET /session`` for the browser that sent ``scope``,
    asked in-process, as middleware.ts asks the API over HTTP. Empty if the API does not answer
    with 2xx within :data:`SESSION_TIMEOUT_S`; the page is then served without a cookie."""

    async def fetch(scope: Scope) -> list[bytes]:
        headers = [(k, v) for k, v in scope["headers"] if k in (b"cookie", b"host", b"user-agent")]
        sub = dict(scope)
        sub.update(
            method="GET",
            path=API_PREFIX + "/session",
            raw_path=(API_PREFIX + "/session").encode(),
            query_string=b"",
            headers=headers,
        )
        sub["state"] = dict(scope.get("state") or {})
        sub = api_scope(sub)

        done = asyncio.Event()
        sent_request = False
        status = 0
        cookies: list[bytes] = []

        async def receive() -> Message:
            nonlocal sent_request
            if not sent_request:
                sent_request = True
                return {"type": "http.request", "body": b"", "more_body": False}
            await done.wait()
            return {"type": "http.disconnect"}

        async def collect(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                cookies.extend(v for k, v in message.get("headers", []) if k.lower() == b"set-cookie")
            elif message["type"] == "http.response.body" and not message.get("more_body", False):
                done.set()

        try:
            await asyncio.wait_for(api(sub, receive, collect), SESSION_TIMEOUT_S)
        except Exception:
            logger.warning("The session cookie could not be fetched for a page.", exc_info=True)
            return []
        finally:
            done.set()
        return cookies if 200 <= status < 300 else []

    return fetch


def build_app(
    api: ASGIApp,
    pages_root,
    *,
    port: int,
    token: str,
    instance: dict | None = None,
) -> ASGIApp:
    """The desktop app on ``port``: ``api`` (``srv_main.app``) and the export in ``pages_root``.
    ``instance`` is what the instance check answers to a caller with ``token``."""
    pages = PageServer.from_export(pages_root, session_cookie_fetcher(api))
    app: ASGIApp = Router(api, pages, instance, token)
    app = NoCors(app, port)
    app = SameOriginCheck(app, port)
    return HostCheck(app, port)


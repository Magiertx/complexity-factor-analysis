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

Behind them the :class:`Router` asks for the launch's access token, as Jupyter does, since any
other program on the machine (also of another user) can reach 127.0.0.1 and these checks only
stop web pages. The launcher opens ``/?token=<token>``; the page server trades the token for an
``HttpOnly``, ``SameSite=Strict`` cookie and redirects to the same address without it. Every
request to the API and every page needs that cookie, or ``Authorization: Bearer <token>`` for
scripts. Only ``/api/health`` is open, and says no more than "ok".

:class:`Shutdown` ends the progress streams (Server-Sent Events) when the app quits; they never
end by themselves, and the server would wait for them.
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
from urllib.parse import parse_qsl, urlencode, urlsplit

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .pages import PageServer, SessionCookies, local_location, without_trailing_slash

logger = logging.getLogger("desktop")

API_PREFIX = "/api"
#: Answers another start of the launcher whether this is the instance it looks for.
INSTANCE_PATH = "/_desktop/instance"
INSTANCE_HEADER = b"x-desktop-instance"

#: The cookie of the access token carries the port, since cookies are shared between ports of a host.
ACCESS_COOKIE = "desktop_access"
TOKEN_PARAMETER = "token"
HEALTH_PATH = API_PREFIX + "/health"

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


LANDING_PAGE = (
    b"<!doctype html><html lang=en><meta charset=utf-8><title>Not opened from the app</title>"
    b"<h1>This address needs the app</h1>"
    b"<p>Start the app from its icon, or use the button &quot;Open in browser&quot; of its window. "
    b"That opens this address with the key of the current start.</p></html>"
)


def access_cookie_name(port: int) -> str:
    return f"{ACCESS_COOKIE}_{port}"


def _cookies(scope: Scope) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in scope["headers"]:
        if key == b"cookie":
            for part in value.decode("latin-1").split(";"):
                name, _, text = part.strip().partition("=")
                if name:
                    out.setdefault(name, text)
    return out


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


class Shutdown:
    """Tells the open progress streams that the app quits, from any thread.

    A page keeps ``/api/jobs/events`` open for as long as it is shown. When the app quits, the
    stream is told that its client went away, ends, and the response is completed, so that the
    server need not wait for it and cut it off.
    """

    def __init__(self) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._event: asyncio.Event | None = None

    def bind(self) -> None:
        """Called in the server's event loop when it starts."""
        self._loop = asyncio.get_running_loop()
        self._event = asyncio.Event()

    @property
    def requested(self) -> bool:
        return self._event is not None and self._event.is_set()

    def request(self) -> None:
        loop, event = self._loop, self._event
        if loop is not None and event is not None and not loop.is_closed():
            loop.call_soon_threadsafe(event.set)

    async def wait(self) -> None:
        if self._event is not None:
            await self._event.wait()
        else:
            await asyncio.Event().wait()


def is_event_stream(scope: Scope) -> bool:
    return scope["method"] == "GET" and "text/event-stream" in (_header(scope, b"accept") or "")


def api_scope(scope: Scope) -> Scope:
    """``scope`` as the API sees it: the full path, with ``/api`` as the root path, so that the
    API's routes match on what follows ``/api`` and its links (OpenAPI) keep the prefix."""
    child = dict(scope)
    child["root_path"] = scope.get("root_path", "") + API_PREFIX
    return child


class Router:
    """``/api`` to the API, the instance check to the launcher, the rest to the pages."""

    def __init__(
        self,
        api: ASGIApp,
        pages: PageServer | ASGIApp,
        instance: dict | None,
        token: str,
        shutdown: Shutdown,
        port: int = 0,
    ) -> None:
        self.api = api
        self.pages = pages
        self.instance = instance
        self.token = token
        self.shutdown = shutdown
        self.cookie_name = access_cookie_name(port)

    def _is_token(self, given: str | bytes | None) -> bool:
        if given is None:
            return False
        raw = given.encode("utf-8", "surrogatepass") if isinstance(given, str) else given
        return secrets.compare_digest(raw, self.token.encode("utf-8"))

    def authorized(self, scope: Scope) -> bool:
        """The cookie the page server set, or the bearer token of a script."""
        auth = _header(scope, b"authorization") or ""
        scheme, _, value = auth.partition(" ")
        if scheme.lower() == "bearer" and self._is_token(value.strip()):
            return True
        return self._is_token(_cookies(scope).get(self.cookie_name))

    def token_in_query(self, scope: Scope) -> tuple[bool, str]:
        """Whether the query string holds the valid token, and the query without any ``token``."""
        pairs = parse_qsl(scope.get("query_string", b"").decode("latin-1"), keep_blank_values=True)
        valid = any(k == TOKEN_PARAMETER and self._is_token(v) for k, v in pairs)
        return valid, urlencode([(k, v) for k, v in pairs if k != TOKEN_PARAMETER])

    async def _trade_token(self, scope: Scope, rest: str, send: Send) -> None:
        """303 to the same page without the token, with the cookie that replaces it."""
        location = local_location(scope["path"], rest)
        cookie = f"{self.cookie_name}={self.token}; HttpOnly; SameSite=Strict; Path=/"
        await _refuse(send, 303, "Signed in.", [(b"location", location), (b"set-cookie", cookie.encode("ascii"))])

    async def _landing(self, send: Send) -> None:
        headers = [
            (k, v) for k, v in _OWN_HEADERS if k != b"content-type"
        ] + [(b"content-type", b"text/html; charset=utf-8"), (b"content-length", str(len(LANDING_PAGE)).encode())]
        await send({"type": "http.response.start", "status": 401, "headers": headers})
        await send({"type": "http.response.body", "body": LANDING_PAGE})

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        kind = scope["type"]
        if kind == "lifespan":

            async def watch() -> Message:
                message = await receive()
                if message["type"] == "lifespan.startup":
                    self.shutdown.bind()
                return message

            await self.api(scope, watch, send)
            return
        if kind != "http":
            await send({"type": "websocket.close", "code": 1000})
            return

        path: str = scope["path"]
        if path == INSTANCE_PATH:  # has its own key
            await self._instance(scope, send)
            return
        is_api = path == API_PREFIX or path.startswith(API_PREFIX + "/")
        if not (is_api and path == HEALTH_PATH):
            if not is_api and scope["method"] in ("GET", "HEAD"):
                valid, rest = self.token_in_query(scope)
                if valid:
                    await self._trade_token(scope, rest, send)
                    return
            if not self.authorized(scope):
                if is_api:
                    await _refuse(send, 401, "Not authorized: this app needs the key of its current start.")
                else:
                    await self._landing(send)
                return
        if is_api:
            if path.endswith("/"):
                await _refuse(send, 308, "Permanent redirect.", [(b"location", without_trailing_slash(scope))])
                return
            if is_event_stream(scope):
                await self._event_stream(api_scope(scope), receive, send)
            else:
                await self.api(api_scope(scope), receive, send)
            return
        await self.pages(scope, receive, send)

    async def _event_stream(self, scope: Scope, receive: Receive, send: Send) -> None:
        """A stream that ends as if its client had gone when the app quits (Starlette's
        StreamingResponse stops on ``http.disconnect``), and is then completed here."""
        started = complete = False

        async def receive_or_quit() -> Message:
            if self.shutdown.requested:
                return {"type": "http.disconnect"}
            get = asyncio.ensure_future(receive())
            stop = asyncio.ensure_future(self.shutdown.wait())
            try:
                await asyncio.wait({get, stop}, return_when=asyncio.FIRST_COMPLETED)
            finally:
                for task in (get, stop):
                    if not task.done():
                        task.cancel()
            if get.done() and not get.cancelled():
                return get.result()
            return {"type": "http.disconnect"}

        async def watch(message: Message) -> None:
            nonlocal started, complete
            if message["type"] == "http.response.start":
                started = True
            elif message["type"] == "http.response.body" and not message.get("more_body", False):
                complete = True
            await send(message)

        await self.api(scope, receive_or_quit, watch)
        if started and not complete and self.shutdown.requested:
            await send({"type": "http.response.body", "body": b"", "more_body": False})

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
    shutdown: Shutdown | None = None,
) -> ASGIApp:
    """The desktop app on ``port``: ``api`` (``srv_main.app``) and the export in ``pages_root``.
    ``instance`` is what the instance check answers to a caller with ``token``; ``shutdown``
    ends the progress streams when the app quits."""
    pages = PageServer.from_export(pages_root, session_cookie_fetcher(api))
    app: ASGIApp = Router(api, pages, instance, token, shutdown or Shutdown(), port)
    app = NoCors(app, port)
    app = SameOriginCheck(app, port)
    return HostCheck(app, port)


"""One ASGI app for the whole tool: the API under ``/api``, the pages everywhere else.

``/api/<path>`` reaches the backend's ``/<path>``, as the rewrite of next.config.mjs does in the
Docker build. Around both, the checks a server on 127.0.0.1 needs, since every web page the
user opens can send requests to it:

- :class:`HostCheck`: only ``127.0.0.1:<port>`` and ``localhost:<port>``, against DNS rebinding
  (a foreign name that resolves to 127.0.0.1 arrives with its own name in ``Host``).
- :class:`SameOriginCheck`: every method but GET, HEAD and OPTIONS only from the app's own pages. A
  form post or a multipart upload of another site is a "simple" request that CORS does not stop.
- :class:`NoCors`: no ``Access-Control-*`` header leaves the app, so no other origin can read
  an answer (the backend's own CORS setting is for the Docker build).

Behind them the :class:`Router` asks for credentials, as Jupyter does, since any other program
on the machine (also of another user) can reach 127.0.0.1 and these checks only stop web pages.
:class:`Access` holds them. The launcher does not put a code on the command line of the browser
(other users can read it there, e.g. in ``/proc/<pid>/cmdline``): it writes a small redirect page
into the private data directory (mode 0600) and opens that file; the page forwards to
``/?token=<code>``, with a one-time code that is valid for :data:`CODE_TTL_S` seconds. The file
is deleted when the code is redeemed, or at the latest when the app quits. The page server
redeems the code (on GET only) for a fresh random session value, sets it as an ``HttpOnly``,
``SameSite=Strict`` session cookie and redirects to the same address without the code. Every
request to the API and every page needs that cookie, or ``Authorization: Bearer <token>`` with
the launch's master token for scripts. The master token also asks for a login file
(``/_desktop/login``, for the second start). The instance check (``/_desktop/instance``) proves
that the server knows the token without anybody sending it: it answers a random nonce with
HMAC-SHA256(token, nonce). Only ``/api/health`` is open, and says no more than "ok".

:class:`Shutdown` ends the progress streams (Server-Sent Events) when the app quits; they never
end by themselves, and the server would wait for them.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import html
import json
import logging
import secrets
import threading
import time
from pathlib import Path
from typing import Callable
from urllib.parse import parse_qsl, urlencode, urlsplit

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .pages import PageServer, SessionCookies, local_location, without_trailing_slash
from .state import write_private_text

logger = logging.getLogger("desktop")

API_PREFIX = "/api"
#: Proves to another start of the launcher that this is the instance it looks for.
INSTANCE_PATH = "/_desktop/instance"
#: Gives a caller with the master token a login file (and its one-time code) for the browser.
LOGIN_PATH = "/_desktop/login"
INSTANCE_HEADER = b"x-desktop-instance"
NONCE_HEADER = b"x-desktop-nonce"

#: How long a one-time code can be redeemed, and how many sessions (browsers) are remembered.
CODE_TTL_S = 60.0
MAX_SESSIONS = 64

#: The cookie of the session value carries the port, since cookies are shared between ports of a host.
ACCESS_COOKIE = "desktop_access"
TOKEN_PARAMETER = "token"
HEALTH_PATH = API_PREFIX + "/health"

#: Methods that change nothing and need no origin check; every other method is checked.
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
LOGIN_FILE_PREFIX = "open-"


def proof(token: str, nonce: str) -> str:
    """What a server that knows ``token`` answers to ``nonce`` (the instance check)."""
    return hmac.new(token.encode("utf-8"), nonce.encode("utf-8"), hashlib.sha256).hexdigest()


def redirect_page(url: str) -> str:
    """The page that sends the browser on to ``url``; what the login file holds."""
    quoted = html.escape(url, quote=True)
    return (
        "<!doctype html><html lang=en><head><meta charset=utf-8><title>Opening the app</title>"
        f'<meta http-equiv=refresh content="0;url={quoted}"></head>'
        f'<body><p>Opening the app. If nothing happens, <a href="{quoted}">continue here</a>.</p></body></html>\n'
    )


def remove_login_files(directory: Path) -> None:
    """Delete the login files a crashed start left behind."""
    try:
        for path in Path(directory).glob(LOGIN_FILE_PREFIX + "*.html"):
            path.unlink(missing_ok=True)
    except OSError:
        pass

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


def _cookie_values(scope: Scope, wanted: str) -> list[str]:
    """Every value of the cookie called ``wanted``. There can be several: cookies are shared
    between the ports of 127.0.0.1, so another server there can set one of the same name."""
    out: list[str] = []
    for key, value in scope["headers"]:
        if key == b"cookie":
            for part in value.decode("latin-1").split(";"):
                name, _, text = part.strip().partition("=")
                if name == wanted:
                    out.append(text)
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
    """Every method but GET, HEAD and OPTIONS (an allowlist, whatever the case of the name) only
    with the app's own ``Origin``, or ``Referer`` where a browser sends no ``Origin``.

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
        if scope["type"] == "http" and scope["method"].upper() not in SAFE_METHODS and not self.allowed(scope):
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


class Access:
    """What opens the app: the launch's master token, one-time codes and the session values
    that codes are redeemed for.

    The master token (kept in ``instance.json``, in a ``--token-file``) is for programs: the
    bearer header, the instance check, asking for a code. Browsers get a code, which is valid
    once and for :data:`CODE_TTL_S` seconds, and trade it for a random session value that is
    their cookie; so the cookie, which other servers on 127.0.0.1 can receive since cookies are
    not bound to a port, is worth nothing but this app's pages, and only until it quits. Every
    comparison takes constant time. Safe to call from any thread.
    """

    def __init__(self, token: str, login_dir: Path | None = None) -> None:
        self.token = token
        #: Where the login files go: a private directory (``AppPaths.data``).
        self.login_dir = Path(login_dir) if login_dir is not None else None
        self._lock = threading.Lock()
        self._codes: dict[str, float] = {}
        self._files: dict[str, Path] = {}
        self._sessions: list[str] = []

    @staticmethod
    def _same(given: str | bytes | None, expected: str) -> bool:
        if given is None:
            return False
        raw = given.encode("utf-8", "surrogatepass") if isinstance(given, str) else given
        return secrets.compare_digest(raw, expected.encode("utf-8"))

    def is_master(self, given: str | bytes | None) -> bool:
        return self._same(given, self.token)

    def new_code(self) -> str:
        code = secrets.token_urlsafe(32)
        now = time.monotonic()
        expired: list[Path] = []
        with self._lock:
            for old, expires in list(self._codes.items()):
                if expires <= now:
                    del self._codes[old]
                    if old in self._files:
                        expired.append(self._files.pop(old))
            self._codes[code] = now + CODE_TTL_S
        for path in expired:
            path.unlink(missing_ok=True)
        return code

    def new_login_file(self, address: Callable[[str], str]) -> tuple[str, Path]:
        """A new one-time code and the file that opens the app with it: a redirect page to
        ``address(code)`` that only the owner can read. The file goes when the code is redeemed
        or has expired, or at :meth:`close`."""
        if self.login_dir is None:
            raise RuntimeError("no directory for login files")
        code = self.new_code()
        path = self.login_dir / f"{LOGIN_FILE_PREFIX}{secrets.token_hex(8)}.html"
        write_private_text(path, redirect_page(address(code)))
        with self._lock:
            self._files[code] = path
        return code, path

    def close(self) -> None:
        """Delete the login files that are left."""
        with self._lock:
            files = list(self._files.values())
            self._files.clear()
            self._codes.clear()
        for path in files:
            path.unlink(missing_ok=True)

    def redeem(self, given: str) -> str | None:
        """A new session value for a valid code, which is used up; else ``None``."""
        now = time.monotonic()
        with self._lock:
            match = None
            for code, expires in self._codes.items():  # all of them: no early exit to time
                if self._same(given, code) and expires > now and match is None:
                    match = code
            if match is None:
                return None
            del self._codes[match]
            used = self._files.pop(match, None)
            session = secrets.token_urlsafe(32)
            self._sessions = [*self._sessions, session][-MAX_SESSIONS:]
        if used is not None:
            used.unlink(missing_ok=True)
        return session

    def is_session(self, given: str | None) -> bool:
        with self._lock:
            sessions = list(self._sessions)
        found = False
        for session in sessions:
            found = self._same(given, session) or found
        return found


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
        access: Access | None = None,
    ) -> None:
        self.api = api
        self.pages = pages
        self.instance = instance
        self.token = token
        self.shutdown = shutdown
        self.port = port
        self.cookie_name = access_cookie_name(port)
        self.access = access or Access(token)

    def authorized(self, scope: Scope) -> bool:
        """The session cookie the page server set, or the master token of a script as a bearer."""
        auth = _header(scope, b"authorization") or ""
        scheme, _, value = auth.partition(" ")
        if scheme.lower() == "bearer" and self.access.is_master(value.strip()):
            return True
        return any(self.access.is_session(value) for value in _cookie_values(scope, self.cookie_name))

    def redeem_code(self, scope: Scope) -> tuple[str | None, str]:
        """The session value for a valid one-time code in the query string (which is used up),
        and the query without any ``token``."""
        pairs = parse_qsl(scope.get("query_string", b"").decode("latin-1"), keep_blank_values=True)
        session = None
        for key, value in pairs:
            if key == TOKEN_PARAMETER and session is None:
                session = self.access.redeem(value)
        return session, urlencode([(k, v) for k, v in pairs if k != TOKEN_PARAMETER])

    async def _trade_token(self, scope: Scope, session: str, rest: str, send: Send) -> None:
        """303 to the same page without the code, with the session cookie (no ``Max-Age``: it
        goes with the browser session)."""
        location = local_location(scope["path"], rest)
        cookie = f"{self.cookie_name}={session}; HttpOnly; SameSite=Strict; Path=/"
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
        if path == LOGIN_PATH:
            await self._login(scope, send)
            return
        is_api = path == API_PREFIX or path.startswith(API_PREFIX + "/")
        if not (is_api and path == HEALTH_PATH):
            if not is_api and scope["method"] == "GET":  # not HEAD: it must not use up the code
                session, rest = self.redeem_code(scope)
                if session is not None:
                    await self._trade_token(scope, session, rest, send)
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

    async def _login(self, scope: Scope, send: Send) -> None:
        """A login file and its one-time code for a caller with the master token (the second
        start, a test). Without a directory for login files only the code."""
        if scope["method"] != "GET" or not self.access.is_master(_header(scope, INSTANCE_HEADER)):
            await _refuse(send, 404, "Not Found")
            return
        if self.access.login_dir is None:
            answer = {"code": self.access.new_code()}
        else:
            code, path = self.access.new_login_file(lambda c: f"http://127.0.0.1:{self.port}/?{TOKEN_PARAMETER}={c}")
            answer = {"code": code, "file": str(path)}
        body = json.dumps(answer).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 200,
                "headers": [*_OWN_HEADERS, (b"content-length", str(len(body)).encode())],
            }
        )
        await send({"type": "http.response.body", "body": body})

    async def _instance(self, scope: Scope, send: Send) -> None:
        """The answer to a nonce: HMAC-SHA256(master token, nonce), with the instance's details.
        The token itself is never sent, so a caller that asks a foreign server loses nothing."""
        nonce = _header(scope, NONCE_HEADER)
        if scope["method"] != "GET" or self.instance is None or not nonce or not 16 <= len(nonce) <= 128:
            await _refuse(send, 404, "Not Found")
            return
        body = json.dumps({**self.instance, "proof": proof(self.token, nonce)}).encode()
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
    access: Access | None = None,
) -> ASGIApp:
    """The desktop app on ``port``: ``api`` (``srv_main.app``) and the export in ``pages_root``.
    ``instance`` is what the instance check answers to a caller with ``token``; ``shutdown``
    ends the progress streams when the app quits."""
    pages = PageServer.from_export(pages_root, session_cookie_fetcher(api))
    app: ASGIApp = Router(api, pages, instance, token, shutdown or Shutdown(), port, access)
    app = NoCors(app, port)
    app = SameOriginCheck(app, port)
    return HostCheck(app, port)


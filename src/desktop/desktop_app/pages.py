"""The pages of the static export (``npm run build:export``), served as the Next.js server of the
Docker image serves them.

- ``/`` is ``index.html``, ``/x`` is ``x.html``; a file that exists is served as it is (the
  ``.txt`` payloads client-side navigation loads, ``_next/static``, ``icon.svg``, ...); anything
  else is ``404.html`` with status 404. The query string plays no part. ``/x/`` redirects to
  ``/x``, as Next.js does.
- Every response carries the headers of ``out/_headers.json`` (security-headers.mjs, the same
  list next.config.mjs applies in the Docker build).
- The request of a page gets the session cookie with it, as ``middleware.ts`` does in the Docker
  build: the page fires several API requests at once, which must all arrive with one session.
"""

from __future__ import annotations

import json
import mimetypes
from pathlib import Path
from typing import Awaitable, Callable
from urllib.parse import quote

from starlette.responses import FileResponse, PlainTextResponse
from starlette.types import Receive, Scope, Send

from .state import LauncherError

#: The types the pages need. On Windows ``mimetypes`` reads the registry, which can map ``.js``
#: or ``.mjs`` to ``text/plain``; with ``X-Content-Type-Options: nosniff`` the browser then runs
#: no script and the page stays white.
MIME_TYPES = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".txt": "text/plain",
    ".json": "application/json",
    ".map": "application/json",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".csv": "text/csv",
}

#: Long-lived, as Next.js serves them: their names change with their content.
IMMUTABLE = "public, max-age=31536000, immutable"
#: Everything else is checked again on each use, so a new version of the app is seen at once.
REVALIDATE = "no-cache"
#: A response that sets the session cookie (middleware.ts).
PRIVATE = "private, no-store"

#: Answers the Set-Cookie headers of the API's ``GET /session`` for the request ``scope``.
SessionCookies = Callable[[Scope], Awaitable[list[bytes]]]


def register_mime_types() -> None:
    for extension, media_type in MIME_TYPES.items():
        mimetypes.add_type(media_type, extension)


def media_type(path: Path) -> str:
    # The table first: another library may call mimetypes.init() again, which rereads the registry.
    return MIME_TYPES.get(path.suffix.lower()) or mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def local_location(path: str, query: str | bytes = b"") -> bytes:
    """A ``Location`` for ``path`` that stays on this origin.

    A run of leading slashes and backslashes (also from ``%2F`` or ``%5C``, which
    ``scope["path"]`` has decoded) would make a ``//host``, which a browser takes for another
    site, so it collapses to one ``/``. The path is percent-encoded again, so that no control
    character reaches the header.
    """
    text = query.decode("latin-1") if isinstance(query, bytes) else query
    location = quote("/" + path.lstrip("/\\"), safe="/:@!$&'()*+,;=-._~")
    if text:
        location += "?" + text
    return location.encode("latin-1")


def without_trailing_slash(scope: Scope) -> bytes:
    """Where Next.js redirects a path that ends in ``/`` (``trailingSlash: false``), with the
    query string."""
    return local_location(scope["path"].rstrip("/"), scope.get("query_string") or b"")


def _safe_segment(segment: str) -> bool:
    """A path segment that names a file below the export and nothing else, on every system
    (no ``..``, no drive or stream after ``:``, no name Windows would shorten)."""
    if segment in ("", ".", ".."):
        return False
    if any(c in segment for c in "\\:\x00"):
        return False
    return not segment.endswith((".", " "))


def wants_session(scope: Scope) -> bool:
    """Whether middleware.ts would ask for the session cookie: the browser loads a page (GET,
    HTML accepted, not a client-side navigation or prefetch), at a path its matcher covers (no
    ``_next/``, no file extension)."""
    if scope["method"] != "GET":
        return False
    path: str = scope["path"]
    if path.startswith("/_next/") or "." in path:
        return False
    headers = dict(scope["headers"])
    if b"rsc" in headers or b"next-router-prefetch" in headers:
        return False
    return b"text/html" in headers.get(b"accept", b"")


class PageServer:
    """ASGI app for the export in ``root``; ``session_cookies`` sets the cookie on page loads."""

    def __init__(self, root: Path, headers: dict[str, str], session_cookies: SessionCookies | None = None) -> None:
        self.root = Path(root).resolve()
        self.headers = [(k.lower().encode("latin-1"), v.encode("latin-1")) for k, v in headers.items()]
        self.session_cookies = session_cookies

    @classmethod
    def from_export(cls, root: Path, session_cookies: SessionCookies | None = None) -> "PageServer":
        root = Path(root)
        headers_file = root / "_headers.json"
        if not (root / "index.html").is_file() or not headers_file.is_file():
            raise LauncherError(
                f"No static export of the frontend in {root}. Build it with "
                "`npm ci` and `npm run build:export` in src/frontend."
            )
        headers = json.loads(headers_file.read_text(encoding="utf-8"))
        if not isinstance(headers, dict) or not all(isinstance(v, str) for v in headers.values()) or not headers:
            raise LauncherError(f"{headers_file} is not an object of header names and values.")
        return cls(root, headers, session_cookies)

    def resolve(self, path: str) -> Path | None:
        """The file a URL path names, or ``None``."""
        if path == "/":
            candidates = ["index.html"]
        else:
            relative = path[1:] if path.startswith("/") else path
            if not all(_safe_segment(s) for s in relative.split("/")):
                return None
            candidates = [relative, relative + ".html"]
        for candidate in candidates:
            if candidate.lower() == "_headers.json":  # also where the file system ignores the case
                continue
            try:
                found = (self.root / candidate).resolve(strict=True)
            except (OSError, RuntimeError):
                continue
            if found.is_file() and found.is_relative_to(self.root):
                return found
        return None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["method"] not in ("GET", "HEAD"):
            response = PlainTextResponse("Method Not Allowed", status_code=405, headers={"Allow": "GET, HEAD"})
            response.raw_headers.extend(self.headers)
            await response(scope, receive, send)
            return

        path: str = scope["path"]
        if path != "/" and path.endswith("/"):
            response = PlainTextResponse("Permanent Redirect", status_code=308)
            response.raw_headers.extend(self.headers)
            response.raw_headers.append((b"location", without_trailing_slash(scope)))
            await response(scope, receive, send)
            return
        found = self.resolve(path)
        status = 200
        if found is None:
            found, status = self.root / "404.html", 404

        cookies: list[bytes] = []
        if self.session_cookies is not None and wants_session(scope):
            cookies = await self.session_cookies(scope)

        if cookies:
            cache = PRIVATE
        elif status == 200 and path.startswith("/_next/static/"):
            cache = IMMUTABLE
        else:
            cache = REVALIDATE

        if not found.is_file():  # an export without 404.html
            response = PlainTextResponse("Not Found", status_code=404)
        else:
            response = FileResponse(found, status_code=status, media_type=media_type(found))
        names = {name for name, _ in self.headers} | {b"cache-control", b"set-cookie"}
        response.raw_headers[:] = [(k, v) for k, v in response.raw_headers if k not in names]
        response.raw_headers.extend(self.headers)
        response.raw_headers.append((b"cache-control", cache.encode()))
        response.raw_headers.extend((b"set-cookie", cookie) for cookie in cookies)
        await response(scope, receive, send)

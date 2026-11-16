"""Swagger UI (/docs) and ReDoc (/redoc), each with a Content-Security-Policy of its own.

Every other answer of the API carries ``default-src 'none'`` (``srv_main.security_headers``),
which leaves these two pages blank: they load their script and style from jsDelivr, as FastAPI's
own pages do, and Swagger UI starts with an inline script. Their policy allows exactly that:
script and style from jsDelivr, the inline script by its hash, the OpenAPI document and the
requests of "Try it out" to the own origin, images from it and as data URLs (and ReDoc's logo),
and ReDoc's search worker from a blob URL.
"""

from __future__ import annotations

import base64
import hashlib
import re

from fastapi import APIRouter, Request
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.responses import HTMLResponse

router = APIRouter(include_in_schema=False)

#: Where FastAPI's pages load Swagger UI and ReDoc from.
CDN = "https://cdn.jsdelivr.net"
#: Where ReDoc shows its logo from.
REDOC_LOGO = "https://cdn.redoc.ly"

_INLINE_SCRIPT = re.compile(r"<script>(.*?)</script>", re.S)


def inline_script_hashes(html: str) -> list[str]:
    """The CSP source of each inline ``<script>`` of ``html``, as ``'sha256-...'``."""
    return [
        "'sha256-" + base64.b64encode(hashlib.sha256(body.encode()).digest()).decode() + "'"
        for body in _INLINE_SCRIPT.findall(html)
    ]


def docs_csp(html: str, images: tuple[str, ...] = ()) -> str:
    """The policy of a documentation page whose HTML is ``html``; ``images`` are further sources
    of images."""
    return "; ".join(
        [
            "default-src 'none'",
            " ".join(["script-src", CDN, *inline_script_hashes(html)]),
            # Both libraries set styles from their scripts; ReDoc also brings a <style>.
            f"style-src {CDN} 'unsafe-inline'",
            " ".join(["img-src 'self' data:", *images]),
            "connect-src 'self'",
            "worker-src blob:",
            "frame-ancestors 'none'",
            "base-uri 'none'",
            "form-action 'none'",
        ]
    )


def _root(request: Request) -> str:
    return request.scope.get("root_path", "").rstrip("/")


def _favicon(root: str) -> str:
    """The icon of the app, which the frontend serves next to /api (``root`` is its prefix)."""
    return f"{root.rsplit('/', 1)[0] if root else ''}/icon.svg"


def _with_policy(response: HTMLResponse, images: tuple[str, ...] = ()) -> HTMLResponse:
    response.headers["Content-Security-Policy"] = docs_csp(response.body.decode(), images)
    return response


@router.get("/docs")
async def swagger_ui(request: Request) -> HTMLResponse:
    root = _root(request)
    return _with_policy(
        get_swagger_ui_html(
            openapi_url=root + request.app.openapi_url,
            title=f"{request.app.title} - Swagger UI",
            swagger_favicon_url=_favicon(root),
            # The validator badge would load an image from validator.swagger.io.
            swagger_ui_parameters={"validatorUrl": None},
        )
    )


@router.get("/redoc")
async def redoc(request: Request) -> HTMLResponse:
    root = _root(request)
    return _with_policy(
        get_redoc_html(
            openapi_url=root + request.app.openapi_url,
            title=f"{request.app.title} - ReDoc",
            redoc_favicon_url=_favicon(root),
            with_google_fonts=False,
        ),
        # The logo of the "powered by ReDoc" line.
        images=(REDOC_LOGO,),
    )

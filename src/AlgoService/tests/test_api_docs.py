"""The pages of the API documentation may load what they need; the API keeps its strict policy."""

from __future__ import annotations

import base64
import hashlib
import re

import pytest

STRICT = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"


def _directives(policy: str) -> dict[str, list[str]]:
    return {name: rest for name, *rest in (part.split() for part in policy.split(";") if part.strip())}


def _inline_scripts(html: str) -> list[str]:
    return re.findall(r"<script>(.*?)</script>", html, re.S)


@pytest.mark.parametrize("path, script", [
    ("/docs", "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"),
    ("/redoc", "https://cdn.jsdelivr.net/npm/redoc@2/bundles/redoc.standalone.js"),
])
def test_the_documentation_pages_allow_their_scripts_and_styles(client, path, script):
    r = client.get(path)
    assert r.status_code == 200 and script in r.text
    policy = r.headers.get_list("content-security-policy")
    assert len(policy) == 1
    directives = _directives(policy[0])
    assert directives["default-src"] == ["'none'"]
    assert "https://cdn.jsdelivr.net" in directives["script-src"]
    assert "'unsafe-inline'" not in directives["script-src"] and "'unsafe-eval'" not in directives["script-src"]
    assert "https://cdn.jsdelivr.net" in directives["style-src"]
    assert directives["connect-src"] == ["'self'"]
    assert directives["frame-ancestors"] == ["'none'"]
    # The inline script that starts Swagger UI is allowed by its hash, and only it.
    hashes = {"'sha256-" + base64.b64encode(hashlib.sha256(s.encode()).digest()).decode() + "'" for s in _inline_scripts(r.text)}
    assert hashes == {s for s in directives["script-src"] if s.startswith("'sha256-")}
    assert bool(hashes) == (path == "/docs")
    # Nothing from elsewhere: no Google Fonts, no favicon of fastapi.tiangolo.com, no validator.
    assert "fonts.googleapis.com" not in r.text and "tiangolo" not in r.text
    if path == "/docs":
        assert '"validatorUrl": null' in r.text


def test_the_documentation_names_the_openapi_document_under_the_root_path(client, monkeypatch):
    from srv_main import app

    monkeypatch.setattr(app, "root_path", "/api")
    r = client.get("/docs")
    assert "url: '/api/openapi.json'" in r.text and 'href="/icon.svg"' in r.text
    assert '<redoc spec-url="/api/openapi.json">' in client.get("/redoc").text


@pytest.mark.parametrize("path", ["/health", "/openapi.json", "/factor-analysis/catalog", "/docs/x"])
def test_everything_else_keeps_the_strict_policy(client, path):
    r = client.get(path)
    assert r.headers.get_list("content-security-policy") == [STRICT]

"""The desktop app serves the static export and the API as the Docker build serves them."""

from __future__ import annotations

import mimetypes
import uuid

import pytest

from ._support import API_CSP, BEARER, HTML, ORIGIN, PAGE_HEADERS, asgi_get, cookie_session_id

# --- routing --------------------------------------------------------------------------------


def test_root_and_page_paths_serve_their_html(desktop_client):
    assert "index page" in desktop_client.get("/").text
    assert "log page" in desktop_client.get("/log").text
    # The query string does not take part.
    response = desktop_client.get("/log?tab=measures&x=1")
    assert response.status_code == 200 and "log page" in response.text
    assert response.headers["content-type"] == "text/html; charset=utf-8"


@pytest.mark.parametrize(
    "path, media_type",
    [
        ("/log.txt", "text/plain"),
        ("/index.txt", "text/plain"),
        ("/_next/static/chunks/main-abc123.js", "text/javascript"),
        ("/_next/static/chunks/module-abc123.mjs", "text/javascript"),
        ("/_next/static/css/app-abc123.css", "text/css"),
        ("/_next/static/media/font-abc123.woff2", "font/woff2"),
        ("/icon.svg", "image/svg+xml"),
        ("/favicon.ico", "image/x-icon"),
        ("/logo.png", "image/png"),
        ("/data.json", "application/json"),
        ("/examples/example-measures.csv", "text/csv"),
    ],
)
def test_existing_files_are_served_with_their_type(desktop_client, path, media_type):
    response = desktop_client.get(path)
    assert response.status_code == 200
    assert response.headers["content-type"].split(";")[0] == media_type


@pytest.mark.parametrize(
    "path",
    [
        "/nope",
        "/nope.txt",
        "/log.htm",
        "/_next/static/chunks/missing.js",
        "/_headers.json",  # the server's own file, not a page
        "/..%2F..%2Fetc%2Fpasswd",
        "/_next/..%2F..%2Fsecret",
        "/log.html.",  # Windows would open log.html
        "/log.html::$DATA",
        "/C:%5CWindows%5Cwin.ini",
        "/apis",
    ],
)
def test_anything_else_is_the_404_page(desktop_client, path):
    response = desktop_client.get(path)
    assert response.status_code == 404
    assert "page not found" in response.text
    assert response.headers["content-type"] == "text/html; charset=utf-8"


def test_a_trailing_slash_redirects_like_nextjs(desktop_client):
    response = desktop_client.get("/log/?tab=1", follow_redirects=False)
    assert response.status_code == 308
    assert response.headers["location"] == "/log?tab=1"
    response = desktop_client.get("/api/health/", follow_redirects=False)
    assert (response.status_code, response.headers["location"]) == (308, "/api/health")


@pytest.mark.parametrize(
    "path, location",
    [
        ("//evil.example/", "/evil.example"),
        ("/\evil.example/", "/evil.example"),
        ("/%2F%2Fevil.example/", "/evil.example"),  # as the server has it, decoded
        ("///evil.example/", "/evil.example"),
        ("//", "/"),
        ("/\/", "/"),
        ("/a//", "/a"),
    ],
)
def test_a_redirect_never_leaves_the_origin(desktop_app, path, location):
    """``Location: //evil.example`` would send the browser to another site."""
    decoded = path.replace("%2F", "/")
    status, headers = asgi_get(desktop_app, decoded, "x=1", BEARER)
    assert status == 308, path
    assert headers["location"] == location + "?x=1"
    assert not headers["location"].startswith(("//", "/\\"))


@pytest.mark.parametrize("path", ["/%2F%2Fevil.example/", "/%5Cevil.example/", "/x//"])
def test_the_encoded_forms_through_a_real_client(desktop_client, path):
    response = desktop_client.get(path, follow_redirects=False)
    assert response.status_code in (308, 404)
    assert not response.headers.get("location", "/").startswith(("//", "/\\"))


@pytest.mark.parametrize("path", ["//evil.example/", "/api//evil.example/", "/api/\evil/"])
def test_the_api_redirect_stays_on_the_origin_too(desktop_app, path):
    status, headers = asgi_get(desktop_app, path, "", BEARER)
    assert status in (308, 404)
    assert not headers.get("location", "/").startswith(("//", "/\\"))


def test_a_control_character_in_the_path_stays_out_of_the_header(desktop_client):
    response = desktop_client.get("/log%0d%0aSet-Cookie:x=1/", follow_redirects=False)
    assert response.status_code == 308
    assert "\r" not in response.headers["location"] and "set-cookie" not in response.headers
    assert response.headers["location"] == "/log%0D%0ASet-Cookie:x=1"


def test_head_and_other_methods(desktop_client):
    head = desktop_client.head("/log")
    assert head.status_code == 200 and head.content == b""
    assert int(head.headers["content-length"]) == len("<!doctype html><title>log page</title>")
    assert desktop_client.post("/log").status_code == 405


# --- headers --------------------------------------------------------------------------------


@pytest.mark.parametrize("path", ["/", "/log", "/log.txt", "/_next/static/chunks/main-abc123.js", "/nope", "/log/"])
def test_pages_carry_exactly_the_export_headers(desktop_client, path):
    response = desktop_client.get(path, headers=HTML, follow_redirects=False)
    for name, value in PAGE_HEADERS.items():
        assert response.headers.get_list(name) == [value], name


def test_the_api_keeps_its_own_headers(desktop_client):
    response = desktop_client.get("/api/health")
    assert response.status_code == 200 and response.json()["status"] == "ok"
    assert response.headers.get_list("content-security-policy") == [API_CSP]
    assert response.headers["referrer-policy"] == "no-referrer"


def test_cache_control(desktop_client):
    assert desktop_client.get("/_next/static/chunks/main-abc123.js").headers["cache-control"] == (
        "public, max-age=31536000, immutable"
    )
    assert desktop_client.get("/log.txt").headers["cache-control"] == "no-cache"
    assert desktop_client.get("/log").headers["cache-control"] == "no-cache"  # no cookie asked for
    assert desktop_client.get("/log", headers=HTML).headers["cache-control"] == "private, no-store"


# --- the API under /api ---------------------------------------------------------------------


def test_api_paths_reach_the_backend_without_the_prefix(desktop_client):
    assert desktop_client.get("/api/session").status_code == 204
    missing = desktop_client.get("/api/no-such-route")
    assert missing.status_code == 404 and missing.json() == {"detail": "Not Found"}
    # /api itself is the backend's root, which has no route (as behind the Next.js rewrite).
    assert desktop_client.get("/api").json() == {"detail": "Not Found"}


def test_the_api_knows_it_is_under_api(desktop_client):
    # As FASTAPI_ROOT_PATH=/api in docker-compose.yml: the documentation points at /api.
    assert desktop_client.get("/api/openapi.json").json()["servers"] == [{"url": "/api"}]


# --- session cookie -------------------------------------------------------------------------


def test_a_page_load_brings_the_session_cookie(desktop_client):
    response = desktop_client.get("/", headers=HTML)
    session_id = cookie_session_id(response.headers["set-cookie"])
    assert uuid.UUID(session_id)
    assert response.headers["cache-control"] == "private, no-store"
    # The browser keeps it; the next page load needs no new one, so the session stays.
    assert cookie_session_id("session_id=" + desktop_client.cookies["session_id"]) == session_id
    again = desktop_client.get("/log", headers=HTML)
    assert "set-cookie" not in again.headers and again.headers["cache-control"] == "no-cache"
    assert desktop_client.get("/api/session").status_code == 204
    assert cookie_session_id("session_id=" + desktop_client.cookies["session_id"]) == session_id


def test_a_missing_page_brings_it_too(desktop_client):
    # middleware.ts runs for every path its matcher covers, before Next.js finds no page.
    response = desktop_client.get("/no-such-page", headers=HTML)
    assert response.status_code == 404
    assert cookie_session_id(response.headers["set-cookie"])


@pytest.mark.parametrize(
    "method, path, headers",
    [
        ("GET", "/log.txt", HTML),  # a file
        ("GET", "/_next/static/chunks/main-abc123.js", HTML),
        ("GET", "/log", {**HTML, "rsc": "1"}),  # client-side navigation
        ("GET", "/log", {**HTML, "next-router-prefetch": "1"}),
        ("GET", "/log", {"accept": "application/json"}),
        ("HEAD", "/log", HTML),
    ],
)
def test_no_cookie_where_middleware_ts_sets_none(desktop_client, method, path, headers):
    response = desktop_client.request(method, path, headers=headers)
    assert response.status_code == 200
    assert "set-cookie" not in response.headers


def test_a_broken_cookie_is_replaced_on_the_next_page_load(desktop_client):
    desktop_client.cookies.set("session_id", "e30=.AAAAAA.not-a-signature")
    response = desktop_client.get("/", headers=HTML)
    assert uuid.UUID(cookie_session_id(response.headers["set-cookie"]))


def test_with_a_shared_session_every_browser_is_in_it(monkeypatch, desktop_app):
    import config
    from fastapi.testclient import TestClient

    shared = str(uuid.uuid4())
    monkeypatch.setattr(config, "SHARED_SESSION_ID", shared)
    with TestClient(desktop_app, base_url=ORIGIN, headers=BEARER) as a, TestClient(desktop_app, base_url=ORIGIN, headers=BEARER) as b:
        for client in (a, b):
            assert cookie_session_id(client.get("/", headers=HTML).headers["set-cookie"]) == shared
        created = a.post("/api/factor-analysis/datasets", data={"kind": "model", "source": "bundled", "bundled_id": "comfy-paper-inductive-miner"})
        assert created.status_code in (200, 202), created.text
        listed = b.get("/api/factor-analysis/datasets").json()["datasets"]
        assert [d["id"] for d in listed] == [created.json()["dataset_id"]]


# --- MIME types -----------------------------------------------------------------------------


def test_mime_types_are_registered():
    from desktop_app.pages import MIME_TYPES, register_mime_types

    register_mime_types()
    for extension in (".js", ".mjs", ".css", ".svg", ".txt", ".json", ".woff2", ".ico", ".png"):
        assert mimetypes.guess_type("file" + extension)[0] == MIME_TYPES[extension], extension

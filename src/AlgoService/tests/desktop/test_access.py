"""Every request needs the access token of the launch: the cookie the page server sets in
exchange for ``?token=``, or ``Authorization: Bearer`` for scripts."""

from __future__ import annotations

import pytest

from ._support import BEARER, HTML, PORT, TOKEN, asgi_get

COOKIE = f"desktop_access_{PORT}"


def test_the_api_without_the_token_is_401(anonymous_client):
    for path in ("/api/session", "/api/factor-analysis/datasets", "/api/jobs/events"):
        response = anonymous_client.get(path)
        assert response.status_code == 401, path
        assert TOKEN not in response.text
    # Also what changes data, and the progress stream with its headers.
    assert anonymous_client.delete("/api/factor-analysis/datasets").status_code == 401
    assert anonymous_client.get("/api/jobs/events", headers={"accept": "text/event-stream"}).status_code == 401


def test_health_stays_open_and_says_no_more_than_ok(anonymous_client):
    response = anonymous_client.get("/api/health")
    assert response.status_code == 200
    assert set(response.json()) <= {"status", "database"}


@pytest.mark.parametrize("path", ["/", "/log", "/log.txt", "/_next/static/chunks/main-abc123.js", "/nope", "/icon.svg"])
def test_pages_without_the_token_are_a_landing_page(anonymous_client, path):
    response = anonymous_client.get(path, headers=HTML)
    assert response.status_code == 401
    assert response.headers["content-type"].startswith("text/html")
    assert "icon" in response.text and "index page" not in response.text
    assert TOKEN not in response.text
    assert COOKIE not in response.headers.get("set-cookie", "")
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize(
    "headers",
    [
        {"Authorization": "Bearer wrong"},
        {"Authorization": f"Basic {TOKEN}"},
        {"Authorization": TOKEN},
        {"Cookie": f"{COOKIE}=wrong"},
        {"Cookie": f"desktop_access_1={TOKEN}"},  # the cookie of another port
        {"Cookie": f"{COOKIE}="},
        {"X-Desktop-Instance": TOKEN},  # that key opens the instance check only
    ],
)
def test_a_wrong_token_is_401(anonymous_client, headers):
    assert anonymous_client.get("/api/factor-analysis/datasets", headers=headers).status_code == 401
    assert anonymous_client.get("/log", headers={**HTML, **headers}).status_code == 401


@pytest.mark.parametrize("query", ["token=wrong", "token=", "token", f"tokenx={TOKEN}", f"Token={TOKEN}"])
def test_a_wrong_query_token_is_401_and_sets_no_cookie(anonymous_client, query):
    response = anonymous_client.get(f"/?{query}", headers=HTML, follow_redirects=False)
    assert response.status_code == 401
    assert "set-cookie" not in response.headers


def test_the_query_token_is_traded_for_a_cookie_and_dropped(anonymous_client):
    response = anonymous_client.get(f"/?token={TOKEN}", follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == "/"
    cookie = response.headers["set-cookie"]
    assert cookie.startswith(f"{COOKIE}={TOKEN}")
    assert {"httponly", "samesite=strict", "path=/"} <= {part.strip().lower() for part in cookie.split(";")}
    assert response.headers["cache-control"] == "no-store"
    assert TOKEN not in response.text

    # The cookie is in the client's jar now: pages, files and the API work.
    assert "index page" in anonymous_client.get("/", headers=HTML).text
    assert anonymous_client.get("/_next/static/chunks/main-abc123.js").status_code == 200
    assert anonymous_client.get("/api/session").status_code == 204


def test_the_redirect_keeps_the_path_and_the_other_parameters(anonymous_client):
    response = anonymous_client.get(f"/log?a=1&token={TOKEN}&b=x%20y", follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == "/log?a=1&b=x+y"
    followed = anonymous_client.get(f"/log?token={TOKEN}", headers=HTML)
    assert followed.status_code == 200 and "log page" in followed.text and str(followed.url).endswith("/log")


@pytest.mark.parametrize("path", ["//evil.example/", "/\evil.example/", "///evil.example", "/%2F/"])
def test_the_token_redirect_cannot_leave_the_origin(desktop_app, path):
    status, headers = asgi_get(desktop_app, path.replace("%2F", "/"), f"token={TOKEN}")
    assert status == 303
    location = headers["location"]
    assert location.startswith("/") and not location.startswith(("//", "/\\"))


def test_the_token_does_not_open_the_api_through_the_query(anonymous_client):
    assert anonymous_client.get(f"/api/factor-analysis/datasets?token={TOKEN}").status_code == 401


def test_the_bearer_token_works_for_the_api_and_pages(anonymous_client):
    assert anonymous_client.get("/api/session", headers=BEARER).status_code == 204
    assert anonymous_client.get("/log", headers=BEARER).status_code == 200
    assert anonymous_client.get("/api/session", headers={"Authorization": f"bearer {TOKEN}"}).status_code == 204


def test_the_origin_and_host_checks_still_come_first(anonymous_client):
    response = anonymous_client.post("/api/jobs", headers={**BEARER, "Origin": "https://evil.example"})
    assert response.status_code == 403
    response = anonymous_client.get("/api/session", headers={**BEARER, "Host": "evil.example"})
    assert response.status_code == 400


def test_the_instance_check_keeps_its_own_key(anonymous_client):
    assert anonymous_client.get("/_desktop/instance").status_code == 404
    assert anonymous_client.get("/_desktop/instance", headers=BEARER).status_code == 404
    assert anonymous_client.get("/_desktop/instance", headers={"X-Desktop-Instance": TOKEN}).status_code == 200


def test_the_token_never_reaches_the_log():
    from desktop_app.logs import redact

    line = f'INFO:     127.0.0.1:5 - "GET /?token={TOKEN}&a=1 HTTP/1.1" 303'
    assert TOKEN not in redact(line) and "token=***&a=1" in redact(line)
    assert redact("GET /x?a=1&token=abc_-DEF HTTP/1.1") == "GET /x?a=1&token=*** HTTP/1.1"

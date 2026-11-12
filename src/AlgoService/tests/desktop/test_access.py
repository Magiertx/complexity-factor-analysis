"""Every request needs the access token of the launch: the cookie the page server sets in
exchange for ``?token=``, or ``Authorization: Bearer`` for scripts."""

from __future__ import annotations

import pytest

from ._support import BEARER, HTML, PORT, TOKEN, asgi_get

COOKIE = f"desktop_access_{PORT}"


def _second_client(client):
    """Another browser: the same app, no cookies."""
    from fastapi.testclient import TestClient

    return TestClient(client.app, base_url=str(client.base_url))


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


@pytest.mark.parametrize(
    "query", ["token=wrong", "token=", "token", f"tokenx={TOKEN}", f"Token={TOKEN}", f"token={TOKEN}"]
)
def test_a_wrong_query_token_is_401_and_sets_no_cookie(  # also the master token: only a code goes in a URL
anonymous_client, query):
    response = anonymous_client.get(f"/?{query}", headers=HTML, follow_redirects=False)
    assert response.status_code == 401
    assert "set-cookie" not in response.headers


def test_a_one_time_code_is_traded_for_a_session_cookie_and_dropped(anonymous_client, access):
    response = anonymous_client.get(f"/?token={access.new_code()}", follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == "/"
    cookie = response.headers["set-cookie"]
    # A session value of its own, not the master token, and no lifetime beyond the browser session.
    assert cookie.startswith(f"{COOKIE}=") and TOKEN not in cookie
    assert "max-age" not in cookie.lower() and "expires" not in cookie.lower()
    # Lax, not Strict: a strict cookie stays off the redirect that starts at the login file (file://).
    assert {"httponly", "samesite=lax", "path=/"} <= {part.strip().lower() for part in cookie.split(";")}
    assert response.headers["cache-control"] == "no-store"
    assert TOKEN not in response.text and access.is_session(cookie.split(";")[0].split("=", 1)[1])

    # The cookie is in the client's jar now: pages, files and the API work.
    assert "index page" in anonymous_client.get("/", headers=HTML).text
    assert anonymous_client.get("/_next/static/chunks/main-abc123.js").status_code == 200
    assert anonymous_client.get("/api/session").status_code == 204


def test_the_redirect_keeps_the_path_and_the_other_parameters(anonymous_client, access):
    response = anonymous_client.get(f"/log?a=1&token={access.new_code()}&b=x%20y", follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == "/log?a=1&b=x+y"
    followed = anonymous_client.get(f"/log?token={access.new_code()}", headers=HTML)
    assert followed.status_code == 200 and "log page" in followed.text and str(followed.url).endswith("/log")


@pytest.mark.parametrize("path", ["//evil.example/", "/\\evil.example/", "///evil.example", "/%2F/"])
def test_the_token_redirect_cannot_leave_the_origin(desktop_app, access, path):
    status, headers = asgi_get(desktop_app, path.replace("%2F", "/"), f"token={access.new_code()}")
    assert status == 303
    location = headers["location"]
    assert location.startswith("/") and not location.startswith(("//", "/\\"))


def test_the_code_does_not_open_the_api_through_the_query(anonymous_client, access):
    assert anonymous_client.get(f"/api/factor-analysis/datasets?token={access.new_code()}").status_code == 401


def test_a_code_works_once(anonymous_client, access):
    code = access.new_code()
    assert anonymous_client.get(f"/?token={code}", follow_redirects=False).status_code == 303
    with _second_client(anonymous_client) as other:
        assert other.get(f"/?token={code}", headers=HTML, follow_redirects=False).status_code == 401


def test_a_code_expires(anonymous_client, access, monkeypatch):
    import desktop_app.app as app_module

    code = access.new_code()
    now = app_module.time.monotonic()
    monkeypatch.setattr(app_module.time, "monotonic", lambda: now + app_module.CODE_TTL_S + 1)
    assert anonymous_client.get(f"/?token={code}", headers=HTML, follow_redirects=False).status_code == 401


def test_every_login_gets_a_session_value_of_its_own(desktop_app, access):
    from fastapi.testclient import TestClient

    from ._support import ORIGIN

    values = []
    for _ in range(2):
        with TestClient(desktop_app, base_url=ORIGIN) as client:
            response = client.get(f"/?token={access.new_code()}", follow_redirects=False)
            values.append(response.headers["set-cookie"].split(";")[0].split("=", 1)[1])
            assert client.get("/api/session").status_code == 204
    assert values[0] != values[1] and TOKEN not in values


def test_the_master_token_is_no_cookie(anonymous_client):
    assert anonymous_client.get("/api/session", headers={"Cookie": f"{COOKIE}={TOKEN}"}).status_code == 401


def test_the_login_code_needs_the_master_token(anonymous_client):
    assert anonymous_client.get("/_desktop/login").status_code == 404
    assert anonymous_client.get("/_desktop/login", headers={"X-Desktop-Instance": "wrong"}).status_code == 404
    assert anonymous_client.get("/_desktop/login", headers=BEARER).status_code == 404
    response = anonymous_client.get("/_desktop/login", headers={"X-Desktop-Instance": TOKEN})
    assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
    code = response.json()["code"]
    assert code != TOKEN
    assert anonymous_client.get(f"/?token={code}", follow_redirects=False).status_code == 303


def test_the_login_comes_as_a_private_file_that_goes_when_the_code_is_used(anonymous_client, access):
    import os
    import stat
    from pathlib import Path

    response = anonymous_client.get("/_desktop/login", headers={"X-Desktop-Instance": TOKEN})
    code, path = response.json()["code"], Path(response.json()["file"])
    assert path.parent == access.login_dir and path.name.startswith("open-") and path.suffix == ".html"
    page = path.read_text(encoding="utf-8")
    assert f"http://127.0.0.1:{PORT}/?token={code}" in page and TOKEN not in page
    if os.name != "nt":
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert anonymous_client.get(f"/?token={code}", follow_redirects=False).status_code == 303
    assert not path.exists()


def test_login_files_go_when_the_code_expires_and_when_the_app_quits(access, monkeypatch):
    import desktop_app.app as app_module

    _, old = access.new_login_file(lambda code: f"http://127.0.0.1:{PORT}/?token={code}")
    now = app_module.time.monotonic()
    monkeypatch.setattr(app_module.time, "monotonic", lambda: now + app_module.CODE_TTL_S + 1)
    _, new = access.new_login_file(lambda code: f"http://127.0.0.1:{PORT}/?token={code}")
    assert not old.exists() and new.exists()
    access.close()
    assert not new.exists() and not list(access.login_dir.iterdir())


def test_a_code_lives_a_minute():
    import desktop_app.app as app_module

    assert app_module.CODE_TTL_S == 60


def test_head_does_not_use_up_the_code(anonymous_client, access):
    code = access.new_code()
    assert anonymous_client.head(f"/?token={code}", headers=HTML, follow_redirects=False).status_code == 401
    assert anonymous_client.get(f"/?token={code}", follow_redirects=False).status_code == 303


def test_any_cookie_of_that_name_with_a_valid_value_opens_the_app(anonymous_client, access):
    """Another server on 127.0.0.1 can set a cookie of the same name for its own path (cookies
    are not bound to a port); the browser sends both, and the junk one must not lock the user out."""
    code = access.new_code()
    value = anonymous_client.get(f"/?token={code}", follow_redirects=False).headers["set-cookie"].split(";")[0]
    valid = value.split("=", 1)[1]
    anonymous_client.cookies.clear()
    for cookie in (f"{COOKIE}=junk; {COOKIE}={valid}", f"{COOKIE}={valid}; {COOKIE}=junk"):
        assert anonymous_client.get("/api/session", headers={"Cookie": cookie}).status_code == 204, cookie
    assert anonymous_client.get("/api/session", headers={"Cookie": f"{COOKIE}=junk; {COOKIE}=junk2"}).status_code == 401


def test_the_headers_file_is_not_served_in_any_case(desktop_client):
    for name in ("_headers.json", "_HEADERS.JSON", "_Headers.json"):
        assert desktop_client.get("/" + name, headers=HTML).status_code == 404, name


def test_the_bearer_token_works_for_the_api_and_pages(anonymous_client):
    assert anonymous_client.get("/api/session", headers=BEARER).status_code == 204
    assert anonymous_client.get("/log", headers=BEARER).status_code == 200
    assert anonymous_client.get("/api/session", headers={"Authorization": f"bearer {TOKEN}"}).status_code == 204


def test_the_origin_and_host_checks_still_come_first(anonymous_client):
    response = anonymous_client.post("/api/jobs", headers={**BEARER, "Origin": "https://evil.example"})
    assert response.status_code == 403
    response = anonymous_client.get("/api/session", headers={**BEARER, "Host": "evil.example"})
    assert response.status_code == 400


def test_the_instance_check_is_no_way_in(anonymous_client):
    assert anonymous_client.get("/_desktop/instance").status_code == 404
    assert anonymous_client.get("/_desktop/instance", headers=BEARER).status_code == 404
    # The master token does not open it: it answers a nonce, with a proof (tests/security).
    assert anonymous_client.get("/_desktop/instance", headers={"X-Desktop-Instance": TOKEN}).status_code == 404


def test_the_token_never_reaches_the_log():
    from desktop_app.logs import redact

    line = f'INFO:     127.0.0.1:5 - "GET /?token={TOKEN}&a=1 HTTP/1.1" 303'
    assert TOKEN not in redact(line) and "token=***&a=1" in redact(line)
    assert redact("GET /x?a=1&token=abc_-DEF HTTP/1.1") == "GET /x?a=1&token=*** HTTP/1.1"


def test_the_session_id_and_key_never_reach_the_log(monkeypatch):
    from desktop_app import logs

    monkeypatch.setattr(logs, "_HIDDEN", set())
    session = "6bf602ed-d491-46e3-a18e-902a1c5b0ea3"
    logs.hide(session, "k" * 64, "", "x")  # the empty and the short value are no secret worth hiding
    line = f"Could not read artifacts/{session}/dataset-1/meta.json; key {'k' * 64}; x"
    assert logs.redact(line) == "Could not read artifacts/***/dataset-1/meta.json; key ***; x"

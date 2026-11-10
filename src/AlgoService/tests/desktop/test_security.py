"""A server on 127.0.0.1 is reachable from every web page the user opens: Host and Origin
checks, no CORS."""

from __future__ import annotations

import pytest

from ._support import API_CSP, INSTANCE, ORIGIN, PORT, TOKEN

DATASETS = "/api/factor-analysis/datasets"


@pytest.mark.parametrize(
    "host", ["evil.example", f"evil.example:{PORT}", "127.0.0.1:9999", "127.0.0.1", "localhost", f"[::1]:{PORT}", ""]
)
def test_other_host_names_are_refused(desktop_client, host):
    # DNS rebinding: a foreign name resolving to 127.0.0.1 arrives with its own name.
    for path in ("/", "/api/health"):
        response = desktop_client.get(path, headers={"host": host})
        assert response.status_code == 400, (host, path)
        assert response.headers["content-security-policy"] == API_CSP


@pytest.mark.parametrize("host", [f"127.0.0.1:{PORT}", f"localhost:{PORT}", f"LOCALHOST:{PORT}"])
def test_own_host_names_pass(desktop_client, host):
    assert desktop_client.get("/api/health", headers={"host": host}).status_code == 200


@pytest.mark.parametrize(
    "headers",
    [
        {"origin": "http://evil.example"},
        {"origin": "null"},
        {"origin": "http://localhost:3000"},
        {"origin": "http://127.0.0.1:9999"},
        {"origin": f"https://127.0.0.1:{PORT}"},
        {"referer": "http://evil.example/page"},
        {"referer": f"http://127.0.0.1:{PORT}.evil.example/"},
        # Origin decides, whatever the Referer says.
        {"origin": "http://evil.example", "referer": f"{ORIGIN}/log"},
    ],
)
@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_writes_from_other_origins_are_refused(desktop_client, headers, method):
    response = desktop_client.request(method, DATASETS, headers=headers)
    assert response.status_code == 403
    assert response.json() == {"detail": "Cross-origin request refused."}
    assert response.headers["content-security-policy"] == API_CSP


def test_writes_to_pages_from_other_origins_are_refused_too(desktop_client):
    assert desktop_client.post("/log", headers={"origin": "http://evil.example"}).status_code == 403


@pytest.mark.parametrize(
    "headers",
    [
        {"origin": ORIGIN},
        {"origin": f"http://localhost:{PORT}"},
        {"referer": f"{ORIGIN}/log?x=1"},
        {},  # a program, not a browser (the smoke test)
    ],
)
def test_writes_from_the_app_itself_pass(desktop_client, headers):
    response = desktop_client.delete(DATASETS, headers=headers)
    assert response.status_code == 200, response.text


def test_reads_from_other_origins_get_no_cors_headers(desktop_client):
    from fastapi.testclient import TestClient
    from srv_main import app as api

    # The backend allows http://localhost:3000 (CORS_ORIGINS of the Docker build) ...
    with TestClient(api) as backend:
        assert backend.get("/health", headers={"origin": "http://localhost:3000"}).headers.get(
            "access-control-allow-origin"
        )
    # ... the desktop app lets no origin read its answers.
    for origin in ("http://localhost:3000", "http://evil.example", ORIGIN):
        response = desktop_client.get("/api/health", headers={"origin": origin})
        assert response.status_code == 200
        assert not [k for k in response.headers if k.lower().startswith("access-control-")]


def test_preflights_of_other_origins_are_refused(desktop_client):
    response = desktop_client.options(
        DATASETS, headers={"origin": "http://localhost:3000", "access-control-request-method": "POST"}
    )
    assert response.status_code == 403
    assert "access-control-allow-origin" not in response.headers


def test_the_instance_check_answers_a_nonce_with_a_proof_not_the_token(desktop_client):
    from desktop_app.app import proof

    nonce = "n" * 24
    assert desktop_client.get("/_desktop/instance").status_code == 404
    assert desktop_client.get("/_desktop/instance", headers={"x-desktop-nonce": "short"}).status_code == 404
    assert desktop_client.get("/_desktop/instance", headers={"x-desktop-nonce": "n" * 200}).status_code == 404
    assert desktop_client.head("/_desktop/instance", headers={"x-desktop-nonce": nonce}).status_code == 404
    response = desktop_client.get("/_desktop/instance", headers={"x-desktop-nonce": nonce})
    assert response.status_code == 200
    assert response.json() == {**INSTANCE, "proof": proof(TOKEN, nonce)}
    assert TOKEN not in response.text and proof(TOKEN, nonce) != proof(TOKEN, nonce + "x")


@pytest.mark.parametrize("method", ["PROPFIND", "MKCOL", "patch", "post", "Delete", "LINK", "TRACE"])
def test_every_method_but_the_safe_ones_is_checked_for_its_origin(desktop_client, method):
    """An allowlist: a method the check does not know is refused from another origin, too."""
    response = desktop_client.request(method, DATASETS, headers={"origin": "http://evil.example"})
    assert response.status_code == 403
    assert response.json() == {"detail": "Cross-origin request refused."}


@pytest.mark.parametrize("method", ["GET", "HEAD", "OPTIONS", "get"])
def test_the_safe_methods_are_not_checked_for_their_origin(desktop_client, method):
    response = desktop_client.request(method, "/api/health", headers={"origin": "http://evil.example"})
    assert response.status_code != 403

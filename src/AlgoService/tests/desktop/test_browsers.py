"""The browsers the status window offers besides the default one (desktop_app/browsers.py)."""

from __future__ import annotations

import subprocess

from ._support import DESKTOP  # noqa: F401  (puts the launcher on the path)

from desktop_app import browsers
from desktop_app.browsers import Browser


def test_a_mac_offers_the_applications_it_has(tmp_path):
    system, user = tmp_path / "Applications", tmp_path / "home" / "Applications"
    for root, app in ((system, "Safari"), (system, "Google Chrome"), (user, "Firefox")):
        (root / f"{app}.app").mkdir(parents=True)
    (system / "Notes.app").mkdir()
    found = browsers.installed("darwin", mac_roots=[system, user])
    assert found == [
        Browser("Safari", ("open", "-a", str(system / "Safari.app"))),
        Browser("Google Chrome", ("open", "-a", str(system / "Google Chrome.app"))),
        Browser("Firefox", ("open", "-a", str(user / "Firefox.app"))),
    ]


def test_windows_offers_the_programs_where_they_install_themselves(tmp_path):
    chrome = tmp_path / "pf" / "Google" / "Chrome" / "Application" / "chrome.exe"
    edge = tmp_path / "pf86" / "Microsoft" / "Edge" / "Application" / "msedge.exe"
    for program in (chrome, edge):
        program.parent.mkdir(parents=True)
        program.write_bytes(b"")
    environ = {"ProgramFiles": str(tmp_path / "pf"), "ProgramFiles(x86)": str(tmp_path / "pf86")}
    assert browsers.installed("win32", environ=environ) == [
        Browser("Google Chrome", (str(chrome),)),
        Browser("Microsoft Edge", (str(edge),)),
    ]
    assert browsers.installed("win32", environ={}) == []


def test_linux_offers_the_programs_on_the_path():
    on_path = {"chromium-browser": "/usr/bin/chromium-browser", "firefox": "/usr/bin/firefox"}
    assert browsers.installed("linux", which=on_path.get) == [
        Browser("Chromium", ("/usr/bin/chromium-browser",)),
        Browser("Firefox", ("/usr/bin/firefox",)),
    ]


def test_a_browser_opens_the_address_and_the_default_one_stands_in(monkeypatch):
    started: list[list[str]] = []
    monkeypatch.setattr(subprocess, "Popen", lambda args, **_: started.append(args))
    fallback: list[str] = []
    chrome = Browser("Google Chrome", ("open", "-a", "/Applications/Google Chrome.app"))

    browsers.open_in(chrome, "file:///login.html", fallback.append)
    assert started == [["open", "-a", "/Applications/Google Chrome.app", "file:///login.html"]] and fallback == []

    browsers.open_in(browsers.by_name([chrome], None), "file:///login.html", fallback.append)
    browsers.open_in(browsers.by_name([chrome], "Firefox"), "file:///login.html", fallback.append)  # gone since
    assert fallback == ["file:///login.html", "file:///login.html"]

    def broken(args, **_):
        raise FileNotFoundError(args[0])

    monkeypatch.setattr(subprocess, "Popen", broken)
    browsers.open_in(chrome, "file:///login.html", fallback.append)
    assert fallback[-1] == "file:///login.html" and len(fallback) == 3

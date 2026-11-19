"""The browsers installed besides the default one, to open the app in one of them.

The status window offers them under "Open in browser"; the one chosen is remembered
(``launcher.json``) and opens the app at the next start too. A browser is found where it
installs itself; one installed elsewhere is not offered, and the default browser still is.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger("desktop")


@dataclass(frozen=True)
class Browser:
    """A browser by the name it is shown and remembered by, and the command that opens an
    address in it (the address is appended)."""

    name: str
    command: tuple[str, ...]


#: macOS: the application bundles, in /Applications or ~/Applications.
MAC_APPS = ("Safari", "Google Chrome", "Firefox", "Microsoft Edge", "Brave Browser", "Arc", "Chromium", "Vivaldi")

#: Windows: the programs, below Program Files (both) or the user's local application data.
WINDOWS_PROGRAMS = (
    ("Google Chrome", r"Google\Chrome\Application\chrome.exe"),
    ("Firefox", r"Mozilla Firefox\firefox.exe"),
    ("Microsoft Edge", r"Microsoft\Edge\Application\msedge.exe"),
    ("Brave", r"BraveSoftware\Brave-Browser\Application\brave.exe"),
    ("Vivaldi", r"Vivaldi\Application\vivaldi.exe"),
)

#: Linux: the programs on the PATH, by their usual names.
LINUX_PROGRAMS = (
    ("Google Chrome", ("google-chrome", "google-chrome-stable")),
    ("Chromium", ("chromium", "chromium-browser")),
    ("Firefox", ("firefox",)),
    ("Microsoft Edge", ("microsoft-edge", "microsoft-edge-stable")),
    ("Brave", ("brave-browser", "brave")),
)


def installed(
    platform: str = sys.platform,
    environ: Mapping[str, str] = os.environ,
    mac_roots: Iterable[Path] | None = None,
    which: Callable[[str], str | None] = shutil.which,
) -> list[Browser]:
    """The browsers found on this computer, in the order of the lists above."""
    if platform == "darwin":
        roots = list(mac_roots) if mac_roots is not None else [Path("/Applications"), Path.home() / "Applications"]
        found = []
        for app in MAC_APPS:
            bundle = next((root / f"{app}.app" for root in roots if (root / f"{app}.app").is_dir()), None)
            if bundle is not None:
                found.append(Browser(app, ("open", "-a", str(bundle))))
        return found
    if platform == "win32":
        roots = [Path(p) for p in (environ.get(k) for k in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA")) if p]
        found = []
        for name, relative in WINDOWS_PROGRAMS:
            program = next((root / relative for root in roots if (root / relative).is_file()), None)
            if program is not None:
                found.append(Browser(name, (str(program),)))
        return found
    found = []
    for name, programs in LINUX_PROGRAMS:
        program = next((path for path in map(which, programs) if path), None)
        if program is not None:
            found.append(Browser(name, (program,)))
    return found


def by_name(browsers: Iterable[Browser], name: str | None) -> Browser | None:
    """The browser of that name among ``browsers``, or ``None`` (the default browser)."""
    return next((b for b in browsers if b.name == name), None) if name else None


def open_in(browser: Browser | None, url: str, fallback: Callable[[str], None]) -> None:
    """Open ``url`` in ``browser``, or with ``fallback`` (the default browser) where there is
    none or it cannot be started."""
    if browser is None:
        fallback(url)
        return
    try:
        subprocess.Popen([*browser.command, url], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError as exc:
        logger.warning("%s could not be started (%s); opening the default browser.", browser.name, exc)
        fallback(url)

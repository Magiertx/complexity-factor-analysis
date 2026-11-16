#!/usr/bin/env python3
"""Checks of the ProM that the desktop edition with ProM starts (docs/DESKTOP.md), for the CI.

    python scripts/check_prom.py guard --log DATA/logs/app.log   # 403 without the token, loopback only
    python scripts/check_prom.py count --at-least 1              # ProM processes running now
    python scripts/check_prom.py count --at-most 0

``guard`` reads ProM's address from the app's log ("ProM: starting it from ... on http://..."),
waits until ProM answers there, and checks src/desktop/prom/LocalProM.java from outside: a
request without the token and one with a wrong token get 403, and the Java process listens on
127.0.0.1 (or ::1) only. ``count`` counts the processes whose command line names LocalProM.
Standard library and the system's own tools (ps, ss or lsof, netstat, PowerShell).
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

MAIN_CLASS = "io.github.magiertx.cfa.prom.LocalProM"


def prom_pids() -> list[int]:
    """The processes of the launcher's main class."""
    if sys.platform == "win32":
        script = (
            "Get-CimInstance Win32_Process -Filter \"Name='java.exe'\" | "
            f"Where-Object {{ $_.CommandLine -match '{re.escape(MAIN_CLASS)}' }} | "
            "ForEach-Object { $_.ProcessId }"
        )
        out = subprocess.run(["powershell", "-NoProfile", "-Command", script], capture_output=True)
        text = out.stdout.decode("ascii", errors="replace")
    else:
        out = subprocess.run(["ps", "-axo", "pid=,command="], capture_output=True)
        text = "\n".join(
            line.split(None, 1)[0]
            for line in out.stdout.decode("utf-8", errors="replace").splitlines()
            if MAIN_CLASS in line and line.strip()
        )
    return sorted(int(x) for x in re.findall(r"\d+", text))


def listening(pid: int) -> list[str]:
    """The local addresses ``pid`` listens on for TCP, as ``host:port``."""
    if sys.platform == "win32":
        out = subprocess.run(["netstat", "-ano", "-p", "TCP"], capture_output=True).stdout
        out += subprocess.run(["netstat", "-ano", "-p", "TCPv6"], capture_output=True).stdout
        found = []
        for line in out.decode("ascii", errors="replace").splitlines():
            parts = line.split()
            # Proto, local, remote, state (language of the system), pid; listening: remote port 0.
            if len(parts) == 5 and parts[0].upper().startswith("TCP") and parts[4] == str(pid):
                if parts[2].endswith(":0"):
                    found.append(parts[1])
        return found
    if sys.platform == "darwin":
        out = subprocess.run(["lsof", "-nP", "-a", "-p", str(pid), "-iTCP", "-sTCP:LISTEN"], capture_output=True)
        return re.findall(r"TCP (\S+) \(LISTEN\)", out.stdout.decode("utf-8", errors="replace"))
    out = subprocess.run(["ss", "-ltnpH"], capture_output=True).stdout.decode("utf-8", errors="replace")
    return [line.split()[3] for line in out.splitlines() if f"pid={pid}," in line and len(line.split()) > 3]


def is_loopback(address: str) -> bool:
    host = address.rsplit(":", 1)[0].strip("[]")
    return host == "::1" or host.startswith("127.")


def status(url: str, token: str | None) -> int | None:
    headers = {"X-ProM4Py-Token": token} if token is not None else {}
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=10) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except OSError:
        return None


def cmd_guard(args: argparse.Namespace) -> int:
    deadline = time.monotonic() + args.timeout
    url = None
    while url is None and time.monotonic() < deadline:
        text = Path(args.log).read_text(encoding="utf-8", errors="replace") if Path(args.log).is_file() else ""
        found = re.findall(r"ProM: starting it from .*? on (http://127\.0\.0\.1:\d+)", text)
        moved = re.findall(r"ProM: the next start listens on (http://127\.0\.0\.1:\d+)", text)
        url = (moved or found or [None])[-1]
        if url is None:
            time.sleep(1)
    if url is None:
        print(f"FAIL no ProM address in {args.log}")
        return 1
    probe = f"{url}/isRunning"
    code = None
    while time.monotonic() < deadline:
        code = status(probe, None)
        if code is not None:
            break
        time.sleep(2)
    ok = True
    for what, token in (("without the token", None), ("with a wrong token", "x" * 43)):
        code = status(probe, token)
        good = code == 403
        ok &= good
        print(f"{'ok  ' if good else 'FAIL'} {probe} {what}: {code} (expected 403)")
    pids = prom_pids()
    if not pids:
        print("FAIL no ProM process found")
        return 1
    for pid in pids:
        addresses = listening(pid)
        good = bool(addresses) and all(is_loopback(a) for a in addresses)
        ok &= good
        print(f"{'ok  ' if good else 'FAIL'} ProM process {pid} listens on {', '.join(addresses) or 'nothing'} (expected loopback only)")
    return 0 if ok else 1


def cmd_count(args: argparse.Namespace) -> int:
    pids = prom_pids()
    print(f"ProM processes: {len(pids)} {pids if pids else ''}".rstrip())
    if args.at_least is not None and len(pids) < args.at_least:
        print(f"FAIL expected at least {args.at_least}")
        return 1
    if args.at_most is not None and len(pids) > args.at_most:
        print(f"FAIL expected at most {args.at_most}")
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    guard = sub.add_parser("guard", help="403 without the token, and loopback only")
    guard.add_argument("--log", required=True, help="the app's log (DATA/logs/app.log)")
    guard.add_argument("--timeout", type=float, default=300, help="seconds to wait for ProM (default 300)")
    count = sub.add_parser("count", help="the ProM processes running now")
    count.add_argument("--at-least", type=int)
    count.add_argument("--at-most", type=int)
    args = parser.parse_args()
    return cmd_guard(args) if args.command == "guard" else cmd_count(args)


if __name__ == "__main__":
    sys.exit(main())

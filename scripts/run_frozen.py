#!/usr/bin/env python3
"""Start a packaged desktop app headless, run commands against it, quit it the way a user would.

    python scripts/run_frozen.py --exe PATH --data-dir DIR \\
        --run "python scripts/smoke.py --port-file {port_file} --no-prom" \\
        --run "python scripts/check_desktop.py --port-file {port_file}"

Starts ``PATH --headless --port 0 --port-file ... --token-file ... --data-dir DIR --separate-sessions`` (a process
group of its own on Windows), waits until ``/api/health`` answers, runs each ``--run`` command in
a shell (``{port_file}``, ``{token_file}`` and ``{port}`` are replaced; ``BASE_URL`` and
``CFA_TOKEN``, the access token the app wants, are set for Playwright), then
quits the app: SIGTERM, or Ctrl+Break on Windows, which only a program with a console can receive
(``--quit kill`` ends a windowed one). The app must exit with 0 within 30 s. On any failure the
app's log is printed. Exit code: 0 when every command and the quit succeeded.
"""

from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

QUIT_TIMEOUT_S = 30


def wait_for_health(proc: subprocess.Popen, port_file: Path, timeout: float) -> int:
    deadline = time.monotonic() + timeout
    port = None
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise SystemExit(f"The app ended with code {proc.returncode} before it answered.")
        if port is None and port_file.is_file():
            text = port_file.read_text(encoding="utf-8").strip()
            port = int(text) if text.isdigit() else None
        if port is not None:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=5) as r:
                    if r.status == 200:
                        return port
            except OSError:
                pass
        time.sleep(1)
    raise SystemExit(f"The app did not answer within {timeout:.0f} s.")


def print_log(data_dir: Path) -> None:
    for log in sorted(data_dir.rglob("app.log")):
        print(f"--- {log} (last 80 lines)")
        print("\n".join(log.read_text(encoding="utf-8", errors="replace").splitlines()[-80:]))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--exe", required=True, type=Path)
    parser.add_argument("--data-dir", required=True, type=Path)
    parser.add_argument("--run", action="append", default=[], help="a command to run against the app")
    parser.add_argument("--quit", choices=["signal", "kill"], default="signal")
    parser.add_argument("--start-timeout", type=float, default=180)
    args = parser.parse_args()

    args.data_dir.mkdir(parents=True, exist_ok=True)
    port_file = args.data_dir.parent / f"{args.data_dir.name}.port"
    token_file = args.data_dir.parent / f"{args.data_dir.name}.token"
    port_file.unlink(missing_ok=True)
    token_file.unlink(missing_ok=True)
    command = [
        str(args.exe), "--headless", "--port", "0", "--port-file", str(port_file), "--token-file", str(token_file),
        "--data-dir", str(args.data_dir), "--separate-sessions",
    ]
    flags = subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0
    started = time.monotonic()
    proc = subprocess.Popen(command, creationflags=flags)
    ok = True
    try:
        port = wait_for_health(proc, port_file, args.start_timeout)
        print(f"The app answers on port {port} after {time.monotonic() - started:.1f} s.", flush=True)
        token = token_file.read_text(encoding="utf-8").strip()
        env = {**os.environ, "BASE_URL": f"http://127.0.0.1:{port}", "CFA_TOKEN": token}
        for run in args.run:
            line = run.format(port_file=port_file, token_file=token_file, port=port)
            print(f"\n$ {line}", flush=True)
            if subprocess.run(line, shell=True, env=env).returncode != 0:
                ok = False
                break
    finally:
        if proc.poll() is None:
            if args.quit == "kill":
                proc.kill()
            elif sys.platform == "win32":
                proc.send_signal(signal.CTRL_BREAK_EVENT)
            else:
                proc.send_signal(signal.SIGTERM)
            try:
                proc.wait(QUIT_TIMEOUT_S)
            except subprocess.TimeoutExpired:
                proc.kill()
                print(f"The app did not quit within {QUIT_TIMEOUT_S} s.")
                ok = False
            else:
                if args.quit == "signal" and proc.returncode != 0:
                    print(f"The app quit with code {proc.returncode}, not 0.")
                    ok = False
                elif args.quit == "signal":
                    print("The app quit cleanly.")
    if not ok:
        print_log(args.data_dir)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

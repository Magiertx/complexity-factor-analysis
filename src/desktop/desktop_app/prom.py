"""ProM in the edition "with ProM": start it with the app, keep it running, end it with the app.

That edition has a folder ``prom`` next to the program (inside the app on macOS, see
``resources.prom_dir``) with a Java 8 runtime, the ProM4Py bundle and lp_solve, put together by
``scripts/build_desktop.py prom``. From a checkout, ``--prom-dir`` names such a folder.

The supervisor does what ``src/prom4py/launch.sh`` does in the Docker stack: Java runs as a
child process with the same options; it is started again when it exits, and restarted when
``/isRunning`` has gone unanswered for ``PROM4PY_CALL_TIMEOUT`` + 30 s (a stuck call) or a start
does not answer within 600 s. Two things differ, because ProM runs on the user's machine and not
in a container network:

- Java's main class is ``src/desktop/prom/LocalProM.java``: ProM's server listens on loopback
  only and refuses every request without the header ``X-ProM4Py-Token`` (a random token of each
  start, given to Java and to the backend in ``PROM4PY_TOKEN``, never on a command line).
- Java gets the app's end through its standard input: when the app's process ends, however
  (quit, crash, killed), the system closes the pipe and Java exits. No ProM is left running.

ProM's own files (its user folder, and on Linux the Java preferences with its plugin cache) go
to ``<data>/prom`` (``user.home`` of the JVM), which is also its working directory: nothing is
written into the program's folder. On Windows the JVM keeps preferences in the registry, so the
plugin cache is under ``HKEY_CURRENT_USER\\Software\\JavaSoft\\Prefs\\org\\processmining``.
"""

from __future__ import annotations

import logging
import os
import re
import secrets
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

from . import resources
from .state import LauncherError

logger = logging.getLogger("desktop")

#: The header that carries the token (``LocalProM.TOKEN_HEADER``; the backend's client sends it).
TOKEN_HEADER = "X-ProM4Py-Token"
MAIN_CLASS = "io.github.magiertx.cfa.prom.LocalProM"
#: ProM4Py's class path, relative to its folder: launch.sh's, with the class folder
#: ``Packages/Workshop/Trunk/out/production/prom`` moved to ``classes`` for shorter paths on
#: Windows (scripts/desktop_prom.py, ``CLASSES_TO``).
CLASSPATH = ("classes", "Packages/ProM-Contexts/Trunk/ivy/*")

DEFAULT_HEAP = "4G"
DEFAULT_CALL_TIMEOUT_S = 300
#: As in launch.sh.
PROBE_INTERVAL_S = 10
BOOT_TIMEOUT_S = 600
RESTART_PAUSE_S = 2
#: Seconds Java gets to exit after its input was closed, before it is killed.
STOP_WAIT_S = 5
#: The longest pause between starts of a Java that keeps exiting before it ever answered.
MAX_RESTART_PAUSE_S = 60
#: What a job waits for ProM to answer (``PROM4PY_START_WAIT``) unless settings.env says
#: otherwise: as long as the supervisor gives a start, so that no job gives up on a ProM that is
#: still starting (the first start builds ProM's plugin cache: about 100 s measured on Windows).
START_WAIT_S = BOOT_TIMEOUT_S

#: Never given to Java: the app's secrets, and options that another Java program may have set
#: for itself in the user's environment and that would change how ProM runs.
JAVA_ENV_DROP = (
    "ANTHROPIC_API_KEY", "SESSION_SECRET_KEY", "SHARED_SESSION_ID",
    "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS", "CLASSPATH",
)

#: Lines ProM prints at every start, one per jar; left out of the log.
_NOISE = ("[ProMClassLoader] found in classpath:", "[PluginDescriptorImpl] Found no icon")


@dataclass(frozen=True)
class Bundle:
    """The folder ``prom``: ``jre/``, ``ProM4Py/``, ``lpsolve/`` and ``launcher/prom-launcher.jar``."""

    root: Path

    @property
    def java(self) -> Path:
        return self.root / "jre" / "bin" / ("java.exe" if os.name == "nt" else "java")

    @property
    def home(self) -> Path:
        """ProM4Py's folder (``Packages/`` ...)."""
        return self.root / "ProM4Py"

    @property
    def native(self) -> Path:
        """lp_solve and its Java wrapper (``java.library.path``)."""
        return self.root / "lpsolve"

    @property
    def launcher(self) -> Path:
        return self.root / "launcher" / "prom-launcher.jar"

    def missing(self) -> list[Path]:
        """The parts that are not there."""
        parts = [self.java, self.launcher, self.native, *(self.home / Path(p.rstrip("*")) for p in CLASSPATH)]
        return [p for p in parts if not p.exists()]


def call_timeout(env: Mapping[str, str]) -> int:
    """``PROM4PY_CALL_TIMEOUT`` (whole seconds, at least 10), as launch.sh and the backend read it."""
    raw = (env.get("PROM4PY_CALL_TIMEOUT") or "").strip()
    if not raw:
        return DEFAULT_CALL_TIMEOUT_S
    if not raw.isdigit() or int(raw) < 10:
        raise LauncherError(f"PROM4PY_CALL_TIMEOUT={raw} is not a whole number of seconds of at least 10.")
    return int(raw)


def heap(env: Mapping[str, str]) -> str:
    """``PROM4PY_HEAP``, the most memory Java may take (``-Xmx``; launch.sh's ``JAVA_HEAP``)."""
    raw = (env.get("PROM4PY_HEAP") or "").strip() or DEFAULT_HEAP
    if not re.fullmatch(r"[1-9][0-9]*[kKmMgG]?", raw):
        raise LauncherError(f"PROM4PY_HEAP={raw} is not a size such as 4G or 2048M.")
    return raw


def free_port() -> int:
    """A port on 127.0.0.1 that is free now (ProM takes a port number, not a socket)."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def prepare(
    prom_dir: Path | None, environ: Mapping[str, str], settings: Mapping[str, str], state_dir: Path
) -> "Supervisor | None":
    """The supervisor of the bundled ProM, or ``None`` when the app runs without one.

    ``None`` when ``PROM4PY_URL`` is set (in the environment or settings.env: that ProM is used),
    and when there is no ProM folder (the edition without ProM). An incomplete folder is an error
    when it was named with ``--prom-dir``; the bundled one is then left out with a warning, and
    the app runs as without ProM.
    """
    if (environ.get("PROM4PY_URL") or settings.get("PROM4PY_URL") or "").strip():
        logger.info("ProM: PROM4PY_URL is set; the app uses that ProM and starts none of its own.")
        return None
    explicit = prom_dir is not None
    root = Path(prom_dir).resolve() if explicit else resources.prom_dir()
    if root is None or (not explicit and not root.exists()):
        return None
    bundle = Bundle(root)
    missing = bundle.missing()
    if missing:
        message = f"The ProM folder {root} is incomplete: {', '.join(str(p) for p in missing)} missing."
        if explicit:
            raise LauncherError(message)
        logger.warning("%s The app runs without ProM.", message)
        return None
    merged = {**settings, **environ}  # the environment wins, as in environment.backend_environ
    return Supervisor(
        bundle,
        port=free_port(),
        token=secrets.token_urlsafe(32),
        heap=heap(merged),
        call_timeout=call_timeout(merged),
        state_dir=state_dir,
    )


class Supervisor:
    """ProM4Py as a child process, watched as in launch.sh (see the module docstring)."""

    def __init__(
        self, bundle: Bundle, *, port: int, token: str, heap: str, call_timeout: int, state_dir: Path
    ) -> None:
        self.bundle = bundle
        self.port = port
        self.token = token
        self.heap = heap
        self.call_timeout = call_timeout
        self.state_dir = Path(state_dir)
        self.stuck_after = call_timeout + 30
        self._lock = threading.Lock()
        self._stopping = threading.Event()
        self._proc: subprocess.Popen | None = None
        self._started = 0.0
        self._up = False
        self._thread = threading.Thread(target=self._run, name="prom-supervisor", daemon=True)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def backend_settings(self) -> dict[str, str]:
        """What the backend needs to reach this ProM (``environment.backend_environ``)."""
        return {"PROM4PY_URL": self.url, "PROM4PY_TOKEN": self.token}

    @property
    def pid(self) -> int | None:
        proc = self._proc
        return proc.pid if proc is not None and proc.poll() is None else None

    def command(self) -> list[str]:
        home = self.bundle.home
        classpath = os.pathsep.join([str(self.bundle.launcher), *(str(home / p) for p in CLASSPATH)])
        return [
            str(self.bundle.java),
            f"-Xmx{self.heap}",
            "-XX:ActiveProcessorCount=1",
            "-Djava.awt.headless=true",
            "-da",
            "-classpath", classpath,
            f"-Djava.library.path={self.bundle.native}",
            "-Djava.system.class.loader=org.processmining.framework.util.ProMClassLoader",
            "-Djava.util.Arrays.useLegacyMergeSort=true",
            f"-Duser.home={self.state_dir}",
            MAIN_CLASS,
            "-p", str(self.port),
        ]

    def java_environ(self) -> dict[str, str]:
        env = {k: v for k, v in os.environ.items() if k.upper() not in JAVA_ENV_DROP}
        env["PROM4PY_TOKEN"] = self.token
        return env

    # --- lifecycle --------------------------------------------------------------------------

    def start(self) -> None:
        """Start ProM and the watchdog in the background; jobs wait for ProM to answer."""
        logger.info(
            "ProM: starting it from %s on %s; it is restarted after %d s without an answer "
            "(PROM4PY_CALL_TIMEOUT=%d), heap %s.",
            self.bundle.root, self.url, self.stuck_after, self.call_timeout, self.heap,
        )
        self._thread.start()

    def stop(self) -> None:
        """End ProM (its input is closed, then it is killed after ``STOP_WAIT_S``) and the watchdog."""
        if self._stopping.is_set():
            return
        self._stopping.set()
        with self._lock:
            self._stop_java()
        if self._thread.is_alive():
            self._thread.join(2)
        logger.info("ProM: stopped.")

    # --- the watchdog (launch.sh) -------------------------------------------------------------

    def _run(self) -> None:
        try:
            self._watch()
        except Exception:
            logger.exception("ProM: the watchdog stopped with an error; ProM is no longer restarted.")

    def _watch(self) -> None:
        pause = RESTART_PAUSE_S
        if not self._start_java():
            return
        last_ok = self._started
        while not self._stopping.is_set():
            proc = self._proc
            if proc is None or proc.poll() is not None:
                code = proc.returncode if proc is not None else None
                # A Java that keeps exiting before it ever answered is started again less often.
                pause = RESTART_PAUSE_S if self._up else min(pause * 2, MAX_RESTART_PAUSE_S)
                logger.warning("ProM: exited with code %s; starting it again in %d s.", code, pause)
                if self._stopping.wait(pause) or not self._start_java():
                    return
                last_ok = self._started
                continue

            now = time.monotonic()
            if not self._up:
                if self._probe(5):
                    self._up = True
                    last_ok = time.monotonic()
                    pause = RESTART_PAUSE_S
                    logger.info("ProM: answers after %.0f s.", last_ok - self._started)
                elif now - self._started >= BOOT_TIMEOUT_S:
                    logger.warning("ProM: did not start within %d s; restarting it.", BOOT_TIMEOUT_S)
                    if not self._restart():
                        return
                else:
                    self._stopping.wait(RESTART_PAUSE_S)
                continue

            # One probe that waits as long as the watchdog allows (launch.sh explains why).
            budget = max(5.0, self.stuck_after - (now - last_ok))
            if self._probe(budget):
                last_ok = time.monotonic()
                self._stopping.wait(PROBE_INTERVAL_S)
            elif time.monotonic() - last_ok >= self.stuck_after:
                logger.warning("ProM: has not answered for %d s, a call is stuck; restarting it.", self.stuck_after)
                if not self._restart():
                    return
                last_ok = self._started
            else:
                # Refused or dropped: Java exited (handled above) or its server is not listening.
                self._stopping.wait(RESTART_PAUSE_S)

    def _probe(self, timeout: float) -> bool:
        request = urllib.request.Request(f"{self.url}/isRunning", headers={TOKEN_HEADER: self.token})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.status == 200
        except (OSError, urllib.error.URLError, ValueError):
            return False

    def _restart(self) -> bool:
        with self._lock:
            self._stop_java()
        return self._start_java()

    def _start_java(self) -> bool:
        """Start Java; False when the app is stopping or Java cannot be started at all."""
        with self._lock:
            if self._stopping.is_set():
                return False
            self.state_dir.mkdir(parents=True, exist_ok=True)
            kwargs: dict = {}
            if os.name == "nt":
                # No console window, and no Ctrl+C or Ctrl+Break of the app's console: the app
                # ends Java itself.
                kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
            else:
                kwargs["start_new_session"] = True
            try:
                proc = subprocess.Popen(
                    self.command(),
                    cwd=self.state_dir,
                    env=self.java_environ(),
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    **kwargs,
                )
            except OSError as exc:
                logger.error("ProM: Java cannot be started (%s); the app runs without ProM.", exc)
                return False
            self._proc = proc
            self._started = time.monotonic()
            self._up = False
        threading.Thread(target=self._pump, args=(proc,), name="prom-output", daemon=True).start()
        return True

    def _stop_java(self) -> None:
        """Close Java's input (it exits by itself), kill it if it has not after ``STOP_WAIT_S``.
        The caller holds the lock."""
        proc = self._proc
        if proc is None or proc.poll() is not None:
            return
        try:
            proc.stdin.close()
        except OSError:
            pass
        try:
            proc.wait(STOP_WAIT_S)
        except subprocess.TimeoutExpired:
            logger.warning("ProM: did not exit within %d s; killing it.", STOP_WAIT_S)
            proc.kill()
            try:
                proc.wait(STOP_WAIT_S)
            except subprocess.TimeoutExpired:
                logger.error("ProM: process %d did not end after it was killed.", proc.pid)

    @staticmethod
    def _pump(proc: subprocess.Popen) -> None:
        """ProM's output into the app's log, without the lines it prints per jar at every start."""
        for raw in proc.stdout:
            line = raw.decode("utf-8", errors="replace").rstrip()
            if line and not line.startswith(_NOISE):
                logger.info("[prom] %s", line)

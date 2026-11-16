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
- Java runs with UTF-8 as its default charset (``ENCODING_OPTIONS``; the Docker image has a UTF-8
  locale) and gets only the variables of :data:`JAVA_ENV_KEEP` from the app's environment.
- A start that ends before ProM answered gets a new port next time (``PROM4PY_URL`` follows).
  After :data:`GIVE_UP_AFTER` such starts in a row, or when Java cannot be started at all, the
  supervisor gives up and sets ``PROM4PY_DOWN``: the app then reports no ProM and jobs that need
  it fail at once with the reason, instead of waiting for it.

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
import shutil
import socket
import subprocess
import sys
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

#: Where Homebrew puts ``dot`` on macOS (Apple silicon, Intel).
HOMEBREW_BINS = ("/opt/homebrew/bin", "/usr/local/bin")

#: After this many starts in a row that ended before ProM ever answered, the supervisor gives up.
GIVE_UP_AFTER = 5
#: Set in the app's environment, with the reason, when the supervisor gave up: the backend then
#: reports no ProM (``/api/capabilities``) and a job that needs it fails at once instead of
#: waiting for it (``algorithms/_prom4py.py``, ``prom4py_down``).
DOWN_VARIABLE = "PROM4PY_DOWN"

#: The only variables of the app's environment that Java gets (names compared in upper case, as
#: Windows has them): what a JVM needs to run and to find temporary and user folders. Nothing else,
#: so none of the app's settings and secrets (API keys, passwords of settings.env, the session
#: key) and none of the options another Java program may have set for itself (JAVA_TOOL_OPTIONS,
#: _JAVA_OPTIONS, CLASSPATH). Java also gets ``PROM4PY_TOKEN``.
JAVA_ENV_KEEP = frozenset({
    "PATH", "SYSTEMROOT", "WINDIR", "SYSTEMDRIVE", "COMSPEC", "PATHEXT", "OS",
    "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "NUMBER_OF_PROCESSORS",
    "TEMP", "TMP", "TMPDIR", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "APPDATA",
    "PROGRAMDATA", "USERNAME", "HOME", "USER", "LOGNAME", "LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "TZ",
})

#: ProM4Py reads requests and writes answers in the JVM's default charset (``getBytes()``,
#: ``new InputStreamReader(...)``), which is the system's: cp1252 on a German or English Windows,
#: ASCII on Linux with ``LANG=C``. Names of activities outside it would come back broken (Á, Ð, Ý,
#: much of Cyrillic and Greek on Windows; everything outside ASCII under ``LANG=C``). The Docker
#: image runs Java with a UTF-8 locale; these options make it UTF-8 everywhere, for the contents
#: (``file.encoding``) and for file names (``sun.jnu.encoding``).
ENCODING_OPTIONS = ("-Dfile.encoding=UTF-8", "-Dsun.jnu.encoding=UTF-8")

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

    @property
    def graphviz_bin(self) -> Path | None:
        """Graphviz's ``bin`` folder, where the edition carries it (Windows), else ``None``."""
        folder = self.root / "graphviz" / "bin"
        return folder if (folder / ("dot.exe" if os.name == "nt" else "dot")).is_file() else None

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


def jvm_path(path: Path) -> str:
    """``path`` as Java 8 on Windows can take it from its command line.

    The JDK 8 launcher reads its arguments in the system's ANSI code page (cp1252 on a German
    or English Windows): a folder with letters outside it (a Cyrillic or Greek user name in the
    Downloads or data folder) arrives as ``????``, and Java finds neither its classes nor its
    user folder (measured). Such a path goes as its 8.3 short name, which is ASCII, where the
    volume has short names (the system drive by default). Elsewhere, and for other systems, the
    path itself.
    """
    text = str(path)
    if os.name != "nt":
        return text
    import ctypes

    codec = f"cp{ctypes.windll.kernel32.GetACP()}"
    try:
        text.encode(codec)
        return text
    except (UnicodeEncodeError, LookupError):
        pass
    size = ctypes.windll.kernel32.GetShortPathNameW(text, None, 0)
    if size:
        buffer = ctypes.create_unicode_buffer(size)
        if ctypes.windll.kernel32.GetShortPathNameW(text, buffer, size):
            short = buffer.value
            try:
                short.encode(codec)
                return short
            except (UnicodeEncodeError, LookupError):
                pass
    logger.warning(
        "ProM: %s has letters outside the system's code page and no short name; Java 8 cannot use it.", text
    )
    return text


def java_cannot_run_from(folder: Path) -> str:
    """Why Java 8 cannot start from ``folder``, or "". On Windows the JVM opens its own runtime
    (``jre/lib/rt.jar``) by a path in the ANSI code page, also when it was started by the short
    name (measured: "error in opening JAR file"), so the program's folder must not have letters
    outside that code page."""
    if os.name != "nt":
        return ""
    import ctypes

    codec = f"cp{ctypes.windll.kernel32.GetACP()}"
    try:
        str(folder).encode(codec)
    except (UnicodeEncodeError, LookupError):
        return (
            f"the program's folder {folder} has letters outside the system's code page ({codec}), "
            "from which Java 8 cannot start; move the program to a folder such as C:\\XCom"
        )
    return ""


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
        token=secrets.token_urlsafe(32),
        heap=heap(merged),
        call_timeout=call_timeout(merged),
        state_dir=state_dir,
    )


class Supervisor:
    """ProM4Py as a child process, watched as in launch.sh (see the module docstring).

    The port is chosen by :meth:`choose_port`, which the launcher calls once it has bound the
    app's own port (a port taken for Java first could be handed out again to the app's ``--port 0``).
    """

    def __init__(
        self, bundle: Bundle, *, token: str, heap: str, call_timeout: int, state_dir: Path, port: int | None = None
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
        self._failed_starts = 0
        self._thread = threading.Thread(target=self._run, name="prom-supervisor", daemon=True)

    def choose_port(self) -> int:
        """Take a free port for Java; call it after the app has bound its own."""
        self.port = free_port()
        return self.port

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def backend_settings(self) -> dict[str, str]:
        """What the backend needs to reach this ProM (``environment.backend_environ``), and a
        ``PATH`` on which it finds Graphviz's ``dot`` for the images of the nets: the edition's
        own (Windows) first; on macOS Homebrew's, which an app started from the Finder does not
        have on its PATH."""
        if self.port is None:
            self.choose_port()
        settings = {"PROM4PY_URL": self.url, "PROM4PY_TOKEN": self.token}
        path = os.environ.get("PATH", "")
        if self.bundle.graphviz_bin is not None:
            settings["PATH"] = os.pathsep.join([str(self.bundle.graphviz_bin), path]) if path else str(self.bundle.graphviz_bin)
        elif sys.platform == "darwin" and shutil.which("dot", path=path) is None:
            for folder in HOMEBREW_BINS:
                if Path(folder, "dot").is_file():
                    settings["PATH"] = os.pathsep.join([path, folder]) if path else folder
                    break
        return settings

    @property
    def pid(self) -> int | None:
        proc = self._proc
        return proc.pid if proc is not None and proc.poll() is None else None

    def command(self) -> list[str]:
        """Java's command line. Paths go through :func:`jvm_path` (the state folder is made
        first, since only an existing folder has a short name)."""
        self.state_dir.mkdir(parents=True, exist_ok=True)
        home = jvm_path(self.bundle.home)
        classpath = os.pathsep.join([jvm_path(self.bundle.launcher), *(str(Path(home) / p) for p in CLASSPATH)])
        return [
            jvm_path(self.bundle.java),
            f"-Xmx{self.heap}",
            "-XX:ActiveProcessorCount=1",
            "-Djava.awt.headless=true",
            "-da",
            "-classpath", classpath,
            f"-Djava.library.path={jvm_path(self.bundle.native)}",
            "-Djava.system.class.loader=org.processmining.framework.util.ProMClassLoader",
            "-Djava.util.Arrays.useLegacyMergeSort=true",
            *ENCODING_OPTIONS,
            f"-Duser.home={jvm_path(self.state_dir)}",
            MAIN_CLASS,
            "-p", str(self.port),
        ]

    def java_environ(self) -> dict[str, str]:
        """Java's environment: :data:`JAVA_ENV_KEEP` of the app's, and the token.

        A frozen build on Linux runs with PyInstaller's ``LD_LIBRARY_PATH`` (its own libraries
        first), which would reach Java's native code as well; the user's own value, which
        PyInstaller keeps in ``LD_LIBRARY_PATH_ORIG``, goes to Java instead.
        """
        env = {k: v for k, v in os.environ.items() if k.upper() in JAVA_ENV_KEEP}
        if sys.platform.startswith("linux"):
            original = os.environ.get("LD_LIBRARY_PATH_ORIG") if resources.is_frozen() else os.environ.get("LD_LIBRARY_PATH")
            if original:
                env["LD_LIBRARY_PATH"] = original
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
        reason = java_cannot_run_from(self.bundle.root)
        if reason:
            self._give_up(reason)
            return
        if not self._start_java():
            return
        last_ok = self._started
        while not self._stopping.is_set():
            proc = self._proc
            if proc is None or proc.poll() is not None:
                code = proc.returncode if proc is not None else None
                if self._up:
                    self._failed_starts = 0
                    pause = RESTART_PAUSE_S
                else:
                    # It ended before it ever answered: it may not have got its port (another
                    # program took it meanwhile), so the next start takes a new one, and a Java
                    # that keeps failing is started less often and in the end given up.
                    self._failed_starts += 1
                    if self._failed_starts >= GIVE_UP_AFTER:
                        self._give_up(
                            f"ProM ended {self._failed_starts} times in a row before it answered "
                            f"(last exit code {code}); see the app's log"
                        )
                        return
                    pause = min(pause * 2, MAX_RESTART_PAUSE_S)
                    self._move_port()
                logger.warning("ProM: exited with code %s; starting it again in %d s.", code, pause)
                if self._stopping.wait(pause) or not self._start_java():
                    return
                last_ok = self._started
                continue

            now = time.monotonic()
            if not self._up:
                if self._probe(5):
                    self._up = True
                    self._failed_starts = 0
                    last_ok = time.monotonic()
                    pause = RESTART_PAUSE_S
                    logger.info("ProM: answers after %.0f s.", last_ok - self._started)
                elif now - self._started >= BOOT_TIMEOUT_S:
                    self._failed_starts += 1
                    if self._failed_starts >= GIVE_UP_AFTER:
                        with self._lock:
                            self._stop_java()
                        self._give_up(f"ProM did not answer within {BOOT_TIMEOUT_S} s, {self._failed_starts} times in a row")
                        return
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

    def _move_port(self) -> None:
        """Take a new port, and point the backend at it (it reads ``PROM4PY_URL`` per request and
        makes a new client when the address changed)."""
        old = self.url
        self.choose_port()
        if os.environ.get("PROM4PY_URL") == old:
            os.environ["PROM4PY_URL"] = self.url
        logger.info("ProM: the next start listens on %s.", self.url)

    def _give_up(self, reason: str) -> None:
        """No more starts: the app runs as without ProM from now on, and says why."""
        logger.error("ProM: %s. The app runs without ProM until it is started again.", reason)
        os.environ[DOWN_VARIABLE] = reason

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
                self._give_up(f"Java cannot be started ({exc})")
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

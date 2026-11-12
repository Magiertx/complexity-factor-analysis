"""Start the tool as one local process: ``python -m desktop_app [options]``.

1. Find the app's directories, open the log, take the instance lock (or hand over to the
   instance that has it and exit).
2. Read or create the session key and id, read settings.env, pick the port.
3. Set the backend's environment, migrate the database, import the backend.
4. Serve API and pages on 127.0.0.1, open the browser, show the status window until Quit.
5. Quit: stop the server, tell the running jobs to stop, and hold the instance lock until the
   process has really ended (see :func:`_hold_until_exit`).
"""

from __future__ import annotations

import argparse
import logging
import os
import secrets
import signal
import sys
import threading
import time
import webbrowser
from pathlib import Path

from . import app, environment, instance, logs, paths, resources, state, ui
from .pages import PageServer, register_mime_types
from .state import LauncherError

logger = logging.getLogger("desktop")

#: Longest the server's own startup (after the imports and migrations) may take.
STARTUP_TIMEOUT_S = 120
#: Longest a second start waits for the running instance, which may itself be starting.
HANDOVER_TIMEOUT_S = 90
#: Longest a quitting app waits for the threads of its running jobs, which cannot be killed but
#: stop at their next check once the app is stopping (``job_runner.request_stop``).
JOB_STOP_WAIT_S = 10

#: The instance lock after ``_run``: it is never released by hand, the system does that when the
#: process ends, so no second instance can start on the data before then. See :func:`finish`.
_held: list[instance.InstanceLock] = []


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    """Parse the command line (``argv`` of ``None`` means ``sys.argv``)."""
    parser = argparse.ArgumentParser(
        prog="python -m desktop_app",
        description="Run the tool as one local process on 127.0.0.1 and open it in the browser.",
    )
    parser.add_argument("--headless", action="store_true", help="no browser and no window (CI)")
    parser.add_argument(
        "--port", type=int, help="listen on this port, 0 for any free one; not remembered, no fallback"
    )
    parser.add_argument("--port-file", type=Path, help="write the port to this file once the server answers")
    parser.add_argument(
        "--token-file",
        type=Path,
        help="write the access token of this start to this file (readable by the owner only), "
        "for scripts: they send it as `Authorization: Bearer <token>`",
    )
    parser.add_argument(
        "--data-dir", type=Path, help="keep data, settings and logs in this directory instead of the user's"
    )
    parser.add_argument(
        "--frontend-dir", type=Path, help="the static export to serve (default: the bundled one)"
    )
    parser.add_argument(
        "--separate-sessions",
        action="store_true",
        help="a session per browser as on a server, instead of one for everybody (end-to-end tests)",
    )
    parser.add_argument(
        "--rate-limits",
        action="store_true",
        help="switch the request rate limits on, as on a server; here all requests share them, "
        "since they count per address (off by default; the daily caps of Claude calls apply, "
        "counted in memory and reset at every start)",
    )
    parser.add_argument("--access-log", action="store_true", help="log every request")
    args = parser.parse_args(argv)
    if args.port is not None and not 0 <= args.port <= 65535:
        parser.error("--port must be between 0 and 65535")
    return args


def write_port_file(path: Path, port: int) -> None:
    """Write the port to ``path`` for scripts, owner-readable where the system has modes."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    state.write_private_text(path, f"{port}\n")


def write_token_file(path: Path, token: str) -> None:
    """The master token, in a file only the owner can read where the system has modes."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    state.write_private_text(path, token)


def access_url(port: int, code: str) -> str:
    """The address that opens the app: the page server redeems the one-time ``code`` for a cookie and
    redirects to the same address without it. Never on a command line: the browser gets the login
    file that holds it (``app.Access.new_login_file``)."""
    return f"http://{instance.HOST}:{port}/?token={code}"


def main(argv: list[str] | None = None) -> int:
    """Launcher entry point; returns the exit code.

    Resolves the directories, installs the log file, then runs the app. Errors are shown in a
    dialog unless ``--headless``.
    """
    args = parse_args(argv)
    resources.prepare_import_path()
    try:
        name = paths.app_name()
    except RuntimeError as exc:
        print(exc, file=sys.stderr)
        return 1

    app_paths = paths.AppPaths.under(args.data_dir) if args.data_dir else paths.AppPaths.for_user()
    try:
        app_paths.create()
    except (OSError, LauncherError) as exc:
        print(f"{name} cannot use its directories: {exc}", file=sys.stderr)
        if not args.headless:
            ui.show_error(name, f"{name} cannot use its directories:\n{exc}")
        return 1
    logs.install(app_paths.log_file)

    try:
        return _run(args, name, app_paths)
    except LauncherError as exc:
        logger.error("%s", exc)
        if not args.headless:
            ui.show_error(name, str(exc))
        return 1
    except Exception:
        logger.exception("%s stopped with an error.", name)
        if not args.headless:
            ui.show_error(name, f"{name} stopped with an error. The log has the details:\n{app_paths.log_file}")
        return 1


def _run(args: argparse.Namespace, name: str, app_paths: paths.AppPaths) -> int:
    """Take the instance lock and serve; if another instance is running, show it instead."""
    logger.info("Starting %s. Data: %s; log: %s", name, app_paths.data, app_paths.log_file)
    lock = instance.InstanceLock(app_paths.lock)
    # The lock is taken again and again while another process holds it: that one may be quitting
    # (it holds the lock until it has ended), and then this start takes over.
    running = _wait_for_lock_or_instance(lock, name, app_paths)
    if running is not None:
        return _show_running(args, running)
    try:
        # What an earlier instance left (it was killed): nothing of it is true any more.
        app_paths.instance.unlink(missing_ok=True)
        app.remove_login_files(app_paths.data)
        return _serve(args, name, app_paths)
    finally:
        _hold_until_exit(lock)


def _wait_for_lock_or_instance(
    lock: instance.InstanceLock, name: str, app_paths: paths.AppPaths
) -> dict | None:
    """``None`` once this process holds the lock; else the running instance that holds it.

    Waits up to :data:`HANDOVER_TIMEOUT_S` for either: the holder may still be starting (no
    ``instance.json`` yet) or quitting (``instance.json`` gone, the lock held until it ends).
    """
    deadline = time.monotonic() + HANDOVER_TIMEOUT_S
    announced = False
    while not lock.acquire():
        if not announced:
            logger.info("%s is already running for %s; asking it.", name, app_paths.data)
            announced = True
        running = instance.find_running(app_paths.instance)
        if running is not None:
            return running
        if time.monotonic() >= deadline:
            raise LauncherError(
                f"{name} is already running for {app_paths.data}, but does not answer. "
                "Wait a moment and start it again, or end the other process."
            )
        time.sleep(0.5)
    return None


def _show_running(args: argparse.Namespace, running: dict) -> int:
    """Another process serves this data directory: show that one."""
    url = f"http://{instance.HOST}:{running['port']}/"
    logger.info("Showing the running instance (pid %s) at %s.", running.get("pid"), url)
    if args.port_file:
        write_port_file(args.port_file, running["port"])
    if args.token_file:
        write_token_file(args.token_file, running["token"])
    if not args.headless:
        # The running instance (it has proved that it knows the token) writes the login file and
        # deletes it once the code is redeemed: the code is not on the command line of the
        # browser, where other users can read it. Without one the page says to use the window.
        login = instance.request_login(running["port"], running["token"])
        target = Path(login["file"]).as_uri() if login and login["file"] else url
        webbrowser.open(target, new=2)  # not in a thread: this process ends right after
    return 0


def _job_threads() -> list[threading.Thread]:
    """The non-daemon threads besides this one: the threads of the jobs the app runs itself."""
    me = threading.current_thread()
    return [t for t in threading.enumerate() if t is not me and t is not threading.main_thread() and not t.daemon]


def _hold_until_exit(lock: instance.InstanceLock) -> None:
    """Keep the instance lock until the process has ended, after giving the jobs time to stop.

    A job thread cannot be killed and outlives the server. At quit the jobs are told to stop
    (``job_runner.request_stop``, from ``BackgroundServer``) and get :data:`JOB_STOP_WAIT_S` to
    do so. The lock is not released by hand, not even then: the system releases it when the
    process ends, so no second instance can start on the same database while any part of this
    one still runs. Then :func:`finish` ends the process at once (``os._exit``), without waiting for
    job threads that are left.
    """
    _held.append(lock)
    deadline = time.monotonic() + JOB_STOP_WAIT_S
    while _job_threads() and time.monotonic() < deadline:
        time.sleep(0.1)
    leftover = _job_threads()
    if leftover:
        logger.warning(
            "%d job thread(s) did not stop in %d s (%s); the process ends without them.",
            len(leftover), JOB_STOP_WAIT_S, ", ".join(t.name for t in leftover),
        )


def finish(code: int) -> int:
    """The exit code. After a start that served, the process ends here with ``os._exit``, once the
    log is flushed: the interpreter would wait for the job threads that are left for as long as
    they run, and would release the instance lock (a file it closes) before the process is gone.
    ``os._exit`` leaves the release to the system, at the moment the process ends."""
    if _held:
        logging.shutdown()
        for stream in (sys.stdout, sys.stderr):
            try:
                stream.flush()
            except (OSError, ValueError, AttributeError):
                pass
        os._exit(code)
    return code


def _log_settings(settings: dict[str, str], env: dict[str, str], args: argparse.Namespace) -> None:
    """Log which settings and options shape this start; names only, never the values."""
    if settings:
        logger.info("settings.env sets %s.", ", ".join(sorted(settings)))
    key = env.get("ANTHROPIC_API_KEY", "").strip()
    source = "settings.env" if settings.get("ANTHROPIC_API_KEY", "").strip() == key else "the environment"
    logger.info(
        "Interpretation by Claude: %s.", f"on, key from {source}" if key else "precomputed only (no ANTHROPIC_API_KEY)"
    )
    if args.separate_sessions:
        logger.info("Separate sessions per browser (--separate-sessions).")
    if args.rate_limits:
        logger.info("Request rate limits are on (--rate-limits).")


def _install_signal_handlers(stop: threading.Event) -> None:
    def handle(signum, frame) -> None:
        stop.set()

    for name in ("SIGINT", "SIGTERM", "SIGBREAK"):
        if hasattr(signal, name):
            signal.signal(getattr(signal, name), handle)


def _serve(args: argparse.Namespace, name: str, app_paths: paths.AppPaths) -> int:
    """Start the backend and show the app until it is closed; returns the exit code.

    Order matters: bind the port, set the backend's environment, migrate the database, and only
    then import the backend, which reads its settings at import. The instance info and the port
    file are written once the server answers, and the info is removed when the app stops.
    """
    frontend = Path(args.frontend_dir) if args.frontend_dir else resources.frontend_dir()
    PageServer.from_export(frontend)  # fails now, not after the imports, if the export is missing

    identity = state.load_or_create_identity(app_paths.identity, app_paths.database)
    logs.hide(identity.shared_session_id, identity.session_secret_key)
    settings = state.read_settings_env(app_paths.settings_env)
    remembered = state.remembered_port(app_paths.launcher_state)
    if args.port is not None:
        try:
            sock = instance.bind(args.port)
        except OSError as exc:
            raise LauncherError(f"Port {args.port} cannot be used: {exc.strerror or exc}") from None
    else:
        sock = instance.bind_preferred(remembered or instance.DEFAULT_PORT, fall_back=True)
    port = sock.getsockname()[1]

    try:
        env = environment.backend_environ(
            os.environ,
            app_paths,
            identity,
            settings,
            resources.build_info(),
            shared_session=not args.separate_sessions,
            rate_limits=args.rate_limits,
        )
        environment.apply(env)
        _log_settings(settings, env, args)
        register_mime_types()

        # The backend reads its settings when it is imported, so only now.
        import db_migrate

        logger.info("Bringing the database up to date: %s", app_paths.database)
        db_migrate.upgrade_to_head()

        import srv_main

        import job_runner

        from .app import Access, Shutdown, build_app
        from .server import BackgroundServer

        token = secrets.token_urlsafe(32)
        access = Access(token, app_paths.data)
        shutdown = Shutdown()
        web_app = build_app(
            srv_main.app,
            frontend,
            port=port,
            token=token,
            instance={"pid": os.getpid(), "port": port, "app": name},
            shutdown=shutdown,
            access=access,
        )

        def on_stop() -> None:
            shutdown.request()  # ends the progress streams
            job_runner.request_stop()  # the running jobs give up at their next check

        server = BackgroundServer(web_app, sock, access_log=args.access_log, on_stop=on_stop)
    except BaseException:
        sock.close()
        raise

    stop = threading.Event()
    _install_signal_handlers(stop)
    server.start()
    if not server.wait_started(STARTUP_TIMEOUT_S):
        server.stop()
        raise LauncherError(f"The server of {name} did not start. The log has the details:\n{app_paths.log_file}")

    instance.write_info(app_paths.instance, port=port, token=token)
    try:
        if args.port is None and port != remembered:
            state.remember_port(app_paths.launcher_state, port)
        if args.token_file:
            write_token_file(args.token_file, token)
        if args.port_file:  # last: scripts wait for it
            write_port_file(args.port_file, port)
        url = f"http://{instance.HOST}:{port}/"

        def open_url() -> str:
            """The login file of a new one-time code, for the browser; never logged or shown."""
            _, path = access.new_login_file(lambda code: access_url(port, code))
            return path.as_uri()

        logger.info("%s is running at %s", name, url)

        shown = False
        if not args.headless:
            ui.open_browser(open_url())
            shown = ui.run_window(
                name,
                url,
                open_url=open_url,
                data_dir=app_paths.data,
                log_file=app_paths.log_file,
                should_close=lambda: stop.is_set() or not server.running,
                quit_app=server.stop,
            )
        if not shown:
            logger.info("Press Ctrl+C to quit.")
            while not stop.is_set() and server.running:
                stop.wait(0.5)
        crashed = not server.running and not stop.is_set() and not server.server.should_exit
        logger.info("Stopping %s.", name)
        server.stop()
    finally:
        instance.remove_info(app_paths.instance, token)
        access.close()
    logger.info("%s has stopped.", name)
    return 1 if crashed else 0

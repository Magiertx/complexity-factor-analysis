"""Start the tool as one local process: ``python -m desktop_app [options]``.

1. Find the app's directories, open the log, take the instance lock (or hand over to the
   instance that has it and exit).
2. Read or create the session key and id, read settings.env, pick the port.
3. Set the backend's environment, migrate the database, import the backend.
4. Serve API and pages on 127.0.0.1, open the browser, show the status window until Quit.
"""

from __future__ import annotations

import argparse
import logging
import os
import secrets
import signal
import sys
import threading
import webbrowser
from pathlib import Path

from . import environment, instance, logs, paths, resources, state, ui
from .pages import PageServer, register_mime_types
from .state import LauncherError

logger = logging.getLogger("desktop")

#: Longest the server's own startup (after the imports and migrations) may take.
STARTUP_TIMEOUT_S = 120
#: Longest a second start waits for the running instance, which may itself be starting.
HANDOVER_TIMEOUT_S = 90


def parse_args(argv: list[str] | None) -> argparse.Namespace:
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
        "since they count per address (the daily caps of Claude calls always apply)",
    )
    # The default since the limits count per address, and one installation has one user.
    parser.add_argument("--no-rate-limits", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--access-log", action="store_true", help="log every request")
    args = parser.parse_args(argv)
    if args.port is not None and not 0 <= args.port <= 65535:
        parser.error("--port must be between 0 and 65535")
    return args


def write_port_file(path: Path, port: int) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(f"{port}\n", encoding="utf-8")
    os.replace(tmp, path)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    resources.prepare_import_path()
    try:
        name = paths.app_name()
    except RuntimeError as exc:
        print(exc, file=sys.stderr)
        return 1

    app_paths = paths.AppPaths.under(args.data_dir) if args.data_dir else paths.AppPaths.for_user(name)
    try:
        app_paths.create()
    except OSError as exc:
        print(f"{name} cannot create its directories: {exc}", file=sys.stderr)
        if not args.headless:
            ui.show_error(name, f"{name} cannot create its directories:\n{exc}")
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
    logger.info("Starting %s. Data: %s; log: %s", name, app_paths.data, app_paths.log_file)
    lock = instance.InstanceLock(app_paths.lock)
    if not lock.acquire():
        return _hand_over(args, name, app_paths)
    try:
        return _serve(args, name, app_paths)
    finally:
        lock.release()


def _hand_over(args: argparse.Namespace, name: str, app_paths: paths.AppPaths) -> int:
    """Another process serves this data directory: show that one."""
    logger.info("%s is already running for %s; waiting for it to answer.", name, app_paths.data)
    running = instance.wait_for_running(app_paths.instance, HANDOVER_TIMEOUT_S)
    if running is None:
        raise LauncherError(
            f"{name} is already running for {app_paths.data}, but does not answer. "
            "Wait a moment and start it again, or end the other process."
        )
    url = f"http://{instance.HOST}:{running['port']}/"
    logger.info("Showing the running instance (pid %s) at %s.", running.get("pid"), url)
    if args.port_file:
        write_port_file(args.port_file, running["port"])
    if not args.headless:
        webbrowser.open(url, new=2)  # not in a thread: this process ends right after
    return 0


def _log_settings(settings: dict[str, str], env: dict[str, str], args: argparse.Namespace) -> None:
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
    frontend = Path(args.frontend_dir) if args.frontend_dir else resources.frontend_dir()
    PageServer.from_export(frontend)  # fails now, not after the imports, if the export is missing

    identity = state.load_or_create_identity(app_paths.identity)
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
            rate_limits=args.rate_limits and not args.no_rate_limits,
        )
        environment.apply(env)
        _log_settings(settings, env, args)
        register_mime_types()

        # The backend reads its settings when it is imported, so only now.
        import db_migrate

        logger.info("Bringing the database up to date: %s", app_paths.database)
        db_migrate.upgrade_to_head()

        import srv_main

        from .app import Shutdown, build_app
        from .server import BackgroundServer

        token = secrets.token_urlsafe(32)
        shutdown = Shutdown()
        app = build_app(
            srv_main.app,
            frontend,
            port=port,
            token=token,
            instance={"pid": os.getpid(), "port": port, "app": name},
            shutdown=shutdown,
        )
        server = BackgroundServer(app, sock, access_log=args.access_log, on_stop=shutdown.request)
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
        if args.port_file:
            write_port_file(args.port_file, port)
        url = f"http://{instance.HOST}:{port}/"
        logger.info("%s is running at %s", name, url)

        shown = False
        if not args.headless:
            ui.open_browser(url)
            shown = ui.run_window(
                name,
                url,
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
    logger.info("%s has stopped.", name)
    return 1 if crashed else 0

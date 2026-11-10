"""The browser, a small status window (Tk), or the console when there is no window."""

from __future__ import annotations

import logging
import os
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path
from typing import Callable

logger = logging.getLogger("desktop")


def open_browser(url: str) -> None:
    # In a thread: on some Linux desktops webbrowser waits for the browser it starts.
    threading.Thread(target=webbrowser.open, args=(url,), kwargs={"new": 2}, daemon=True).start()


def open_path(path: Path) -> None:
    """Show a folder or a file in the system's own program."""
    try:
        if sys.platform == "win32":
            os.startfile(path)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(path)])
        else:
            subprocess.Popen(["xdg-open", str(path)])
    except OSError:
        logger.exception("Could not open %s", path)


def show_error(title: str, message: str) -> None:
    """A message box where there is no console to read the error in; else nothing."""
    try:
        import tkinter
        from tkinter import messagebox

        root = tkinter.Tk()
        root.withdraw()
        messagebox.showerror(title, message, parent=root)
        root.destroy()
    except Exception:
        pass


def run_window(
    name: str,
    url: str,
    *,
    open_url: Callable[[], str] | None = None,
    data_dir: Path,
    log_file: Path,
    should_close: Callable[[], bool],
    quit_app: Callable[[], None],
) -> bool:
    """Show the status window, which displays ``url`` and whose "Open in browser" opens what
    ``open_url()`` returns (an address with a one-time code, not displayed) where given, until Quit, closing it or :func:`should_close` (Ctrl+C, the server
    stopped). ``quit_app`` stops the server; it runs in a thread while the window says so.
    Returns ``False`` at once if there is no Tk or no display: the caller then waits in the
    console.
    """
    try:
        import tkinter
        from tkinter import ttk

        root = tkinter.Tk()
    except Exception as exc:  # no tkinter, or no display (TclError)
        logger.info("No status window (%s); running in the console.", exc)
        return False

    root.title(name)
    root.resizable(False, False)
    frame = ttk.Frame(root, padding=16)
    frame.grid(sticky="nsew")

    ttk.Label(frame, text=name, font=("TkDefaultFont", 13, "bold")).grid(row=0, column=0, columnspan=4, sticky="w")
    status = tkinter.StringVar(value="Running at")
    ttk.Label(frame, textvariable=status).grid(row=1, column=0, columnspan=4, sticky="w", pady=(8, 0))
    address = ttk.Entry(frame, width=len(url) + 2)
    address.insert(0, url)
    address.configure(state="readonly")
    address.grid(row=2, column=0, columnspan=4, sticky="we", pady=(2, 12))

    stopping = threading.Event()
    stopped = threading.Event()

    def stop() -> None:
        if stopping.is_set():
            return
        stopping.set()
        status.set("Stopping ...")
        for button in buttons:
            button.state(["disabled"])

        def work() -> None:
            try:
                quit_app()
            finally:
                stopped.set()

        threading.Thread(target=work, name="quit", daemon=True).start()

    buttons = [
        ttk.Button(frame, text="Open in browser", command=lambda: open_browser(open_url() if open_url else url)),
        ttk.Button(frame, text="Open data folder", command=lambda: open_path(data_dir)),
        ttk.Button(frame, text="Open log", command=lambda: open_path(log_file)),
        ttk.Button(frame, text="Quit", command=stop),
    ]
    for column, button in enumerate(buttons):
        button.grid(row=3, column=column, padx=(0 if column == 0 else 6, 0))

    root.protocol("WM_DELETE_WINDOW", stop)

    def poll() -> None:
        # Also gives Python a chance to run its Ctrl+C handler while Tk waits for events.
        if stopped.is_set():
            root.destroy()
            return
        if not stopping.is_set() and should_close():
            stop()
        root.after(200, poll)

    root.after(200, poll)
    root.mainloop()
    return True

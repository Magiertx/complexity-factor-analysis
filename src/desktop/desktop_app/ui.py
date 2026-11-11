"""The browser, a small status window (Tk), or the console when there is no window."""

from __future__ import annotations

import logging
import os
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path
from typing import Any, Callable

from . import resources

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


def sharp_on_windows() -> None:
    """Windows: draw the window at the screen's own resolution. A program that does not say it
    handles scaling gets drawn small and stretched by Windows, which blurs it on a screen at 150
    or 200 %. System-wide awareness, as IDLE does it: Tk does not follow a window to a monitor
    of other scaling, so per-monitor awareness would leave it too large or too small there."""
    if sys.platform != "win32":
        return
    try:
        import ctypes

        try:
            ctypes.OleDLL("shcore").SetProcessDpiAwareness(1)
        except (AttributeError, OSError):
            ctypes.windll.user32.SetProcessDPIAware()  # type: ignore[attr-defined]
    except Exception:  # already set (the manifest, an earlier call), or an old Windows
        pass


def set_icon(root: Any) -> Any:
    """The app's icon for the window, the taskbar and the Dock instead of Tk's feather; returns the
    image (or ``None``) for the window to show as well."""
    from tkinter import PhotoImage

    try:
        if sys.platform == "win32" and resources.icon_path(".ico").is_file():
            root.iconbitmap(default=str(resources.icon_path(".ico")))  # all sizes: sharp in the taskbar
        png = resources.icon_path(".png")
        if not png.is_file():
            return None
        image = PhotoImage(master=root, file=str(png))
        if sys.platform != "win32":
            root.iconphoto(True, image)
        return image
    except Exception as exc:  # a missing or broken file must not stop the app
        logger.info("No icon for the window (%s).", exc)
        return None


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
    sharp_on_windows()
    try:
        import tkinter
        from tkinter import ttk

        root = tkinter.Tk()
    except Exception as exc:  # no tkinter, or no display (TclError)
        logger.info("No status window (%s); running in the console.", exc)
        return False

    root.title(name)
    root.resizable(False, False)
    logo = set_icon(root)
    # Pixel sizes grow with the screen's scaling (Tk scales fonts by itself, not paddings).
    scale = max(1.0, root.winfo_fpixels("1i") / 96)

    def px(value: float) -> int:
        return round(value * scale)

    frame = ttk.Frame(root, padding=px(16))
    frame.grid(sticky="nsew")

    head = ttk.Frame(frame)
    head.grid(row=0, column=0, columnspan=4, sticky="w")
    if logo is not None:
        step = max(1, round(logo.width() / px(40)))
        small = logo.subsample(step, step)
        ttk.Label(head, image=small).grid(row=0, column=0, rowspan=2, padx=(0, px(12)))
        root._logo = small  # type: ignore[attr-defined]  # Tk forgets an image nobody holds
    ttk.Label(head, text=name, font=("TkDefaultFont", 14, "bold")).grid(row=0, column=1, sticky="w")
    status = tkinter.StringVar(value="Running at")
    ttk.Label(head, textvariable=status).grid(row=1, column=1, sticky="w")
    address = ttk.Entry(frame, width=len(url) + 2)
    address.insert(0, url)
    address.configure(state="readonly")
    address.grid(row=2, column=0, columnspan=4, sticky="we", pady=(px(10), px(12)))

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
    buttons[0].configure(default="active")  # the one most people want
    for column, button in enumerate(buttons):
        button.grid(row=3, column=column, padx=(0 if column == 0 else px(6), 0), ipadx=px(4), ipady=px(2))

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

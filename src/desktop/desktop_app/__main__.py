"""Entry point: ``python -m desktop_app``, and the script a frozen build starts."""

import multiprocessing

if __name__ == "__main__":
    # First: in a frozen build, a child process of multiprocessing starts this script again and
    # must run its task instead of a second app.
    multiprocessing.freeze_support()

    import os
    import sys

    # A windowed build (no console) has no stdout or stderr; anything printed before the log
    # file is open would raise. The log replaces these in main().
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")

    from desktop_app.main import finish, main

    sys.exit(finish(main()))

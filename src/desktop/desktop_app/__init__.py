"""The desktop app: the whole tool as one local process.

``python -m desktop_app`` (from ``src/desktop``) serves the API and the static export of the
frontend on 127.0.0.1 and opens the browser. See docs/DESKTOP.md.

Kept free of imports: ``__main__`` has to call ``multiprocessing.freeze_support()`` before
anything else runs.
"""

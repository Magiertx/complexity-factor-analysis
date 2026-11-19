"""The status window's version line (desktop_app/ui.py)."""

from __future__ import annotations

import pytest

from ._support import DESKTOP  # noqa: F401  (puts the launcher on the path)

from desktop_app.ui import version_line


@pytest.mark.parametrize(
    ("version", "commit", "line"),
    [
        # A build: the version of version.py and the commit, which tells test builds apart.
        ("1.1.1", "829612579414f84f6f0fb7c3f68a7a7dd7df44bb", "Version 1.1.1 · build 8296125"),
        # From a checkout: `git describe` names the build already.
        ("v1.1.1-2-g8296125-dirty", "829612579414f84f6f0fb7c3f68a7a7dd7df44bb", "Version v1.1.1-2-g8296125-dirty"),
        ("1.1.1", "unknown", "Version 1.1.1"),
        ("", "829612579414f84f6f0fb7c3f68a7a7dd7df44bb", "Build 8296125"),
        ("", "", ""),
    ],
)
def test_version_line_names_the_version_and_the_build(version, commit, line):
    assert version_line(version, commit) == line

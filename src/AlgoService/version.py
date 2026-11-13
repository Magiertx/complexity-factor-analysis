"""The version of the tool, in one place.

``provenance.tool`` uses it when ``APP_VERSION`` and git give none, as in the Docker image; the
frontend's ``package.json`` carries the same one (a test compares them). A release sets it here
and in ``package.json`` and tags the commit with ``v`` and the version.
"""

VERSION = "1.0.0"

#: The address of the tool's repository, which the exports cite.
REPOSITORY_URL = "https://github.com/Magiertx/complexity-factor-analysis"

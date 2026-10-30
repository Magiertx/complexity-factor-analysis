"""Check that docker-compose.release.yml matches docker-compose.yml.

The release file runs the prebuilt images, so it differs in exactly one key per built service:
`image:` instead of `build:`. Everything else (environment, volumes, healthchecks, ...) has to
be identical, otherwise the two ways of starting the stack drift apart.

    python scripts/check_release_compose.py
"""
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
IMAGE = "ghcr.io/magiertx/complexity-factor-analysis-{}:${{CFA_TAG:-latest}}"
# service -> image name suffix; the worker shares the algoservice image
BUILT = {"prom4py": "prom4py", "algoservice": "algoservice", "celery_worker": "algoservice", "frontend": "frontend"}


def load(name: str) -> dict:
    return yaml.safe_load((ROOT / name).read_text(encoding="utf-8"))


def main() -> int:
    main_file, release = load("docker-compose.yml"), load("docker-compose.release.yml")
    problems = []
    if set(main_file) != set(release):
        problems.append(f"top-level keys differ: {sorted(set(main_file) ^ set(release))}")
    if set(main_file["services"]) != set(release["services"]):
        problems.append(f"services differ: {sorted(set(main_file['services']) ^ set(release['services']))}")
    for name, svc in main_file["services"].items():
        have = release["services"].get(name, {})
        want = dict(svc)
        if name in BUILT:
            want.pop("build", None)
            want["image"] = IMAGE.format(BUILT[name])
        if have != want:
            keys = sorted(k for k in set(have) | set(want) if have.get(k) != want.get(k))
            problems.append(f"{name} differs in {keys}")
    for key in ("networks", "volumes"):
        if main_file.get(key) != release.get(key):
            problems.append(f"{key} differ")
    for p in problems:
        print("release compose out of sync:", p)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Build the desktop app (docs/DESKTOP.md): static export, PyInstaller bundle, release archive.

    python scripts/build_desktop.py frontend     # npm run build:export and the npm licences
    python scripts/build_desktop.py bundle       # stage directory + PyInstaller (onedir)
    python scripts/build_desktop.py pack         # .zip (Windows), .dmg (macOS), .tar.gz (Linux)
    python scripts/build_desktop.py all          # the three in a row (the default)
    python scripts/build_desktop.py verify-macos # the bundle needs no newer macOS than MACOS_MIN
    python scripts/build_desktop.py exe          # print the program in the bundle (for the CI)
    python scripts/build_desktop.py copyleft     # name==version of the bundled copyleft packages

Run it from any directory with the backend's requirements, ``requirements-desktop.txt`` and, for
``frontend``, Node.js installed (``npm ci`` in ``src/frontend`` first). Output goes to
``build/desktop`` of the repository:

    stage/   build_info.json, meta.json, LICENSE, THIRD-PARTY-LICENSES.txt (read by desktop.spec;
             the licence list is rewritten after PyInstaller ran, from what it really bundled),
             bundled-packages.json, copyleft.txt
    work/    PyInstaller's scratch directory
    dist/    the bundle: <slug>/ (Windows, Linux) or <name>.app (macOS)
    release/ the archive that is published

The name comes from ``APP_NAME`` in ``src/AlgoService/config.py`` (AGENTS.md: it is written down
in two places only), the version from ``src/AlgoService/version.py`` and the commit from git.
Standard library only, apart from PyInstaller and pip-licenses, which run as programs.
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import platform
from importlib import metadata
import re
import shutil
import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
BACKEND = SRC / "AlgoService"
FRONTEND = SRC / "frontend"
SPEC = SRC / "desktop" / "desktop.spec"
# CFA_BUILD_DIR: a short path where Windows' 260 characters would not do for a deep checkout.
BUILD = Path(os.environ["CFA_BUILD_DIR"]).resolve() if os.environ.get("CFA_BUILD_DIR") else ROOT / "build" / "desktop"
STAGE = BUILD / "stage"
WORK = BUILD / "work"
DIST = BUILD / "dist"
RELEASE = BUILD / "release"

#: Oldest macOS the bundle runs on. Set by SciPy and scikit-learn, whose arm64 wheels for the
#: pinned versions need macOS 14 (``verify-macos`` checks every binary of the bundle against it).
#: cvxopt 1.3.3 would raise it to 15 and is left out (docs/DESKTOP.md, "cvxopt").
MACOS_MIN = "14.0"

#: Distributions that are in the environment of the build and never part of the program: the tools
#: that build it and licence it. A distribution is listed as bundled only if PyInstaller's table of
#: contents has a file of it (``bundled_distributions``), so this only keeps a tool out if a
#: dependency of PyInstaller itself ended up in the table of contents.
BUILD_TOOLS = {"pyinstaller", "pyinstaller-hooks-contrib", "altgraph", "pefile", "pywin32-ctypes", "macholib", "pip-licenses", "prettytable"}

#: Substrings of a licence name (as pip-licenses reports it) that make a package copyleft: its
#: source must be offered with the binaries (the GPL family, the AGPL, the MPL, the EPL).
COPYLEFT_MARKERS = ("GPL", "MPL", "MOZILLA PUBLIC", "EPL", "ECLIPSE PUBLIC", "CDDL", "EUPL")

#: The ComFy code the app carries (src/AlgoService/vendored/*/PROVENANCE.md); MIT, with its own notice.
VENDORED = [
    ("vendored/comfy", "ComFy (https://github.com/Pati-nets/ComFy)"),
    ("vendored/comfy_log", "ComFy for log measures (vendored/comfy_log)"),
]


def run(cmd: list[str], cwd: Path | None = None, env: dict[str, str] | None = None) -> None:
    print("+", " ".join(str(c) for c in cmd), flush=True)
    subprocess.run(cmd, cwd=cwd, env=env, check=True)


def app_name() -> str:
    """``APP_NAME`` read from the backend's config.py without importing it."""
    tree = ast.parse((BACKEND / "config.py").read_text(encoding="utf-8"))
    for node in tree.body:
        targets = node.targets if isinstance(node, ast.Assign) else [getattr(node, "target", None)]
        if any(isinstance(t, ast.Name) and t.id == "APP_NAME" for t in targets):
            return ast.literal_eval(node.value)
    raise SystemExit("config.py has no APP_NAME = '<name>'.")


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def tool_version() -> str:
    """``VERSION`` of version.py, checked against the tag when the build is for one."""
    match = re.search(r'^VERSION\s*=\s*"([^"]+)"', (BACKEND / "version.py").read_text(encoding="utf-8"), re.M)
    if not match:
        raise SystemExit("src/AlgoService/version.py has no VERSION = \"...\".")
    version = match.group(1)
    if os.environ.get("GITHUB_REF_TYPE") == "tag":
        tag = os.environ.get("GITHUB_REF_NAME", "")
        if tag.removeprefix("v") != version:
            raise SystemExit(f"The tag {tag} does not name the version of version.py ({version}).")
    return version


def tool_commit() -> str:
    env = os.environ.get("APP_COMMIT", "").strip() or os.environ.get("GITHUB_SHA", "").strip()
    if env:
        return env
    out = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD"], capture_output=True, text=True)
    commit = out.stdout.strip()
    if out.returncode != 0 or not commit:
        raise SystemExit("The commit is not known: pass APP_COMMIT or build from a git checkout.")
    return commit


def system() -> str:
    return {"win32": "windows", "darwin": "macos"}.get(sys.platform, "linux")


def machine() -> str:
    m = platform.machine().lower()
    return {"amd64": "x64", "x86_64": "x64", "arm64": "arm64", "aarch64": "arm64"}.get(m, m)


# --- frontend ---------------------------------------------------------------------------------


def npm_licenses() -> str:
    """Licences of the npm packages installed for production (what ends up in the pages), read
    from package-lock.json and node_modules."""
    lock = json.loads((FRONTEND / "package-lock.json").read_text(encoding="utf-8"))
    entries = []
    for path, info in sorted(lock.get("packages", {}).items()):
        if not path or info.get("dev") or info.get("devOptional"):
            continue
        pkg_dir = FRONTEND / path
        manifest = pkg_dir / "package.json"
        if not manifest.is_file():  # an optional platform package of another system
            continue
        meta = json.loads(manifest.read_text(encoding="utf-8"))
        license_name = meta.get("license") or info.get("license") or "see the package"
        if isinstance(license_name, dict):
            license_name = license_name.get("type", "see the package")
        text = ""
        for candidate in sorted(pkg_dir.iterdir()):
            if re.match(r"(licen[sc]e|copying|notice)", candidate.name, re.I) and candidate.is_file():
                text += candidate.read_text(encoding="utf-8", errors="replace").strip() + "\n\n"
        entries.append((meta.get("name", path), meta.get("version", ""), license_name, text.strip()))
    lines = ["Third-party licences of the web pages (npm packages installed for production)", ""]
    for name, version, license_name, text in entries:
        lines += ["=" * 78, f"{name} {version}  [{license_name}]", "=" * 78, text or "(no licence file in the package)", ""]
    return "\n".join(lines)


def cmd_frontend(_: argparse.Namespace) -> None:
    npm = "npm.cmd" if sys.platform == "win32" else "npm"
    run([npm, "run", "build:export"], cwd=FRONTEND)
    (FRONTEND / "npm-licenses.txt").write_text(npm_licenses(), encoding="utf-8")
    print(f"Wrote {FRONTEND / 'npm-licenses.txt'}")


# --- bundle -----------------------------------------------------------------------------------


def norm(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def toc_files(toc_path: Path) -> list[str]:
    """The source paths in PyInstaller's table of contents (``Analysis-00.toc``) that lie in
    ``site-packages``: the modules, binaries and data files that are really in the bundle."""
    import ast

    tree = ast.literal_eval(toc_path.read_text(encoding="utf-8"))
    found: set[str] = set()

    def walk(node: object) -> None:
        if isinstance(node, str):
            if "site-packages" in node.lower() and len(node) > 12:
                found.add(node)
        elif isinstance(node, dict):
            for value in node.values():
                walk(value)
        elif isinstance(node, (list, tuple)):
            for value in node:
                walk(value)

    walk(tree)
    return sorted(found)


def bundled_distributions(toc_path: Path) -> list[tuple[str, str]]:
    """``(name, version)`` of every installed distribution that has code, a compiled library or a
    data file in PyInstaller's table of contents, which is what is bundled. (The spec copies the
    metadata of every installed package for ``importlib.metadata``; that alone does not count.)"""
    if not toc_path.is_file():
        raise SystemExit(f"{toc_path} is missing: run `bundle` first.")
    tops: set[str] = set()
    for path in toc_files(toc_path):
        tail = re.split(r"site-packages[\\/]", path, maxsplit=1, flags=re.I)[-1]
        top = re.split(r"[\\/]", tail, maxsplit=1)[0].lower()
        if not top.endswith((".dist-info", ".egg-info")):  # the metadata of every installed package is copied; only code, libraries and data count
            tops.add(top)
    owners: dict[str, set[str]] = {}
    versions: dict[str, str] = {}
    for dist in metadata.distributions():
        name = dist.metadata["Name"]
        if not name:
            continue
        key = norm(name)
        versions[key] = dist.version
        for file in dist.files or []:
            owners.setdefault(file.parts[0].lower(), set()).add(key)
        info = getattr(dist, "_path", None)
        if info is not None:
            owners.setdefault(Path(info).name.lower(), set()).add(key)
    bundled = {key for top in tops for key in owners.get(top, set())}
    bundled -= {norm(n) for n in BUILD_TOOLS}
    return sorted((key, versions[key]) for key in bundled)


def licence_table(names: list[str]) -> list[dict]:
    """pip-licenses' view of the given distributions: name, version, licence and URL."""
    cmd = [sys.executable, "-m", "piplicenses", "--format=json", "--with-urls", "--packages", *names]
    env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
    out = subprocess.run(cmd, capture_output=True, text=True, check=True, encoding="utf-8", env=env)
    return json.loads(out.stdout)


def copyleft_packages(table: list[dict]) -> list[dict]:
    return [row for row in table if any(m in (row.get("License") or "").upper() for m in COPYLEFT_MARKERS)]


def python_licenses(names: list[str]) -> str:
    cmd = [
        sys.executable, "-m", "piplicenses", "--format=plain-vertical", "--with-license-file",
        "--no-license-path", "--with-notice-file", "--with-urls", "--packages", *names,
    ]
    env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
    out = subprocess.run(cmd, capture_output=True, text=True, check=True, encoding="utf-8", env=env)
    return out.stdout


def vendored_licenses() -> str:
    """The notices of the ComFy sources under src/AlgoService/vendored (MIT requires them)."""
    parts = []
    for folder, title in VENDORED:
        text = (BACKEND / folder / "LICENSE").read_text(encoding="utf-8").strip()
        parts.append(f"{title}\n{'-' * 78}\nsource: src/AlgoService/{folder}/ (PROVENANCE.md names the origin and the changes)\n\n{text}\n")
    return "\n".join(parts)


def third_party_text(name: str, version: str, packages: list[tuple[str, str]] | None = None) -> str:
    """The licence file. ``packages`` is what the bundle contains (``bundled_distributions``);
    without it (before PyInstaller ran) only the header and the notices are written."""
    npm_file = FRONTEND / "npm-licenses.txt"
    npm = npm_file.read_text(encoding="utf-8") if npm_file.is_file() else "(not generated: run `frontend`)"
    repo = "https://github.com/Magiertx/complexity-factor-analysis"
    table = licence_table([n for n, _ in packages]) if packages else []
    copyleft = copyleft_packages(table)
    lines = []
    for row in copyleft:
        lines.append(f"  - {row['Name']} {row['Version']}: {row['License']}")
    copyleft_block = "\n".join(lines) if lines else "  (the list is made when the bundle is built)"
    header = f"""Third-party software in {name} {version}
{'=' * 78}

{name} is licensed under the MIT licence (LICENSE). The program contains the software below,
under its own licences, which are reproduced after this note.

Copyleft packages in this program, and where their source code is
-----------------------------------------------------------------
{copyleft_block}

PM4Py (GNU Affero General Public License v3 or later) and Levenshtein (GNU General Public
License v2 or later) are part of this program; certifi and tqdm (Mozilla Public License 2.0) are
included unmodified. For every package in the list above the exact source distribution (sdist) of
the version in this program is attached to the release of {name} on {repo}/releases, next to the
binaries, and is also on https://pypi.org/project/<package>/ . The source code of this program,
with the build scripts that made this bundle (scripts/build_desktop.py, src/desktop/desktop.spec)
and the exact version of every library (src/AlgoService/constraints.txt), is at {repo}; the
commit is in build_info.json. If you cannot get a source code in this way, ask the maintainers of
that repository.

The program also contains the Python interpreter (Python Software Foundation License) and Tcl/Tk
(BSD-style licence) for its status window. The wheels of NumPy, SciPy
and others contain compiled libraries (OpenBLAS, GCC runtime, ...) whose licences are part of the
texts below.

Vendored source code
{'=' * 78}

{vendored_licenses()}
The ProM4Py client in vendored/comfy/prom4py is not covered by this note: ComFy's README asks users
to copy it in from the ProM4Py distribution (Zenodo record 13853660); its licence is not recorded
in this repository (see vendored/comfy/PROVENANCE.md).

Python packages
{'=' * 78}

"""
    body = python_licenses([n for n, _ in packages]) if packages else "(made when the bundle is built)\n"
    return header + body + "\n\nWeb pages\n" + "=" * 78 + "\n\n" + npm


def toc_path() -> Path:
    return WORK / SPEC.stem / "Analysis-00.toc"


def write_licences(meta: dict) -> None:
    """The licence file and the list of copyleft packages, from what the bundle really contains."""
    packages = bundled_distributions(toc_path())
    table = licence_table([n for n, _ in packages])
    text = third_party_text(meta["name"], meta["version"], packages)
    (STAGE / "THIRD-PARTY-LICENSES.txt").write_text(text, encoding="utf-8")
    (STAGE / "bundled-packages.json").write_text(json.dumps(table, indent=2) + "\n", encoding="utf-8")
    copyleft = copyleft_packages(table)
    (STAGE / "copyleft.txt").write_text("".join(f"{row['Name']}=={row['Version']}\n" for row in copyleft), encoding="utf-8")
    # PyInstaller copied the provisional file into the bundle; replace every copy.
    copies = list(bundle_dir(meta).rglob("THIRD-PARTY-LICENSES.txt"))
    if not copies:
        raise SystemExit(f"THIRD-PARTY-LICENSES.txt is not in {bundle_dir(meta)}: the spec has to put it there.")
    for target in copies:
        target.write_text(text, encoding="utf-8")
    print(f"{len(packages)} packages in the bundle, {len(copyleft)} copyleft: "
          f"{', '.join(r['Name'] for r in copyleft)}; licences written to {len(copies)} place(s)")


def write_stage() -> dict:
    name = app_name()
    version = tool_version()
    meta = {
        "name": name,
        "slug": slug(name),
        "version": version,
        "commit": tool_commit(),
        "macos_min": MACOS_MIN,
    }
    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir(parents=True)
    (STAGE / "meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    # The launcher reads APP_VERSION and APP_COMMIT from here (desktop_app/resources.py).
    (STAGE / "build_info.json").write_text(
        json.dumps({"APP_VERSION": meta["version"], "APP_COMMIT": meta["commit"]}, indent=2) + "\n", encoding="utf-8"
    )
    shutil.copyfile(ROOT / "LICENSE", STAGE / "LICENSE")
    (STAGE / "THIRD-PARTY-LICENSES.txt").write_text(third_party_text(name, version), encoding="utf-8")
    return meta


def cmd_bundle(_: argparse.Namespace) -> None:
    if not (FRONTEND / "out" / "index.html").is_file():
        raise SystemExit("src/frontend/out is missing: run `python scripts/build_desktop.py frontend` first.")
    meta = write_stage()
    print(f"Bundling {meta['name']} {meta['version']} ({meta['commit'][:12]}) for {system()}-{machine()}")
    for path in (WORK, DIST):
        if path.exists():
            shutil.rmtree(path)
    env = {**os.environ, "CFA_STAGE": str(STAGE)}
    run(
        [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--distpath", str(DIST),
         "--workpath", str(WORK), str(SPEC)],
        cwd=ROOT,
        env=env,
    )
    write_licences(meta)
    print(f"Bundle: {bundle_dir(meta)}  ({human(tree_size(bundle_dir(meta)))} unpacked)")


# --- pack -------------------------------------------------------------------------------------


def human(size: int) -> str:
    return f"{size / 1024 / 1024:.1f} MiB"


def tree_size(path: Path) -> int:
    if path.is_file():
        return path.stat().st_size
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file() and not f.is_symlink())


def bundle_dir(meta: dict) -> Path:
    return DIST / (f"{meta['name']}.app" if system() == "macos" else meta["slug"])


def archive_stem(meta: dict) -> str:
    return f"{meta['slug']}-{meta['version']}-{system()}-{machine()}"


def add_licenses(target: Path) -> None:
    for name in ("LICENSE", "THIRD-PARTY-LICENSES.txt"):
        shutil.copyfile(STAGE / name, target / name)


def pack_zip(meta: dict, out: Path) -> None:
    folder = bundle_dir(meta)
    add_licenses(folder)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path in sorted(folder.rglob("*")):
            zf.write(path, Path(meta["slug"]) / path.relative_to(folder))


def pack_tar(meta: dict, out: Path) -> None:
    folder = bundle_dir(meta)
    add_licenses(folder)
    with tarfile.open(out, "w:gz", compresslevel=9) as tf:
        tf.add(folder, arcname=meta["slug"])


def pack_dmg(meta: dict, out: Path) -> None:
    app = bundle_dir(meta)
    staging = BUILD / "dmg"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    run(["ditto", str(app), str(staging / app.name)])  # keeps symlinks and the signature
    (staging / "Applications").symlink_to("/Applications")
    add_licenses(staging)
    run(["hdiutil", "create", "-volname", meta["name"], "-srcfolder", str(staging), "-ov", "-format", "UDZO", str(out)])


def cmd_pack(_: argparse.Namespace) -> None:
    meta = json.loads((STAGE / "meta.json").read_text(encoding="utf-8"))
    if not bundle_dir(meta).exists():
        raise SystemExit(f"{bundle_dir(meta)} is missing: run `bundle` first.")
    RELEASE.mkdir(parents=True, exist_ok=True)
    stem = archive_stem(meta)
    unpacked = tree_size(bundle_dir(meta))
    if system() == "windows":
        out = RELEASE / f"{stem}.zip"
        pack_zip(meta, out)
    elif system() == "macos":
        out = RELEASE / f"{stem}.dmg"
        pack_dmg(meta, out)
    else:
        out = RELEASE / f"{stem}.tar.gz"
        pack_tar(meta, out)
    print(f"Archive: {out}")
    print(f"unpacked {human(unpacked)}, packed {human(out.stat().st_size)}")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(f"| {out.name} | {human(unpacked)} | {human(out.stat().st_size)} |\n")


# --- macOS ------------------------------------------------------------------------------------


def minos(path: Path) -> tuple[int, ...] | None:
    """The oldest macOS a Mach-O file runs on (``minos`` of LC_BUILD_VERSION, or the version of
    LC_VERSION_MIN_MACOSX), None for a file that is not a Mach-O."""
    out = subprocess.run(["otool", "-l", str(path)], capture_output=True, text=True)
    if out.returncode != 0:
        return None
    found = re.findall(r"minos (\d+(?:\.\d+)*)|LC_VERSION_MIN_MACOSX\s+cmdsize \d+\s+version (\d+(?:\.\d+)*)", out.stdout)
    versions = [tuple(int(p) for p in (a or b).split(".")) for a, b in found]
    return max(versions) if versions else None


def cmd_verify_macos(_: argparse.Namespace) -> None:
    meta = json.loads((STAGE / "meta.json").read_text(encoding="utf-8"))
    app = bundle_dir(meta)
    limit = tuple(int(p) for p in MACOS_MIN.split("."))
    newest: tuple[tuple[int, ...], Path] = ((0,), app)
    count = 0
    too_new = []
    for path in sorted(app.rglob("*")):
        if path.is_symlink() or not path.is_file() or path.suffix not in {".so", ".dylib", ""}:
            continue
        found = minos(path)
        if found is None:
            continue
        count += 1
        if found > newest[0]:
            newest = (found, path)
        if found > limit:
            too_new.append((found, path))
    print(f"{count} Mach-O files; newest requirement: macOS {'.'.join(map(str, newest[0]))} ({newest[1].name})")
    for found, path in too_new:
        print(f"  needs macOS {'.'.join(map(str, found))}: {path.relative_to(app)}")
    if too_new:
        raise SystemExit(f"The bundle needs a newer macOS than {MACOS_MIN}.")


def cmd_copyleft(_: argparse.Namespace) -> None:
    """Print ``name==version`` of the bundled copyleft packages (for the release job, which
    downloads their sdists and attaches them)."""
    print((STAGE / "copyleft.txt").read_text(encoding="utf-8"), end="")


def cmd_exe(args: argparse.Namespace) -> None:
    """Print the program inside the bundle: on Windows the one with a console unless --windowed
    (it quits on Ctrl+Break, which the CI needs), inside the .app on macOS."""
    meta = json.loads((STAGE / "meta.json").read_text(encoding="utf-8"))
    base = bundle_dir(meta)
    if system() == "windows":
        suffix = "" if args.windowed else "-console"
        path = base / f"{meta['slug']}{suffix}.exe"
    elif system() == "macos":
        path = base / "Contents" / "MacOS" / meta["slug"]
    else:
        path = base / meta["slug"]
    if not path.is_file():
        raise SystemExit(f"{path} is missing: run `bundle` first.")
    print(path)


COMMANDS = {
    "copyleft": cmd_copyleft,
    "exe": cmd_exe,
    "frontend": cmd_frontend,
    "bundle": cmd_bundle,
    "pack": cmd_pack,
    "verify-macos": cmd_verify_macos,
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", nargs="?", default="all", choices=[*COMMANDS, "all"])
    parser.add_argument("--windowed", action="store_true", help="exe: the Windows program without a console")
    args = parser.parse_args()
    if args.command == "all":
        for name in ("frontend", "bundle", "pack"):
            COMMANDS[name](args)
    else:
        COMMANDS[args.command](args)


if __name__ == "__main__":
    main()

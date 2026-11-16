"""The ProM folder of the desktop edition "with ProM" (docs/DESKTOP.md, "The edition with ProM").

``scripts/build_desktop.py prom`` calls :func:`assemble`, which writes ``build/desktop/prom``:

    prom/
      jre/                        Java 8 runtime: Temurin; Zulu on macOS arm64, where Temurin has none
      ProM4Py/                    the ProM4Py bundle (Zenodo 13853660) with the jar signatures removed,
                                  as src/prom4py/Dockerfile does
      lpsolve/                    lp_solve 5.5 and its Java wrapper, for the Hybrid ILP miner (LGPL)
      launcher/prom-launcher.jar  src/desktop/prom/LocalProM.java, compiled for Java 8
      graphviz/                   Windows only: Graphviz (bin/ of graphviz.org's zip) for the
                                  images of the nets, with its licence (EPL-2.0)
      SOURCES.txt                 what each part is, where it comes from, its SHA-256 and licence

``build_desktop.py bundle --with-prom`` puts it next to the program (inside the app on macOS),
where ``desktop_app/prom.py`` starts ProM from it.

Every download is pinned by its SHA-256 and kept in a cache folder, so a second build, or one
whose files were put there by hand, downloads nothing. lp_solve for macOS arm64 is compiled from
its source (SourceForge has no binaries for it). Standard library only; ``javac`` of any JDK 9
or newer compiles the launcher, and on macOS ``cc`` and ``c++`` compile lp_solve.
"""

from __future__ import annotations

import hashlib
import http.client
import os
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import time
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LAUNCHER_SOURCE = ROOT / "src" / "desktop" / "prom" / "LocalProM.java"

#: The oldest macOS the bundle runs on (build_desktop.MACOS_MIN); lp_solve is compiled for it.
MACOS_MIN = "14.0"
#: Downloads per source before the next one is tried.
ATTEMPTS = 3
#: What the folder is made from besides the pinned downloads; a change makes ``build_key`` differ,
#: and build_desktop.py makes the folder anew instead of taking the one that is there.
INPUTS = (Path(__file__).resolve(), LAUNCHER_SOURCE)
#: The file in the folder that holds the key it was made with.
KEY_FILE = ".build-key"


def build_key(system: str, machine: str) -> str:
    """What the folder for ``system``-``machine`` is made from: this script (with its pins) and the
    launcher's source."""
    digest = hashlib.sha256(f"{system}-{machine}\n".encode())
    for path in INPUTS:
        digest.update(path.name.encode() + b"\n" + path.read_bytes().replace(b"\r\n", b"\n"))
    return digest.hexdigest()


def is_current(folder: Path, system: str, machine: str) -> bool:
    """Whether ``folder`` was made by this script, from these inputs, for this system."""
    stamp = folder / KEY_FILE
    return stamp.is_file() and stamp.read_text(encoding="utf-8").strip() == build_key(system, machine)


@dataclass(frozen=True)
class Download:
    name: str
    urls: tuple[str, ...]
    sha256: str
    what: str
    licence: str


SOURCEFORGE = "https://downloads.sourceforge.net/project/lpsolve/lpsolve"
TEMURIN = "https://github.com/adoptium/temurin8-binaries/releases/download/jdk8u512-b09"

PROM4PY = Download(
    "prom4py.zip",
    (
        # The unchanged copy in this repository's release, then Zenodo (src/prom4py/Dockerfile).
        "https://github.com/Magiertx/complexity-factor-analysis/releases/download/prom4py-mirror/prom4py.zip",
        "https://zenodo.org/api/records/13853660/files/prom4py.zip/content",
    ),
    "7f871b1b8583ac2dbd05af789f3287e0158891342090e8f1f0a8f35888e74c20",
    "ProM4Py, Zenodo record 13853660 (https://zenodo.org/records/13853660); the folder ProM4Py/ of prom4py.zip",
    "CC BY 4.0 for the record; the ProM packages in it have their own licences (ProM4Py/LICENSE.txt: "
    "https://promtools.org/prom-6-framework-license/ and https://promtools.org/prom-6-package-license/)",
)
LPSOLVE_JAVA = Download(
    "lp_solve_5.5.2.5_java.zip",
    (f"{SOURCEFORGE}/5.5.2.5/lp_solve_5.5.2.5_java.zip",),
    "0a4dcd21e0c494f51b5de4e5e7bcd608c71bbab957e37ac776cba19808a2d6c9",
    "lp_solve 5.5 Java wrapper (JNI), the same file src/prom4py/Dockerfile uses",
    "LGPL-2.1 (lpsolve/LGPL.txt)",
)

GRAPHVIZ_RELEASE = "https://gitlab.com/api/v4/projects/4207231/packages/generic/graphviz-releases/16.1.1"

#: Graphviz draws the nets of a single run (``dot`` on PATH). Only for Windows: graphviz.org has
#: no portable build for Linux (packages of distributions, linked to their libraries) or macOS
#: (its Darwin zip loads some twenty libraries from /opt/homebrew). There the app uses a ``dot``
#: that is installed (docs/DESKTOP.md).
GRAPHVIZ: dict[tuple[str, str], list[Download]] = {
    ("windows", "x64"): [
        Download(
            "windows_10_cmake_Release_Graphviz-16.1.1-win64.zip",
            (f"{GRAPHVIZ_RELEASE}/windows_10_cmake_Release_Graphviz-16.1.1-win64.zip",),
            "72b1f3a9a1fd3f6e726478c1e044a95483a8fbddec13ba2fb395438d75d001b4",
            "Graphviz 16.1.1, Windows x64 (graphviz.org: GitLab release 16.1.1); its folder bin/. Source: "
            "https://gitlab.com/graphviz/graphviz/-/releases/16.1.1 (graphviz-16.1.1.tar.gz)",
            "EPL-2.0 (graphviz/LICENSE.txt); the libraries in bin/ have their own licences (among them "
            "cairo, pango, glib, fribidi, gts, iconv and intl under the LGPL, and the Microsoft Visual C++ runtime)",
        ),
        Download(
            "graphviz-16.1.1-LICENSE",
            ("https://gitlab.com/graphviz/graphviz/-/raw/16.1.1/LICENSE",),
            "0becf16567beb77fa252b7664631dd177c8f9a1889e48995b45379c7130e5303",
            "the licence of Graphviz 16.1.1 (its repository, tag 16.1.1)",
            "EPL-2.0",
        ),
    ],
}

#: Per system: the Java runtime and lp_solve.
SYSTEMS: dict[tuple[str, str], dict[str, Download]] = {
    ("windows", "x64"): {
        "jre": Download(
            "OpenJDK8U-jre_x64_windows_hotspot_8u512b09.zip",
            (f"{TEMURIN}/OpenJDK8U-jre_x64_windows_hotspot_8u512b09.zip",),
            "ae1ae12f817d7735477c6555107eece73854da0654da69077309ef9bff0b78bf",
            "Eclipse Temurin 8u512-b09 JRE, Windows x64 (Adoptium)",
            "GPL-2.0 with the Classpath Exception (jre/LICENSE, jre/ASSEMBLY_EXCEPTION, jre/THIRD_PARTY_README)",
        ),
        "lpsolve": Download(
            "lp_solve_5.5.2.11_dev_win64.zip",
            (f"{SOURCEFORGE}/5.5.2.11/lp_solve_5.5.2.11_dev_win64.zip",),
            "b45a2e75c5ded1f46cb286c0099a7bafc64eb877b73d46f7b1c7ac278f699977",
            "lp_solve 5.5.2.11, Windows x64 library (lpsolve55.dll)",
            "LGPL-2.1 (lpsolve/LGPL.txt)",
        ),
    },
    ("linux", "x64"): {
        "jre": Download(
            "OpenJDK8U-jre_x64_linux_hotspot_8u512b09.tar.gz",
            (f"{TEMURIN}/OpenJDK8U-jre_x64_linux_hotspot_8u512b09.tar.gz",),
            "57468dc8bfd71dd0578d9717e63a8c13b9efe0a2f2c85c2a13966d1c0f9b1e5f",
            "Eclipse Temurin 8u512-b09 JRE, Linux x64 (Adoptium)",
            "GPL-2.0 with the Classpath Exception (jre/LICENSE, jre/ASSEMBLY_EXCEPTION, jre/THIRD_PARTY_README)",
        ),
        "lpsolve": Download(
            "lp_solve_5.5.2.11_dev_ux64.tar.gz",
            (f"{SOURCEFORGE}/5.5.2.11/lp_solve_5.5.2.11_dev_ux64.tar.gz",),
            "dfac95af169fce53a0d5c55dc3f375947f3be0035e0c915e6a387bbaf4e33f38",
            "lp_solve 5.5.2.11, Linux x64 library (liblpsolve55.so)",
            "LGPL-2.1 (lpsolve/LGPL.txt)",
        ),
    },
    ("macos", "arm64"): {
        "jre": Download(
            "zulu8.98.0.111-ca-jre8.0.512-macosx_aarch64.tar.gz",
            ("https://cdn.azul.com/zulu/bin/zulu8.98.0.111-ca-jre8.0.512-macosx_aarch64.tar.gz",),
            "54758f5d72e8832c4862ec7d9b53be24616048db42ca325cdf7d29a20bb63132",
            "Azul Zulu 8.98.0.111 JRE 8u512, macOS arm64 (Temurin has no Java 8 for Apple silicon)",
            "GPL-2.0 with the Classpath Exception (the licence files in jre/)",
        ),
        "lpsolve": Download(
            "lp_solve_5.5.2.11_source.tar.gz",
            (f"{SOURCEFORGE}/5.5.2.11/lp_solve_5.5.2.11_source.tar.gz",),
            "6d4abff5cc6aaa933ae8e6c17a226df0fc0b671c438f69715d41d09fe81f902f",
            "lp_solve 5.5.2.11 source, compiled here into liblpsolve55.dylib (and the wrapper into liblpsolve55j.dylib)",
            "LGPL-2.1 (lpsolve/LGPL.txt)",
        ),
    },
}


def log(message: str) -> None:
    print(f"[prom] {message}", flush=True)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def fetch(item: Download, cache: Path) -> Path:
    """``item`` in ``cache``, downloaded unless a file with the right SHA-256 is there already."""
    cache.mkdir(parents=True, exist_ok=True)
    target = cache / item.name
    if target.is_file():
        if sha256(target) == item.sha256:
            log(f"{item.name}: in the cache")
            return target
        log(f"{item.name}: the cached file has another SHA-256; downloading it again")
        target.unlink()
    part = target.with_name(target.name + ".part")
    for url in item.urls:
        # A broken connection or a wrong file (a truncated download, an error page of a mirror)
        # is tried again a few times before the next source.
        for attempt in range(1, ATTEMPTS + 1):
            try:
                log(f"{item.name}: downloading {url} (attempt {attempt} of {ATTEMPTS})")
                request = urllib.request.Request(url, headers={"User-Agent": "cfa-desktop-build"})
                with urllib.request.urlopen(request, timeout=120) as response, open(part, "wb") as out:
                    shutil.copyfileobj(response, out, 1 << 20)
            except (OSError, http.client.HTTPException) as exc:
                log(f"{item.name}: {type(exc).__name__}: {exc}")
                part.unlink(missing_ok=True)
                time.sleep(5 * attempt)
                continue
            found = sha256(part)
            if found == item.sha256:
                part.replace(target)
                return target
            log(f"{item.name}: SHA-256 {found} instead of {item.sha256}")
            part.unlink(missing_ok=True)
            time.sleep(5 * attempt)
    raise SystemExit(f"{item.name} could not be downloaded with SHA-256 {item.sha256}.")


# --- extracting ---------------------------------------------------------------------------------


def extract(archive: Path, target: Path) -> None:
    """Unpack a .zip or .tar.gz into ``target``, with the modes and links a JRE needs."""
    target.mkdir(parents=True, exist_ok=True)
    if archive.name.endswith(".zip"):
        with zipfile.ZipFile(archive) as zf:
            for info in zf.infolist():
                path = zf.extract(info, target)  # drops ".." and absolute parts
                mode = info.external_attr >> 16
                if mode and not info.is_dir() and os.name != "nt":
                    os.chmod(path, stat.S_IMODE(mode))
    else:
        with tarfile.open(archive) as tf:
            if hasattr(tarfile, "data_filter"):
                tf.extractall(target, filter="data")
            else:  # Python before 3.11.4
                tf.extractall(target)


def java_home_in(folder: Path) -> Path:
    """The folder of a Java 8 runtime (``bin/java`` and ``lib/rt.jar``) inside ``folder``."""
    exe = "java.exe" if sys.platform == "win32" else "java"
    # Not through a link (Zulu links bin/ at its top to the real runtime inside zulu-8.jre/).
    found = sorted(
        (p.parent.parent for p in folder.rglob(exe)
         if p.parent.name == "bin" and os.path.realpath(p) == str(p.absolute())),
        key=lambda p: len(p.parts),
    )
    for home in found:
        if (home / "lib" / "rt.jar").is_file():
            return home
    raise SystemExit(f"No Java 8 runtime (bin/{exe} and lib/rt.jar) in {folder}.")


#: The signature files that src/prom4py/Dockerfile removes with ``zip -d`` (see there why).
SIGNATURE = re.compile(r"META-INF/.*\.(SF|RSA|DSA|EC)")

#: The folder of classes on ProM's class path (launch.sh), and where the edition keeps it. Up to
#: 173 characters long are the paths of its files below ProM4Py/; unpacked into a user's
#: Downloads folder (``C:\Users\<name>\Downloads\<archive>\<slug>\prom\ProM4Py\``) they would pass
#: Windows' 260 characters for names of eight letters or so, and Explorer could not unpack the zip.
#: Moved up, the longest path below ProM4Py/ has 149 characters. The classes are the same, and
#: ProM loads them from a folder as before; desktop_app/prom.py has the class path.
CLASSES_FROM = Path("Packages/Workshop/Trunk/out/production/prom")
CLASSES_TO = Path("classes")


def unsign_jars(folder: Path) -> int:
    """Remove the signature files from every jar below ``folder``; returns how many had some."""
    changed = 0
    for jar in sorted(folder.rglob("*.jar")):
        with zipfile.ZipFile(jar) as zf:
            infos = zf.infolist()
            if not any(SIGNATURE.fullmatch(i.filename) for i in infos):
                continue
            tmp = jar.with_name(jar.name + ".tmp")
            with zipfile.ZipFile(tmp, "w") as out:
                for info in infos:
                    if not SIGNATURE.fullmatch(info.filename):
                        out.writestr(info, zf.read(info))
        tmp.replace(jar)
        changed += 1
    return changed


# --- the parts ----------------------------------------------------------------------------------


def find_jdk() -> Path:
    """The folder of a JDK 9 or newer (``javac --release 8``, and on macOS the JNI headers in
    ``include/``): JAVA_HOME, the JDKs of the GitHub runners (``JAVA_HOME_<n>_<arch>``, newest
    first), on macOS ``/usr/libexec/java_home``, then the ``javac`` on PATH with its links
    followed. On macOS ``/usr/bin/javac`` is only a stub that hands over to a JDK, so its folder
    has no headers; it is never taken for the JDK itself."""
    exe = "javac.exe" if sys.platform == "win32" else "javac"
    homes: list[Path] = []
    if os.environ.get("JAVA_HOME"):
        homes.append(Path(os.environ["JAVA_HOME"]))
    runners = sorted(
        (k for k in os.environ if re.fullmatch(r"JAVA_HOME_\d+_\w+", k)),
        key=lambda k: int(k.split("_")[2]),
        reverse=True,
    )
    homes += [Path(os.environ[k]) for k in runners]
    if sys.platform == "darwin" and Path("/usr/libexec/java_home").exists():
        out = subprocess.run(["/usr/libexec/java_home", "-v", "9+"], capture_output=True, text=True)
        if out.returncode == 0 and out.stdout.strip():
            homes.append(Path(out.stdout.strip()))
    on_path = shutil.which("javac")
    if on_path and not (sys.platform == "darwin" and Path(on_path).resolve() == Path("/usr/bin/javac")):
        homes.append(Path(os.path.realpath(on_path)).parent.parent)
    for home in homes:
        javac = home / "bin" / exe
        if not javac.is_file():
            continue
        if sys.platform == "darwin" and not (home / "include" / "jni.h").is_file():
            continue
        out = subprocess.run([str(javac), "-version"], capture_output=True, text=True)
        match = re.search(r"javac (\d+)", out.stdout + out.stderr)
        if match and int(match.group(1)) >= 9:
            return home
    raise SystemExit("No JDK 9 or newer found (JAVA_HOME, JAVA_HOME_<n>_<arch>, java_home on macOS, PATH).")


def find_javac() -> Path:
    exe = "javac.exe" if sys.platform == "win32" else "javac"
    return find_jdk() / "bin" / exe


def build_launcher(target: Path, work: Path) -> None:
    """``target/prom-launcher.jar`` from src/desktop/prom/LocalProM.java, for Java 8."""
    javac = find_javac()
    classes = work / "launcher-classes"
    if classes.exists():
        shutil.rmtree(classes)
    classes.mkdir(parents=True)
    subprocess.run(
        [str(javac), "--release", "8", "-Xlint:-options", "-encoding", "UTF-8", "-d", str(classes), str(LAUNCHER_SOURCE)],
        check=True,
    )
    target.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target / "prom-launcher.jar", "w", zipfile.ZIP_DEFLATED) as jar:
        jar.writestr("META-INF/MANIFEST.MF", "Manifest-Version: 1.0\r\nCreated-By: scripts/desktop_prom.py\r\n\r\n")
        for path in sorted(classes.rglob("*.class")):
            jar.write(path, path.relative_to(classes).as_posix())
    log(f"launcher compiled with {javac}")


def build_lpsolve_macos(source_tar: Path, java_zip_dir: Path, target: Path, work: Path) -> None:
    """liblpsolve55.dylib and the JNI wrapper liblpsolve55j.dylib, compiled for arm64 and MACOS_MIN.

    The files ccc.osx compiles, with the defines it uses; the wrapper finds the solver next to it
    (``@loader_path``). JNI headers come from the JDK of ``javac``.
    """
    src = work / "lpsolve-source"
    extract(source_tar, src)
    base = src / "lp_solve_5.5"
    files = (
        "lp_MDO.c shared/commonlib.c shared/mmio.c shared/myblas.c ini.c fortify.c colamd/colamd.c lp_rlp.c "
        "lp_crash.c bfp/bfp_LUSOL/lp_LUSOL.c bfp/bfp_LUSOL/LUSOL/lusol.c lp_Hash.c lp_lib.c lp_wlp.c "
        "lp_matrix.c lp_mipbb.c lp_MPS.c lp_params.c lp_presolve.c lp_price.c lp_pricePSE.c lp_report.c "
        "lp_scale.c lp_simplex.c lp_SOS.c lp_utils.c yacc_read.c"
    ).split()
    includes = [f"-I{base / d}" for d in ("", "shared", "bfp", "bfp/bfp_LUSOL", "bfp/bfp_LUSOL/LUSOL", "colamd")]
    env = {**os.environ, "MACOSX_DEPLOYMENT_TARGET": MACOS_MIN}
    target.mkdir(parents=True, exist_ok=True)
    solver = target / "liblpsolve55.dylib"
    subprocess.run(
        ["cc", "-O3", "-fPIC", "-arch", "arm64", "-dynamiclib", "-install_name", "@rpath/liblpsolve55.dylib",
         "-compatibility_version", "5.5.0", "-current_version", "5.5.0",
         "-DINTEGERTIME", "-DYY_NEVER_INTERACTIVE", "-DPARSER_LP", "-DINVERSE_ACTIVE=INVERSE_LUSOL",
         "-DRoleIsExternalInvEngine", "-Wno-implicit-function-declaration", "-Wno-implicit-int",
         "-Wno-int-conversion", *includes, *(str(base / f) for f in files), "-o", str(solver)],
        check=True, env=env,
    )
    java_home = find_jdk()
    wrapper_src = java_zip_dir / "lp_solve_5.5_java" / "src" / "c"
    subprocess.run(
        ["c++", "-O2", "-fPIC", "-arch", "arm64", "-dynamiclib", "-install_name", "@rpath/liblpsolve55j.dylib",
         f"-I{java_home / 'include'}", f"-I{java_home / 'include' / 'darwin'}", f"-I{wrapper_src}", f"-I{base}",
         str(wrapper_src / "lpsolve5j.cpp"), "-o", str(target / "liblpsolve55j.dylib"),
         f"-L{target}", "-llpsolve55", "-Wl,-rpath,@loader_path"],
        check=True, env=env,
    )


def build_lpsolve(system: str, cache: Path, target: Path, work: Path) -> list[Download]:
    """lp_solve 5.5 and its JNI wrapper into ``target``, with the LGPL; returns the downloads used."""
    lib = SYSTEMS[(system, machine_of(system))]["lpsolve"]
    java_zip = fetch(LPSOLVE_JAVA, cache)
    java_dir = work / "lpsolve-java"
    extract(java_zip, java_dir)
    archive = fetch(lib, cache)
    target.mkdir(parents=True, exist_ok=True)
    wrapper = java_dir / "lp_solve_5.5_java" / "lib"
    if system == "windows":
        unpacked = work / "lpsolve-lib"
        extract(archive, unpacked)
        shutil.copy2(unpacked / "lpsolve55.dll", target / "lpsolve55.dll")
        shutil.copy2(wrapper / "win64" / "lpsolve55j.dll", target / "lpsolve55j.dll")
    elif system == "linux":
        unpacked = work / "lpsolve-lib"
        extract(archive, unpacked)
        shutil.copy2(unpacked / "liblpsolve55.so", target / "liblpsolve55.so")
        shutil.copy2(wrapper / "ux64" / "liblpsolve55j.so", target / "liblpsolve55j.so")
        for name in ("liblpsolve55.so", "liblpsolve55j.so"):
            os.chmod(target / name, 0o755)
    else:
        build_lpsolve_macos(archive, java_dir, target, work)
    shutil.copy2(java_dir / "lp_solve_5.5_java" / "LGPL", target / "LGPL.txt")
    return [LPSOLVE_JAVA, lib]


def machine_of(system: str) -> str:
    return {"windows": "x64", "linux": "x64", "macos": "arm64"}[system]


def sources_text(parts: list[tuple[str, Download]], unsigned: int) -> str:
    lines = [
        "The ProM part of the edition with ProM",
        "=" * 78,
        "",
        "Put together by scripts/build_desktop.py prom (scripts/desktop_prom.py) from the files",
        "below, each checked against its SHA-256. desktop_app/prom.py starts ProM from this folder.",
        "",
    ]
    for folder, item in parts:
        lines += [
            f"{folder}",
            f"  what:     {item.what}",
            f"  file:     {item.name}",
            f"  from:     {item.urls[0]}",
            f"  SHA-256:  {item.sha256}",
            f"  licence:  {item.licence}",
            "",
        ]
    lines += [
        "ProM4Py/",
        f"  The jar signatures (META-INF/*.SF, *.RSA, *.DSA, *.EC) were removed from {unsigned} jars, as",
        "  src/prom4py/Dockerfile does, because two jars ship one package signed and unsigned.",
        f"  The class folder {CLASSES_FROM.as_posix()} was moved to {CLASSES_TO.as_posix()}/",
        "  (shorter paths for Windows). Nothing else was changed; ProM4PY-Python-Library/ of the",
        "  zip is not included.",
        "",
        "launcher/prom-launcher.jar",
        "  Compiled from src/desktop/prom/LocalProM.java of the tool's repository (MIT).",
        "",
    ]
    return "\n".join(lines)


def assemble(system: str, machine: str, build: Path, cache: Path) -> Path:
    """Write ``build/prom`` for ``system``-``machine``; returns it."""
    if (system, machine) not in SYSTEMS:
        raise SystemExit(f"The edition with ProM is not made for {system}-{machine}.")
    out = build / "prom"
    work = build / "prom-work"
    for path in (out, work):
        if path.exists():
            shutil.rmtree(path)
    out.mkdir(parents=True)
    work.mkdir(parents=True)
    pins = SYSTEMS[(system, machine)]

    # Java 8 runtime
    jre_unpacked = work / "jre"
    extract(fetch(pins["jre"], cache), jre_unpacked)
    shutil.copytree(java_home_in(jre_unpacked), out / "jre", symlinks=True)

    # ProM4Py: the folder ProM4Py/ of the zip, as the Docker image has it, without signatures.
    with zipfile.ZipFile(fetch(PROM4PY, cache)) as zf:
        members = [i for i in zf.infolist() if i.filename.startswith("ProM4Py/")]
        if not members:
            raise SystemExit("prom4py.zip has no folder ProM4Py/.")
        for info in members:
            zf.extract(info, out)
    unsigned = unsign_jars(out / "ProM4Py")
    log(f"ProM4Py: signatures removed from {unsigned} jars")
    # The class folder on ProM's class path, moved up (see CLASSES).
    (out / "ProM4Py" / CLASSES_FROM).rename(out / "ProM4Py" / CLASSES_TO)
    for parent in (out / "ProM4Py" / CLASSES_FROM).parents:
        try:
            parent.rmdir()  # out/production and out, if empty now
        except OSError:
            break

    lpsolve = build_lpsolve(system, cache, out / "lpsolve", work)
    build_launcher(out / "launcher", work)

    parts = [("jre/", pins["jre"]), ("ProM4Py/", PROM4PY), ("lpsolve/", lpsolve[1]), ("lpsolve/ (Java wrapper)", lpsolve[0])]
    graphviz = GRAPHVIZ.get((system, machine))
    if graphviz:
        archive, licence = graphviz
        unpacked = work / "graphviz"
        extract(fetch(archive, cache), unpacked)
        bins = [p.parent for p in unpacked.rglob("dot.exe" if system == "windows" else "dot") if p.parent.name == "bin"]
        if not bins:
            raise SystemExit(f"{archive.name} has no bin/dot.")
        shutil.copytree(bins[0], out / "graphviz" / "bin")
        shutil.copy2(fetch(licence, cache), out / "graphviz" / "LICENSE.txt")
        parts += [("graphviz/", archive), ("graphviz/LICENSE.txt", licence)]
    (out / "SOURCES.txt").write_text(sources_text(parts, unsigned), encoding="utf-8")
    (out / KEY_FILE).write_text(build_key(system, machine) + "\n", encoding="utf-8")
    shutil.rmtree(work, ignore_errors=True)
    size = sum(f.stat().st_size for f in out.rglob("*") if f.is_file() and not f.is_symlink())
    log(f"{out}: {size / 1024 / 1024:.1f} MiB")
    return out


if __name__ == "__main__":  # pragma: no cover - build_desktop.py is the entry point
    raise SystemExit("Run `python scripts/build_desktop.py prom`.")

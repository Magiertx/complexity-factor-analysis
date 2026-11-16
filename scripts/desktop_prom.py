"""The ProM folder of the desktop edition "with ProM" (docs/DESKTOP.md, "The edition with ProM").

``scripts/build_desktop.py prom`` calls :func:`assemble`, which writes ``build/desktop/prom``:

    prom/
      jre/                        Java 8 runtime: Temurin; Liberica on macOS arm64, where Temurin has none
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

import base64
import hashlib
import http.client
import json
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
#: What the edition carries, under which licence, and where the source is (copied into prom/).
THIRD_PARTY = ROOT / "src" / "desktop" / "prom" / "THIRD-PARTY.md"

#: The oldest macOS the bundle runs on (build_desktop.MACOS_MIN); lp_solve is compiled for it.
MACOS_MIN = "14.0"
#: Downloads per source before the next one is tried.
ATTEMPTS = 3
#: What the folder is made from besides the pinned downloads; a change makes ``build_key`` differ,
#: and build_desktop.py makes the folder anew instead of taking the one that is there.
INPUTS = (Path(__file__).resolve(), LAUNCHER_SOURCE, THIRD_PARTY)
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
            "Graphviz 16.1.1, Windows x64 (graphviz.org: GitLab release 16.1.1); of its folder bin/ only "
            "what dot needs for PNG (GRAPHVIZ_KEEP). Source: https://gitlab.com/graphviz/graphviz/-/releases/16.1.1",
            "EPL-2.0 (graphviz/LICENSE.txt); the libraries it loads have their own licences "
            "(graphviz/licenses/, THIRD-PARTY.md)",
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

#: The files of Graphviz's bin/ that ``dot -Tpng`` loads with the dot layout and the cairo/pango
#: renderer (the import closure of dot.exe, gvplugin_dot_layout, gvplugin_core and gvplugin_pango,
#: measured with pefile). The rest is left out: other tools and layouts, Tcl, the GD renderer and
#: getopt.dll (LGPL-3.0), gts.dll and ANN.dll, of which getopt's exact source is no longer to be
#: had (its repository is gone). config8 is written anew by ``dot -c``.
GRAPHVIZ_KEEP = (
    "dot.exe cdt.dll cgraph.dll gvc.dll pathplan.dll xdot.dll gvplugin_core.dll gvplugin_dot_layout.dll "
    "gvplugin_pango.dll brotlicommon.dll brotlidec.dll bz2.dll cairo-2.dll ffi-8.dll fontconfig-1.dll "
    "freetype.dll fribidi-0.dll gio-2.0-0.dll glib-2.0-0.dll gmodule-2.0-0.dll gobject-2.0-0.dll harfbuzz.dll "
    "iconv-2.dll intl-8.dll libexpat.dll libpng16.dll pango-1.0-0.dll pangocairo-1.0-0.dll pangoft2-1.0-0.dll "
    "pangowin32-1.0-0.dll pcre2-8.dll pixman-1-0.dll vcruntime140.dll vcruntime140_1.dll zlib1.dll"
).split()

#: Graphviz's Windows libraries were built with vcpkg into graphviz-windows-dependencies, which
#: Graphviz 16.1.1 has as a submodule at this commit; its share/<port>/copyright is each library's
#: licence, its vcpkg.spdx.json names the port version, the upstream source and the patches.
GRAPHVIZ_DEPS = (
    "https://gitlab.com/graphviz/graphviz-windows-dependencies/-/raw/"
    "92e3bb73c8b6532e3f546e3f128cde679e527e67/vcpkg/installed/x64-windows/share"
)
#: port: (version, licence, SHA-256 of share/<port>/copyright) of the libraries in GRAPHVIZ_KEEP.
GRAPHVIZ_DEP_LICENCES = {
    "brotli": ("1.1.0", "MIT", "3d180008e36922a4e8daec11c34c7af264fed5962d07924aea928c38e8663c94"),
    "bzip2": ("1.0.8", "bzip2-1.0.6", "c6dbbf828498be844a89eaa3b84adbab3199e342eb5cb2ed2f0d4ba7ec0f38a3"),
    "cairo": ("1.18.0", "LGPL-2.1 or MPL-1.1", "d4d94ac5251d63fd0c5fadb706899a39ed060f04a55ae2319de04846729a53f0"),
    "expat": ("2.6.2 or 2.5.0", "MIT", "122f2c27000472a201d337b9b31f7eb2b52d091b02857061a8880371612d9534"),
    "fontconfig": ("2.14.2", "MIT-style (HPND)", "51a51aa9823704fd90bccc616cdd17ebabb5b2b3e9cbde886ca02c7002288067"),
    "freetype": ("2.12.1", "FTL", "b73152045aafe7291796bb4bc442c35f4c3c4a8f7985ba13f0a3761945d4ce74"),
    "fribidi": ("1.0.13", "LGPL-2.1-or-later", "32434afcc8666ba060e111d715bfdb6c2d5dd8a35fa4d3ab8ad67d8f850d2f2b"),
    "gettext-libintl": ("0.22.5", "LGPL-2.1-or-later", "3fe5361f24b7c49ba12911c08f5a33f9cb18871d95d9fb881f5b8a4793e04288"),
    "glib": ("2.78.4", "LGPL-2.1-or-later", "fa6f36630bb1e0c571d34b2bbdf188d08495c9dbf58f28cac112f303fc1f58fb"),
    "harfbuzz": ("9.0.0", "MIT", "ba8f810f2455c2f08e2d56bb49b72f37fcf68f1f4fade38977cfd7372050ad64"),
    "libffi": ("3.4.6", "MIT", "67894089811f93fca47a76f85e017da6f8582d4ba0905963c6e0f1ad6df7a195"),
    "libiconv": ("1.17", "LGPL-2.1-or-later (library)", "c8de54a89486d2b719760b66031eae5c0105d37e5c87bc344561fb7e7bd323af"),
    "libpng": ("1.6.43 or 1.6.39", "libpng-2.0", "dfe5a536b0e5a531f844fb9c101a3089aca60772a503893b8e15f9457e369960"),
    "pango": ("1.50.14", "LGPL-2.0-or-later", "d245807f90032872d1438d741ed21e2490e1175dc8aa3afa5ddb6c8e529b58e5"),
    "pcre2": ("10.43", "BSD-3-Clause with the PCRE2 exception", "99272c55f3dcfa07a8a7e15a5c1a33096e4727de74241d65fa049fccfdd59507"),
    "pixman": ("0.43.4", "MIT", "fac9270f0987b96ff4533fca3548c633e02083cbba4a0172a3b149b2e4019793"),
    "zlib": ("1.3.1", "Zlib", "845efc77857d485d91fb3e0b884aaa929368c717ae8186b66fe1ed2495753243"),
}

#: Licence texts for prom/licenses/, from SPDX's licence list (release v3.29.0), by SHA-256:
#: every licence of THIRD-PARTY.md whose text has to go with the program.
SPDX_TEXTS = "https://raw.githubusercontent.com/spdx/license-list-data/v3.29.0/text"
LICENCE_TEXTS = {
    "GPL-2.0-only": "aaf135472f81c5b4a0dca9367e5bb5e9750032b5bebe5442b36e4c0a47430df3",
    "Classpath-exception-2.0": "f36ecd7d28dc3c49854d3908a3824696972aed34f5ffe426174f35fb03c5f194",
    "GPL-3.0-only": "fb981668c18a279e285fc4d83fba1e836cc84dd4daa73c9697d3cfd2d8aca6e0",
    "AGPL-3.0-only": "d8a6cc31abc16b6748c7a21f21611f5a1ec33f67d22ca23d7da1c19b95496bee",
    "LGPL-2.0-only": "86dc99d7e5060915ab1dfc1378b7dd351c62088bfa74067e8aa1868c6fdba7d8",
    "LGPL-2.1-only": "5749785c8bdefafcb5d798270ed0a967036fe2ca63dcedade1627565dfef81d2",
    "LGPL-3.0-only": "996af0513df21f7496288951c41428a03c174e9e4a9d63665c57d670f845ccb1",
    "EPL-1.0": "f3d8dc494be2e7ea9cd31ac2fb902e35dce7ff8181b9b30d05861b47c339cb25",
    "EPL-2.0": "61616a4066701bc7888ad910de1633dbc55eb4d4d30d930feef55afb9492e33c",
    "MPL-1.1": "6214f8b1300bb9f37b16ebc146f8f61af0187e0025042ff95c8b3030744a8795",
    "MPL-2.0": "66a3107d5ad6a058aab753eaac2047ccb2ed0e39465dd0fe5844da3e300d5172",
    "CDDL-1.0": "fde9ef48461569987d09cac803379245dfda04e7751075f39b578a0ce927d470",
    "CDDL-1.1": "b5bbb5ac38b5cb76862a7f410ca567e4b32d7c22f22622ebff10ba434827bb78",
    "CC-BY-4.0": "d557539df68e771cc1eedcc91d13f70fca930e508d11eedcafa4b15db49e3744",
    "Apache-2.0": "074e6e32c86a4c0ef8b3ed25b721ca23aca83df277cd88106ef7177c354615ff",
    "FTL": "ced6622122ce451cb1ea0c3c3f507a640e2a44c075c04900ddd9fae8acb5369f",
}

#: Parts of prom4py.zip's ProM4Py/ that the edition does not carry, with the reason. None of
#: them is on ProM's class path (desktop_app/prom.py, CLASSPATH); all nine miners run without them
#: (docs/DESKTOP.md).
PROM4PY_LEFT_OUT = (
    (r"ProM4Py/OpenXES/", "the build tree of OpenXES (its jars are in ivy/ as well)"),
    (r"ProM4Py/UITopia/", "the build tree of ProM's user interface"),
    (r"ProM4Py/Packages/[^/]+/Trunk/tests/", "test tools of five packages (cobertura and others, GPL among them)"),
    (r"ProM4Py/Packages/ProM-Contexts/Trunk/ivy/gurobi-6\.5\.jar", "the Java API of Gurobi 6.5: proprietary, "
     "not ours to pass on, and of no use without a Gurobi installation"),
    (r"ProM4Py/Packages/ProM-Contexts/Trunk/ivy/oplall-6\.3\.jar", "the Java API of IBM ILOG OPL/CPLEX 6.3: "
     "proprietary, not ours to pass on, and of no use without CPLEX"),
)

#: The source code that GPL, LGPL, AGPL, MPL, CDDL and EPL ask to be offered with the binaries
#: of the edition with ProM (THIRD-PARTY.md, "Source code"); ``build_desktop.py prom-sources``
#: puts it into one archive next to the release.
MAVEN = "https://repo1.maven.org/maven2"


def _maven(group: str, artifact: str, version: str, sha: str, licence: str) -> Download:
    name = f"{artifact}-{version}-sources.jar"
    return Download(name, (f"{MAVEN}/{group.replace('.', '/')}/{artifact}/{version}/{name}",), sha,
                    f"source of {artifact}-{version}.jar in ProM4Py's ivy/ ({group}:{artifact}:{version}, Maven Central)", licence)


SOURCE_ARCHIVES: dict[str, list[Download]] = {
    "jre": [
        Download("OpenJDK8U-jdk-sources_8u512b09.tar.gz", (f"{TEMURIN}/OpenJDK8U-jdk-sources_8u512b09.tar.gz",),
                 "1c5749bc1ac6b6bfd9d9ba0e147e7d674ad2dbdb420153482f5c53a317dfeb2d",
                 "source of Eclipse Temurin 8u512-b09 (the JRE of Windows and Linux)", "GPL-2.0 with the Classpath Exception"),
        Download("bellsoft-jdk8u512+11-src.tar.gz",
                 ("https://github.com/bell-sw/Liberica/releases/download/8u512%2B11/bellsoft-jdk8u512%2B11-src.tar.gz",),
                 "4607cdbc91c6fbf9ea883e9507e0fd4cc71a276bd5cf38d167c8ea9618d5f02d",
                 "source of BellSoft Liberica 8u512+11 (the JRE of macOS)", "GPL-2.0 with the Classpath Exception"),
    ],
    "lp_solve": [
        Download("lp_solve_5.5.2.11_source.tar.gz", (f"{SOURCEFORGE}/5.5.2.11/lp_solve_5.5.2.11_source.tar.gz",),
                 "6d4abff5cc6aaa933ae8e6c17a226df0fc0b671c438f69715d41d09fe81f902f",
                 "source of lp_solve 5.5.2.11 (the solver of every system)", "LGPL-2.1"),
        LPSOLVE_JAVA,  # holds src/c, the source of the JNI wrapper
    ],
    "graphviz": [
        Download("graphviz-16.1.1.tar.xz", (f"{GRAPHVIZ_RELEASE}/graphviz-16.1.1.tar.xz",),
                 "52e7fb9a57b52b5c67f41dba6504ba3231e118258779421cb8f4f99104de71f6", "source of Graphviz 16.1.1", "EPL-2.0"),
        Download("cairo-1.18.0.tar.xz", ("https://cairographics.org/releases/cairo-1.18.0.tar.xz",),
                 "243a0736b978a33dee29f9cca7521733b78a65b5418206fef7bd1c3d4cf10b64", "source of cairo 1.18.0", "LGPL-2.1 or MPL-1.1"),
        Download("pango-1.50.14.tar.xz", ("https://download.gnome.org/sources/pango/1.50/pango-1.50.14.tar.xz",),
                 "1d67f205bfc318c27a29cfdfb6828568df566795df0cb51d2189cde7f2d581e8", "source of Pango 1.50.14", "LGPL-2.0-or-later"),
        Download("glib-2.78.4.tar.xz", ("https://download.gnome.org/sources/glib/2.78/glib-2.78.4.tar.xz",),
                 "24b8e0672dca120cc32d394bccb85844e732e04fe75d18bb0573b2dbc7548f63", "source of GLib 2.78.4", "LGPL-2.1-or-later"),
        Download("fribidi-1.0.13.tar.xz", ("https://github.com/fribidi/fribidi/releases/download/v1.0.13/fribidi-1.0.13.tar.xz",),
                 "7fa16c80c81bd622f7b198d31356da139cc318a63fc7761217af4130903f54a2", "source of FriBidi 1.0.13", "LGPL-2.1-or-later"),
        Download("libiconv-1.17.tar.gz", ("https://ftp.gnu.org/pub/gnu/libiconv/libiconv-1.17.tar.gz",),
                 "8f74213b56238c85a50a5329f77e06198771e70dd9a739779f4c02f65d971313", "source of libiconv 1.17", "LGPL-2.1-or-later"),
        Download("gettext-0.22.5.tar.gz", ("https://ftp.gnu.org/pub/gnu/gettext/gettext-0.22.5.tar.gz",),
                 "ec1705b1e969b83a9f073144ec806151db88127f5e40fe5a94cb6c8fa48996a0", "source of gettext 0.22.5 (libintl)", "LGPL-2.1-or-later"),
    ],
    "jars": [
        _maven("com.itextpdf", "itextpdf", "5.5.11", "3627396aed51dba4aba3c7e8a4afd358c1712f8b68d0f898e6638bd6a67cc2ca", "AGPL-3.0"),
        _maven("org.javassist", "javassist", "3.18.2-GA", "7f17319147ad5e74fdae2ffe98d91be194ab2fac1300893ab0695b1eb7b4c4f6", "MPL-1.1, LGPL-2.1"),
        _maven("org.javassist", "javassist", "3.18.0-GA", "4a1db2c43e2529a6fdf37dc08068b18d6d14677d57208a11dfeff18608dcb2c2", "MPL-1.1, LGPL-2.1"),
        _maven("javax.activation", "javax.activation-api", "1.2.0", "d7411fb29089cafa4b77493f10bfb52832cd1976948903d0b039e12b0bd70334", "CDDL-1.1, GPL-2.0 with the Classpath Exception"),
        _maven("javax.xml.bind", "jaxb-api", "2.4.0-b180830.0359", "80bf9ccae5e202fd898340ba1e8daf061d3e539d21c6dbd238a4cac919b84f15", "CDDL-1.1, GPL-2.0 with the Classpath Exception"),
        _maven("com.github.fracpete", "jclipboardhelper", "0.1.0", "16617399fb8675e2a70a794e4afe96462a7efe72586138b3f0240410b725ae0d", "GPL-3.0"),
        _maven("org.jfree", "jcommon", "1.0.24", "0189824f4e09685a98101f0388ccc1b789cf421ce301a80da50ae992cc232707", "LGPL-2.1"),
        _maven("com.github.fracpete", "jfilechooser-bookmarks", "0.1.6", "f22022e131fb66d703ad2fbf7e062e4850c951227460d2ee2fe021ae7cf74a5c", "GPL-3.0"),
        _maven("org.jfree", "jfreechart", "1.0.19", "bf9fe6691df030c1de851b9f16eb9feb8124c004c0e7931a0eaf2fd1c7c9719d", "LGPL-2.1"),
        _maven("com.github.fommil", "jniloader", "1.1", "f31f1d3d257c1c298bff289424283bb881ba372e451745d828c04d02df091cf2", "LGPL (no version stated)"),
        _maven("junit", "junit", "4.12", "9f43fea92033ad82bcad2ae44cec5c82abc9d6ee4b095cab921d11ead98bf2ff", "EPL-1.0"),
        _maven("com.googlecode.juniversalchardet", "juniversalchardet", "1.0.3", "3d1cb067f5cfe3cc19b77c837156f22368462af9acac5dd878e785966758fc27", "MPL-1.1"),
        _maven("com.googlecode.matrix-toolkits-java", "mtj", "1.0.4", "b98ddcdc67cdd3de751dabb31661f4c1adf6a97d52a2b9d447425362a5d791ac", "LGPL (no version stated)"),
        _maven("nz.ac.waikato.cms.weka", "optics_dbScan", "1.0.4", "56aa3377ce44aa7679c05cbbe6037df1cddadaa6727eef6122042a6fd04c74b1", "GPL-3.0"),
        _maven("nz.ac.waikato.cms.weka", "simpleEducationalLearningSchemes", "1.0.2", "3c967533ab295b2a8aa64aed545eba811d0b76566c5e279a511d8a98bf71f605", "GPL-3.0"),
        _maven("nz.ac.waikato.cms.weka", "weka-stable", "3.8.0", "c16c8809c205216caba06887af9bfa2319dc6e894017f8b5533ea0b024ef19c6", "GPL-3.0"),
        _maven("org.mozilla", "rhino", "1.7.7", "12f043ce0915f59389935c4e85f8f19053f8462c1b475457cabb6e5a0a835181", "MPL-2.0"),
        _maven("org.freehep", "freehep-io", "2.2.2", "23a51bf34d0ac7175fc8a84e99609f8b7547786e6bc2c28cb40ea61961879f42", "LGPL-2.1 (as FreeHEP states; its pom says Apache-2.0)"),
        _maven("net.sf.trove4j", "trove4j", "3.0.3", "3bf9df54516959c0683dca31f0f39e566d43af86879b8c2e2f8e2b6012bdc93c", "LGPL-2.1"),
        _maven("com.toedter", "jcalendar", "1.4", "a4f18929f8c8f6e49e60cfb70dca8490faf8f7f94d35f6f60116620436d811a9", "LGPL (no version stated)"),
    ],
}

#: vcpkg port folders (portfile and patches) of Graphviz's LGPL libraries at the port versions of
#: its Windows build, by git tree of microsoft/vcpkg; each file is checked against its git blob
#: hash. With the upstream archive above, a port folder is that library's complete source.
VCPKG_PORTS = {
    "cairo": ("1.18.0#1", "0fda02793cfc3911468cd200b0a889c65035db1d"),
    "pango": ("1.50.14#4", "e2a88ce998fab5ed3f3a2edf817f32734c78187b"),
    "glib": ("2.78.4#3", "ca77eedd8dca92c9e6c021316e81b9c7f648b58a"),
    "fribidi": ("1.0.13", "a946b16fa88c02cd11e2e3011fe9ca61e31214b6"),
    "libiconv": ("1.17#3", "0d6e7ebdbfeca59f047e66f632d1d38c2659fc14"),
    "gettext-libintl": ("0.22.5#1", "ac89519d5ec11430978a4e45619befb7a1c4a062"),
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
        # Temurin has no Java 8 for Apple silicon. BellSoft publishes the source of each Liberica
        # release next to it (the GPL's source offer can be met); for Azul Zulu no source archive
        # of 8.98.0.111 was found (Azul's metadata API lists none).
        "jre": Download(
            "bellsoft-jre8u512+11-macos-aarch64.tar.gz",
            ("https://github.com/bell-sw/Liberica/releases/download/8u512%2B11/bellsoft-jre8u512%2B11-macos-aarch64.tar.gz",),
            "29432a9bcd082f3e5a82710d395e18489c192884989440151d5d89fe84e37c6a",
            "BellSoft Liberica JRE 8u512+11, macOS arm64",
            "GPL-2.0 with the Classpath Exception (jre/LICENSE, jre/ASSEMBLY_EXCEPTION, jre/THIRD_PARTY_README)",
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
    # Not through a link (some archives link bin/ at their top to the runtime inside *.jre/).
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


def _jdk_candidates() -> list[tuple[Path, Path | None]]:
    """``(javac, JDK folder or None)`` in the order tried: JAVA_HOME, the JDKs of the GitHub
    runners (``JAVA_HOME_<n>_<arch>``, newest first), on macOS ``/usr/libexec/java_home``, then
    the ``javac`` on PATH. That last one can be a link (Oracle's ``javapath`` on Windows) whose
    folder is no JDK, so it has no folder here; ``/usr/bin/javac`` of macOS is only a stub that
    hands over to a JDK, and is left out."""
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
    candidates: list[tuple[Path, Path | None]] = [(home / "bin" / exe, home) for home in homes]
    on_path = shutil.which("javac")
    if on_path and not (sys.platform == "darwin" and Path(on_path).resolve() == Path("/usr/bin/javac")):
        candidates.append((Path(on_path), None))
    return candidates


def _javac_version(javac: Path) -> int:
    if not javac.is_file():
        return 0
    out = subprocess.run([str(javac), "-version"], capture_output=True, text=True)
    match = re.search(r"javac (\d+)", out.stdout + out.stderr)
    return int(match.group(1)) if match else 0


def find_javac() -> Path:
    """``javac`` of a JDK 9 or newer, for ``--release 8``."""
    for javac, _ in _jdk_candidates():
        if _javac_version(javac) >= 9:
            return javac
    raise SystemExit("No javac of a JDK 9 or newer found (JAVA_HOME, JAVA_HOME_<n>_<arch>, java_home on macOS, PATH).")


def find_jdk() -> Path:
    """The folder of a JDK 9 or newer with the JNI headers (``include/jni.h``), for lp_solve's
    wrapper on macOS."""
    for javac, home in _jdk_candidates():
        if home is not None and (home / "include" / "jni.h").is_file() and _javac_version(javac) >= 9:
            return home
    raise SystemExit("No JDK 9 or newer with include/jni.h found (JAVA_HOME, JAVA_HOME_<n>_<arch>, java_home on macOS).")


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
        "  (shorter paths for Windows). ProM4PY-Python-Library/ of the zip is not included, and",
        "  neither are (none of them on ProM's class path):",
        *(f"    {pattern.replace(chr(92), '')}  {why}" for pattern, why in PROM4PY_LEFT_OUT),
        "  Nothing else was changed.",
        "",
        "THIRD-PARTY.md names every part, its licence and where its source code is; licenses/ has the",
        "licence texts, licenses/class-path-jars.tsv what each jar on ProM's class path says of its licence.",
        "",
        "launcher/prom-launcher.jar",
        "  Compiled from src/desktop/prom/LocalProM.java of the tool's repository (MIT).",
        "",
    ]
    return "\n".join(lines)


def place_graphviz(bin_dir: Path, target: Path, cache: Path) -> None:
    """``target/bin`` with only GRAPHVIZ_KEEP, a config8 written by ``dot -c`` for what is there,
    ``target/licenses`` with the licence of every library in it, and a check that dot draws a PNG."""
    out_bin = target / "bin"
    out_bin.mkdir(parents=True)
    for name in GRAPHVIZ_KEEP:
        if not (bin_dir / name).is_file():
            raise SystemExit(f"Graphviz has no bin/{name}: GRAPHVIZ_KEEP is out of date.")
        shutil.copy2(bin_dir / name, out_bin / name)
    dot = out_bin / "dot.exe"
    subprocess.run([str(dot), "-c"], check=True, cwd=out_bin)
    png = subprocess.run([str(dot), "-Tpng"], input=b"digraph { a -> b }", capture_output=True, cwd=out_bin)
    if png.returncode != 0 or not png.stdout.startswith(b"\x89PNG"):
        raise SystemExit(f"dot -Tpng does not work with GRAPHVIZ_KEEP: {png.stderr.decode(errors='replace')[:400]}")
    licences = target / "licenses"
    licences.mkdir()
    for port, (_, _, sha) in GRAPHVIZ_DEP_LICENCES.items():
        item = Download(f"graphviz-dep-{port}-copyright.txt", (f"{GRAPHVIZ_DEPS}/{port}/copyright",), sha, "", "")
        shutil.copy2(fetch(item, cache), licences / f"{port}.txt")
    log(f"Graphviz: {len(GRAPHVIZ_KEEP)} files of bin/, dot -Tpng works")


#: A licence named in a jar (manifest, pom or licence file), as a short name.
JAR_LICENCE_PATTERNS = (
    ("AGPL", r"affero"),
    ("LGPL", r"lesser general public|library general public|\blgpl"),
    ("GPL", r"(?<!lesser )(?<!library )gnu general public license|\bgpl-?[23]?\b|gplv[23]"),
    ("EPL", r"eclipse public license|\bepl-?[12]"),
    ("EDL", r"eclipse distribution license|edl-v10"),
    ("CDDL", r"\bcddl\b|common development and distribution"),
    ("MPL", r"mozilla public license|\bmpl\b"),
    ("Apache", r"apache license|apache-2|apache software license"),
    ("BSD", r"\bbsd\b|redistributions of source code must retain"),
    ("MIT", r"\bmit license\b|permission is hereby granted, free of charge"),
)


def jar_inventory(folder: Path) -> str:
    """One line per jar on ProM's class path: what the jar itself says of its licence (manifest
    Bundle-License, a pom's <licenses>, licence files), and its Maven coordinates if it has a pom.
    "none" where the jar says nothing; THIRD-PARTY.md has what is known beyond that."""
    lines = ["jar\tlicences named in the jar\twhere\tmaven"]
    for jar in sorted(folder.glob("*.jar")):
        found: list[str] = []
        where: list[str] = []
        gav = ""
        with zipfile.ZipFile(jar) as zf:
            names = zf.namelist()
            texts = []
            if "META-INF/MANIFEST.MF" in names:
                m = re.search(r"^Bundle-License:\s*(.+(?:\r?\n .+)*)", zf.read("META-INF/MANIFEST.MF").decode("utf-8", "replace"), re.M)
                if m:
                    texts.append(m.group(1)); where.append("manifest")
            poms = sorted(n for n in names if n.startswith("META-INF/maven/") and n.endswith("pom.xml"))
            stem = jar.stem.lower()
            pom = next((p for p in poms if p.split("/")[-2].lower() in stem), poms[0] if poms else None)
            if pom:
                text = zf.read(pom).decode("utf-8", "replace")
                # Group and artifact from the path META-INF/maven/<group>/<artifact>/pom.xml, the
                # version from pom.properties next to it (the pom also names plugins and parents).
                group, artifact = pom.split("/")[2:4]
                props = pom[: -len("pom.xml")] + "pom.properties"
                version = ""
                if props in names:
                    m = re.search(r"^version=(.+)$", zf.read(props).decode("utf-8", "replace"), re.M)
                    version = m.group(1).strip() if m else ""
                gav = ":".join(x for x in (group, artifact, version) if x)
                m = re.search(r"<licenses>(.*?)</licenses>", text, re.S)
                if m:
                    texts.append(m.group(1)); where.append("pom")
            for n in names:
                if re.match(r"(META-INF/)?(LICEN[CS]E|COPYING)[^/]*$", n, re.I):
                    texts.append(zf.read(n).decode("utf-8", "replace")[:6000]); where.append(n)
        blob = " ".join(texts).lower()
        found = [name for name, pattern in JAR_LICENCE_PATTERNS if re.search(pattern, blob)]
        lines.append(f"{jar.name}\t{', '.join(found) or 'none'}\t{', '.join(where) or '-'}\t{gav or '-'}")
    return "\n".join(lines) + "\n"


def place_licences(out: Path, cache: Path) -> None:
    """prom/licenses/ (the licence texts of LICENCE_TEXTS and the jar inventory) and THIRD-PARTY.md."""
    licences = out / "licenses"
    licences.mkdir(exist_ok=True)
    for spdx, sha in LICENCE_TEXTS.items():
        item = Download(f"spdx-{spdx}.txt", (f"{SPDX_TEXTS}/{spdx}.txt",), sha, "", "")
        shutil.copy2(fetch(item, cache), licences / f"{spdx}.txt")
    ivy = out / "ProM4Py" / "Packages" / "ProM-Contexts" / "Trunk" / "ivy"
    (licences / "class-path-jars.tsv").write_text(jar_inventory(ivy), encoding="utf-8")
    shutil.copy2(THIRD_PARTY, out / "THIRD-PARTY.md")


def _git_blob_sha(data: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def _github_api(path: str) -> dict:
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "cfa-desktop-build"}
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    for attempt in range(1, ATTEMPTS + 1):
        try:
            with urllib.request.urlopen(urllib.request.Request(f"https://api.github.com/{path}", headers=headers), timeout=60) as r:
                return json.loads(r.read())
        except (OSError, http.client.HTTPException) as exc:
            log(f"GitHub API {path}: {exc} (attempt {attempt})")
            time.sleep(5 * attempt)
    raise SystemExit(f"GitHub API {path} did not answer.")


def vcpkg_port(port: str, tree: str, target: Path) -> None:
    """The files of microsoft/vcpkg's git tree ``tree`` into ``target``, each checked by its git hash."""
    target.mkdir(parents=True, exist_ok=True)
    for entry in _github_api(f"repos/microsoft/vcpkg/git/trees/{tree}")["tree"]:
        if entry["type"] != "blob":
            raise SystemExit(f"vcpkg port {port}: {entry['path']} is not a file.")
        data = base64.b64decode(_github_api(f"repos/microsoft/vcpkg/git/blobs/{entry['sha']}")["content"])
        if _git_blob_sha(data) != entry["sha"]:
            raise SystemExit(f"vcpkg port {port}: {entry['path']} does not match its git hash.")
        (target / entry["path"]).write_bytes(data)


def assemble_sources(build: Path, cache: Path, archive: Path) -> Path:
    """The source code to offer with the edition with ProM (SOURCE_ARCHIVES, VCPKG_PORTS, the
    SBOMs and licences of Graphviz's libraries, THIRD-PARTY.md) as one zip, ``archive``."""
    folder = build / "prom-sources"
    if folder.exists():
        shutil.rmtree(folder)
    lines = [
        "Source code of the third-party parts of the edition with ProM",
        "=" * 78,
        "",
        "THIRD-PARTY.md (in this archive and in the program's prom/ folder) says which part needs which.",
        "Every file below was checked against its SHA-256 (git hash for the vcpkg port files).",
        "",
    ]
    for group, items in SOURCE_ARCHIVES.items():
        (folder / group).mkdir(parents=True)
        for item in items:
            shutil.copy2(fetch(item, cache), folder / group / item.name)
            lines += [f"{group}/{item.name}", f"  {item.what}", f"  from {item.urls[0]}", f"  SHA-256 {item.sha256}; licence {item.licence}", ""]
    for port, (version, tree) in VCPKG_PORTS.items():
        target = folder / "graphviz" / "vcpkg-ports" / port
        vcpkg_port(port, tree, target)
        sbom = Download(f"graphviz-dep-{port}-sbom.json", (f"{GRAPHVIZ_DEPS}/{port}/vcpkg.spdx.json",), GRAPHVIZ_SBOMS[port], "", "")
        shutil.copy2(fetch(sbom, cache), target / "graphviz-build.vcpkg.spdx.json")
        lines += [f"graphviz/vcpkg-ports/{port}/",
                  f"  vcpkg port {port} {version} (git tree {tree} of https://github.com/microsoft/vcpkg): the",
                  "  portfile and patches with which Graphviz's Windows build made the library from the archive above,",
                  "  and the SBOM of that build (graphviz-windows-dependencies 92e3bb7)", ""]
    shutil.copy2(THIRD_PARTY, folder / "THIRD-PARTY.md")
    (folder / "README.txt").write_text("\n".join(lines), encoding="utf-8")
    archive.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_STORED) as zf:  # the archives inside are compressed
        for path in sorted(folder.rglob("*")):
            zf.write(path, path.relative_to(folder).as_posix())
    log(f"{archive}: {archive.stat().st_size / 1024 / 1024:.1f} MiB")
    return archive


#: SHA-256 of the SBOMs (vcpkg.spdx.json) of VCPKG_PORTS in graphviz-windows-dependencies.
GRAPHVIZ_SBOMS = {
    "cairo": "63cbfcba9b298005a7b2981293a632eb16fb4ed9b8e3bd13b179f0113fa69593",
    "pango": "8bcbdd01e08ec31690f7f358c548af4c436432dd9705c6d6016a672aac165926",
    "glib": "578f76c81a279ea2cb5ee621d7a2ae096a6765a0c6c26a20e20ff69a532a2e68",
    "fribidi": "0c712bb40dc022e851a81a58ac5a59ae6884b6150771947f9f4a9146947d713e",
    "libiconv": "f60dc2a6d277a200b9582669b0c49a917a8f0470601ae3a7f70e905b521e1963",
    "gettext-libintl": "4a853422dc27d75015a1af3b38c0599ca7b0747439140160b4ce1cfc8ca65649",
}


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

    # ProM4Py: the folder ProM4Py/ of the zip, without signatures and without PROM4PY_LEFT_OUT.
    left_out = [re.compile(pattern) for pattern, _ in PROM4PY_LEFT_OUT]
    with zipfile.ZipFile(fetch(PROM4PY, cache)) as zf:
        members = [i for i in zf.infolist() if i.filename.startswith("ProM4Py/")]
        if not members:
            raise SystemExit("prom4py.zip has no folder ProM4Py/.")
        kept = [i for i in members if not any(p.match(i.filename) for p in left_out)]
        for pattern in left_out:
            if not any(pattern.match(i.filename) for i in members):
                raise SystemExit(f"prom4py.zip has nothing that matches {pattern.pattern}: PROM4PY_LEFT_OUT is out of date.")
        for info in kept:
            zf.extract(info, out)
    log(f"ProM4Py: {len(members) - len(kept)} of {len(members)} entries left out (PROM4PY_LEFT_OUT)")
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
        place_graphviz(bins[0], out / "graphviz", cache)
        shutil.copy2(fetch(licence, cache), out / "graphviz" / "LICENSE.txt")
        parts += [("graphviz/", archive), ("graphviz/LICENSE.txt", licence)]
    place_licences(out, cache)
    (out / "SOURCES.txt").write_text(sources_text(parts, unsigned), encoding="utf-8")
    (out / KEY_FILE).write_text(build_key(system, machine) + "\n", encoding="utf-8")
    shutil.rmtree(work, ignore_errors=True)
    size = sum(f.stat().st_size for f in out.rglob("*") if f.is_file() and not f.is_symlink())
    log(f"{out}: {size / 1024 / 1024:.1f} MiB")
    return out


if __name__ == "__main__":  # pragma: no cover - build_desktop.py is the entry point
    raise SystemExit("Run `python scripts/build_desktop.py prom`.")

# Third-party software in the folder `prom` (edition with ProM)

The edition with ProM carries, next to the program (inside the app on macOS), a folder `prom` of
separate programs that the app starts as its own process and does not link with: a Java 8
runtime, ProM4Py with the ProM framework, ProM packages and their libraries, lp_solve, and on
Windows Graphviz. This file lists every part with its licence, what that licence asks of a
distribution like this one, and how that is done here. The program itself (MIT) and its Python
and npm packages are in `THIRD-PARTY-LICENSES.txt` next to the program.

- Licence texts: `prom/licenses/` (SPDX licence list 3.29.0), plus the ones each part brings
  (`jre/LICENSE`, `lpsolve/LGPL.txt`, `graphviz/LICENSE.txt`, `graphviz/licenses/`, the licence
  files inside the jars).
- Where each file came from, with its SHA-256: `prom/SOURCES.txt`.
- What each jar on ProM's class path says of its own licence: `prom/licenses/class-path-jars.tsv`.
- Source code: `<name>-<version>-with-prom-sources.zip` next to the archives of the edition with
  ProM in the release (see "Source code" below).

## Attribution: ProM4Py (CC BY 4.0)

> ProM4Py, from "Resources for ProM4Py's ICPM demo submission" by Eduardo Goulart Rocha,
> https://doi.org/10.5281/zenodo.13853660, licensed under CC BY 4.0
> (https://creativecommons.org/licenses/by/4.0/). Changed: the folder `ProM4Py/` only; jar
> signatures removed from 7 jars; the class folder `Packages/Workshop/Trunk/out/production/prom`
> moved to `classes/`; `OpenXES/`, `UITopia/`, `Packages/*/Trunk/tests/`, `gurobi-6.5.jar` and
> `oplall-6.3.jar` left out (see `prom/SOURCES.txt`).

CC BY 4.0 covers the record as a whole. The software in it keeps its own licences, below.

## The parts

| Part | Version | Licence | What the licence asks | How it is met |
|---|---|---|---|---|
| Java runtime, Windows and Linux: Eclipse Temurin JRE | 8u512-b09 | GPL-2.0 with the Classpath Exception | licence with the binaries; source code with them or from the same place | `jre/LICENSE`, `ASSEMBLY_EXCEPTION`, `THIRD_PARTY_README`; source in the sources archive (`jre/OpenJDK8U-jdk-sources_8u512b09.tar.gz`) |
| Java runtime, macOS arm64: BellSoft Liberica JRE | 8u512+11 | GPL-2.0 with the Classpath Exception | as above | as above; source `jre/bellsoft-jdk8u512+11-src.tar.gz` |
| ProM4Py (Zenodo 13853660) | 2024-09-28 | CC BY 4.0 | credit, licence link, changes marked | "Attribution" above, also in `THIRD-PARTY-LICENSES.txt`, docs/DESKTOP.md and the release text |
| ProM 6 framework (`ProM-Framework`, `ProM-Contexts`, `ProM-Models`, `ProM-Plugins` jars, `ProM4Py/classes/`) | as in ProM4Py | GPL-2.0-or-later (promtools.org, "ProM 6 framework license") | licence; source code | `licenses/GPL-2.0-only.txt`; the sources of ProM-Framework, ProM-Contexts, PetriNets, AcceptingPetriNet, LogAlignment and Workshop are in `ProM4Py/Packages/*/Trunk/src/`. **Open:** the exact sources of the `*-latest.jar` builds (see "Not settled") |
| ProM packages (the `*-latest.jar`, `*-unknown.jar` of ProM's repository, e.g. AlphaMiner, InductiveMiner, HeuristicsMiner, HybridILPMiner, LpSolve) | as in ProM4Py | each its own (promtools.org: "may have a license that is different"); ProM4Py does not record them | depends on the package | **Open**, see "Not settled" |
| Libraries on ProM's class path with a copyleft licence | see the table below | GPL-3.0, AGPL-3.0, LGPL-2.1, LGPL-3.0, MPL-1.1, MPL-2.0, CDDL-1.1, EPL-1.0 | licence; source code (GPL, LGPL, AGPL); source available (MPL, CDDL, EPL) | texts in `licenses/`; sources in the sources archive (`jars/`) where named below |
| Other libraries on ProM's class path | various | Apache-2.0, BSD, MIT, EDL and others, as `licenses/class-path-jars.tsv` says | licence and notices with the binaries | the jars are passed on unchanged with the licence and notice files they contain; `licenses/Apache-2.0.txt` |
| lp_solve and its Java wrapper | 5.5.2.11 (solver), 5.5.2.5 (wrapper source) | LGPL-2.1 | licence; source code of the library | `lpsolve/LGPL.txt`; source `lp_solve/lp_solve_5.5.2.11_source.tar.gz` and `lp_solve/lp_solve_5.5.2.5_java.zip` (its `src/c` is the wrapper). On macOS the build compiles both from these files (scripts/desktop_prom.py) |
| Graphviz (Windows) | 16.1.1 | EPL-2.0 | licence; tell where the source is | `graphviz/LICENSE.txt`; https://gitlab.com/graphviz/graphviz/-/releases/16.1.1, and `graphviz/graphviz-16.1.1.tar.xz` in the sources archive |
| Graphviz's libraries (Windows), only those `dot -Tpng` loads | see below | see below | see below | see below |
| Microsoft Visual C++ runtime (`vcruntime140.dll`, `vcruntime140_1.dll` in `graphviz/bin`) | 14.44.35211 | Microsoft's redistribution terms for the Visual C++ runtime | passed on unchanged with a program that needs it | as built by Graphviz, unchanged |
| Launcher `launcher/prom-launcher.jar` | this release | MIT (the tool's) | | `LICENSE` of the program |

Left out of ProM4Py, none of them on ProM's class path: `OpenXES/`, `UITopia/` (build trees),
`Packages/*/Trunk/tests/` (test tools, cobertura under the GPL among them), and the jars
`gurobi-6.5.jar` (Java API of Gurobi Optimization) and `oplall-6.3.jar` (Java API of IBM ILOG
OPL/CPLEX): both are proprietary and not ours to pass on, and of no use without those solvers.
All nine miners run without them.

### Libraries on ProM's class path with a copyleft licence

From the jars' own manifests, poms and licence files (`licenses/class-path-jars.tsv`).

| Jar | Licence | Source code |
|---|---|---|
| `itextpdf-5.5.11.jar` | AGPL-3.0 | `jars/itextpdf-5.5.11-sources.jar` |
| `weka-stable-3.8.0.jar` | GPL-3.0 | `jars/weka-stable-3.8.0-sources.jar` |
| `optics_dbScan-1.0.4.jar`, `simpleEducationalLearningSchemes-1.0.2.jar` (Weka packages) | GPL-3.0 | `jars/…-sources.jar` |
| `jclipboardhelper-0.1.0.jar`, `jfilechooser-bookmarks-0.1.6.jar` | GPL-3.0 | `jars/…-sources.jar` |
| `jfreechart-1.0.19.jar`, `jcommon-1.0.24.jar` | LGPL-2.1 | `jars/…-sources.jar` |
| `trove4j-3.0.3.jar` (no licence in the jar; LGPL-2.1 in its Maven pom) | LGPL-2.1 | `jars/trove4j-3.0.3-sources.jar` |
| `jcalendar-1.4.jar` (no licence in the jar; its Maven pom says LGPL without a version) | LGPL | `jars/jcalendar-1.4-sources.jar` |
| `freehep-io-2.2.2.jar` (licence file LGPL, pom Apache-2.0) | LGPL-2.1 | `jars/freehep-io-2.2.2-sources.jar` |
| `mtj-1.0.4.jar`, `jniloader-1.1.jar` (the poms say LGPL without a version and link the current text, 3.0) | LGPL | `jars/…-sources.jar` |
| `javassist-3.18.2-GA.jar`, `javassist-unknown.jar` (3.18.0-GA) | MPL-1.1 or LGPL-2.1 | `jars/javassist-3.18.2-GA-sources.jar`, `jars/javassist-3.18.0-GA-sources.jar` |
| `juniversalchardet-1.0.3.jar` | MPL-1.1 | `jars/juniversalchardet-1.0.3-sources.jar` |
| `rhino-1.7.7.jar` | MPL-2.0 | `jars/rhino-1.7.7-sources.jar` |
| `javax.activation-api-1.2.0.jar`, `jaxb-api-2.4.0-b180830.0359.jar` | CDDL-1.1 or GPL-2.0 with the Classpath Exception | `jars/…-sources.jar` |
| `junit-4.12.jar` | EPL-1.0 | `jars/junit-4.12-sources.jar` |
| `mtj-1.0.7.jar` | LGPL-3.0 | **open**: Maven Central has no sources jar of 1.0.7 |
| `RTED-1.0.jar` (tree edit distance) | AGPL-3.0 | **open**: no published source archive of this build found |
| `japura-1.12.3.jar`, `pnapi-java-1.0.5.jar`, `ujmp-complete-0.2.5.jar`, `uma-1.3.2.jar` | LGPL or GPL named in the jar | **open**: not on Maven Central; version and exact licence to be checked |

`jakarta.*`, `jaxb-runtime`, `txw2` and `istack-commons-runtime` are under the Eclipse
Distribution License 1.0 (BSD-3-Clause); `java-cup` under its own permissive licence;
netlib-java (`core-1.1.2.jar`) under BSD-3-Clause (its parent pom).

### Graphviz's libraries (Windows)

Graphviz 16.1.1 built them with vcpkg into graphviz-windows-dependencies (commit 92e3bb7). Only
the files that `dot -Tpng` loads are carried (`dot.exe`, Graphviz's own libraries, the plugins
core, dot layout and pango). Each library's licence is in `graphviz/licenses/<port>.txt`.

| Library | Version | Licence | Source code |
|---|---|---|---|
| cairo | 1.18.0 | LGPL-2.1 or MPL-1.1 | `graphviz/cairo-1.18.0.tar.xz` and `graphviz/vcpkg-ports/cairo/` (the vcpkg port 1.18.0#1 with its patches) |
| Pango | 1.50.14 | LGPL-2.0-or-later | `graphviz/pango-1.50.14.tar.xz`, `graphviz/vcpkg-ports/pango/` |
| GLib (glib, gobject, gio, gmodule) | 2.78.4 | LGPL-2.1-or-later | `graphviz/glib-2.78.4.tar.xz`, `graphviz/vcpkg-ports/glib/` |
| FriBidi | 1.0.13 | LGPL-2.1-or-later | `graphviz/fribidi-1.0.13.tar.xz`, `graphviz/vcpkg-ports/fribidi/` |
| libiconv | 1.17 | LGPL-2.1-or-later | `graphviz/libiconv-1.17.tar.gz`, `graphviz/vcpkg-ports/libiconv/` |
| libintl (gettext) | 0.22.5 | LGPL-2.1-or-later | `graphviz/gettext-0.22.5.tar.gz`, `graphviz/vcpkg-ports/gettext-libintl/` |
| FreeType | 2.12.1 | FTL | Portions of this software are copyright © 2022 The FreeType Project (www.freetype.org). All rights reserved. |
| HarfBuzz, pixman, libffi, Expat, Brotli | 9.0.0, 0.43.4, 3.4.6, 2.6.2 or 2.5.0, 1.1.0 | MIT | – |
| fontconfig | 2.14.2 | MIT-style | – |
| libpng | 1.6.43 or 1.6.39 | libpng-2.0 | – |
| zlib | 1.3.1 | Zlib | – |
| bzip2 | 1.0.8 | bzip2-1.0.6 | – |
| PCRE2 | 10.43 | BSD-3-Clause with the PCRE2 exception | – |

Two vcpkg ports were installed in two versions in graphviz-windows-dependencies (Expat, libpng);
which one the DLL is, is not recorded in the DLL. Both are permissively licensed.

## Source code

The GPL, LGPL and AGPL ask that the complete source code goes with the binaries or is offered
from the same place; MPL, CDDL and EPL that it is available and that recipients are told where.
For every part where the version is known, the exact source is in
`<name>-<version>-with-prom-sources.zip`, attached to the same release as the archives of the
edition with ProM (made by `python scripts/build_desktop.py prom-sources`, each file checked
against its SHA-256). Its `README.txt` lists what is in it and where each file comes from.

## Not settled

- **ProM framework and packages.** ProM4Py brings the ProM framework (GPL-2.0-or-later) and some
  120 ProM packages as `*-latest.jar` without their revisions or licences. The sources of six
  packages are in `ProM4Py/Packages/*/Trunk/src/`; the others are at
  https://github.com/promworkbench and in ProM's repository, but which revision each jar was
  built from is not recorded, so the exact source cannot be named here. To settle this, the
  ProM4Py authors or the ProM team would have to name the revisions, or the packages would have
  to be built from named revisions.
- **Libraries without licence information.** Of the jars on ProM's class path, those marked
  `none` in `licenses/class-path-jars.tsv` say nothing about their licence (besides ProM's own,
  e.g. guava, antlr, asm, axis, bsh, colt, fastutil, flanagan, freehep-graphics*, gluegen, jogl,
  gson, jackson, jama, javabdd, javailp, jbpt, jep, jgraph, jgrapht, jscience, jung, jxl, lz4,
  netlib natives, opencsv, org.eclipse.emf/uml2, prefuse, rsyntaxtextarea, saxon, stringtemplate,
  xstream, xpp3). They are passed on unchanged; their licences have not been checked one by one.
- The copyleft jars marked **open** in the table above.

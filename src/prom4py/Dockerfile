# ProM4Py — Java-based process mining backend.
#
# The image bundles the Java backend from
# https://zenodo.org/records/13853660 (prom4py.zip, ~430 MB compressed).
# That bundle is **not** vendored into this repository — it is downloaded
# during image build to keep the repo small.
#
# Listens on port 4040 with an HTTP API (/plugin, /executor, /cache, /align,
# /isRunning, /exit). Talk to it from the AlgoService through the Python
# client at src/AlgoService/vendored/comfy/prom4py/.
#
# Requires Java 8 (ProM only supports Java 8).

# JNI wrapper for lp_solve 5.5, used by the Hybrid ILP miner (see the lp_solve step below).
# Ubuntu does not package it, so it is compiled from the C source in the official lp_solve
# Java distribution on SourceForge. That works on every architecture, unlike the prebuilt
# x86-64 library in the same zip. The zip is the same for every 5.5.2.x release.
FROM eclipse-temurin:8-jdk-jammy AS lpsolve-wrapper

ARG LPSOLVE_JAVA_URL=https://downloads.sourceforge.net/project/lpsolve/lpsolve/5.5.2.5/lp_solve_5.5.2.5_java.zip
ARG LPSOLVE_JAVA_SHA256=0a4dcd21e0c494f51b5de4e5e7bcd608c71bbab957e37ac776cba19808a2d6c9

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip g++ lp-solve liblpsolve55-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# -l:liblpsolve55.so links the shared solver; -llpsolve55 would pick the static archive from
# liblpsolve55-dev, which is not built with -fPIC. The rpath lets the wrapper find the solver
# in /usr/lib/lp_solve without LD_LIBRARY_PATH.
RUN curl -fsSL --retry 5 --retry-all-errors -o lpsolve-java.zip "$LPSOLVE_JAVA_URL" \
    && echo "$LPSOLVE_JAVA_SHA256  lpsolve-java.zip" | sha256sum -c - \
    && unzip -j -q lpsolve-java.zip 'lp_solve_5.5_java/src/c/*' -d . \
    && g++ -O2 -fPIC -shared \
         -I"$JAVA_HOME/include" -I"$JAVA_HOME/include/linux" -I/usr/include/lpsolve \
         lpsolve5j.cpp -o liblpsolve55j.so \
         -L/usr/lib/lp_solve -l:liblpsolve55.so -Wl,-rpath,/usr/lib/lp_solve

FROM eclipse-temurin:8-jre-jammy

ARG PROM4PY_ZIP_URL=https://zenodo.org/records/13853660/files/prom4py.zip?download=1

# unzip + curl for fetching the bundle.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/prom4py

RUN curl -sL -o /tmp/prom4py.zip "$PROM4PY_ZIP_URL" \
    && unzip -q /tmp/prom4py.zip -d /tmp/prom4py-extracted \
    && mv /tmp/prom4py-extracted/ProM4Py/* . \
    && rm -rf /tmp/prom4py.zip /tmp/prom4py-extracted

# Strip JAR signatures. ProM's classpath ships the same package
# (org.eclipse.emf.ecore.util) from a *signed* jar
# (org.eclipse.emf.ecore-2.8.3) and an *unsigned* one (YAWLEditor). When the
# ProMClassLoader happens to load classes from both, the JVM aborts boot with
# "SecurityException: signer information does not match". ProM does not rely on
# these signatures, so we de-sign every jar to make the conflict impossible.
# Kept as a separate layer *after* the ~430 MB download so its cache survives.
RUN apt-get update \
    && apt-get install -y --no-install-recommends zip \
    && find /opt/prom4py -name '*.jar' -exec sh -c \
         'zip -q -d "$1" "META-INF/*.SF" "META-INF/*.RSA" "META-INF/*.DSA" "META-INF/*.EC" >/dev/null 2>&1 || true' \
         _ {} ';' \
    && apt-get purge -y zip && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# lp_solve 5.5 for the Hybrid ILP miner and the alignment plugin. ProM's LpSolve package
# (lpsolve.LpSolve) calls System.loadLibrary("lpsolve55") and then ("lpsolve55j"). The solver
# comes from the Ubuntu package lp-solve (/usr/lib/lp_solve/liblpsolve55.so), the JNI wrapper
# from the stage above. launch.sh puts /usr/lib/lp_solve on java.library.path.
RUN apt-get update \
    && apt-get install -y --no-install-recommends lp-solve \
    && rm -rf /var/lib/apt/lists/*
COPY --from=lpsolve-wrapper /build/liblpsolve55j.so /usr/lib/lp_solve/

# Portable launcher: no hardcoded Java path, headless mode, configurable port. It also
# restarts ProM when it exits or a call stays stuck (see the comments in launch.sh).
COPY launch.sh /opt/prom4py/launch.sh
RUN chmod +x /opt/prom4py/launch.sh

EXPOSE 4040
ENV PROM4PY_PORT=4040
ENV JAVA_HEAP=4G

# Create a non-root user and change ownership of the application directory
RUN groupadd -g 10002 promgroup && \
    useradd -r -u 10002 -g promgroup -d /opt/prom4py -s /sbin/nologin promuser && \
    chown -R promuser:promgroup /opt/prom4py

USER promuser

# Not /isRunning itself: ProM answers it only between calls, so a long discovery would turn the
# container unhealthy. The watchdog in launch.sh probes it and keeps a heartbeat instead.
HEALTHCHECK --start-period=180s --interval=10s --timeout=5s --retries=3 \
    CMD ["/opt/prom4py/launch.sh", "health"]

CMD ["/opt/prom4py/launch.sh"]

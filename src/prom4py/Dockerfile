# ProM4Py — Java-based process mining backend.
#
# The image bundles the Java backend from
# https://zenodo.org/records/13853660 (prom4py.zip, ~430 MB compressed).
# That bundle is **not** vendored into this repository — it is downloaded
# during image build to keep the repo small.
#
# Listens on port 4040 with an HTTP API (/plugin, /executor, /cache, /align,
# /isRunning, /exit). Talk to it from the AlgoService through the Python
# client at src/AlgoService/prom4py/.
#
# Requires Java 8 (ProM only supports Java 8).

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

# Portable launcher: no hardcoded Java path, headless mode, configurable port.
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

HEALTHCHECK --start-period=180s --interval=10s --timeout=5s --retries=12 \
    CMD curl -fs "http://localhost:${PROM4PY_PORT}/isRunning" || exit 1

CMD ["/opt/prom4py/launch.sh"]

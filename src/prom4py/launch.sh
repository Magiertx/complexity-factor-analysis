#!/bin/bash
# Portable ProM4Py launcher. Replaces the upstream ProM4Py.sh whose
# hardcoded Debian-style Java path won't work in our image.
set -e

cd /opt/prom4py

CP="Packages/Workshop/Trunk/out/production/prom"
CP="$CP:Packages/ProM-Contexts/Trunk/ivy/*"

PORT="${PROM4PY_PORT:-4040}"
HEAP="${JAVA_HEAP:-4G}"

exec java \
    -Xmx"${HEAP}" \
    -XX:ActiveProcessorCount=1 \
    -Djava.awt.headless=true \
    -da \
    -classpath "$CP" \
    -Djava.library.path=./lib:/usr/lib/lp_solve \
    -Djava.system.class.loader=org.processmining.framework.util.ProMClassLoader \
    -Djava.util.Arrays.useLegacyMergeSort=true \
    org.processmining.contexts.prom4py.ProM4PY -p "$PORT"

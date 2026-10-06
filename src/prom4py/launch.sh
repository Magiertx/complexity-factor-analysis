#!/bin/bash
# Portable ProM4Py launcher. Replaces the upstream ProM4Py.sh whose
# hardcoded Debian-style Java path won't work in our image.
#
# It also keeps ProM running. ProM4Py handles every request on one thread (the JDK
# HttpServer without an executor), so a plugin call that never finishes blocks the whole
# server, /isRunning included, and nothing can cancel it from outside. Java therefore runs as
# a child of this script, which starts it again when it exits and kills it when /isRunning
# has gone unanswered for longer than any client still waits (PROM4PY_CALL_TIMEOUT plus a
# margin). Clients reconnect and repeat their discovery after the restart.
#
#   launch.sh          run ProM and the watchdog (the container command)
#   launch.sh health   container healthcheck
set -u

cd /opt/prom4py

CP="Packages/Workshop/Trunk/out/production/prom"
CP="$CP:Packages/ProM-Contexts/Trunk/ivy/*"

PORT="${PROM4PY_PORT:-4040}"
HEAP="${JAVA_HEAP:-4G}"

# The same setting the backend uses for its calls; see .env.example.
CALL_TIMEOUT="${PROM4PY_CALL_TIMEOUT:-300}"
if ! [[ "$CALL_TIMEOUT" =~ ^[0-9]+$ ]] || [ $((10#$CALL_TIMEOUT)) -lt 10 ]; then
    echo "PROM4PY_CALL_TIMEOUT=$CALL_TIMEOUT is not a whole number of seconds of at least 10" >&2
    exit 1
fi
CALL_TIMEOUT=$((10#$CALL_TIMEOUT))

# ProM is probed every PROBE_INTERVAL s while it answers. A busy ProM does not answer, so the
# last answered probe is at most PROBE_INTERVAL s older than the start of any call still
# running. The backend's discoveries take turns, so no call waits behind another, and a
# client gives up at most CALL_TIMEOUT s after its call started. Restarting once no probe
# has been answered for CALL_TIMEOUT plus more than PROBE_INTERVAL s therefore never cuts
# off a call a client still waits for.
PROBE_INTERVAL=10
STUCK_AFTER=$((CALL_TIMEOUT + 30))
# The first start in a new container builds ProM's plugin cache (about a minute); later
# starts take a few seconds.
BOOT_TIMEOUT=600
URL="http://127.0.0.1:${PORT}/isRunning"
# Touched whenever ProM answers; the healthcheck reads its age.
HEARTBEAT=/tmp/prom4py-heartbeat

if [ "${1:-}" = health ]; then
    # Healthy while ProM answers, or is busy for no longer than the watchdog allows.
    [ -f "$HEARTBEAT" ] || exit 1
    age=$(($(date +%s) - $(stat -c %Y "$HEARTBEAT")))
    [ "$age" -le $((STUCK_AFTER + PROBE_INTERVAL)) ]
    exit
fi

log() {
    echo "[watchdog] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"
}

start_java() {
    rm -f "$HEARTBEAT"
    java \
        -Xmx"${HEAP}" \
        -XX:ActiveProcessorCount=1 \
        -Djava.awt.headless=true \
        -da \
        -classpath "$CP" \
        -Djava.library.path=./lib:/usr/lib/lp_solve \
        -Djava.system.class.loader=org.processmining.framework.util.ProMClassLoader \
        -Djava.util.Arrays.useLegacyMergeSort=true \
        org.processmining.contexts.prom4py.ProM4PY -p "$PORT" &
    java_pid=$!
    started=$(date +%s)
    up=0
}

java_pid=
stop_java() {
    rm -f "$HEARTBEAT"
    [ -n "$java_pid" ] || return 0
    # The JVM exits on TERM even while a plugin runs; KILL only if it has not after 5 s.
    kill -TERM "$java_pid" 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do
        kill -0 "$java_pid" 2>/dev/null || break
        sleep 0.5
    done
    kill -KILL "$java_pid" 2>/dev/null
    wait "$java_pid" 2>/dev/null
}

# Probes and pauses run in the background, so that the TERM of `docker stop` is handled at
# once and not only after a probe that can take minutes.
child=
in_background() {
    "$@" &
    child=$!
    wait "$child"
}

shutdown() {
    [ -n "$child" ] && kill "$child" 2>/dev/null
    log "stopping ProM"
    stop_java
    exit 0
}
trap shutdown TERM INT

log "starting ProM; it is restarted after ${STUCK_AFTER} s without an answer (PROM4PY_CALL_TIMEOUT=${CALL_TIMEOUT})"
start_java
last_ok=$started

while true; do
    if ! kill -0 "$java_pid" 2>/dev/null; then
        wait "$java_pid"
        log "ProM exited with code $?; starting it again"
        in_background sleep 2
        start_java
        continue
    fi

    now=$(date +%s)
    if [ "$up" = 0 ]; then
        if in_background curl -fs -o /dev/null -m 5 "$URL"; then
            up=1
            last_ok=$(date +%s)
            touch "$HEARTBEAT"
            log "ProM answers after $((last_ok - started)) s"
        elif [ $((now - started)) -ge "$BOOT_TIMEOUT" ]; then
            log "ProM did not start within ${BOOT_TIMEOUT} s; restarting it"
            stop_java
            start_java
        else
            in_background sleep 2
        fi
        continue
    fi

    # One probe that waits as long as the watchdog allows, instead of one every few seconds
    # that would pile up in the backlog of a busy server.
    budget=$((STUCK_AFTER - (now - last_ok)))
    if [ "$budget" -gt 0 ] && in_background curl -fs -o /dev/null -m "$budget" "$URL"; then
        last_ok=$(date +%s)
        touch "$HEARTBEAT"
        in_background sleep "$PROBE_INTERVAL"
    elif [ $(($(date +%s) - last_ok)) -ge "$STUCK_AFTER" ]; then
        log "ProM has not answered for ${STUCK_AFTER} s, a call is stuck; restarting it"
        stop_java
        start_java
        last_ok=$started
    else
        # Refused or dropped: Java exited (handled above) or its server is not listening.
        in_background sleep 2
    fi
done

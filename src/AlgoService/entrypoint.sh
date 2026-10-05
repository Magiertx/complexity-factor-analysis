#!/bin/sh
# Container entrypoint: apply outstanding Alembic migrations before launching
# the actual service command. Runs in both the web container and the celery
# worker (they share the same image); alembic locks on `alembic_version` so
# concurrent attempts converge to a no-op.

set -u

echo "[entrypoint] Applying database migrations (alembic upgrade head)..."

# Postgres healthcheck in compose already gates us, but the first connection
# can still race the moment the DB becomes accept()-ready. Retry a few times
# so a slow startup doesn't crash the whole container.
attempt=1
max_attempts=10
until alembic upgrade head; do
    if [ "$attempt" -ge "$max_attempts" ]; then
        echo "[entrypoint] Migration failed after $max_attempts attempts. Aborting." >&2
        exit 1
    fi
    echo "[entrypoint] Migration attempt $attempt failed, retrying in 2s..." >&2
    attempt=$((attempt + 1))
    sleep 2
done

echo "[entrypoint] Migrations complete. Launching: $*"
exec "$@"

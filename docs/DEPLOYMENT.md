# Production Deployment Guide

This document outlines the architecture, configuration, and operational requirements for deploying the application in a production environment (e.g., a Linux server at a university chair).

---

## 1. Production Architecture Overview

The application is deployed as a multi-container environment orchestrated via Docker Compose. For public deployments, the services are protected behind a reverse proxy (e.g., Caddy or Nginx) handling SSL/TLS termination.

```
                  Public Internet (HTTPS: 443)
                                │
                                ▼
                   ┌────────────────────────┐
                   │     Reverse Proxy      │ (Caddy / Nginx / Apache)
                   │  (Handles SSL/TLS cert)│
                   └────────────────────────┘
                                │
                                │ (HTTP: 3000)
                                ▼
                   ┌────────────────────────┐
                   │   Next.js Frontend     │ (Container: frontend)
                   │  Acts as internal proxy│
                   └────────────────────────┘
                                │
                     Docker     │ (HTTP: 8000)
                     Network    ▼
                   ┌────────────────────────┐
                   │   FastAPI Backend      │ (Container: algoservice)
                   │  (Isolated from WAN)   │
                   └────────────────────────┘
                    /                      \
                   /                        \
                  ▼                          ▼
       ┌────────────────────┐      ┌────────────────────┐
       │   PostgreSQL DB    │      │    ProM4Py JRE     │
       │(Container: postgres)│      │(Container: prom4py)│
       └────────────────────┘      └────────────────────┘
```

### Security Isolation
* **Frontend Proxying**: The Next.js frontend acts as a reverse proxy for all backend traffic. Requests under `/api/*` on the client side are forwarded directly to `http://algoservice:8000` via Next.js middleware.
* **Network Isolation**: The FastAPI backend (`algoservice`), ProM4Py (`prom4py`), and PostgreSQL (`postgres`) containers do **not** need their ports mapped to the public host interface in production. They communicate exclusively over the internal Docker network. Only the `frontend` port (`3000`) is bound to `localhost:3000` or exposed to the reverse proxy.

---

## 2. Reverse Proxy Configuration

To expose the application securely over HTTPS, configure a reverse proxy on the host machine.

### Option A: Caddy (Recommended)
Caddy automatically manages SSL/TLS certificates via Let's Encrypt and has a simple configuration syntax.

Create a `Caddyfile` (usually in `/etc/caddy/Caddyfile`):

```caddy
analysis.example.org {
    # Reverse proxy to the frontend container
    reverse_proxy localhost:3000

    # Strict security headers
    header {
        # Enable HSTS (HTTP Strict Transport Security)
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        # Prevent Clickjacking
        X-Frame-Options "DENY"
        # Prevent MIME-type sniffing
        X-Content-Type-Options "nosniff"
        # Referrer Policy
        Referrer-Policy "strict-origin-when-cross-origin"
    }

    # Enable compression
    encode gzip zstd
}
```

### Option B: Nginx
If Nginx is preferred or already running on the host, use the following configuration:

```nginx
server {
    listen 80;
    server_name analysis.example.org;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name analysis.example.org;

    # SSL Certificate Paths (e.g., managed by Certbot)
    ssl_certificate /etc/letsencrypt/live/analysis.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/analysis.example.org/privkey.pem;

    # Recommended SSL settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # A factor analysis dataset request may carry 500 MB of logs or nets (100 MB per file),
    # plus the multipart overhead.
    client_max_body_size 520M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        # The frontend waits up to 180 s for the API, e.g. for the first fit of a large dataset
        # or an interpretation by Claude.
        proxy_read_timeout 190s;
        proxy_send_timeout 190s;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 3. Environment Variables Configuration

Create a `.env` file in the project root directory (same directory as `docker-compose.yml`),
starting from `.env.example`. `docker-compose.yml` reads the variables below from it; the
connection strings between the containers are set in the compose file itself.

> [!IMPORTANT]
> Never commit the `.env` file containing production credentials to version control.

```ini
# --- PostgreSQL ---
POSTGRES_DB=complexity
POSTGRES_USER=complexity_admin
# Replace with a strong random password:
POSTGRES_PASSWORD=secure_random_db_password_here

# --- AlgoService ---
# Signing key for the session cookie. Required; the service refuses to start without it.
# Generate a fresh one per deployment:
#   python -c "import secrets; print(secrets.token_urlsafe(48))"
SESSION_SECRET_KEY=paste_the_generated_value_here

# Set to 1 once TLS is terminated in front of the stack (the nginx setup in section 6 does).
# Marks the session cookie Secure and enables HSTS. Leave unset for plain-http local runs.
SESSION_COOKIE_SECURE=1

# Allowed origins for CORS (comma separated)
CORS_ORIGINS=https://analysis.example.org

# Job quota and request limits, see .env.example
MAX_ACTIVE_JOBS_PER_SESSION=3
# Event logs and PNML nets per factor analysis dataset (defaults 50 and 200)
# MAX_LOG_FILES=50
# MAX_PNML_FILES=200
# Analyses of the bundled datasets, computed after the start (default 1; 0 turns it off)
# PRECOMPUTE_BUNDLED=1
# RATE_LIMIT_ANALYZE=60/hour
# RATE_LIMIT_DATASETS=60/hour
# RATE_LIMIT_FA_ANALYZE=120/minute
# Seconds one discovery may take in ProM before that input fails and ProM is restarted
# PROM4PY_CALL_TIMEOUT=300

# --- Interpretation by Claude (optional), see "Interpretation by Claude" below ---
# ANTHROPIC_API_KEY=
# INTERPRETATION_RATE_LIMIT=10/hour
# INTERPRETATION_DAILY_CAP=200

# --- Docker network ---
# Only needed if 172.28.0.0/16 collides with something on the host. Used as the compose
# network subnet and as the range algoservice trusts for X-Forwarded-For.
# COMPOSE_SUBNET=172.28.0.0/16
```

### Interpretation by Claude

The optional interpretation step sends the measure names (the column headers of an own CSV),
their definitions and aggregated analysis results to the Anthropic API and needs an API key. Without one, the step only shows the precomputed interpretations of the
bundled datasets.

- **Key.** Create a key for this deployment in the Claude Console
  (<https://platform.claude.com>), ideally in a workspace of its own, and put it into `.env` as
  `ANTHROPIC_API_KEY`. Compose passes it to `algoservice` only. The service reads it from the
  environment, never logs it and never returns it; the browser only learns whether a key is
  set and which model is configured. Rotate it in the Console if it leaks.
- **Spending.** Set a monthly spending limit for the workspace or organisation in the Claude
  Console; once it is reached, interpretations fail with an error until it is raised. On the server,
  `INTERPRETATION_RATE_LIMIT` (default `10/hour` per session) and `INTERPRETATION_DAILY_CAP`
  (default 200 per day over all sessions) bound the number of live calls; the counters live in
  Redis. One call sends about 2,000 input tokens for the bundled model datasets and roughly
  15,000 to 20,000 for the bundled log dataset (122 measures, 15 factors), and may use up to
  16,000 output tokens including thinking. Larger analyses are refused before any call: more
  than 150 measures or 20 factors, measure names longer than 120 characters, or a message
  over 80,000 characters (about 30,000 tokens). So one call costs at most about $0.45 at the
  prices of Claude Opus 5.5, and the daily cap bounds a day. Cached and precomputed
  interpretations cost nothing.
- **Model.** `INTERPRETATION_MODEL` (default `claude-opus-5-5`) and `INTERPRETATION_EFFORT`
  (default `medium`; at `high` an analysis with many factors can run into the limit of 16,000
  output tokens, which thinking counts towards). Requests opt into Anthropic's server-side fallback (`fallbacks: "default"`),
  so a request the model's safety classifiers decline is retried on the recommended fallback
  model; the footer of the result names the model that answered. Another model has to support
  that option and structured outputs.
- **Network.** `algoservice` needs outbound HTTPS to `api.anthropic.com` for live calls; an
  interpretation takes up to about a minute, at most 170 s including the analysis before the
  call.
- **Precomputed results.** `src/AlgoService/scripts/precompute_interpretations.py` writes the
  interpretations of the bundled datasets for the default parameters to
  `src/AlgoService/datasets/interpretations/`; they are part of the image. Run it with a key
  from `src/AlgoService` and rebuild. Rerun it with `--force` after changing the prompt
  (`interpretation/prompt.py`), the output schema or the payload; files made for another
  prompt are no longer served, and the log says so.

---

## 4. Directory Structure & Volume Layout

In production, persistent data is stored in Docker volumes or host-bound mounts. The default configuration uses a named Docker volume for PostgreSQL data:

```yaml
volumes:
  postgres_data:
```

### File Permissions
The containers run under specific, locked-down non-root users for security hardening:
* `algoservice` runs as user `appuser` (UID: `10001`, GID: `10001`).
* `prom4py` runs as user `promuser` (UID: `10002`, GID: `10002`).
* `frontend` runs as user `nextjs` (UID: `1001`, GID: `1001`).

If you mount custom directories from the host (for example, to persist uploaded logs or artifacts in `/app/artifacts` instead of using the DB for everything), ensure they are owned by UID `10001` on the host:
```bash
sudo chown -R 10001:10001 /path/to/host/artifacts
```

---

## 5. Deployment Commands

Use the following commands to build and run the services in production mode:

```bash
# 1. Build the images. The version (1.0.0-dev until the freeze) is part of the image; the commit
#    is not, so pass it, and it goes into the manifest of every export. Without it the manifest says
#    "unknown". `docker compose up -d --build` takes it the same way.
APP_COMMIT=$(git rev-parse HEAD) docker compose build

# 2. Run the services in detached mode (background)
docker compose up -d

# 3. View status of all running containers and their health check state
docker compose ps

# 4. View logs of a specific service
docker compose logs -f algoservice
```

### Prebuilt images

Instead of building, the stack can run from images on ghcr.io. `docker-compose.release.yml` has the
same services, environment, volumes and healthchecks as `docker-compose.yml`, with `image:` in
place of `build:`; `scripts/check_release_compose.py` compares the two and runs in CI, so change
both together. `CFA_TAG` picks the images (default `latest`):

```bash
docker compose -f docker-compose.release.yml up -d
CFA_TAG=v1.0.0 docker compose -f docker-compose.release.yml up -d
```

The workflow `images.yml` builds and pushes `complexity-factor-analysis-prom4py`, `-algoservice`
and `-frontend` (the Celery worker runs the algoservice image):

- A `v*` tag pushes the tag and `latest`, and drafts a GitHub release with
  `docker-compose.release.yml` and `env.example` (GitHub drops a leading dot in asset names; save
  it as `.env`). Publish the draft after checking it.
- Started by hand, the workflow takes a `tag` (default `edge`) and `platforms`. Without a tag the
  version in the exports reads `1.0.0-dev`; otherwise it is the tag without the `v`. The commit
  is `github.sha`.
- The images are `linux/amd64`. The build files would also work on arm64 (the lp_solve wrapper
  is compiled from source, the base images are multi-arch), but on the hosted amd64 runners
  that means emulation, with the ProM bundle unpacked and its jars rewritten under it, which is
  too slow to run on every tag, and the ProM bundle itself is not checked on arm64. On Apple
  silicon, Docker runs the amd64 images under emulation; building from the sources
  (`docker compose up --build`) gives native images. Pass `platforms` as `linux/amd64,linux/arm64`
  to try it.
- New packages on ghcr.io are private. Make each of the three public once: GitHub, Packages, the
  package, Package settings, Change visibility. The API cannot do it. Until then,
  `docker login ghcr.io` with a token that may read packages is needed.

The workflow `compose-smoke.yml` has a `mode` input: `images` runs the same checks against the
release compose file and the given tag instead of a build.

### Pinned dependency versions

`requirements.txt` names version ranges; `src/AlgoService/constraints.txt` pins every package, direct and
transitive, to the version that runs today. The Dockerfile and the CI jobs install with it
(`pip install -r requirements.txt -c constraints.txt`), so a rebuild a year from now gets the same
packages as the build that was tested, and a new upstream release cannot break a deployment by
itself. The pins are those of Python 3.11, the version of the image and of CI.

To update them (after raising a range, or to take up newer releases):

```bash
docker run --rm -v "$PWD/src/AlgoService:/w" -w /w python:3.11-slim sh -c \
  'pip install -q -r requirements-dev.txt && pip freeze'
```

Sort the output into the two blocks of `constraints.txt` (runtime, and the test tools that only
`requirements-dev.txt` brings), then run the backend tests and `docker compose build algoservice`
before committing. Do not edit single pins by hand without installing the result: a pin that
contradicts a range makes `pip` stop with a conflict, on purpose.

---

## 6. Database Backups & Recovery

Since all run logs and configuration settings are stored in the PostgreSQL database, backing up this database is critical.

### Automated Backup Script
Create a script `/opt/complexity/backup.sh` on the host:

```bash
#!/bin/bash
BACKUP_DIR="/opt/complexity/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/complexity_db_${TIMESTAMP}.sql.gz"

# Create backup directory if it does not exist
mkdir -p "$BACKUP_DIR"

# Run pg_dump inside the docker container and compress the output
docker compose -f /path/to/project/docker-compose.yml exec -t postgres \
  pg_dump -U complexity_admin -d complexity | gzip > "$BACKUP_FILE"

# Delete backups older than 30 days to free disk space
find "$BACKUP_DIR" -type f -name "complexity_db_*.sql.gz" -mtime +30 -delete

echo "Backup created: $BACKUP_FILE"
```

Make the script executable:
```bash
chmod +x /opt/complexity/backup.sh
```

### Cron Job Setup
To run the backup automatically every night at 2:00 AM, add it to the root user's crontab:

```bash
sudo crontab -e
```
Add the following line:
```cron
0 2 * * * /opt/complexity/backup.sh >> /var/log/complexity_backup.log 2>&1
```

### Database Restore Procedure
To restore a backup file to a running PostgreSQL container:

```bash
# 1. Stop the application services (keep postgres running)
docker compose stop algoservice frontend

# 2. Re-create the database (optional/precautionary)
docker compose exec -it postgres dropdb -U complexity_admin complexity
docker compose exec -it postgres createdb -U complexity_admin complexity

# 3. Restore the SQL backup
gunzip -c /opt/complexity/backups/complexity_db_2026xxxx_xxxxxx.sql.gz | \
  docker compose exec -T postgres psql -U complexity_admin -d complexity

# 4. Start the application services again
docker compose start
```

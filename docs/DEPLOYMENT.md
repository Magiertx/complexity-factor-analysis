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
# Stability computations (bootstrap) queued or running over all sessions (default 2); more get a 429 "stability_jobs_busy"
# MAX_ACTIVE_STABILITY_JOBS=2
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
# INTERPRETATION_IP_RATE_LIMIT=30/hour
# INTERPRETATION_DAILY_CAP=200
# INTERPRETATION_CHAT_DAILY_CAP=100
# INTERPRETATION_MODELS=claude-opus-5-5,claude-sonnet-5-5
# INTERPRETATION_EFFORTS=low,medium,high,xhigh

# --- Feedback form (optional), see "Feedback form" below ---
# FEEDBACK_SMTP_HOST=smtp.example.org
# FEEDBACK_SMTP_USER=
# FEEDBACK_SMTP_PASSWORD=
# FEEDBACK_TO=owner@example.org
# RATE_LIMIT_FEEDBACK=5/hour

# --- Docker network ---
# Only needed if 172.28.0.0/16 collides with something on the host. Used as the compose
# network subnet and as the range algoservice trusts for X-Forwarded-For.
# COMPOSE_SUBNET=172.28.0.0/16
```

### Running as one local process (desktop)

Without Docker the backend can run as a single process, which is what the desktop app does
([`DESKTOP.md`](DESKTOP.md); its launcher sets all of this). None of this is in
`docker-compose.yml`; with default settings the Docker deployment behaves as described above.

| Setting | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | Postgres of the compose file | `sqlite+aiosqlite:///<file>` uses a SQLite file: default connection pool, `journal_mode=WAL`, `busy_timeout` 10 s, `synchronous=NORMAL` on every connection. An in-memory URL keeps one shared connection. |
| `REDIS_URL` | set by compose | Unset: jobs run in the server process instead of Celery, and the rate limits and quotas that use Redis are counted in memory. |
| `LOCAL_JOB_SLOTS` | `2` | Jobs computing at once in that mode; the others wait as `pending`. Progress (SSE) and cooperative abort work as with Celery. |
| `DATA_MAX_IDLE_DAYS` | `7` | Days of idleness after which a session's datasets and upload directories are deleted. `never` keeps them. |
| `MAX_DATASETS_PER_SESSION` | `30` | Datasets kept per session, oldest finished first. `never` for no limit. |
| `LOW_DISK_CLEANUP_FREE_PCT` | `10` | Free disk space below which the oldest finished runs are deleted (until 5 points more are free). `never` deletes none. |
| `SESSION_MAX_AGE` | `1209600` (14 days) | Lifetime of the session cookie in seconds. `never` is ten years. |
| `SHARED_SESSION_ID` | unset | A UUID. When set, every caller is in this one session, whatever the cookie says. Only for a single-user installation; on a server it would give all visitors the same runs and datasets. |

- With no `REDIS_URL`, jobs found `pending` or `running` at startup are marked `failed` with the
  code `interrupted`, because the process that ran them is gone. Left alone they would count
  towards `MAX_ACTIVE_JOBS_PER_SESSION` and `MAX_ACTIVE_STABILITY_JOBS` for good.
- A malformed value of any of these stops the start, like the other settings.
- Migrations: Docker runs `alembic upgrade head` in `entrypoint.sh`. A launcher without the
  `alembic` command calls `db_migrate.upgrade_to_head(url)` (in `src/AlgoService`), which works
  on SQLite and Postgres and may be called from inside a running event loop.

### Interpretation by Claude

The optional interpretation step sends the measure names (the column headers of an own CSV),
their definitions and aggregated analysis results to the Anthropic API and needs an API key. Without one, the step only shows precomputed interpretations of the
bundled datasets. The repository holds them in English and German for the default parameters
and for the published options ("Paper settings") of each bundled dataset.

- **Key.** Create a key for this deployment in the Claude Console
  (<https://platform.claude.com>), ideally in a workspace of its own, and put it into `.env` as
  `ANTHROPIC_API_KEY`. Compose passes it to `algoservice` only. The service reads it from the
  environment, never logs it and never returns it; the browser only learns whether a key is
  set and which model is configured. Rotate it in the Console if it leaks.
- **Spending.** Set a monthly spending limit for the workspace or organisation in the Claude
  Console; once it is reached, interpretations fail with an error until it is raised. On the
  server, three limits count live calls, interpretations and follow-up questions together; the
  counters live in Redis and a request that is refused by one limit uses up the counters of the
  limits checked before it:
  - `INTERPRETATION_RATE_LIMIT` (default `10/hour`) per session;
  - `INTERPRETATION_IP_RATE_LIMIT` (default `30/hour`) per client address. Sessions are free (a
    request without a cookie starts one), so the session limit alone bounds nothing; the address
    is the one the request limiter uses (`rate_limit_key`), which follows `X-Forwarded-For` only
    where uvicorn trusts it (`FORWARDED_ALLOW_IPS`, see above). Behind a proxy that is not
    trusted, all visitors share one address and one counter;
  - `INTERPRETATION_DAILY_CAP` (default 200 per day over all sessions) and, of those,
    `INTERPRETATION_CHAT_DAILY_CAP` (default 100) for follow-up questions, so that questions
    cannot use up the interpretations. Both always apply; the session and address limits are off
    under pytest and with `RATE_LIMIT_DISABLED=1`.

  Cached and precomputed interpretations cost nothing and do not count.

  What a call costs. One call sends about 2,000 input tokens for the bundled model datasets and
  roughly 15,000 to 20,000 for the bundled log dataset (122 measures, 15 factors). Larger
  analyses are refused before any call: more than 150 measures or 20 factors, measure names longer
  than 120 characters, or a message over 80,000 characters (about 30,000 tokens). Thinking counts
  towards the output limit, which grows with the effort (`MAX_TOKENS_BY_EFFORT` in
  `interpretation/client.py`: 16,000 tokens at `low` and `medium`, 24,000 at `high`, 32,000 at
  `xhigh` and `max`). Measured on the API (Claude Opus 5.5, English, one call each; the cost
  follows the thinking, so it varies between calls):

  | Effort | 12 measures (model dataset) | 123 measures, 13 factors (2,112 logs; earlier computation, the tool now keeps 125 measures and 16 factors) |
  | --- | --- | --- |
  | `low` | $0.030, 8 s | not measured |
  | `medium` (default) | $0.034, 10 s | $0.17, 27 s |
  | `high` | $0.043, 14 s | not measured |
  | `xhigh` | $0.06, 18 to 37 s (once 60 s) | $0.24, 54 s (German: $0.35, 92 s) |
  | `max` | $0.36, 150 s | not measured |

  Claude Sonnet 5.5 at `medium`: $0.015 and 6 s on the model dataset, $0.08 and 16 s on the
  log dataset.

  A live call may take 170 s at most, the analysis before the call included (the frontend
  gives up at 180 s). `xhigh` fits that budget on the bundled datasets, with margin. `max` does
  not: it took 150 s already on the small dataset, and it costs six times as much as `xhigh`
  there. So `max` is not in the default `INTERPRETATION_EFFORTS`; adding it means live calls
  that run into the limit and fail after being paid for, on larger analyses.

  One follow-up question sends the same context as the interpretation (up to about 30,000 tokens
  for the largest analysis allowed) plus the conversation (at most 40,000 characters, about
  12,000 tokens) and may use up to 8,000 output tokens (12,000 at `high`, 16,000 at `xhigh` and
  `max`; `CHAT_MAX_TOKENS_BY_EFFORT` in `interpretation/chat.py`), since the answers are short.
  Not measured on the API, so this is a bound, not a measurement: a question costs at most about
  as much as the largest measured `xhigh` interpretation, about $0.40. Typically it costs a few
  cents, since the context is cached after the first question.

  What the caps bound per day, with the default lists and caps (efforts up to `xhigh`, so no
  `max`), taking the largest measured call, about $0.35, for an interpretation and $0.40 for a
  question: at most 200 calls a day, at most 100 of them questions, so about $75 (for example 100
  interpretations and 100 questions; 200 interpretations are $70). At the default effort the
  same 200 calls cost about $7 on the model datasets and about $34 on the log dataset. One
  address alone can make 30 calls an hour, about $12 at the worst case, and reaches the daily
  cap in about seven hours; many addresses reach it faster, which the daily cap is for. The
  monthly limit in the Console is the final bound.
- **Follow-up questions.** Under a shown interpretation the step offers a chat about the analysis.
  Every question is one live call, counted in the same limits as an interpretation (session,
  address, day) and, besides, in `INTERPRETATION_CHAT_DAILY_CAP`; it has the output budget of the
  chosen effort listed above. A call sends the analysis context, the stored interpretation and the
  conversation so far (at most 20 messages and 40,000 characters, a question at most 2,000 and an
  answer at most 6,000); the context is marked for prompt caching, so the questions after the
  first one read it cheaply. Nothing is stored, and no question or answer is logged. The browser
  keeps the conversation and sends it back with every question, so the server signs every answer
  (HMAC-SHA256 with a key derived from `SESSION_SECRET_KEY`) and refuses an answer it did not
  write; changing `SESSION_SECRET_KEY` ends the open conversations. Without a key the chat is not
  offered.
- **Model.** `INTERPRETATION_MODEL` (default `claude-opus-5-5`) and `INTERPRETATION_EFFORT`
  (default `medium`) are the default selection. Visitors can choose another model and effort in
  the interpretation step: `INTERPRETATION_MODELS` (default `claude-opus-5-5,claude-sonnet-5-5`)
  and `INTERPRETATION_EFFORTS` (comma-separated subset of `low,medium,high,xhigh,max`, default
  `low,medium,high,xhigh`) list what is offered; the default selection is added if missing
  (with a warning in the log), and a live call with anything else is refused with
  `interpretation_choice_not_allowed`. Higher efforts think longer, cost more and may run into
  the 170 s limit of a live call (see the table above); each effort has its own output limit. A malformed
  `INTERPRETATION_MODEL(S)` or `INTERPRETATION_EFFORT(S)` (anything but letters, digits, `.`, `_`
  and `-`, at most 64 characters) stops the server at startup. Stored
  interpretations of any model and effort can always be shown. Requests opt into Anthropic's server-side fallback (`fallbacks: "default"`),
  so a request the model's safety classifiers decline is retried on the recommended fallback
  model; the footer of the result names the model that answered. Another model has to support
  that option and structured outputs.
- **Network.** `algoservice` needs outbound HTTPS to `api.anthropic.com` for live calls; an
  interpretation takes up to about a minute, at most 170 s including the analysis before the
  call.
- **Precomputed results.** `src/AlgoService/scripts/precompute_interpretations.py` writes the
  interpretations of the bundled datasets for the default parameters and the published options to
  `src/AlgoService/datasets/interpretations/`, one file per model and effort (by default Opus 5.5
  at medium, high and xhigh; `--variant model:effort`, repeatable, chooses others, `--timeout`
  sets the limit of one call, 600 s by default); they are part of the image. Run it with a key
  from `src/AlgoService` and rebuild. Rerun it with `--force` after changing the prompt
  (`interpretation/prompt.py`), the output schema or the payload; files made for another
  prompt are no longer served, and the log says so.

### Feedback form

The feedback entry in the header sends a short message (a bug, an idea or something else) to
the owner of the deployment. It is anonymous: the table `feedback` holds the date, the kind,
the message, the optional contact the sender typed, and the technical details the sender agreed
to send (tool version and commit, page, step, language, browser, last error code). It holds
neither the IP address nor the session. The rate limiter keeps the address as a counter key in
memory or Redis until its window ends (`RATE_LIMIT_FEEDBACK`, default `5/hour` per visitor), and
nowhere else.

A message is stored first. If mail is set up it is then sent in the background and marked
delivered; a mail that fails is logged as a warning and the message stays in the table.

| Variable | Meaning |
| --- | --- |
| `FEEDBACK_SMTP_HOST` | Mail server. With `FEEDBACK_TO` it turns mail on; both empty means messages are only kept. |
| `FEEDBACK_TO` | Where the messages go. |
| `FEEDBACK_SMTP_PORT` | Default `587`. |
| `FEEDBACK_SMTP_USER`, `FEEDBACK_SMTP_PASSWORD` | Login; leave both empty for a server that needs none. |
| `FEEDBACK_SMTP_FROM` | Sender address; defaults to the user, then to `FEEDBACK_TO`. |
| `FEEDBACK_SMTP_TLS` | `starttls` (default, port 587) or `ssl` (port 465). |

Compose passes them to `algoservice` only. The service logs at startup whether mail is on, not
the host or the recipient, and a malformed port or mode stops the start. The subject reads
`[CFA feedback] <kind>: <first 60 characters>`; line breaks in anything that goes into a header
are removed.

Read the messages on the server, inside the container (from `src/AlgoService` without Docker):

```bash
docker compose exec algoservice python -m scripts.feedback list                       # all, oldest first
docker compose exec algoservice python -m scripts.feedback list --since 7d --undelivered
docker compose exec algoservice python -m scripts.feedback list --brief               # one line each
docker compose exec algoservice python -m scripts.feedback resend                     # mail the undelivered again
docker compose exec algoservice python -m scripts.feedback resend --id 12
```

`--since` takes a date (`2026-10-31`), a date and time (`2026-10-31T14:30`) or an age (`36h`,
`7d`), in UTC. The table is created by the migration that runs at the start of the container
and is part of the database backup (section 6).

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

> **Not available yet.** This needs a release without a suffix (1.0.0) with public images. A tag
> such as `-rc1` does not set `latest`, and the packages are still private, so a pull ends with
> `unauthorized` today; build from the sources until then (`docker compose up -d --build` builds
> and starts, a `build` or `pull` beforehand is not needed). On Linux, Docker needs root rights or
> the group `docker` ([post-install steps](https://docs.docker.com/engine/install/linux-postinstall/)).

Instead of building, the stack can run from images on ghcr.io. `docker-compose.release.yml` has the
same services, environment, volumes and healthchecks as `docker-compose.yml`, with `image:` in
place of `build:`; `scripts/check_release_compose.py` compares the two and runs in CI, so change
both together. `CFA_TAG` picks the images (default `latest`); the tag keeps the `v` of the git tag
(`v1.0.0`):

```bash
docker compose -f docker-compose.release.yml up -d
CFA_TAG=v1.0.0 docker compose -f docker-compose.release.yml up -d
```

The workflow `images.yml` builds and pushes `complexity-factor-analysis-prom4py`, `-algoservice`
and `-frontend` (the Celery worker runs the algoservice image):

- A `v*` tag pushes the tag and `latest`, and drafts a GitHub release with
  `docker-compose.release.yml` and `env.example` (GitHub drops a leading dot in asset names, so
  `.env.example` goes up as `env.example`, `images.yml` line 110; save it as `.env`). Publish the draft after checking it. A tag with a suffix such as `v1.0.0-rc1`
  is a pre-release: it does not move `latest`, and the draft is marked as one.
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

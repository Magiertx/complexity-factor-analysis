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

    # Size limit for log file uploads (must align with 100MB limit in algoservice)
    client_max_body_size 100M;

    location / {
        proxy_pass http://127.0.0.1:3000;
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

Create a `.env` file in the project root directory (same directory as `docker-compose.yml`).

> [!IMPORTANT]
> Never commit the `.env` file containing production credentials to version control.

```ini
# --- PostgreSQL Settings ---
POSTGRES_DB=toolkit
POSTGRES_USER=toolkit_admin
# Replace with a strong random password:
POSTGRES_PASSWORD=secure_random_db_password_here

# --- AlgoService Backend ---
# The database connection string (async pg driver)
DATABASE_URL=postgresql+asyncpg://toolkit_admin:secure_random_db_password_here@postgres:5432/toolkit

# List of allowed origins for CORS (comma separated)
CORS_ORIGINS=https://analysis.example.org,http://localhost:3000

# Connection URL to the ProM4Py execution server
PROM4PY_URL=http://prom4py:4040

# Signing key for the session cookie. REQUIRED — the service refuses to start without it,
# because the cookie is the only thing separating one user's jobs, uploads and results from
# another's. Generate a fresh one per deployment:
#   python -c "import secrets; print(secrets.token_urlsafe(48))"
SESSION_SECRET_KEY=paste_the_generated_value_here

# Set to 1 once TLS is terminated in front of the stack (the nginx setup in section 6 does).
# Marks the session cookie Secure and enables HSTS. Leave unset for plain-http local runs.
SESSION_COOKIE_SECURE=1

# --- Frontend Next.js Settings ---
# URL where Next.js can resolve algoservice internally over the docker network
INTERNAL_API_URL=http://algoservice:8000

# --- Docker network ---
# Only needed if 172.28.0.0/16 collides with something on the host. docker-compose.yml uses
# this value twice: as the compose network subnet, and as the range algoservice trusts to
# have set X-Forwarded-For (FORWARDED_ALLOW_IPS). Requests arrive from the frontend
# container, so without a matching value uvicorn ignores the header and every user of the
# deployment shares a single rate-limit counter. Change it in one place, not two.
# COMPOSE_SUBNET=172.28.0.0/16
```

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
# 1. Build the images
docker compose build

# 2. Run the services in detached mode (background)
docker compose up -d

# 3. View status of all running containers and their health check state
docker compose ps

# 4. View logs of a specific service
docker compose logs -f algoservice
```

---

## 6. Database Backups & Recovery

Since all run logs and configuration settings are stored in the PostgreSQL database, backing up this database is critical.

### Automated Backup Script
Create a script `/opt/toolkit/backup.sh` on the host:

```bash
#!/bin/bash
BACKUP_DIR="/opt/toolkit/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/toolkit_db_${TIMESTAMP}.sql.gz"

# Create backup directory if it does not exist
mkdir -p "$BACKUP_DIR"

# Run pg_dump inside the docker container and compress the output
docker compose -f /path/to/project/docker-compose.yml exec -t postgres \
  pg_dump -U toolkit_admin -d toolkit | gzip > "$BACKUP_FILE"

# Delete backups older than 30 days to free disk space
find "$BACKUP_DIR" -type f -name "toolkit_db_*.sql.gz" -mtime +30 -delete

echo "Backup created: $BACKUP_FILE"
```

Make the script executable:
```bash
chmod +x /opt/toolkit/backup.sh
```

### Cron Job Setup
To run the backup automatically every night at 2:00 AM, add it to the root user's crontab:

```bash
sudo crontab -e
```
Add the following line:
```cron
0 2 * * * /opt/toolkit/backup.sh >> /var/log/toolkit_backup.log 2>&1
```

### Database Restore Procedure
To restore a backup file to a running PostgreSQL container:

```bash
# 1. Stop the application services (keep postgres running)
docker compose stop algoservice frontend

# 2. Re-create the database (optional/precautionary)
docker compose exec -it postgres dropdb -U toolkit_admin toolkit
docker compose exec -it postgres createdb -U toolkit_admin toolkit

# 3. Restore the SQL backup
gunzip -c /opt/toolkit/backups/toolkit_db_2026xxxx_xxxxxx.sql.gz | \
  docker compose exec -T postgres psql -U toolkit_admin -d toolkit

# 4. Start the application services again
docker compose start
```

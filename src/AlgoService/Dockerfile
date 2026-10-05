FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        graphviz \
        libgraphviz-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# One BLAS thread per process. The factor fits work on small matrices, where OpenBLAS threads
# only contend with each other and with parallel requests; with the default of one thread per
# core a fit over 120 log measures took 85 s instead of 6 s.
ENV OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1

# Make the entrypoint executable. Doing this before the USER switch so we
# don't depend on appuser having write permission.
RUN chmod +x /app/entrypoint.sh

# Create non-root group and user, create artifacts folder, and change ownership
RUN groupadd -g 10001 appgroup && \
    useradd -r -u 10001 -g appgroup -d /app -s /sbin/nologin appuser && \
    mkdir -p /app/artifacts /app/uploaded_logs && \
    chown -R appuser:appgroup /app

USER appuser

EXPOSE 8000
# ENTRYPOINT runs alembic upgrade head before whatever CMD / docker-compose
# `command:` is set. Works for both the web service (default CMD) and the
# celery worker (which overrides CMD via compose).
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["uvicorn", "srv_main:app", "--host", "0.0.0.0", "--port", "8000"]

# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS frontend-builder
WORKDIR /src

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY tsconfig*.json vite.config.ts ./
COPY frontend/ ./frontend/
RUN npm run build

FROM python:3.12-slim AS runtime
ARG APP_UID=10001
ARG APP_GID=10001
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/backend \
    APP_HOST=0.0.0.0 \
    APP_PORT=8081 \
    DATA_DIR=/data \
    DOWNLOAD_TEMP_DIR=/data/tmp \
    HF_HOME=/data/hf-cache \
    HF_HUB_CACHE=/data/hf-cache/hub

WORKDIR /app

COPY requirements.txt ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssh-client \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY --from=frontend-builder /src/frontend/dist ./frontend/dist

RUN if ! getent group 1000 >/dev/null; then groupadd --gid 1000 hostuser; fi \
    && if ! getent passwd 1000 >/dev/null; then useradd --uid 1000 --gid 1000 --home-dir /data --no-create-home --shell /usr/sbin/nologin hostuser; fi \
    && groupadd --gid "${APP_GID}" app \
    && useradd --uid "${APP_UID}" --gid "${APP_GID}" --home-dir /data --no-create-home --shell /usr/sbin/nologin app \
    && mkdir -p /models /backups /data/tmp /data/hf-cache/hub \
    && touch /app/config.yaml \
    && chown -R app:app /app /models /backups /data

EXPOSE 8081
VOLUME ["/data"]

USER app:app

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.getenv(\"APP_PORT\", \"8081\")}/api/health', timeout=5).read()"

CMD ["sh", "-c", "uvicorn app.main:app --host ${APP_HOST:-0.0.0.0} --port ${APP_PORT:-8081}"]

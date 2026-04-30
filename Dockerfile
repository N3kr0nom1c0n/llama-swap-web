# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS frontend-builder
WORKDIR /src

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY tsconfig*.json vite.config.ts ./
COPY frontend/ ./frontend/
RUN npm run build

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/backend \
    APP_HOST=0.0.0.0 \
    APP_PORT=8081 \
    DATA_DIR=/data

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY --from=frontend-builder /src/frontend/dist ./frontend/dist

RUN mkdir -p /models /backups /data \
    && touch /app/config.yaml

EXPOSE 8081
VOLUME ["/models", "/backups", "/data"]

CMD ["sh", "-c", "uvicorn app.main:app --host ${APP_HOST:-0.0.0.0} --port ${APP_PORT:-8081}"]

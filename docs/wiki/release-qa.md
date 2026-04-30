# Release QA

Run these gates before calling a build production-ready.

## Backend

```sh
./.venv/bin/pytest backend/tests -q
```

## Frontend

```sh
npm test
npm run build
```

## Docker And Compose

```sh
docker compose -f compose.example.yml config
docker build -t llama-swap-web:release-candidate .
```

## Container Smoke

Run against a disposable test container:

```sh
BASE_URL=http://127.0.0.1:8092 \
QA_ARTIFACT_DIR=artifacts/qa \
SMOKE_BACKUPS_DIR=/tmp/lsm-release-backups \
SMOKE_CONTAINER=llama-swap-web-release \
bash scripts/container-smoke.sh
```

## Browser Smoke

Only run mutating e2e tests against disposable mounts:

```sh
ALLOW_E2E_MUTATIONS=1 BASE_URL=http://127.0.0.1:8092 npm run e2e -- --project=chromium
```

## Secret Scan

```sh
bash scripts/secret-scan.sh
```

## Release Evidence

Update `artifacts/release-checklist.md` with exact command results, date, and any partial gates. Do not mark production-ready while path safety or secret safety is partial.

# Release Checklist

This file tracks the proof required before llama-swap-web is considered production-ready for the LAN rig workflow.

## Gate Status

| Gate | Command / Evidence | Status | Notes |
| --- | --- | --- | --- |
| Backend tests | `./.venv/bin/pytest backend/tests -q` | Passed | 102 passed on 2026-04-30. |
| Frontend tests | `npm test` | Passed | 12 passed on 2026-04-30. |
| Frontend build | `npm run build` | Passed | Vite production build passed on 2026-04-30. |
| Compose validation | `docker compose -f compose.example.yml config` | Passed | Compose example rendered on 2026-04-30. |
| Docker build | `docker build -t llama-swap-web:phase-remaining .` | Passed | Local Docker Desktop build passed on 2026-04-30; build context excludes generated QA artifacts. |
| Container smoke | `BASE_URL=http://127.0.0.1:8092 QA_ARTIFACT_DIR=artifacts/qa SMOKE_BACKUPS_DIR=/tmp/lsm-phase-rem3-backups SMOKE_CONTAINER=llama-swap-web-phase-remaining bash scripts/container-smoke.sh` | Passed | Fresh temp-mounted container passed on 2026-04-30; script enforces health, state, GPU detect, config import candidates, model seed, preview, apply, backup list, generated YAML, Docker logs, and UID evidence. |
| Browser smoke | `ALLOW_E2E_MUTATIONS=1 BASE_URL=http://127.0.0.1:8092 npm run e2e -- --project=chromium` | Passed | 7 Playwright tests passed on 2026-04-30; run outside sandbox because Chromium launch is blocked by macOS sandbox permissions. Mutating test now requires explicit disposable-target opt-in. |
| Non-root container | `docker exec llama-swap-web-phase-remaining id -u` | Passed | Runtime UID is `10001`. |
| Path safety | Upload/download/apply cannot escape `/models`, `/data`, `/backups`, `/tmp` | Partial | Upload and config path escape tests pass; Docker config apply with bind mount passed; download path safety and HF subdirectory collision coverage remain open. |
| Secret safety | HF token never appears in API, UI, logs, or committed files | Partial | API token save/clear and fake-token Docker redaction tests pass; final secret scan still required before release. |

## Issue Proof Matrix

| Issue | Owner | Required Proof | Gate |
| --- | --- | --- | --- |
| C1 Upload buffers whole file | Backend Safety Agent | Oversize 413 test, traversal tests, successful chunked upload test | Backend tests |
| C2 Root container and unsafe `/tmp` bind | Ops/Release Agent | Non-root `id -u`, Compose has no host `/tmp:/tmp`, writable mounted dirs | Docker/container smoke |
| C3 Missing direct Pydantic dependency | Ops/Release Agent | Dependency manifests include pydantic and clean install imports backend | Backend tests / Docker build |
| C4 Documented `latest` not pushed | Ops/Release Agent | GHCR metadata emits `latest` on `main`; docs match tags | CI workflow review |
| B1 Preview creates directories | Config/YAML Agent | Preview test proves no directory creation | Backend tests |
| B2 Hooks replaced wholesale | Config/YAML Agent | Existing custom hooks survive preview/apply generation | Backend tests |
| B3 Unquoted command values | Config/YAML Agent | `shlex.split` round-trip test | Backend tests |
| B4 HF subdirectories flattened | Download/HF Agent | Two same-basename files in different subdirs remain distinct | Backend tests |
| Download does not become installed model | Inventory/Model Agent / Frontend Workflow Agent | Completed job creates managed model and shows next action | Backend + frontend + browser smoke |
| Dashboard shows stale queue history | Frontend Workflow Agent | Dashboard shows blockers/actions; full queue moves to Import page | Frontend tests |
| Models page forces manual bridge work | Frontend Workflow Agent / Inventory Agent | Create/attach model from completed download and scanned files | Backend + frontend tests |
| Config apply can wipe usable config | Config/YAML Agent | Empty destructive apply blocked without explicit confirmation | Backend tests |
| HF token exposure risk | Backend Safety Agent / Frontend Workflow Agent | Token save/clear tests and secret scan | Backend + frontend tests |
| GPU planner lacks real planning | GPU Planner Agent | Detect/live status/recommendation tests and warning UI | Backend + frontend tests |

## 2026-04-30 Phase Evidence

- Added CI and release QA workflows covering backend tests, frontend tests, frontend build, Docker build, Compose validation, container smoke, and Playwright smoke.
- Added staged config apply safety: preview fingerprints, stage expiry, single-use apply, selected-model scoping, destructive-change reporting, and explicit destructive apply confirmation.
- Added current `config.yaml` import candidates so existing llama-swap model entries can become managed models.
- Added GPU detection/status/recommendation endpoints and GPU Planner UI controls for detect/recommend flows.
- Added SQLite schema versioning and forward migrations for existing databases.
- Added non-root container runtime evidence and safer generated QA artifact ignores.
- Fixed review findings: stale matrix sets are pruned when managed matrix keys change, backup retention settings now prune config backups and appear in Settings, malformed GPU recommendation payloads return validation errors, config import slug collisions receive unique IDs, GPU Planner recommendation state resets after device changes, and mutating E2E tests are gated to disposable targets.
- CI/release QA now calls `scripts/container-smoke.sh`, which enforces the deeper local smoke path instead of only shallow curl checks.

## Failure Report Template

```text
Gate:
Command:
Expected:
Actual:
Suspected owner:
Artifact paths:
Next fix packet:
```

# Release Checklist

This file tracks the proof required before llama-swap-web is considered production-ready for the LAN rig workflow.

## Gate Status

| Gate | Command / Evidence | Status | Notes |
| --- | --- | --- | --- |
| Backend tests | `./.venv/bin/pytest backend/tests -q` | Passed | 119 passed on 2026-04-30. |
| Frontend tests | `npm test` | Passed | 15 tests across 8 files passed on 2026-04-30. |
| Frontend build | `npm run build` | Passed | TypeScript and Vite production build passed on 2026-04-30. |
| Compose validation | `docker compose -f compose.example.yml config` | Passed | Compose example rendered on 2026-04-30. |
| Docker build | `docker build -t llama-swap-web:production-phase1 .` | Passed | Local Docker Desktop build passed on 2026-04-30; build context excludes generated QA artifacts. |
| Container smoke | `BASE_URL=http://127.0.0.1:8092 QA_ARTIFACT_DIR=artifacts/qa SMOKE_BACKUPS_DIR=/tmp/lsm-prod2-backups SMOKE_CONTAINER=llama-swap-web-prod1 bash scripts/container-smoke.sh` | Passed | Fresh temp-mounted final-image container passed on 2026-04-30; script enforces health, state, GPU detect, config import candidates, model seed, preview, apply, backup API listing, generated YAML, Docker logs, and UID evidence. |
| Browser smoke | `ALLOW_E2E_MUTATIONS=1 BASE_URL=http://127.0.0.1:8092 npm run e2e -- --project=chromium` | Passed | 7 Playwright tests passed on 2026-04-30 after narrowing a strict locator to the model-scope checkbox. |
| Non-root container | `docker exec llama-swap-web-prod1 id -u` | Passed | Runtime UID is `10001`. |
| Path safety | Upload/download/apply cannot escape `/models`, `/data`, `/backups`, `/tmp` | Passed | Upload streaming/path tests, HF nested-path and symlink tests, config apply/restore backup path tests, and Docker temp-mounted config smoke all passed. |
| Secret safety | HF token never appears in API, UI, logs, or committed files | Passed | API token save/clear/redaction tests, settings E2E token-render test, and `bash scripts/secret-scan.sh` passed. |

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
| Backup restore missing | Config/YAML Agent / Frontend Workflow Agent | Backup list and restore API/UI create a current backup before restore | Backend + frontend + container smoke |
| Download job cleanup missing | Download/HF Agent | Cleanup endpoint removes completed/failed/cancelled jobs but leaves active jobs | Backend tests |
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
- Added config backup list/restore API and Config Preview UI restore controls; restore creates a new backup of the current config before replacement.
- Added safer Hugging Face download placement that preserves nested paths, rejects traversal/Windows paths/symlink escapes, records container file paths, preflights disk space, cleans terminal jobs, and applies `max_parallel_downloads` changes at runtime.
- Added atomic HF token env-file writes, removed process-wide token mutation from token save/clear behavior, and added `scripts/secret-scan.sh`.
- Fixed Managed Models editor regressions for textarea list editing, numeric flag normalization, and frontend `--n-gpu-layers` command preview.
- Added detailed docs/wiki pages and updated README and in-app Help for production Docker, native development, settings, model workflows, GPU planning, config apply, backup restore, troubleshooting, and release QA.

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

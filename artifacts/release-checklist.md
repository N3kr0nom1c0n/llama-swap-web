# Release Checklist

This file tracks the proof required before llama-swap-web is considered production-ready for the LAN rig workflow.

## Gate Status

| Gate | Command / Evidence | Status | Notes |
| --- | --- | --- | --- |
| Backend tests | `./.venv/bin/pytest backend/tests -q` | Passed | 58 passed on 2026-04-30 after Phase 2 config/apply safety fixes. |
| Frontend tests | `npm test` | Passed | 7 passed on 2026-04-30 after Help text update. |
| Frontend build | `npm run build` | Passed | Vite production build passed on 2026-04-30. |
| Compose validation | `docker compose -f compose.example.yml config` | Passed | Compose example rendered on 2026-04-30. |
| Docker build | `docker build -t llama-swap-web:qa .` | Blocked | Local Docker daemon socket unavailable: `unix:///Users/n3kr0/.docker/run/docker.sock`. Run on rig or CI. |
| Container smoke | `/api/health`, `/api/state`, upload, preview, apply, replay reject | Pending | Must use temp mounts. |
| Browser smoke | Import, Managed Models, GPU Planner, Config Preview, Settings, Help | Pending | Playwright once available, manual screenshots until then. |
| Path safety | Upload/download/apply cannot escape `/models`, `/data`, `/backups`, `/tmp` | Partial | Upload and config path escape tests pass; download path safety and container smoke still pending. |
| Secret safety | HF token never appears in API, UI, logs, or committed files | Partial | API token save/clear tests pass; final secret scan still required before release. |

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

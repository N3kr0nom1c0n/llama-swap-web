# Llama-Swap Web Production Hardening And Guided Workflow Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn llama-swap-web from a working prototype into a production-ready LAN manager that removes the manual llama.cpp/llama-swap friction: resolve or upload model files, download them safely into the correct folder, create a managed model entry, plan GPU placement, preview matrix config, backup and apply config, and give the user clear next actions.

**Architecture:** Keep the existing FastAPI + React/Vite + SQLite + Docker architecture. Add missing backend contracts for inventory, config safety, download artifacts, and health. Refactor the frontend from isolated pages into a guided lifecycle while keeping advanced controls exposed.

**Tech Stack:** FastAPI, SQLite, Pydantic, huggingface_hub, ruamel.yaml, React, Vite, TypeScript, TanStack Query, Vitest, Testing Library, Playwright, Docker, GitHub Actions, GHCR.

---

## Operating Rules

- [ ] Keep v1 LAN-only with no login/auth UI. Production hardening means secret safety, path safety, scoped CORS, non-root container, backups, and reliable QA gates.
- [ ] Do not add automatic llama-swap restarts during config apply. Docker socket access, if present, must be explicit operator opt-in for a manual restart button.
- [ ] Generated llama-swap commands must use container paths like `/models/...`, never host paths.
- [ ] Generated config must use llama-swap `matrix`; do not reintroduce legacy `groups`.
- [ ] HF tokens must never be returned by API responses, rendered in the UI, logged, or committed.
- [ ] Every phase must ship with tests or a documented manual QA artifact. Failed QA loops back to planning before code changes continue.
- [ ] Agents working in parallel must own disjoint file sets. Shared files require coordinator sequencing.

## Agent Roles

- **Coordinator / Planning Agent**
  - Owns phase order, merge sequencing, issue triage, final integration, and release decisions.
  - Writes focused fix packets when QA or review fails.

- **Backend Safety Agent**
  - Owns `backend/app/main.py`, `backend/app/schemas.py`, `backend/app/settings.py`, upload handling, CORS, token request schemas, path validation, and API-level tests.

- **Config/YAML Agent**
  - Owns `backend/app/config_service.py`, staged config logic, backups, command rendering, matrix rendering, hook preservation, and config tests.

- **Download/HF Agent**
  - Owns `backend/app/hf_service.py`, `backend/app/downloads.py`, HF file classification, download lifecycle, upload/download file placement, and download tests.

- **Inventory/Model Agent**
  - Owns `backend/app/database.py`, model file inventory, config import contracts, `/models` scan behavior, managed model creation from completed downloads, and migration tests.

- **Frontend Workflow Agent**
  - Owns `frontend/src/pages/ImportModelPage.tsx`, `ModelsPage.tsx`, `ConfigPreviewPage.tsx`, `DashboardPage.tsx`, workflow components, API types, and frontend interaction tests.

- **GPU Planner Agent**
  - Owns GPU detection/planning backend endpoints plus `frontend/src/pages/GpuPlannerPage.tsx`, GPU validation, tensor split recommendations, and planner tests.

- **Ops/Release Agent**
  - Owns `Dockerfile`, `compose.example.yml`, `.github/workflows/docker.yml`, dependency files, `README.md`, `.env.example`, healthcheck wiring, Docker QA, and release notes.

- **Spec Reviewer Agent**
  - Rejects patches that add login requirements, Docker socket use, auto restart, legacy `groups`, host paths in generated commands, token exposure, or destructive config apply behavior.

- **QA Agent**
  - Runs narrow gates for each phase and final end-to-end gates. On failure, returns exact command, output, suspected scope, and artifacts to the Coordinator.

---

## Phase 0: Repo Sync And QA Contract

**Purpose:** Commit the plan, backlog, and Claude findings so GitHub is the shared source of truth before implementation starts.

**Coordinator owns:** `BACKLOG.md`, `claude-findings.md`, this plan file.

- [ ] Commit current backlog and Claude findings.
- [ ] Add this phased implementation plan.
- [ ] Push to GitHub before functional code changes.
- [ ] Create an implementation branch after the plan sync.
- [ ] Create `artifacts/release-checklist.md` before final release work starts. It should map issue -> owner -> proof -> gate command -> artifact.

**Acceptance:**

- [ ] `git status --short --branch` is clean after the plan push.
- [ ] GitHub has the backlog, Claude findings, and plan.
- [ ] Functional implementation begins from a synced baseline.

---

## Phase 1: Critical Safety And Deployment Blockers

**Purpose:** Fix the highest-risk production blockers before building more workflow on top of them.

### Packet 1A: Dependency And Image Contract

**Ops/Release Agent owns:** `requirements.txt`, `pyproject.toml`, `.github/workflows/docker.yml`, `compose.example.yml`, `README.md`.

- [ ] Add direct `pydantic` dependency to both Python dependency manifests.
- [ ] Fix GHCR tag behavior so documented tags actually publish. Preferred: publish `latest` from `main` and semver tags from release tags.
- [ ] Make README and Compose tag examples match the workflow.
- [ ] Validate Compose example with sample environment values.

**Acceptance:**

- [ ] Backend imports in a clean install.
- [ ] Docker workflow emits `latest` on `main` and does not push image tags for untrusted PRs.
- [ ] `docker compose -f compose.example.yml config` resolves.

### Packet 1B: Non-Root Container And Safe Runtime Mounts

**Ops/Release Agent owns:** `Dockerfile`, `compose.example.yml`, `.env.example`, `README.md`.

- [ ] Run the final image as a non-root user.
- [ ] Document host bind-mount ownership and UID/GID strategy.
- [ ] Remove host `/tmp:/tmp` from the recommended Compose file.
- [ ] Default download temp/cache to `/data/tmp` and `/data/hf-cache`.
- [ ] Add a Docker or Compose healthcheck after the health endpoint exists.

**Acceptance:**

- [ ] `docker run --rm --entrypoint id llama-swap-web:qa -u` reports a non-zero UID.
- [ ] `/models`, `/data`, `/backups`, and config writes work when host permissions are correct.
- [ ] No recommended deployment mounts host `/tmp` into the app container.

### Packet 1C: Upload Streaming, Limits, And Path Safety

**Backend Safety Agent owns:** `backend/app/main.py`, `backend/app/settings.py`, `backend/app/schemas.py`, upload tests.

- [ ] Add `max_upload_bytes` and allowed upload extensions to persisted settings.
- [ ] Stream uploads in chunks instead of buffering whole files.
- [ ] Reject path traversal, absolute paths, unsafe nested paths, unsupported extensions, and symlink escapes.
- [ ] Clean up partial files on failure.
- [ ] Return `413` for oversized uploads.

**Acceptance:**

- [ ] Pytest proves chunked upload behavior without committing huge fixtures.
- [ ] Upload traversal attempts fail and leave no files behind.
- [ ] Successful upload maps to the expected `/models/<role>/<model>/...` path.

### Packet 1D: Scoped CORS And Health

**Backend Safety Agent and Ops/Release Agent own:** `backend/app/main.py`, `backend/app/settings.py`, `.env.example`, Docker/Compose docs.

- [ ] Replace wildcard CORS with configured allowed origins for dev while production uses same-origin.
- [ ] Add `/api/health` with app, DB, config path, model root, and backup path status.
- [ ] Wire health into Docker/Compose after the endpoint lands.

**Acceptance:**

- [ ] Unknown Origins do not get `access-control-allow-origin`.
- [ ] Vite dev origin is allowed when configured.
- [ ] `GET /api/health` returns actionable JSON.

**Phase 1 Gates:**

```sh
./.venv/bin/pytest backend/tests -q
npm test
npm run build
docker compose -f compose.example.yml config
docker build -t llama-swap-web:qa .
```

---

## Phase 2: Config Safety And Data Loss Prevention

**Purpose:** Make preview/apply trustworthy before the UI encourages users to write config files.

### Packet 2A: Read-Only Preview And Model Scope

**Config/YAML Agent owns:** `backend/app/config_service.py`, `backend/app/main.py`, config/API tests.

- [ ] Make config preview honor `ConfigPreviewRequest.model_ids`.
- [ ] Split path validation from path creation so preview never creates directories.
- [ ] Handle missing or unreadable current config with controlled errors.
- [ ] Preview selected models only when requested.

**Acceptance:**

- [ ] Preview with missing directories does not create them.
- [ ] Scoped preview includes only selected models.
- [ ] Missing config does not return an unhandled 500.

### Packet 2B: Render Fidelity

**Config/YAML Agent owns:** `backend/app/config_service.py`.

- [ ] Quote command arguments safely when values contain whitespace or shell-sensitive characters.
- [ ] Preserve existing hooks and update only `hooks.on_startup.preload` when needed.
- [ ] Preserve unrelated existing matrix/global config sections where practical.
- [ ] Ensure no `groups` section is emitted.

**Acceptance:**

- [ ] `shlex.split` round-trips generated commands with spaces in paths.
- [ ] Custom hooks survive generation.
- [ ] Tests assert no legacy `groups` output.

### Packet 2C: Atomic Apply And Staged Config Lifecycle

**Inventory/Model Agent and Config/YAML Agent own:** `backend/app/database.py`, `backend/app/config_service.py`, `backend/app/main.py`.

- [ ] Add schema migration support before changing staged config storage.
- [ ] Add stage expiry, one-time apply, and fingerprint validation.
- [ ] Create unique timestamped backups, even for multiple applies in one second.
- [ ] Write config atomically using a temp file in the same directory and `os.replace`.
- [ ] Block destructive empty config apply unless a future explicit destructive confirmation is implemented.
- [ ] Add backup restore endpoint or at least restore-ready backend service before calling config apply production-ready.

**Acceptance:**

- [ ] Two applies in one second create distinct backup files.
- [ ] Reusing a stage ID fails.
- [ ] Expired or stale stages fail with 409/404.
- [ ] Empty managed DB cannot wipe a non-empty config by default.

**Phase 2 Gates:**

```sh
./.venv/bin/pytest backend/tests/test_config_service.py backend/tests/test_api.py -q
./.venv/bin/pytest backend/tests -q
```

---

## Phase 3: HF Import, Downloads, And Model Inventory

**Purpose:** Close the gap where a downloaded model does not become an installed, usable managed model.

### Packet 3A: HF File Placement And Download Lifecycle

**Download/HF Agent owns:** `backend/app/hf_service.py`, `backend/app/downloads.py`, download tests.

- [ ] Preserve safe Hugging Face subpaths instead of flattening all files by basename.
- [ ] Reject absolute paths, `..`, and symlink escapes.
- [ ] Avoid silent overwrites and basename collisions.
- [ ] Add disk preflight before downloads and uploads.
- [ ] Expose written host/container paths on completed jobs.
- [ ] Clean download manager in-memory job IDs after finish/cancel/retry.
- [ ] Make max parallel download changes apply to future jobs without restart.

**Acceptance:**

- [ ] `a/model.gguf` and `b/model.gguf` download into different safe paths.
- [ ] Traversal filenames fail.
- [ ] Completed jobs expose exact file paths and next actions.
- [ ] Cancel/retry leaves no stale in-memory state.

### Packet 3B: Create Model From Download

**Inventory/Model Agent owns:** `backend/app/main.py`, `backend/app/schemas.py`, `backend/app/database.py`, model tests.

- [ ] Add `POST /api/models/from-download/{job_id}`.
- [ ] Use completed download metadata to prefill name, role, primary GGUF, mmproj, chat template, tokenizer files, and container paths.
- [ ] Store associated rows in `model_files`.
- [ ] Return actionable errors if the job is not complete or files are missing.

**Acceptance:**

- [ ] A completed download can become a managed model without manual path lookup.
- [ ] Incomplete/failed jobs cannot create a model.
- [ ] Missing downloaded files are reported before model creation.

### Packet 3C: Scan Existing Models And Import Current Config

**Inventory/Model Agent owns:** `backend/app/main.py`, `backend/app/database.py`, `backend/app/schemas.py`, scan/import tests.

- [ ] Add a safe `/api/files/scan` or `/api/models/scan` endpoint scoped to `/models`.
- [ ] Classify GGUF, multipart GGUF, mmproj, chat templates, tokenizer files, and loose companions.
- [ ] Add current `config.yaml` import endpoint that returns managed-model candidates without applying them.
- [ ] Mark downloaded-but-unmanaged files as first-class dashboard actions.

**Acceptance:**

- [ ] Scanner rejects traversal and symlinks outside model root.
- [ ] Existing model folders become selectable managed-model candidates.
- [ ] Existing llama-swap config entries can be reviewed before import.

**Phase 3 Gates:**

```sh
./.venv/bin/pytest backend/tests/test_hf_service.py backend/tests/test_api.py -q
./.venv/bin/pytest backend/tests -q
```

---

## Phase 4: Guided Frontend Lifecycle

**Purpose:** Make the app behave like an actual model manager instead of a set of disconnected forms.

### Packet 4A: Frontend Trust Fixes

**Frontend Workflow Agent owns:** `frontend/src/api.ts`, `frontend/src/queryKeys.ts`, `frontend/src/Layout.tsx`, `frontend/src/pages/DashboardPage.tsx`, shared tests.

- [ ] Fix non-JSON API error parsing.
- [ ] Add an API unreachable banner/state.
- [ ] Remove duplicate polling and normalize query keys.
- [ ] Make Dashboard show next actions instead of raw download history.

**Acceptance:**

- [ ] API-down UI does not look like a healthy empty state.
- [ ] HTML/text error bodies are visible enough to debug.
- [ ] Dashboard shows active/failing downloads and blockers, not stale completed history as the main content.

### Packet 4B: Model Editor Correctness

**Frontend Workflow Agent owns:** `frontend/src/pages/ModelsPage.tsx`, `frontend/src/utils.ts`, `frontend/src/types.ts`.

- [ ] Rename Models page to Managed Models.
- [ ] Add `--n-gpu-layers` to generated command UI.
- [ ] Normalize numeric flag payloads.
- [ ] Preserve textarea draft strings until save.
- [ ] Prevent background refetch from overwriting dirty drafts.
- [ ] Add duplicate/delete and missing-file warning flows.

**Acceptance:**

- [ ] Tests cover trailing newline preservation, numeric JSON payloads, dirty refetch protection, duplicate, delete, and generated command parity.

### Packet 4C: Guided Import Stepper

**Frontend Workflow Agent owns:** `frontend/src/pages/ImportModelPage.tsx`, workflow components, API types.

- [ ] Replace vague "Stage Import" with a lifecycle stepper: Resolve -> Select files -> Destination preview -> Download -> Create/attach model -> Preview config.
- [ ] Direct HF file URLs select only that file plus companions.
- [ ] Quant repos require one quant family.
- [ ] Multipart GGUF auto-selects all shards.
- [ ] Completed jobs show written paths and Create Model / Attach Existing actions.
- [ ] Move full download queue/history to Import, not Dashboard.

**Acceptance:**

- [ ] Import tests cover direct-file selection, multipart selection, completed job actions, progress bars, and path display.

### Packet 4D: Settings UX And Form Safety

**Frontend Workflow Agent owns:** `SettingsPage.tsx`, `GpuPlannerPage.tsx`, `Field.tsx`, `CodeBlock.tsx`, `StatusPill.tsx`.

- [ ] Add unsaved-change guards where a refetch or route change could lose edits.
- [ ] Clear stale success/error messages when fields change.
- [ ] Add restart-required badges for settings that will not affect current containers until restart.
- [ ] Add path/HF/config-write test buttons after backend endpoints exist.
- [ ] Constrain dropdown values such as `flash_attn`.
- [ ] Improve HTTP clipboard fallback.

**Acceptance:**

- [ ] Frontend tests cover invalid numeric values, stale success clearing, clipboard fallback, restart badges, and navigation guards.

**Phase 4 Gates:**

```sh
npm test
npm run build
```

---

## Phase 5: GPU Planner Intelligence

**Purpose:** Make multi-GPU planning understandable and reduce bad llama-server configs.

### Packet 5A: GPU Detection And Live Status

**GPU Planner Agent owns:** backend GPU endpoints, `GpuPlannerPage.tsx`, tests.

- [ ] Add GPU detect endpoint using `nvidia-smi` when available, with a clear unavailable state in non-NVIDIA/dev environments.
- [ ] Add live VRAM/process status endpoint.
- [ ] Avoid fake default dual-3090 assumptions on first run.
- [ ] Allow user labels/roles/notes to persist over detected hardware.

**Acceptance:**

- [ ] Detection works when `nvidia-smi` is present and degrades clearly when absent.
- [ ] Tests cover detected GPU import and stable row keys.

### Packet 5B: Recommendations And Validation

**GPU Planner Agent and Frontend Workflow Agent own:** planner backend, Managed Models, GPU Planner.

- [ ] Estimate model file size and KV cache pressure from configured context/cache settings where feasible.
- [ ] Recommend CUDA devices, main GPU, and tensor split.
- [ ] Warn when main GPU is not included in visible devices.
- [ ] Warn when tensor split length does not match visible devices.
- [ ] Surface overcommit warnings before config apply.

**Acceptance:**

- [ ] Selecting two GPUs proposes a split.
- [ ] Invalid main GPU/tensor split blocks config-ready status.
- [ ] Overcommit appears as a warning, not a silent failure.

**Phase 5 Gates:**

```sh
./.venv/bin/pytest backend/tests -q
npm test
npm run build
```

---

## Phase 6: End-To-End Browser QA And Release Pipeline

**Purpose:** Prove the core app works the way the user will actually use it.

### Packet 6A: Playwright Browser Smoke

**QA Agent owns:** Playwright config, e2e tests, artifacts.

- [ ] Add `npm run e2e`.
- [ ] Test Dashboard API-down and healthy states.
- [ ] Test Import Model mocked HF resolve -> select -> download -> completed files.
- [ ] Test Managed Models create/edit with dirty draft protection.
- [ ] Test GPU Planner edit/save and warning display.
- [ ] Test Config Preview generate/apply/stale-stage behavior.
- [ ] Test Settings token save without token echo.
- [ ] Test Help page loads and search/navigation works.

**Acceptance:**

- [ ] Playwright report includes screenshots/traces on failure.
- [ ] Browser console and network errors are captured.

### Packet 6B: Docker And Container Smoke

**Ops/Release Agent and QA Agent own:** Dockerfile, Compose, CI smoke scripts.

- [ ] Build the final image.
- [ ] Run a container with temp-mounted `/models`, `/data`, `/backups`, and `/app/config.yaml`.
- [ ] Curl `/api/health` and `/api/state`.
- [ ] Upload a small test file.
- [ ] Preview config.
- [ ] Apply once and verify backup creation.
- [ ] Reject stage replay.
- [ ] Confirm writes cannot escape `/models`, `/data`, `/backups`, `/tmp`.
- [ ] Confirm non-root file ownership behavior.

**Acceptance:**

- [ ] Docker smoke produces container logs, state JSON, generated config, backup file listing, and file ownership listing.

### Packet 6C: GitHub Actions Release Gates

**Ops/Release Agent owns:** `.github/workflows/docker.yml`, optional test workflow files.

- [ ] Add backend test job.
- [ ] Add frontend test job.
- [ ] Add frontend build job.
- [ ] Add Docker build job for PRs.
- [ ] Add Compose validate job.
- [ ] Add container smoke job.
- [ ] Add Playwright smoke once stable.
- [ ] Publish only after all required gates pass.

**Acceptance:**

- [ ] PRs run tests/build/smoke without publishing.
- [ ] `main` publishes expected GHCR tags after gates pass.
- [ ] Release notes and README match image tags and upgrade steps.

**Final Gates:**

```sh
./.venv/bin/pytest backend/tests -q
npm test
npm run build
npm run e2e -- --project=chromium
docker build -t llama-swap-web:qa .
docker compose -f compose.example.yml config
```

Final manual/browser check:

- [ ] Open the app on LAN port `8081`.
- [ ] Resolve a HF URL without showing the HF token.
- [ ] Download/stage a model into `/models/<role>/<model>/...`.
- [ ] Create a managed model from that completed download.
- [ ] Plan GPU placement.
- [ ] Preview matrix config using `/models/...` paths.
- [ ] Apply config and verify timestamped backup.
- [ ] Confirm llama-swap restart remains a separate manual action in v1.

---

## Failure Loop

When QA fails:

- [ ] QA Agent records exact command, output, artifact path, expected behavior, and observed behavior.
- [ ] Coordinator converts the failure into a focused fix packet.
- [ ] Coding Agent preserves or adds the failing test first where practical.
- [ ] Spec Reviewer checks against the locked product rules.
- [ ] Code Reviewer checks maintainability, path safety, async/job behavior, token redaction, and UI correctness.
- [ ] QA reruns the narrow failing gate.
- [ ] QA reruns the full phase gate that caught the issue.
- [ ] Phase promotion resumes only after artifacts are regenerated and checked off.

## Immediate Implementation Order After Plan Push

1. [ ] Create implementation branch `codex/production-hardening`.
2. [ ] Start Phase 1A and 1B in the Ops/Release Agent because they have isolated file ownership.
3. [ ] Start Phase 1C in the Backend Safety Agent with tests first.
4. [ ] Coordinator locally handles or sequences Phase 1D if it conflicts with Phase 1C.
5. [ ] Run Phase 1 gates.
6. [ ] If Phase 1 passes, continue to Phase 2 config safety before larger UI workflow changes.

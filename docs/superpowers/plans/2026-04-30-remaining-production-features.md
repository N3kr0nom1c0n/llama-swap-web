# Remaining Production Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish llama-swap-web as a production-ready LAN manager that guides a user from model discovery/download/import through managed model setup, GPU planning, config preview/apply, recovery, and release-quality validation.

**Architecture:** Keep the FastAPI/SQLite/React/Vite single-container architecture. Add missing product behavior through bounded backend services and guided frontend workflows rather than a rewrite. Treat config/data loss prevention, workflow automation, GPU intelligence, reliability, and release QA as separate agent-owned streams that merge only through explicit API contracts and shared tests.

**Tech Stack:** FastAPI, SQLite, Pydantic, ruamel.yaml, huggingface_hub, React, Vite, TypeScript, TanStack Query, Vitest, Testing Library, Playwright, Docker, GitHub Actions, GHCR.

---

## Current Baseline

Branch: `codex/production-hardening`

Known passing evidence from the latest local Docker run:

- `./.venv/bin/pytest backend/tests -q`: 81 passed.
- `npm test`: 9 passed.
- `npm run build`: passed.
- `docker build -t llama-swap-manager:phase3 .`: passed.
- Temp-mounted Docker smoke on `127.0.0.1:8092`: `/api/health`, `/api/state`, `/api/settings`, `/api/gpus`, `/api/models`, `/api/models/scan`, `/api/downloads`, frontend routes, static assets, upload, config preview, config apply, backup creation, and HF token redaction passed.
- Commit `567ee9f` fixed single-file Docker bind-mounted `/app/config.yaml` apply behavior.

Known gaps still requiring implementation:

- Guided lifecycle is not complete enough: existing downloads, scanned files, and config entries still need a first-class path into usable managed models.
- Existing `config.yaml` import does not exist.
- GPU planning is mostly user-entered metadata, not detection/recommendation.
- Recovery/audit features are not complete.
- Browser e2e and CI release gates are not complete.

## Agent Roster And Ownership

Use multiple agents only where write sets are disjoint. The coordinator owns sequencing, merge review, and final QA.

### Coordinator / Planning Agent

Owns:

- `docs/superpowers/plans/*`
- `artifacts/release-checklist.md`
- Phase boundaries, failure reports, and final acceptance.

Responsibilities:

- Break each phase into one packet per agent.
- Prevent overlapping writes.
- Convert QA failures into focused fix packets.
- Stop the phase if a failure affects data safety, config writes, token safety, or Docker runtime behavior.

### Config Safety And Recovery Agent

Owns:

- `backend/app/config_service.py`
- `backend/app/main.py` config preview/apply/restore routes only
- `backend/tests/test_config_service.py`
- config/apply sections of `backend/tests/test_api.py`
- `frontend/src/pages/ConfigPreviewPage.tsx`
- `frontend/src/pages/ConfigPreviewPage.test.tsx`

Responsibilities:

- Destructive diff detection.
- Backup listing and restore.
- Current config linting.
- Config ownership/import warnings.

### Inventory And Import Agent

Owns:

- `backend/app/model_inventory.py`
- new `backend/app/config_import.py`
- model/import sections of `backend/app/main.py`
- inventory/import sections of `backend/tests/test_api.py`
- `frontend/src/pages/ModelsPage.tsx`
- new import-current-config UI components/tests.

Responsibilities:

- Safe `/models` scanner.
- Existing config parser/import candidate generation.
- Managed model creation from existing files/config entries.
- File health metadata.

### Download Reliability Agent

Owns:

- `backend/app/downloads.py`
- `backend/app/hf_service.py`
- download sections of `backend/tests/test_hf_service.py`
- download sections of `backend/tests/test_api.py`
- download job portions of `frontend/src/pages/ImportModelPage.tsx`

Responsibilities:

- Persistent HF cache usage.
- Disk preflight before download.
- Queue cleanup and stale job handling.
- Resume/cancel/retry reliability.
- Written-file metadata and safe per-model destinations.

### GPU Intelligence Agent

Owns:

- new `backend/app/gpu_service.py`
- GPU routes in `backend/app/main.py`
- GPU tests in `backend/tests/test_api.py`
- `frontend/src/pages/GpuPlannerPage.tsx`
- new `frontend/src/pages/GpuPlannerPage.test.tsx`

Responsibilities:

- `nvidia-smi` detection and graceful unavailable state.
- Live VRAM/process status.
- Fit estimate and tensor split recommendation.
- Config-blocking GPU validation warnings.

### Frontend Workflow Agent

Owns:

- `frontend/src/Layout.tsx`
- `frontend/src/pages/DashboardPage.tsx`
- `frontend/src/pages/ImportModelPage.tsx`
- `frontend/src/pages/ModelsPage.tsx`
- `frontend/src/pages/SettingsPage.tsx`
- `frontend/src/helpContent.ts`
- shared UI components under `frontend/src/components/*`
- related frontend tests.

Responsibilities:

- Guided lifecycle UX.
- Dashboard next actions.
- Rename Models to Managed Models.
- Inline help/tooltips.
- Settings test buttons and restart badges.
- API error states.

### Ops And QA Agent

Owns:

- `Dockerfile`
- `compose.example.yml`
- `.github/workflows/*`
- `package.json`
- Playwright config and e2e files
- `README.md`
- release docs and QA artifacts under `artifacts/qa/*`

Responsibilities:

- CI gates.
- Docker build/smoke scripts.
- Browser e2e.
- GHCR release validation.
- Compose and upgrade docs.

## Mandatory Failure Loop

Every phase follows the same loop:

1. Planning Agent writes a packet with owner, files, tests, and acceptance criteria.
2. Coding Agent implements only its packet.
3. Spec Reviewer rejects changes that add login requirements, Docker socket access, automatic llama-swap restart, legacy `groups`, host paths in generated commands, token exposure, or unsafe config applies.
4. Code Reviewer checks maintainability, path safety, token redaction, async/job behavior, UI correctness, and test quality.
5. QA Agent runs narrow tests first, then the full phase gate.
6. On failure, QA writes this report:

```text
Gate:
Command:
Expected:
Actual:
Suspected owner:
Artifact paths:
Next fix packet:
```

7. Planning Agent converts the report into a focused fix packet.
8. Coding Agent patches with a failing test first where practical.
9. Reviewers re-check.
10. QA reruns the narrow failing gate, then the full phase gate.

No phase is promoted while a failing gate is unexplained.

## Phase 0: Plan And Checklist Sync

**Purpose:** Make the implementation source of truth current before new feature work.

**Owner:** Coordinator / Planning Agent

**Files:**

- Modify: `artifacts/release-checklist.md`
- Modify: `BACKLOG.md` only if completed items need to move from open to done
- Create: `artifacts/qa/phase-0-baseline.md`

**Steps:**

- [ ] Record the latest local QA evidence:

```bash
./.venv/bin/pytest backend/tests -q
npm test
npm run build
docker build -t llama-swap-web:phase0 .
docker compose -f compose.example.yml config
```

- [ ] Run a container smoke with temp mounts:

```bash
mkdir -p /tmp/lsm-phase0-models/chat/smoke /tmp/lsm-phase0-backups /tmp/lsm-phase0-data /tmp/lsm-phase0-tmp
touch /tmp/lsm-phase0-config.yaml /tmp/lsm-phase0-models/chat/smoke/smoke.gguf
chmod -R 777 /tmp/lsm-phase0-models /tmp/lsm-phase0-backups /tmp/lsm-phase0-data /tmp/lsm-phase0-tmp /tmp/lsm-phase0-config.yaml
docker run --rm -d --name llama-swap-web-phase0 -p 127.0.0.1:8092:8081 \
  -e APP_HOST=0.0.0.0 \
  -e APP_PORT=8081 \
  -e MANAGER_MODEL_ROOT=/models \
  -e LLAMA_SWAP_MODEL_ROOT=/models \
  -e LLAMA_SWAP_CONFIG_PATH=/app/config.yaml \
  -e BACKUPS_DIR=/backups \
  -e DOWNLOAD_TEMP_DIR=/data/tmp \
  -v /tmp/lsm-phase0-models:/models \
  -v /tmp/lsm-phase0-config.yaml:/app/config.yaml \
  -v /tmp/lsm-phase0-backups:/backups \
  -v /tmp/lsm-phase0-data:/data \
  -v /tmp/lsm-phase0-tmp:/tmp \
  llama-swap-web:phase0
curl -s http://127.0.0.1:8092/api/health
curl -s http://127.0.0.1:8092/api/state
curl -s http://127.0.0.1:8092/api/models/scan
curl -s http://127.0.0.1:8092/settings
docker stop llama-swap-web-phase0
```

- [ ] Update the release checklist with exact pass/fail evidence.
- [ ] Commit only documentation/checklist changes.

**Acceptance:**

- `artifacts/release-checklist.md` no longer claims Docker is blocked if Docker passes.
- The next implementation phase starts from a clean `git status --short --branch`.

## Phase 1: Release QA Harness

**Purpose:** Put repeatable browser, Docker, and CI gates in place before large workflow changes.

**Parallel agents:** Ops And QA Agent can work independently from Config Safety Agent as long as it only touches QA/ops files.

### Packet 1A: Playwright Browser Smoke

**Owner:** Ops And QA Agent

**Files:**

- Create: `playwright.config.ts`
- Create: `frontend/e2e/app-smoke.spec.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `artifacts/qa/README.md`

**Steps:**

- [ ] Add scripts:

```json
{
  "e2e": "playwright test",
  "e2e:ui": "playwright test --ui"
}
```

- [ ] Add Playwright tests for:
  - Dashboard healthy state.
  - Import Model page loads and shows source controls.
  - Managed Models page loads.
  - GPU Planner page loads.
  - Config Preview page can generate a preview with seeded API data.
  - Settings token control never displays raw token.
  - Help search/navigation loads.

- [ ] Run:

```bash
npm run e2e -- --project=chromium
```

**Acceptance:**

- Playwright report includes screenshots/traces on failure.
- Browser console errors fail the test unless explicitly allowlisted.

### Packet 1B: CI Quality Gates

**Owner:** Ops And QA Agent

**Files:**

- Modify: `.github/workflows/docker.yml`
- Create: `.github/workflows/ci.yml`
- Modify: `README.md`

**Steps:**

- [ ] Add CI jobs:
  - backend tests
  - frontend tests
  - frontend build
  - Docker build
  - Compose config validation
  - container smoke with temp mounts
  - Playwright smoke after the container starts

- [ ] Keep GHCR publish restricted:
  - pull requests build but do not publish
  - `main` publishes `latest`
  - tags `v*` publish semver tags

- [ ] Run locally where possible:

```bash
docker build -t llama-swap-web:ci .
docker compose -f compose.example.yml config
```

**Acceptance:**

- CI can fail before publish.
- README deployment commands match actual tags.

## Phase 2: Data Loss Prevention, Restore, And Audit

**Purpose:** Make config ownership safe enough for real llama-swap configs.

**Parallel agents:** Config Safety And Recovery Agent and Frontend Workflow Agent can split backend/API and UI after API contracts are locked.

### Packet 2A: Destructive Diff Detection

**Owner:** Config Safety And Recovery Agent

**Files:**

- Modify: `backend/app/config_service.py`
- Modify: `backend/app/schemas.py`
- Modify: `backend/tests/test_config_service.py`
- Modify: `backend/tests/test_api.py`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/pages/ConfigPreviewPage.tsx`
- Create: `frontend/src/pages/ConfigPreviewPage.test.tsx`

**Backend behavior:**

- Detect removals of existing:
  - model IDs
  - matrix vars
  - matrix sets
  - hooks
  - startup preload entries
  - aliases
  - top-level settings such as `healthCheckTimeout`, `logLevel`, `sendLoadingState`, `includeAliasesInList`
- Return structured warnings:

```ts
type DestructiveChange = {
  kind: "model_removed" | "matrix_removed" | "hook_removed" | "global_removed" | "alias_removed";
  path: string;
  before: string;
};
```

- Block apply when destructive changes exist unless `confirm_destructive: true` is supplied.

**Tests:**

```bash
./.venv/bin/pytest backend/tests/test_config_service.py backend/tests/test_api.py -q
npm test -- ConfigPreviewPage
```

**Acceptance:**

- Empty generated config cannot wipe a non-empty config.
- Removing one existing unmanaged model produces a visible warning.
- Apply without destructive confirmation returns `409`.

### Packet 2B: Backup Restore

**Owner:** Config Safety And Recovery Agent

**Files:**

- Modify: `backend/app/config_service.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/schemas.py`
- Modify: `backend/tests/test_api.py`
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/pages/ConfigPreviewPage.tsx`

**API:**

- `GET /api/config/backups`: list backup files under `/backups`.
- `POST /api/config/restore`: restore one listed backup after making a pre-restore backup.

**Safety:**

- Backup path must resolve inside configured `/backups`.
- Restore target is always configured `llama_swap_config_path`.
- UI labels restore as manual restart required.

**Tests:**

```bash
./.venv/bin/pytest backend/tests/test_api.py::test_config_backup_restore -q
npm test -- ConfigPreviewPage
```

**Acceptance:**

- Restore cannot read outside `/backups`.
- Restore creates a backup of the current config first.

### Packet 2C: Audit Log And Secret Safety

**Owner:** Config Safety And Recovery Agent

**Files:**

- Create: `backend/app/audit.py`
- Modify: `backend/app/database.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_api.py`
- Modify: `frontend/src/pages/SettingsPage.tsx`
- Modify: `frontend/src/pages/HelpPage.tsx`

**Events:**

- settings saved
- HF token saved/cleared
- download started/cancelled/retried/completed/failed
- model created/updated/deleted
- config preview generated
- config applied
- backup restored

**Tests:**

```bash
./.venv/bin/pytest backend/tests/test_api.py -q
rg -n "hf_[A-Za-z0-9_\\-]{8,}|HF_TOKEN=.*[A-Za-z0-9]" . --glob '!package-lock.json'
```

**Acceptance:**

- Audit log contains event type, timestamp, entity ID, and redacted metadata.
- No raw HF token appears in API responses, audit rows, frontend text, or test artifacts.

## Phase 3: Existing Install Import And File Inventory

**Purpose:** Stop forcing the user to manually bridge existing files/config into the manager.

**Parallel agents:** Inventory And Import Agent owns backend contracts; Frontend Workflow Agent starts UI only after endpoint response shapes are stable.

### Packet 3A: Existing Config Import

**Owner:** Inventory And Import Agent

**Files:**

- Create: `backend/app/config_import.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/schemas.py`
- Modify: `backend/tests/test_api.py`
- Create: `backend/tests/test_config_import.py`

**API:**

- `GET /api/config/import-candidates`: parse current `config.yaml` and return candidates without writing DB rows.
- `POST /api/config/import-candidates`: accept selected candidates and create managed models.

**Behavior:**

- Parse `models` entries.
- Extract `-m`, `--mmproj`, `--chat-template-file`, `CUDA_VISIBLE_DEVICES`, `ttl`, aliases, and matrix references.
- Mark raw command override when structured parsing is incomplete.
- Never apply config during import.

**Tests:**

```bash
./.venv/bin/pytest backend/tests/test_config_import.py backend/tests/test_api.py -q
```

**Acceptance:**

- Sean-style model entries become reviewable candidates.
- Unknown flags are preserved, not dropped.
- Existing `groups` are reported as legacy input, but generated output remains `matrix`.

### Packet 3B: File Inventory And Model Health

**Owner:** Inventory And Import Agent

**Files:**

- Modify: `backend/app/model_inventory.py`
- Modify: `backend/app/schemas.py`
- Modify: `backend/tests/test_api.py`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/pages/ModelsPage.tsx`

**Behavior:**

- Scanner groups:
  - single GGUF
  - multipart GGUF complete/incomplete
  - mmproj
  - chat template
  - tokenizer files
  - embedding/reranker hints
- Managed model health reports:
  - primary file exists
  - all shards present
  - mmproj exists
  - template exists
  - command references valid `/models/...` paths

**Tests:**

```bash
./.venv/bin/pytest backend/tests/test_api.py::test_scan_models -q
npm test -- ModelsPage
```

**Acceptance:**

- Existing model folders become selectable model candidates.
- Symlinks outside `/models` are rejected.
- Missing companion files are visible before config preview.

## Phase 4: Guided Model Lifecycle

**Purpose:** Make the app guide the user like Ollama-level simplicity instead of disconnected pages.

**Parallel agents:** Download Reliability Agent and Frontend Workflow Agent can work in parallel after the per-model destination contract is agreed.

### Packet 4A: Per-Model Install Directories And Download Actions

**Owner:** Download Reliability Agent

**Files:**

- Modify: `backend/app/downloads.py`
- Modify: `backend/app/hf_service.py`
- Modify: `backend/app/model_inventory.py`
- Modify: `backend/tests/test_hf_service.py`
- Modify: `backend/tests/test_api.py`

**Behavior:**

- HF downloads land under `/models/<role>/<model-id>/`.
- Safe HF subpaths are preserved where required.
- Same-basename files from different HF folders cannot collide.
- Disk preflight runs before job starts.
- Completed job exposes:
  - manager paths
  - container paths
  - inferred primary GGUF
  - inferred mmproj/template/tokenizers
  - next actions

**Tests:**

```bash
./.venv/bin/pytest backend/tests/test_hf_service.py backend/tests/test_api.py -q
```

**Acceptance:**

- `a/model.gguf` and `b/model.gguf` download to distinct safe paths.
- Traversal filenames fail before writing.
- Disk safety failure leaves no partial destination files attached to the job.

### Packet 4B: Import Model Lifecycle Stepper

**Owner:** Frontend Workflow Agent

**Files:**

- Modify: `frontend/src/pages/ImportModelPage.tsx`
- Modify: `frontend/src/pages/ImportModelPage.test.tsx`
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/styles.css`

**UI flow:**

1. Resolve source.
2. Select one quant family or multipart set.
3. Preview destination.
4. Download with progress.
5. Create/attach managed model.
6. Tune model basics.
7. Go to config preview.

**Tests:**

```bash
npm test -- ImportModelPage
```

**Acceptance:**

- Direct HF file URLs select only that file plus companions.
- Multipart GGUF auto-selects all shards and warns if incomplete.
- Completed jobs show `Create model`, `Attach existing`, and `Show files`.
- Full queue/history lives on Import, not Dashboard.

### Packet 4C: Managed Models Guided Editor

**Owner:** Frontend Workflow Agent

**Files:**

- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/Layout.tsx`
- Modify: `frontend/src/pages/ModelsPage.tsx`
- Create: `frontend/src/pages/ModelsPage.test.tsx`
- Modify: `frontend/src/utils.ts`
- Modify: `frontend/src/utils.test.ts`

**Behavior:**

- Rename navigation to `Managed Models`.
- Add file picker scoped to `/models`.
- Add duplicate/copy action.
- Add delete action with confirmation.
- Show model health and config-ready state.
- Keep raw command override in an advanced section.

**Tests:**

```bash
npm test -- ModelsPage
```

**Acceptance:**

- User can create a managed model from scanned files without typing paths.
- Duplicate entry can target another GPU.
- Delete removes DB entry but does not delete model files.

### Packet 4D: Dashboard Next Actions

**Owner:** Frontend Workflow Agent

**Files:**

- Modify: `frontend/src/pages/DashboardPage.tsx`
- Modify: `frontend/src/pages/DashboardPage.test.tsx`
- Modify: `frontend/src/Layout.tsx`

**Dashboard shows:**

- active downloads
- failed downloads
- downloaded but unmanaged files/jobs
- unmanaged scanned files
- config warnings
- missing model files
- next actions

**Dashboard does not show:**

- full completed download history as primary content.

**Tests:**

```bash
npm test -- DashboardPage
```

**Acceptance:**

- Dashboard is an action board, not a raw queue.
- Healthy empty state says what to do next.

## Phase 5: GPU Intelligence

**Purpose:** Make GPU planning useful for multi-GPU llama.cpp decisions.

**Parallel agents:** GPU Intelligence Agent can work mostly independently after model health metadata exists.

### Packet 5A: GPU Detection And Live Status

**Owner:** GPU Intelligence Agent

**Files:**

- Create: `backend/app/gpu_service.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/schemas.py`
- Modify: `backend/tests/test_api.py`
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/pages/GpuPlannerPage.tsx`
- Create: `frontend/src/pages/GpuPlannerPage.test.tsx`

**API:**

- `GET /api/gpus/detect`
- `GET /api/gpus/status`

**Behavior:**

- Use `nvidia-smi --query-gpu=index,name,memory.total,memory.used,memory.free --format=csv,noheader,nounits`.
- Use `nvidia-smi --query-compute-apps=gpu_uuid,pid,process_name,used_memory --format=csv,noheader,nounits` when available.
- Return `available: false` with a clear reason when unavailable.
- Preserve user labels/roles/notes over detected hardware.

**Tests:**

```bash
./.venv/bin/pytest backend/tests/test_api.py::test_gpu_detection -q
npm test -- GpuPlannerPage
```

**Acceptance:**

- Detection works with mocked `nvidia-smi`.
- Non-NVIDIA/dev environments show an unavailable state, not fake GPUs.

### Packet 5B: Fit Estimate And Tensor Split Recommendations

**Owner:** GPU Intelligence Agent

**Files:**

- Modify: `backend/app/gpu_service.py`
- Modify: `backend/app/model_inventory.py`
- Modify: `backend/app/config_service.py`
- Modify: `backend/tests/test_api.py`
- Modify: `frontend/src/pages/GpuPlannerPage.tsx`
- Modify: `frontend/src/pages/ModelsPage.tsx`

**Behavior:**

- Estimate:
  - model file size
  - selected GPU VRAM
  - KV cache pressure from ctx-size, cache type, parallel, batch, ubatch where feasible
  - mmproj/image overhead warning for vision models
- Recommend:
  - CUDA devices
  - main GPU
  - tensor split
- Warn:
  - main GPU not visible
  - tensor split length mismatch
  - likely VRAM overcommit

**Tests:**

```bash
./.venv/bin/pytest backend/tests/test_api.py::test_gpu_fit_estimate -q
npm test -- GpuPlannerPage ModelsPage
```

**Acceptance:**

- Selecting two same-size GPUs proposes `1,1`.
- Selecting mixed VRAM proposes a proportional split.
- Invalid GPU config blocks config-ready status.

## Phase 6: Reliability And Operations

**Purpose:** Make long-running downloads and persistent state reliable across container lifecycle.

**Parallel agents:** Download Reliability Agent owns backend behavior; Ops And QA Agent owns deployment/docs.

### Packet 6A: Persistent HF Cache And Queue Cleanup

**Owner:** Download Reliability Agent

**Files:**

- Modify: `backend/app/hf_service.py`
- Modify: `backend/app/downloads.py`
- Modify: `backend/app/settings.py`
- Modify: `backend/tests/test_hf_service.py`
- Modify: `backend/tests/test_api.py`
- Modify: `frontend/src/pages/ImportModelPage.tsx`
- Modify: `frontend/src/helpContent.ts`

**Behavior:**

- Hugging Face cache defaults to `/data/hf-cache`.
- Download temp defaults to `/data/tmp`.
- Completed/failed/cancelled jobs can be cleaned from the UI/API.
- Restarted `running` jobs become failed with a clear retry action.
- `max_parallel_downloads` changes apply to future jobs or are marked restart-required.

**Tests:**

```bash
./.venv/bin/pytest backend/tests/test_hf_service.py backend/tests/test_api.py -q
npm test -- ImportModelPage SettingsPage
```

**Acceptance:**

- Cache path survives container recreation when `/data` persists.
- Queue cleanup removes DB job rows without deleting model files.

### Packet 6B: Database Migrations And Retention

**Owner:** Download Reliability Agent

**Files:**

- Modify: `backend/app/database.py`
- Create: `backend/app/migrations.py`
- Create: `backend/tests/test_database_migrations.py`
- Modify: `backend/app/settings.py`
- Modify: `frontend/src/pages/SettingsPage.tsx`

**Behavior:**

- Add schema version table.
- Add forward-only migrations.
- Add backup retention settings.
- Keep existing DBs readable.

**Tests:**

```bash
./.venv/bin/pytest backend/tests/test_database_migrations.py backend/tests -q
```

**Acceptance:**

- A DB created by the previous schema upgrades without losing settings, jobs, models, or staged configs.

## Phase 7: UI Readiness And Inline Guidance

**Purpose:** Reduce documentation dependency by putting guidance at the point of action.

**Parallel agents:** Frontend Workflow Agent owns UI; Config Safety/GPU/Download agents review field semantics.

**Files:**

- Modify: `frontend/src/pages/SettingsPage.tsx`
- Modify: `frontend/src/pages/HelpPage.tsx`
- Modify: `frontend/src/helpContent.ts`
- Modify: `frontend/src/components/Field.tsx`
- Modify: `frontend/src/components/CodeBlock.tsx`
- Modify: `frontend/src/components/StatusPill.tsx`
- Modify: frontend tests.

**Steps:**

- [ ] Add inline help/tooltips for:
  - manager model root vs llama-swap model root
  - config path
  - backups path
  - HF token
  - cache/temp paths
  - disk safety
  - TTL
  - ctx-size
  - cache type
  - flash attention
  - tensor split
  - main GPU
  - n-gpu-layers
- [ ] Add settings action buttons:
  - Test paths
  - Test HF token
  - Test config write
  - Scan models
- [ ] Add restart-required badges for app host, app port, data dir, and env-derived paths.
- [ ] Add robust clipboard fallback for HTTP LAN origins.
- [ ] Add API unreachable banner.

**Tests:**

```bash
npm test -- SettingsPage HelpPage DashboardPage
npm run build
```

**Acceptance:**

- The user can understand the common fields without opening Help.
- API-down state is visibly different from healthy empty state.
- Success/error messages clear when edited fields change.

## Phase 8: Final End-To-End Release Gate

**Purpose:** Prove every major feature works together in the actual container.

**Owner:** Ops And QA Agent, with all agents on-call for failures.

**Required commands:**

```bash
./.venv/bin/pytest backend/tests -q
npm test
npm run build
npm run e2e -- --project=chromium
docker build -t llama-swap-web:release-candidate .
docker compose -f compose.example.yml config
```

**Container smoke with temp mounts:**

```bash
mkdir -p /tmp/lsm-rc-models/chat/smoke /tmp/lsm-rc-backups /tmp/lsm-rc-data /tmp/lsm-rc-tmp
touch /tmp/lsm-rc-config.yaml /tmp/lsm-rc-models/chat/smoke/smoke.gguf
chmod -R 777 /tmp/lsm-rc-models /tmp/lsm-rc-backups /tmp/lsm-rc-data /tmp/lsm-rc-tmp /tmp/lsm-rc-config.yaml
docker run --rm -d --name llama-swap-web-rc -p 127.0.0.1:8092:8081 \
  -e APP_HOST=0.0.0.0 \
  -e APP_PORT=8081 \
  -e MANAGER_MODEL_ROOT=/models \
  -e LLAMA_SWAP_MODEL_ROOT=/models \
  -e LLAMA_SWAP_CONFIG_PATH=/app/config.yaml \
  -e BACKUPS_DIR=/backups \
  -e DOWNLOAD_TEMP_DIR=/data/tmp \
  -v /tmp/lsm-rc-models:/models \
  -v /tmp/lsm-rc-config.yaml:/app/config.yaml \
  -v /tmp/lsm-rc-backups:/backups \
  -v /tmp/lsm-rc-data:/data \
  -v /tmp/lsm-rc-tmp:/tmp \
  llama-swap-web:release-candidate
curl -s http://127.0.0.1:8092/api/health
curl -s http://127.0.0.1:8092/api/state
curl -s http://127.0.0.1:8092/api/models/scan
curl -s http://127.0.0.1:8092/settings
docker logs llama-swap-web-rc
docker stop llama-swap-web-rc
```

**Manual LAN smoke on the rig:**

- Open `http://192.168.42.10:8081`.
- Save a fake HF token and verify only redacted text appears.
- Resolve a public HF repo without downloading a large model.
- Upload a tiny `.gguf` placeholder and create a managed model.
- Scan `/models`.
- Import current config candidates.
- Detect GPUs or show clear unavailable state.
- Generate preview.
- Apply config to temp-mounted config only.
- Restore backup.

**Acceptance:**

- Every command passes.
- Browser e2e passes without console/network failures.
- Container smoke produces artifact files:
  - health JSON
  - state JSON
  - generated config
  - backup listing
  - Docker logs
  - file ownership listing
- No raw HF token appears in test output or committed files.
- `git status --short --branch` is clean before merge/release.

## Parallel Execution Order

Run work in this order:

1. Phase 0.
2. Phase 1A and 1B in parallel.
3. Phase 2A, then 2B and 2C in parallel.
4. Phase 3A and 3B sequentially, because config import depends on inventory contracts.
5. Phase 4A and 4B in parallel after destination contracts are stable.
6. Phase 4C and 4D in parallel after model health and download actions exist.
7. Phase 5A, then 5B.
8. Phase 6A and 6B in parallel after download contracts are stable.
9. Phase 7.
10. Phase 8.

## Definition Of Done

The remaining-feature work is complete when:

- A user can launch the Docker image and manage the app on LAN port `8081`.
- HF URL or upload produces a guided install path with no manual path copying.
- Existing `/models` files and existing `config.yaml` entries can become managed models.
- GPU detection, recommendations, and warnings are visible before config apply.
- Config apply warns on destructive changes, backs up first, and can restore from backup.
- Audit logs exist for risky actions.
- Dashboard shows next actions and blockers, not stale history.
- CI runs backend, frontend, build, Docker, compose, container smoke, and browser smoke gates.
- Final local Docker smoke and browser e2e pass.
- GHCR publishes expected tags only after required gates pass.

# Production Ready Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish `llama-swap-web` as a production-ready LAN application that removes the manual llama-swap/llama.cpp pain points: discover or download models, install them into safe per-model folders, create managed llama-swap entries, plan GPU placement, generate and validate matrix config, apply with recovery, and document the full operating model.

**Architecture:** Keep the current single-container FastAPI plus React/Vite architecture with SQLite state under `/data`. Finish the product by adding bounded services around downloads, model inventory, config ownership, GPU recommendations, audit logging, docs, and release QA. Do not add Docker socket access, automatic llama-swap restart, legacy `groups`, or mandatory login in v1.

**Tech Stack:** FastAPI, SQLite, Pydantic, ruamel.yaml, huggingface_hub, React, Vite, TypeScript, TanStack Query, Vitest, Testing Library, Playwright, Docker, GitHub Actions, GHCR.

---

## Release Definition

The app is production-ready only when all of these are true:

- A user can launch the manager from Docker Compose on the LAN and open port `8081`.
- A Hugging Face repo URL, direct HF file URL, local upload, existing `/models` directory, or existing `config.yaml` can become a managed llama-swap model without shell work.
- Downloads install into `/models/<role>/<model-id>/` and preserve safe HF subdirectories when needed.
- Completed downloads show whether they are configured, unconfigured, failed, cancelled, or ready for config preview.
- The generated config uses `/models/...` paths for llama-swap, never host-only paths.
- Generated config uses llama-swap `matrix`, never legacy `groups`.
- Config preview is safe, explicit, staged, scoped, validated, and cannot silently wipe a usable config.
- Config apply writes a unique backup first, writes atomically, and can be restored from the UI.
- HF tokens are never returned by API responses, rendered in the UI, logged, committed, or included in diagnostics.
- GPU Planner can detect GPUs, show live VRAM/process state when available, recommend devices/tensor splits, and warn before bad config.
- The README, in-app Help, and docs/wiki explain installation, normal use, every important setting, common model workflows, backup/restore, troubleshooting, and native development.
- All QA gates in this plan pass on a clean disposable environment.

## Current Baseline

Branch: `codex/production-hardening`

Latest release checklist evidence from 2026-04-30:

- Backend tests: `102 passed`.
- Frontend tests: `12 passed`.
- Frontend production build: passed.
- Compose validation: passed.
- Docker image build: passed.
- Container smoke on `127.0.0.1:8092`: passed.
- Browser smoke with Playwright Chromium: `7 passed`.
- Runtime container UID: `10001`.

Remaining release checklist partials:

- Path safety is still partial: download path safety and HF subdirectory collision coverage remain open.
- Secret safety is still partial: a final secret scan and hardening pass remain open.

## Non-Negotiable Constraints

- No Docker socket mount.
- No automatic llama-swap restart in v1.
- No required login or auth wall in v1. LAN and reverse-proxy-auth guidance is documentation only unless the user explicitly changes scope.
- No `groups` output in generated llama-swap config.
- No generated host paths in llama-swap commands.
- No raw HF token in API responses, UI, logs, support data, Docker docs, or committed files.
- No config apply without a staged preview fingerprint.
- No destructive config apply without explicit destructive confirmation.
- No writes outside `/models`, `/data`, `/backups`, `/tmp`, or the configured `config.yaml`.

## Remaining Backlog Mapping

| Area | Backlog Items | Release Outcome |
| --- | --- | --- |
| Download path safety | B4, path-safety partial | Nested HF files keep safe relative paths, same basenames do not collide, traversal and symlink escapes are rejected. |
| Secret safety | B8, B13, B15, F21, secret-safety partial | Token provider is thread-safe, env writes are atomic, scans pass, token redaction is precise. |
| Core guided workflow | Product audit P1, F7, completed download gap | Import/download/upload/scan/config import all lead to managed model setup and config preview. |
| Managed Models page | Models page audit, F1, F2, F3, F4, F5, F8, F9, F20 | Page becomes a guided managed-model editor with health, file picker, presets, dirty guards, and typed values. |
| Config safety | B6, B7, B12, F6, F10 | Preview/apply/restore is atomic, scoped, invalidated correctly, and resilient to read/write failures. |
| GPU planning | P2, F14, F15, F20 | Real detection/status/recommendations with validation and no focus-loss editing bugs. |
| Runtime reliability | B5, B10, B11, B17, H4, I1, I4, I5 | Jobs and DB writes are durable, cleanup works, SSE is real or removed, test fixtures are clean. |
| Frontend resilience | F11, F12, F13, F16, F17, F18, F19, F22 | API errors, loading states, accessibility, copy behavior, and polling are deliberate and tested. |
| Docs/help/wiki | H1, H2, H3, I3, production docs | README, in-app Help, and docs/wiki are complete and match runtime behavior. |

## Agent Roster

Use agents where write sets are independent. The coordinator owns merge order and final QA.

### Coordinator / Planning Agent

Owns:

- `docs/superpowers/plans/*`
- `BACKLOG.md`
- `artifacts/release-checklist.md`
- `artifacts/qa/*`

Responsibilities:

- Turn each phase below into small packets.
- Prevent overlapping file ownership.
- Convert QA failures into focused fix packets.
- Decide whether a finding blocks release or becomes an explicitly deferred issue.

### Backend Safety Agent

Owns:

- `backend/app/settings_store.py`
- `backend/app/security.py` if created
- `backend/app/audit.py` if created
- relevant routes in `backend/app/main.py`
- `backend/tests/test_settings.py`
- `backend/tests/test_security.py`
- `backend/tests/test_api.py` safety sections

Responsibilities:

- Token handling, redaction, CORS/origin policy, audit logging, atomic writes, settings validation, and path/symlink safety helpers.

### Download And Inventory Agent

Owns:

- `backend/app/downloads.py`
- `backend/app/hf_service.py`
- `backend/app/model_inventory.py`
- `backend/app/config_import.py`
- `backend/tests/test_hf_service.py`
- `backend/tests/test_model_inventory.py`
- `backend/tests/test_api.py` download/import sections

Responsibilities:

- HF URL resolution, file classification, safe install layout, queued jobs, job cleanup, completed-job file metadata, existing file scan, and model creation from downloads/files/config.

### Config Agent

Owns:

- `backend/app/config_service.py`
- `backend/tests/test_config_service.py`
- config routes in `backend/app/main.py`
- config tests in `backend/tests/test_api.py`

Responsibilities:

- YAML import, command rendering, matrix rendering, preview/apply/restore, destructive diff detection, staged preview expiry, atomic writes, and backup retention.

### GPU Agent

Owns:

- `backend/app/gpu_service.py`
- GPU routes in `backend/app/main.py`
- `backend/tests/test_gpu_service.py`
- GPU sections of `backend/tests/test_api.py`

Responsibilities:

- GPU detection, live status, recommendation models, fit estimate, and validation warnings.

### Frontend Workflow Agent

Owns:

- `frontend/src/Layout.tsx`
- `frontend/src/api.ts`
- `frontend/src/queryKeys.ts`
- `frontend/src/pages/DashboardPage.tsx`
- `frontend/src/pages/ImportModelPage.tsx`
- `frontend/src/pages/ModelsPage.tsx`
- `frontend/src/pages/ConfigPreviewPage.tsx`
- `frontend/src/pages/GpuPlannerPage.tsx`
- `frontend/src/pages/SettingsPage.tsx`
- shared UI components under `frontend/src/components/*`
- related frontend tests

Responsibilities:

- Guided lifecycle, action-oriented dashboard, managed model editor, settings validation UX, API error states, accessibility, and browser smoke flows.

### Docs And Help Agent

Owns:

- `README.md`
- `frontend/src/helpContent.ts`
- `frontend/src/pages/HelpPage.tsx`
- `docs/wiki/*`
- `docs/superpowers/specs/*` updates if needed

Responsibilities:

- User-facing Help, README, wiki docs, setting explanations, workflow guides, troubleshooting, and release notes.

### Ops And QA Agent

Owns:

- `Dockerfile`
- `compose.example.yml`
- `.dockerignore`
- `.github/workflows/*`
- `scripts/container-smoke.sh`
- `scripts/secret-scan.sh` if created
- `playwright.config.ts`
- `frontend/e2e/*`
- `package.json` test scripts
- `requirements.txt`

Responsibilities:

- Docker/Compose/GHCR workflows, CI gates, container health checks, Playwright smoke, security/path tests, and release artifacts.

## Failure Loop

Every phase must use this loop:

1. Coordinator writes a packet with owner, files, tests, and acceptance criteria.
2. Coding agent implements only its packet.
3. Spec reviewer rejects changes that violate the non-negotiable constraints.
4. Code reviewer checks maintainability, data safety, path safety, token safety, async behavior, UI correctness, and test quality.
5. QA agent runs the phase gate.
6. On failure, QA reports:

```text
Gate:
Command:
Expected:
Actual:
Suspected owner:
Artifact paths:
Next fix packet:
```

7. Coordinator creates a focused fix packet.
8. Coding agent patches with a failing test first where practical.
9. Reviewers re-check.
10. QA reruns the narrow failing gate, then the full phase gate.

No phase is complete while a failing gate is unexplained.

---

## Phase 0: Baseline And Release Target

**Purpose:** Freeze the current proof, make the release target explicit, and avoid losing track while multiple agents work.

**Owner:** Coordinator / Planning Agent

**Files:**

- Modify: `artifacts/release-checklist.md`
- Modify: `BACKLOG.md`
- Create: `artifacts/qa/phase-0-baseline.md`

**Tasks:**

- [ ] Record current branch, commit, Docker version, Node version, Python version, and OS.
- [ ] Copy current passing QA evidence into `artifacts/qa/phase-0-baseline.md`.
- [ ] Mark `docs/superpowers/plans/2026-04-30-production-ready-completion.md` as the superseding completion plan.
- [ ] Add a short backlog pointer that production completion is tracked by this plan.
- [ ] Keep the release checklist partial statuses for path safety and secret safety until proven fixed.

**Commands:**

```bash
git status --short --branch
git rev-parse --short HEAD
docker version
node --version
npm --version
./.venv/bin/python --version
./.venv/bin/pytest backend/tests -q
npm test
npm run build
docker compose -f compose.example.yml config
```

**Acceptance:**

- Baseline artifact exists and names the exact commit tested.
- Release checklist is current and does not claim full production readiness prematurely.
- Backlog references this plan without deleting unresolved items.

---

## Phase 1: Safety, Secrets, And Data Loss Blockers

**Purpose:** Close the release-blocking safety gaps before adding more UX.

### 1.1 Download Path Safety

**Owner:** Download And Inventory Agent

**Files:**

- Modify: `backend/app/hf_service.py`
- Modify: `backend/app/downloads.py`
- Modify: `backend/tests/test_hf_service.py`
- Modify: `backend/tests/test_api.py`

**Tasks:**

- [ ] Preserve safe HF relative paths under the per-model install directory instead of flattening every file to `Path(filename).name`.
- [ ] Reject `..`, absolute paths, Windows drive prefixes, control characters, null bytes, and unsafe symlink targets.
- [ ] Detect same-destination collisions before download starts.
- [ ] Keep companion files such as `mmproj/*.gguf`, `chat_template.jinja`, tokenizer JSON, and nested assets distinct.
- [ ] Store written file metadata in `model_files` or a dedicated download artifact table.

**Tests:**

- [ ] Two HF files with the same basename in different subdirs remain distinct.
- [ ] Path traversal filenames are rejected.
- [ ] Symlink escape under `/models` is rejected.
- [ ] Direct file URLs select only that file plus explicit companion files.

**Commands:**

```bash
./.venv/bin/pytest backend/tests/test_hf_service.py backend/tests/test_api.py -q
```

**Acceptance:**

- `artifacts/release-checklist.md` path-safety note no longer lists HF subdirectory collision as open.

### 1.2 Secret Handling

**Owner:** Backend Safety Agent

**Files:**

- Modify: `backend/app/settings_store.py`
- Modify: `backend/app/downloads.py`
- Modify: `backend/app/hf_service.py`
- Modify: `backend/app/main.py`
- Create: `backend/app/token_provider.py`
- Create or modify: `backend/tests/test_security.py`
- Create: `scripts/secret-scan.sh`

**Tasks:**

- [ ] Stop mutating process-wide `os.environ` when saving or clearing the HF token.
- [ ] Add a token provider that reads from settings/env file/environment with a lock.
- [ ] Write `.env` token updates atomically with temp file plus replace.
- [ ] Ensure API responses only return token presence metadata, never token values.
- [ ] Ensure download logs redact token-bearing URLs and authorization errors.
- [ ] Tighten token redaction so fake non-token `hf_` strings are not over-redacted.
- [ ] Add a repo secret scan script with explicit test fixture allowlist.

**Tests:**

- [ ] Saving token does not expose it through `GET /api/settings`, `GET /api/state`, job logs, or error responses.
- [ ] Concurrent token read during token update does not crash and never sees a partial file.
- [ ] Secret scan fails on a committed fake-looking real token outside fixtures.

**Commands:**

```bash
./.venv/bin/pytest backend/tests/test_security.py backend/tests/test_api.py -q
bash scripts/secret-scan.sh
```

**Acceptance:**

- `artifacts/release-checklist.md` secret-safety status can move from Partial to Passed only after this and final QA pass.

### 1.3 Config Apply Recovery And Atomicity

**Owner:** Config Agent

**Files:**

- Modify: `backend/app/config_service.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_config_service.py`
- Modify: `backend/tests/test_api.py`
- Modify: `frontend/src/pages/ConfigPreviewPage.tsx`
- Modify: `frontend/src/pages/ConfigPreviewPage.test.tsx`

**Tasks:**

- [ ] Ensure backup names are collision-proof with timestamp plus random or monotonic suffix.
- [ ] Write config through temp file, flush, fsync where practical, then `os.replace`.
- [ ] Handle config disappearance, permission errors, and read failures as typed validation errors, not 500s.
- [ ] Expire staged previews when settings, model entries, GPU entries, or current config fingerprint changes.
- [ ] Prevent replaying a used `stage_id`.
- [ ] Add backup restore API and UI if not fully present.
- [ ] Add restore confirmation that previews the backup target and current file backup behavior.

**Tests:**

- [ ] Applying twice with the same `stage_id` fails.
- [ ] Backup names do not collide in rapid applies.
- [ ] Config write failure leaves the original file intact.
- [ ] Restore creates a new backup of the current config before replacing it.

**Commands:**

```bash
./.venv/bin/pytest backend/tests/test_config_service.py backend/tests/test_api.py -q
npm test -- --run ConfigPreviewPage
```

**Acceptance:**

- A bad config can be rolled back from the UI without shell access.

### 1.4 LAN Security Boundary

**Owner:** Backend Safety Agent plus Docs And Help Agent

**Files:**

- Modify: `backend/app/main.py`
- Modify: `backend/app/settings_store.py`
- Modify: `backend/tests/test_api.py`
- Modify: `README.md`
- Modify: `docs/wiki/deployment.md`
- Modify: `frontend/src/helpContent.ts`

**Tasks:**

- [ ] Replace wildcard CORS with explicit default allowed origins for localhost and LAN host configuration.
- [ ] Add setting/env documentation for allowed origins.
- [ ] Document the LAN threat model: no built-in auth, bind only where intended, prefer reverse proxy auth if exposed beyond trusted LAN.
- [ ] Do not add mandatory login.

**Tests:**

- [ ] Allowed origin receives CORS headers.
- [ ] Disallowed origin does not receive permissive CORS headers.
- [ ] Same-origin local use still works.

**Commands:**

```bash
./.venv/bin/pytest backend/tests/test_api.py -q
```

**Acceptance:**

- Browser security is tighter without changing the no-login v1 product decision.

---

## Phase 2: Guided Model Lifecycle

**Purpose:** Make the app automate the full model journey instead of leaving the user to bridge pages by hand.

### 2.1 Per-Model Install Layout

**Owner:** Download And Inventory Agent

**Files:**

- Modify: `backend/app/downloads.py`
- Modify: `backend/app/model_inventory.py`
- Modify: `backend/app/database.py` or migration module
- Modify: `backend/tests/test_api.py`
- Modify: `backend/tests/test_model_inventory.py`

**Tasks:**

- [ ] Define install root as `/models/<role>/<model-id>/`.
- [ ] Slug model IDs safely and avoid collisions.
- [ ] Track original HF path, installed path, size, sha/hash if available, role, and classifier result.
- [ ] Backfill existing jobs without file metadata as "legacy completed job, needs scan".
- [ ] Ensure uploads can target the same per-model layout.

**Tests:**

- [ ] New download installs into the per-model directory.
- [ ] Slug collision gets a unique suffix.
- [ ] Existing legacy jobs do not break job listing.

**Commands:**

```bash
./.venv/bin/pytest backend/tests/test_model_inventory.py backend/tests/test_api.py -q
```

**Acceptance:**

- No new model download writes directly into only `/models/<role>/` unless explicitly selected as an advanced override.

### 2.2 Completed Download To Managed Model

**Owner:** Download And Inventory Agent plus Frontend Workflow Agent

**Files:**

- Modify: `backend/app/model_inventory.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_api.py`
- Modify: `frontend/src/pages/ImportModelPage.tsx`
- Modify: `frontend/src/pages/ModelsPage.tsx`
- Modify: `frontend/src/pages/ImportModelPage.test.tsx`
- Modify: `frontend/src/pages/ModelsPage.test.tsx`

**Tasks:**

- [ ] Add API endpoint to create a managed model from a completed download job.
- [ ] Infer display name, role, primary GGUF, multipart shards, mmproj, chat template, tokenizer files, and default flags.
- [ ] Add "Create model", "Attach to existing model", and "Show files" actions on completed jobs.
- [ ] Add "Downloaded but not configured" state and Dashboard warning.
- [ ] Remove or replace confusing standalone "Stage Import" action.

**Tests:**

- [ ] Completed job can create a managed model with inferred files.
- [ ] Already attached job shows configured state.
- [ ] Missing primary GGUF blocks managed model creation with a clear error.
- [ ] UI flow from job to managed model works in component test.

**Commands:**

```bash
./.venv/bin/pytest backend/tests/test_api.py -q
npm test -- --run ImportModelPage ModelsPage DashboardPage
```

**Acceptance:**

- User never has to manually copy a downloaded path from Downloads into Models.

### 2.3 Existing Files Scanner

**Owner:** Download And Inventory Agent plus Frontend Workflow Agent

**Files:**

- Modify: `backend/app/model_inventory.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_model_inventory.py`
- Modify: `frontend/src/pages/ModelsPage.tsx`
- Modify: `frontend/src/pages/ModelsPage.test.tsx`

**Tasks:**

- [ ] Scan `/models` recursively with depth and file-count safety limits.
- [ ] Classify GGUF, multipart shards, mmproj, chat templates, tokenizer files, and miscellaneous companion files.
- [ ] Show unmanaged file groups with health status.
- [ ] Add create-managed-model flow from scanned files.
- [ ] Add attach-file flow for companion files.

**Tests:**

- [ ] Scanner ignores hidden/cache/system junk.
- [ ] Multipart set with missing shard is reported incomplete.
- [ ] Vision file group recommends mmproj and template.
- [ ] Path traversal and symlink escape are rejected.

**Commands:**

```bash
./.venv/bin/pytest backend/tests/test_model_inventory.py backend/tests/test_api.py -q
npm test -- --run ModelsPage
```

**Acceptance:**

- A user with pre-existing GGUF files can make them managed without typing paths.

### 2.4 Current Config Import

**Owner:** Config Agent plus Download And Inventory Agent

**Files:**

- Modify: `backend/app/config_import.py`
- Modify: `backend/app/config_service.py`
- Modify: `backend/tests/test_config_import.py`
- Modify: `frontend/src/pages/ConfigPreviewPage.tsx`
- Modify: `frontend/src/pages/ModelsPage.tsx`

**Tasks:**

- [ ] Parse existing llama-swap `models`, `matrix`, `hooks`, aliases, env, ttl, and command file paths.
- [ ] Show import candidates with confidence and warnings.
- [ ] Import current config entries into managed model rows without duplicating existing managed entries.
- [ ] Preserve unknown/custom config areas as outside manager ownership unless explicitly replaced.
- [ ] Show warning before apply if current config has unmanaged models.

**Tests:**

- [ ] Existing config with multiple models imports to managed entries.
- [ ] Duplicate slugs get stable unique IDs.
- [ ] Legacy `groups` are warned about but not regenerated.
- [ ] Unmanaged current-config model blocks destructive apply unless confirmed.

**Commands:**

```bash
./.venv/bin/pytest backend/tests/test_config_import.py backend/tests/test_config_service.py backend/tests/test_api.py -q
npm test -- --run ConfigPreviewPage ModelsPage
```

**Acceptance:**

- First run against an existing llama-swap install does not start from an empty manager database.

---

## Phase 3: Managed Models And Config Ownership

**Purpose:** Turn the Models page into the control surface for llama-swap model entries, not a manual YAML form.

### 3.1 Managed Models Guided Editor

**Owner:** Frontend Workflow Agent

**Files:**

- Modify: `frontend/src/pages/ModelsPage.tsx`
- Modify: `frontend/src/pages/ModelsPage.test.tsx`
- Modify: `frontend/src/components/*`
- Modify: `frontend/src/api.ts`

**Tasks:**

- [ ] Rename page label to "Managed Models".
- [ ] Split editor into guided sections: Identity, Files, Role preset, GPU plan, Runtime flags, Matrix behavior, Advanced raw command.
- [ ] Add health summary: primary GGUF, shards, mmproj, chat template, tokenizer files, command validity, config-ready state.
- [ ] Add scoped file picker/browser for `/models`.
- [ ] Add duplicate/copy entry action for agent-style multi-instance models.
- [ ] Add delete/remove managed entry action with confirmation and no file deletion by default.
- [ ] Add dirty-edit guard and prevent background refetch from overwriting dirty drafts.
- [ ] Fix textarea list editing so aliases/files do not lose blank lines or trailing delimiters mid-edit.
- [ ] Normalize numeric flag values before save.
- [ ] Include `--n-gpu-layers` in frontend command preview when set.

**Tests:**

- [ ] Dirty draft survives background refetch.
- [ ] Numeric values save as numbers where API expects numbers.
- [ ] Textarea editing preserves in-progress user input.
- [ ] Duplicate creates a separate entry with unique ID/name.
- [ ] Delete removes entry but not files.
- [ ] Command preview includes selected flags.

**Commands:**

```bash
npm test -- --run ModelsPage
npm run build
```

**Acceptance:**

- Managed Models is understandable without reading llama-swap YAML first.

### 3.2 Model Presets And Flag Validation

**Owner:** Config Agent plus Frontend Workflow Agent

**Files:**

- Modify: `backend/app/config_service.py`
- Modify: `backend/app/schemas.py` if present
- Modify: `backend/tests/test_config_service.py`
- Modify: `frontend/src/pages/ModelsPage.tsx`
- Modify: `frontend/src/helpContent.ts`

**Tasks:**

- [ ] Add presets for chat, reasoning, coding, vision, embedding, and reranker.
- [ ] Include coding TTL default or document and configure fallback explicitly.
- [ ] Constrain `flash_attn` to valid values such as `on`, `off`, or `auto` if supported by runtime assumptions.
- [ ] Validate port placeholder `${PORT}`.
- [ ] Quote shell flag values with spaces or special characters using `shlex`.
- [ ] Lint raw command override and explain which structured validations are bypassed.

**Tests:**

- [ ] Presets render expected llama-server flags.
- [ ] Shell split round-trip passes for values with spaces and JSON.
- [ ] Invalid raw command receives clear warnings.
- [ ] Coding role TTL behavior is explicit.

**Commands:**

```bash
./.venv/bin/pytest backend/tests/test_config_service.py -q
npm test -- --run ModelsPage HelpPage
```

**Acceptance:**

- Common model types can be configured from presets, with advanced escape hatches still available.

### 3.3 Matrix And Config Preview Ownership

**Owner:** Config Agent plus Frontend Workflow Agent

**Files:**

- Modify: `backend/app/config_service.py`
- Modify: `backend/tests/test_config_service.py`
- Modify: `frontend/src/pages/ConfigPreviewPage.tsx`
- Modify: `frontend/src/pages/ConfigPreviewPage.test.tsx`

**Tasks:**

- [ ] Ensure `POST /api/config/preview` respects selected `model_ids`.
- [ ] Preserve existing hooks and only update manager-owned preload values.
- [ ] Prune stale matrix sets when managed matrix keys change.
- [ ] Explain matrix behavior in plain language near the control.
- [ ] Remove or complete duplicate frontend matrix expression helper behavior.
- [ ] Make preview generation explicit or safely gated; avoid surprising auto-preview on mount.
- [ ] Refetch state and preview after apply.

**Tests:**

- [ ] Model scope filters generated YAML.
- [ ] Existing custom hooks survive.
- [ ] No `groups` emitted.
- [ ] Apply invalidates stale pending diffs.
- [ ] Matrix helper outputs distinct valid expressions or is removed.

**Commands:**

```bash
./.venv/bin/pytest backend/tests/test_config_service.py backend/tests/test_api.py -q
npm test -- --run ConfigPreviewPage
```

**Acceptance:**

- Config Preview reflects exactly what the user selected and shows what the app owns.

---

## Phase 4: GPU Intelligence

**Purpose:** Make GPU planning useful enough that the user does not have to hand-derive CUDA devices, tensor split, and fit risk.

### 4.1 Detection And Live Status

**Owner:** GPU Agent plus Frontend Workflow Agent

**Files:**

- Modify: `backend/app/gpu_service.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_gpu_service.py`
- Modify: `backend/tests/test_api.py`
- Modify: `frontend/src/pages/GpuPlannerPage.tsx`
- Modify: `frontend/src/pages/GpuPlannerPage.test.tsx`

**Tasks:**

- [ ] Detect GPUs with `nvidia-smi` when available.
- [ ] Gracefully show unavailable state when `nvidia-smi` is missing or blocked.
- [ ] Show VRAM total/free/used, driver/CUDA metadata when available, and active processes.
- [ ] Remove developer-specific seeded dual-3090 defaults.
- [ ] Preserve row focus by using stable row keys.
- [ ] Generate non-colliding CUDA indexes when adding GPUs after deletion.

**Tests:**

- [ ] Mocked `nvidia-smi` output becomes GPU rows.
- [ ] Missing `nvidia-smi` returns typed unavailable state.
- [ ] Add/delete/edit GPU rows do not remount active row.
- [ ] New GPU index does not collide.

**Commands:**

```bash
./.venv/bin/pytest backend/tests/test_gpu_service.py backend/tests/test_api.py -q
npm test -- --run GpuPlannerPage
```

**Acceptance:**

- GPU Planner starts empty or detected, never with hidden developer sample hardware.

### 4.2 Fit Estimate And Tensor Split Recommendations

**Owner:** GPU Agent plus Config Agent

**Files:**

- Modify: `backend/app/gpu_service.py`
- Modify: `backend/app/config_service.py`
- Modify: `backend/tests/test_gpu_service.py`
- Modify: `backend/tests/test_config_service.py`
- Modify: `frontend/src/pages/GpuPlannerPage.tsx`
- Modify: `frontend/src/pages/ModelsPage.tsx`

**Tasks:**

- [ ] Estimate model size from file size and metadata when available.
- [ ] Estimate KV cache cost from ctx-size, cache types, parallel, batch/ubatch, and approximate architecture when known.
- [ ] Recommend CUDA devices based on free VRAM and role.
- [ ] Recommend `main_gpu` and `tensor_split`.
- [ ] Warn if `main_gpu` is not visible in `CUDA_VISIBLE_DEVICES`.
- [ ] Warn if tensor split length does not match selected devices.
- [ ] Warn if matrix combinations likely overcommit VRAM.

**Tests:**

- [ ] Fit estimator warns for too-large model.
- [ ] Same-VRAM devices get balanced split.
- [ ] Mixed-VRAM devices get proportional split.
- [ ] Invalid GPU plan blocks or warns before config apply.

**Commands:**

```bash
./.venv/bin/pytest backend/tests/test_gpu_service.py backend/tests/test_config_service.py -q
npm test -- --run GpuPlannerPage ModelsPage ConfigPreviewPage
```

**Acceptance:**

- A user can click from model to GPU recommendation and get actionable config values.

---

## Phase 5: Frontend Product Polish And Resilience

**Purpose:** Make the UI coherent and reliable across the normal user journey.

### 5.1 Dashboard As Action Center

**Owner:** Frontend Workflow Agent

**Files:**

- Modify: `frontend/src/pages/DashboardPage.tsx`
- Modify: `frontend/src/pages/DashboardPage.test.tsx`
- Modify: `frontend/src/Layout.tsx`

**Tasks:**

- [ ] Remove full historical download queue from Dashboard.
- [ ] Show only active downloads, failures, blockers, warnings, and next actions.
- [ ] Add quick actions: Import model, scan files, import current config, create model from completed download, preview config, fix settings.
- [ ] Surface empty config, unmanaged downloads, missing files, stale previews, no GPU plan, and API unreachable state.
- [ ] Consolidate state polling with Layout.

**Tests:**

- [ ] Completed historical jobs do not dominate Dashboard.
- [ ] Failed job appears as action-needed.
- [ ] API unreachable state is visible.
- [ ] Quick action links route correctly.

**Commands:**

```bash
npm test -- --run DashboardPage Layout
npm run build
```

**Acceptance:**

- Dashboard tells the user what to do next, not just what happened before.

### 5.2 Import Page Reliability

**Owner:** Frontend Workflow Agent plus Download And Inventory Agent

**Files:**

- Modify: `frontend/src/pages/ImportModelPage.tsx`
- Modify: `frontend/src/pages/ImportModelPage.test.tsx`
- Modify: `backend/app/hf_service.py`
- Modify: `backend/tests/test_hf_service.py`

**Tasks:**

- [ ] For HF repos, require choosing one quant family unless selecting a multipart set.
- [ ] For direct HF file URLs, select only that file and necessary companions.
- [ ] Auto-select all multipart shards and validate completeness.
- [ ] Detect vision extras and recommend matching mmproj/chat template.
- [ ] Rename upload flow so it does not say only "Upload GGUF" when companions are accepted.
- [ ] Show destination preview before download starts.
- [ ] Show actual written files after completion.
- [ ] Add progress, cancel, retry, and cleanup behavior in a single predictable queue.

**Tests:**

- [ ] Single-file quant repo does not auto-select every quant.
- [ ] Multipart group selects all shards.
- [ ] Vision repo recommends mmproj.
- [ ] Completed job displays installed files.

**Commands:**

```bash
./.venv/bin/pytest backend/tests/test_hf_service.py backend/tests/test_api.py -q
npm test -- --run ImportModelPage
```

**Acceptance:**

- Import Model explains choices and prevents accidental multi-hundred-GB selections.

### 5.3 Settings Validation And Test Buttons

**Owner:** Backend Safety Agent plus Frontend Workflow Agent

**Files:**

- Modify: `backend/app/settings_store.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_settings.py`
- Modify: `frontend/src/pages/SettingsPage.tsx`
- Modify: `frontend/src/pages/SettingsPage.test.tsx`
- Modify: `frontend/src/helpContent.ts`

**Tasks:**

- [ ] Validate app port, max parallel downloads, disk safety GB, paths, and role directories.
- [ ] Add restart-required badges for host, port, DB path/data dir, and startup-only env settings.
- [ ] Add "Test paths" endpoint and button.
- [ ] Add "Test HF token" endpoint and button.
- [ ] Add "Test config write" endpoint and button that does not apply generated config.
- [ ] Clear or mark stale success/error messages after edits.
- [ ] Explain manager model root vs llama-swap model root inline.
- [ ] Make `max_parallel_downloads` live or clearly restart-required.

**Tests:**

- [ ] Invalid numeric settings are rejected.
- [ ] Invalid role path outside model root is rejected.
- [ ] Test path endpoint reports writable/missing/read-only states.
- [ ] Settings success message becomes stale after edit.

**Commands:**

```bash
./.venv/bin/pytest backend/tests/test_settings.py backend/tests/test_api.py -q
npm test -- --run SettingsPage
```

**Acceptance:**

- Settings can be verified from the UI before a user starts a large download or config apply.

### 5.4 API Errors, Accessibility, And Copy Behavior

**Owner:** Frontend Workflow Agent

**Files:**

- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/components/Field.tsx` if present
- Modify: `frontend/src/components/CodeBlock.tsx` if present
- Modify: `frontend/src/components/StatusPill.tsx` if present
- Modify: relevant frontend tests

**Tasks:**

- [ ] Preserve non-JSON API error body text when JSON parsing fails.
- [ ] Add loading states to Models, Config Preview, and GPU Planner.
- [ ] Fix Field accessibility: use fieldsets/groups for checkbox groups instead of wrapping multiple controls in one label.
- [ ] Await clipboard writes, show errors, and provide manual selection fallback for LAN HTTP origins.
- [ ] Give warning status a distinct icon.
- [ ] Move hardcoded download query keys into `queryKeys`.

**Tests:**

- [ ] Non-JSON API error displays useful text.
- [ ] Checkbox groups have accessible names.
- [ ] Copy failure displays fallback.
- [ ] Query invalidation still updates download status.

**Commands:**

```bash
npm test
npm run build
```

**Acceptance:**

- The UI handles failure states directly instead of silently looking empty or stale.

---

## Phase 6: Reliability, Jobs, Database, And Events

**Purpose:** Make the app durable over long-running LAN use.

### 6.1 Download Jobs And Queue Cleanup

**Owner:** Download And Inventory Agent

**Files:**

- Modify: `backend/app/downloads.py`
- Modify: `backend/app/database.py`
- Modify: `backend/tests/test_api.py`

**Tasks:**

- [ ] Clean `_cancelled`, `_threads`, and process tracking after jobs finish.
- [ ] Add cleanup endpoint for completed/failed/cancelled jobs.
- [ ] Preserve completed job records with installed-file metadata until user clears them.
- [ ] Support retry from failed/cancelled jobs.
- [ ] Make resume/cancel behavior explicit after app restart.
- [ ] Preflight disk space before starting a download.
- [ ] Use configured temp/cache path or rename setting so behavior is honest.
- [ ] Persist HF cache outside the container in Compose docs.

**Tests:**

- [ ] Finished job releases in-memory tracking.
- [ ] Cleanup removes terminal jobs but not active jobs.
- [ ] Retry creates a new attempt or safely reuses resumable state.
- [ ] Low disk preflight blocks before download starts.

**Commands:**

```bash
./.venv/bin/pytest backend/tests/test_api.py -q
```

**Acceptance:**

- Long-running manager use does not leak job state or hide failed work.

### 6.2 Database Migrations And Transactions

**Owner:** Backend Safety Agent plus Download And Inventory Agent

**Files:**

- Modify: `backend/app/database.py`
- Modify: `backend/tests/test_database.py`
- Modify: backend tests touching model save

**Tasks:**

- [ ] Add migration tests for fresh DB and old DB.
- [ ] Fix `save_model` read/write race by preserving `created_at` and writing in one transaction/connection.
- [ ] Avoid committing after pure reads.
- [ ] Use consistent timezone-aware timestamps for DB rows and backup names.

**Tests:**

- [ ] Old DB migrates without data loss.
- [ ] Model update preserves `created_at`.
- [ ] Concurrent-ish update path does not duplicate or lose row fields.

**Commands:**

```bash
./.venv/bin/pytest backend/tests/test_database.py backend/tests/test_api.py -q
```

**Acceptance:**

- Existing `/data/manager.db` upgrades safely.

### 6.3 Events Endpoint Decision

**Owner:** Backend Safety Agent plus Frontend Workflow Agent

**Files:**

- Modify or delete route: `backend/app/main.py`
- Modify: `backend/tests/test_api.py`
- Modify: frontend consumers if any

**Tasks:**

- [ ] Either implement real SSE with heartbeat, reconnect semantics, typed events, and tests, or remove `/api/events` until it is useful.
- [ ] If implemented, emit download progress, job terminal states, config apply, backup restore, and settings changes.
- [ ] If removed, remove docs and frontend assumptions.

**Tests:**

- [ ] SSE heartbeat arrives.
- [ ] Download progress event arrives.
- [ ] Client reconnect can resume latest visible state.

**Commands:**

```bash
./.venv/bin/pytest backend/tests/test_api.py -q
npm test
```

**Acceptance:**

- `/api/events` is either useful and tested or absent.

### 6.4 Audit Logging

**Owner:** Backend Safety Agent plus Frontend Workflow Agent

**Files:**

- Create: `backend/app/audit.py`
- Modify: `backend/app/database.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_audit.py`
- Modify: `frontend/src/pages/SettingsPage.tsx` or create audit view if scoped
- Modify: `README.md`

**Tasks:**

- [ ] Log settings changes, HF token set/clear, downloads, uploads, model edits, config previews, config applies, and backup restores.
- [ ] Redact secrets before writing audit events.
- [ ] Store audit events in SQLite with retention settings.
- [ ] Show recent audit events in Settings or Diagnostics if useful.

**Tests:**

- [ ] Config apply writes audit event.
- [ ] HF token value is not present in audit log.
- [ ] Retention removes old audit rows.

**Commands:**

```bash
./.venv/bin/pytest backend/tests/test_audit.py backend/tests/test_api.py -q
```

**Acceptance:**

- Production support can answer "what changed?" without shell log digging or secret leaks.

---

## Phase 7: Documentation, Help, And Wiki

**Purpose:** Make the app self-explanatory and operable without asking the developer.

### 7.1 README Production Rewrite

**Owner:** Docs And Help Agent

**Files:**

- Modify: `README.md`

**Required README sections:**

- [ ] What the app does and does not do.
- [ ] Production Docker quick start.
- [ ] Compose example for the user's llama-swap paths:
  - `/home/n3kr0/Repos/llama.cpp/models:/models`
  - writable manager config mount matching the manager container
  - `/mnt/data_hoard/llama-swap/backups:/backups`
  - `/mnt/data_hoard/llama-swap/data:/data`
  - persistent HF cache mount
- [ ] Required and optional environment variables.
- [ ] Volume and file permission model, including UID/GID guidance.
- [ ] HF token handling and safe debugging.
- [ ] First-run workflow.
- [ ] Existing llama-swap config import workflow.
- [ ] Backup and restore workflow.
- [ ] Upgrade workflow for Docker image updates.
- [ ] Native development instructions.
- [ ] Test and QA commands.
- [ ] Troubleshooting: cannot write config, cannot see GPUs, HF auth fails, browser cannot reach API, model downloaded but not configured, bad config restore.
- [ ] GHCR image/tag behavior.
- [ ] LAN security assumptions and reverse proxy auth recommendation.

**Validation:**

- [ ] Every documented command is copy-pasteable.
- [ ] Docs do not include real tokens or local secrets.
- [ ] README tag names match GHCR workflow.

### 7.2 In-App Help Expansion

**Owner:** Docs And Help Agent plus Frontend Workflow Agent

**Files:**

- Modify: `frontend/src/helpContent.ts`
- Modify: `frontend/src/pages/HelpPage.tsx`
- Modify: Help page tests if present

**Required Help topics:**

- [ ] Dashboard: what each warning/action means.
- [ ] Import Model: HF repo URL, direct file URL, upload, multipart, vision extras, private models, destination preview, progress, cancel/retry, completed-but-unconfigured state.
- [ ] Managed Models: identity, role, files, health, presets, aliases, env, ttl, raw command override, duplicate, remove.
- [ ] GPU Planner: CUDA devices, main GPU, tensor split, VRAM fit, KV cache, ctx-size, visible devices, mixed GPUs, support models.
- [ ] Config Preview: matrix, model scope, destructive diff, validation, staged previews, apply, backup, restore.
- [ ] Settings: every setting, what it controls, whether it requires restart, valid values, risk/tradeoff, model behavior impact.
- [ ] HF Token: where stored, why used, private models, redaction, safe rotation.
- [ ] llama.cpp flags: ctx-size, cache types, n-gpu-layers, flash attention, no-mmap, batch/ubatch, parallel, top-k/top-p/temp/min-p, repeat/presence penalties, image max tokens, jinja, chat template, mmproj.
- [ ] Common workflows: single GGUF chat, multipart large model, vision model, embedding model, reranker, agent-per-GPU pattern.
- [ ] Troubleshooting and recovery.

**Layout requirements:**

- [ ] Help should use a polished, searchable, grouped layout, not one long generic wall.
- [ ] Each topic should link to the relevant page when possible.
- [ ] Setting explanations should distinguish manager runtime, download behavior, generated command behavior, and llama-swap config behavior.

**Commands:**

```bash
npm test -- --run HelpPage
npm run build
```

**Acceptance:**

- A new user can understand every page and major setting from the Help section.

### 7.3 Docs Wiki

**Owner:** Docs And Help Agent

**Files:**

- Create: `docs/wiki/index.md`
- Create: `docs/wiki/getting-started.md`
- Create: `docs/wiki/model-import-workflows.md`
- Create: `docs/wiki/managed-models.md`
- Create: `docs/wiki/gpu-planning.md`
- Create: `docs/wiki/config-preview-apply-restore.md`
- Create: `docs/wiki/settings-reference.md`
- Create: `docs/wiki/deployment.md`
- Create: `docs/wiki/troubleshooting.md`
- Create: `docs/wiki/release-qa.md`

**Content requirements:**

- [ ] Wiki pages mirror the app workflow but allow deeper explanations than in-app Help.
- [ ] Include examples for Sean-style multi-GPU/matrix setup without hardcoding his exact config as the only pattern.
- [ ] Include safe config migration from existing llama-swap.
- [ ] Include backup restore and disaster recovery.
- [ ] Include production upgrade and rollback.
- [ ] Include how to collect non-secret diagnostic information.

**Validation:**

```bash
rg -n "hf_[A-Za-z0-9_-]{8,}|HF_TOKEN=.*[A-Za-z0-9]" README.md docs frontend/src/helpContent.ts
rg -n "groups:" README.md docs frontend/src/helpContent.ts
```

**Acceptance:**

- README gives quick start; wiki gives depth; Help gives in-app guidance.

---

## Phase 8: Ops, Packaging, And Release Workflows

**Purpose:** Make local Docker, CI, and GHCR release paths reliable.

### 8.1 Docker And Compose Production Polish

**Owner:** Ops And QA Agent

**Files:**

- Modify: `Dockerfile`
- Modify: `compose.example.yml`
- Modify: `.dockerignore`
- Modify: `README.md`
- Modify: `scripts/container-smoke.sh`

**Tasks:**

- [ ] Keep Node only in build stage and Python runtime only in final image.
- [ ] Keep non-root runtime user.
- [ ] Add `PUID`/`PGID` or clear UID/GID file-permission guidance if runtime user remains fixed.
- [ ] Add persistent HF cache volume.
- [ ] Remove host `/tmp:/tmp` recommendations unless deliberately documented as unsafe/legacy.
- [ ] Add healthcheck to Dockerfile or Compose using `/api/health`.
- [ ] Ensure generated QA artifacts are excluded from image context.
- [ ] Ensure Compose config path is writable for manager and can remain read-only for llama-swap container.

**Commands:**

```bash
docker compose -f compose.example.yml config
docker build -t llama-swap-web:release-candidate .
```

**Acceptance:**

- Docker/Compose docs match the image behavior and do not encourage unsafe host binds.

### 8.2 CI And GHCR Release

**Owner:** Ops And QA Agent

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/docker-publish.yml`
- Modify: `README.md`
- Modify: `artifacts/release-checklist.md`

**Tasks:**

- [ ] Ensure CI runs backend tests, frontend tests, frontend build, Docker build, Compose validation, and container smoke.
- [ ] Ensure Docker publish emits documented tags, including `latest` on `main` if README references it.
- [ ] Add workflow path filters only if they do not skip required release tests.
- [ ] Document how to verify GHCR image after publish.

**Validation:**

```bash
git grep -n "ghcr.io/n3kr0nom1c0n/llama-swap-web"
```

**Acceptance:**

- README, Compose, and workflow tags agree.

### 8.3 Native Development Reliability

**Owner:** Ops And QA Agent plus Docs And Help Agent

**Files:**

- Modify: `README.md`
- Modify: `requirements.txt`
- Modify: `pyproject.toml` if present
- Modify: `package.json`
- Modify: Vitest config / TS config if needed

**Tasks:**

- [ ] Align local/test Python version expectations with Docker target.
- [ ] Keep `pydantic` as a direct dependency.
- [ ] Align Vitest globals with TypeScript config.
- [ ] Add backend `conftest.py` fixtures to reduce repeated setup.
- [ ] Add frontend test builders for common settings/model payloads.
- [ ] Ensure native run instructions include backend env vars and frontend proxy/base URL behavior.

**Commands:**

```bash
./.venv/bin/pytest backend/tests -q
npm test
npm run build
```

**Acceptance:**

- A contributor can run the app natively without reverse-engineering Docker.

---

## Phase 9: End-To-End QA And Release Sign-Off

**Purpose:** Prove the whole app works as a product, not just as isolated pieces.

### 9.1 Full Automated Gates

**Owner:** Ops And QA Agent

**Commands:**

```bash
./.venv/bin/pytest backend/tests -q
npm test
npm run build
docker compose -f compose.example.yml config
docker build -t llama-swap-web:release-candidate .
BASE_URL=http://127.0.0.1:8092 QA_ARTIFACT_DIR=artifacts/qa SMOKE_BACKUPS_DIR=/tmp/lsm-release-backups SMOKE_CONTAINER=llama-swap-web-release bash scripts/container-smoke.sh
ALLOW_E2E_MUTATIONS=1 BASE_URL=http://127.0.0.1:8092 npm run e2e -- --project=chromium
bash scripts/secret-scan.sh
```

**Acceptance:**

- Every command passes.
- `artifacts/release-checklist.md` is updated with exact command output summary and date.

### 9.2 Security And Path QA

**Owner:** Ops And QA Agent plus Backend Safety Agent

**Required proof:**

- [ ] Upload cannot escape `/models`.
- [ ] Download cannot escape `/models`.
- [ ] HF nested paths are preserved safely.
- [ ] Symlinks inside writable roots cannot escape to host paths.
- [ ] Backups cannot write outside `/backups`.
- [ ] Temp/cache writes cannot escape `/tmp` or configured cache dir.
- [ ] Config apply cannot write outside configured `config.yaml`.
- [ ] API responses, UI, backend logs, audit logs, browser screenshots, docs, and committed files do not contain HF token values.

**Commands:**

```bash
./.venv/bin/pytest backend/tests/test_security.py backend/tests/test_hf_service.py backend/tests/test_api.py -q
bash scripts/secret-scan.sh
```

**Acceptance:**

- Release checklist path safety and secret safety both become Passed.

### 9.3 Browser Product Smoke

**Owner:** Ops And QA Agent plus Frontend Workflow Agent

**Scenarios:**

- [ ] Open Dashboard and verify next actions.
- [ ] Open Settings, save harmless settings, run Test paths, run Test config write, verify token field is redacted.
- [ ] Resolve a mocked or fixture HF URL and verify file selection behavior.
- [ ] Start a disposable download/upload fixture and verify progress, written files, and create-managed-model action.
- [ ] Scan existing fixture `/models` and create a managed model.
- [ ] Import a fixture current `config.yaml`.
- [ ] Open Managed Models and verify health and command preview.
- [ ] Run GPU detection mock/unavailable path and recommendation path.
- [ ] Preview config, inspect diff, apply to temp config, verify backup, restore backup.
- [ ] Open Help, search for HF token, GPU Planner, matrix, backup restore, and settings.

**Command:**

```bash
ALLOW_E2E_MUTATIONS=1 BASE_URL=http://127.0.0.1:8092 npm run e2e -- --project=chromium
```

**Acceptance:**

- The browser product path covers every main page and does not rely on manually inspecting the database.

### 9.4 Real LAN Smoke On The Rig

**Owner:** Coordinator plus Ops And QA Agent

**Precondition:** Only run mutating tests against a disposable config/model root unless the user explicitly approves using live paths.

**Checks:**

- [ ] Manager reachable at `http://192.168.42.10:8081`.
- [ ] `/api/state`, `/api/settings`, `/api/gpus`, `/api/downloads`, `/api/models`, and `/api/health` respond.
- [ ] GPU detection sees the actual rig or reports why it cannot.
- [ ] Docker logs do not contain secrets.
- [ ] File ownership of newly written disposable file is manageable from host.
- [ ] Config preview uses `/models/...` paths.

**Commands:**

```bash
curl -s http://192.168.42.10:8081/api/health
curl -s http://192.168.42.10:8081/api/state
curl -s http://192.168.42.10:8081/api/gpus/status
```

**Acceptance:**

- Local disposable QA and real LAN smoke both pass before release wording says "production-ready".

---

## Final Documentation Deliverables

Before release, these files must exist and be current:

- `README.md`
- `BACKLOG.md`
- `artifacts/release-checklist.md`
- `docs/wiki/index.md`
- `docs/wiki/getting-started.md`
- `docs/wiki/model-import-workflows.md`
- `docs/wiki/managed-models.md`
- `docs/wiki/gpu-planning.md`
- `docs/wiki/config-preview-apply-restore.md`
- `docs/wiki/settings-reference.md`
- `docs/wiki/deployment.md`
- `docs/wiki/troubleshooting.md`
- `docs/wiki/release-qa.md`
- `frontend/src/helpContent.ts`

Each doc must be checked for:

- No real secrets.
- No legacy `groups` recommendation.
- No host path in generated llama-swap command examples unless clearly labeled as host mount source.
- Clear distinction between manager container paths and llama-swap command paths.
- Clear backup/restore path.
- Clear Docker and native instructions.

## Final Release Checklist Update

The final release checklist must show Passed for:

- Backend tests.
- Frontend tests.
- Frontend build.
- Compose validation.
- Docker build.
- Container smoke.
- Browser smoke.
- Non-root container.
- Path safety.
- Secret safety.
- README/docs/help completeness.
- GHCR tag/documentation alignment.
- Real LAN smoke, with date and target host.

## Recommended Implementation Order

1. Phase 0: Baseline and release target.
2. Phase 1: Safety, secrets, and data loss blockers.
3. Phase 2: Guided model lifecycle.
4. Phase 3: Managed Models and config ownership.
5. Phase 4: GPU intelligence.
6. Phase 5: Frontend product polish and resilience.
7. Phase 6: Reliability, jobs, database, and events.
8. Phase 7: Documentation, Help, and wiki.
9. Phase 8: Ops, packaging, and release workflows.
10. Phase 9: End-to-end QA and release sign-off.

Do not push a phase as complete until its tests pass and the release checklist has been updated with exact evidence.

# Multi-Rig SSH Targets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Llama-Swap Manager control one or more remote llama-swap rigs over SSH so model files, config writes, GPU checks, and restarts happen on the selected rig, not on the manager host.

**Architecture:** Add first-class target rig profiles and a `TargetRigClient` abstraction with local and SSH implementations. Every llama-swap-facing operation carries a `target_rig_id`; local mode remains for development and migration, while SSH mode is the production path.

**Tech Stack:** FastAPI, SQLite JSON payload tables, OpenSSH subprocess calls, React/Vite TypeScript, TanStack Query.

---

### Task 1: Backend Rig Data Model

**Files:**
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/database.py`
- Modify: `backend/app/migrations.py`
- Test: `backend/tests/test_api.py`

- [x] Add `TargetRig`, `TargetRigMode`, and `target_rig_id` fields to `ManagedModel`, `DownloadJob`, and `GpuDevice`.
- [x] Add a `target_rigs` SQLite table and database helpers for listing, saving, and selecting the default rig.
- [x] Seed a default local rig from the existing settings so current installs keep working.
- [x] Add tests proving `/api/target-rigs` returns at least one default rig and model/job records can be filtered per rig.

### Task 2: SSH Transport Layer

**Files:**
- Create: `backend/app/target_rig_service.py`
- Test: `backend/tests/test_target_rig_service.py`

- [x] Implement a `TargetRigClient` interface for command execution, path status, read/write config, backup/restore, file scan, disk usage, upload, HF download, GPU detection, and restart.
- [x] Implement local mode using existing filesystem helpers.
- [x] Implement SSH mode with OpenSSH subprocess calls, strict path validation, redacted logs, and token-safe stdin scripts.
- [x] Add tests with fake SSH runner proving commands are sent to the selected rig and unsafe paths are rejected.

### Task 3: API Routing By Target Rig

**Files:**
- Modify: `backend/app/main.py`
- Modify: `backend/app/downloads.py`
- Modify: `backend/app/model_inventory.py`
- Modify: `backend/app/gpu_service.py`
- Test: `backend/tests/test_api.py`

- [x] Add `target_rig_id` to import, download, scan, model, config, backup, restore, GPU, and restart routes.
- [x] Convert config preview/apply/restore to use the target rig client.
- [x] Convert downloads/uploads/scans to use the selected target rig.
- [x] Convert GPU detect/status/recommend to query the selected rig.
- [x] Keep legacy local behavior when no `target_rig_id` is provided.

### Task 4: Frontend Rig Awareness

**Files:**
- Create: `frontend/src/targetRigContext.tsx`
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/queryKeys.ts`
- Modify: `frontend/src/Layout.tsx`
- Modify: `frontend/src/pages/ImportModelPage.tsx`
- Modify: `frontend/src/pages/ModelsPage.tsx`
- Modify: `frontend/src/pages/GpuPlannerPage.tsx`
- Modify: `frontend/src/pages/ConfigPreviewPage.tsx`
- Modify: `frontend/src/pages/DashboardPage.tsx`
- Modify: `frontend/src/pages/SettingsPage.tsx`
- Test: relevant frontend page tests

- [x] Add a topbar target rig selector.
- [x] Scope queries and mutations to the selected target rig.
- [x] Add target rig management on Settings.
- [x] Relabel ambiguous path UI: target rig destination, llama-swap path, manager host path.
- [x] Default Hugging Face resolved file selection to all unchecked.

### Task 5: Documentation And QA

**Files:**
- Modify: `README.md`
- Modify: `compose.example.yml`
- Modify: `docs/wiki/*.md`
- Modify: `frontend/src/helpContent.ts`

- [x] Document SSH-first deployment and remove Docker socket as the recommended production path.
- [x] Explain local mode as development/backwards compatibility only.
- [x] Add multi-rig workflow docs and troubleshooting.
- [x] Run backend tests, frontend tests, build, Docker build, and browser smoke.

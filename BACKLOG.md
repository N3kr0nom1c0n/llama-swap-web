# Backlog

## Claude Code Review Findings: 2026-04-30

### Critical

- C1: Fix upload memory DoS. `/api/uploads` currently reads the full uploaded file into memory before writing; stream uploads to disk, add file size limits, and reject oversized/non-allowed files before body exhaustion.
- C2: Stop running the container as root and stop recommending host `/tmp:/tmp`. Add a non-root runtime user, UID/GID support, safer temp/cache mounts, and symlink/path hardening for upload/download writes.
- C3: Add `pydantic` as a direct dependency in `requirements.txt` and project metadata because backend code imports it directly.
- C4: Fix GHCR tagging. The workflow must publish `:latest` if Compose/README reference `ghcr.io/n3kr0nom1c0n/llama-swap-web:latest`, or the docs must use the tag that CI actually publishes.

### High

- B1: Make config preview read-only. `validate_config_document` must not create directories during preview; add separate path test/setup actions for writable path creation.
- B2: Preserve existing hooks when regenerating config. Do not replace the entire `hooks` object just to write `hooks.on_startup.preload`.
- B3: Quote/shell-escape command flag values that contain spaces or special characters so generated llama-server commands remain valid.
- B4: Preserve safe Hugging Face subdirectory structure during downloads. Current `Path(filename).name` flattening can silently overwrite files with the same basename.
- F1: Include `--n-gpu-layers` in frontend generated command previews when the user sets `n_gpu_layers`.
- F2: Fix textarea list editing. Do not run `splitList()` on every keystroke for aliases/files/tokenizers because it destroys trailing delimiters and blank lines mid-edit.
- F3: Normalize numeric `llama_flags` values before saving. UI currently sends numeric flags as strings.
- F4: Add unsaved-changes guards for Settings, Models, and GPU Planner.
- F5: Prevent Models page background refetches from overwriting dirty draft edits.
- F6: Invalidate/refetch preview and state after config apply so the UI does not keep showing stale pending diffs.
- F7: Wire `createImport` results into the draft model file paths, or remove the separate Stage Import action in favor of the guided download-to-model flow.

### Medium

- B5: Fix `save_model` read/write race by preserving `created_at` and writing in one transaction/connection.
- B6: Make config backups collision-proof and config writes atomic. Use higher-resolution or unique backup names, write temp file, fsync as practical, and `os.replace`.
- B7: Expire/delete staged configs and prevent replaying the same `stage_id` after apply or after models/settings change.
- B8: Stop mutating process-wide `os.environ` for HF token while download threads can read it. Use settings/env-file reads with a lock or token provider.
- B9: Replace raw `dict` request bodies for HF token and HF resolve with Pydantic schemas.
- B10: Clean up `_cancelled`, `_threads`, and process tracking after jobs finish so the manager does not leak memory over time.
- B11: Make `max_parallel_downloads` changes take effect at runtime or mark them restart-required. The semaphore is currently created only at startup.
- B12: Fix TOCTOU around config preview reading the config file; handle disappearance/read errors without 500s.
- B18: Remove developer-specific seeded dual-3090 GPU defaults. First-run GPU inventory should be empty, detected, or clearly sample data.
- F8: Add a coding TTL default or explicitly document that coding uses chat TTL. Current behavior silently falls through to chat TTL.
- F9: Remove or complete the frontend `matrixExpression` helper; current non-custom modes all return the same expression.
- F10: Stop auto-running config preview on page mount unless it is intentional and safe; make generation explicit or gate it on loaded state.
- F11: Clear or mark stale Settings success/error messages when the user edits after a save.
- F12: Show a visible API unreachable/error state in Layout instead of displaying zero models/GPUs/jobs.
- F13: Fix frontend API error parsing so non-JSON error bodies are not lost after a failed `response.json()` attempt.
- F14: Generate non-colliding CUDA indexes when adding GPUs after deletion.
- F15: Use stable row keys in GPU Planner so editing CUDA index does not remount the row and lose focus.
- F16: Consolidate state polling intervals between Layout and Dashboard so polling behavior is intentional.
- F17: Fix `Field` accessibility. Do not wrap multiple checkboxes in one `<label>`; use fieldsets/groups where appropriate.
- F18: Make CodeBlock copy robust on LAN HTTP origins. Await clipboard writes, show errors, and provide fallback selection/manual copy.
- I1: Avoid double-injecting `.env` with both `env_file` and `/app/.env` mount unless the divergence behavior is deliberate and documented.
- I2: Align Vitest runtime globals with TypeScript config. Either enable `globals: true` or remove `vitest/globals` types.
- I3: Clarify `LLAMA_SERVER_CMD` default. `/app/llama-server` does not exist in the manager container; make clear it is the path inside the llama-swap runtime or make it configurable per target.

### Low

- B13: Write HF token env file atomically via temp file and replace.
- B14: Return better HF resolve errors: distinguish bad URL/input, auth failure, network timeout, rate limit, and Hugging Face server errors.
- B15: Remove or fix `redact_secrets`; it is dead code and only redacts top-level keys.
- B16: Remove unused `SettingsResponse` schema or use it for settings endpoints.
- B17: Avoid committing SQLite transactions after pure read operations.
- B19: Use consistent timezone handling for backup filenames and DB timestamps.
- F19: Move download query keys into `queryKeys` instead of hardcoded string arrays.
- F20: Add loading states to Models, Config Preview, and GPU Planner.
- F21: Tighten `redactToken` so it only redacts real HF token values and not unrelated strings beginning with `hf_`.
- F22: Give StatusPill `warn` a distinct icon, not the same icon as idle.
- H1: Add coding role TTL guidance to Help and settings docs.
- H2: Replace free-text `flash_attn` with a constrained control or document valid values inline.
- H3: Add frontend and backend numeric validation for app port, max parallel downloads, and disk safety GB.
- H4: Either implement real SSE events with heartbeat/reconnect semantics or remove the stub `/api/events` endpoint until it is useful.
- I4: Align local/test Python version with Docker/pyproject Python version or test against the container target.
- I5: Add backend `conftest.py` fixtures to reduce repeated app/client setup.
- I6: Add frontend test fixtures/builders for common settings payloads instead of copying large objects in each test.

### Test Coverage Gaps

- Add tests for `ModelsPage`, especially dirty edit handling, generated command fields, model save, and file/path state.
- Add tests for `ConfigPreviewPage`, especially model scope, apply invalidation, warnings, and destructive changes.
- Add tests for `GpuPlannerPage`, especially add/delete GPU index handling and save behavior.
- Add backend tests for upload streaming/size limits/path safety.
- Add backend tests for Settings PUT validation.
- Add backend tests for GPU save validation.
- Add backend tests for download cancel/retry through API routes.
- Add backend tests for SSE events if the endpoint remains.

## Product Audit: Make This Feel Like Ollama-Level Easy

### High Priority Workflow Gaps

- Build a single guided model lifecycle instead of disconnected pages: Resolve -> Select files -> Download -> Create managed model -> Tune GPU/flags -> Preview config -> Apply. The app should always show what step is next and what is blocking the model from being usable.
- Remove the manual gap between completed downloads and managed/configurable models. A completed download should immediately offer or create a guided managed-model setup with inferred name, role, primary GGUF, companion mmproj/template files, GPU defaults, command defaults, and config preview readiness.
- Download destinations must use a per-model folder such as `/models/<role>/<model-id>/` and preserve useful HF subpaths when needed. Current downloads flatten files into the role directory, which can collide on names like `chat_template.jinja`, `mmproj-F16.gguf`, or repeated quant filenames.
- Add a "Downloaded but not configured" state. The app should warn when files exist in download jobs but no managed model entry references them.
- Add an "import existing files" scanner for `/models`. If the user already has GGUFs on disk, the app should discover them, classify them, and offer to create managed model entries.
- Import existing `config.yaml` into managed entries. The app should not start from an empty manager database when llama-swap already has models configured.

### Dashboard

- Dashboard should not show the full download job list. It should show only active downloads, failures, config warnings, and next actions.
- Dashboard should surface important warnings: empty config file, downloaded-but-unmanaged models, missing primary files, stale staged previews, and no GPU plan.
- Dashboard metrics need action context. A plain "3 jobs" count is not useful unless it tells whether any job needs attention.
- Add quick actions based on state: "Create model from completed download", "Scan /models", "Import current config", "Preview config", "Fix settings".

### Import Model

- HF repo URLs currently select every single-file `.gguf` by default. For quantized repos this can mean selecting many huge quant files. The UI should require choosing exactly one quant family unless the model is intentionally multipart.
- Direct HF file URLs should select only that file plus required companion files, not every other GGUF in the repo.
- Multipart GGUF handling is wrong for usability: selecting only `00001-of-N` is not enough. The app should auto-select every shard in that group and validate that the set is complete.
- Vision/multimodal imports should detect and recommend the matching `mmproj` and chat template instead of making the user know which extras are needed.
- The "Stage Import" button is confusing because Start Download already stages. Replace it with a clear destination preview or remove it.
- The page needs a post-download action on each completed job: "Create model", "Attach to existing model", and "Show files".
- The Download Queue should show actual written files/container paths for completed jobs, not just destination directory.
- Upload says "Upload GGUF" but accepts `.jinja`, `.json`, and `.txt`. Split this into model upload vs companion-file upload or rename it.
- Downloads are written as root-owned files on the host when the container runs as root. Add UID/GID support or ownership correction so the user can manage downloaded files from the host.
- `download_temp_dir` is exposed in settings but Hugging Face downloads currently use the default HF cache path, not the configured temp directory. Either wire it up or remove/rename it.
- `disk_safety_gb` is checked during config preview validation, not before starting a download. Add preflight disk checks before large downloads start.
- Persist the Hugging Face cache outside the container so resume/progress survives container recreates and avoids duplicate local storage churn.

### Models / Managed Models

- Rename "Models" to "Managed Models" or "Config Models" so it is clear this page controls llama-swap config entries, not raw files on disk.
- Replace the giant manual form with a guided editor. Most users should not need to paste paths, know flag names, or understand matrix expressions to get a working model.
- Show model health: primary GGUF exists/missing, all multipart shards present, mmproj exists/missing, chat template exists/missing, command valid, config-ready yes/no.
- Add a file picker/browser scoped to `/models` for primary GGUF, mmproj, chat template, and tokenizer files. Do not require path typing.
- Auto-infer primary model file, mmproj, and chat template from selected/downloaded files.
- Add model presets by role/type: chat, reasoning, coding, vision, embedding, reranker. Presets should fill common llama.cpp flags and explain tradeoffs.
- Validate GPU choices: selected CUDA devices should match main GPU and tensor split length. Warn if main GPU is not visible in `CUDA_VISIBLE_DEVICES`.
- Add duplicate/copy model entry action for agent-style multi-instance models across GPUs.
- Add delete/remove model entry action with confirmation. Removing an entry should not delete model files unless explicitly requested.
- Raw command override should be advanced-only and linted. It can bypass structured validation and should clearly show what validation is skipped.

### GPU Planner

- Auto-detect GPUs from `nvidia-smi` or NVML instead of making the user type device inventory manually.
- Show real current GPU state: memory used/free, processes, model assignment, and whether llama-swap/llama.cpp processes are running.
- Calculate recommended tensor splits from VRAM and selected GPUs. A user should not have to derive ratios by hand.
- Estimate fit for selected model + quant + ctx-size + KV cache. This is one of the biggest llama.cpp pain points compared to Ollama.
- Tie GPU plans to model entries. Current GPU Planner is mostly notes and labels; it does not actively plan placement.
- Add conflict warnings for matrix combinations that overcommit VRAM.
- Add presets for "single GPU", "2x same VRAM", "mixed VRAM", "support model on small card", and "large model across all large cards".

### Config Preview / Apply

- Never allow an empty manager database to stage/apply `models: {}` without a strong destructive warning. This can wipe a real llama-swap config if the current file has content.
- `POST /api/config/preview` ignores `model_ids`, so the UI's Model Scope checkboxes do not actually scope the preview. Backend must filter models by selected IDs.
- Add an explicit "destructive diff" warning when generated YAML removes existing models, matrix vars, hooks, aliases, or global settings.
- Add current-config linting before generation. Show legacy groups, bad YAML, duplicate aliases, broken matrix refs, and missing files separately.
- Preserve existing comments/sections more deliberately and show what the app owns vs what is untouched.
- Add import-from-current-config before apply. If the current config has models unknown to the manager, warn and offer to import them.
- Validate generated commands against file existence inside `/models`, not just path prefixes.
- Validate custom matrix expressions and explain runs-alone/with-support/support in plain language near the control.
- Staged preview IDs should expire or be invalidated when models/settings change.

### Settings

- Add restart-required badges. App host, port, DB path/data dir, and some env-derived paths do not affect the already-running server until restart.
- Validate settings on save: paths must be absolute where required, role directories must sit under the llama-swap model root, config path should be a file mount, backups/data/temp must be writable.
- Add "Test paths" and "Test HF token" buttons so users can verify before importing.
- Add "Test llama-swap config write" without applying a generated config.
- Token handling is redacted in API responses, but operational commands like `docker compose config` can expand env secrets. Document safer debugging and avoid surfacing raw environment dumps in the UI.
- Clarify `Manager model root` vs `Llama-swap model root` with examples directly in the UI. This distinction is critical but currently too abstract.
- Settings should explain which fields affect generated model commands vs manager runtime vs download behavior.

### Help

- Help content is useful, but it should not compensate for unclear workflows. Add inline field help/tooltips at the point of use.
- Help should link directly to the relevant page/setting and reflect live app state where possible.
- Add examples for common imports: single GGUF chat model, multipart large model, vision model with mmproj, embedding model, reranker.

### Backend / API

- `DownloadRequest.model_id` and `DownloadJob.container_dir` exist but are not meaningfully used. Either wire them into model creation or remove them.
- `model_files` table exists but is unused. Use it for file inventory/health or remove it until needed.
- Add file inventory endpoints for scanning `/models` safely.
- Add endpoints to create a managed model from a completed download job.
- Add job cleanup endpoint for completed/failed/cancelled jobs.
- Add stronger path traversal tests for uploads and downloads with nested HF filenames.
- Tighten CORS. With no auth, `allow_origins=["*"]` means a random webpage could potentially call the LAN manager API from the user's browser.
- Add audit logging for config apply, token changes, settings changes, and model entry changes.

## Production Readiness Checklist

### P0: Data Loss And Security

- Block dangerous config applies, especially empty generated configs such as `models: {}` when the current config has content.
- Add explicit destructive-change detection when generated config removes existing models, hooks, matrix entries, aliases, global settings, or preload entries.
- Add backup restore support from the UI/API so a bad config apply can be rolled back without shell access.
- Import existing `config.yaml` before the manager takes ownership of config generation.
- Add optional LAN auth or clear reverse-proxy-auth support, even if auth remains disabled by default for trusted LAN use.
- Tighten browser/API security: remove wildcard CORS, restrict allowed origins, and document LAN threat assumptions.
- Add audit logs for settings changes, HF token changes, downloads, model edits, config previews, config applies, and backup restores.
- Add a secret-safety pass for logs, UI errors, diagnostics, compose examples, and support bundles so HF tokens cannot leak.

### P1: Core Automation Workflow

- Make the complete path guided: Hugging Face URL or upload -> file selection -> download -> managed model -> GPU/flags -> preview -> apply.
- Add "Create model from completed download" and "Attach download to existing model" flows.
- Add safe `/models` scanner for existing GGUFs and companion files.
- Add current `config.yaml` parser/importer for existing llama-swap installations.
- Use per-model install directories under `/models/<role>/<model-id>/`.
- Auto-detect primary GGUF, multipart shards, mmproj files, chat templates, tokenizer files, embedding models, rerankers, and vision support files.
- Add model presets for chat, reasoning, coding, vision, embedding, and reranker entries.

### P2: llama.cpp And GPU Intelligence

- Auto-detect GPUs with `nvidia-smi` or NVML.
- Show live VRAM use, free VRAM, active processes, and currently loaded llama.cpp/llama-swap models.
- Recommend CUDA devices, main GPU, and tensor split based on VRAM and model size.
- Estimate fit from model quant size, selected GPUs, ctx-size, KV cache type, batch, ubatch, parallel, and mmproj/image settings.
- Warn when a model or matrix combination is likely to overcommit VRAM.
- Validate GPU settings before config apply, including tensor split length and main GPU visibility.

### P3: Reliability And Operations

- Persist Hugging Face cache outside the container and use it for progress/resume.
- Run disk-space checks before download starts, not only during config preview.
- Make download resume, cancel, retry, and recovery behavior explicit and reliable after container restarts.
- Add queue cleanup and stale job handling.
- Add UID/GID or container-user support so downloaded files are not root-owned on the host by default.
- Add database migrations for schema changes instead of only `create table if not exists`.
- Add container healthcheck endpoint and Compose healthcheck.
- Add structured logs with request/job IDs and redacted secrets.
- Add backup retention settings for config backups.

### P4: UI Readiness

- Rename "Models" to "Managed Models" or "Config Models".
- Replace path-heavy forms with guided editors, file pickers, presets, validations, and inline explanations.
- Make Dashboard action-oriented: show active blockers, warnings, and next actions instead of raw counts.
- Add inline help/tooltips for fields that users currently have to look up.
- Add "Test paths", "Test HF token", "Test config write", and "Scan models" actions.
- Add restart-required badges for settings that do not affect the running process until container restart.
- Add clear state labels: downloaded, unmanaged, managed, config-ready, staged, applied, restart-required.

### P5: Release And Deploy

- Finalize a stable Compose example with mounts for `/data`, `/models`, `/backups`, HF cache, `.env`, and optional UID/GID.
- Verify GHCR publish workflow end-to-end on `main` and version tags.
- Add versioned releases and a changelog.
- Add CI gates for backend tests, frontend tests, TypeScript build, Docker build, container smoke test, config apply with temp mounts, and path traversal/security tests.
- Add browser smoke tests for Import Model, Managed Models, GPU Planner, Config Preview, Settings, and Help.
- Add upgrade notes for preserving `/data`, backups, model files, and `.env`.

## Next

- High priority: remove the manual gap between downloading a model and managing it. A completed download should immediately offer or create a guided managed-model setup with inferred name, role, primary GGUF, companion mmproj/template files, GPU defaults, command defaults, and config preview readiness. The user should not have to look up paths or manually copy downloaded file paths into Models.
- Move the full Download Queue off Dashboard. Dashboard should only show active download summaries, failures, or warnings; the detailed queue/history belongs on Import Model or a dedicated Downloads page.
- Make completed downloads clearly become usable model assets. Show the saved file paths for completed jobs, add a "Create model from download" action, and/or auto-fill a managed model draft after download completion so users can see where the model was installed.
- Persist Hugging Face cache outside the container so interrupted downloads can resume across container recreates.
- Add a queue cleanup action for completed, failed, and cancelled jobs.
- Add disk-space checks before starting a download and show the estimate in the import flow.
- Add validation that selected multipart GGUF shards include every required shard.

## Done

- Add byte-level Hugging Face download progress instead of only job-stage progress.
- Add a per-job progress bar to the Download Queue.
- Add CI and release QA workflows for backend tests, frontend tests, frontend build, Docker build, Compose validation, container smoke, and Playwright smoke.
- Run the manager container as non-root by default and remove the recommended host `/tmp:/tmp` bind from the example Compose file.
- Add direct `pydantic` dependency coverage through the current install/test/build gates.
- Publish-ready GHCR workflow now includes `latest` on the default branch and version/SHA tags.
- Make config preview/apply safer with selected-model scoping, staged preview fingerprints, expiry, single-use apply, destructive-change detection, and explicit destructive confirmation.
- Preserve custom hooks during generated config rendering and keep preview generation read-only.
- Quote generated llama-server command values with shell-safe escaping.
- Add SQLite schema versioning and forward migration support for existing manager databases.
- Add GPU detection, live status, tensor-split recommendation APIs, and GPU Planner controls.
- Add current `config.yaml` import candidates so existing llama-swap model entries can become managed models.
- Fix README test command so it documents `npm test` plus `npm run build` instead of passing duplicate Vitest args.
- Fix stale matrix sets when a managed model matrix key changes.
- Implement backup retention pruning and expose retention controls in Settings.
- Add typed GPU recommendation request validation.
- Generate unique imported model IDs when current config entries slugify to the same value or collide with existing managed models.
- Reset GPU Planner tensor split recommendations when the device draft changes.
- Gate mutating Playwright smoke tests behind `ALLOW_E2E_MUTATIONS=1` and document disposable-target usage.
- Enforce model seed -> config preview -> config apply -> backup creation in CI container smoke.

# Claude Code Review — llama-swap-web Manager

> Reviewed 2026-04-30 using three parallel agents: backend bug hunter, frontend bug hunter, infrastructure/test reviewer.
> Issues already tracked in BACKLOG.md are intentionally excluded.

---

## Table of Contents

1. [Critical Issues](#critical-issues)
2. [Backend Bugs & Security](#backend-bugs--security)
3. [Frontend Bugs & UX](#frontend-bugs--ux)
4. [Help & Settings Completeness](#help--settings-completeness)
5. [Infrastructure & Configuration](#infrastructure--configuration)
6. [Test Coverage Gaps](#test-coverage-gaps)
7. [Summary Table](#summary-table)

---

## Critical Issues

### C1 — Upload endpoint reads entire file into memory (DoS vector)
**File:** `backend/app/main.py` ~line 198  
**Severity:** CRITICAL  
**Category:** Security / DoS  
`destination.write_bytes(await file.read())` reads the entire uploaded file into memory before writing. GGUF files are routinely 5–30 GB. No file size limit exists. Any client on the LAN can crash the server by uploading a large file.

### C2 — Container runs as root, /tmp bind-mounted to host
**File:** `Dockerfile`, `compose.example.yml` line 15  
**Severity:** CRITICAL  
**Category:** Security  
The Dockerfile never creates a non-root user. The compose example mounts `- /tmp:/tmp` and `DOWNLOAD_TEMP_DIR=/tmp` defaults to this. Any RCE or path traversal in the download or upload code runs as root with write access to the host `/tmp` — a symlink attack and privilege escalation vector on multi-user hosts.

### C3 — pydantic is not a declared dependency
**File:** `requirements.txt`, `pyproject.toml`  
**Severity:** CRITICAL  
**Category:** Dependencies  
Both `settings.py` and `schemas.py` import directly from `pydantic`, but it is not listed as a direct dependency. It only works transitively through FastAPI. Any change to FastAPI's dependency resolution silently breaks the entire app at import time.

### C4 — CI workflow never pushes `:latest` tag; compose example references `:latest`
**File:** `.github/workflows/docker.yml`, `compose.example.yml` line 3  
**Severity:** CRITICAL (user-facing)  
**Category:** CI / Deploy  
The metadata-action only generates branch-ref tags (e.g., `:main`), never `:latest`. The compose example uses `ghcr.io/n3kr0nom1c0n/llama-swap-web:latest`. Every user who follows the README gets an image-not-found error on `docker compose up`.

---

## Backend Bugs & Security

### B1 — Config preview creates directories as a side effect
**File:** `backend/app/config_service.py` ~lines 235–236  
**Severity:** HIGH  
**Category:** Bug / Side Effect  
`validate_config_document` is called from the read-only preview endpoint but calls `path_obj.mkdir(parents=True, exist_ok=True)` for manager model root, backup dir, and download temp dir. A typo in Settings will silently create wrong directories on the filesystem during a preview operation.

### B2 — Hooks wholesale replaced on config regeneration
**File:** `backend/app/config_service.py` ~line 279  
**Severity:** HIGH  
**Category:** Bug  
`render_config` does `document["hooks"] = hooks` — completely replacing any existing hooks from the current YAML. Only models are merged per-key. Any custom llama-swap hooks (webhooks, event handlers beyond `on_startup.preload`) are silently destroyed every time config is regenerated.

### B3 — Flag values with spaces produce broken commands
**File:** `backend/app/config_service.py` ~lines 69–75  
**Severity:** HIGH  
**Category:** Bug  
`_format_flag` returns `f"{flag} {value}"` with no quoting. Any path or string containing a space (e.g., `/models/my templates/chat.jinja`) generates a malformed llama-server command that will fail to launch.

### B4 — Download flattens HF subdirectory structure; silently overwrites files
**File:** `backend/app/hf_service.py` ~line 145  
**Severity:** HIGH  
**Category:** Bug  
`target = safe_join(destination, Path(filename).name)` uses `.name`, stripping subdirectory prefixes. If a repo has `subfolder/model.gguf` and `otherfolder/model.gguf`, the second silently overwrites the first. This is distinct from the BACKLOG item about per-model directories.

### B5 — `save_model` has a read-write race condition
**File:** `backend/app/database.py` ~lines 128–141  
**Severity:** MEDIUM  
**Category:** Race Condition  
`save_model` reads the existing model in one SQLite connection then writes in another. Between these two calls, another concurrent request can modify the same model, causing `created_at` to be lost or corrupted under concurrent API access.

### B6 — Backup timestamp collision; non-atomic config write
**File:** `backend/app/config_service.py` ~lines 311–324  
**Severity:** MEDIUM  
**Category:** Bug / Data Integrity  
Backup filenames use second-level granularity (`%Y%m%d-%H%M%S`). Two applies within one second silently overwrite the first backup. The config write itself is non-atomic — a crash mid-write leaves a corrupted config with no rollback.

### B7 — Staged configs accumulate forever; same stage_id can be re-applied
**File:** `backend/app/database.py` ~lines 168–173; `backend/app/main.py` ~lines 176–188  
**Severity:** MEDIUM  
**Category:** Bug / Security  
`staged_configs` rows are never deleted — not after apply, not on expiry, not on startup. Old staged configs remain valid indefinitely. The BACKLOG tracks expiry, but not the specific bug that the same `stage_id` can be replayed multiple times after settings/models have changed.

### B8 — `os.environ` modification for HF token is not thread-safe
**File:** `backend/app/settings.py` ~line 129  
**Severity:** MEDIUM  
**Category:** Race Condition  
`os.environ[HF_TOKEN_KEY] = token` modifies the process-wide environment while download threads may be concurrently reading `os.getenv("HF_TOKEN")` in `hf_service.py`. `setenv`/`getenv` are not guaranteed thread-safe in all C library implementations.

### B9 — `put_hf_token` and `hf_resolve` accept untyped `dict` instead of Pydantic models
**File:** `backend/app/main.py` ~lines 68–75, 93–101  
**Severity:** MEDIUM  
**Category:** API Correctness  
`HfResolveRequest` schema exists in `schemas.py` but the endpoint ignores it. Both endpoints use raw `dict`, bypassing validation and generating incorrect OpenAPI docs. Sending `{"token": 123}` to the token endpoint silently converts to string; missing `token` key silently becomes `""`.

### B10 — `_cancelled` set and `_threads` dict leak memory indefinitely
**File:** `backend/app/downloads.py` ~line 36  
**Severity:** MEDIUM  
**Category:** Memory Leak  
Job IDs are added to `self._cancelled` on cancel but never removed. Finished threads are never removed from `self._threads`. Both grow without bound over the lifetime of the server process.

### B11 — `max_parallel_downloads` setting change has no effect at runtime
**File:** `backend/app/downloads.py` ~lines 37–38; `backend/app/main.py` ~line 65  
**Severity:** MEDIUM  
**Category:** Bug  
The semaphore is created once at `__init__` with the initial setting. When a user changes `max_parallel_downloads` via the Settings API and the manager saves the new value, the semaphore retains its original count until restart. The setting appears to save successfully but has no effect.

### B12 — TOCTOU race in config preview file existence check
**File:** `backend/app/main.py` ~line 169  
**Severity:** MEDIUM  
**Category:** Bug / Race Condition  
`Path(...).exists()` then `Path(...).read_text()` — the file can be deleted between these two calls (e.g., during a concurrent apply). Results in an unhandled `FileNotFoundError` → 500.

### B13 — `_write_env_token` is not atomic
**File:** `backend/app/settings.py` ~line 172  
**Severity:** LOW  
**Category:** Data Integrity  
`path.write_text(...)` writes directly to the target `.env` file. A crash mid-write corrupts the file and loses the HF token. The fix is write-to-temp then `os.replace()`.

### B14 — `hf_resolve` maps all exceptions to HTTP 400
**File:** `backend/app/main.py` ~lines 100–101  
**Severity:** LOW  
**Category:** Error Handling  
`except Exception as exc: raise HTTPException(status_code=400)` converts network timeouts, HF server errors, and auth failures all to 400 Bad Request, making it impossible to distinguish client errors from server/network failures.

### B15 — `redact_secrets` function is dead code with a latent bug
**File:** `backend/app/database.py` ~lines 181–186  
**Severity:** LOW  
**Category:** Dead Code  
`redact_secrets` is defined but never called. It also only redacts top-level keys — nested dicts containing "token" or "secret" are not processed. False sense of security if ever activated.

### B16 — `SettingsResponse` schema is defined but never used
**File:** `backend/app/schemas.py` ~lines 135–137  
**Severity:** LOW  
**Category:** Dead Code  
The schema exists but endpoints return raw `dict` from `settings.public_dict()`.

### B17 — Database always commits on reads (unnecessary fsync)
**File:** `backend/app/database.py` ~lines 23–31  
**Severity:** LOW  
**Category:** Performance  
The `connect()` context manager calls `conn.commit()` on every exit, including pure SELECT queries, causing unnecessary WAL flushes.

### B18 — Database seeds developer-specific GPU defaults (dual 3090)
**File:** `backend/app/database.py` ~lines 79–86  
**Severity:** MEDIUM  
**Category:** Configuration  
On first initialization the DB is seeded with two `GpuDevice` records: name="3090", vram_gb=24. Any user who is not running a dual-3090 rig sees phantom GPUs they didn't configure. This is likely to confuse new users who forget to clear these before generating configs.

### B19 — Backup timestamps use local time; DB timestamps use UTC
**File:** `backend/app/config_service.py` ~line 316; `backend/app/database.py` ~line 14  
**Severity:** LOW  
**Category:** Correctness  
`datetime.now()` for backup filenames vs `datetime.now(UTC)` for DB records. In containers with custom `TZ`, backup filenames and database timestamps will be in different timezones, making it hard to correlate operations.

---

## Frontend Bugs & UX

### F1 — `n_gpu_layers` is collected in the UI but never included in the generated command
**File:** `frontend/src/pages/ModelsPage.tsx` ~line 235; `frontend/src/utils.ts` ~lines 16–45  
**Severity:** HIGH  
**Category:** Bug  
The FlagEditor has an `n_gpu_layers` input. The user sets it, saves the model — but `modelCommand()` in `utils.ts` has no `addFlag(parts, "--n-gpu-layers", flags.n_gpu_layers)` call. The flag is silently dropped from every generated command. Models will not offload to GPU even if the user explicitly configured it.

### F2 — Textarea `splitList` destroys user input mid-typing
**File:** `frontend/src/pages/ModelsPage.tsx` ~lines 118, 124, 139  
**Severity:** HIGH  
**Category:** Bug / UX  
Alias, manager_files, container_files, and tokenizer_files textareas use `value={draft.aliases.join("\n")}` with `onChange` that immediately calls `splitList()` which trims and filters empty strings. Every keystroke round-trips through split→filter→join. A trailing comma or Enter at end of line is eaten on the next render. The user cannot type `value1,` and start typing `value2` without the delimiter being consumed.

### F3 — Numeric flag inputs sent to API as strings
**File:** `frontend/src/pages/ModelsPage.tsx` ~lines 237–269; `frontend/src/api.ts` ~lines 86–98  
**Severity:** HIGH  
**Category:** Type Safety / Bug  
All flag inputs (parallel, batch-size, temp, top-p, etc.) call `setFlag(key, event.target.value)` storing strings. `normalizeModel` only converts top-level fields, not `llama_flags`. The API receives `{"parallel": "2"}` instead of `{"parallel": 2}`.

### F4 — No unsaved-changes guard on Settings, Models, or GPU Planner
**File:** `frontend/src/pages/SettingsPage.tsx`, `ModelsPage.tsx`, `GpuPlannerPage.tsx`  
**Severity:** HIGH  
**Category:** UX / Data Loss  
All three pages maintain draft state but have no `beforeunload` handler or React Router navigation blocker. Clicking any sidebar link discards all unsaved edits without warning.

### F5 — Models page `useEffect` overwrites user edits on background refetch
**File:** `frontend/src/pages/ModelsPage.tsx` ~lines 25–28  
**Severity:** HIGH  
**Category:** Bug / Race Condition  
The effect `[models.data, selectedId]` calls `setDraft(found)` whenever `models.data` changes. A background refetch triggered by any `invalidateQueries` (e.g., after save, or from Layout's state query) silently resets the draft to server data, discarding any edits the user made after the last save.

### F6 — ConfigPreviewPage does not invalidate state after Apply
**File:** `frontend/src/pages/ConfigPreviewPage.tsx` ~lines 17–22  
**Severity:** HIGH  
**Category:** Bug / Stale State  
After a successful `apply` mutation, neither the `preview` query nor the `state` query is invalidated. The diff display continues showing "pending changes" even though the config was just applied. The user may apply again unnecessarily, creating duplicate backups.

### F7 — `createImport` result never populates the draft model file paths
**File:** `frontend/src/pages/ImportModelPage.tsx` ~line 50  
**Severity:** HIGH  
**Category:** Bug  
The `createImport` mutation has no `onSuccess` handler. After staging an import, the destination path is shown in a message but `manager_files`, `container_files`, and `primary_model_file` in the draft are never updated. The user must manually fill in all file paths.

### F8 — `defaultTtlForRole` silently applies chat TTL to coding models
**File:** `frontend/src/utils.ts` ~lines 7–14  
**Severity:** MEDIUM  
**Category:** Bug  
The function has explicit branches for `reasoning`, `vision`, `aux`, but `coding` falls through to `ttl_chat`. There is no `ttl_coding` in the `Defaults` type. Coding models get the chat TTL default (likely 0) with no UI indication or way to configure a separate coding TTL.

### F9 — `matrixExpression` function has identical branches for all non-custom modes
**File:** `frontend/src/utils.ts` ~lines 58–63  
**Severity:** MEDIUM  
**Category:** Bug / Incomplete  
Three of four `matrix_behavior` branches return the identical expression `model.matrix_key || model.id`. Only `custom` differs. A `runs_alone` model should produce a different expression than a `with_support` model. The function appears incomplete.

### F10 — `ConfigPreviewPage` preview query fires immediately on mount with empty selection
**File:** `frontend/src/pages/ConfigPreviewPage.tsx` ~lines 13–16  
**Severity:** MEDIUM  
**Category:** UX / Performance  
There is no `enabled` guard on the preview query. It fires `POST /api/config/preview` on every page mount before the user has selected any models. This is a wasted API call (and potentially expensive YAML generation) on every visit.

### F11 — Settings success/error messages are sticky and never auto-clear
**File:** `frontend/src/pages/SettingsPage.tsx` ~lines 132–135, 219–220  
**Severity:** MEDIUM  
**Category:** UX  
`save.isSuccess` and similar mutation states persist until the next mutation. After saving, the "Settings saved." message stays visible while the user edits new fields, creating the false impression that unsaved changes are already saved.

### F12 — Layout shows no error state when the API is unreachable
**File:** `frontend/src/Layout.tsx` ~lines 39–44  
**Severity:** MEDIUM  
**Category:** UX / Error Handling  
When the `state` query errors, `state.data` is `undefined`. The topbar silently shows "0 models", "0 GPUs", "0 jobs" — indistinguishable from a genuinely empty system. No error indicator is surfaced.

### F13 — API error handler double-reads response body
**File:** `frontend/src/api.ts` ~lines 19–26  
**Severity:** MEDIUM  
**Category:** Bug  
`response.json()` is tried first; if it throws, `response.text()` is tried. However, `response.json()` consumes the body stream. After it fails (e.g., for an HTML error page), `response.text()` returns an empty string. Non-JSON error responses always produce blank error messages.

### F14 — `GpuPlannerPage` "Add GPU" always uses `current.length` as the CUDA index
**File:** `frontend/src/pages/GpuPlannerPage.tsx` ~line 49  
**Severity:** MEDIUM  
**Category:** Bug  
If a user deletes a GPU from the middle of the list, the next "Add GPU" sets index to `current.length`, which may collide with an existing GPU's CUDA index.

### F15 — GPU row key uses editable `gpu.index`, causing remount mid-edit
**File:** `frontend/src/pages/GpuPlannerPage.tsx` ~line 57  
**Severity:** MEDIUM  
**Category:** Bug  
`` key={`${gpu.index}-${index}`} `` changes when the user edits the CUDA index field, causing React to unmount and remount the row. The input loses focus and partially typed values may be lost.

### F16 — Dashboard has two competing `state` query poll intervals
**File:** `frontend/src/Layout.tsx` ~line 19; `frontend/src/pages/DashboardPage.tsx` ~line 10  
**Severity:** MEDIUM  
**Category:** Performance  
Layout sets `refetchInterval: 15000`; DashboardPage sets `refetchInterval: 10000` for the same `queryKeys.state`. React Query uses the shortest, so state polls at 10s while on the Dashboard, 15s elsewhere. This is not obvious from reading either file.

### F17 — `Field` component wraps multiple checkboxes in a single `<label>`
**File:** `frontend/src/components/Field.tsx` ~lines 9–16  
**Severity:** MEDIUM  
**Category:** Accessibility  
Several call sites pass a `<div>` containing multiple `<input type="checkbox">` as Field's children. A `<label>` should be associated with exactly one form control. Screen readers may announce the label text for every checkbox or only the first.

### F18 — `CodeBlock` copy button silently fails on non-HTTPS origins
**File:** `frontend/src/components/CodeBlock.tsx` ~line 16  
**Severity:** MEDIUM  
**Category:** UX / Bug  
`navigator.clipboard?.writeText(...)` with `void` (no await, no error handling). The Clipboard API requires a secure context (HTTPS or localhost). A LAN app accessed via `http://192.168.x.x:8081` will silently fail on every copy attempt with no user feedback.

### F19 — ImportModelPage hardcodes download query keys instead of using `queryKeys`
**File:** `frontend/src/pages/ImportModelPage.tsx` ~lines 27, 72, 75, 95  
**Severity:** LOW  
**Category:** Code Quality  
`queryKey: ["downloads"]` and `queryKey: ["download", lastJobId]` are inline strings instead of using the `queryKeys` constant. A future rename of these keys in `queryKeys.ts` will silently break cache invalidation.

### F20 — No loading state on Models, ConfigPreview, or GpuPlanner pages
**File:** `frontend/src/pages/ModelsPage.tsx`, `ConfigPreviewPage.tsx`, `GpuPlannerPage.tsx`  
**Severity:** LOW  
**Category:** UX  
Unlike SettingsPage, these pages render their full UI immediately with empty defaults while data is loading. Users see empty tables and forms with no indication that data is pending.

### F21 — `redactToken` regex too aggressive; matches flag names containing `hf_`
**File:** `frontend/src/utils.ts` ~lines 65–67  
**Severity:** LOW  
**Category:** Bug  
`/hf_[A-Za-z0-9_:-]+/g` will match and redact legitimate llama.cpp flags like `--hf_revision` or path components containing `hf_` as a prefix, replacing them with `hf_***` in generated command previews.

### F22 — `StatusPill` "warn" tone uses the same icon as "idle"
**File:** `frontend/src/components/StatusPill.tsx` ~line 14  
**Severity:** LOW  
**Category:** Accessibility  
`warn` falls through to the `Clock3` icon (same as `idle`). Only color distinguishes them. Colorblind users or high-contrast mode users cannot differentiate warn from idle status at the icon level.

---

## Help & Settings Completeness

### H1 — `helpContent.ts` has no entry for the `coding` role TTL
**File:** `frontend/src/helpContent.ts` ~lines 341–347  
**Severity:** LOW  
**Category:** Help Completeness  
The settings reference section lists TTLs for reasoning, chat, vision, and aux, but not coding. The coding role is documented elsewhere (role directories, import model) but has no TTL guidance. A user configuring a coding model doesn't know what TTL behavior to expect.

### H2 — `flash_attn` preset is a free-text input; valid values are not documented
**File:** `frontend/src/pages/SettingsPage.tsx` ~line 204  
**Severity:** LOW  
**Category:** UX / Settings Completeness  
The flash-attn default preset field is a plain text `<input>`. Valid llama.cpp values are specific strings (e.g., the flag is a boolean — present or absent). Typing "yes", "true", or "1" produces an invalid command. There is no dropdown, no help text, and no mention in the help content.

### H3 — Port and download-concurrency settings have no numeric validation
**File:** `frontend/src/pages/SettingsPage.tsx` ~lines 85, 91, 94  
**Severity:** LOW  
**Category:** Settings Completeness  
`app_port` has no `min`/`max` attributes (accepts 0, negative, or >65535). `max_parallel_downloads` and `disk_safety_gb` accept 0 or negative values. Setting downloads to 0 silently prevents all downloads.

### H4 — SSE `/api/events` endpoint is a stub that immediately closes
**File:** `backend/app/main.py` ~lines 201–206  
**Severity:** LOW  
**Category:** Incomplete Feature  
The endpoint yields one `event: ready` then the generator ends, closing the SSE connection immediately. Any frontend code listening for real-time events via this endpoint gets one event and then a dropped connection, with no reconnect or heartbeat.

---

## Infrastructure & Configuration

### I1 — Compose double-injects .env: both `env_file` directive and volume mount
**File:** `compose.example.yml` ~lines 6–7, 11  
**Severity:** MEDIUM  
**Category:** Configuration  
`.env` is loaded via `env_file:` (injecting vars into container environment) AND mounted as a file at `/app/.env` (read by `hf_token_env_file()`). HF_TOKEN is loaded two ways. If the user edits `.env` on the host without restarting, the file and environment diverge silently.

### I2 — `vitest/globals` in tsconfig types but `globals: true` not set in vitest config
**File:** `tsconfig.app.json` ~line 19; `vite.config.ts` ~lines 18–21  
**Severity:** MEDIUM  
**Category:** Configuration / Tests  
TypeScript sees vitest globals (`describe`, `expect`, etc.) as available without import, but vitest does not inject them at runtime. Tests happen to work because each file explicitly imports from "vitest". A test written relying on globals from types will compile but fail at runtime with "describe is not defined".

### I3 — `LLAMA_SERVER_CMD` default in `.env.example` points to `/app/llama-server` which doesn't exist in the manager container
**File:** `.env.example` ~line 16  
**Severity:** MEDIUM  
**Category:** Configuration  
The manager container does not include `llama-server`. Generated commands using this default path will reference a nonexistent binary. This is arguably by design (commands run in the llama-swap container), but the default is confusing and undocumented.

### I4 — Python 3.14 used locally vs 3.12 in Dockerfile and pyproject.toml
**File:** `pyproject.toml` ~line 6; `Dockerfile` ~line 13  
**Severity:** LOW  
**Category:** Configuration / Compatibility  
Local `.venv` uses Python 3.14; Docker uses `python:3.12-slim`. Tests passing locally on 3.14 may not catch 3.12-specific regressions.

### I5 — No `conftest.py` in backend tests; fixture boilerplate duplicated across all test files
**File:** `backend/tests/`  
**Severity:** LOW  
**Category:** Tests / Maintainability  
Each test file independently creates a `create_app(tmp_path)` + `TestClient`. A shared `conftest.py` with a `client` fixture would eliminate duplication.

### I6 — Frontend test files each declare a full `settingsPayload` manually
**File:** `frontend/src/pages/*.test.tsx` (3 files)  
**Severity:** LOW  
**Category:** Tests / Maintainability  
Three test files redeclare the full 15+ field settings object inline. Adding a new required settings field requires updating all three.

### I7 — README `npm test -- --run` passes `--run` twice to vitest
**File:** `README.md` ~lines 216–225  
**Severity:** LOW  
**Category:** Documentation  
`package.json` already defines `"test": "vitest run"`. Running `npm test -- --run` results in `vitest run --run`. The correct command is `npm test`. Additionally, `npm run build` is listed under the Tests section but is a build step.

---

## Test Coverage Gaps

| Area | Status |
|------|--------|
| ModelsPage | No tests |
| ConfigPreviewPage | No tests (highest risk — config apply) |
| GpuPlannerPage | No tests |
| Upload endpoint | No backend test |
| Settings PUT endpoint | No backend test |
| GPU save endpoint | No backend test |
| Download cancel via API | No backend test |
| SSE events endpoint | No backend test |

---

## Summary Table

| ID | Severity | Area | Title |
|----|----------|------|-------|
| C1 | CRITICAL | Backend | Upload reads entire file into memory (DoS) |
| C2 | CRITICAL | Infra | Container runs as root + /tmp host mount |
| C3 | CRITICAL | Infra | pydantic not declared as direct dependency |
| C4 | CRITICAL | CI | :latest tag never pushed; compose uses :latest |
| B1 | HIGH | Backend | Config preview creates directories as side effect |
| B2 | HIGH | Backend | Hooks replaced wholesale on config regeneration |
| B3 | HIGH | Backend | Flag values with spaces produce broken commands |
| B4 | HIGH | Backend | Download flattens HF subdir structure, overwrites files |
| F1 | HIGH | Frontend | n_gpu_layers dropped from generated command |
| F2 | HIGH | Frontend | splitList destroys textarea input mid-typing |
| F3 | HIGH | Frontend | Numeric flags stored/sent as strings |
| F4 | HIGH | Frontend | No unsaved-changes guard on Settings/Models/GPU |
| F5 | HIGH | Frontend | Models draft overwritten on background refetch |
| F6 | HIGH | Frontend | ConfigPreview stale after Apply; no invalidation |
| F7 | HIGH | Frontend | createImport result never updates draft file paths |
| B5 | MEDIUM | Backend | save_model read-write race condition |
| B6 | MEDIUM | Backend | Backup collision + non-atomic config write |
| B7 | MEDIUM | Backend | Staged configs accumulate; stage_id replayable |
| B8 | MEDIUM | Backend | HF token env write not thread-safe |
| B9 | MEDIUM | Backend | hf_token and hf_resolve endpoints use untyped dict |
| B10 | MEDIUM | Backend | _cancelled set and _threads dict leak memory |
| B11 | MEDIUM | Backend | max_parallel_downloads change has no runtime effect |
| B12 | MEDIUM | Backend | TOCTOU race on config preview file check |
| B18 | MEDIUM | Backend | DB seeded with developer-specific dual-3090 GPUs |
| F8 | MEDIUM | Frontend | coding role silently gets chat TTL |
| F9 | MEDIUM | Frontend | matrixExpression identical for all non-custom modes |
| F10 | MEDIUM | Frontend | Preview query fires on mount before user selects models |
| F11 | MEDIUM | Frontend | Settings success messages never clear |
| F12 | MEDIUM | Frontend | No error state when API is unreachable |
| F13 | MEDIUM | Frontend | API error handler double-reads response body |
| F14 | MEDIUM | Frontend | Add GPU CUDA index collision after delete |
| F15 | MEDIUM | Frontend | GPU row key changes mid-edit, loses focus |
| F16 | MEDIUM | Frontend | Competing state query poll intervals |
| F17 | MEDIUM | Frontend | Field wraps multiple checkboxes in single label |
| F18 | MEDIUM | Frontend | CodeBlock copy silently fails on non-HTTPS |
| I1 | MEDIUM | Infra | .env double-injected via env_file and volume mount |
| I2 | MEDIUM | Infra | vitest globals in tsconfig but not enabled at runtime |
| I3 | MEDIUM | Infra | LLAMA_SERVER_CMD default path doesn't exist in container |
| B13 | LOW | Backend | .env write non-atomic on crash |
| B14 | LOW | Backend | hf_resolve maps all exceptions to HTTP 400 |
| B15 | LOW | Backend | redact_secrets dead code with nested-dict bug |
| B16 | LOW | Backend | SettingsResponse schema unused |
| B17 | LOW | Backend | DB commits on every read (unnecessary fsync) |
| B19 | LOW | Backend | Backup timestamps local time vs DB UTC |
| F19 | LOW | Frontend | Download query keys hardcoded strings |
| F20 | LOW | Frontend | No loading state on Models/Config/GPU pages |
| F21 | LOW | Frontend | redactToken regex too aggressive |
| F22 | LOW | Frontend | StatusPill warn and idle share same icon |
| H1 | LOW | Help | No coding role TTL documentation |
| H2 | LOW | Help/Settings | flash_attn free-text with no valid value guidance |
| H3 | LOW | Settings | Port/download fields missing numeric validation |
| H4 | LOW | Backend | SSE /api/events is a stub; closes immediately |
| I4 | LOW | Infra | Python 3.14 local vs 3.12 in Docker |
| I5 | LOW | Infra | No conftest.py; fixture boilerplate duplicated |
| I6 | LOW | Infra | settingsPayload duplicated in 3 test files |
| I7 | LOW | Infra | README test command passes --run twice |

**Totals:** 4 Critical · 11 High · 21 Medium · 22 Low = **58 issues**

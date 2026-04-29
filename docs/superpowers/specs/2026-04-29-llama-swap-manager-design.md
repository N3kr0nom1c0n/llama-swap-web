# Llama-Swap Manager Design

Date: 2026-04-29

## Goal

Build a small LAN-accessible web app that manages llama-swap model imports and staged `config.yaml` updates for an Ubuntu AI rig running llama-swap in Docker.

The app should let the user paste a Hugging Face URL or upload a model file, download or place the model into the correct mounted model directory, generate the llama-swap model entry, generate current-style `matrix` concurrency config, preview the YAML diff, back up the existing config, and apply the change only after explicit approval.

The manager itself should be delivered as a Docker container so it can be pulled and launched with bind mounts.

## Existing Rig Context

The target llama-swap service currently runs with Docker Compose:

```yaml
services:
  llama-swap:
    image: ghcr.io/mostlygeek/llama-swap:v204-cuda-b8851
    container_name: llama-swap
    restart: unless-stopped
    runtime: nvidia
    ulimits:
      memlock:
        hard: -1
        soft: -1
    environment:
      - NVIDIA_VISIBLE_DEVICES=all
      - NVIDIA_DRIVER_CAPABILITIES=all
    ports:
      - "9292:8080"
    volumes:
      - /home/n3kr0/Repos/llama.cpp/models:/models
      - /home/n3kr0/Repos/llama-swap/config.yaml:/app/config.yaml:ro
      - /mnt/data_hoard/llama-swap/logs:/logs
      - /tmp:/tmp
```

Important paths:

- Host model root: `/home/n3kr0/Repos/llama.cpp/models`
- Llama-swap container model root: `/models`
- Host config path: `/home/n3kr0/Repos/llama-swap/config.yaml`
- Llama-swap container config path: `/app/config.yaml`
- Backup path: `/mnt/data_hoard/llama-swap/backups`
- Temporary download path: `/tmp`

The app must keep host paths and container paths separate. Downloaded files are written to the host-mounted model root, while generated llama-swap commands use `/models/...`.

## Deployment

The manager will run separately from llama-swap.

Recommended Compose shape:

```yaml
services:
  llama-swap-manager:
    image: ghcr.io/n3kr0/llama-swap-manager:latest
    container_name: llama-swap-manager
    restart: unless-stopped
    ports:
      - "8081:8081"
    env_file:
      - .env
    volumes:
      - /home/n3kr0/Repos/llama.cpp/models:/models
      - /home/n3kr0/Repos/llama-swap/config.yaml:/app/config.yaml
      - /mnt/data_hoard/llama-swap/backups:/backups
      - /tmp:/tmp
```

The app binds to `0.0.0.0:8081` and has no login for v1. The trust boundary is the local LAN.

The container should be self-contained: no host Python, Node, Hugging Face CLI, or app dependencies are required. Pulling the image and launching the Compose service should be enough as long as the bind mounts exist.

The container is configured with environment variables:

```env
APP_HOST=0.0.0.0
APP_PORT=8081
HF_TOKEN=
MANAGER_MODEL_ROOT=/models
LLAMA_SWAP_MODEL_ROOT=/models
LLAMA_SWAP_CONFIG_PATH=/app/config.yaml
BACKUPS_DIR=/backups
DOWNLOAD_TEMP_DIR=/tmp
DISK_SAFETY_GB=20
MAX_PARALLEL_DOWNLOADS=1
LLAMA_SERVER_CMD=/app/llama-server
```

`MANAGER_MODEL_ROOT` is where the manager container writes files. `LLAMA_SWAP_MODEL_ROOT` is the path written into generated llama-swap commands. In the current Compose layout both are `/models`, which is the simplest and least error-prone setup.

No Docker socket is mounted in v1. The app does not restart llama-swap. After a config is applied, the UI tells the user to manually run:

```bash
docker compose restart llama-swap
```

## Product Scope

### Included in v1

- LAN web UI with no authentication.
- Settings page for path and behavior configuration.
- Hugging Face import from repo URL or direct file URL.
- Local file upload for `.gguf` and related files.
- Detection and selection of:
  - single GGUF models
  - multipart GGUF shards
  - `mmproj` files
  - chat template files
  - optional tokenizer files
- Rig-side download using `HF_TOKEN` from `.env`.
- Download queue with progress, cancel, retry, and logs.
- Model directory placement by role:
  - `/models/reasoning`
  - `/models/chat`
  - `/models/vision`
  - `/models/coding`
  - `/models/aux`
- Model command builder exposing all relevant llama-server flags.
- Raw command editing.
- Matrix-native concurrency planner.
- YAML diff preview before apply.
- Timestamped config backup before write.
- Basic validation before apply.
- Installed model inventory.
- Sample Compose service and `.env.example` for pull-and-launch deployment.

### Deferred

- Login/auth.
- Automatic llama-swap restart button.
- Docker socket integration.
- Automatic VRAM fit solver.
- Legacy `groups` generation.
- Multi-user roles.
- Remote peer management.

## UI

Main pages:

- Dashboard
- Import Model
- Models
- GPU Planner
- Config Preview
- Settings

The UI should be power-user friendly: dense enough to avoid hiding important config, but with guided defaults and presets so common installs are fast.

## Settings

The settings page controls:

- App host and port, default `0.0.0.0:8081`
- Manager model root, default `/models`
- Llama-swap model root used in generated config, default `/models`
- Config path, default `/app/config.yaml` inside the manager container
- Backup path, default `/backups`
- Temp path, default `/tmp`
- Hugging Face token source, default `HF_TOKEN` from `.env`
- Default Hugging Face revision, default `main`
- Private model support, default enabled
- Max parallel downloads, default `1`
- Disk safety floor, default `20GB`
- Default llama-server path in generated command, default `/app/llama-server` for llama-swap's container context
- Default model role directories
- Default model preset values

Default preset values:

```yaml
default_ttl_reasoning: 600
default_ttl_chat: 0
default_ttl_vision: 300
default_ttl_aux: 0
default_ctx_size: 65536
default_cache_type_k: q4_0
default_cache_type_v: q4_0
default_flash_attn: on
default_jinja: true
default_no_mmap: true
```

## GPU Model

The rig starts with:

```yaml
cuda_devices:
  - index: 0
    name: "3090"
    vram_gb: 24
    role: "large/reasoning/chat"
  - index: 1
    name: "3090"
    vram_gb: 24
    role: "large/reasoning/chat"
```

The GPU Planner lets the user edit GPU labels, VRAM, roles, and notes. Model entries can then select CUDA devices, main GPU, and tensor split.

## Import Flow

1. User chooses role: reasoning, chat, vision, coding, or aux.
2. User pastes a Hugging Face URL or uploads local files.
3. App resolves files.
4. App highlights likely primary model files.
5. User selects GGUF shards, optional `mmproj`, optional chat template, and optional tokenizer files.
6. App chooses destination folder.
7. User confirms download or upload placement.
8. App writes files to the mounted model directory.
9. App creates a draft model entry.
10. User edits flags, aliases, TTL, matrix behavior, and preload behavior.
11. App generates a staged config patch.

For Hugging Face downloads, the app downloads directly on the rig/container using the configured token so no model data has to pass through a separate desktop.

## Model Entry Data

Each managed model stores:

```yaml
id:
display_name:
role:
source_type:
hf_url:
hf_revision:
host_files:
manager_files:
container_files:
primary_model_file:
mmproj_file:
chat_template_file:
tokenizer_files:
aliases:
ttl:
gpu_devices:
main_gpu:
tensor_split:
llama_flags:
raw_cmd_override:
matrix_key:
evict_cost:
startup_preload:
created_at:
updated_at:
```

The generated llama-swap model entry includes:

- `cmd`
- `ttl`
- `aliases`, when present
- `env` with `CUDA_VISIBLE_DEVICES`
- optional `name`
- optional `description`

## Command Builder

The command builder exposes all important llama-server flags, including:

- `--ctx-size`
- `--cache-type-k`
- `--cache-type-v`
- `--tensor-split`
- `--main-gpu`
- `--n-gpu-layers`
- `--flash-attn`
- `--jinja`
- `--mmproj`
- `--chat-template-file`
- `--parallel`
- `--batch-size`
- `--ubatch-size`
- `--temp`
- `--top-p`
- `--top-k`
- `--min-p`
- `--presence-penalty`
- `--repeat-penalty`
- `--no-mmap`
- `--context-shift`
- `--keep`
- `--n-predict`

The builder shows the generated `cmd` at all times. Raw command override is allowed, but the UI should warn that raw overrides may bypass structured validation.

## Matrix Planner

The app uses current llama-swap `matrix`, not legacy `groups`.

The matrix planner has three concepts:

- Variables: short names mapped to model IDs.
- Evict costs: higher cost means avoid unloading that model.
- Sets: valid runtime combinations.

Example generated shape:

```yaml
matrix:
  vars:
    chat: "GPT-OSS:20B"
    reason: "GPT-OSS:120B"
    embed: "Qwen3-Embedding"
    rank: "BGE-ReRanker"

  evict_costs:
    embed: 100
    rank: 80
    reason: 40

  sets:
    normal_chat: "chat & embed & rank"
    big_reasoning: "reason"
```

The app should provide presets:

- Runs alone
- Can run with support models
- Always-on support model
- Expensive to evict
- Custom matrix expression

Hooks are generated separately for startup preload:

```yaml
hooks:
  on_startup:
    preload:
      - "Qwen3-Embedding"
      - "BGE-ReRanker"
```

## Config Editing

The app must not blindly rewrite the whole file when a targeted edit is possible. It should preserve user comments and section organization where practical.

Config apply flow:

1. Load current `config.yaml`.
2. Parse YAML.
3. Validate no legacy `groups` are present when generating `matrix`.
4. Apply staged model/matrix/hooks changes to an in-memory representation.
5. Render proposed YAML.
6. Show diff.
7. Run validation.
8. Write timestamped backup to `/backups`.
9. Write updated config only after approval.

Backup filename:

```text
config-YYYYMMDD-HHMMSS.yaml
```

## Validation

V1 validation includes:

- YAML parses cleanly.
- Top-level `models` exists.
- Model IDs are unique.
- Aliases are globally unique.
- Referenced matrix model IDs exist.
- Referenced preload model IDs exist.
- No `groups` section exists when `matrix` is enabled.
- Generated file paths use container paths, not host paths.
- Download destination stays inside allowed model root.
- Config backup path is writable.
- Disk free space is above configured safety floor.
- Command contains `${PORT}`.
- `CUDA_VISIBLE_DEVICES` matches selected GPUs.

If llama-swap later exposes or documents a stable validation command, the app can run it as an additional validation step.

## Security

V1 has no login by user choice. It binds on LAN and assumes the LAN is trusted.

The app still needs basic local safety:

- Do not allow writes outside configured mount roots.
- Do not expose `.env` values in logs or UI.
- Redact Hugging Face token.
- Do not mount Docker socket in v1.
- Do not execute arbitrary user commands.
- Treat raw command editing as config text only; do not run it.

## Testing

Core tests:

- HF URL parsing for repo URLs and direct file URLs.
- Multipart GGUF detection.
- Host path to container path mapping.
- Command generation for single-GPU and two-GPU models.
- Matrix generation.
- Preload hook generation.
- YAML parse/render round trip.
- Diff generation.
- Backup creation.
- Config validation failures.
- Disk safety check.

Manual test scenario:

1. Start manager container with sample mounts.
2. Import a small GGUF from Hugging Face.
3. Generate a chat model entry.
4. Assign GPU `0`.
5. Add model to a `normal_chat` matrix set.
6. Preview diff.
7. Apply staged config.
8. Confirm backup exists.
9. Restart llama-swap manually.
10. Confirm model appears through llama-swap's model list.

## Open Items

- Exact image registry/name for the manager container.
- Whether to ship a sample Compose file next to the app.
- Whether the manager should support an optional future restart command without Docker socket.
- First real model URLs to use for end-to-end testing.

## Sources

- Current llama-swap configuration docs: https://github.com/mostlygeek/llama-swap/blob/main/docs/configuration.md

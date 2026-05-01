# Llama-Swap Web

LAN web app for importing Hugging Face GGUF models onto an AI rig, staging llama-swap model entries, and generating `config.yaml` changes before you apply them.

The app is intentionally LAN focused. Version 1 has no login. Production use is SSH-first: the manager can run on one machine while one or more target rigs receive the downloads, config writes, GPU checks, and restart commands over SSH. Local bind-mounted mode still exists for single-host installs. It stores app state in SQLite and keeps Hugging Face tokens out of API responses.

## What It Does

- Resolve Hugging Face model or file URLs and classify GGUF files, multipart shards, mmproj files, chat templates, and tokenizer-side files.
- Manage multiple target rigs from Settings, including SSH host, key path, model root, config path, backups path, health check, and restart command.
- Download selected files directly on the selected target rig into per-model directories under `/models/<role>/<model-id>/`.
- Upload local model files through the manager and stream them onto the selected target rig.
- Track queued/running/completed/cancelled download jobs with progress.
- Turn completed downloads or existing scanned `/models` files into managed model entries without copying paths.
- Show Dashboard next actions for active downloads, failed jobs, downloaded-but-unconfigured files, and config blockers.
- Manage model metadata, GPU placement, llama.cpp flags, aliases, preload behavior, and matrix membership.
- Generate a llama-swap `matrix` config preview with a unified diff.
- Validate staged YAML, create a timestamped backup, and apply the config only after approval.
- List and restore config backups from the UI when a generated config needs rollback.
- Optionally restart llama-swap from Config Preview using the selected target rig's SSH restart command, or Docker socket controls in local single-host mode.
- Provide a built-in Help page that explains every app area and the important model settings.

## Recommended Docker Install

Docker Compose is the recommended deployment path. The manager stays self-contained; for a remote llama-swap rig, mount only manager state, `.env`, and an SSH key. Model files and config are written on the target rig over SSH.

1. Copy the example files:

   ```sh
   cp .env.example .env
   cp compose.example.yml compose.yml
   ```

2. Edit `.env`.

   Leave `HF_TOKEN=` blank if you only use public models. Add a token only in your local `.env` when you need gated or private Hugging Face downloads:

   ```dotenv
   HF_TOKEN=hf_your_token_here
   ```

3. Prepare writable manager paths for the container user.

   The published image runs as UID/GID `10001:10001`. The manager data directory, local `.env`, and any mounted SSH key directory must be readable or writable as appropriate by that ID:

   ```sh
   sudo mkdir -p ./data ./ssh
   sudo chown -R 10001:10001 ./data .env
   sudo chown -R 10001:10001 ./ssh
   chmod 700 ./ssh
   chmod 600 ./ssh/id_ed25519
   ```

   If you want the Settings page to save or clear `HF_TOKEN`, make the local `.env` file writable by the same ID too:

   ```sh
   sudo chown 10001:10001 .env
   ```

4. Edit `compose.yml` for SSH-first remote rig management:

   ```yaml
   volumes:
     - ./.env:/app/.env
     - ./ssh:/data/ssh:ro
     - llama-swap-manager-data:/data
   ```

   In Settings -> Target Rigs, create an SSH rig:

   - Host: `192.168.42.40`
   - Username: your rig user, for example `n3kr0`
   - SSH key path: `/data/ssh/id_ed25519`
   - Target model root: the real directory on the rig, for example `/home/n3kr0/Repos/llama.cpp/models`
   - llama-swap model root: the path used inside llama-swap commands, usually `/models`
   - Target config path: the real config file on the rig, for example `/home/n3kr0/Repos/llama-swap/config.yaml`
   - Target backups dir: durable backup path on the rig
   - Restart command: for example `docker restart llama-swap` or `docker compose -f /home/n3kr0/Repos/llama-swap/docker-compose.yml restart llama-swap`

   Generated llama-swap commands should use container paths such as `/models/chat/...`, not host paths. The target model root controls where SSH writes bytes on the rig; the llama-swap model root controls what path appears in `config.yaml`.

   For single-host local mode only, bind mount your model root, config file, and backup directory into the manager container and keep the default local target rig.

   Optional Docker socket restart controls are only for local single-host mode. SSH target rigs should use the target rig restart command instead. If you still need local Docker socket restart, add:

   ```yaml
   group_add:
     - "${DOCKER_SOCKET_GID:?Set DOCKER_SOCKET_GID to the Docker socket group id}"
   volumes:
     - /var/run/docker.sock:/var/run/docker.sock
   ```

   On Linux, set `DOCKER_SOCKET_GID` in `.env` to the group id that owns the socket:

   ```sh
   printf 'DOCKER_SOCKET_GID=%s\n' "$(stat -c '%g' /var/run/docker.sock)" >> .env
   ```

   Then set these app values. `.env` seeds startup defaults only when the manager database is first initialized; after that, Settings is the source of truth for persisted manager settings.

   ```dotenv
   LLAMA_SWAP_RESTART_ENABLED=true
   LLAMA_SWAP_CONTAINER_NAME=llama-swap
   DOCKER_SOCKET_PATH=/var/run/docker.sock
   LLAMA_SWAP_RESTART_TIMEOUT=30
   ```

   Mounting the Docker socket grants host-level Docker control to this container. Keep the manager LAN-only and enable this only on a trusted rig.

5. Start the manager:

   ```sh
   docker compose up -d
   ```

6. Open:

   ```text
   http://localhost:8081
   ```

For LAN access, open `http://<rig-ip>:8081` from another machine. Keep this on a trusted LAN or behind your own reverse proxy because v1 does not include auth.

## Docker Image

The GitHub Actions workflow publishes `latest` on pushes to `main`:

```text
ghcr.io/n3kr0nom1c0n/llama-swap-web:latest
```

Release tags named like `v1.2.3` also publish version tags such as `1.2.3` and `1.2`. Pull requests build the image for validation but do not push image tags.

To build locally instead:

```sh
docker build -t llama-swap-web:local .
```

Then change `compose.yml`:

```yaml
image: llama-swap-web:local
```

## Native Install

Native mode is useful for development or debugging. Docker is still preferred for normal rig deployment.

Requirements:

- Python 3.12+
- Node.js 22+
- A writable model directory
- A writable llama-swap `config.yaml`
- A writable backups directory

1. Create a Python environment and install backend dependencies:

   ```sh
   python3.12 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

2. Install frontend dependencies:

   ```sh
   npm install
   ```

3. Create a local `.env`:

   ```sh
   cp .env.example .env
   ```

4. Set native paths in `.env`.

   Example:

   ```dotenv
   APP_HOST=0.0.0.0
   APP_PORT=8081
   DATA_DIR=./data
   MANAGER_DB_PATH=./data/manager.db
   MANAGER_ENV_FILE=.env
   MANAGER_MODEL_ROOT=/path/to/llama.cpp/models
   LLAMA_SWAP_MODEL_ROOT=/models
   LLAMA_SWAP_CONFIG_PATH=/path/to/llama-swap/config.yaml
   BACKUPS_DIR=/path/to/llama-swap/backups
   DOWNLOAD_TEMP_DIR=./data/tmp
   HF_HOME=./data/hf-cache
   HF_HUB_CACHE=./data/hf-cache/hub
   HF_TOKEN=
   ```

   `MANAGER_MODEL_ROOT` is where this app writes files on the host. `LLAMA_SWAP_MODEL_ROOT` is the path that should appear in generated llama-swap commands. In Docker they are usually both `/models`; in native mode they are often different.

5. Build the frontend and run the API:

   ```sh
   npm run build
   PYTHONPATH=backend uvicorn app.main:app --host 0.0.0.0 --port 8081
   ```

6. Open:

   ```text
   http://localhost:8081
   ```

## Native Development Mode

For active frontend work, run the backend and Vite dev server separately.

Terminal 1:

```sh
source .venv/bin/activate
PYTHONPATH=backend uvicorn app.main:app --host 127.0.0.1 --port 8081 --reload
```

Terminal 2:

```sh
npm run dev
```

Open:

```text
http://localhost:5173
```

The Vite dev server proxies `/api` to `http://127.0.0.1:8081`.

## Configuration Reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_HOST` | `0.0.0.0` | FastAPI bind host inside Docker or native runtime. |
| `APP_PORT` | `8081` | App port. |
| `DATA_DIR` | `/data` | Persistent state directory. |
| `MANAGER_DB_PATH` | `/data/manager.db` | SQLite database path. |
| `MANAGER_ENV_FILE` | `/app/.env` | Env file used when Settings saves or clears `HF_TOKEN`. |
| `HF_HOME` | `/data/hf-cache` | Hugging Face cache root. |
| `HF_HUB_CACHE` | `/data/hf-cache/hub` | Hugging Face Hub cache directory. |
| `MANAGER_MODEL_ROOT` | `/models` | Filesystem path the manager writes downloads/uploads into. |
| `LLAMA_SWAP_MODEL_ROOT` | `/models` | Path llama-swap should see in generated commands. |
| `LLAMA_SWAP_CONFIG_PATH` | `/app/config.yaml` | llama-swap config file to preview, back up, and update. |
| `BACKUPS_DIR` | `/backups` | Directory for config backups before apply. |
| `DOWNLOAD_TEMP_DIR` | `/data/tmp` | Temporary download staging directory. |
| `MAX_PARALLEL_DOWNLOADS` | `1` | Download concurrency limit. |
| `MAX_UPLOAD_BYTES` | `53687091200` | Maximum accepted upload size in bytes. Defaults to 50 GiB so large GGUF uploads work while still enforcing a hard cap. |
| `ALLOWED_UPLOAD_EXTENSIONS` | `.gguf,.safetensors,.json,.jinja,.jinja2,.model,.tiktoken` | Comma-separated upload allowlist. Keep this narrow to model and companion file types. |
| `DISK_SAFETY_GB` | `20` | Reserved free-space safety margin. |
| `LLAMA_SERVER_CMD` | `/app/llama-server` | Command path used in generated model entries. |
| `LLAMA_SWAP_RESTART_ENABLED` | `false` | Enables the manual restart button and Docker socket status check. |
| `LLAMA_SWAP_CONTAINER_NAME` | `llama-swap` | Container name the manager restarts when restart controls are enabled. |
| `DOCKER_SOCKET_PATH` | `/var/run/docker.sock` | Docker Unix socket path inside the manager container. |
| `LLAMA_SWAP_RESTART_TIMEOUT` | `30` | Docker restart timeout in seconds. |
| `DOCKER_SOCKET_GID` | empty | Compose interpolation helper for `group_add` when mounting `/var/run/docker.sock` into the non-root manager container. Not read by the app. |
| `CORS_ALLOWED_ORIGINS` | empty | Comma-separated dev origins allowed to call the API from a browser. Keep empty for recommended Docker/LAN same-origin use. For Vite dev, use `http://localhost:5173,http://127.0.0.1:5173`. |
| `HF_TOKEN` | empty | Optional Hugging Face token for gated/private downloads. |

## Security Notes

- Do not commit `.env`, `compose.yml`, model files, SQLite databases, backups, logs, or tokens. The included `.gitignore` excludes those by default.
- `HF_TOKEN` is read from the environment or `.env`; API responses only show whether a token is configured.
- The app is designed for a trusted LAN in v1. Put it behind your own auth layer if it is reachable outside your LAN.
- The manager does not need Docker socket access unless you enable manual restart controls. A mounted Docker socket is powerful because it can control containers on the host.
- The Docker image runs as UID/GID `10001:10001`. Keep bind mounts writable by that ID instead of running the container as root.
- Do not mount host `/tmp` into the manager container. Use `/data/tmp` for download staging and `/data/hf-cache` for Hugging Face cache data.

## Restarting llama-swap

When the manager applies a generated `config.yaml`, it writes a backup first and reports that a restart is required. By default, restart llama-swap manually after reviewing the generated config:

```sh
docker compose restart llama-swap
```

Run that in the Compose project that actually owns your llama-swap container. The manager intentionally does not restart llama-swap automatically as part of config apply.

If optional restart controls are enabled, Config Preview shows a `llama-swap Runtime` panel. It checks the configured Docker socket and container, then exposes a manual `Restart llama-swap` button. The button is disabled when the socket is missing, the configured container is not reachable, or restart controls are disabled in Settings.

## Backup And Restore

Config Preview shows backups created under `/backups`. Applying config and restoring config both create a backup of the current file first.

To restore from the UI:

1. Open Config Preview.
2. Review the Backups section.
3. Click Restore on the backup you want.
4. Restart llama-swap manually after restore.

Only safe `config*.yaml` backups inside the configured backups directory are listed or restorable. Traversal paths, directories, missing files, and symlink escapes are rejected by the API.

## Tests

Backend:

```sh
./.venv/bin/pytest backend/tests -q
```

Frontend:

```sh
npm test
npm run build
```

Secret scan:

```sh
bash scripts/secret-scan.sh
```

Browser smoke tests run against an already-running native app or container. The default target is `http://127.0.0.1:8081`; override it with `BASE_URL` when needed:

```sh
npx playwright install chromium
ALLOW_E2E_MUTATIONS=1 BASE_URL=http://127.0.0.1:8081 npm run e2e -- --project=chromium
```

Only set `ALLOW_E2E_MUTATIONS=1` against a disposable test container because the smoke creates a QA model entry. Playwright reports, traces, screenshots, and endpoint smoke snapshots are written under `artifacts/qa/`.

CI runs backend tests, frontend tests, frontend build, Docker build, Compose config validation, and a temp-mounted container smoke. The Docker publish workflow runs release QA before publishing; pull requests build without publishing, pushes to `main` publish `ghcr.io/n3kr0nom1c0n/llama-swap-web:latest`, and `v*` tags publish version tags.

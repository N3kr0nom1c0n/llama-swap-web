# Llama-Swap Web

LAN web app for importing Hugging Face GGUF models onto an AI rig, staging llama-swap model entries, and generating `config.yaml` changes before you apply them.

The app is intentionally local/LAN focused. Version 1 has no login, does not mount the Docker socket, and does not restart llama-swap automatically. It downloads and writes models through the manager container, stores app state in SQLite, and keeps Hugging Face tokens out of API responses.

## What It Does

- Resolve Hugging Face model or file URLs and classify GGUF files, multipart shards, mmproj files, chat templates, and tokenizer-side files.
- Download selected files directly on the rig into role-based model directories.
- Upload local model files into the mounted model root.
- Track queued/running/completed/cancelled download jobs with progress.
- Manage model metadata, GPU placement, llama.cpp flags, aliases, preload behavior, and matrix membership.
- Generate a llama-swap `matrix` config preview with a unified diff.
- Validate staged YAML, create a timestamped backup, and apply the config only after approval.
- Provide a built-in Help page that explains every app area and the important model settings.

## Recommended Docker Install

Docker Compose is the recommended deployment path. It keeps the app self-contained while still letting it write to your existing model root and llama-swap config file through bind mounts.

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

3. Prepare writable host paths for the container user.

   The published image runs as UID/GID `10001:10001`. The bind-mounted model root, llama-swap config file, and backup directory must be writable by that ID:

   ```sh
   sudo chown -R 10001:10001 /path/to/llama.cpp/models /path/to/llama-swap/backups
   sudo chown 10001:10001 /path/to/llama-swap/config.yaml
   ```

   If you want the Settings page to save or clear `HF_TOKEN`, make the local `.env` file writable by the same ID too:

   ```sh
   sudo chown 10001:10001 .env
   ```

4. Edit `compose.yml` and point the mounts at your rig paths:

   ```yaml
   volumes:
     - ./.env:/app/.env
     - /path/to/llama.cpp/models:/models
     - /path/to/llama-swap/config.yaml:/app/config.yaml
     - /path/to/llama-swap/backups:/backups
     - llama-swap-manager-data:/data
   ```

   The manager command generator should use container paths such as `/models/chat/...`, not host paths. That is why the model root is mounted at `/models`. Runtime temp files and Hugging Face cache data live under `/data/tmp` and `/data/hf-cache` in the named data volume; do not bind-mount host `/tmp` into the container.

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
| `CORS_ALLOWED_ORIGINS` | empty | Comma-separated dev origins allowed to call the API from a browser. Keep empty for recommended Docker/LAN same-origin use. For Vite dev, use `http://localhost:5173,http://127.0.0.1:5173`. |
| `HF_TOKEN` | empty | Optional Hugging Face token for gated/private downloads. |

## Security Notes

- Do not commit `.env`, `compose.yml`, model files, SQLite databases, backups, logs, or tokens. The included `.gitignore` excludes those by default.
- `HF_TOKEN` is read from the environment or `.env`; API responses only show whether a token is configured.
- The app is designed for a trusted LAN in v1. Put it behind your own auth layer if it is reachable outside your LAN.
- The manager does not need Docker socket access.
- The Docker image runs as UID/GID `10001:10001`. Keep bind mounts writable by that ID instead of running the container as root.
- Do not mount host `/tmp` into the manager container. Use `/data/tmp` for download staging and `/data/hf-cache` for Hugging Face cache data.

## Restarting llama-swap

When the manager applies a generated `config.yaml`, it writes a backup first and reports that a restart is required. Restart llama-swap manually after reviewing the generated config:

```sh
docker compose restart llama-swap
```

Run that in the Compose project that actually owns your llama-swap container. The manager intentionally does not restart llama-swap in v1.

## Tests

Backend:

```sh
./.venv/bin/pytest backend/tests -q
```

Frontend:

```sh
npm test -- --run
npm run build
```

# Llama-Swap Manager

LAN web app for staging llama-swap model imports and generating `config.yaml`.

The packaged app runs one container with FastAPI serving the API and the built React/Vite frontend. It stores manager state in SQLite at `/data/manager.db`. Version 1 does not mount the Docker socket and does not restart llama-swap for you.

## Quick Start

1. Copy the examples:

   ```sh
   cp .env.example .env
   cp compose.example.yml compose.yml
   ```

2. Confirm `compose.yml` points at your llama-swap model root, active `config.yaml`, and backup directory. The example is prefilled for your current rig layout:

   ```yaml
   volumes:
     - /home/n3kr0/Repos/llama.cpp/models:/models
     - /home/n3kr0/Repos/llama-swap/config.yaml:/app/config.yaml
     - /mnt/data_hoard/llama-swap/backups:/backups
     - /tmp:/tmp
     - llama-swap-manager-data:/data
   ```

3. Start the manager:

   ```sh
   docker compose up -d
   ```

4. Open `http://localhost:8081`.

## Build Locally

```sh
docker build -t llama-swap-manager:local .
```

For local compose testing, change the image in `compose.yml`:

```yaml
image: llama-swap-manager:local
```

## Configuration

The app reads these environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_HOST` | `0.0.0.0` | FastAPI bind host inside the container. |
| `APP_PORT` | `8081` | FastAPI bind port inside the container. |
| `MANAGER_DB_PATH` | `/data/manager.db` | SQLite database path. |
| `MANAGER_MODEL_ROOT` | `/models` | Path the manager writes downloaded/imported models to. |
| `LLAMA_SWAP_MODEL_ROOT` | `/models` | Path llama-swap uses for those same models. |
| `LLAMA_SWAP_CONFIG_PATH` | `/app/config.yaml` | Mounted llama-swap config file to preview and update. |
| `BACKUPS_DIR` | `/backups` | Directory for config backups before writes. |
| `DOWNLOAD_TEMP_DIR` | `/tmp` | Temporary download staging directory. |
| `MAX_PARALLEL_DOWNLOADS` | `1` | Download concurrency limit. |
| `DISK_SAFETY_GB` | `20` | Reserved free-space safety margin. |
| `HF_TOKEN` | unset | Optional Hugging Face token for gated/private models. |

## Restarting llama-swap

When the manager applies a generated `config.yaml`, it creates a backup and reports that a restart is required. Restart llama-swap manually after reviewing the generated config:

```sh
docker compose restart llama-swap
```

Use the command in the compose project that actually runs llama-swap. The manager container intentionally has no Docker socket access in v1.

## Image Publishing

`.github/workflows/docker.yml` builds the image on pull requests and publishes to GHCR on pushes to `main`, version tags, or manual workflow dispatch. The published image name is:

```text
ghcr.io/n3kr0/llama-swap-manager
```

# Deployment

## Docker

Docker Compose is the production path. Use bind mounts for model files, config, and backups, and a persistent volume or bind mount for `/data`.

Recommended mounts:

```yaml
volumes:
  - ./.env:/app/.env
  - /home/n3kr0/Repos/llama.cpp/models:/models
  - /home/n3kr0/Repos/llama-swap/config.yaml:/app/config.yaml
  - /mnt/data_hoard/llama-swap/backups:/backups
  - llama-swap-manager-data:/data
```

Do not mount host `/tmp` into the manager container for normal operation. Use `/data/tmp`.

## Permissions

The image runs as UID/GID `10001:10001`. The mounted model root, config file, backups dir, and env file need to be writable by that user if the manager should edit them.

## GHCR

The intended image is:

```text
ghcr.io/n3kr0nom1c0n/llama-swap-web:latest
```

Version tags are published from release tags when CI is configured and authenticated.

## Native Mode

Native mode is for development and debugging. Set:

- `PYTHONPATH=backend`
- `MANAGER_MODEL_ROOT` to the host model path
- `LLAMA_SWAP_MODEL_ROOT` to `/models`
- `LLAMA_SWAP_CONFIG_PATH` to the host config file
- `BACKUPS_DIR` to a host backup directory

Build the frontend before running FastAPI if you want the production UI served by the backend.

## Upgrades

1. Pull the new image.
2. Stop the manager.
3. Keep `/data`, `/models`, `/backups`, and `config.yaml`.
4. Start the new manager.
5. Check `/api/health` and Settings.
6. Run a config preview before applying anything.

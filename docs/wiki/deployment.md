# Deployment

## Docker

Docker Compose is the production path. For split-host installs, run the manager wherever convenient and connect it to one or more llama-swap rigs over SSH. Use a persistent volume or bind mount for `/data`, mount `.env`, and mount an SSH key read-only.

Recommended SSH-first mounts:

```yaml
volumes:
  - ./.env:/app/.env
  - ./ssh:/data/ssh:ro
  - llama-swap-manager-data:/data
```

Then open Settings -> Target Rigs and add each remote rig. Set the SSH host, username, SSH key path (`/data/ssh/id_ed25519`), target model root on that rig, llama-swap model root seen by the llama-swap container, config path on the rig, backups dir, health command, and restart command.

Do not mount host `/tmp` into the manager container for normal operation. Use `/data/tmp`.

Local single-host mode is still supported. Only use these mounts when the manager and llama-swap share the same host/storage and the selected target rig is local:

```yaml
volumes:
  - /home/n3kr0/Repos/llama.cpp/models:/models
  - /home/n3kr0/Repos/llama-swap/config.yaml:/app/config.yaml
  - /mnt/data_hoard/llama-swap/backups:/backups
```

Optional local Docker restart controls require a Docker socket mount:

```yaml
group_add:
  - "${DOCKER_SOCKET_GID:?Set DOCKER_SOCKET_GID to the Docker socket group id}"
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

On Linux, set `DOCKER_SOCKET_GID=$(stat -c '%g' /var/run/docker.sock)` in `.env` so the non-root manager can read and write the socket. Then enable `LLAMA_SWAP_RESTART_ENABLED=true` and set `LLAMA_SWAP_CONTAINER_NAME=llama-swap`. `.env` values are first-run defaults; for existing manager installs, change these values in Settings. Mounting the Docker socket grants Docker control on the manager host, not a remote rig. Prefer SSH restart commands for remote rigs.

## Permissions

The image runs as UID/GID `10001:10001`. In SSH mode, `/data` and `.env` need to be writable by that user, and `/data/ssh/id_ed25519` needs to be readable. On the target rig, the SSH user must be allowed to write the model root, config path, and backups dir, and to run the configured restart command.

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
3. Keep manager `/data`, `.env`, and mounted SSH keys. For SSH-first installs, model files, backups, and live `config.yaml` live on the target rig and should not be replaced by the manager deploy.
4. Start the new manager.
5. Check `/api/health` and Settings.
6. Run a config preview before applying anything.

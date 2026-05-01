# Settings Reference

Settings control manager runtime behavior, download behavior, generated commands, and config write behavior.

## Target Rigs

Target Rigs decide where llama-swap work actually happens. In split-host production, choose an SSH target rig before importing models. Downloads, uploads, scans, GPU detection, config preview/apply/restore, backup listing, and restart all run against the selected target.

- Rig ID and name: stable identifier and label shown in the top bar.
- Mode: `ssh` for remote AI rigs, `local` only when the manager shares storage with llama-swap.
- Host, port, username, SSH key path: how the manager connects to the rig.
- Target model root: real filesystem path on the rig where files are written.
- Llama-swap model root: path emitted in generated commands, usually `/models` inside the llama-swap container.
- Target config path: real `config.yaml` path on the rig.
- Target backups dir: where config backups are written on the rig.
- Restart command: command executed over SSH when you click restart.
- Health check command: command used to decide whether the rig/runtime is reachable.

If the manager is on `192.168.42.10` and llama-swap is on `192.168.42.40`, the target model root and config path must be paths on `192.168.42.40`. The destination shown in Import Model is the selected target rig's path, not the manager host.

## Runtime

- App host and port: FastAPI bind address. Usually set by environment and requires restart.
- Data dir: persistent state root. SQLite and cache-related data should live here.
- Max parallel downloads: download concurrency. Higher values can saturate disk and network.
- Disk safety GB: free-space reserve. Downloads and validation should not consume the last usable space.
- llama-swap restart control: optional Docker socket integration for a manual Config Preview restart button.

## Paths

- Manager model root: filesystem path the manager writes to.
- Llama-swap model root: path emitted in generated llama-server commands.
- llama-swap config path: config file the manager previews, backs up, applies, and restores.
- Backups dir: config backup and restore directory.
- Download temp dir: temporary workspace path.

In SSH mode, the target rig's model root replaces the old local manager model root for model operations. In Docker local mode, manager model root and llama-swap model root are usually both `/models`. In native local mode, manager model root may be a host path while llama-swap model root remains `/models`.

## Role Directories

Role directories organize models by use:

- reasoning
- chat
- vision
- coding
- aux

They should sit under the llama-swap model root so generated commands remain valid.

## Defaults

Defaults seed new managed model entries:

- ttl by role
- ctx-size
- cache types
- flash attention
- jinja
- no-mmap

Changing defaults does not rewrite existing models automatically. Edit existing managed models when you want changed flags.

## Hugging Face Token

The HF token is read from environment or the manager env file. The API only reports whether a token is configured and where it came from. Use a read token for gated/private models. Rotate it in Hugging Face if it is exposed.

The manager writes token changes atomically so partial `.env` writes do not leave a broken token file.

## llama-swap Restart Control

For SSH target rigs, restart control is the target rig's `Restart command`. Config Preview runs that command over SSH when you click `Restart llama-swap`.

For local target rigs, Docker socket restart control is disabled by default. When enabled, the backend checks the configured Docker socket and container name, then Config Preview shows a manual `Restart llama-swap` button. `.env` restart values are startup defaults for a new database only; after first launch, the Settings page is the source of truth.

- Enable llama-swap restart control: opt-in switch. Nothing restarts until the button is clicked.
- llama-swap container name: Docker container to inspect and restart, usually `llama-swap`.
- Docker socket path: socket path inside the manager container, usually `/var/run/docker.sock`.
- Restart timeout seconds: Docker restart timeout before force-stop.

Mounting `/var/run/docker.sock` gives the manager container Docker control on the manager host only. Because the image runs as UID/GID `10001:10001`, compose also needs `group_add` with the host Docker socket group id. Keep the app LAN-only or behind your own auth layer when this is enabled.

# Settings Reference

Settings control manager runtime behavior, download behavior, generated commands, and config write behavior.

## Runtime

- App host and port: FastAPI bind address. Usually set by environment and requires restart.
- Data dir: persistent state root. SQLite and cache-related data should live here.
- Max parallel downloads: download concurrency. Higher values can saturate disk and network.
- Disk safety GB: free-space reserve. Downloads and validation should not consume the last usable space.

## Paths

- Manager model root: filesystem path the manager writes to.
- Llama-swap model root: path emitted in generated llama-server commands.
- llama-swap config path: config file the manager previews, backs up, applies, and restores.
- Backups dir: config backup and restore directory.
- Download temp dir: temporary workspace path.

In Docker, manager model root and llama-swap model root are usually both `/models`. In native mode, manager model root may be a host path while llama-swap model root remains `/models`.

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

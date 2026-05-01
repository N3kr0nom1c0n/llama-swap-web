# Config Preview, Apply, And Restore

Config Preview is the safety boundary before the manager writes the selected target rig's `config.yaml`.

## Preview

Preview reads the selected target rig's current config, renders manager-owned models for that rig, validates generated YAML, and shows a unified diff. A valid preview receives a `stage_id`. Apply uses that staged preview, not a hidden regeneration.

## Destructive Diffs

The manager warns when a preview removes existing models, aliases, matrix entries, hooks, preload entries, or global settings. Destructive changes require explicit confirmation.

An empty managed model database should never silently wipe an existing useful llama-swap config.

## Apply

Apply does this:

1. Re-reads current config.
2. Verifies the staged preview is fresh.
3. Creates a timestamped backup in the selected rig's backups directory.
4. Writes the new config atomically when possible.
5. Returns a restart-required note.

The manager does not restart llama-swap automatically as part of apply. SSH target rigs use the configured remote restart command. Local single-host installs can use Docker socket controls if explicitly enabled.

## Backup List

The Config Preview page lists config backups from the selected target rig. Only safe `config*.yaml` backups are shown.

## Restore

Restore does this:

1. Validates the requested backup name is safe.
2. Creates a backup of the current config first.
3. Replaces the active config with the selected backup.
4. Returns a restart-required note.

Use restore when a generated config prevents llama-swap from loading the intended models.

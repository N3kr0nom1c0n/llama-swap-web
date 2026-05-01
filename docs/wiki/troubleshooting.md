# Troubleshooting

## Download Stays Queued

Queued means the job exists but is waiting for a download slot. Check max parallel downloads, running jobs, and whether the current job is blocked by disk preflight.

## Download Fails Immediately

Check:

- HF token for gated/private repos.
- URL and revision.
- Free disk space on the selected target rig.
- Destination path under the selected target rig's model root.
- SSH health if the manager and llama-swap are on different machines.
- Hugging Face rate limits or network errors.

## Download Completed But Model Is Not Usable

A completed download only means files were written. Create or attach a managed model entry, then preview and apply config.

## Config Apply Fails

Check:

- Selected target rig is correct and reachable.
- Config file exists and is writable on that target rig.
- Backup directory exists and is writable on that target rig.
- Generated paths use `/models/...`.
- Preview is fresh and valid.
- Destructive changes are intentionally confirmed.

## Bad Config Was Applied

Open Config Preview, find the backup list, and restore a previous backup. Restart llama-swap manually after restore.

## GPU Detection Fails

For SSH rigs, check that `nvidia-smi` is available to the configured SSH user on the selected target rig. For local rigs, check whether `nvidia-smi` is available in the manager container. The manager can still use manually entered GPU data if detection is unavailable.

## HF Token Is Not Working

Use Settings to confirm token configured state and source. If source says environment, editing the manager env file may not affect the startup token until restart. Prefer a read token and avoid pasting tokens into logs or issue reports.

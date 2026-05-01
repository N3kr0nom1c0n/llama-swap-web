# Llama-Swap Web Wiki

This wiki is the operator guide for running Llama-Swap Web as a LAN manager for llama-swap and llama.cpp models. Production use is SSH-first: the web manager may run on one host while one or more target rigs own model downloads, scans, GPU detection, config writes, backups, and restarts.

Start here:

- [Getting Started](getting-started.md): first Docker launch and first model workflow.
- [Model Import Workflows](model-import-workflows.md): Hugging Face URLs, uploads, existing files, and completed downloads.
- [Managed Models](managed-models.md): model entries, files, presets, flags, aliases, and matrix behavior.
- [GPU Planning](gpu-planning.md): CUDA devices, tensor split, main GPU, VRAM warnings, and mixed GPU rigs.
- [Config Preview, Apply, And Restore](config-preview-apply-restore.md): staged YAML, destructive diffs, backups, and recovery.
- [Settings Reference](settings-reference.md): every important setting and what it changes.
- [Deployment](deployment.md): Docker, native mode, volumes, permissions, GHCR, and upgrades.
- [Troubleshooting](troubleshooting.md): common failure modes and what to check first.
- [Release QA](release-qa.md): commands and proof required before calling a build production-ready.

Version 1 is intentionally LAN-focused: no built-in login and no automatic llama-swap restart during config apply. SSH target rigs use a configured remote restart command. Optional Docker socket controls are local single-host only and should be enabled only on a trusted LAN or behind your own auth layer.

# Llama-Swap Web Wiki

This wiki is the operator guide for running Llama-Swap Web as a LAN manager for llama-swap and llama.cpp models.

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

Version 1 is intentionally LAN-focused: no built-in login and no automatic llama-swap restart during config apply. Optional manual restart controls require an explicit Docker socket mount and should only be enabled on a trusted LAN or behind your own auth layer.

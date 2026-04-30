# Getting Started

Llama-Swap Web manages model files and llama-swap config generation from a browser. It is meant to make common llama.cpp work feel closer to Ollama: pick a model, install it on the rig, configure GPU/runtime flags, preview config, apply safely, then restart llama-swap manually.

## Recommended Docker Launch

1. Copy the examples:

   ```sh
   cp .env.example .env
   cp compose.example.yml compose.yml
   ```

2. Edit `.env` and `compose.yml` for your rig paths.

3. Mount the same model root that llama-swap sees as `/models`.

4. Mount the manager config path writable. The llama-swap container can keep its own config mount read-only.

5. Start the manager:

   ```sh
   docker compose up -d
   ```

6. Open `http://<rig-ip>:8081`.

## First Run Workflow

1. Open Settings and confirm model root, llama-swap model root, config path, backup path, data path, and HF token state.
2. Open GPU Planner and detect or enter CUDA devices.
3. Open Import Model and resolve a Hugging Face URL or upload a file.
4. Start the download or upload into the role-specific model folder.
5. When the job completes, use the install/create-managed-model action.
6. Open Managed Models, check files, GPU plan, ttl, matrix behavior, and llama.cpp flags.
7. Open Config Preview, review validation, warnings, generated YAML, and diff.
8. Apply config. A backup is created first.
9. Restart llama-swap manually.

## Existing llama-swap Installs

If you already have models in `config.yaml`, import current config before applying generated config. That prevents the manager from starting with an empty database and accidentally staging a config that removes existing entries.

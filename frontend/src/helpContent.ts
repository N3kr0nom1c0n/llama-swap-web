export interface HelpSetting {
  name: string;
  purpose: string;
  effect: string;
  guidance?: string;
}

export interface HelpTopic {
  id: string;
  title: string;
  summary: string;
  body: string[];
  settings?: HelpSetting[];
  examples?: string[];
  warnings?: string[];
}

export interface HelpSection {
  id: string;
  title: string;
  eyebrow: string;
  description: string;
  topics: HelpTopic[];
}

export const helpSections: HelpSection[] = [
  {
    id: "orientation",
    title: "How The Manager Works",
    eyebrow: "Workflow",
    description: "The app stages model files, builds llama-server commands, previews llama-swap YAML, backs up the existing config, and applies changes only when you approve them.",
    topics: [
      {
        id: "staged-flow",
        title: "Staged workflow",
        summary: "Nothing should silently rewrite llama-swap. The manager keeps import, download, preview, backup, and apply as separate steps.",
        body: [
          "Use Import Model to resolve Hugging Face files or upload local files. Use Models to refine the model entry. Use Config Preview to inspect generated YAML and diff before applying it.",
          "Applying config creates a timestamped backup in /backups before writing /app/config.yaml. Version 1 does not restart llama-swap for you, so restart llama-swap manually after applying a config.",
          "Generated commands should use the container model path /models/... because llama-swap runs inside Docker. Host paths such as /home/n3kr0/Repos/llama.cpp/models are only used by Docker volume mounts and the manager's write path.",
        ],
        examples: [
          "Rig model root mounted into manager: /models",
          "llama-swap config inside manager: /app/config.yaml",
          "Backups path inside manager: /backups",
        ],
        warnings: [
          "Do not point generated llama-server commands at host-only paths. The llama-swap container will not be able to read them.",
          "The manager intentionally has no Docker socket in v1. Config apply and llama-swap restart are separate actions.",
        ],
      },
      {
        id: "matrix-overview",
        title: "Matrix behavior",
        summary: "Matrix is the current llama-swap concurrency model. It describes which models are allowed to run together.",
        body: [
          "The manager generates matrix vars and sets instead of legacy groups. A matrix var is a short key for a model ID. A matrix set describes valid combinations using expressions such as a, a & b, or a | b.",
          "A model that runs alone should be isolated in matrix logic. A support model can stay available beside larger chat or reasoning models. Evict cost tells llama-swap which running models are more expensive to unload.",
          "For your multi-GPU rig, matrix behavior is where you express operational intent: big reasoning models may evict other large models, while embeddings or rerankers can remain persistent if VRAM allows.",
        ],
        settings: [
          {
            name: "Matrix key",
            purpose: "Short model identifier used by matrix vars.",
            effect: "The key appears in matrix expressions. Short keys keep the generated YAML readable.",
            guidance: "Use stable, memorable keys such as q27, g20, emb, or rr. Avoid aliases here; matrix vars should point to real model IDs.",
          },
          {
            name: "Matrix behavior",
            purpose: "Chooses the default concurrency pattern for the model.",
            effect: "A runs-alone model is isolated. A support model is intended to coexist. A with-support model can run beside support entries.",
            guidance: "Use support for rerankers and embeddings, runs-alone for models that consume most VRAM, and custom when the generated expression is not specific enough.",
          },
          {
            name: "Evict cost",
            purpose: "Relative cost of stopping this model.",
            effect: "Higher values make llama-swap prefer keeping the model running when choosing what to evict.",
            guidance: "Give slow-loading or always-needed models a higher value. Leave ordinary models blank or low.",
          },
        ],
      },
    ],
  },
  {
    id: "pages",
    title: "Using Each Page",
    eyebrow: "Navigation",
    description: "Each page owns one stage of the workflow so you can inspect state before changing files or config.",
    topics: [
      {
        id: "dashboard",
        title: "Dashboard",
        summary: "The action board for config writability, active downloads, failed jobs, and model setup blockers.",
        body: [
          "Use Dashboard first after a deploy. It shows whether /app/config.yaml exists and is writable, how many managed models exist, and what action is blocking a model from becoming usable.",
          "Next Actions replaces raw download history. It surfaces active downloads, failed or cancelled downloads, completed downloads that are not connected to a managed model, and config path problems.",
          "Use Finish setup on a downloaded-but-not-configured item to jump straight to Import Model with that job highlighted.",
          "If config is not writable, Config Preview can still render YAML, but Apply Config will fail. Check the compose mount for /home/n3kr0/Repos/llama-swap/config.yaml:/app/config.yaml.",
        ],
      },
      {
        id: "import-model",
        title: "Import Model",
        summary: "The guided path from HF URL, upload, or existing file scan to managed model and config preview.",
        body: [
          "The pipeline strip shows the current stage: Source, Files, Download, Managed Model, and Config. The goal is to keep the next required action visible instead of making you jump between pages and copy paths.",
          "Paste a Hugging Face repo or file URL, choose a role, optionally set a desired name, then Resolve Files. The manager classifies GGUF files, multipart shards, mmproj files, chat templates, and tokenizer-like files.",
          "Preview Destination shows where the selected files will land. Start Download creates a background job that writes into a per-model directory under /models/<role>/<model-id>/, which is the same model root llama-swap sees.",
          "Ready Downloads lists completed jobs whose files are not referenced by a managed model yet. Create Managed Model lets the backend infer the role, primary GGUF, companion files, TTL, and default flags from the job.",
          "Scan Existing Files searches /models for GGUF and companion files already on disk. Use Create model on a scanned GGUF when you downloaded or copied files outside the manager.",
          "The Download Queue is the detailed history and control surface. It shows status, progress, bytes, active file, destination, written/container paths, cancel, retry, create, and Clear Finished.",
        ],
        warnings: [
          "For multipart GGUF models, select every shard needed by the model. A future validation pass will enforce this more strongly.",
          "HF token is required for private or gated repos. Save it in Settings before resolving those repositories.",
        ],
      },
      {
        id: "models",
        title: "Models",
        summary: "The detailed editor for llama-swap model entries and llama-server command generation.",
        body: [
          "Use Models when you need full control over model files, GPU selection, llama.cpp flags, aliases, TTL, matrix behavior, and raw command overrides.",
          "The generated command preview is the command that will be written into config.yaml unless Raw command override is set. Structured fields are safer because the manager can validate and map paths.",
          "Use raw override only when you need flags or command layout the builder cannot represent yet. Raw override gives you power but bypasses some guardrails.",
        ],
      },
      {
        id: "gpu-planner",
        title: "GPU Planner",
        summary: "Inventory CUDA devices and document how each card should be used.",
        body: [
          "The planner stores CUDA index, GPU name, VRAM, role, and notes. Model entries use CUDA indexes to generate CUDA_VISIBLE_DEVICES and related placement fields.",
          "For your rig, typical examples are 3090 cards for large/reasoning/coding models and smaller cards for aux, embedding, reranker, or vision support workloads.",
          "Use Detect GPUs when the manager can reach nvidia-smi. If detection is unavailable, keep the manual inventory accurate and treat saved GPU rows as the planning source of truth.",
        ],
        settings: [
          {
            name: "CUDA index",
            purpose: "The device number used by CUDA_VISIBLE_DEVICES and llama.cpp GPU placement.",
            effect: "Wrong indexes can put a model on the wrong GPU or fail to load if VRAM is insufficient.",
            guidance: "Match nvidia-smi ordering on the rig. Keep notes when cards are reserved for specific roles.",
          },
          {
            name: "VRAM GB",
            purpose: "Documents the memory available on the card.",
            effect: "The app currently uses this for planning context, not automatic scheduling.",
            guidance: "Record usable VRAM conservatively. Large context and KV cache can consume a lot beyond the model weights.",
          },
        ],
      },
      {
        id: "config-preview",
        title: "Config Preview",
        summary: "Generate YAML, inspect the diff, validate known constraints, and apply with backup.",
        body: [
          "Config Preview renders the full config.yaml content from saved model entries. It also shows a unified diff against the current mounted config file.",
          "Apply Config writes only a staged preview. If model entries change after preview, regenerate before applying. This prevents applying a config you did not inspect.",
          "The Backups section lists safe config backups created by apply or restore. Restoring a backup first backs up the current config, then replaces the active config with the selected backup.",
          "After apply, restart llama-swap manually. Version 1 does not restart Docker services.",
        ],
        warnings: [
          "Never apply a config if validation errors remain.",
          "Backups are created first, but a bad config can still stop llama-swap from loading models until corrected or restored.",
          "Restore also requires a manual llama-swap restart before the restored config is used.",
        ],
      },
      {
        id: "settings",
        title: "Settings",
        summary: "Global paths, defaults, Hugging Face token handling, role directories, and command defaults.",
        body: [
          "Settings controls the assumptions used by every other page. Path settings affect where files are written and how commands are generated. Defaults affect newly created model entries and generated commands.",
          "The Hugging Face token is stored in the manager env file and is never returned by the API. The UI only shows whether a token exists and where it is stored.",
        ],
      },
    ],
  },
  {
    id: "settings-reference",
    title: "Settings Reference",
    eyebrow: "Field Guide",
    description: "What each Settings field is for, what it changes, and how it affects model import or runtime behavior.",
    topics: [
      {
        id: "runtime-settings",
        title: "Runtime settings",
        summary: "Host, port, download behavior, disk safety, and the base llama-server command.",
        body: [
          "These settings control the manager process and the default command builder. Some require a container restart to affect the running manager process itself, but saved values still affect generated model entries.",
        ],
        settings: [
          {
            name: "App host",
            purpose: "Bind address used by FastAPI inside the container.",
            effect: "0.0.0.0 listens on all container interfaces and is what you want for LAN access through Docker port mapping.",
            guidance: "Leave this at 0.0.0.0 in Docker. Restrict exposure with firewall or compose ports, not by changing this to localhost inside the container.",
          },
          {
            name: "App port",
            purpose: "Internal FastAPI port.",
            effect: "Must match the compose port target. Your current LAN URL maps 8081:8081.",
            guidance: "Change only if another process inside the manager container needs that port.",
          },
          {
            name: "Default HF revision",
            purpose: "Revision used when an import does not specify one.",
            effect: "Usually main. Pinning a branch, tag, or commit can make downloads reproducible.",
            guidance: "Use main for normal browsing; use a commit hash when you want exact repeatability.",
          },
          {
            name: "Max parallel downloads",
            purpose: "Limits simultaneous Hugging Face transfer jobs.",
            effect: "Higher values can saturate disk and network. Very large GGUF downloads can compete with each other.",
            guidance: "Keep at 1 for huge model files unless you have a reason to parallelize smaller support files.",
          },
          {
            name: "Disk safety GB",
            purpose: "Minimum free-space cushion before config operations and future download checks.",
            effect: "Protects the model disk from filling completely.",
            guidance: "Use a larger number on the model volume if you download many 20GB to 80GB files.",
          },
          {
            name: "llama-server command",
            purpose: "Base executable used by generated commands.",
            effect: "Every structured model command starts with this value plus --port ${PORT}.",
            guidance: "For llama-swap's CUDA image this is usually /app/llama-server. Change only if your runtime image puts llama-server elsewhere.",
          },
        ],
      },
      {
        id: "hf-settings",
        title: "Hugging Face token",
        summary: "Credentials for private or gated model downloads.",
        body: [
          "Save Token writes HF_TOKEN into the configured env file. Clear Token removes it. The manager uses the token for file listing, metadata lookup, and downloads.",
          "The token is not shown back to the browser. If it is configured, the UI shows a status badge and token source path.",
        ],
        settings: [
          {
            name: "HF API token",
            purpose: "Allows access to private, gated, or rate-limited Hugging Face repositories.",
            effect: "Resolve Files and Start Download can authenticate directly from the rig, avoiding browser-mediated downloads.",
            guidance: "Use a read token. Rotate it from Hugging Face if it is exposed.",
          },
          {
            name: "Token source",
            purpose: "Shows where the manager found the token.",
            effect: "Usually /app/.env, mounted from /home/n3kr0/Repos/llama.web/.env.",
            guidance: "If this says environment, the token came from container env rather than the editable manager env file.",
          },
        ],
      },
      {
        id: "path-settings",
        title: "Path settings",
        summary: "Container and manager paths used for downloads, config writes, backups, and SQLite state.",
        body: [
          "The path settings are the difference between where the manager writes files and what llama-swap should see in config.yaml. In your current Docker setup they are intentionally the same inside the container: /models.",
        ],
        settings: [
          {
            name: "Manager model root",
            purpose: "Path where the manager writes downloaded or uploaded files.",
            effect: "Downloads are constrained under this root to prevent path traversal.",
            guidance: "In the container this should be /models, backed by /home/n3kr0/Repos/llama.cpp/models on the host.",
          },
          {
            name: "Llama-swap model root",
            purpose: "Path that generated llama-swap commands should use.",
            effect: "The command builder maps manager paths to this root so config.yaml is valid inside llama-swap.",
            guidance: "Keep this /models if llama-swap also mounts the model directory as /models.",
          },
          {
            name: "Config path",
            purpose: "Mounted config.yaml file the manager previews and writes.",
            effect: "Apply Config writes this file after creating a backup.",
            guidance: "Current target is /app/config.yaml inside the manager, mounted from /home/n3kr0/Repos/llama-swap/config.yaml.",
          },
          {
            name: "Backups dir",
            purpose: "Directory for timestamped config backups.",
            effect: "Every apply stores the previous config before writing the new one.",
            guidance: "Use durable storage such as /mnt/data_hoard/llama-swap/backups mounted to /backups.",
          },
          {
            name: "Download temp dir",
            purpose: "Temporary workspace path for downloads and uploads.",
            effect: "Large operations may touch this path depending on download behavior.",
            guidance: "Use a path backed by enough disk space. The recommended container path is /data/tmp; do not bind-mount host /tmp into the manager.",
          },
          {
            name: "Data dir",
            purpose: "Persistent manager data directory.",
            effect: "SQLite state lives here unless MANAGER_DB_PATH overrides it.",
            guidance: "Keep it mounted as /data so settings, jobs, and model entries survive container recreates.",
          },
        ],
      },
      {
        id: "role-directories",
        title: "Role directories",
        summary: "Default destination directories for imported models by purpose.",
        body: [
          "Role directories decide where new files land and how model entries are organized. They should stay under the llama-swap model root.",
          "The current roles are reasoning, chat, vision, coding, and aux. Use aux for embeddings, rerankers, small classifiers, and other support models.",
        ],
        settings: [
          {
            name: "reasoning",
            purpose: "Large or slow deliberate models.",
            effect: "New reasoning imports default to /models/reasoning.",
            guidance: "Use for GPT-OSS 120B style models or Qwen reasoning models.",
          },
          {
            name: "chat",
            purpose: "Primary general conversation models.",
            effect: "New chat imports default to /models/chat.",
            guidance: "Use for models intended to answer most normal prompts.",
          },
          {
            name: "vision",
            purpose: "Multimodal models and mmproj support files.",
            effect: "Vision imports default to /models/vision.",
            guidance: "Keep mmproj files and chat templates near the model they belong to.",
          },
          {
            name: "coding",
            purpose: "Code and technical models.",
            effect: "Coding imports default to /models/coding.",
            guidance: "Use for Qwen Coder, DeepSeek Coder, and similar models.",
          },
          {
            name: "aux",
            purpose: "Support models.",
            effect: "Aux imports default to /models/aux.",
            guidance: "Use for embeddings, rerankers, and small always-on models.",
          },
        ],
      },
      {
        id: "default-presets",
        title: "Default presets",
        summary: "Values copied into new model entries and used by generated commands when a model does not override them.",
        body: [
          "Defaults are not magic scheduler rules. They seed new model entries and fill missing command flags. Changing a default does not rewrite existing saved models unless you edit those models.",
        ],
        settings: [
          {
            name: "TTL reasoning, chat, vision, aux",
            purpose: "Default unload timeout in seconds by role.",
            effect: "ttl: 0 keeps a model loaded indefinitely. Higher values unload after inactivity.",
            guidance: "Use 0 for support models you always want hot. Use 300-600 for large models that should unload after use.",
          },
          {
            name: "ctx-size",
            purpose: "Default context window token limit.",
            effect: "Larger context windows consume more KV cache memory and can reduce how many models fit in VRAM.",
            guidance: "Increase for long-code or long-document work. Lower it if the model fails to load or VRAM pressure is high.",
          },
          {
            name: "cache-type-k and cache-type-v",
            purpose: "KV cache quantization types for keys and values.",
            effect: "Lower precision reduces memory usage, often with some quality or stability tradeoff.",
            guidance: "q4_0 is a practical large-context default. Use higher precision if quality matters more than context length or VRAM headroom.",
          },
          {
            name: "flash-attn",
            purpose: "Enables llama.cpp flash attention when supported.",
            effect: "Can improve memory use and speed on supported GPUs and models.",
            guidance: "Keep on unless a model/backend combination fails with it.",
          },
          {
            name: "jinja",
            purpose: "Enables Jinja chat template handling.",
            effect: "Helps models use their expected chat formatting, especially newer Qwen-family models.",
            guidance: "Keep enabled for chat and instruct models unless a specific model requires a different template path.",
          },
          {
            name: "no-mmap",
            purpose: "Avoids memory-mapping model weights.",
            effect: "Can reduce file-backed mmap behavior and make large Docker/GPU loads more predictable.",
            guidance: "Keep enabled for your large GPU rig unless you intentionally want mmap behavior.",
          },
        ],
      },
    ],
  },
  {
    id: "model-controls",
    title: "Model Controls And llama.cpp Flags",
    eyebrow: "Tuning",
    description: "The fields that most directly affect load behavior, VRAM use, throughput, sampling, and generated answers.",
    topics: [
      {
        id: "files-and-templates",
        title: "Files, templates, and aliases",
        summary: "These fields tell llama-server which files to load and how clients see the model.",
        body: [
          "Primary model file is the main GGUF passed to -m. MMProj file is the vision projector for multimodal models. Chat template file points llama.cpp at a specific template when the model needs one.",
          "Aliases let clients request friendly names while the actual model ID remains stable. Include aliases in llama-swap's model list if your config enables that globally.",
        ],
      },
      {
        id: "gpu-placement",
        title: "GPU placement",
        summary: "CUDA devices, main GPU, tensor split, and GPU layers decide where work and weights land.",
        body: [
          "CUDA devices become CUDA_VISIBLE_DEVICES. This limits which physical cards the model process can see. Main GPU selects the primary visible device for llama.cpp placement. Tensor split divides tensor work across visible GPUs.",
          "n-gpu-layers controls how much of the model is offloaded to GPU. Very high values such as 999 are commonly used to request full offload when possible.",
        ],
        settings: [
          {
            name: "CUDA devices",
            purpose: "Selects the GPU indexes visible to a model process.",
            effect: "Controls isolation and prevents one model from grabbing every card.",
            guidance: "For a 2x 3090 model, use 0,1. For a support model on a smaller card, assign only that card.",
          },
          {
            name: "Main GPU",
            purpose: "Primary GPU index inside the visible CUDA device set.",
            effect: "Influences where llama.cpp anchors buffers and work.",
            guidance: "Usually use the first visible device unless you have a placement reason.",
          },
          {
            name: "Tensor split",
            purpose: "Ratio for splitting model tensors across visible GPUs.",
            effect: "Bad splits can overload one GPU while another has free VRAM.",
            guidance: "For equal 24GB cards use 1,1. For mixed VRAM, weight the split toward larger cards.",
          },
          {
            name: "n-gpu-layers",
            purpose: "Number of model layers to place on GPU.",
            effect: "More layers on GPU usually means faster inference but higher VRAM use.",
            guidance: "Use 999 for full offload attempts. Lower it when a model does not fit.",
          },
        ],
      },
      {
        id: "throughput-flags",
        title: "Throughput flags",
        summary: "Batching and parallelism affect speed, latency, and memory pressure.",
        body: [
          "parallel controls simultaneous request slots in llama-server. batch-size and ubatch-size control token processing batches. Larger values can improve throughput but increase memory pressure.",
          "For single-user LAN work, parallel 1 is often simpler. Increase only when you expect overlapping clients or tools.",
        ],
        settings: [
          {
            name: "parallel",
            purpose: "Number of parallel sequences/request slots.",
            effect: "Higher values can serve concurrent requests but consume more KV cache.",
            guidance: "Use 1 for huge models. Use 2+ for small support services if needed.",
          },
          {
            name: "batch-size",
            purpose: "Logical prompt processing batch size.",
            effect: "Can improve prompt ingestion speed at the cost of memory.",
            guidance: "4096 is common for large GPU rigs. Reduce if loading or prompt processing fails.",
          },
          {
            name: "ubatch-size",
            purpose: "Physical micro-batch size.",
            effect: "Controls how batch work is chunked internally.",
            guidance: "Lower this before lowering batch-size when memory pressure appears during prompt ingestion.",
          },
        ],
      },
      {
        id: "sampling-flags",
        title: "Sampling and answer shape",
        summary: "Temperature, top-p, top-k, min-p, and penalties influence token choice after the model has loaded.",
        body: [
          "These settings do not usually affect load VRAM like ctx-size or GPU flags do. They affect the distribution of generated tokens and therefore style, creativity, repetition, and determinism.",
        ],
        settings: [
          {
            name: "temp",
            purpose: "Randomness of token selection.",
            effect: "Higher values are more varied; lower values are more deterministic.",
            guidance: "Use lower values for factual or coding tasks. Use higher values for brainstorming.",
          },
          {
            name: "top-p",
            purpose: "Nucleus sampling cutoff.",
            effect: "Limits sampling to the smallest token set whose probability mass reaches top-p.",
            guidance: "0.9 to 0.95 is common. 1.0 disables this cutoff.",
          },
          {
            name: "top-k",
            purpose: "Maximum number of candidate tokens considered.",
            effect: "Lower values constrain output more strongly.",
            guidance: "Use 0 only when the model or preset expects no top-k restriction.",
          },
          {
            name: "min-p",
            purpose: "Filters tokens below a probability threshold relative to the best token.",
            effect: "Can remove low-quality tail choices while preserving variety.",
            guidance: "Use cautiously; start at 0 or model-recommended values.",
          },
          {
            name: "presence-penalty and repeat-penalty",
            purpose: "Discourage repeated tokens or repeated concepts.",
            effect: "Can reduce loops, but aggressive values can make text worse.",
            guidance: "Raise when a model repeats itself. Keep conservative for coding models.",
          },
        ],
      },
      {
        id: "context-generation-flags",
        title: "Context and generation limits",
        summary: "Keep and n-predict decide how much context is retained and how long a response can be.",
        body: [
          "keep preserves prompt tokens when context shifting happens. n-predict limits how many tokens the model can generate in a response.",
          "Large n-predict values are useful for long code or reasoning, but they can tie up the model longer.",
        ],
        settings: [
          {
            name: "keep",
            purpose: "Number of initial tokens to preserve during context shifting.",
            effect: "Helps retain system prompt and instructions when the context window rolls forward.",
            guidance: "Use enough to preserve system/developer context. Large values reduce flexible context room.",
          },
          {
            name: "n-predict",
            purpose: "Maximum generated tokens.",
            effect: "Caps response length and runtime.",
            guidance: "Set higher for long reasoning or code generation. Set lower for fast assistants.",
          },
        ],
      },
      {
        id: "raw-command",
        title: "Raw command override",
        summary: "Full manual control when the structured command builder is not enough.",
        body: [
          "Raw command override replaces the generated llama-server command for that model. It is useful for advanced flags, experimental llama.cpp options, or non-standard servers.",
          "Because it bypasses structured generation, you must ensure paths, ${PORT}, CUDA visibility, and templates are correct yourself.",
        ],
        warnings: [
          "Raw commands can bypass validation. Prefer structured fields when they can express what you need.",
          "Always include --port ${PORT} unless you also configure proxy behavior manually.",
        ],
      },
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    eyebrow: "Ops",
    description: "Common failure modes and what to inspect first.",
    topics: [
      {
        id: "download-issues",
        title: "Downloads look stuck",
        summary: "Use the queue state, byte progress, and logs to tell queued, blocked, running, and failed jobs apart.",
        body: [
          "Queued means the job exists but is waiting for a download slot. Running means the child download process has started. Completed jobs have written_files and container_files. Failed jobs include an error.",
          "For new downloads, byte progress is based on Hugging Face file metadata and the local cache .incomplete file. If bytes do not move for a long time, check token access, network, disk, and the HF cache mount.",
        ],
      },
      {
        id: "config-issues",
        title: "Config apply fails",
        summary: "Most config apply failures are path, write permission, or validation issues.",
        body: [
          "Check Dashboard config status. If it is not writable, verify the compose bind mount for config.yaml is a file mount and not a directory.",
          "If generated paths look wrong, verify Manager model root and Llama-swap model root. The generated command should use /models/... paths.",
          "If a bad config was applied, use Config Preview > Backups to restore a previous config, then restart llama-swap manually.",
        ],
      },
      {
        id: "model-load-issues",
        title: "Model fails to load",
        summary: "Start with paths and VRAM, then tune context, cache, and GPU placement.",
        body: [
          "Confirm the primary GGUF exists inside /models. Confirm mmproj and chat template paths if the model needs vision or custom chat formatting.",
          "If llama.cpp fails with memory errors, lower ctx-size, lower ubatch-size, adjust tensor split, or reduce n-gpu-layers. Mixed GPU rigs often need explicit tensor split.",
        ],
      },
    ],
  },
];

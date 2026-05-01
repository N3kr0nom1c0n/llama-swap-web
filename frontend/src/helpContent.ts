export interface WikiSetting {
  name: string;
  purpose: string;
  ifYouChange: string;
  tradeoff: string;
  where: string;
}

export interface WikiArticle {
  id: string;
  title: string;
  category: string;
  summary: string;
  details: string[];
  workflow?: string[];
  settings?: WikiSetting[];
  examples?: string[];
  warnings?: string[];
  relatedTerms?: string[];
  relatedArticles?: string[];
  tags?: string[];
}

export interface WikiSection {
  id: string;
  title: string;
  eyebrow: string;
  description: string;
  articles: WikiArticle[];
}

export interface ImpactRow {
  id: string;
  setting: string;
  change: string;
  canNet: string;
  cost: string;
  where: string;
  articleId: string;
}

export interface GlossaryTerm {
  term: string;
  slug: string;
  shortDefinition: string;
  details: string;
  articleId: string;
  relatedTerms?: string[];
}

export const wikiSections: WikiSection[] = [
  {
    id: "start-here",
    title: "Start Here",
    eyebrow: "Operator model",
    description:
      "How Llama-Swap Manager turns model files into a usable llama-swap entry without hiding the dangerous steps.",
    articles: [
      {
        id: "article-staged-pipeline",
        title: "Staged Model Pipeline",
        category: "Workflow",
        summary:
          "A model is not installed just because a file finished downloading. The manager walks it through source, files, download, managed model, config preview, apply, and optional restart.",
        details: [
          "The app is designed to close the gap between 'I downloaded a GGUF' and 'llama-swap can actually serve it'. A completed download only proves the bytes landed under /models. A managed model entry is what gives the file a model name, role, command flags, GPU placement, matrix behavior, aliases, and TTL.",
          "The config step is intentionally staged. Config Preview renders YAML, validates known constraints, and shows a diff. Apply creates a backup first and writes /app/config.yaml only after you approve the staged preview.",
          "The restart step is separate from apply. If restart controls are enabled, Config Preview can restart the configured llama-swap Docker container after the config is written. If restart controls are disabled, restart llama-swap outside the manager.",
        ],
        workflow: [
          "Choose a source in Import Model: Hugging Face URL, local upload, or scan existing /models files.",
          "Select the primary GGUF and companion files, then download or stage them under the correct role directory.",
          "Create a managed model entry from the finished download or scanned file.",
          "Review command flags, GPU placement, aliases, TTL, and matrix behavior on Models.",
          "Preview YAML, check the diff, apply with backup, then restart llama-swap if you want the new config live.",
        ],
        examples: [
          "Downloaded file path: /models/chat/model-name/model.Q4_K_M.gguf",
          "Generated command path: /models/chat/model-name/model.Q4_K_M.gguf",
          "Managed model name: the ID clients request through llama-swap",
        ],
        warnings: [
          "A completed download that is not connected to a managed model will not appear in generated config.",
          "Generated llama-server commands must use container-visible /models paths, not host paths from the Docker bind mount.",
        ],
        relatedTerms: ["GGUF", "managed model", "config preview", "matrix", "restart control"],
        relatedArticles: ["article-import-model", "article-models-page", "article-config-preview"],
        tags: ["pipeline", "download", "installed", "apply", "restart"],
      },
      {
        id: "article-container-paths",
        title: "Container Paths Versus Host Paths",
        category: "Architecture",
        summary:
          "The manager writes into mounted container paths, and llama-swap config must reference paths that the llama-swap container can also see.",
        details: [
          "Docker bind mounts create two names for the same storage: the host path and the in-container path. The manager should write to /models because that is what the manager container sees. Generated llama-swap commands should also use /models because that is what the llama-swap container sees.",
          "The host path is still important for Compose. It decides which real disk backs /models, /backups, /data, and /app/config.yaml. It should not leak into generated llama-server commands unless llama-swap also sees that same host path inside its container.",
          "Config apply writes /app/config.yaml from inside the manager container. A file bind mount can be writable even when the /app directory itself is not writable, so the app validates the target file and falls back to backup-dir temporary writes when needed.",
        ],
        settings: [
          {
            name: "Manager model root",
            purpose: "Where the manager writes imported files inside its own container.",
            ifYouChange: "Changing it moves future writes and scans to a different container path.",
            tradeoff: "If it does not point at the mounted model volume, downloads can land somewhere llama-swap cannot read.",
            where: "Settings -> Paths",
          },
          {
            name: "Llama-swap model root",
            purpose: "The path emitted into generated llama-server commands.",
            ifYouChange: "Generated -m, --mmproj, and --chat-template-file paths change.",
            tradeoff: "Wrong values produce valid-looking YAML that fails at model load time.",
            where: "Settings -> Paths",
          },
          {
            name: "Config path",
            purpose: "The mounted config.yaml file the manager previews, backs up, writes, and restores.",
            ifYouChange: "Config Preview and Apply target a different file.",
            tradeoff: "Pointing at a non-llama-swap file makes apply useless or dangerous.",
            where: "Settings -> Paths",
          },
        ],
        examples: [
          "Host mount: /mnt/models/llama.swap/models:/models",
          "Config mount: /home/n3kr0/Repos/llama-swap/config.yaml:/app/config.yaml",
          "Backup mount: /mnt/data_hoard/llama-swap/backups:/backups",
        ],
        relatedTerms: ["bind mount", "model root", "backup", "config preview"],
        relatedArticles: ["article-path-settings", "article-config-preview"],
        tags: ["paths", "docker", "mounts", "config"],
      },
      {
        id: "article-matrix",
        title: "Matrix Concurrency",
        category: "llama-swap",
        summary:
          "Matrix is how current llama-swap expresses which models can run together. The manager emits matrix config, not legacy groups.",
        details: [
          "A matrix var is a short key for a model. A matrix set is an expression that tells llama-swap which vars are allowed together. For example, a support model can stay up with a chat model, while a huge reasoning model may run alone.",
          "Use matrix behavior to encode intent instead of manually remembering what can fit. Large models can be isolated, support models can be persistent, and mixed sets can describe combinations that make sense on your GPUs.",
          "Evict cost is a hint about which models are expensive to unload. Higher-cost models are better candidates to keep loaded when llama-swap needs to choose what to stop.",
        ],
        settings: [
          {
            name: "Matrix key",
            purpose: "Short key used in matrix vars and set expressions.",
            ifYouChange: "The YAML expression names change, but the model name clients call can stay the same.",
            tradeoff: "Unclear keys make the generated config harder to reason about.",
            where: "Models -> Matrix",
          },
          {
            name: "Matrix behavior",
            purpose: "Default pattern for whether a model runs alone, acts as support, or runs with support.",
            ifYouChange: "llama-swap may allow or prevent different model combinations.",
            tradeoff: "Too permissive can overcommit VRAM; too strict wastes available GPUs.",
            where: "Models -> Matrix",
          },
          {
            name: "Evict cost",
            purpose: "Relative cost of unloading the model.",
            ifYouChange: "llama-swap eviction decisions can favor keeping high-cost models warm.",
            tradeoff: "Overusing high costs makes eviction less useful because everything looks expensive.",
            where: "Models -> Matrix",
          },
        ],
        relatedTerms: ["matrix", "support model", "evict cost", "TTL"],
        relatedArticles: ["article-models-page", "article-gpu-placement"],
        tags: ["matrix", "groups", "concurrency", "eviction"],
      },
    ],
  },
  {
    id: "page-guides",
    title: "Page Guides",
    eyebrow: "Navigation",
    description:
      "What each page is for, what actions belong there, and what state should move to the next step.",
    articles: [
      {
        id: "article-dashboard",
        title: "Dashboard",
        category: "Page",
        summary:
          "The dashboard should be the triage board: current API state, config writability, active or failed work, and next actions that need attention.",
        details: [
          "Use the dashboard after a deploy or after long-running work. It should tell you whether the manager can write config, how many managed models exist, and which jobs or models need follow-up.",
          "Download history by itself is not the main purpose of this page. The useful signal is whether a completed download still needs a managed model, whether a failed job needs retry, or whether config apply is blocked.",
          "If the dashboard says a model is not configured, treat that as a workflow state: go to Import Model or Models to connect files to a managed model entry, then go to Config Preview.",
        ],
        relatedTerms: ["managed model", "download job", "config preview"],
        relatedArticles: ["article-staged-pipeline", "article-import-model"],
        tags: ["dashboard", "jobs", "next actions"],
      },
      {
        id: "article-import-model",
        title: "Import Model Workflow",
        category: "Page",
        summary:
          "Import Model is the pipeline from Hugging Face URL, uploaded file, or existing disk scan to a managed model entry.",
        details: [
          "Paste a Hugging Face repo or file URL, choose the role, optionally set the desired llama-swap name, then resolve files. The manager classifies GGUFs, multipart shards, mmproj files, chat templates, and tokenizer-like companion files.",
          "Preview Destination explains where selected files will land before the download starts. The target is based on role directory plus a safe folder name.",
          "A completed download should expose Create Managed Model. That action connects the written files to a model entry, infers the primary GGUF and companion files, and seeds defaults for TTL, context, cache, GPU flags, and matrix behavior.",
          "Scan Existing Files is for files already copied into /models. It should let you create the same managed model entry without re-downloading the file.",
        ],
        workflow: [
          "Resolve a Hugging Face URL or scan /models.",
          "Select the primary GGUF and required companions.",
          "Start the download and watch the progress row until it reaches completed.",
          "Create the managed model from the completed job.",
          "Open Config Preview and verify that the generated command points at the downloaded files.",
        ],
        warnings: [
          "For multipart GGUFs, all shards belong together. The first shard usually appears in the -m path, but the model needs the other shards on disk.",
          "Private or gated repositories need the Hugging Face token saved first.",
        ],
        relatedTerms: ["HF token", "GGUF", "multipart GGUF", "mmproj", "chat template"],
        relatedArticles: ["article-hf-token", "article-files-companions", "article-models-page"],
        tags: ["import", "hugging face", "download", "scan", "upload"],
      },
      {
        id: "article-models-page",
        title: "Models Page",
        category: "Page",
        summary:
          "Models is where an imported file becomes a llama-swap model: name, files, command, GPU placement, aliases, TTL, and matrix behavior.",
        details: [
          "The Models page is not just inventory. It is the command builder and config-entry editor. A model listed here is a candidate for generated config.yaml.",
          "Structured fields are preferred because the manager can validate paths, insert ${PORT}, map container paths, and keep YAML consistent. Raw command override is for expert cases where the builder cannot express the needed llama.cpp flags yet.",
          "Aliases affect what clients can call. TTL affects how long the model stays loaded after use. GPU placement affects CUDA_VISIBLE_DEVICES, main GPU, tensor split, and n-gpu-layers.",
        ],
        settings: [
          {
            name: "Aliases",
            purpose: "Friendly names clients can request through llama-swap.",
            ifYouChange: "Clients can call the same model by additional names.",
            tradeoff: "Too many aliases can make model lists confusing if names overlap.",
            where: "Models -> Identity",
          },
          {
            name: "Raw command override",
            purpose: "Full manual command text instead of generated structured command.",
            ifYouChange: "The manager stops building the command from structured fields for that model.",
            tradeoff: "More control, less validation. You must include ${PORT} and correct paths yourself.",
            where: "Models -> Advanced command",
          },
        ],
        relatedTerms: ["managed model", "alias", "raw command", "TTL", "CUDA_VISIBLE_DEVICES"],
        relatedArticles: ["article-command-builder", "article-gpu-placement", "article-matrix"],
        tags: ["models", "editor", "command", "aliases"],
      },
      {
        id: "article-gpu-planner",
        title: "GPU Planner",
        category: "Page",
        summary:
          "GPU Planner is the rig inventory and placement notebook. It records CUDA indexes, VRAM, roles, and notes so model setup stops being guesswork.",
        details: [
          "CUDA indexes are what llama.cpp and CUDA_VISIBLE_DEVICES use. Keep them aligned with nvidia-smi on the actual rig. If the physical cards change, update the planner before tuning model entries.",
          "VRAM is planning context, not a guarantee. Model size, quantization, ctx-size, KV cache precision, batch sizes, and tensor split all affect whether a model actually loads.",
          "Use roles to reserve cards mentally: large/reasoning/coding on high-VRAM cards, aux and always-on support on smaller or isolated cards, and vision models on cards that also have room for mmproj and image tokens.",
        ],
        relatedTerms: ["CUDA index", "VRAM", "CUDA_VISIBLE_DEVICES", "tensor split", "main GPU"],
        relatedArticles: ["article-gpu-placement", "article-context-kv-cache"],
        tags: ["gpu planner", "cuda", "vram", "nvidia-smi"],
      },
      {
        id: "article-config-preview",
        title: "Config Preview And Apply",
        category: "Page",
        summary:
          "Config Preview turns managed models into YAML, validates it, shows a diff, creates backups, applies changes, restores backups, and optionally restarts llama-swap.",
        details: [
          "Preview generates the config from current settings and saved model entries. It should show both the YAML and the unified diff against the mounted config file.",
          "Apply should write only the staged preview you inspected. If you change a model after preview, regenerate the preview before applying.",
          "Every apply creates a timestamped backup first. Restore also backs up the current config before replacing it with the selected backup.",
          "The llama-swap Runtime panel only works when restart controls are enabled and the Docker socket mount can inspect the configured container.",
        ],
        warnings: [
          "A config backup does not make a bad config harmless. llama-swap still needs a restart or reload before it sees the new file, and a bad file can prevent model loading until fixed or restored.",
          "Docker socket access is host-level control. Keep it LAN-only and intentional.",
        ],
        relatedTerms: ["config preview", "backup", "restart control", "Docker socket", "validation"],
        relatedArticles: ["article-restart-control", "article-config-rollback"],
        tags: ["config", "apply", "diff", "backup", "restore", "restart"],
      },
      {
        id: "article-settings-page",
        title: "Settings Page",
        category: "Page",
        summary:
          "Settings controls app-wide assumptions: paths, defaults, token handling, role directories, command defaults, disk safety, and optional restart behavior.",
        details: [
          "Settings values seed new imports and command generation. Changing a default does not automatically rewrite existing model entries unless a specific page does that intentionally.",
          "Path settings are high-impact because they decide where bytes land and what paths are written into llama-swap config. Token settings affect Hugging Face resolution and downloads. Preset settings affect new model commands.",
          "Restart settings are intentionally separate from model settings because they grant the manager Docker socket access. Enable them only when the container has the socket mounted and the app is protected by your LAN trust boundary.",
        ],
        relatedTerms: ["HF token", "model root", "role directory", "restart control", "disk safety"],
        relatedArticles: ["article-path-settings", "article-default-presets", "article-restart-control"],
        tags: ["settings", "defaults", "paths", "token"],
      },
    ],
  },
  {
    id: "settings-flags",
    title: "Settings And Flags",
    eyebrow: "What changes what",
    description:
      "Reference articles for the settings and llama.cpp flags that change storage, load behavior, speed, VRAM, or output shape.",
    articles: [
      {
        id: "article-path-settings",
        title: "Path Settings",
        category: "Settings",
        summary:
          "Path settings control where the manager writes, where llama-swap reads, where config is applied, where backups live, and where persistent state survives rebuilds.",
        details: [
          "Keep manager paths inside the container. The Compose file maps those container paths to host storage. That keeps generated config portable across the manager and llama-swap containers.",
          "The safest default is /models for both manager model root and llama-swap model root when both containers mount the same model volume at /models. Use /backups for backups and /data for SQLite state.",
          "Use /data/tmp for temporary work when possible. Binding host /tmp into a long-running manager container can make cleanup and permissions less predictable.",
        ],
        settings: [
          {
            name: "Backups dir",
            purpose: "Where config backups and restore safety copies are written.",
            ifYouChange: "Future apply and restore backups go to the new directory.",
            tradeoff: "If the directory is not durable, rebuilds can lose your rollback path.",
            where: "Settings -> Paths",
          },
          {
            name: "Data dir",
            purpose: "Persistent manager state, including SQLite.",
            ifYouChange: "The app can look like a fresh install if it points at an empty data volume.",
            tradeoff: "Changing without migrating manager.db can hide saved jobs, settings, and models.",
            where: "Settings -> Paths",
          },
          {
            name: "Download temp dir",
            purpose: "Temporary workspace for large transfers and file staging.",
            ifYouChange: "Temporary files and future cache-related work move to that location.",
            tradeoff: "Low-space temp storage can break downloads even when /models has room.",
            where: "Settings -> Paths",
          },
        ],
        relatedTerms: ["bind mount", "backup", "SQLite", "model root"],
        relatedArticles: ["article-container-paths"],
        tags: ["paths", "settings", "storage"],
      },
      {
        id: "article-hf-token",
        title: "Hugging Face Token",
        category: "Settings",
        summary:
          "The HF token lets the rig resolve and download private, gated, or rate-limited model files directly from Hugging Face.",
        details: [
          "Save Token writes HF_TOKEN to the manager env file or configured token source. The API never returns the token value back to the browser; the UI only shows whether a token exists.",
          "Use a read-only Hugging Face token. It is enough for listing and downloading model files. If you rotate the token on Hugging Face, update it here before resolving gated repos again.",
          "If Resolve Files works for public repos but not private ones, check token status first. If token status is present, the next likely issue is repo permission or a gated model license that has not been accepted.",
        ],
        settings: [
          {
            name: "HF API token",
            purpose: "Credential for Hugging Face API and downloads.",
            ifYouChange: "New resolve and download requests authenticate with the new token.",
            tradeoff: "A bad token fails private imports; an overpowered token increases blast radius if leaked.",
            where: "Settings -> Hugging Face",
          },
          {
            name: "Default HF revision",
            purpose: "Branch, tag, or commit used when a URL does not specify a revision.",
            ifYouChange: "Future imports can resolve a different snapshot of the same repo.",
            tradeoff: "main is convenient; commit hashes are more reproducible.",
            where: "Settings -> Downloads",
          },
        ],
        relatedTerms: ["HF token", "revision", "gated repo"],
        relatedArticles: ["article-import-model", "article-private-repo"],
        tags: ["hugging face", "hf", "token", "private", "gated"],
      },
      {
        id: "article-default-presets",
        title: "Default Presets",
        category: "Settings",
        summary:
          "Defaults seed new model entries. They do not automatically retune existing models unless you edit those model records.",
        details: [
          "Defaults are the starting point for role-based model creation. Reasoning might use a longer TTL, chat might stay loaded, vision might use image token defaults, and aux models may be persistent.",
          "The highest-impact defaults are ctx-size, cache-type-k, cache-type-v, flash-attn, jinja, no-mmap, and role TTLs. These influence whether a new model loads and how useful it is once loaded.",
          "Treat defaults as safe baselines. After the model entry exists, tune the specific model on Models rather than changing global defaults repeatedly.",
        ],
        settings: [
          {
            name: "Role TTL defaults",
            purpose: "Initial ttl value for new models by role.",
            ifYouChange: "New entries stay loaded longer, unload sooner, or never unload depending on the role.",
            tradeoff: "Long TTLs reduce reload waits but keep VRAM occupied.",
            where: "Settings -> Model defaults",
          },
          {
            name: "Default ctx-size",
            purpose: "Initial context window size for new model commands.",
            ifYouChange: "New models can accept longer or shorter prompt history by default.",
            tradeoff: "Bigger context consumes more KV cache and can prevent large models from loading.",
            where: "Settings -> Command defaults",
          },
          {
            name: "Default cache types",
            purpose: "Initial KV cache quantization for new commands.",
            ifYouChange: "New models use more or less VRAM for long contexts.",
            tradeoff: "Lower precision saves memory; higher precision can preserve quality or stability.",
            where: "Settings -> Command defaults",
          },
        ],
        relatedTerms: ["TTL", "ctx-size", "KV cache", "cache-type-k", "cache-type-v"],
        relatedArticles: ["article-context-kv-cache"],
        tags: ["defaults", "ttl", "ctx-size", "cache"],
      },
      {
        id: "article-context-kv-cache",
        title: "Context And KV Cache",
        category: "Tuning",
        summary:
          "ctx-size decides how much text the model can consider. KV cache settings decide how much memory that context costs.",
        details: [
          "ctx-size is the maximum token window for prompt plus generated context. Increasing it can net longer prompts and documents, bigger codebases, and longer multi-turn memory inside one request.",
          "The cost is KV cache memory. Every active sequence needs cache space, so context size combines with parallel and cache precision. A huge ctx-size with parallel > 1 can multiply memory use quickly.",
          "cache-type-k and cache-type-v set quantization for the key and value cache. q4_0 is a practical large-context choice because it reduces VRAM pressure. Higher precision may be useful when quality or stability matters more than context length.",
          "keep and context-shift affect how the server behaves once the context window fills. keep protects initial prompt tokens, while context-shift allows rolling forward instead of failing immediately.",
        ],
        settings: [
          {
            name: "--ctx-size",
            purpose: "Maximum token context window.",
            ifYouChange: "Increase ctx-size to net longer prompts and documents; decrease it to reclaim VRAM.",
            tradeoff: "Large context can block model load or reduce how many models fit at once.",
            where: "Models -> Context",
          },
          {
            name: "--cache-type-k / --cache-type-v",
            purpose: "Precision of KV cache tensors.",
            ifYouChange: "Lower precision saves memory, often enabling bigger context or more models.",
            tradeoff: "Very low precision can affect quality, stability, or model-specific behavior.",
            where: "Models -> Context",
          },
          {
            name: "--parallel",
            purpose: "Number of concurrent request slots.",
            ifYouChange: "Higher values can serve overlapping requests.",
            tradeoff: "Each slot needs context/KV memory, which can destroy VRAM headroom on large models.",
            where: "Models -> Throughput",
          },
        ],
        relatedTerms: ["ctx-size", "KV cache", "parallel", "cache-type-k", "cache-type-v", "keep"],
        relatedArticles: ["article-throughput", "article-model-load-fails"],
        tags: ["ctx-size", "context", "kv cache", "cache", "vram"],
      },
      {
        id: "article-gpu-placement",
        title: "GPU Placement",
        category: "Tuning",
        summary:
          "CUDA devices, main GPU, tensor split, and n-gpu-layers decide where llama.cpp sees GPUs and how the model is split across them.",
        details: [
          "CUDA devices becomes CUDA_VISIBLE_DEVICES. It limits which physical cards the model process can see. This is the first and most important isolation control.",
          "main-gpu is the primary visible GPU for llama.cpp placement. Tensor split divides model tensors across visible GPUs. For equal VRAM cards, 1,1 is a simple split. For mixed cards, bias the split toward larger cards.",
          "n-gpu-layers controls how much of the model is offloaded to GPU. 999 is commonly used as 'offload everything you can'. Lower it when a model cannot fit but you are willing to trade speed for memory.",
        ],
        settings: [
          {
            name: "CUDA_VISIBLE_DEVICES",
            purpose: "Limits the model process to selected CUDA indexes.",
            ifYouChange: "The model moves to different physical GPUs or stops seeing some GPUs.",
            tradeoff: "Wrong indexes can starve a model or collide with another workload.",
            where: "Models -> GPU",
          },
          {
            name: "--tensor-split",
            purpose: "Weighting for splitting tensors across visible GPUs.",
            ifYouChange: "Better split can net successful loads and better VRAM balance.",
            tradeoff: "Bad split overloads one card while another sits underused.",
            where: "Models -> GPU",
          },
          {
            name: "--main-gpu",
            purpose: "Primary visible GPU used by llama.cpp.",
            ifYouChange: "Buffers and primary work can shift to another visible card.",
            tradeoff: "Usually leave it as the first visible card unless you know why it should move.",
            where: "Models -> GPU",
          },
          {
            name: "--n-gpu-layers",
            purpose: "Number of layers to offload to GPU.",
            ifYouChange: "More layers usually net faster inference; fewer layers reduce VRAM demand.",
            tradeoff: "Lower values can push work to CPU and slow generation heavily.",
            where: "Models -> GPU",
          },
        ],
        relatedTerms: ["CUDA_VISIBLE_DEVICES", "tensor split", "main GPU", "n-gpu-layers", "VRAM"],
        relatedArticles: ["article-gpu-planner", "article-model-load-fails"],
        tags: ["gpu", "tensor split", "cuda", "main gpu", "n-gpu-layers"],
      },
      {
        id: "article-throughput",
        title: "Throughput And Batching",
        category: "Tuning",
        summary:
          "batch-size, ubatch-size, parallel, and continuous batching tune prompt ingestion speed and concurrent work.",
        details: [
          "batch-size controls the logical prompt processing batch. ubatch-size controls how that batch is chunked internally. Larger values can increase prompt ingestion speed but cost memory.",
          "If a model loads but fails or stalls during large prompts, lower ubatch-size before lowering ctx-size. If the model fails during load, ctx-size, cache type, tensor split, and n-gpu-layers are usually more likely.",
          "parallel is useful for small support services and multi-client setups. On huge models, parallel 1 is often the correct default because each extra slot consumes KV cache.",
        ],
        settings: [
          {
            name: "--batch-size",
            purpose: "Logical prompt processing batch size.",
            ifYouChange: "Higher values can net faster prompt ingestion.",
            tradeoff: "More memory pressure during prompt processing.",
            where: "Models -> Throughput",
          },
          {
            name: "--ubatch-size",
            purpose: "Physical micro-batch size.",
            ifYouChange: "Lower values can get a model through memory pressure without shrinking context.",
            tradeoff: "Lower values can reduce throughput.",
            where: "Models -> Throughput",
          },
          {
            name: "--cont-batching",
            purpose: "Allows continuous batching behavior in llama-server.",
            ifYouChange: "Can improve utilization under multiple requests.",
            tradeoff: "Adds scheduling complexity and is less important for single-user huge-model usage.",
            where: "Models -> Advanced flags",
          },
        ],
        relatedTerms: ["batch-size", "ubatch-size", "parallel", "cont-batching"],
        relatedArticles: ["article-context-kv-cache"],
        tags: ["batch", "ubatch", "throughput", "parallel"],
      },
      {
        id: "article-sampling",
        title: "Sampling And Answer Shape",
        category: "Tuning",
        summary:
          "Temperature, top-p, top-k, min-p, and penalties change answer style after the model has loaded.",
        details: [
          "Sampling settings generally do not decide whether a model fits in VRAM. They decide which tokens are likely after the model computes logits.",
          "Lower temperature usually nets more deterministic answers. Higher temperature nets more variety but more risk. top-p and top-k constrain the candidate pool. min-p trims low-probability tail tokens.",
          "presence-penalty and repeat-penalty can reduce repetition loops, but aggressive values can make coding and factual answers worse.",
        ],
        settings: [
          {
            name: "--temp",
            purpose: "Randomness of token selection.",
            ifYouChange: "Lower temp can net consistency; higher temp can net creative variation.",
            tradeoff: "Too high becomes erratic; too low can feel rigid.",
            where: "Models -> Sampling",
          },
          {
            name: "--top-p / --top-k / --min-p",
            purpose: "Sampling cutoffs that constrain candidate tokens.",
            ifYouChange: "You can make responses tighter or more open-ended.",
            tradeoff: "Bad combinations can make output bland, unstable, or model-hostile.",
            where: "Models -> Sampling",
          },
          {
            name: "--presence-penalty / --repeat-penalty",
            purpose: "Discourage repeated concepts or token loops.",
            ifYouChange: "Can net fewer repeated phrases.",
            tradeoff: "Too much penalty can damage coherence or code accuracy.",
            where: "Models -> Sampling",
          },
        ],
        relatedTerms: ["temperature", "top-p", "top-k", "min-p", "repeat penalty"],
        tags: ["sampling", "temperature", "top-p", "top-k"],
      },
      {
        id: "article-files-companions",
        title: "Files And Companions",
        category: "Model files",
        summary:
          "GGUF is the model file. Some models also need mmproj, chat templates, tokenizer files, or every shard in a multipart GGUF set.",
        details: [
          "The primary GGUF is passed to llama-server with -m. For multipart GGUFs, the command usually points at the first shard, but all shards must sit beside it on disk.",
          "Vision models often need an mmproj file. Without it, the model may load as text-only or fail vision requests. Newer chat models may need a Jinja chat template or chat-template-kwargs to format prompts correctly.",
          "Tokenizer-like files are sometimes not used directly by llama.cpp for GGUF inference, but keeping them beside the model helps future tooling and makes the folder self-describing.",
        ],
        settings: [
          {
            name: "Primary model file",
            purpose: "The GGUF passed to -m.",
            ifYouChange: "The command loads a different model file.",
            tradeoff: "Wrong file can load the wrong quant, miss shards, or fail immediately.",
            where: "Models -> Files",
          },
          {
            name: "MMProj file",
            purpose: "Vision projector file passed to --mmproj.",
            ifYouChange: "Vision capability is added, removed, or pointed at a different projector.",
            tradeoff: "Mismatched projector can break image understanding.",
            where: "Models -> Files",
          },
          {
            name: "Chat template file",
            purpose: "Explicit template passed to --chat-template-file.",
            ifYouChange: "Prompt formatting changes.",
            tradeoff: "Wrong template can make a good model answer poorly.",
            where: "Models -> Files",
          },
        ],
        relatedTerms: ["GGUF", "multipart GGUF", "mmproj", "chat template", "tokenizer"],
        relatedArticles: ["article-import-model", "article-command-builder"],
        tags: ["gguf", "mmproj", "template", "tokenizer", "files"],
      },
      {
        id: "article-command-builder",
        title: "Command Builder",
        category: "Model command",
        summary:
          "The command builder converts structured model settings into the llama-server command written into config.yaml.",
        details: [
          "Structured command generation always includes the base llama-server executable, --port ${PORT}, the primary model file, companion file flags, and enabled tuning flags.",
          "Use structured fields when possible. They let the manager validate paths, avoid host path leaks, render YAML consistently, and explain the effect of each setting.",
          "Use raw command override only for unsupported flags or highly custom command layouts. A raw command must still include --port ${PORT} and container-visible paths.",
        ],
        warnings: [
          "A raw command can bypass validation and break config even if the UI fields look correct.",
        ],
        relatedTerms: ["llama-server", "raw command", "${PORT}", "config preview"],
        relatedArticles: ["article-models-page", "article-config-preview"],
        tags: ["command", "llama-server", "raw command", "port"],
      },
      {
        id: "article-restart-control",
        title: "Restart Control",
        category: "Operations",
        summary:
          "Restart control is an optional manual button that uses the Docker socket to restart the llama-swap container after a config apply or restore.",
        details: [
          "Enabling restart control does not restart anything by itself. It allows Config Preview to inspect the configured container and expose a restart button.",
          "The manager needs /var/run/docker.sock mounted and readable. Because the app runs as a non-root user, Compose may also need group_add set to the Docker socket group id.",
          "This is intentionally not part of v1 automatic apply. Keeping apply and restart separate gives you a chance to inspect the diff and decide when to bounce llama-swap.",
        ],
        settings: [
          {
            name: "Enable llama-swap restart control",
            purpose: "Turns on Docker socket status and restart actions.",
            ifYouChange: "Config Preview can show runtime availability and a restart button.",
            tradeoff: "Docker socket access can control the host. Keep the app trusted-LAN only.",
            where: "Settings -> Restart control",
          },
          {
            name: "llama-swap container name",
            purpose: "Container inspected and restarted.",
            ifYouChange: "Runtime panel targets a different container.",
            tradeoff: "Wrong name produces unavailable status or restarts the wrong service.",
            where: "Settings -> Restart control",
          },
          {
            name: "Restart timeout seconds",
            purpose: "Grace period passed to Docker restart.",
            ifYouChange: "Docker waits longer or shorter before force-stopping.",
            tradeoff: "Too short can interrupt shutdown; too long delays recovery.",
            where: "Settings -> Restart control",
          },
        ],
        relatedTerms: ["restart control", "Docker socket", "container name", "backup"],
        relatedArticles: ["article-config-preview"],
        tags: ["restart", "docker", "socket", "llama-swap"],
      },
    ],
  },
  {
    id: "runbooks",
    title: "Runbooks",
    eyebrow: "Fix paths",
    description:
      "Short operational recipes for the states that usually make llama-swap and llama.cpp feel harder than Ollama.",
    articles: [
      {
        id: "article-downloaded-not-installed",
        title: "Downloaded But Not Installed",
        category: "Runbook",
        summary:
          "A finished download becomes useful only after it is converted into a managed model and included in the generated config.",
        details: [
          "Open Import Model and look for Ready Downloads. If the downloaded job appears there, use Create Managed Model. If it does not, scan existing files and create the model from the GGUF on disk.",
          "After the model exists, open Models and verify name, role, primary file, companion files, GPU placement, and matrix behavior. Then open Config Preview and confirm the new model appears in YAML.",
          "Apply config with backup. Restart llama-swap manually or with the runtime panel. The model will not be served by llama-swap until llama-swap loads the updated config.",
        ],
        workflow: [
          "Ready Downloads -> Create Managed Model.",
          "Models -> verify command and GPU fields.",
          "Config Preview -> Preview -> Apply.",
          "Restart llama-swap.",
        ],
        relatedTerms: ["download job", "managed model", "config preview", "restart control"],
        relatedArticles: ["article-staged-pipeline", "article-import-model"],
        tags: ["downloaded", "installed", "ready downloads", "not installed"],
      },
      {
        id: "article-private-repo",
        title: "Private Or Gated Repo Fails",
        category: "Runbook",
        summary:
          "When public repos resolve but gated repos fail, start with token presence, repo permissions, and accepted model terms.",
        details: [
          "Go to Settings and confirm token status is present. If not, save a read token. If present, verify the Hugging Face account has access to the repo and accepted any gated model terms.",
          "If file listing works but download fails, retry the job and inspect the queue error. Token, disk space, and network interruptions are the common causes.",
          "If a direct file URL includes a revision, make sure the revision exists and the file path is spelled exactly as Hugging Face reports it.",
        ],
        relatedTerms: ["HF token", "revision", "gated repo", "download job"],
        relatedArticles: ["article-hf-token", "article-import-model"],
        tags: ["private", "gated", "token", "hugging face"],
      },
      {
        id: "article-model-load-fails",
        title: "Model Fails To Load",
        category: "Runbook",
        summary:
          "Start with path correctness, then VRAM pressure, then companion files, then model-specific flags.",
        details: [
          "First verify the generated command uses /models paths and that the primary GGUF exists at that path inside the llama-swap container. A host-only path will fail even if the file exists on disk.",
          "If llama.cpp reports memory or allocation errors, lower ctx-size, lower ubatch-size, adjust tensor split, or reduce n-gpu-layers. On mixed cards, tensor split is often the difference between success and failure.",
          "For vision models, verify mmproj and chat template path. For Qwen-family models, confirm jinja and chat-template-kwargs are set the way that model expects.",
        ],
        workflow: [
          "Check generated command path.",
          "Check CUDA devices and tensor split.",
          "Lower ctx-size or cache precision if VRAM is tight.",
          "Verify mmproj/template files for vision and chat-template-heavy models.",
        ],
        relatedTerms: ["GGUF", "VRAM", "ctx-size", "tensor split", "mmproj", "chat template"],
        relatedArticles: ["article-gpu-placement", "article-context-kv-cache", "article-files-companions"],
        tags: ["load fail", "vram", "llama.cpp", "tensor split"],
      },
      {
        id: "article-config-rollback",
        title: "Rollback A Bad Config",
        category: "Runbook",
        summary:
          "Use backups to restore a known-good config, then restart llama-swap so it reads the restored file.",
        details: [
          "Open Config Preview and use the Backups list. Restore first backs up the current config, then writes the selected backup over the active config path.",
          "After restore, restart llama-swap. The file on disk is restored immediately, but the running service must reload or restart before it serves from that file.",
          "If restore fails because config is not writable, inspect the /app/config.yaml bind mount and file permissions on the host.",
        ],
        relatedTerms: ["backup", "restore", "config preview", "restart control"],
        relatedArticles: ["article-config-preview", "article-container-paths"],
        tags: ["rollback", "backup", "restore", "config"],
      },
    ],
  },
  {
    id: "quickstart",
    title: "Quickstart",
    eyebrow: "First success path",
    description:
      "The shortest safe paths for going from a blank manager install to a served llama-swap model, then keeping that workflow repeatable.",
    articles: [
      {
        id: "article-first-model-quickstart",
        title: "First Model Quickstart",
        category: "Quickstart",
        summary:
          "Use this when the app is freshly deployed and you want the first model to go live without manually editing config.yaml.",
        details: [
          "Start on Dashboard and confirm config is writable. If config is not writable, fix the /app/config.yaml bind mount before importing anything; otherwise you can download files but cannot apply the generated config.",
          "Go to Settings before private downloads. Save a read-only HF token if the repo is private or gated, confirm Manager model root and Llama-swap model root are both /models, and confirm backups are going to durable storage.",
          "Use Import Model to resolve the URL, select the primary GGUF and companions, preview the destination, start the download, and create the managed model from the completed job. Then tune GPU placement on Models, preview config, apply with backup, and restart llama-swap.",
        ],
        workflow: [
          "Dashboard -> confirm API current and config writable.",
          "Settings -> confirm /models, /app/config.yaml, /backups, /data, HF token status, and restart control status.",
          "GPU Planner -> confirm CUDA indexes and VRAM match the actual rig.",
          "Import Model -> Resolve Files -> select files -> Preview Destination -> Start Download -> Create Managed Model.",
          "Models -> set CUDA devices, tensor split, main GPU, context, cache, TTL, matrix behavior, and aliases.",
          "Config Preview -> regenerate preview -> inspect YAML and diff -> apply with backup -> restart llama-swap.",
        ],
        warnings: [
          "Do not skip Config Preview. It is where host path leaks, missing ${PORT}, destructive removals, and invalid matrix output should be caught before llama-swap sees the file.",
        ],
        relatedTerms: ["config preview", "HF token", "managed model", "backup", "restart control"],
        relatedArticles: ["article-import-field-reference", "article-models-field-reference", "article-config-controls"],
        tags: ["quickstart", "first model", "first run", "install model"],
      },
      {
        id: "article-daily-operating-loop",
        title: "Daily Operating Loop",
        category: "Workflow",
        summary:
          "The normal loop is import, configure, preview, apply, restart, then watch for load failures.",
        details: [
          "Use Dashboard as the status board, not as the place to configure models. It should show whether there is unfinished work: failed jobs, completed downloads that need a model entry, or config problems.",
          "Use Import Model for file acquisition and model-entry creation. Use Models for command and GPU details. Use Config Preview for generated YAML, diff, backups, restore, and restart. Keeping those concerns separate makes the app safer.",
          "After any apply or restore, restart llama-swap before expecting the running API to serve the updated model list. Config files are not live until the service reads them.",
        ],
        workflow: [
          "Resolve or scan files.",
          "Create or update the managed model.",
          "Preview and apply config.",
          "Restart llama-swap.",
          "If load fails, return to Models and adjust path, GPU, context, cache, or companion-file settings.",
        ],
        relatedTerms: ["download queue", "managed model", "config preview", "restart control"],
        relatedArticles: ["article-dashboard-job-reference", "article-downloaded-not-installed", "article-model-load-fails"],
        tags: ["daily", "workflow", "loop"],
      },
      {
        id: "article-good-config-review",
        title: "What A Good Config Review Looks Like",
        category: "Review",
        summary:
          "A safe review checks model names, paths, commands, matrix output, preload hooks, and destructive diff sections before apply.",
        details: [
          "Generated YAML should reference /models paths and include --port ${PORT} for every llama-server command. Raw command overrides must be checked manually because the structured builder cannot guarantee them.",
          "The diff should show expected additions and changes only. A destructive diff is one that removes a model, matrix entry, preload hook, env var, or large section you still expect llama-swap to use.",
          "Matrix output should contain no legacy groups. Startup preload should only include models that you actually want loaded on startup and can afford in VRAM.",
        ],
        workflow: [
          "Check each model's cmd block for /models paths and --port ${PORT}.",
          "Check env for CUDA_VISIBLE_DEVICES when GPU placement is intended.",
          "Check matrix vars and sets for intended coexistence rules.",
          "Check hooks.on_startup.preload for support models only.",
          "Check the diff for accidental deletions before clicking Apply Config.",
        ],
        relatedTerms: ["destructive diff", "matrix", "startup preload", "raw command", "${PORT}"],
        relatedArticles: ["article-config-controls", "article-command-builder", "article-matrix"],
        tags: ["review", "diff", "yaml", "destructive diff"],
      },
    ],
  },
  {
    id: "field-reference",
    title: "Field Reference",
    eyebrow: "Every control",
    description:
      "Field-level help for the controls on each page, including what they do, when to touch them, and what can break.",
    articles: [
      {
        id: "article-import-field-reference",
        title: "Import Model Field Reference",
        category: "Fields",
        summary:
          "Every Import Model control maps to a specific stage: source selection, file classification, destination preview, download, queue management, and model creation.",
        details: [
          "Role chooses the destination category and default TTL. Desired name seeds the folder name and model ID. Hugging Face URL can be a repo URL or direct file URL. Revision controls which branch, tag, or commit is listed and downloaded.",
          "Resolve Files talks to Hugging Face and classifies files. Scan Existing Files searches /models for files already present. Upload GGUF places a local file into the manager pipeline without using Hugging Face.",
          "Preview Destination creates the staged import plan. Start Download creates a download job. The Download Queue is the durable job control surface with progress, destination, cancel, retry, create, and Clear Finished actions.",
        ],
        settings: [
          {
            name: "Role",
            purpose: "Chooses reasoning, chat, vision, coding, or aux for destination and defaults.",
            ifYouChange: "Future downloaded files land under that role directory and receive role defaults.",
            tradeoff: "Wrong role does not corrupt the model, but it makes config organization and defaults misleading.",
            where: "Import Model -> Source",
          },
          {
            name: "Desired name",
            purpose: "Seeds folder name, model ID, display name, and matrix key suggestions.",
            ifYouChange: "New imports become easier to recognize in Models and Config Preview.",
            tradeoff: "Changing after download does not rename already written files automatically.",
            where: "Import Model -> Source",
          },
          {
            name: "Hugging Face URL",
            purpose: "Repo or direct file URL to resolve.",
            ifYouChange: "Resolve Files targets a different repo or file.",
            tradeoff: "Private, gated, or typoed URLs fail until token and permissions are correct.",
            where: "Import Model -> Source",
          },
          {
            name: "Revision",
            purpose: "Branch, tag, or commit snapshot for HF resolve and download.",
            ifYouChange: "You can pin an exact version instead of tracking main.",
            tradeoff: "Wrong revisions can make files disappear even when the repo exists.",
            where: "Import Model -> Source",
          },
          {
            name: "Upload GGUF",
            purpose: "Stages a local model file through the upload path.",
            ifYouChange: "You bypass Hugging Face and write the uploaded file into the manager's model root.",
            tradeoff: "Large uploads still need disk space and extension validation; companion files may need separate handling.",
            where: "Import Model -> Source actions",
          },
          {
            name: "Download Queue",
            purpose: "Shows job status, progress, active file, destination, logs, cancel, retry, create, and Clear Finished.",
            ifYouChange: "Cancel stops queued/running work, Retry reruns failed/cancelled jobs, Create turns completed jobs into managed models, and Clear Finished hides terminal jobs.",
            tradeoff: "Clearing finished jobs removes the UI history, not the model files already written.",
            where: "Import Model -> Download Queue",
          },
        ],
        examples: [
          "Queued: waiting for max_parallel_downloads capacity.",
          "Running: downloader is active and progress should move when file metadata is available.",
          "Completed: files exist and can be converted into a managed model.",
        ],
        relatedTerms: ["download queue", "download job", "revision", "role directory", "Upload GGUF"],
        relatedArticles: ["article-staged-pipeline", "article-downloaded-not-installed"],
        tags: ["fields", "import", "upload gguf", "clear finished", "queue", "resolve files"],
      },
      {
        id: "article-models-field-reference",
        title: "Models Field Reference",
        category: "Fields",
        summary:
          "Models owns the llama-swap entry: identity, files, GPU placement, matrix behavior, preload, flags, and raw command overrides.",
        details: [
          "Model ID is the stable config key. Display name is human-facing. Role controls organization and defaults. HF revision documents the source snapshot. TTL controls how long llama-swap keeps the model loaded after use.",
          "Manager files are what the manager knows it wrote or scanned. Container files are the paths that generated llama-swap commands should use. Primary model file, MMProj file, Chat template file, and Tokenizer files tell the command builder which files matter.",
          "CUDA devices, Main GPU, Tensor split, and n-gpu-layers are the main GPU placement controls. Matrix key, Matrix behavior, Custom matrix expression, Evict cost, and Startup preload control llama-swap concurrency and startup loading.",
        ],
        settings: [
          {
            name: "Model ID",
            purpose: "The key emitted under models: in config.yaml.",
            ifYouChange: "Clients may need to request a different model name.",
            tradeoff: "Renaming can break clients that already call the old ID.",
            where: "Models -> Identity",
          },
          {
            name: "Manager files / Container files",
            purpose: "Track written paths and generated command paths separately.",
            ifYouChange: "The app can point generated commands at different files.",
            tradeoff: "Host-visible and container-visible paths must not be confused.",
            where: "Models -> Files",
          },
          {
            name: "Startup preload",
            purpose: "Adds the model to hooks.on_startup.preload.",
            ifYouChange: "llama-swap tries to load it when the service starts.",
            tradeoff: "Preloading too much can consume VRAM immediately and block larger models.",
            where: "Models -> Matrix and runtime",
          },
          {
            name: "Custom matrix expression",
            purpose: "Overrides the generated matrix expression for advanced coexistence rules.",
            ifYouChange: "You can express a specific model combination the default behavior cannot represent.",
            tradeoff: "Bad expressions can create invalid config or unexpected swapping behavior.",
            where: "Models -> Matrix",
          },
          {
            name: "llama-server Flags",
            purpose: "Structured fields for context, cache, GPU layers, batching, sampling, and boolean llama.cpp flags.",
            ifYouChange: "Generated command behavior changes without using raw override.",
            tradeoff: "Aggressive values can break load or degrade output.",
            where: "Models -> llama-server Flags",
          },
        ],
        relatedTerms: ["managed model", "startup preload", "custom matrix expression", "raw command", "container files"],
        relatedArticles: ["article-command-builder", "article-gpu-placement", "article-context-kv-cache"],
        tags: ["fields", "models", "startup preload", "container files", "model id"],
      },
      {
        id: "article-settings-field-reference",
        title: "Settings Field Reference",
        category: "Fields",
        summary:
          "Settings controls global runtime assumptions, token handling, path safety, backup retention, role directories, and defaults for future model entries.",
        details: [
          "Runtime fields affect the manager process and defaults used by the app. App host and App port are container runtime concerns. Default HF revision, Max parallel downloads, Disk safety GB, and llama-server command affect imports and generated commands.",
          "Path fields decide where persistent state and files live: Manager model root, Llama-swap model root, Config path, Backups dir, Download temp dir, and Data dir. Backups must be durable if rollback matters.",
          "Backup retention count and Backup retention days prune old config backups. Use 0 to disable that retention mode. Role Directories set destination roots by role. Default Presets seed new models but do not retune existing saved models.",
        ],
        settings: [
          {
            name: "Backup retention count",
            purpose: "Maximum number of config backups to keep when retention cleanup runs.",
            ifYouChange: "Lower values reduce backup storage growth.",
            tradeoff: "Too low can remove the rollback point you need after a bad config.",
            where: "Settings -> Paths",
          },
          {
            name: "Backup retention days",
            purpose: "Age limit for config backups.",
            ifYouChange: "Older backups can be pruned automatically.",
            tradeoff: "Age-based cleanup can remove old known-good configs even if storage is available.",
            where: "Settings -> Paths",
          },
          {
            name: "Disk safety GB",
            purpose: "Free-space cushion for model and config operations.",
            ifYouChange: "Higher values block risky operations sooner.",
            tradeoff: "Too high can block legitimate downloads on a tight volume.",
            where: "Settings -> Runtime",
          },
          {
            name: "Max parallel downloads",
            purpose: "Number of download jobs allowed to run at the same time.",
            ifYouChange: "Higher values can transfer more files at once.",
            tradeoff: "Large GGUF downloads can saturate disk, network, or cache and make progress look worse.",
            where: "Settings -> Runtime",
          },
          {
            name: "Role directories",
            purpose: "Default destination roots for reasoning, chat, vision, coding, and aux models.",
            ifYouChange: "Future imports for that role land in a different folder.",
            tradeoff: "Role directories outside /models break llama-swap visibility unless the mount matches.",
            where: "Settings -> Role Directories",
          },
        ],
        relatedTerms: ["backup retention", "disk safety", "role directory", "SQLite", "CORS"],
        relatedArticles: ["article-path-settings", "article-backup-policy", "article-security-boundaries"],
        tags: ["fields", "settings", "backup retention", "backup retention days", "backup retention count"],
      },
      {
        id: "article-config-controls",
        title: "Config Preview Controls",
        category: "Fields",
        summary:
          "Config Preview is the control room for selecting models, staging YAML, checking validation errors, applying config, restoring backups, and restarting llama-swap.",
        details: [
          "The model selector lets you preview all managed models or a subset. Leaving everything unchecked previews all managed models. Preview regenerates YAML and diff from current state.",
          "Apply Config writes the staged preview after validation. When a diff removes meaningful content, the destructive diff confirmation makes you acknowledge that the active config will lose entries.",
          "Generated YAML and Diff are copyable code blocks. The llama-swap Runtime panel shows Docker socket availability and the restart button when restart controls are enabled. Backups lists timestamped configs and Restore replaces the active file with a selected backup.",
        ],
        settings: [
          {
            name: "Preview Config",
            purpose: "Generate staged YAML and diff from current models.",
            ifYouChange: "Regenerating after model edits updates the staged preview.",
            tradeoff: "Applying an old stage can ignore edits made after preview.",
            where: "Config Preview -> Header actions",
          },
          {
            name: "Apply Config",
            purpose: "Validate, backup, and write /app/config.yaml.",
            ifYouChange: "llama-swap config on disk changes.",
            tradeoff: "A bad config can break model loading until restored or fixed.",
            where: "Config Preview -> Header actions",
          },
          {
            name: "Destructive diff confirmation",
            purpose: "Acknowledges removals before apply.",
            ifYouChange: "Allows apply to proceed when the generated diff removes active content.",
            tradeoff: "Checking it blindly can delete models, matrix rules, or hooks you still need.",
            where: "Config Preview -> Validation and apply",
          },
          {
            name: "Restore backup",
            purpose: "Replace active config with a selected backup after backing up current config.",
            ifYouChange: "The active config file is rolled back.",
            tradeoff: "llama-swap still needs restart or reload to read the restored file.",
            where: "Config Preview -> Backups",
          },
        ],
        relatedTerms: ["destructive diff", "backup", "restore", "validation", "restart control"],
        relatedArticles: ["article-good-config-review", "article-config-rollback"],
        tags: ["fields", "config", "apply config", "destructive diff", "restore"],
      },
      {
        id: "article-gpu-field-reference",
        title: "GPU Planner Field Reference",
        category: "Fields",
        summary:
          "GPU Planner fields document the rig so CUDA placement and tensor split decisions have a reliable source of truth.",
        details: [
          "Detect GPUs reads the current machine when nvidia-smi is available to the manager. Use Detected GPUs to replace the draft while preserving role and note fields by CUDA index.",
          "CUDA index, Name, VRAM GB, Role, and Notes are planning fields. Model entries use CUDA indexes, but the planner also gives you a place to record what each card should be used for.",
          "Recommend split uses saved GPU data to suggest tensor split style placement, but it is still a recommendation. Validate it against actual load behavior.",
        ],
        settings: [
          {
            name: "Detect GPUs",
            purpose: "Reads current CUDA devices when available.",
            ifYouChange: "Updates the detected-card list, not necessarily saved planner state until you apply it.",
            tradeoff: "Container visibility and nvidia-smi availability can limit detection.",
            where: "GPU Planner -> Header actions",
          },
          {
            name: "CUDA index",
            purpose: "Device number used by CUDA_VISIBLE_DEVICES.",
            ifYouChange: "Model placement can point at a different physical card.",
            tradeoff: "Wrong index can put a huge model on the wrong GPU.",
            where: "GPU Planner -> GPU rows",
          },
          {
            name: "VRAM GB",
            purpose: "Planning memory capacity for the card.",
            ifYouChange: "Recommendations and human planning can change.",
            tradeoff: "It does not reserve memory or guarantee a model will fit.",
            where: "GPU Planner -> GPU rows",
          },
        ],
        relatedTerms: ["CUDA index", "VRAM", "tensor split", "nvidia-smi"],
        relatedArticles: ["article-gpu-placement"],
        tags: ["fields", "gpu", "detect gpus", "recommend split"],
      },
      {
        id: "article-dashboard-job-reference",
        title: "Dashboard And Job State Reference",
        category: "Fields",
        summary:
          "Dashboard and queue states explain whether there is real work to do or just old history.",
        details: [
          "Next Actions should show actionable states: failed downloads, cancelled jobs, completed downloads that need managed model creation, no models configured, or config not writable.",
          "Download Queue is the detailed operational view. Queued waits for capacity, running is actively transferring, completed is ready for Create if unmanaged, failed or cancelled can be retried, and Clear Finished removes terminal queue rows from the UI.",
          "A completed job is not the same thing as an installed model. It is only installed for llama-swap after it becomes a managed model, appears in Config Preview, gets applied to config.yaml, and llama-swap restarts.",
        ],
        relatedTerms: ["download queue", "download job", "Clear Finished", "managed model"],
        relatedArticles: ["article-downloaded-not-installed", "article-import-field-reference"],
        tags: ["fields", "dashboard", "queue", "clear finished", "jobs"],
      },
    ],
  },
  {
    id: "production-ops",
    title: "Production Operations",
    eyebrow: "Hardening",
    description:
      "Operational checks for running the manager as a durable LAN appliance instead of a throwaway dev UI.",
    articles: [
      {
        id: "article-production-readiness",
        title: "Production Readiness Checklist",
        category: "Operations",
        summary:
          "Before treating the manager as production, verify persistence, path safety, backups, token handling, restart permissions, and smoke tests.",
        details: [
          "A production-ready install has persistent /data, durable /backups, writable /app/config.yaml, a real /models mount, and a known llama-swap container name. The app should survive container recreation without losing settings, jobs, or model entries.",
          "The LAN trust boundary matters because this app intentionally has no login. If restart control is enabled, Docker socket exposure makes the manager powerful enough to restart Docker containers on the host.",
          "Smoke test the exact workflow: health endpoint OK, settings persist, HF resolve works for public repos, scan existing files works, config preview validates, apply creates a backup, restore creates a safety backup, and restart status reports the real llama-swap container.",
        ],
        workflow: [
          "Confirm /data/manager.db exists and is writable.",
          "Confirm /backups is durable and retention is intentional.",
          "Confirm generated commands use /models and never host-only paths.",
          "Confirm HF token status never exposes the token value.",
          "Confirm Docker socket is mounted only if restart controls are intentionally enabled.",
          "Run a config preview/apply/restore smoke test before trusting a new deployment.",
        ],
        warnings: [
          "No-login LAN apps are only as safe as the network segment that can reach them.",
          "Docker socket exposure is powerful enough to affect the host, not just this app.",
        ],
        relatedTerms: ["Docker socket exposure", "SQLite", "backup retention", "HF token", "CORS"],
        relatedArticles: ["article-security-boundaries", "article-backup-policy", "article-deploy-upgrade"],
        tags: ["production", "readiness", "checklist", "hardening"],
      },
      {
        id: "article-security-boundaries",
        title: "Security Boundaries",
        category: "Security",
        summary:
          "The manager is designed for a trusted LAN, but it still needs careful treatment around tokens, uploads, paths, CORS, and Docker socket access.",
        details: [
          "The HF token is write-only from the UI perspective. The backend should only report configured/not configured and token source, never the token value.",
          "File writes must stay inside allowed roots: /models, /backups, /data, and configured temp locations. Upload and scan paths should never allow traversal outside those roots.",
          "CORS should stay closed unless a specific trusted frontend origin needs API access. Do not expose this app through a public reverse proxy without adding authentication and re-evaluating Docker socket exposure.",
        ],
        settings: [
          {
            name: "Docker socket exposure",
            purpose: "Allows restart controls to inspect and restart the configured llama-swap container.",
            ifYouChange: "Mounting or enabling it turns restart from unavailable into actionable.",
            tradeoff: "The socket can control Docker on the host; LAN-only does not make that harmless.",
            where: "Compose mount plus Settings -> Restart control",
          },
          {
            name: "CORS allowed origins",
            purpose: "Controls which browser origins may call the API cross-origin.",
            ifYouChange: "External frontends may be able to call the manager API.",
            tradeoff: "Overly broad CORS increases exposure if the LAN trust boundary is weak.",
            where: "Environment/API settings",
          },
          {
            name: "Allowed upload extensions",
            purpose: "Limits which local files can enter the model pipeline.",
            ifYouChange: "The app can accept more or fewer file types.",
            tradeoff: "Broader upload types increase validation burden.",
            where: "Backend settings",
          },
        ],
        relatedTerms: ["Docker socket exposure", "HF token", "path traversal", "CORS", "Upload GGUF"],
        relatedArticles: ["article-production-readiness", "article-restart-control"],
        tags: ["security", "docker socket exposure", "token", "cors", "path traversal"],
      },
      {
        id: "article-backup-policy",
        title: "Backup And Restore Policy",
        category: "Operations",
        summary:
          "Backups are only useful if they are durable, retained intentionally, and tested before an emergency.",
        details: [
          "Every apply and restore should create a timestamped backup before changing the active config. That makes rollback possible even when the generated YAML is wrong.",
          "Backup retention count and days are cleanup policies. Use 0 when you want to keep everything. Use a count or age limit only when storage pressure is real and you accept losing older rollback points.",
          "The safest production habit is to test restore when nothing is broken. Restore a known backup, verify config changed, restart llama-swap, then apply the current config again.",
        ],
        workflow: [
          "Keep /backups on durable storage.",
          "Use retention settings deliberately, not as defaults you forget.",
          "After restore, restart llama-swap.",
          "Periodically copy known-good backups off the model host if config uptime matters.",
        ],
        relatedTerms: ["backup", "restore", "backup retention", "config preview"],
        relatedArticles: ["article-config-rollback", "article-settings-field-reference"],
        tags: ["backup", "restore", "backup retention", "retention"],
      },
      {
        id: "article-observability",
        title: "Observability And Evidence",
        category: "Operations",
        summary:
          "Use status endpoints, queue logs, Docker health, and SSE events to tell real failures from stale UI state.",
        details: [
          "GET /api/health verifies the manager, database, config file, model root, and backups are readable or writable as expected. GET /api/state shows settings, GPU count, model count, job count, and config status.",
          "Download Job logs show the exact downloader state. SSE exists so the UI can react to download/config events without polling forever, but job state in SQLite is the source of truth after refresh.",
          "For runtime issues, separate manager health from llama-swap health. The manager can be healthy while llama-swap rejects a bad config or fails to load a model.",
        ],
        relatedTerms: ["SSE", "SQLite", "download job", "health endpoint"],
        relatedArticles: ["article-dashboard-job-reference", "article-model-load-fails"],
        tags: ["observability", "logs", "sse", "health", "status"],
      },
      {
        id: "article-deploy-upgrade",
        title: "Deploy And Upgrade Runbook",
        category: "Operations",
        summary:
          "Rebuild or pull the container without losing runtime state, secrets, backups, or model files.",
        details: [
          "The app image should be replaceable. Runtime state belongs in mounts: /data for SQLite, /backups for config backups, /models for model files, and the manager env file for HF_TOKEN if used.",
          "Before upgrades, verify git state, rebuild or pull the image, recreate only the manager container, then smoke test /api/health and the Help, Settings, Import Model, Models, GPU Planner, and Config Preview pages.",
          "Do not overwrite the remote .env, /data, /backups, /models, or live llama-swap config unintentionally during code syncs. Code deploy and runtime state are different things.",
        ],
        workflow: [
          "Backup current config or confirm recent backup exists.",
          "Sync code while excluding .env, /data, /backups, /models, and logs.",
          "docker build or docker compose pull.",
          "docker compose up -d --force-recreate llama-swap-manager.",
          "Smoke test /api/health, /api/state, /help, /import, and /config.",
        ],
        relatedTerms: ["SQLite", "HF token", "backup", "health endpoint"],
        relatedArticles: ["article-production-readiness", "article-container-paths"],
        tags: ["deploy", "upgrade", "docker", "smoke test"],
      },
    ],
  },
];

export const impactRows: ImpactRow[] = [
  {
    id: "impact-ctx-size",
    setting: "ctx-size",
    change: "Increase ctx-size",
    canNet: "Longer prompts and documents, larger code context, and longer conversations before context shifting.",
    cost: "More KV cache memory. Large values can prevent a model from loading or reduce how many models can coexist.",
    where: "Models -> Context, or Settings -> Command defaults for future models",
    articleId: "article-context-kv-cache",
  },
  {
    id: "impact-cache-type",
    setting: "cache-type-k / cache-type-v",
    change: "Lower precision, for example q4_0",
    canNet: "More context or more concurrent models in the same VRAM budget.",
    cost: "Potential quality, stability, or model-specific behavior tradeoff.",
    where: "Models -> Context",
    articleId: "article-context-kv-cache",
  },
  {
    id: "impact-tensor-split",
    setting: "tensor split",
    change: "Tune split ratios across visible GPUs",
    canNet: "Better VRAM balance and successful loads on multi-GPU or mixed-VRAM rigs.",
    cost: "Bad ratios overload one card while others have free space.",
    where: "Models -> GPU",
    articleId: "article-gpu-placement",
  },
  {
    id: "impact-ubatch",
    setting: "ubatch-size",
    change: "Lower ubatch-size",
    canNet: "Survive prompt-processing memory pressure without cutting context first.",
    cost: "Prompt ingestion can slow down.",
    where: "Models -> Throughput",
    articleId: "article-throughput",
  },
  {
    id: "impact-ttl",
    setting: "TTL",
    change: "Set ttl to 0 or raise it",
    canNet: "Hot models stay loaded and avoid reload wait.",
    cost: "VRAM remains occupied, which can block larger models.",
    where: "Models -> Runtime, or Settings -> Model defaults",
    articleId: "article-default-presets",
  },
  {
    id: "impact-restart",
    setting: "restart control",
    change: "Enable restart controls",
    canNet: "One-click llama-swap restart after apply or restore.",
    cost: "Requires Docker socket access, which is powerful host control.",
    where: "Settings -> Restart control",
    articleId: "article-restart-control",
  },
  {
    id: "impact-hf-token",
    setting: "HF token",
    change: "Save a read token",
    canNet: "Private and gated repositories can resolve and download directly on the rig.",
    cost: "Token must be protected and rotated if exposed.",
    where: "Settings -> Hugging Face",
    articleId: "article-hf-token",
  },
  {
    id: "impact-backup-retention",
    setting: "backup retention",
    change: "Set count or age limits",
    canNet: "Controlled backup storage growth on a long-running manager.",
    cost: "Older known-good configs can disappear before you notice a regression.",
    where: "Settings -> Paths",
    articleId: "article-backup-policy",
  },
  {
    id: "impact-parallel-downloads",
    setting: "max parallel downloads",
    change: "Raise above 1",
    canNet: "More simultaneous file transfers for small companion files or multiple imports.",
    cost: "Large model downloads can saturate disk, network, or Hugging Face cache and make failures harder to read.",
    where: "Settings -> Runtime",
    articleId: "article-settings-field-reference",
  },
  {
    id: "impact-startup-preload",
    setting: "startup preload",
    change: "Enable for a model",
    canNet: "Support models are hot immediately after llama-swap starts.",
    cost: "VRAM is consumed on startup and can block larger models before the first request.",
    where: "Models -> Matrix and runtime",
    articleId: "article-models-field-reference",
  },
  {
    id: "impact-raw-command",
    setting: "raw command override",
    change: "Replace structured command generation",
    canNet: "Access to advanced llama.cpp flags before the UI has structured fields for them.",
    cost: "You own path correctness, ${PORT}, validation gaps, and future maintainability.",
    where: "Models -> Raw command override",
    articleId: "article-command-builder",
  },
];

export const glossaryTerms: GlossaryTerm[] = [
  {
    term: "GGUF",
    slug: "gguf",
    shortDefinition: "The model file format loaded by llama.cpp.",
    details: "The primary GGUF is the file passed to llama-server with -m. Quant suffixes describe compression and size tradeoffs.",
    articleId: "article-files-companions",
    relatedTerms: ["multipart GGUF", "quantization", "llama-server"],
  },
  {
    term: "multipart GGUF",
    slug: "multipart-gguf",
    shortDefinition: "A model split across several GGUF shard files.",
    details: "The command usually points at shard 00001, but all shards must be downloaded beside it.",
    articleId: "article-files-companions",
    relatedTerms: ["GGUF"],
  },
  {
    term: "mmproj",
    slug: "mmproj",
    shortDefinition: "Vision projector companion file.",
    details: "Vision models use --mmproj to connect image features to the language model.",
    articleId: "article-files-companions",
    relatedTerms: ["chat template"],
  },
  {
    term: "chat template",
    slug: "chat-template",
    shortDefinition: "Prompt formatting rules expected by a chat model.",
    details: "A template can be built into the model or supplied through --chat-template-file with --jinja.",
    articleId: "article-files-companions",
    relatedTerms: ["jinja"],
  },
  {
    term: "ctx-size",
    slug: "ctx-size",
    shortDefinition: "Maximum token window for a model request.",
    details: "Bigger context lets the model see more text, but it consumes more KV cache memory.",
    articleId: "article-context-kv-cache",
    relatedTerms: ["KV cache", "parallel"],
  },
  {
    term: "KV cache",
    slug: "kv-cache",
    shortDefinition: "Memory used to store attention keys and values for active context.",
    details: "KV cache grows with ctx-size and parallel slots. cache-type-k and cache-type-v control its precision.",
    articleId: "article-context-kv-cache",
    relatedTerms: ["cache-type-k", "cache-type-v"],
  },
  {
    term: "cache-type-k",
    slug: "cache-type-k",
    shortDefinition: "Key-cache precision for llama.cpp KV cache.",
    details: "Lower precision can save memory and enable larger context windows.",
    articleId: "article-context-kv-cache",
  },
  {
    term: "cache-type-v",
    slug: "cache-type-v",
    shortDefinition: "Value-cache precision for llama.cpp KV cache.",
    details: "Usually paired with cache-type-k. q4_0 is a common large-context setting.",
    articleId: "article-context-kv-cache",
  },
  {
    term: "CUDA_VISIBLE_DEVICES",
    slug: "cuda-visible-devices",
    shortDefinition: "Environment variable limiting which GPUs a model process can see.",
    details: "The manager emits it from selected CUDA indexes in the model's env block.",
    articleId: "article-gpu-placement",
    relatedTerms: ["CUDA index", "tensor split"],
  },
  {
    term: "CUDA index",
    slug: "cuda-index",
    shortDefinition: "GPU number reported by CUDA and nvidia-smi.",
    details: "Use the same index in GPU Planner and model placement so commands target the intended card.",
    articleId: "article-gpu-planner",
  },
  {
    term: "tensor split",
    slug: "tensor-split",
    shortDefinition: "Ratio for dividing model tensors across visible GPUs.",
    details: "Equal cards often use 1,1. Mixed cards need weighted ratios based on available VRAM.",
    articleId: "article-gpu-placement",
    relatedTerms: ["VRAM", "main GPU"],
  },
  {
    term: "main GPU",
    slug: "main-gpu",
    shortDefinition: "Primary visible GPU used by llama.cpp.",
    details: "Usually the first visible GPU unless a model-specific layout needs another card.",
    articleId: "article-gpu-placement",
  },
  {
    term: "n-gpu-layers",
    slug: "n-gpu-layers",
    shortDefinition: "How many model layers llama.cpp tries to offload to GPU.",
    details: "999 is commonly used as 'full offload if possible'. Lower values reduce VRAM use but slow inference.",
    articleId: "article-gpu-placement",
  },
  {
    term: "VRAM",
    slug: "vram",
    shortDefinition: "GPU memory available for model weights, KV cache, buffers, and batches.",
    details: "VRAM fit depends on quantization, context, cache precision, batch sizes, and GPU split.",
    articleId: "article-gpu-planner",
  },
  {
    term: "TTL",
    slug: "ttl",
    shortDefinition: "How long llama-swap keeps an inactive model loaded.",
    details: "ttl: 0 keeps a model loaded indefinitely. Higher values unload after inactivity.",
    articleId: "article-default-presets",
  },
  {
    term: "matrix",
    slug: "matrix",
    shortDefinition: "llama-swap concurrency rules for which models may run together.",
    details: "The manager emits matrix vars and sets instead of legacy groups.",
    articleId: "article-matrix",
    relatedTerms: ["support model", "evict cost"],
  },
  {
    term: "support model",
    slug: "support-model",
    shortDefinition: "A small model intended to stay available beside larger models.",
    details: "Embedding, reranking, and small vision support models are common support entries.",
    articleId: "article-matrix",
  },
  {
    term: "evict cost",
    slug: "evict-cost",
    shortDefinition: "Hint describing how expensive a model is to unload.",
    details: "Higher cost models are better candidates to keep loaded during eviction decisions.",
    articleId: "article-matrix",
  },
  {
    term: "HF token",
    slug: "hf-token",
    shortDefinition: "Hugging Face API token used by the rig for repo listing and downloads.",
    details: "Use a read token for private, gated, or rate-limited repos. The UI never displays the token value.",
    articleId: "article-hf-token",
  },
  {
    term: "revision",
    slug: "revision",
    shortDefinition: "Hugging Face branch, tag, or commit snapshot.",
    details: "main is convenient. Commit hashes make repeated downloads deterministic.",
    articleId: "article-hf-token",
  },
  {
    term: "bind mount",
    slug: "bind-mount",
    shortDefinition: "Docker mapping from a host path to a container path.",
    details: "The app writes container paths. Compose decides which host storage backs those paths.",
    articleId: "article-container-paths",
  },
  {
    term: "backup",
    slug: "backup",
    shortDefinition: "Timestamped config copy created before apply or restore.",
    details: "Backups are the rollback path when a generated config is wrong.",
    articleId: "article-config-preview",
  },
  {
    term: "restart control",
    slug: "restart-control",
    shortDefinition: "Optional manual Docker restart button for llama-swap.",
    details: "Requires Docker socket access and a matching container name.",
    articleId: "article-restart-control",
  },
  {
    term: "Docker socket",
    slug: "docker-socket",
    shortDefinition: "Unix socket that lets the manager talk to the Docker daemon.",
    details: "Powerful host-level control. Mount only on a trusted LAN manager container.",
    articleId: "article-restart-control",
  },
  {
    term: "managed model",
    slug: "managed-model",
    shortDefinition: "A saved app record that can render into a llama-swap model entry.",
    details: "It connects model files, flags, GPU placement, aliases, TTL, and matrix behavior.",
    articleId: "article-models-page",
  },
  {
    term: "config preview",
    slug: "config-preview",
    shortDefinition: "Generated YAML plus diff before applying changes.",
    details: "Preview lets you validate and inspect the exact config that apply will write.",
    articleId: "article-config-preview",
  },
  {
    term: "raw command",
    slug: "raw-command",
    shortDefinition: "Manual command text that replaces structured command generation.",
    details: "Use only when the builder cannot express the command. You own ${PORT}, paths, and flags.",
    articleId: "article-command-builder",
  },
  {
    term: "llama-server",
    slug: "llama-server",
    shortDefinition: "llama.cpp server process launched by llama-swap for each model.",
    details: "The generated command runs llama-server with --port ${PORT}, -m, and tuning flags.",
    articleId: "article-command-builder",
  },
  {
    term: "backup retention",
    slug: "backup-retention",
    shortDefinition: "Cleanup policy for old config backups.",
    details: "Count and age retention can control storage growth, but aggressive cleanup can remove useful rollback points.",
    articleId: "article-backup-policy",
    relatedTerms: ["backup", "restore"],
  },
  {
    term: "SSE",
    slug: "sse",
    shortDefinition: "Server-sent events stream used for live UI updates.",
    details: "The manager exposes events so the browser can react to download and config events without relying only on polling.",
    articleId: "article-observability",
  },
  {
    term: "SQLite",
    slug: "sqlite",
    shortDefinition: "Local database storing manager settings, GPU rows, model entries, and jobs.",
    details: "SQLite lives under /data by default. Preserve that mount during rebuilds or the app can look empty.",
    articleId: "article-production-readiness",
  },
  {
    term: "CORS",
    slug: "cors",
    shortDefinition: "Browser cross-origin API access policy.",
    details: "Keep CORS closed unless a specific trusted frontend origin must call the manager API.",
    articleId: "article-security-boundaries",
  },
  {
    term: "Docker socket exposure",
    slug: "docker-socket-exposure",
    shortDefinition: "Risk created by mounting /var/run/docker.sock into the manager.",
    details: "The socket gives the container Docker control on the host. Use it only for intentional LAN-only restart controls.",
    articleId: "article-security-boundaries",
    relatedTerms: ["Docker socket", "restart control"],
  },
  {
    term: "destructive diff",
    slug: "destructive-diff",
    shortDefinition: "A config diff that removes active or expected YAML.",
    details: "Destructive diffs can delete model entries, matrix rules, hooks, aliases, or env vars from active config.",
    articleId: "article-config-controls",
  },
  {
    term: "download queue",
    slug: "download-queue",
    shortDefinition: "Import page table for download job history and controls.",
    details: "The queue shows status, progress, destination, cancel, retry, create, and Clear Finished.",
    articleId: "article-import-field-reference",
  },
  {
    term: "download job",
    slug: "download-job",
    shortDefinition: "Persistent background job that writes selected files to the model root.",
    details: "A completed job is not served by llama-swap until it becomes a managed model and config is applied.",
    articleId: "article-dashboard-job-reference",
  },
  {
    term: "Clear Finished",
    slug: "clear-finished",
    shortDefinition: "Queue action that removes terminal job rows from the UI.",
    details: "It cleans history for completed, failed, or cancelled jobs; it does not delete already written model files.",
    articleId: "article-dashboard-job-reference",
  },
  {
    term: "model root",
    slug: "model-root",
    shortDefinition: "Base directory where model files live inside the manager or llama-swap container.",
    details: "The safest Docker setup maps both manager and llama-swap to /models.",
    articleId: "article-container-paths",
  },
  {
    term: "role directory",
    slug: "role-directory",
    shortDefinition: "Default model destination folder for a role such as chat, vision, coding, reasoning, or aux.",
    details: "Role directories organize imports and seed defaults, but they must stay visible to llama-swap.",
    articleId: "article-settings-field-reference",
  },
  {
    term: "disk safety",
    slug: "disk-safety",
    shortDefinition: "Free-space cushion used to avoid filling the model disk.",
    details: "A larger cushion blocks risky operations sooner; too large can block legitimate downloads.",
    articleId: "article-settings-field-reference",
  },
  {
    term: "Upload GGUF",
    slug: "upload-gguf",
    shortDefinition: "Import path for a local GGUF file instead of a Hugging Face download.",
    details: "Uploads still go through extension checks and destination staging before becoming managed models.",
    articleId: "article-import-field-reference",
  },
  {
    term: "startup preload",
    slug: "startup-preload",
    shortDefinition: "Flag that adds a model to hooks.on_startup.preload.",
    details: "Useful for always-on support models, risky for huge models that should not occupy VRAM immediately.",
    articleId: "article-models-field-reference",
  },
  {
    term: "custom matrix expression",
    slug: "custom-matrix-expression",
    shortDefinition: "Advanced override for generated matrix coexistence rules.",
    details: "Use when default matrix behavior cannot express the exact model combination you want.",
    articleId: "article-models-field-reference",
  },
  {
    term: "container files",
    slug: "container-files",
    shortDefinition: "Paths that generated llama-swap commands should use inside the container.",
    details: "They should normally start with /models, not a host-only path.",
    articleId: "article-models-field-reference",
  },
  {
    term: "alias",
    slug: "alias",
    shortDefinition: "Additional friendly name clients can use for a model.",
    details: "Aliases are helpful, but overlapping names can make client model lists confusing.",
    articleId: "article-models-page",
  },
  {
    term: "restore",
    slug: "restore",
    shortDefinition: "Replace active config with a selected backup.",
    details: "Restore backs up the current config first, then writes the selected backup. Restart llama-swap afterward.",
    articleId: "article-config-rollback",
  },
  {
    term: "validation",
    slug: "validation",
    shortDefinition: "Pre-apply checks for generated YAML and known manager constraints.",
    details: "Validation catches bad YAML, missing paths, unsafe config writes, and known structural errors before apply.",
    articleId: "article-config-controls",
  },
  {
    term: "health endpoint",
    slug: "health-endpoint",
    shortDefinition: "API check for manager, DB, config, model root, and backup path health.",
    details: "Use /api/health as the first smoke test after deploy or container restart.",
    articleId: "article-observability",
  },
  {
    term: "path traversal",
    slug: "path-traversal",
    shortDefinition: "Unsafe path input that tries to escape the allowed storage root.",
    details: "The manager should constrain writes to approved roots such as /models, /backups, /data, and temp directories.",
    articleId: "article-security-boundaries",
  },
  {
    term: "${PORT}",
    slug: "port-template",
    shortDefinition: "llama-swap placeholder substituted with the runtime model port.",
    details: "Every llama-server command should include --port ${PORT} unless you are doing a custom nonstandard setup.",
    articleId: "article-command-builder",
  },
];

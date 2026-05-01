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
];

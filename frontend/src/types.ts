export type ModelRole = "reasoning" | "chat" | "vision" | "coding" | "aux";
export type SourceType = "hf" | "upload" | "manual";
export type MatrixBehavior = "runs_alone" | "with_support" | "support" | "custom";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface RoleDirectories {
  reasoning: string;
  chat: string;
  vision: string;
  coding: string;
  aux: string;
}

export interface Defaults {
  ttl_reasoning: number;
  ttl_chat: number;
  ttl_vision: number;
  ttl_aux: number;
  ctx_size: number;
  cache_type_k: string;
  cache_type_v: string;
  flash_attn: string;
  jinja: boolean;
  no_mmap: boolean;
}

export interface ManagerSettings {
  app_host: string;
  app_port: number;
  manager_model_root: string;
  llama_swap_model_root: string;
  llama_swap_config_path: string;
  backups_dir: string;
  download_temp_dir: string;
  data_dir: string;
  default_revision: string;
  max_parallel_downloads: number;
  disk_safety_gb: number;
  llama_server_cmd: string;
  role_directories: RoleDirectories;
  defaults: Defaults;
  hf_token_configured?: boolean;
  hf_token?: string;
  hf_token_source?: string;
}

export interface GpuDevice {
  index: number;
  name: string;
  vram_gb: number;
  role: string;
  notes: string;
}

export interface ManagedModel {
  id: string;
  display_name: string;
  role: ModelRole;
  source_type: SourceType;
  hf_url: string;
  hf_revision: string;
  manager_files: string[];
  container_files: string[];
  primary_model_file: string;
  mmproj_file: string;
  chat_template_file: string;
  tokenizer_files: string[];
  aliases: string[];
  ttl: number;
  gpu_devices: number[];
  main_gpu: number | null;
  tensor_split: string;
  llama_flags: Record<string, string | number | boolean>;
  raw_cmd_override: string;
  matrix_key: string;
  matrix_behavior: MatrixBehavior;
  matrix_expression: string;
  evict_cost: number | null;
  startup_preload: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface HfFile {
  path: string;
  kind: "gguf" | "gguf_part" | "mmproj" | "chat_template" | "tokenizer" | "other";
  selected: boolean;
  group: string;
}

export interface HfResolveResponse {
  repo_id: string;
  revision: string;
  direct_file: string;
  files: HfFile[];
}

export interface DownloadJob {
  id: string;
  status: JobStatus;
  repo_id: string;
  revision: string;
  files: string[];
  destination_dir: string;
  container_dir: string;
  written_files: string[];
  container_files: string[];
  progress: number;
  bytes_downloaded: number;
  bytes_total: number;
  active_file: string;
  logs: string[];
  error: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface CreateModelFromDownloadPayload {
  id?: string;
  display_name?: string;
  role?: ModelRole;
  aliases?: string[];
  ttl?: number;
  gpu_devices?: number[];
  main_gpu?: number | null;
  tensor_split?: string;
  matrix_key?: string;
  matrix_behavior?: MatrixBehavior;
  matrix_expression?: string;
  evict_cost?: number | null;
  startup_preload?: boolean;
}

export interface StateResponse {
  settings: ManagerSettings;
  gpus: GpuDevice[];
  model_count: number;
  job_count: number;
  config_status: {
    path: string;
    exists: boolean;
    writable: boolean;
  };
}

export interface ConfigPreviewResponse {
  valid: boolean;
  stage_id: string;
  yaml: string;
  diff: string;
  errors: string[];
  warnings: string[];
}

export interface ApplyResponse {
  applied: boolean;
  backup: string;
  restart_required: boolean;
  restart_note: string;
}

export const modelRoles: ModelRole[] = ["reasoning", "chat", "vision", "coding", "aux"];
export const matrixBehaviors: MatrixBehavior[] = ["runs_alone", "with_support", "support", "custom"];

export function emptyModel(): ManagedModel {
  return {
    id: "",
    display_name: "",
    role: "chat",
    source_type: "manual",
    hf_url: "",
    hf_revision: "main",
    manager_files: [],
    container_files: [],
    primary_model_file: "",
    mmproj_file: "",
    chat_template_file: "",
    tokenizer_files: [],
    aliases: [],
    ttl: 0,
    gpu_devices: [],
    main_gpu: null,
    tensor_split: "",
    llama_flags: {
      ctx_size: 65536,
      cache_type_k: "q4_0",
      cache_type_v: "q4_0",
      flash_attn: "on",
      jinja: true,
      no_mmap: true,
    },
    raw_cmd_override: "",
    matrix_key: "",
    matrix_behavior: "with_support",
    matrix_expression: "",
    evict_cost: null,
    startup_preload: false,
  };
}

import type { ManagedModel, ManagerSettings } from "./types";

export function classNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function defaultTtlForRole(settings: ManagerSettings | undefined, role: ManagedModel["role"]): number {
  const defaults = settings?.defaults;
  if (!defaults) return 0;
  if (role === "reasoning") return defaults.ttl_reasoning;
  if (role === "vision") return defaults.ttl_vision;
  if (role === "aux") return defaults.ttl_aux;
  return defaults.ttl_chat;
}

export function modelCommand(model: ManagedModel, settings: ManagerSettings | undefined): string {
  if (model.raw_cmd_override.trim()) return model.raw_cmd_override.trim();
  const cmd = settings?.llama_server_cmd || "/app/llama-server";
  const file = model.primary_model_file || model.container_files[0] || "<container-model-path>";
  const flags = model.llama_flags ?? {};
  const parts = [cmd, "-m", file, "--port", "${PORT}"];
  addFlag(parts, "--ctx-size", flags.ctx_size);
  addFlag(parts, "--cache-type-k", flags.cache_type_k);
  addFlag(parts, "--cache-type-v", flags.cache_type_v);
  addFlag(parts, "--tensor-split", model.tensor_split);
  addFlag(parts, "--main-gpu", model.main_gpu);
  addFlag(parts, "--flash-attn", flags.flash_attn);
  addFlag(parts, "--mmproj", model.mmproj_file);
  addFlag(parts, "--chat-template-file", model.chat_template_file);
  addFlag(parts, "--parallel", flags.parallel);
  addFlag(parts, "--batch-size", flags.batch_size);
  addFlag(parts, "--ubatch-size", flags.ubatch_size);
  addFlag(parts, "--temp", flags.temp);
  addFlag(parts, "--top-p", flags.top_p);
  addFlag(parts, "--top-k", flags.top_k);
  addFlag(parts, "--min-p", flags.min_p);
  addFlag(parts, "--presence-penalty", flags.presence_penalty);
  addFlag(parts, "--repeat-penalty", flags.repeat_penalty);
  if (flags.jinja) parts.push("--jinja");
  if (flags.no_mmap) parts.push("--no-mmap");
  if (flags.context_shift) parts.push("--context-shift");
  addFlag(parts, "--keep", flags.keep);
  addFlag(parts, "--n-predict", flags.n_predict);
  return parts.join(" ");
}

export function safeMatrixKey(value: string, fallback = "m"): string {
  const compact = value.replace(/[^A-Za-z0-9_]/g, "");
  const withLetter = /^[A-Za-z]/.test(compact) ? compact : `${fallback}${compact}`;
  return (withLetter || fallback).slice(0, 8);
}

function addFlag(parts: string[], flag: string, value: unknown): void {
  if (value === undefined || value === null || value === "") return;
  parts.push(flag, String(value));
}

export function matrixExpression(model: ManagedModel): string {
  if (model.matrix_behavior === "custom") return model.matrix_expression || model.matrix_key || model.id;
  if (model.matrix_behavior === "runs_alone") return model.matrix_key || model.id;
  if (model.matrix_behavior === "support") return model.matrix_key || model.id;
  return model.matrix_key || model.id;
}

export function redactToken(text: string): string {
  return text.replace(/hf_[A-Za-z0-9_:-]+/g, "hf_***");
}

import type { DownloadJob, FileInventoryItem, ManagedModel, ManagerSettings, ModelRole } from "./types";
import { emptyModel, modelRoles } from "./types";
import { defaultTtlForRole, safeMatrixKey } from "./utils";

const terminalStatuses = new Set(["completed", "failed", "cancelled"]);

export function jobFilePaths(job: DownloadJob): string[] {
  return dedupe([...(job.container_files ?? []), ...(job.written_files ?? [])]);
}

export function modelFilePaths(model: ManagedModel): string[] {
  return dedupe([
    model.primary_model_file,
    model.mmproj_file,
    model.chat_template_file,
    ...(model.container_files ?? []),
    ...(model.manager_files ?? []),
    ...(model.tokenizer_files ?? []),
  ]);
}

export function isJobManaged(job: DownloadJob, models: ManagedModel[] | undefined): boolean {
  const jobPaths = new Set(jobFilePaths(job).map(normalizePath));
  if (!jobPaths.size) return false;
  return (models ?? []).some((model) => modelFilePaths(model).some((path) => jobPaths.has(normalizePath(path))));
}

export function isJobReadyForModel(job: DownloadJob, models: ManagedModel[] | undefined): boolean {
  return job.status === "completed" && jobFilePaths(job).some(isPrimaryGgufPath) && !isJobManaged(job, models);
}

export function isJobActive(job: DownloadJob): boolean {
  return job.status === "queued" || job.status === "running";
}

export function isJobFailed(job: DownloadJob): boolean {
  return job.status === "failed" || job.status === "cancelled";
}

export function isTerminalJob(job: DownloadJob): boolean {
  return terminalStatuses.has(job.status);
}

export function inferRoleFromPath(path: string, fallback: ModelRole = "chat"): ModelRole {
  const parts = path.split("/").filter(Boolean);
  const role = parts.find((part) => modelRoles.includes(part as ModelRole));
  return (role as ModelRole | undefined) ?? fallback;
}

export function modelNameFromPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  const fileName = parts.at(-1) ?? "model";
  const parent = parts.length > 1 ? parts.at(-2) : "";
  const stem = fileName
    .replace(/\.gguf$/i, "")
    .replace(/-\d{5}-of-\d{5}$/i, "")
    .trim();
  return slugify(parent || stem || "model");
}

export function managedModelFromInventoryItem(item: FileInventoryItem, settings: ManagerSettings | undefined): ManagedModel {
  const role = inferRoleFromPath(item.relative_path);
  const id = modelNameFromPath(item.relative_path || item.container_path);
  return {
    ...emptyModel(),
    id,
    display_name: id,
    role,
    source_type: "manual",
    manager_files: [item.manager_path],
    container_files: [item.container_path],
    primary_model_file: item.kind === "gguf" || item.kind === "gguf_part" ? item.container_path : "",
    mmproj_file: item.kind === "mmproj" ? item.container_path : "",
    chat_template_file: item.kind === "chat_template" ? item.container_path : "",
    tokenizer_files: item.kind === "tokenizer" ? [item.container_path] : [],
    ttl: defaultTtlForRole(settings, role),
    matrix_key: safeMatrixKey(id),
  };
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const precision = index === 0 || size >= 10 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[index]}`;
}

function dedupe(paths: Array<string | null | undefined>): string[] {
  return Array.from(new Set(paths.filter(Boolean).map(String)));
}

function normalizePath(path: string): string {
  return path.replace(/\/+/g, "/").replace(/\/$/, "");
}

function isPrimaryGgufPath(path: string): boolean {
  const fileName = path.split("/").at(-1)?.toLowerCase() ?? "";
  return fileName.endsWith(".gguf") && !fileName.includes("mmproj");
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "model";
}

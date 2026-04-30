import type {
  ApplyResponse,
  CreateModelFromDownloadPayload,
  ConfigPreviewResponse,
  DownloadJob,
  GpuDevice,
  HfResolveResponse,
  ManagedModel,
  ManagerSettings,
  ModelRole,
  SourceType,
  StateResponse,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: init?.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      message = typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail ?? payload);
    } catch {
      message = await response.text();
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export const api = {
  state: () => request<StateResponse>("/api/state"),
  settings: () => request<ManagerSettings>("/api/settings"),
  saveSettings: (settings: ManagerSettings) =>
    request<ManagerSettings>("/api/settings", { method: "PUT", body: JSON.stringify(stripUiOnlySettings(settings)) }),
  saveHfToken: (token: string) =>
    request<ManagerSettings>("/api/settings/hf-token", { method: "PUT", body: JSON.stringify({ token }) }),
  clearHfToken: () => request<ManagerSettings>("/api/settings/hf-token", { method: "DELETE" }),
  gpus: () => request<GpuDevice[]>("/api/gpus"),
  saveGpus: (gpus: GpuDevice[]) => request<GpuDevice[]>("/api/gpus", { method: "PUT", body: JSON.stringify(gpus) }),
  resolveHf: (url: string, revision: string) =>
    request<HfResolveResponse>("/api/hf/resolve", { method: "POST", body: JSON.stringify({ url, revision }) }),
  createImport: (payload: {
    role: ModelRole;
    source_type: SourceType;
    hf_url?: string;
    hf_revision?: string;
    selected_files?: string[];
    desired_name?: string;
    gpu_devices?: number[];
  }) => request<{ destination_dir: string; container_dir: string; selected_files: string[] }>("/api/imports", { method: "POST", body: JSON.stringify(payload) }),
  startDownload: (payload: {
    repo_id: string;
    revision: string;
    files: string[];
    destination_dir: string;
    model_id?: string;
  }) => request<DownloadJob>("/api/downloads", { method: "POST", body: JSON.stringify(payload) }),
  downloads: () => request<DownloadJob[]>("/api/downloads"),
  download: (id: string) => request<DownloadJob>(`/api/downloads/${encodeURIComponent(id)}`),
  cancelDownload: (id: string) => request<DownloadJob>(`/api/downloads/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  retryDownload: (id: string) => request<DownloadJob>(`/api/downloads/${encodeURIComponent(id)}/retry`, { method: "POST" }),
  models: () => request<ManagedModel[]>("/api/models"),
  saveModel: (model: ManagedModel) =>
    request<ManagedModel>("/api/models", { method: "POST", body: JSON.stringify(normalizeModel(model)) }),
  createModelFromDownload: (jobId: string, payload: CreateModelFromDownloadPayload) =>
    request<ManagedModel>(`/api/models/from-download/${encodeURIComponent(jobId)}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  previewConfig: (modelIds: string[] = []) =>
    request<ConfigPreviewResponse>("/api/config/preview", { method: "POST", body: JSON.stringify({ model_ids: modelIds }) }),
  applyConfig: (stageId: string) =>
    request<ApplyResponse>("/api/config/apply", { method: "POST", body: JSON.stringify({ stage_id: stageId }) }),
  upload: (role: ModelRole, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return request<{ manager_path: string; container_path: string }>(`/api/uploads?role=${role}`, {
      method: "POST",
      body: formData,
    });
  },
};

function stripUiOnlySettings(settings: ManagerSettings): ManagerSettings {
  const { hf_token: _hfToken, hf_token_configured: _hfTokenConfigured, hf_token_source: _hfTokenSource, ...safeSettings } = settings;
  return safeSettings;
}

function normalizeModel(model: ManagedModel): ManagedModel {
  return {
    ...model,
    aliases: splitList(model.aliases),
    manager_files: splitList(model.manager_files),
    container_files: splitList(model.container_files),
    tokenizer_files: splitList(model.tokenizer_files),
    gpu_devices: model.gpu_devices.map(Number),
    main_gpu: model.main_gpu === null || Number.isNaN(Number(model.main_gpu)) ? null : Number(model.main_gpu),
    evict_cost: model.evict_cost === null || Number.isNaN(Number(model.evict_cost)) ? null : Number(model.evict_cost),
    ttl: Number(model.ttl) || 0,
  };
}

export function splitList(value: string[] | string): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => splitList(item));
  }
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

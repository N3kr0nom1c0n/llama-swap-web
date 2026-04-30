export const queryKeys = {
  state: ["state"] as const,
  settings: ["settings"] as const,
  gpus: ["gpus"] as const,
  gpuDetection: ["gpus", "detect"] as const,
  gpuStatus: ["gpus", "status"] as const,
  models: ["models"] as const,
  downloads: ["downloads"] as const,
  modelScan: ["models", "scan"] as const,
  configBackups: ["config", "backups"] as const,
  configImport: ["config", "import"] as const,
  preview: ["preview"] as const,
};

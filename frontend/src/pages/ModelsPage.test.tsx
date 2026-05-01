import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/testUtils";
import type { ManagedModel, ManagerSettings } from "../types";
import { ModelsPage } from "./ModelsPage";

const settingsPayload: ManagerSettings = {
  app_host: "0.0.0.0",
  app_port: 8081,
  manager_model_root: "/models",
  llama_swap_model_root: "/models",
  llama_swap_config_path: "/app/config.yaml",
  backups_dir: "/backups",
  backup_retention_count: 0,
  backup_retention_days: 0,
  download_temp_dir: "/tmp",
  data_dir: "/data",
  default_revision: "main",
  max_parallel_downloads: 1,
  disk_safety_gb: 20,
  llama_server_cmd: "/app/llama-server",
  llama_swap_restart_enabled: false,
  llama_swap_container_name: "llama-swap",
  docker_socket_path: "/var/run/docker.sock",
  llama_swap_restart_timeout: 30,
  role_directories: {
    reasoning: "/models/reasoning",
    chat: "/models/chat",
    vision: "/models/vision",
    coding: "/models/coding",
    aux: "/models/aux",
  },
  defaults: {
    ttl_reasoning: 600,
    ttl_chat: 0,
    ttl_vision: 300,
    ttl_aux: 0,
    ctx_size: 65536,
    cache_type_k: "q4_0",
    cache_type_v: "q4_0",
    flash_attn: "on",
    jinja: true,
    no_mmap: true,
  },
  hf_token_configured: false,
  hf_token: "",
  hf_token_source: "",
};

const modelPayload: ManagedModel = {
  id: "tiny-chat",
  display_name: "Tiny Chat",
  target_rig_id: "default",
  role: "chat",
  source_type: "manual",
  hf_url: "",
  hf_revision: "main",
  manager_files: [],
  container_files: ["/models/chat/tiny.gguf"],
  primary_model_file: "/models/chat/tiny.gguf",
  mmproj_file: "",
  chat_template_file: "",
  tokenizer_files: [],
  aliases: ["alpha"],
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
  matrix_key: "tiny",
  matrix_behavior: "with_support",
  matrix_expression: "",
  evict_cost: null,
  startup_preload: false,
};

describe("ModelsPage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("preserves in-progress textarea list edits until save", async () => {
    mockModelsFetch();
    renderWithProviders(<ModelsPage />);

    await screen.findByDisplayValue("tiny-chat");
    const aliases = await screen.findByLabelText(/Aliases/);
    fireEvent.change(aliases, { target: { value: "alpha\n" } });

    expect(aliases).toHaveValue("alpha\n");
  });

  it("normalizes numeric llama flags before saving", async () => {
    let savedModel: ManagedModel | null = null;
    mockModelsFetch((input, init) => {
      const url = String(input);
      if (url.endsWith("/api/models") && init?.method === "POST") {
        savedModel = JSON.parse(String(init.body)) as ManagedModel;
        return Promise.resolve(jsonResponse(modelPayload));
      }
      return undefined;
    });
    renderWithProviders(<ModelsPage />);

    await screen.findByDisplayValue("tiny-chat");
    const gpuLayers = await screen.findByLabelText(/n-gpu-layers/);
    fireEvent.change(gpuLayers, { target: { value: "999" } });
    await waitFor(() => expect(gpuLayers).toHaveValue("999"));
    fireEvent.click(screen.getByRole("button", { name: /save model/i }));

    await waitFor(() => expect(savedModel).not.toBeNull());
    const payload = savedModel as unknown as ManagedModel;
    expect(payload.llama_flags.n_gpu_layers).toBe(999);
  });
});

function mockModelsFetch(
  override?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | undefined,
) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const overridden = override?.(input, init);
    if (overridden) return overridden;
    const url = String(input);
    if (url.endsWith("/api/settings")) return Promise.resolve(jsonResponse(settingsPayload));
    if (url.endsWith("/api/gpus")) return Promise.resolve(jsonResponse([]));
    if (url.endsWith("/api/models")) return Promise.resolve(jsonResponse([modelPayload]));
    if (url.endsWith("/api/state")) return Promise.resolve(jsonResponse({}));
    return Promise.reject(new Error(`Unexpected fetch ${url}`));
  });
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

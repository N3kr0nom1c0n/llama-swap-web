import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./DashboardPage";
import { renderWithProviders } from "../test/testUtils";

const statePayload = {
  settings: {
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
    hf_token_configured: true,
    hf_token: "***",
  },
  gpus: [{ index: 0, name: "3090", vram_gb: 24, role: "chat", notes: "" }],
  model_count: 1,
  job_count: 0,
  config_status: { path: "/app/config.yaml", exists: true, writable: true },
};

describe("DashboardPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders API state without exposing token values", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/api/state")) return Promise.resolve(jsonResponse(statePayload));
      if (url.endsWith("/api/models")) {
        return Promise.resolve(
          jsonResponse([
            {
              id: "tiny-chat",
              role: "chat",
              matrix_behavior: "with_support",
              primary_model_file: "/models/chat/tiny.gguf",
              container_files: ["/models/chat/tiny.gguf"],
            },
          ]),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    });

    renderWithProviders(<DashboardPage />);

    await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());
    expect(screen.getByText("HF token")).toBeInTheDocument();
    expect(screen.getByText("configured")).toBeInTheDocument();
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

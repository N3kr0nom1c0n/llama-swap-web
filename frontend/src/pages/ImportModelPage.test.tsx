import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/testUtils";
import { ImportModelPage } from "./ImportModelPage";

const settingsPayload = {
  app_host: "0.0.0.0",
  app_port: 8081,
  manager_model_root: "/models",
  llama_swap_model_root: "/models",
  llama_swap_config_path: "/app/config.yaml",
  backups_dir: "/backups",
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
  hf_token_source: "/app/.env",
};

describe("ImportModelPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows per-job progress in the download queue", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/api/settings")) return Promise.resolve(jsonResponse(settingsPayload));
      if (url.endsWith("/api/gpus")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/api/downloads")) {
        return Promise.resolve(
          jsonResponse([
            {
              id: "job-1",
              status: "running",
              repo_id: "org/repo",
              revision: "main",
              files: ["model.gguf"],
              destination_dir: "/models/chat",
              container_dir: "/models/chat",
              written_files: [],
              container_files: [],
              progress: 42,
              bytes_downloaded: 40,
              bytes_total: 100,
              active_file: "model.gguf",
              logs: ["downloading"],
              error: "",
            },
          ]),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    });

    renderWithProviders(<ImportModelPage />);

    const row = await screen.findByText("org/repo");
    const progress = within(row.closest("tr") as HTMLTableRowElement).getByRole("progressbar", {
      name: "Download progress for org/repo",
    });

    await waitFor(() => expect(progress).toHaveAttribute("aria-valuenow", "42"));
    expect(within(row.closest("tr") as HTMLTableRowElement).getByText("42%")).toBeInTheDocument();
    expect(within(row.closest("tr") as HTMLTableRowElement).getByText("40 B / 100 B")).toBeInTheDocument();
    expect(within(row.closest("tr") as HTMLTableRowElement).getByText("model.gguf")).toBeInTheDocument();
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

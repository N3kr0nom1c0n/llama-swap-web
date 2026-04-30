import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/testUtils";
import { SettingsPage } from "./SettingsPage";

const settingsPayload = {
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

describe("SettingsPage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("saves the HF token through the secret endpoint and clears the field", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith("/api/settings") && !init?.method) return Promise.resolve(jsonResponse(settingsPayload));
      if (url.endsWith("/api/settings/hf-token") && init?.method === "PUT") {
        expect(JSON.parse(String(init.body))).toEqual({ token: "hf_test_token" });
        return Promise.resolve(
          jsonResponse({
            ...settingsPayload,
            hf_token_configured: true,
            hf_token: "***",
            hf_token_source: "/app/.env",
          }),
        );
      }
      if (url.endsWith("/api/state")) return Promise.resolve(jsonResponse({}));
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    });

    renderWithProviders(<SettingsPage />);

    const tokenInput = await screen.findByLabelText("HF API token");
    fireEvent.change(tokenInput, { target: { value: "hf_test_token" } });
    fireEvent.click(screen.getByRole("button", { name: /save token/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/settings/hf-token", expect.objectContaining({ method: "PUT" })));
    expect(screen.queryByDisplayValue("hf_test_token")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("/app/.env")).toBeInTheDocument();
  });

  it("exposes backup retention settings in the paths section", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith("/api/settings") && !init?.method) return Promise.resolve(jsonResponse(settingsPayload));
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    });

    renderWithProviders(<SettingsPage />);

    expect(await screen.findByLabelText(/Backup retention count/)).toHaveValue(0);
    expect(screen.getByLabelText(/Backup retention days/)).toHaveValue(0);
  });

  it("saves llama-swap restart controls as explicit opt-in settings", async () => {
    let savedSettings: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith("/api/settings") && !init?.method) return Promise.resolve(jsonResponse(settingsPayload));
      if (url.endsWith("/api/settings") && init?.method === "PUT") {
        savedSettings = JSON.parse(String(init.body));
        return Promise.resolve(jsonResponse(savedSettings));
      }
      if (url.endsWith("/api/state")) return Promise.resolve(jsonResponse({}));
      if (url.endsWith("/api/config/preview")) return Promise.resolve(jsonResponse({}));
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    });

    renderWithProviders(<SettingsPage />);

    fireEvent.click(await screen.findByLabelText("Enable llama-swap restart control"));
    fireEvent.change(screen.getByLabelText("llama-swap container name"), { target: { value: "llama-swap" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));

    await waitFor(() => expect(savedSettings).not.toBeNull());
    expect(savedSettings).toMatchObject({
      llama_swap_restart_enabled: true,
      llama_swap_container_name: "llama-swap",
      docker_socket_path: "/var/run/docker.sock",
      llama_swap_restart_timeout: 30,
    });
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

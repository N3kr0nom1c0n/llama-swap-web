import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
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
  hf_token_source: "/app/.env",
};

describe("ImportModelPage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows per-job progress in the download queue", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/api/settings")) return Promise.resolve(jsonResponse(settingsPayload));
      if (url.endsWith("/api/gpus")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/api/models")) return Promise.resolve(jsonResponse([]));
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
    fireEvent.click(await screen.findByRole("button", { name: /Download/ }));

    const row = await screen.findByText("org/repo");
    const progress = within(row.closest("tr") as HTMLTableRowElement).getByRole("progressbar", {
      name: "Download progress for org/repo",
    });

    await waitFor(() => expect(progress).toHaveAttribute("aria-valuenow", "42"));
    expect(within(row.closest("tr") as HTMLTableRowElement).getByText("42%")).toBeInTheDocument();
    expect(within(row.closest("tr") as HTMLTableRowElement).getByText("40 B / 100 B")).toBeInTheDocument();
    expect(within(row.closest("tr") as HTMLTableRowElement).getByText("model.gguf")).toBeInTheDocument();
  });

  it("turns a completed download into the next model setup step", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith("/api/settings")) return Promise.resolve(jsonResponse(settingsPayload));
      if (url.endsWith("/api/gpus")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/api/models")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/api/downloads")) {
        return Promise.resolve(
          jsonResponse([
            {
              id: "job-1",
              status: "completed",
              repo_id: "org/repo",
              revision: "main",
              files: ["model.gguf"],
              destination_dir: "/models/chat/repo",
              container_dir: "/models/chat/repo",
              written_files: ["/models/chat/repo/model.gguf"],
              container_files: ["/models/chat/repo/model.gguf"],
              progress: 100,
              bytes_downloaded: 100,
              bytes_total: 100,
              active_file: "",
              logs: ["downloaded 1 file(s)"],
              error: "",
            },
          ]),
        );
      }
      if (url.endsWith("/api/models/from-download/job-1")) {
        expect(init?.method).toBe("POST");
        return Promise.resolve(
          jsonResponse({
            id: "repo",
            display_name: "repo",
            role: "chat",
            source_type: "hf",
            hf_url: "https://huggingface.co/org/repo",
            hf_revision: "main",
            manager_files: ["/models/chat/repo/model.gguf"],
            container_files: ["/models/chat/repo/model.gguf"],
            primary_model_file: "/models/chat/repo/model.gguf",
            mmproj_file: "",
            chat_template_file: "",
            tokenizer_files: [],
            aliases: [],
            ttl: 0,
            gpu_devices: [],
            main_gpu: null,
            tensor_split: "",
            llama_flags: {},
            raw_cmd_override: "",
            matrix_key: "repo",
            matrix_behavior: "with_support",
            matrix_expression: "",
            evict_cost: null,
            startup_preload: false,
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    });

    renderWithProviders(<ImportModelPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Configure/ }));

    await screen.findByText("Ready to configure");
    expect(screen.getAllByText("/models/chat/repo/model.gguf").length).toBeGreaterThan(0);

    const installButton = await screen.findByRole("button", { name: "Create Managed Model" });
    expect(installButton).not.toBeDisabled();
    fireEvent.click(installButton);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/models/from-download/job-1",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await screen.findByText((_content, element) => element?.textContent === "Managed model repo created. Next: tune it or preview config.");
    expect(screen.getByRole("link", { name: "Tune Managed Model" })).toHaveAttribute("href", "/models");
    expect(screen.getByRole("link", { name: "Preview Config" })).toHaveAttribute("href", "/config");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/models/from-download/job-1",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("lets backend infer role when installing a queue item without draft context", async () => {
    let installBody: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith("/api/settings")) return Promise.resolve(jsonResponse(settingsPayload));
      if (url.endsWith("/api/gpus")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/api/models")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/api/downloads")) {
        return Promise.resolve(
          jsonResponse([
            {
              id: "vision-job",
              status: "completed",
              repo_id: "org/vision-repo",
              revision: "main",
              files: ["model.gguf"],
              destination_dir: "/models/vision/vision-repo",
              container_dir: "/models/vision/vision-repo",
              written_files: ["/models/vision/vision-repo/model.gguf"],
              container_files: ["/models/vision/vision-repo/model.gguf"],
              progress: 100,
              bytes_downloaded: 100,
              bytes_total: 100,
              active_file: "",
              logs: ["downloaded 1 file(s)"],
              error: "",
            },
          ]),
        );
      }
      if (url.endsWith("/api/models/from-download/vision-job")) {
        installBody = JSON.parse(String(init?.body));
        return Promise.resolve(
          jsonResponse({
            id: "vision-repo",
            display_name: "vision-repo",
            role: "vision",
            source_type: "hf",
            hf_url: "https://huggingface.co/org/vision-repo",
            hf_revision: "main",
            manager_files: ["/models/vision/vision-repo/model.gguf"],
            container_files: ["/models/vision/vision-repo/model.gguf"],
            primary_model_file: "/models/vision/vision-repo/model.gguf",
            mmproj_file: "",
            chat_template_file: "",
            tokenizer_files: [],
            aliases: [],
            ttl: 300,
            gpu_devices: [],
            main_gpu: null,
            tensor_split: "",
            llama_flags: {},
            raw_cmd_override: "",
            matrix_key: "visionr",
            matrix_behavior: "with_support",
            matrix_expression: "",
            evict_cost: null,
            startup_preload: false,
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    });

    renderWithProviders(<ImportModelPage />);
    fireEvent.change(await screen.findByLabelText("Desired name"), { target: { value: "stale-draft" } });
    fireEvent.click(await screen.findByRole("button", { name: /Configure/ }));

    fireEvent.click(await screen.findByRole("button", { name: "Create Managed Model" }));

    await waitFor(() => expect(installBody).not.toBeNull());
    expect(installBody).not.toHaveProperty("role");
    expect(installBody).not.toHaveProperty("ttl");
    expect(installBody).not.toHaveProperty("id");
    expect(installBody).not.toHaveProperty("display_name");
  });

  it("creates a managed model from an existing scanned GGUF without manual path copying", async () => {
    let savedModel: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith("/api/settings")) return Promise.resolve(jsonResponse(settingsPayload));
      if (url.endsWith("/api/gpus")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/api/downloads")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/api/models/scan")) {
        return Promise.resolve(
          jsonResponse([
            {
              manager_path: "/models/chat/tiny/tiny.gguf",
              container_path: "/models/chat/tiny/tiny.gguf",
              relative_path: "chat/tiny/tiny.gguf",
              kind: "gguf",
              size: 1024,
            },
          ]),
        );
      }
      if (url.endsWith("/api/models") && init?.method === "POST") {
        savedModel = JSON.parse(String(init.body));
        return Promise.resolve(jsonResponse(savedModel));
      }
      if (url.endsWith("/api/models")) return Promise.resolve(jsonResponse([]));
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    });

    renderWithProviders(<ImportModelPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Scan Existing Files" }));
    await screen.findByText("chat/tiny/tiny.gguf");
    fireEvent.click(screen.getByRole("button", { name: "Create model from chat/tiny/tiny.gguf" }));

    await waitFor(() => expect(savedModel).not.toBeNull());
    expect(savedModel).toMatchObject({
      id: "tiny",
      display_name: "tiny",
      role: "chat",
      source_type: "manual",
      primary_model_file: "/models/chat/tiny/tiny.gguf",
      container_files: ["/models/chat/tiny/tiny.gguf"],
    });
    await screen.findByText("Managed model tiny created from existing file. Preview config when ready.");
  });

  it("clears finished download jobs from the queue", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith("/api/settings")) return Promise.resolve(jsonResponse(settingsPayload));
      if (url.endsWith("/api/gpus")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/api/models")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/api/downloads/terminal")) {
        expect(init?.method).toBe("DELETE");
        return Promise.resolve(jsonResponse({ removed: 1 }));
      }
      if (url.endsWith("/api/downloads")) {
        return Promise.resolve(
          jsonResponse([
            {
              id: "done-job",
              status: "completed",
              repo_id: "org/repo",
              revision: "main",
              files: ["model.gguf"],
              destination_dir: "/models/chat/repo",
              container_dir: "/models/chat/repo",
              written_files: ["/models/chat/repo/model.gguf"],
              container_files: ["/models/chat/repo/model.gguf"],
              progress: 100,
              bytes_downloaded: 100,
              bytes_total: 100,
              active_file: "",
              logs: [],
              error: "",
            },
          ]),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    });

    renderWithProviders(<ImportModelPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Download/ }));

    const clearButton = await screen.findByRole("button", { name: "Clear Finished" });
    await waitFor(() => expect(clearButton).not.toBeDisabled());
    fireEvent.click(clearButton);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/downloads/terminal",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

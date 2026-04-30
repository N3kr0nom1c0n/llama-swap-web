import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/testUtils";
import { ConfigPreviewPage } from "./ConfigPreviewPage";

describe("ConfigPreviewPage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("lists backups and restores a selected backup from the UI", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith("/api/models")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/api/llama-swap/status")) {
        return Promise.resolve(
          jsonResponse({
            enabled: false,
            available: false,
            container_name: "llama-swap",
            socket_path: "/var/run/docker.sock",
            status: "",
            running: false,
            error: "",
            warning: "Docker socket access can control this host.",
          }),
        );
      }
      if (url.endsWith("/api/config/preview")) {
        return Promise.resolve(
          jsonResponse({
            valid: true,
            stage_id: "stage-1",
            yaml: "models: {}\n",
            diff: "",
            errors: [],
            warnings: [],
            destructive_changes: [],
          }),
        );
      }
      if (url.endsWith("/api/config/backups")) {
        return Promise.resolve(
          jsonResponse([
            {
              name: "config-20260430-120000-000000.yaml",
              path: "/backups/config-20260430-120000-000000.yaml",
              size: 24,
              modified: "2026-04-30T12:00:00",
            },
          ]),
        );
      }
      if (url.endsWith("/api/config/restore")) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({ backup_name: "config-20260430-120000-000000.yaml" });
        return Promise.resolve(
          jsonResponse({
            restored: true,
            source_backup: "config-20260430-120000-000000.yaml",
            current_backup: "/backups/config-20260430-121000-000000.yaml",
            restart_required: true,
            restart_note: "Config restored. Restart llama-swap manually: docker compose restart llama-swap",
          }),
        );
      }
      if (url.endsWith("/api/state")) return Promise.resolve(jsonResponse({}));
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    });

    renderWithProviders(<ConfigPreviewPage />);

    expect(await screen.findByText("config-20260430-120000-000000.yaml")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /restore config-20260430-120000-000000.yaml/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/config/restore", expect.objectContaining({ method: "POST" })));
    expect(await screen.findByText("Config restored from backup")).toBeInTheDocument();
    expect(screen.getByText("/backups/config-20260430-121000-000000.yaml")).toBeInTheDocument();
  });

  it("restarts llama-swap from config preview when restart controls are enabled", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith("/api/models")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/api/config/preview")) {
        return Promise.resolve(
          jsonResponse({
            valid: true,
            stage_id: "stage-1",
            yaml: "models: {}\n",
            diff: "",
            errors: [],
            warnings: [],
            destructive_changes: [],
          }),
        );
      }
      if (url.endsWith("/api/config/backups")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/api/llama-swap/status")) {
        return Promise.resolve(
          jsonResponse({
            enabled: true,
            available: true,
            container_name: "llama-swap",
            socket_path: "/var/run/docker.sock",
            status: "running",
            running: true,
            error: "",
            warning: "Docker socket access can control this host.",
          }),
        );
      }
      if (url.endsWith("/api/llama-swap/restart")) {
        expect(init?.method).toBe("POST");
        return Promise.resolve(
          jsonResponse({
            restarted: true,
            message: "Restarted llama-swap.",
            status: {
              enabled: true,
              available: true,
              container_name: "llama-swap",
              socket_path: "/var/run/docker.sock",
              status: "running",
              running: true,
              error: "",
              warning: "Docker socket access can control this host.",
            },
          }),
        );
      }
      if (url.endsWith("/api/state")) return Promise.resolve(jsonResponse({}));
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    });

    renderWithProviders(<ConfigPreviewPage />);

    expect(await screen.findByRole("heading", { name: "llama-swap Runtime" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Restart llama-swap" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/llama-swap/restart", expect.objectContaining({ method: "POST" })));
    expect(await screen.findByText("Restarted llama-swap.")).toBeInTheDocument();
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

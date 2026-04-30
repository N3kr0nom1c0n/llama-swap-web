import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/testUtils";
import { GpuPlannerPage } from "./GpuPlannerPage";

describe("GpuPlannerPage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("imports detected GPUs and shows a tensor split recommendation", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith("/api/gpus") && !init?.method) {
        return Promise.resolve(jsonResponse([{ index: 0, name: "Manual GPU", vram_gb: 24, role: "chat", notes: "" }]));
      }
      if (url.endsWith("/api/gpus/detect")) {
        return Promise.resolve(
          jsonResponse({
            available: true,
            reason: "",
            gpus: [
              {
                index: 0,
                name: "NVIDIA GeForce RTX 3090",
                vram_gb: 24,
                memory_total_mb: 24576,
                memory_used_mb: 1024,
                memory_free_mb: 23552,
                role: "chat",
                notes: "primary",
              },
              {
                index: 1,
                name: "NVIDIA GeForce RTX 4080",
                vram_gb: 16,
                memory_total_mb: 16384,
                memory_used_mb: 512,
                memory_free_mb: 15872,
                role: "",
                notes: "",
              },
            ],
          }),
        );
      }
      if (url.endsWith("/api/gpus/recommend") && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({ cuda_devices: [0, 1] });
        return Promise.resolve(
          jsonResponse({
            available: true,
            reason: "",
            recommendation: { cuda_devices: [0, 1], main_gpu: 0, tensor_split: "3,2", warnings: [] },
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    });

    renderWithProviders(<GpuPlannerPage />);

    await screen.findByDisplayValue("Manual GPU");
    fireEvent.click(screen.getByRole("button", { name: /detect gpus/i }));
    await screen.findByText("2 detected");
    fireEvent.click(screen.getByRole("button", { name: /use detected gpus/i }));

    await screen.findByDisplayValue("NVIDIA GeForce RTX 3090");
    expect(screen.getByDisplayValue("NVIDIA GeForce RTX 4080")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /recommend split/i }));
    await waitFor(() => expect(screen.getByText(/tensor split 3,2/i)).toBeInTheDocument());

    fireEvent.click(screen.getAllByTitle("Remove GPU")[1]);

    await waitFor(() => expect(screen.queryByText(/tensor split 3,2/i)).not.toBeInTheDocument());
  });

  it("shows unavailable GPU detection clearly", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/api/gpus")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/api/gpus/detect")) {
        return Promise.resolve(jsonResponse({ available: false, reason: "nvidia-smi unavailable", gpus: [] }));
      }
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    });

    renderWithProviders(<GpuPlannerPage />);

    fireEvent.click(await screen.findByRole("button", { name: /detect gpus/i }));

    await screen.findByText("detection unavailable");
    expect(screen.getByText("nvidia-smi unavailable")).toBeInTheDocument();
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

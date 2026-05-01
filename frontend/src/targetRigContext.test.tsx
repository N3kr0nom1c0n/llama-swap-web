import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { TargetRigProvider, useTargetRig } from "./targetRigContext";
import type { TargetRig } from "./types";

const localRig: TargetRig = {
  id: "default",
  name: "Local Manager Host",
  mode: "local",
  host: "",
  port: 22,
  username: "",
  ssh_key_path: "",
  model_root: "/models",
  llama_swap_model_root: "/models",
  config_path: "/app/config.yaml",
  backups_dir: "/backups",
  download_temp_dir: "/tmp",
  restart_command: "docker restart llama-swap",
  health_check_command: "true",
  enabled: false,
  is_default: false,
};

const remoteRig: TargetRig = {
  ...localRig,
  id: "glyph-ssh",
  name: "glyph-of-inference SSH",
  mode: "ssh",
  host: "192.168.42.40",
  username: "n3kr0",
  ssh_key_path: "/data/ssh/id_ed25519",
  model_root: "/mnt/models/llama.swap/models",
  config_path: "/home/n3kr0/Repos/llama-swap/config.yaml",
  backups_dir: "/mnt/data_hoard/llama-swap/backups",
  enabled: true,
  is_default: true,
};

function Probe() {
  const { targetRigId, targetRigs, selectedRig } = useTargetRig();
  return (
    <div>
      <span data-testid="selected">{targetRigId}</span>
      <span data-testid="rig-count">{targetRigs.length}</span>
      <span data-testid="config">{selectedRig?.config_path}</span>
    </div>
  );
}

describe("TargetRigProvider", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        clear: () => storage.clear(),
      },
    });
  });

  it("moves stale local selections to the enabled remote default", async () => {
    localStorage.setItem("llama-swap-manager.targetRigId", "default");

    render(
      <TargetRigProvider targetRigs={[remoteRig, localRig]}>
        <Probe />
      </TargetRigProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("glyph-ssh"));
    expect(screen.getByTestId("rig-count")).toHaveTextContent("1");
    expect(screen.getByTestId("config")).toHaveTextContent("/home/n3kr0/Repos/llama-swap/config.yaml");
    expect(localStorage.getItem("llama-swap-manager.targetRigId")).toBe("glyph-ssh");
  });
});

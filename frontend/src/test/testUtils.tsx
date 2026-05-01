import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { TargetRigProvider } from "../targetRigContext";
import type { TargetRig } from "../types";

const defaultTargetRig: TargetRig = {
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
  enabled: true,
  is_default: true,
};

export function renderWithProviders(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TargetRigProvider targetRigs={[defaultTargetRig]}>
        <MemoryRouter>{ui}</MemoryRouter>
      </TargetRigProvider>
    </QueryClientProvider>,
  );
}

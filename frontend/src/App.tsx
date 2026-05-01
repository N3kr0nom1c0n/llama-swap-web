import { Navigate, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { Layout } from "./Layout";
import { ConfigPreviewPage } from "./pages/ConfigPreviewPage";
import { DashboardPage } from "./pages/DashboardPage";
import { GpuPlannerPage } from "./pages/GpuPlannerPage";
import { HelpPage } from "./pages/HelpPage";
import { ImportModelPage } from "./pages/ImportModelPage";
import { ModelsPage } from "./pages/ModelsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { queryKeys } from "./queryKeys";
import { TargetRigProvider } from "./targetRigContext";

export function App() {
  const targetRigs = useQuery({ queryKey: queryKeys.targetRigs, queryFn: api.targetRigs });

  return (
    <TargetRigProvider targetRigs={targetRigs.data ?? []}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="import" element={<ImportModelPage />} />
          <Route path="models" element={<ModelsPage />} />
          <Route path="gpus" element={<GpuPlannerPage />} />
          <Route path="config" element={<ConfigPreviewPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="help" element={<HelpPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </TargetRigProvider>
  );
}

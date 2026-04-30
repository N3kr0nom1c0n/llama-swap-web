import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./Layout";
import { ConfigPreviewPage } from "./pages/ConfigPreviewPage";
import { DashboardPage } from "./pages/DashboardPage";
import { GpuPlannerPage } from "./pages/GpuPlannerPage";
import { ImportModelPage } from "./pages/ImportModelPage";
import { ModelsPage } from "./pages/ModelsPage";
import { SettingsPage } from "./pages/SettingsPage";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="import" element={<ImportModelPage />} />
        <Route path="models" element={<ModelsPage />} />
        <Route path="gpus" element={<GpuPlannerPage />} />
        <Route path="config" element={<ConfigPreviewPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

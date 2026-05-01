import { NavLink, Outlet, useLocation } from "react-router-dom";
import { CircleHelp, Cpu, FileCode2, Gauge, HardDriveDownload, LayoutDashboard, RefreshCw, Settings, Server } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { queryKeys } from "./queryKeys";
import { StatusPill } from "./components/StatusPill";
import { useTargetRig } from "./targetRigContext";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/import", label: "Import Model", icon: HardDriveDownload },
  { to: "/models", label: "Models", icon: Server },
  { to: "/gpus", label: "GPU Planner", icon: Cpu },
  { to: "/config", label: "Config Preview", icon: FileCode2 },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/help", label: "Help", icon: CircleHelp },
];

const pageTitles: Record<string, string> = {
  "/": "Dashboard",
  "/import": "Import Model",
  "/models": "Models",
  "/gpus": "GPU Planner",
  "/config": "Config Preview",
  "/settings": "Settings",
  "/help": "Help",
};

export function Layout() {
  const location = useLocation();
  const { targetRigId, setTargetRigId, targetRigs, selectedRig } = useTargetRig();
  const state = useQuery({ queryKey: queryKeys.stateFor(targetRigId), queryFn: () => api.state(targetRigId), refetchInterval: 15000 });
  const pageTitle = pageTitles[location.pathname] ?? "Dashboard";
  const syncLabel = state.isFetching ? "syncing target state" : "target state current";
  const configPath = state.data?.config_status.path ?? selectedRig?.config_path ?? "/app/config.yaml";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Gauge size={24} aria-hidden="true" />
          <div>
            <strong>Llama-Swap Manager</strong>
            <span>LAN config staging</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="Primary">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
              <Icon size={17} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-status">
          <div className="sidebar-target">
            <span className="sidebar-target-label">Target Rig</span>
            <select value={targetRigId} onChange={(event) => setTargetRigId(event.target.value)}>
              {targetRigs.length ? (
                targetRigs.map((rig) => (
                  <option key={rig.id} value={rig.id}>
                    {rig.name} ({rig.mode})
                  </option>
                ))
              ) : (
                <option value="default">Local Manager Host</option>
              )}
            </select>
            <span className="sidebar-target-meta">
              {selectedRig?.host || selectedRig?.mode || "local"} · {state.isFetching ? "syncing" : "synced"}
            </span>
          </div>
          <div className="sidebar-metrics">
            <div>
              <strong>{state.data?.model_count ?? 0}</strong>
              <span>Models</span>
            </div>
            <div>
              <strong>{state.data?.gpus.length ?? 0}</strong>
              <span>GPUs</span>
            </div>
            <div>
              <strong>{state.data?.job_count ?? 0}</strong>
              <span>Jobs</span>
            </div>
          </div>
          <StatusPill tone={state.data?.config_status.writable ? "ok" : "warn"}>
            {state.data?.config_status.writable ? "config writable" : "config check"}
          </StatusPill>
          <span title={configPath}>{configPath}</span>
        </div>
      </aside>
      <div className="main-column">
        <div className="topbar">
          <div className="topbar-cluster">
            <span className={state.isFetching ? "sync-dot syncing" : "sync-dot"} aria-hidden="true" />
            <span className="topbar-breadcrumb">
              {selectedRig?.name ?? "Selected target"} / <strong>{pageTitle}</strong>
            </span>
          </div>
          <div className="topbar-actions">
            <StatusPill tone={state.isFetching ? "idle" : "ok"}>{syncLabel}</StatusPill>
            <button className="icon-button secondary" type="button" aria-label="Refresh target state" onClick={() => void state.refetch()}>
              <RefreshCw size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

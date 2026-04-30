import { NavLink, Outlet } from "react-router-dom";
import { Activity, CircleHelp, Cpu, FileCode2, Gauge, HardDriveDownload, LayoutDashboard, Settings, Server } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { queryKeys } from "./queryKeys";
import { StatusPill } from "./components/StatusPill";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/import", label: "Import Model", icon: HardDriveDownload },
  { to: "/models", label: "Models", icon: Server },
  { to: "/gpus", label: "GPU Planner", icon: Cpu },
  { to: "/config", label: "Config Preview", icon: FileCode2 },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/help", label: "Help", icon: CircleHelp },
];

export function Layout() {
  const state = useQuery({ queryKey: queryKeys.state, queryFn: api.state, refetchInterval: 15000 });

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
          <StatusPill tone={state.data?.config_status.writable ? "ok" : "warn"}>
            {state.data?.config_status.writable ? "config writable" : "config check"}
          </StatusPill>
          <span>{state.data?.config_status.path ?? "/app/config.yaml"}</span>
        </div>
      </aside>
      <div className="main-column">
        <div className="topbar">
          <div className="topbar-cluster">
            <Activity size={16} aria-hidden="true" />
            <span>{state.isFetching ? "syncing API state" : "API state current"}</span>
          </div>
          <div className="topbar-metrics">
            <span>{state.data?.model_count ?? 0} models</span>
            <span>{state.data?.gpus.length ?? 0} GPUs</span>
            <span>{state.data?.job_count ?? 0} jobs</span>
          </div>
        </div>
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

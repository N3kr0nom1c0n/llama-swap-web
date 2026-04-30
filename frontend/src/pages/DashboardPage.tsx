import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Database, FileCheck2, KeyRound, RefreshCw, Server } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { PageHeader } from "../components/PageHeader";
import { StatusPill } from "../components/StatusPill";
import { queryKeys } from "../queryKeys";

export function DashboardPage() {
  const state = useQuery({ queryKey: queryKeys.state, queryFn: api.state, refetchInterval: 10000 });
  const models = useQuery({ queryKey: queryKeys.models, queryFn: api.models });

  return (
    <div className="page">
      <PageHeader
        title="Dashboard"
        description="Operational status for staged model imports and llama-swap config generation."
        actions={
          <button className="button secondary" onClick={() => void state.refetch()} type="button">
            <RefreshCw size={16} aria-hidden="true" />
            Refresh
          </button>
        }
      />

      <section className="metric-grid">
        <div className="metric">
          <Server size={18} aria-hidden="true" />
          <span>Managed models</span>
          <strong>{state.data?.model_count ?? "..."}</strong>
        </div>
        <div className="metric">
          <Database size={18} aria-hidden="true" />
          <span>Download jobs</span>
          <strong>{state.data?.job_count ?? "..."}</strong>
        </div>
        <div className="metric">
          <FileCheck2 size={18} aria-hidden="true" />
          <span>Config file</span>
          <strong>{state.data?.config_status.exists ? "present" : "missing"}</strong>
        </div>
        <div className="metric">
          <KeyRound size={18} aria-hidden="true" />
          <span>HF token</span>
          <strong>{state.data?.settings.hf_token_configured ? "configured" : "not set"}</strong>
        </div>
      </section>

      <section className="two-column">
        <div className="panel">
          <div className="panel-header">
            <h2>Config Status</h2>
            <StatusPill tone={state.data?.config_status.writable ? "ok" : "warn"}>
              {state.data?.config_status.writable ? "writable" : "needs attention"}
            </StatusPill>
          </div>
          <dl className="detail-list">
            <dt>Path</dt>
            <dd>{state.data?.config_status.path ?? "/app/config.yaml"}</dd>
            <dt>Backup path</dt>
            <dd>{state.data?.settings.backups_dir ?? "/backups"}</dd>
            <dt>Manager model root</dt>
            <dd>{state.data?.settings.manager_model_root ?? "/models"}</dd>
            <dt>Llama-swap model root</dt>
            <dd>{state.data?.settings.llama_swap_model_root ?? "/models"}</dd>
          </dl>
          <div className="inline-actions">
            <Link className="button" to="/config">
              Preview config
            </Link>
            <Link className="button secondary" to="/settings">
              Edit settings
            </Link>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>GPU Inventory</h2>
            <StatusPill tone="idle">{state.data?.gpus.length ?? 0} devices</StatusPill>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>CUDA</th>
                  <th>Name</th>
                  <th>VRAM</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {state.data?.gpus.map((gpu) => (
                  <tr key={gpu.index}>
                    <td>{gpu.index}</td>
                    <td>{gpu.name}</td>
                    <td>{gpu.vram_gb}GB</td>
                    <td>{gpu.role || "unassigned"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Recent Model Entries</h2>
          <Link className="button secondary" to="/models">
            Open models
          </Link>
        </div>
        {models.data?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Role</th>
                  <th>Matrix</th>
                  <th>Primary file</th>
                </tr>
              </thead>
              <tbody>
                {models.data.slice(0, 6).map((model) => (
                  <tr key={model.id}>
                    <td>{model.id}</td>
                    <td>{model.role}</td>
                    <td>{model.matrix_behavior}</td>
                    <td className="truncate">{model.primary_model_file || model.container_files[0] || "not set"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <AlertTriangle size={18} aria-hidden="true" />
            No managed models yet. Start with Import Model or add a manual model entry.
          </div>
        )}
      </section>
    </div>
  );
}

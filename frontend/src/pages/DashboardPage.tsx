import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileCheck2, KeyRound, RefreshCw, Server } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { PageHeader } from "../components/PageHeader";
import { StatusPill } from "../components/StatusPill";
import { jobFilePaths, isJobActive, isJobFailed, isJobReadyForModel } from "../downloadWorkflow";
import { queryKeys } from "../queryKeys";

export function DashboardPage() {
  const state = useQuery({ queryKey: queryKeys.state, queryFn: api.state, refetchInterval: 10000 });
  const models = useQuery({ queryKey: queryKeys.models, queryFn: api.models });
  const downloads = useQuery({
    queryKey: queryKeys.downloads,
    queryFn: api.downloads,
    refetchInterval: (query) => (query.state.data?.some(isJobActive) ? 1500 : 10000),
  });

  const jobs = downloads.data ?? [];
  const readyJobs = jobs.filter((job) => isJobReadyForModel(job, models.data));
  const activeJobs = jobs.filter(isJobActive);
  const failedJobs = jobs.filter(isJobFailed);
  const actionNeeded = readyJobs.length + failedJobs.length + (state.data?.config_status.writable === false ? 1 : 0);

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
          <AlertTriangle size={18} aria-hidden="true" />
          <span>Action needed</span>
          <strong>{downloads.isLoading || models.isLoading || state.isLoading ? "..." : actionNeeded}</strong>
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

      <section className="panel">
        <div className="panel-header">
          <h2>Next Actions</h2>
          <StatusPill tone={actionNeeded ? "warn" : activeJobs.length ? "idle" : "ok"}>
            {actionNeeded ? `${actionNeeded} waiting` : activeJobs.length ? "downloads active" : "clear"}
          </StatusPill>
        </div>
        <div className="action-list">
          {readyJobs.map((downloadJob) => (
            <div className="action-card" key={downloadJob.id}>
              <div>
                <strong>Downloaded but not configured</strong>
                <span>{downloadJob.repo_id || downloadJob.id}</span>
                <code>{jobFilePaths(downloadJob)[0]}</code>
              </div>
              <Link className="button" to={`/import?job=${encodeURIComponent(downloadJob.id)}`}>
                Finish setup
              </Link>
            </div>
          ))}
          {failedJobs.map((downloadJob) => (
            <div className="action-card warn" key={downloadJob.id}>
              <div>
                <strong>{downloadJob.status === "cancelled" ? "Cancelled download" : "Failed download"}</strong>
                <span>{downloadJob.repo_id || downloadJob.id}</span>
                <code>{downloadJob.error || "Open Import Model to retry or remove this job."}</code>
              </div>
              <Link className="button secondary" to="/import">
                Fix failed download
              </Link>
            </div>
          ))}
          {activeJobs.map((downloadJob) => (
            <div className="action-card" key={downloadJob.id}>
              <div>
                <strong>Active download</strong>
                <span>{downloadJob.repo_id || downloadJob.id}</span>
                <code>{Math.round(downloadJob.progress || 0)}% {downloadJob.active_file || "queued"}</code>
              </div>
              <Link className="button secondary" to="/import">
                Open queue
              </Link>
            </div>
          ))}
          {state.data?.config_status.writable === false ? (
            <div className="action-card warn">
              <div>
                <strong>Config path needs write access</strong>
                <span>{state.data.config_status.path}</span>
                <code>Mount the manager config path writable before applying generated YAML.</code>
              </div>
              <Link className="button secondary" to="/settings">
                Review settings
              </Link>
            </div>
          ) : null}
          {!readyJobs.length && !failedJobs.length && !activeJobs.length && state.data?.config_status.writable !== false ? (
            <div className="action-card ok">
              <div>
                <strong>{models.data?.length ? "Ready to preview config" : "Start model setup"}</strong>
                <span>{models.data?.length ? "Managed entries exist and no download needs handoff." : "Resolve HF files, upload GGUFs, or scan files already in /models."}</span>
              </div>
              <Link className="button" to={models.data?.length ? "/config" : "/import"}>
                {models.data?.length ? "Preview config" : "Import Model"}
              </Link>
            </div>
          ) : null}
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
            <CheckCircle2 size={18} aria-hidden="true" />
            No managed models yet. Start with Import Model or add a manual model entry.
          </div>
        )}
      </section>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FileWarning, Power, RefreshCw, RotateCcw, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { CodeBlock } from "../components/CodeBlock";
import { PageHeader } from "../components/PageHeader";
import { StatusPill } from "../components/StatusPill";
import { queryKeys } from "../queryKeys";

export function ConfigPreviewPage() {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmDestructive, setConfirmDestructive] = useState(false);
  const models = useQuery({ queryKey: queryKeys.models, queryFn: api.models });
  const backups = useQuery({ queryKey: queryKeys.configBackups, queryFn: api.configBackups });
  const runtime = useQuery({
    queryKey: queryKeys.llamaSwapStatus,
    queryFn: api.llamaSwapStatus,
    refetchInterval: 10000,
  });
  const preview = useQuery({
    queryKey: [...queryKeys.preview, selectedIds],
    queryFn: () => api.previewConfig(selectedIds),
  });
  const apply = useMutation({
    mutationFn: () => {
      if (!preview.data?.stage_id) throw new Error("Regenerate a valid preview before applying.");
      return api.applyConfig(preview.data.stage_id, confirmDestructive);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.state });
      void queryClient.invalidateQueries({ queryKey: queryKeys.preview });
    },
  });
  const restore = useMutation({
    mutationFn: api.restoreConfig,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.state });
      void queryClient.invalidateQueries({ queryKey: queryKeys.preview });
      void queryClient.invalidateQueries({ queryKey: queryKeys.configBackups });
    },
  });
  const restart = useMutation({
    mutationFn: api.restartLlamaSwap,
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.llamaSwapStatus, data.status);
      void queryClient.invalidateQueries({ queryKey: queryKeys.llamaSwapStatus });
    },
  });
  const destructiveChanges = preview.data?.destructive_changes ?? [];
  const runtimeStatus = runtime.data;

  useEffect(() => {
    setConfirmDestructive(false);
  }, [preview.data?.stage_id]);

  function toggleModel(id: string) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  return (
    <div className="page">
      <PageHeader
        title="Config Preview"
        description="Validate generated llama-swap YAML, inspect diff, back up, and apply staged config."
        actions={
          <>
            <button className="button secondary" onClick={() => void preview.refetch()} type="button">
              <RefreshCw size={16} aria-hidden="true" />
              Regenerate
            </button>
            <button
              className="button"
              onClick={() => apply.mutate()}
              disabled={!preview.data?.valid || !preview.data.stage_id || apply.isPending || (destructiveChanges.length > 0 && !confirmDestructive)}
              type="button"
            >
              <Check size={16} aria-hidden="true" />
              Apply Config
            </button>
          </>
        }
      />

      <section className="panel">
        <div className="panel-header">
          <h2>Model Scope</h2>
          <StatusPill tone={preview.data?.valid ? "ok" : "bad"}>{preview.data?.valid ? "valid" : "blocked"}</StatusPill>
        </div>
        <div className="model-selector">
          {models.data?.map((model) => (
            <label key={model.id} className="check-row">
              <input type="checkbox" checked={selectedIds.includes(model.id)} onChange={() => toggleModel(model.id)} />
              <span>{model.id}</span>
              <small>{model.role}</small>
            </label>
          ))}
          {!models.data?.length ? <span className="muted">No models saved yet. Preview will render the current generated base.</span> : null}
        </div>
        <p className="field-hint">Leave all unchecked to preview every managed model.</p>
        {preview.data?.stage_id ? <p className="field-hint">Staged preview id: {preview.data.stage_id}</p> : null}
      </section>

      {preview.data?.errors.length ? (
        <section className="alert-panel bad">
          <FileWarning size={18} aria-hidden="true" />
          <div>
            <strong>Validation errors</strong>
            <ul>
              {preview.data.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {preview.data?.warnings.length ? (
        <section className="alert-panel warn">
          <FileWarning size={18} aria-hidden="true" />
          <div>
            <strong>Warnings</strong>
            <ul>
              {preview.data.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {destructiveChanges.length ? (
        <section className="alert-panel bad">
          <FileWarning size={18} aria-hidden="true" />
          <div>
            <strong>Destructive changes require confirmation</strong>
            <p>This preview removes existing config content. Review the diff before applying.</p>
            <ul>
              {destructiveChanges.map((change) => (
                <li key={`${change.kind}-${change.path}`}>
                  {change.kind}: {change.path} removes {change.before}
                </li>
              ))}
            </ul>
            <label className="check-row">
              <input type="checkbox" checked={confirmDestructive} onChange={(event) => setConfirmDestructive(event.target.checked)} />
              <span>I reviewed the removals and want to apply this destructive config.</span>
            </label>
          </div>
        </section>
      ) : null}

      <section className="split-code">
        <CodeBlock label="Generated YAML" value={preview.data?.yaml ?? ""} minRows={22} />
        <CodeBlock label="Diff" value={preview.data?.diff ?? ""} minRows={22} />
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>llama-swap Runtime</h2>
          <StatusPill tone={runtimeTone(runtimeStatus)}>
            {runtime.isLoading ? "checking" : runtimeLabel(runtimeStatus)}
          </StatusPill>
        </div>
        <div className="runtime-card">
          <div>
            <strong>{runtimeStatus?.container_name || "llama-swap"}</strong>
            <span>{runtimeStatus?.enabled ? `Docker socket: ${runtimeStatus.socket_path}` : "Restart control is disabled in Settings."}</span>
            {runtimeStatus?.status ? <small>Container status: {runtimeStatus.status}</small> : null}
            {runtimeStatus?.error ? <small className="danger-text">{runtimeStatus.error}</small> : null}
          </div>
          <button
            className="button danger"
            type="button"
            onClick={() => restart.mutate()}
            disabled={!runtimeStatus?.enabled || !runtimeStatus.available || restart.isPending}
          >
            <Power size={16} aria-hidden="true" />
            Restart llama-swap
          </button>
        </div>
        <p className="field-hint">
          <ShieldAlert size={14} aria-hidden="true" />
          {runtimeStatus?.warning || "Docker socket access can control this host. Enable this only for the trusted manager container."}
        </p>
        {restart.data ? <p className="form-success">{restart.data.message}</p> : null}
        {restart.error ? <p className="form-error">{restart.error.message}</p> : null}
        {runtime.error ? <p className="form-error">{runtime.error.message}</p> : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Backups</h2>
          <button className="button secondary" type="button" onClick={() => void backups.refetch()} disabled={backups.isFetching}>
            <RefreshCw size={16} aria-hidden="true" />
            Refresh
          </button>
        </div>
        <div className="row-list">
          {backups.data?.map((backup) => (
            <div className="inventory-card" key={backup.name}>
              <div>
                <strong>{backup.name}</strong>
                <span>
                  {formatBytes(backup.size)} · {formatDate(backup.modified)}
                </span>
                <small>{backup.path}</small>
              </div>
              <button className="button secondary" type="button" onClick={() => restore.mutate(backup.name)} disabled={restore.isPending}>
                <RotateCcw size={16} aria-hidden="true" />
                Restore {backup.name}
              </button>
            </div>
          ))}
          {!backups.data?.length ? <span className="muted">No config backups found yet. Applying or restoring config creates backups here.</span> : null}
        </div>
        {backups.error ? <p className="form-error">{backups.error.message}</p> : null}
        {restore.error ? <p className="form-error">{restore.error.message}</p> : null}
      </section>

      {apply.data ? (
        <section className="alert-panel ok">
          <Check size={18} aria-hidden="true" />
          <div>
            <strong>Config applied with backup</strong>
            <p>{apply.data.backup}</p>
            <code>{apply.data.restart_note}</code>
          </div>
        </section>
      ) : null}
      {restore.data ? (
        <section className="alert-panel ok">
          <RotateCcw size={18} aria-hidden="true" />
          <div>
            <strong>Config restored from backup</strong>
            <p>{restore.data.current_backup}</p>
            <code>{restore.data.restart_note}</code>
          </div>
        </section>
      ) : null}
      {apply.error ? <p className="form-error">{apply.error.message}</p> : null}
    </div>
  );
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function runtimeTone(status: { enabled?: boolean; available?: boolean; running?: boolean } | undefined) {
  if (!status?.enabled) return "warn";
  if (!status.available) return "bad";
  return status.running ? "ok" : "warn";
}

function runtimeLabel(status: { enabled?: boolean; available?: boolean; running?: boolean; status?: string } | undefined) {
  if (!status?.enabled) return "disabled";
  if (!status.available) return "unavailable";
  return status.status || (status.running ? "running" : "stopped");
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FilePlus2, Link2, RotateCcw, Save, Upload, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../api";
import { CodeBlock } from "../components/CodeBlock";
import { Field } from "../components/Field";
import { PageHeader } from "../components/PageHeader";
import { JobStatusPill, StatusPill } from "../components/StatusPill";
import { queryKeys } from "../queryKeys";
import type { DownloadJob, HfFile, ManagedModel, ModelRole } from "../types";
import { emptyModel, modelRoles } from "../types";
import { defaultTtlForRole, modelCommand, safeMatrixKey } from "../utils";

export function ImportModelPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: api.settings });
  const gpus = useQuery({ queryKey: queryKeys.gpus, queryFn: api.gpus });
  const [role, setRole] = useState<ModelRole>("chat");
  const [hfUrl, setHfUrl] = useState("");
  const [revision, setRevision] = useState("main");
  const [desiredName, setDesiredName] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [gpuDevices, setGpuDevices] = useState<number[]>([]);
  const [draft, setDraft] = useState<ManagedModel>(emptyModel());
  const [lastJobId, setLastJobId] = useState("");
  const jobs = useQuery({
    queryKey: ["downloads"],
    queryFn: api.downloads,
    refetchInterval: (query) => (query.state.data?.some((item) => item.status === "running" || item.status === "queued") ? 1500 : false),
  });

  const resolve = useMutation({
    mutationFn: () => api.resolveHf(hfUrl, revision || settings.data?.default_revision || "main"),
    onSuccess: (data) => {
      setSelectedFiles(data.files.filter((file) => file.selected).map((file) => file.path));
      setDraft((current) => ({
        ...current,
        id: desiredName || data.repo_id.split("/").pop()?.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "",
        display_name: desiredName || data.repo_id.split("/").pop() || "",
        role,
        source_type: "hf",
        hf_url: hfUrl,
        hf_revision: data.revision,
        ttl: defaultTtlForRole(settings.data, role),
        matrix_key: safeMatrixKey(desiredName || data.repo_id.split("/").pop() || ""),
      }));
    },
  });

  const createImport = useMutation({ mutationFn: api.createImport });
  const download = useMutation({
    mutationFn: async () => {
      const importDraft = await api.createImport({
        role,
        source_type: "hf",
        hf_url: hfUrl,
        hf_revision: revision,
        selected_files: selectedFiles,
        desired_name: desiredName,
        gpu_devices: gpuDevices,
      });
      return api.startDownload({
        repo_id: resolve.data?.repo_id ?? hfUrl,
        revision: resolve.data?.revision ?? revision,
        files: selectedFiles,
        destination_dir: importDraft.destination_dir,
        model_id: draft.id,
      });
    },
    onSuccess: (job) => {
      setLastJobId(job.id);
      void queryClient.invalidateQueries({ queryKey: ["downloads"] });
    },
  });
  const job = useQuery({
    queryKey: ["download", lastJobId],
    queryFn: () => api.download(lastJobId),
    enabled: Boolean(lastJobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "queued" ? 1500 : false;
    },
  });
  const saveModel = useMutation({
    mutationFn: api.saveModel,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.models });
      void queryClient.invalidateQueries({ queryKey: queryKeys.state });
    },
  });
  const cancelJob = useMutation({
    mutationFn: api.cancelDownload,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["downloads"] });
      if (lastJobId) void queryClient.invalidateQueries({ queryKey: ["download", lastJobId] });
    },
  });
  const retryJob = useMutation({
    mutationFn: api.retryDownload,
    onSuccess: (newJob) => {
      setLastJobId(newJob.id);
      void queryClient.invalidateQueries({ queryKey: ["downloads"] });
    },
  });
  const upload = useMutation({
    mutationFn: async (file: File) => api.upload(role, file),
    onSuccess: (data) => {
      const fileName = data.container_path.split("/").pop() || "uploaded-model";
      setDraft((current) => ({
        ...current,
        id: current.id || fileName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-gguf$/, ""),
        display_name: current.display_name || fileName,
        role,
        source_type: "upload",
        manager_files: [...current.manager_files, data.manager_path],
        container_files: [...current.container_files, data.container_path],
        primary_model_file: current.primary_model_file || data.container_path,
        ttl: defaultTtlForRole(settings.data, role),
      }));
    },
  });

  const selectedHfFiles = useMemo(() => resolve.data?.files.filter((file) => selectedFiles.includes(file.path)) ?? [], [resolve.data, selectedFiles]);
  const command = modelCommand({ ...draft, gpu_devices: gpuDevices }, settings.data);

  function toggleFile(file: HfFile) {
    setSelectedFiles((current) => (current.includes(file.path) ? current.filter((item) => item !== file.path) : [...current, file.path]));
  }

  function saveDraft() {
    const completedJob = job.data?.status === "completed" ? job.data : null;
    const managerFiles = completedJob?.written_files?.length ? completedJob.written_files : draft.manager_files;
    const containerFiles = completedJob?.container_files?.length ? completedJob.container_files : draft.container_files;
    saveModel.mutate({
      ...draft,
      role,
      source_type: draft.source_type === "manual" ? "hf" : draft.source_type,
      hf_url: hfUrl,
      hf_revision: revision,
      gpu_devices: gpuDevices,
      manager_files: managerFiles,
      container_files: containerFiles,
      primary_model_file: draft.primary_model_file || containerFiles.find((path) => path.toLowerCase().endsWith(".gguf")) || containerFiles[0] || "",
    });
  }

  return (
    <div className="page">
      <PageHeader title="Import Model" description="Resolve Hugging Face files, stage rig-side downloads, upload local GGUFs, and create a draft model entry." />

      <section className="panel">
        <div className="panel-header">
          <h2>Source</h2>
          <StatusPill tone={settings.data?.hf_token_configured ? "ok" : "warn"}>{settings.data?.hf_token_configured ? "HF token configured" : "public repos only"}</StatusPill>
        </div>
        <div className="form-grid">
          <Field label="Role">
            <select value={role} onChange={(event) => setRole(event.target.value as ModelRole)}>
              {modelRoles.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Desired name">
            <input value={desiredName} onChange={(event) => setDesiredName(event.target.value)} placeholder="gpt-oss-20b" />
          </Field>
          <Field label="Hugging Face URL">
            <input value={hfUrl} onChange={(event) => setHfUrl(event.target.value)} placeholder="https://huggingface.co/org/repo" />
          </Field>
          <Field label="Revision">
            <input value={revision} onChange={(event) => setRevision(event.target.value)} />
          </Field>
        </div>
        <div className="inline-actions">
          <button className="button" type="button" onClick={() => resolve.mutate()} disabled={!hfUrl || resolve.isPending}>
            <Link2 size={16} aria-hidden="true" />
            Resolve Files
          </button>
          <label className="button secondary file-button">
            <Upload size={16} aria-hidden="true" />
            Upload GGUF
            <input type="file" accept=".gguf,.jinja,.json,.txt" onChange={(event) => event.target.files?.[0] && upload.mutate(event.target.files[0])} />
          </label>
        </div>
        {resolve.error ? <p className="form-error">{resolve.error.message}</p> : null}
        {upload.error ? <p className="form-error">{upload.error.message}</p> : null}
      </section>

      {resolve.data ? (
        <section className="panel">
          <div className="panel-header">
            <h2>Resolved Files</h2>
            <StatusPill tone="idle">{resolve.data.repo_id}@{resolve.data.revision}</StatusPill>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Path</th>
                  <th>Kind</th>
                  <th>Group</th>
                </tr>
              </thead>
              <tbody>
                {resolve.data.files.map((file) => (
                  <tr key={file.path}>
                    <td>
                      <input type="checkbox" checked={selectedFiles.includes(file.path)} onChange={() => toggleFile(file)} />
                    </td>
                    <td className="truncate">{file.path}</td>
                    <td>{file.kind}</td>
                    <td>{file.group || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="inline-actions">
            <button className="button" type="button" onClick={() => createImport.mutate({ role, source_type: "hf", hf_url: hfUrl, hf_revision: revision, selected_files: selectedFiles, desired_name: desiredName, gpu_devices: gpuDevices })}>
              <FilePlus2 size={16} aria-hidden="true" />
              Stage Import
            </button>
            <button className="button secondary" type="button" onClick={() => download.mutate()} disabled={!selectedFiles.length || download.isPending}>
              <Download size={16} aria-hidden="true" />
              Start Download
            </button>
          </div>
          {createImport.data ? <p className="form-success">Destination: {createImport.data.destination_dir}</p> : null}
          {download.error ? <p className="form-error">{download.error.message}</p> : null}
        </section>
      ) : null}

      {lastJobId ? (
        <section className="panel">
          <div className="panel-header">
            <h2>Download Job</h2>
            {job.data ? <JobStatusPill status={job.data.status} /> : null}
          </div>
          <div className="progress-track">
            <span style={{ width: `${Math.min(100, Math.max(0, job.data?.progress ?? 0))}%` }} />
          </div>
          <CodeBlock label="Job logs" value={job.data?.logs.join("\n") ?? ""} minRows={6} />
          {job.data?.error ? <p className="form-error">{job.data.error}</p> : null}
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <h2>Download Queue</h2>
          <StatusPill tone="idle">{jobs.data?.length ?? 0} jobs</StatusPill>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                  <th>Repo</th>
                  <th>Files</th>
                  <th>Progress</th>
                  <th>Destination</th>
                  <th>Actions</th>
                </tr>
            </thead>
            <tbody>
              {jobs.data?.map((queuedJob) => (
                <tr key={queuedJob.id}>
                  <td><JobStatusPill status={queuedJob.status} /></td>
                  <td>{queuedJob.repo_id || "-"}</td>
                  <td>{queuedJob.files.length}</td>
                  <td>
                    <QueueProgress job={queuedJob} />
                  </td>
                  <td className="truncate">{queuedJob.destination_dir}</td>
                  <td>
                    <div className="inline-actions compact">
                      <button className="button secondary" type="button" disabled={!["queued", "running"].includes(queuedJob.status)} onClick={() => cancelJob.mutate(queuedJob.id)}>
                        <XCircle size={14} aria-hidden="true" />
                        Cancel
                      </button>
                      <button className="button secondary" type="button" disabled={!["failed", "cancelled"].includes(queuedJob.status)} onClick={() => retryJob.mutate(queuedJob.id)}>
                        <RotateCcw size={14} aria-hidden="true" />
                        Retry
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Draft Model</h2>
          <button className="button" type="button" disabled={!draft.id || saveModel.isPending} onClick={saveDraft}>
            <Save size={16} aria-hidden="true" />
            Save Draft
          </button>
        </div>
        <div className="form-grid">
          <Field label="Model ID">
            <input value={draft.id} onChange={(event) => setDraft((current) => ({ ...current, id: event.target.value, matrix_key: current.matrix_key || safeMatrixKey(event.target.value) }))} />
          </Field>
          <Field label="Display name">
            <input value={draft.display_name} onChange={(event) => setDraft((current) => ({ ...current, display_name: event.target.value }))} />
          </Field>
          <Field label="Matrix key">
            <input value={draft.matrix_key} onChange={(event) => setDraft((current) => ({ ...current, matrix_key: event.target.value }))} />
          </Field>
          <Field label="CUDA devices">
            <div className="check-cluster">
              {gpus.data?.map((gpu) => (
                <label className="check-chip" key={gpu.index}>
                  <input
                    type="checkbox"
                    checked={gpuDevices.includes(gpu.index)}
                    onChange={() => setGpuDevices((current) => (current.includes(gpu.index) ? current.filter((item) => item !== gpu.index) : [...current, gpu.index]))}
                  />
                  {gpu.index}: {gpu.name}
                </label>
              ))}
            </div>
          </Field>
        </div>
        <div className="selected-files">
          {selectedHfFiles.map((file) => (
            <span key={file.path}>{file.kind}: {file.path}</span>
          ))}
        </div>
        <CodeBlock label="Generated command preview" value={command} minRows={4} />
        {saveModel.error ? <p className="form-error">{saveModel.error.message}</p> : null}
        {saveModel.isSuccess ? <p className="form-success">Draft model saved. Review matrix and config preview next.</p> : null}
      </section>
    </div>
  );
}

function QueueProgress({ job }: { job: DownloadJob }) {
  const repo = job.repo_id || job.id;
  const value = Math.min(100, Math.max(0, Math.round(job.progress || 0)));
  const hasBytes = job.bytes_total > 0;
  return (
    <div className="queue-progress">
      <div className="queue-progress-main">
        <div
          className="queue-progress-track"
          role="progressbar"
          aria-label={`Download progress for ${repo}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={value}
        >
          <span style={{ width: `${value}%` }} />
        </div>
        {hasBytes ? <span className="queue-progress-detail">{formatBytes(job.bytes_downloaded)} / {formatBytes(job.bytes_total)}</span> : null}
        {job.active_file ? <span className="queue-progress-detail truncate">{job.active_file}</span> : null}
      </div>
      <span className="queue-progress-value">{value}%</span>
    </div>
  );
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const precision = index === 0 || size >= 10 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[index]}`;
}

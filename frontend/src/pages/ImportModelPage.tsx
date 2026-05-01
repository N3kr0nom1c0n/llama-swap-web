import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileCheck2, FilePlus2, FolderSearch, Link2, RotateCcw, Save, Upload, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { CodeBlock } from "../components/CodeBlock";
import { Field } from "../components/Field";
import { PageHeader } from "../components/PageHeader";
import { JobStatusPill, StatusPill } from "../components/StatusPill";
import {
  formatBytes,
  isJobActive,
  isJobManaged,
  isJobReadyForModel,
  isTerminalJob,
  jobFilePaths,
  managedModelFromInventoryItem,
} from "../downloadWorkflow";
import { queryKeys } from "../queryKeys";
import { useTargetRig } from "../targetRigContext";
import type { DownloadJob, FileInventoryItem, HfFile, ManagedModel, ModelRole } from "../types";
import { emptyModel, modelRoles } from "../types";
import { defaultTtlForRole, modelCommand, safeMatrixKey } from "../utils";

export function ImportModelPage() {
  const queryClient = useQueryClient();
  const { targetRigId, selectedRig } = useTargetRig();
  const [searchParams] = useSearchParams();
  const focusedJobId = searchParams.get("job") ?? "";
  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: api.settings });
  const gpus = useQuery({ queryKey: queryKeys.gpusFor(targetRigId), queryFn: () => api.gpus(targetRigId) });
  const models = useQuery({ queryKey: queryKeys.modelsFor(targetRigId), queryFn: () => api.models(targetRigId) });
  const [role, setRole] = useState<ModelRole>("chat");
  const [hfUrl, setHfUrl] = useState("");
  const [revision, setRevision] = useState("main");
  const [desiredName, setDesiredName] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [gpuDevices, setGpuDevices] = useState<number[]>([]);
  const [draft, setDraft] = useState<ManagedModel>(emptyModel());
  const [lastJobId, setLastJobId] = useState("");
  const [installMessage, setInstallMessage] = useState("");
  const [scanMessage, setScanMessage] = useState("");
  const jobs = useQuery({
    queryKey: queryKeys.downloadsFor(targetRigId),
    queryFn: () => api.downloads(targetRigId),
    refetchInterval: (query) => (query.state.data?.some(isJobActive) ? 1500 : false),
  });

  const resolve = useMutation({
    mutationFn: () => api.resolveHf(hfUrl, revision || settings.data?.default_revision || "main"),
    onSuccess: (data) => {
      setSelectedFiles([]);
      setDraft((current) => ({
        ...current,
        target_rig_id: targetRigId,
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
        target_rig_id: targetRigId,
        role,
        source_type: "hf",
        hf_url: hfUrl,
        hf_revision: revision,
        selected_files: selectedFiles,
        desired_name: currentDesiredName(),
        gpu_devices: gpuDevices,
      });
      return api.startDownload({
        target_rig_id: targetRigId,
        repo_id: resolve.data?.repo_id ?? hfUrl,
        revision: resolve.data?.revision ?? revision,
        files: selectedFiles,
        destination_dir: importDraft.destination_dir,
        model_id: draft.id || currentDesiredName(),
      });
    },
    onSuccess: (job) => {
      setLastJobId(job.id);
      void queryClient.invalidateQueries({ queryKey: queryKeys.downloadsFor(targetRigId) });
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.modelsFor(targetRigId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stateFor(targetRigId) });
    },
  });
  const saveScannedModel = useMutation({
    mutationFn: api.saveModel,
    onSuccess: (model) => {
      setDraft(model);
      setScanMessage(`Managed model ${model.id} created from existing file. Preview config when ready.`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.modelsFor(targetRigId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stateFor(targetRigId) });
    },
  });
  const installModel = useMutation({
    mutationFn: ({ downloadJob, includeDraftContext }: { downloadJob: DownloadJob; includeDraftContext: boolean }) =>
      api.createModelFromDownload(downloadJob.id, modelFromDownloadPayload(includeDraftContext)),
    onSuccess: (model) => {
      setDraft(model);
      setRole(model.role);
      setGpuDevices(model.gpu_devices);
      setHfUrl(model.hf_url);
      setRevision(model.hf_revision);
      setInstallMessage(`Managed model ${model.id} created. Next: tune it or preview config.`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.modelsFor(targetRigId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stateFor(targetRigId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.downloadsFor(targetRigId) });
    },
  });
  const cancelJob = useMutation({
    mutationFn: api.cancelDownload,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.downloadsFor(targetRigId) });
      if (lastJobId) void queryClient.invalidateQueries({ queryKey: ["download", lastJobId] });
    },
  });
  const retryJob = useMutation({
    mutationFn: api.retryDownload,
    onSuccess: (newJob) => {
      setLastJobId(newJob.id);
      void queryClient.invalidateQueries({ queryKey: queryKeys.downloadsFor(targetRigId) });
    },
  });
  const cleanupJobs = useMutation({
    mutationFn: () => api.cleanupTerminalDownloads(targetRigId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.downloadsFor(targetRigId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stateFor(targetRigId) });
    },
  });
  const scanExisting = useMutation({ mutationFn: () => api.scanModels(targetRigId) });
  const upload = useMutation({
    mutationFn: async (file: File) => api.upload(role, file, targetRigId),
    onSuccess: (data) => {
      const fileName = data.container_path.split("/").pop() || "uploaded-model";
      setDraft((current) => ({
        ...current,
        target_rig_id: targetRigId,
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
  const command = modelCommand({ ...draft, target_rig_id: targetRigId, gpu_devices: gpuDevices }, settings.data);
  const sortedJobs = useMemo(() => {
    const list = jobs.data ?? [];
    if (!focusedJobId) return list;
    return [...list].sort((left, right) => Number(right.id === focusedJobId) - Number(left.id === focusedJobId));
  }, [focusedJobId, jobs.data]);
  const readyJobs = sortedJobs.filter((item) => isJobReadyForModel(item, models.data));
  const activeJobs = sortedJobs.filter(isJobActive);
  const terminalJobCount = sortedJobs.filter(isTerminalJob).length;
  const scannedItems = scanExisting.data ?? [];

  function toggleFile(file: HfFile) {
    setSelectedFiles((current) => (current.includes(file.path) ? current.filter((item) => item !== file.path) : [...current, file.path]));
  }

  function currentDesiredName() {
    return desiredName || draft.display_name || draft.id || resolve.data?.repo_id.split("/").pop() || "";
  }

  function saveDraft() {
    const completedJob = job.data?.status === "completed" ? job.data : null;
    const managerFiles = completedJob?.written_files?.length ? completedJob.written_files : draft.manager_files;
    const containerFiles = completedJob?.container_files?.length ? completedJob.container_files : draft.container_files;
    saveModel.mutate({
      ...draft,
      target_rig_id: targetRigId,
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

  function modelFromDownloadPayload(includeDraftContext: boolean) {
    if (!includeDraftContext) {
      return {};
    }
    const payload = {
      id: draft.id,
      display_name: draft.display_name || desiredName,
      aliases: draft.aliases,
      ttl: draft.id || draft.display_name ? draft.ttl : undefined,
      gpu_devices: gpuDevices,
      main_gpu: draft.main_gpu,
      tensor_split: draft.tensor_split,
      matrix_key: draft.matrix_key,
      matrix_behavior: draft.matrix_behavior,
      matrix_expression: draft.matrix_expression,
      evict_cost: draft.evict_cost,
      startup_preload: draft.startup_preload,
      target_rig_id: targetRigId,
    };
    return { ...payload, role };
  }

  function installDownloadedModel(downloadJob: DownloadJob, includeDraftContext = false) {
    setInstallMessage("");
    installModel.mutate({ downloadJob, includeDraftContext });
  }

  function createModelFromScan(item: FileInventoryItem) {
    const model = { ...managedModelFromInventoryItem(item, settings.data), target_rig_id: targetRigId };
    setScanMessage("");
    saveScannedModel.mutate(model);
  }

  return (
    <div className="page">
      <PageHeader title="Import Model" description={`Resolve Hugging Face files and place them directly on ${selectedRig?.name ?? "the selected target rig"}.`} />

      <section className="panel">
        <div className="panel-header">
          <h2>Import Pipeline</h2>
          <StatusPill tone={readyJobs.length ? "warn" : activeJobs.length ? "idle" : "ok"}>
            {readyJobs.length ? `${readyJobs.length} ready to configure` : activeJobs.length ? "downloading" : "ready"}
          </StatusPill>
        </div>
        <div className="pipeline-steps">
          <PipelineStep title="1. Source" state={resolve.data || upload.data ? "done" : "current"} detail={resolve.data?.repo_id || (upload.data ? "uploaded file" : "HF URL, upload, or existing file scan")} />
          <PipelineStep title="2. Files" state={selectedFiles.length || draft.container_files.length ? "done" : "idle"} detail={selectedFiles.length ? `${selectedFiles.length} selected` : draft.container_files.length ? `${draft.container_files.length} local file(s)` : "choose the GGUF and support files"} />
          <PipelineStep title="3. Download" state={activeJobs.length ? "current" : readyJobs.length ? "done" : "idle"} detail={activeJobs.length ? `${activeJobs.length} active` : readyJobs.length ? "download complete" : "rig-side transfer"} />
          <PipelineStep title="4. Managed Model" state={installModel.data || saveModel.isSuccess || saveScannedModel.data ? "done" : readyJobs.length ? "current" : "idle"} detail={installModel.data || saveModel.isSuccess || saveScannedModel.data ? "entry created" : readyJobs.length ? "create the model entry" : "not configured yet"} />
          <PipelineStep title="5. Config" state={installModel.data || saveModel.isSuccess || saveScannedModel.data ? "current" : "idle"} detail="preview, validate, backup, apply" />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Ready Downloads</h2>
          <StatusPill tone={readyJobs.length ? "warn" : "idle"}>{readyJobs.length ? `${readyJobs.length} need setup` : "none waiting"}</StatusPill>
        </div>
        {readyJobs.length ? (
          <div className="action-list">
            {readyJobs.map((downloadJob) => (
              <div className="action-card" key={downloadJob.id}>
                <div>
                  <strong>Ready to configure</strong>
                  <span>{downloadJob.repo_id || downloadJob.id}</span>
                  <div className="path-list">
                    {jobFilePaths(downloadJob).map((path) => (
                      <code key={path}>{path}</code>
                    ))}
                  </div>
                </div>
                <button className="button" type="button" disabled={installModel.isPending} onClick={() => installDownloadedModel(downloadJob)}>
                  <FileCheck2 size={16} aria-hidden="true" />
                  Create Managed Model
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            Completed downloads that are not connected to a managed model will appear here. That is the handoff before Config Preview.
          </div>
        )}
      </section>

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
          <button className="button secondary" type="button" onClick={() => scanExisting.mutate()} disabled={scanExisting.isPending}>
            <FolderSearch size={16} aria-hidden="true" />
            Scan Existing Files
          </button>
          <label className="button secondary file-button">
            <Upload size={16} aria-hidden="true" />
            Upload GGUF
            <input type="file" accept=".gguf,.jinja,.json,.txt" onChange={(event) => event.target.files?.[0] && upload.mutate(event.target.files[0])} />
          </label>
        </div>
        {resolve.error ? <p className="form-error">{resolve.error.message}</p> : null}
        {upload.error ? <p className="form-error">{upload.error.message}</p> : null}
        {scanExisting.error ? <p className="form-error">{scanExisting.error.message}</p> : null}
        {scanMessage ? <p className="form-success">{scanMessage}</p> : null}
      </section>

      {scannedItems.length ? (
        <section className="panel">
          <div className="panel-header">
            <h2>Files Already On Disk</h2>
            <StatusPill tone="idle">{scannedItems.length} files</StatusPill>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Path</th>
                  <th>Kind</th>
                  <th>Size</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {scannedItems.map((item) => (
                  <tr key={item.container_path}>
                    <td className="truncate">{item.relative_path}</td>
                    <td>{item.kind}</td>
                    <td>{formatBytes(item.size)}</td>
                    <td>
                      <button
                        className="button secondary"
                        type="button"
                        aria-label={`Create model from ${item.relative_path}`}
                        disabled={item.kind !== "gguf" || saveScannedModel.isPending}
                        onClick={() => createModelFromScan(item)}
                      >
                        Create model
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

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
            <button className="button" type="button" onClick={() => createImport.mutate({ target_rig_id: targetRigId, role, source_type: "hf", hf_url: hfUrl, hf_revision: revision, selected_files: selectedFiles, desired_name: currentDesiredName(), gpu_devices: gpuDevices })}>
              <FilePlus2 size={16} aria-hidden="true" />
              Preview Destination
            </button>
            <button className="button secondary" type="button" onClick={() => download.mutate()} disabled={!selectedFiles.length || download.isPending}>
              <Download size={16} aria-hidden="true" />
              Start Download
            </button>
          </div>
          {createImport.data ? <p className="form-success">Target rig destination: {createImport.data.destination_dir}</p> : null}
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
          {job.data?.status === "completed" ? (
            <div className="inline-actions">
              <button className="button" type="button" disabled={installModel.isPending} onClick={() => installDownloadedModel(job.data as DownloadJob, true)}>
                <FileCheck2 size={16} aria-hidden="true" />
                Create Managed Model
              </button>
            </div>
          ) : null}
          {job.data?.error ? <p className="form-error">{job.data.error}</p> : null}
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <h2>Download Queue</h2>
          <div className="inline-actions">
            <StatusPill tone="idle">{jobs.data?.length ?? 0} jobs</StatusPill>
            <button className="button secondary" type="button" disabled={!terminalJobCount || cleanupJobs.isPending} onClick={() => cleanupJobs.mutate()}>
              Clear Finished
            </button>
          </div>
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
              {sortedJobs.map((queuedJob) => (
                <tr key={queuedJob.id}>
                  <td><JobStatusPill status={queuedJob.status} /></td>
                  <td>{queuedJob.repo_id || "-"}</td>
                  <td>{queuedJob.files.length}</td>
                  <td>
                    <QueueProgress job={queuedJob} />
                  </td>
                  <td className="truncate">
                    <span>{queuedJob.destination_dir}</span>
                    {jobFilePaths(queuedJob).length ? (
                      <div className="path-list compact">
                        {jobFilePaths(queuedJob).map((path) => (
                          <code key={path}>{path}</code>
                        ))}
                      </div>
                    ) : null}
                  </td>
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
                      <button className="button" type="button" disabled={!isJobReadyForModel(queuedJob, models.data) || installModel.isPending} onClick={() => installDownloadedModel(queuedJob)}>
                        <FileCheck2 size={14} aria-hidden="true" />
                        {isJobManaged(queuedJob, models.data) ? "Configured" : "Create"}
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
        {installModel.error ? <p className="form-error">{installModel.error.message}</p> : null}
        {installMessage ? (
          <div className="form-success action-success">
            <span>{installMessage}</span>
            <Link className="button secondary" to="/models">
              Tune Managed Model
            </Link>
            <Link className="button secondary" to="/config">
              Preview Config
            </Link>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function PipelineStep({ title, state, detail }: { title: string; state: "done" | "current" | "idle"; detail: string }) {
  return (
    <div className={`pipeline-step ${state}`}>
      <strong>{title}</strong>
      <span>{detail}</span>
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

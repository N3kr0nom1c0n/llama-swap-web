import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileCheck2, FilePlus2, FolderSearch, Link2, RotateCcw, Save, Upload, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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

const STEPS = [
  { n: 1, label: "Source", detail: "HF URL, upload, or scan existing files" },
  { n: 2, label: "Select Files", detail: "Choose GGUF and support files" },
  { n: 3, label: "Download", detail: "Transfer files to the target rig" },
  { n: 4, label: "Configure", detail: "Create the managed model entry" },
  { n: 5, label: "Config Preview", detail: "Preview, validate, and apply" },
] as const;

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
  const [step, setStep] = useState(1);
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
  const stepOneDone = Boolean(resolve.data || upload.data || scannedItems.length);
  const stepTwoDone = selectedFiles.length > 0 || draft.container_files.length > 0;
  const stepThreeDone = job.data?.status === "completed" || readyJobs.length > 0;
  const stepFourDone = Boolean(installModel.data || saveModel.isSuccess || saveScannedModel.data);
  const currentStep = STEPS[step - 1] ?? STEPS[0];

  useEffect(() => {
    if (focusedJobId) setStep(4);
  }, [focusedJobId]);

  useEffect(() => {
    if (stepFourDone) setStep(5);
  }, [stepFourDone]);

  function toggleFile(file: HfFile) {
    setSelectedFiles((current) => (current.includes(file.path) ? current.filter((item) => item !== file.path) : [...current, file.path]));
  }

  function selectRecommendedFiles() {
    const files = resolve.data?.files ?? [];
    setSelectedFiles(files.filter((file) => ["gguf", "gguf_part", "mmproj", "chat_template"].includes(file.kind)).map((file) => file.path));
  }

  function clearSelectedFiles() {
    setSelectedFiles([]);
  }

  function stepState(n: number): "done" | "active" | "idle" {
    const done =
      (n === 1 && stepOneDone) ||
      (n === 2 && stepTwoDone) ||
      (n === 3 && stepThreeDone) ||
      (n === 4 && stepFourDone);
    if (done && n !== step) return "done";
    if (n === step) return "active";
    return "idle";
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

      <div className="wizard-shell">
        <aside className="wizard-rail">
          <div className="wizard-rail-title">Import Pipeline</div>
          {STEPS.map((item, index) => {
            const stateName = stepState(item.n);
            return (
              <div className="wizard-step-unit" key={item.n}>
                <button type="button" className={`wizard-step-btn${step === item.n ? " active" : ""}`} onClick={() => setStep(item.n)}>
                  <div className={`wizard-step-num ${stateName}`}>{stateName === "done" ? <FileCheck2 size={13} aria-hidden="true" /> : item.n}</div>
                  <div>
                    <div className="wizard-step-label">{item.label}</div>
                    <div className="wizard-step-detail">{item.detail}</div>
                  </div>
                </button>
                {index < STEPS.length - 1 ? <div className="wizard-connector" /> : null}
              </div>
            );
          })}
        </aside>

        <div className="wizard-body">
          <div className="wizard-topbar">
            <div>
              <h2>Step {currentStep.n}: {currentStep.label}</h2>
              <div className="wizard-topbar-detail">{currentStep.detail}</div>
            </div>
            <StatusPill tone={readyJobs.length ? "warn" : activeJobs.length ? "run" : "ok"}>
              {readyJobs.length ? `${readyJobs.length} ready to configure` : activeJobs.length ? "downloading" : "ready"}
            </StatusPill>
          </div>

          <div className="wizard-content">
            {step === 1 ? (
              <>
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
                  {resolve.data ? <p className="form-success">Resolved {resolve.data.files.length} files from {resolve.data.repo_id}@{resolve.data.revision}.</p> : null}
                  {upload.data ? <p className="form-success">Uploaded file staged at {upload.data.container_path}.</p> : null}
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
              </>
            ) : null}

            {step === 2 ? (
              <section className="panel">
                <div className="panel-header">
                  <h2>Resolved Files</h2>
                  {resolve.data ? <StatusPill tone="idle">{resolve.data.repo_id}@{resolve.data.revision}</StatusPill> : <StatusPill tone="warn">no source</StatusPill>}
                </div>
                {resolve.data ? (
                  <>
                    <div className="inline-actions file-selection-actions">
                      <button className="button secondary" type="button" onClick={selectRecommendedFiles}>
                        Select Recommended
                      </button>
                      <button className="button secondary" type="button" onClick={clearSelectedFiles} disabled={!selectedFiles.length}>
                        Clear Selection
                      </button>
                      <span className="wizard-selection-count">{selectedFiles.length} selected</span>
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
                      <button
                        className="button"
                        type="button"
                        onClick={() => createImport.mutate({ target_rig_id: targetRigId, role, source_type: "hf", hf_url: hfUrl, hf_revision: revision, selected_files: selectedFiles, desired_name: currentDesiredName(), gpu_devices: gpuDevices })}
                        disabled={!selectedFiles.length || createImport.isPending}
                      >
                        <FilePlus2 size={16} aria-hidden="true" />
                        Preview Destination
                      </button>
                    </div>
                    {createImport.data ? <p className="form-success">Target rig destination: {createImport.data.destination_dir}</p> : null}
                  </>
                ) : upload.data ? (
                  <div className="empty-state">Uploaded file is already attached to the draft. Continue to Configure to review the generated command.</div>
                ) : (
                  <div className="empty-state">Resolve a Hugging Face URL, upload a file, or scan existing files before selecting model artifacts.</div>
                )}
              </section>
            ) : null}

            {step === 3 ? (
              <>
                <section className="panel">
                  <div className="panel-header">
                    <h2>Target Rig Download</h2>
                    {job.data ? <JobStatusPill status={job.data.status} /> : <StatusPill tone={selectedFiles.length ? "idle" : "warn"}>{selectedFiles.length ? "ready" : "select files first"}</StatusPill>}
                  </div>
                  <div className="inline-actions">
                    <button className="button" type="button" onClick={() => download.mutate()} disabled={!selectedFiles.length || download.isPending || job.data?.status === "running"}>
                      <Download size={16} aria-hidden="true" />
                      Start Download
                    </button>
                    {job.data && ["queued", "running"].includes(job.data.status) ? (
                      <button className="button secondary" type="button" onClick={() => cancelJob.mutate(job.data.id)}>
                        <XCircle size={14} aria-hidden="true" />
                        Cancel
                      </button>
                    ) : null}
                  </div>
                  {lastJobId ? (
                    <>
                      <div className="progress-track">
                        <span style={{ width: `${Math.min(100, Math.max(0, job.data?.progress ?? 0))}%` }} />
                      </div>
                      <CodeBlock label="Job logs" value={job.data?.logs.join("\n") ?? ""} minRows={6} />
                      {job.data?.status === "completed" ? (
                        <div className="form-success action-success">
                          <span>Download complete. Continue to Configure to create the managed model entry.</span>
                          <button className="button secondary" type="button" onClick={() => setStep(4)}>
                            Configure Model
                          </button>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="empty-state">Start the download to transfer selected files directly onto the selected target rig.</div>
                  )}
                  {download.error ? <p className="form-error">{download.error.message}</p> : null}
                  {job.data?.error ? <p className="form-error">{job.data.error}</p> : null}
                </section>

                <section className="panel secondary-panel">
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
              </>
            ) : null}

            {step === 4 ? (
              <>
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
                    <div className="empty-state">Completed downloads that are not connected to a managed model will appear here.</div>
                  )}
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
                  {job.data?.status === "completed" ? (
                    <div className="inline-actions">
                      <button className="button secondary" type="button" disabled={installModel.isPending} onClick={() => installDownloadedModel(job.data as DownloadJob, true)}>
                        <FileCheck2 size={16} aria-hidden="true" />
                        Create From Completed Download
                      </button>
                    </div>
                  ) : null}
                  {saveModel.error ? <p className="form-error">{saveModel.error.message}</p> : null}
                  {saveModel.isSuccess ? <p className="form-success">Draft model saved. Review matrix and config preview next.</p> : null}
                  {installModel.error ? <p className="form-error">{installModel.error.message}</p> : null}
                  {installMessage ? <p className="form-success">{installMessage}</p> : null}
                </section>
              </>
            ) : null}

            {step === 5 ? (
              <section className="panel">
                <div className="panel-header">
                  <h2>Config Preview</h2>
                  <StatusPill tone={stepFourDone ? "ok" : "warn"}>{stepFourDone ? "model entry ready" : "configure first"}</StatusPill>
                </div>
                <div className={stepFourDone ? "alert-panel ok" : "alert-panel warn"}>
                  <FileCheck2 size={18} aria-hidden="true" />
                  <div>
                    <strong>{stepFourDone ? "Model entry created" : "No saved model entry yet"}</strong>
                    <p>{stepFourDone ? "Open Config Preview to generate YAML, validate it, back up the remote config, and apply it to llama-swap." : "Finish Configure before applying anything to llama-swap."}</p>
                  </div>
                </div>
                {installMessage || scanMessage ? <p className="form-success">{installMessage || scanMessage}</p> : null}
                <div className="inline-actions">
                  <Link className="button" to="/config">
                    Preview Config
                  </Link>
                  <Link className="button secondary" to="/models">
                    Tune Managed Model
                  </Link>
                  <button className="button secondary" type="button" onClick={() => setStep(4)}>
                    Back to Configure
                  </button>
                </div>
              </section>
            ) : null}
          </div>

          <div className="wizard-footer">
            <button className="button secondary" type="button" onClick={() => setStep((value) => Math.max(1, value - 1))} disabled={step === 1}>
              Back
            </button>
            <div className="inline-actions">
              <span className="wizard-footer-count">Step {step} of {STEPS.length}</span>
              <button className="button" type="button" onClick={() => setStep((value) => Math.min(STEPS.length, value + 1))} disabled={step === STEPS.length}>
                Continue
              </button>
            </div>
          </div>
        </div>
      </div>
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

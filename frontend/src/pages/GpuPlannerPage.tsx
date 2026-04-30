import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Radar, Save, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { Field } from "../components/Field";
import { PageHeader } from "../components/PageHeader";
import { StatusPill } from "../components/StatusPill";
import { queryKeys } from "../queryKeys";
import type { GpuDevice } from "../types";

export function GpuPlannerPage() {
  const queryClient = useQueryClient();
  const gpus = useQuery({ queryKey: queryKeys.gpus, queryFn: api.gpus });
  const detection = useQuery({ queryKey: queryKeys.gpuDetection, queryFn: api.detectGpus, enabled: false });
  const [draft, setDraft] = useState<GpuDevice[]>([]);

  useEffect(() => {
    if (gpus.data) setDraft(gpus.data);
  }, [gpus.data]);

  const save = useMutation({
    mutationFn: api.saveGpus,
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.gpus, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.state });
    },
  });
  const recommendation = useMutation({ mutationFn: () => api.recommendGpus(draft.map((gpu) => gpu.index)) });
  const draftSignature = draft.map((gpu) => gpu.index).join(",");

  useEffect(() => {
    recommendation.reset();
  }, [draftSignature]);

  function update(index: number, patch: Partial<GpuDevice>) {
    setDraft((current) => current.map((gpu, row) => (row === index ? { ...gpu, ...patch } : gpu)));
  }

  function applyDetectedGpus() {
    if (!detection.data?.available) return;
    setDraft(
      detection.data.gpus.map((gpu) => ({
        index: gpu.index,
        name: gpu.name,
        vram_gb: gpu.vram_gb,
        role: gpu.role,
        notes: gpu.notes,
      })),
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="GPU Planner"
        description="Map CUDA devices to model roles and keep tensor split choices visible before config generation."
        actions={
          <button className="button" onClick={() => save.mutate(draft)} disabled={save.isPending} type="button">
            <Save size={16} aria-hidden="true" />
            Save GPUs
          </button>
        }
      />
      <section className="panel">
        <div className="panel-header">
          <h2>CUDA Devices</h2>
          <div className="inline-actions">
            <button className="button secondary" type="button" onClick={() => detection.refetch()} disabled={detection.isFetching}>
              <Radar size={16} aria-hidden="true" />
              Detect GPUs
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => setDraft((current) => [...current, { index: nextCudaIndex(current), name: "GPU", vram_gb: 24, role: "", notes: "" }])}
            >
              <Plus size={16} aria-hidden="true" />
              Add GPU
            </button>
          </div>
        </div>
        {detection.data ? (
          <div className="callout">
            <div>
              <StatusPill tone={detection.data.available ? "ok" : "warn"}>
                {detection.data.available ? `${detection.data.gpus.length} detected` : "detection unavailable"}
              </StatusPill>
              <p>
                {detection.data.available
                  ? "Detected cards can replace this planner draft while preserving saved role and note fields by CUDA index."
                  : detection.data.reason || "nvidia-smi is unavailable in this environment."}
              </p>
            </div>
            {detection.data.available ? (
              <button className="button" type="button" onClick={applyDetectedGpus}>
                Use Detected GPUs
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="gpu-grid">
          {draft.map((gpu, index) => (
            <div className="gpu-row" key={`${gpu.index}-${index}`}>
              <Field label="CUDA index">
                <input type="number" value={gpu.index} onChange={(event) => update(index, { index: Number(event.target.value) })} />
              </Field>
              <Field label="Name">
                <input value={gpu.name} onChange={(event) => update(index, { name: event.target.value })} />
              </Field>
              <Field label="VRAM GB">
                <input type="number" value={gpu.vram_gb} onChange={(event) => update(index, { vram_gb: Number(event.target.value) })} />
              </Field>
              <Field label="Role">
                <input value={gpu.role} onChange={(event) => update(index, { role: event.target.value })} />
              </Field>
              <Field label="Notes">
                <input value={gpu.notes} onChange={(event) => update(index, { notes: event.target.value })} />
              </Field>
              <button className="icon-button danger" type="button" onClick={() => setDraft((current) => current.filter((_, row) => row !== index))} title="Remove GPU">
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
        {save.error ? <p className="form-error">{save.error.message}</p> : null}
        {save.isSuccess ? <p className="form-success">GPU plan saved.</p> : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Tensor Split Helper</h2>
          <button className="button secondary" type="button" onClick={() => recommendation.mutate()} disabled={!draft.length || recommendation.isPending}>
            <Sparkles size={16} aria-hidden="true" />
            Recommend Split
          </button>
        </div>
        {recommendation.data ? (
          <div className="callout">
            <div>
              <strong>
                CUDA_VISIBLE_DEVICES={recommendation.data.recommendation.cuda_devices.join(",") || "none"} · main GPU{" "}
                {recommendation.data.recommendation.main_gpu ?? "none"} · tensor split {recommendation.data.recommendation.tensor_split || "none"}
              </strong>
              {recommendation.data.recommendation.warnings.length ? (
                <ul>
                  {recommendation.data.recommendation.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : (
                <p>Use this as a starting point for model entries that span these cards.</p>
              )}
            </div>
          </div>
        ) : null}
        <div className="note-grid">
          <div>
            <strong>CUDA_VISIBLE_DEVICES</strong>
            <span>Model entries use selected GPU indexes to generate runtime visibility.</span>
          </div>
          <div>
            <strong>Main GPU</strong>
            <span>Use main GPU when llama.cpp should anchor layers on one card.</span>
          </div>
          <div>
            <strong>Tensor split</strong>
            <span>Keep explicit ratios like 24,24 or 18,24 next to each model entry.</span>
          </div>
        </div>
      </section>
    </div>
  );
}

function nextCudaIndex(gpus: GpuDevice[]) {
  const used = new Set(gpus.map((gpu) => gpu.index));
  let index = 0;
  while (used.has(index)) index += 1;
  return index;
}

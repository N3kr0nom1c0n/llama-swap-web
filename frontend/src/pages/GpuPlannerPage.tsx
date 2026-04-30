import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { Field } from "../components/Field";
import { PageHeader } from "../components/PageHeader";
import { queryKeys } from "../queryKeys";
import type { GpuDevice } from "../types";

export function GpuPlannerPage() {
  const queryClient = useQueryClient();
  const gpus = useQuery({ queryKey: queryKeys.gpus, queryFn: api.gpus });
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

  function update(index: number, patch: Partial<GpuDevice>) {
    setDraft((current) => current.map((gpu, row) => (row === index ? { ...gpu, ...patch } : gpu)));
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
          <button
            className="button secondary"
            type="button"
            onClick={() => setDraft((current) => [...current, { index: current.length, name: "GPU", vram_gb: 24, role: "", notes: "" }])}
          >
            <Plus size={16} aria-hidden="true" />
            Add GPU
          </button>
        </div>
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
          <h2>Planner Notes</h2>
        </div>
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

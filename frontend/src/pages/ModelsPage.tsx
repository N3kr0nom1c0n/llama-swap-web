import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSearch, Plus, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, splitList } from "../api";
import { CodeBlock } from "../components/CodeBlock";
import { Field } from "../components/Field";
import { PageHeader } from "../components/PageHeader";
import { queryKeys } from "../queryKeys";
import type { ManagedModel, MatrixBehavior, ModelRole } from "../types";
import { emptyModel, matrixBehaviors, modelRoles } from "../types";
import { defaultTtlForRole, modelCommand, safeMatrixKey } from "../utils";

export function ModelsPage() {
  const queryClient = useQueryClient();
  const models = useQuery({ queryKey: queryKeys.models, queryFn: api.models });
  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: api.settings });
  const gpus = useQuery({ queryKey: queryKeys.gpus, queryFn: api.gpus });
  const importCandidates = useQuery({ queryKey: queryKeys.configImport, queryFn: api.configImportCandidates, enabled: false });
  const [selectedId, setSelectedId] = useState<string>("");
  const [draft, setDraft] = useState<ManagedModel>(emptyModel());

  useEffect(() => {
    if (!selectedId && models.data?.[0]) setSelectedId(models.data[0].id);
  }, [models.data, selectedId]);

  useEffect(() => {
    const found = models.data?.find((model) => model.id === selectedId);
    if (found) setDraft(found);
  }, [models.data, selectedId]);

  const save = useMutation({
    mutationFn: api.saveModel,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.models });
      void queryClient.invalidateQueries({ queryKey: queryKeys.state });
      void queryClient.invalidateQueries({ queryKey: queryKeys.preview });
    },
  });
  const importSelected = useMutation({
    mutationFn: api.importConfigCandidates,
    onSuccess: (imported) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.models });
      void queryClient.invalidateQueries({ queryKey: queryKeys.state });
      if (imported[0]) {
        setSelectedId(imported[0].id);
        setDraft(imported[0]);
      }
    },
  });

  const command = useMemo(() => modelCommand(draft, settings.data), [draft, settings.data]);

  function update(patch: Partial<ManagedModel>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function startNew() {
    const next = emptyModel();
    next.hf_revision = settings.data?.default_revision ?? "main";
    next.ttl = defaultTtlForRole(settings.data, next.role);
    setSelectedId("");
    setDraft(next);
  }

  return (
    <div className="page">
      <PageHeader
        title="Models"
        description="Edit persisted model entries, llama-server flags, matrix behavior, and generated commands."
        actions={
          <>
            <button className="button secondary" type="button" onClick={startNew}>
              <Plus size={16} aria-hidden="true" />
              New Model
            </button>
            <button className="button secondary" type="button" onClick={() => importCandidates.refetch()} disabled={importCandidates.isFetching}>
              <FileSearch size={16} aria-hidden="true" />
              Import Config
            </button>
            <button className="button" type="button" onClick={() => save.mutate(draft)} disabled={!draft.id || save.isPending}>
              <Save size={16} aria-hidden="true" />
              Save Model
            </button>
          </>
        }
      />

      {importCandidates.data ? (
        <section className="panel">
          <div className="panel-header">
            <h2>Current config import</h2>
            <button className="button" type="button" onClick={() => importSelected.mutate(importCandidates.data.map((candidate) => candidate.id))} disabled={!importCandidates.data.length || importSelected.isPending}>
              Import All
            </button>
          </div>
          <div className="row-list">
            {importCandidates.data.map((candidate) => (
              <div className="inventory-card" key={candidate.id}>
                <div>
                  <strong>{candidate.model.display_name}</strong>
                  <span>
                    {candidate.model.role} · {candidate.model.primary_model_file || "raw command"}
                  </span>
                  {candidate.warnings.length ? (
                    <ul>
                      {candidate.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <button className="button secondary" type="button" onClick={() => importSelected.mutate([candidate.id])}>
                  Import
                </button>
              </div>
            ))}
            {!importCandidates.data.length ? <span className="muted">No importable model entries found in the current config.</span> : null}
          </div>
          {importSelected.error ? <p className="form-error">{importSelected.error.message}</p> : null}
          {importSelected.isSuccess ? (
            <p className="form-success">
              Imported {importSelected.data.length} model {importSelected.data.length === 1 ? "entry" : "entries"}.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="models-layout">
        <aside className="model-list panel">
          <div className="panel-header">
            <h2>Inventory</h2>
          </div>
          <div className="row-list">
            {models.data?.map((model) => (
              <button key={model.id} className={model.id === selectedId ? "row-button active" : "row-button"} onClick={() => setSelectedId(model.id)} type="button">
                <strong>{model.id}</strong>
                <span>{model.role} · {model.matrix_behavior}</span>
              </button>
            ))}
            {!models.data?.length ? <span className="muted">No model entries saved.</span> : null}
          </div>
        </aside>

        <div className="panel model-editor">
          <div className="form-grid">
            <Field label="Model ID">
              <input value={draft.id} onChange={(event) => update({ id: event.target.value, matrix_key: draft.matrix_key || safeMatrixKey(event.target.value) })} />
            </Field>
            <Field label="Display name">
              <input value={draft.display_name} onChange={(event) => update({ display_name: event.target.value })} />
            </Field>
            <Field label="Role">
              <select
                value={draft.role}
                onChange={(event) => {
                  const role = event.target.value as ModelRole;
                  update({ role, ttl: defaultTtlForRole(settings.data, role) });
                }}
              >
                {modelRoles.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="HF revision">
              <input value={draft.hf_revision} onChange={(event) => update({ hf_revision: event.target.value })} />
            </Field>
            <Field label="TTL seconds">
              <input type="number" value={draft.ttl} onChange={(event) => update({ ttl: Number(event.target.value) })} />
            </Field>
            <Field label="Aliases" hint="Comma or newline separated">
              <textarea value={draft.aliases.join("\n")} onChange={(event) => update({ aliases: splitList(event.target.value) })} />
            </Field>
          </div>

          <div className="form-grid wide">
            <Field label="Manager files" hint="Host-visible manager paths, one per line">
              <textarea value={draft.manager_files.join("\n")} onChange={(event) => update({ manager_files: splitList(event.target.value) })} />
            </Field>
            <Field label="Container files" hint="Generated llama-swap paths, one per line">
              <textarea value={draft.container_files.join("\n")} onChange={(event) => update({ container_files: splitList(event.target.value) })} />
            </Field>
            <Field label="Primary model file">
              <input value={draft.primary_model_file} onChange={(event) => update({ primary_model_file: event.target.value })} />
            </Field>
            <Field label="MMProj file">
              <input value={draft.mmproj_file} onChange={(event) => update({ mmproj_file: event.target.value })} />
            </Field>
            <Field label="Chat template file">
              <input value={draft.chat_template_file} onChange={(event) => update({ chat_template_file: event.target.value })} />
            </Field>
            <Field label="Tokenizer files">
              <textarea value={draft.tokenizer_files.join("\n")} onChange={(event) => update({ tokenizer_files: splitList(event.target.value) })} />
            </Field>
          </div>

          <div className="form-grid">
            <Field label="CUDA devices">
              <div className="check-cluster">
                {gpus.data?.map((gpu) => (
                  <label key={gpu.index} className="check-chip">
                    <input
                      type="checkbox"
                      checked={draft.gpu_devices.includes(gpu.index)}
                      onChange={() =>
                        update({
                          gpu_devices: draft.gpu_devices.includes(gpu.index)
                            ? draft.gpu_devices.filter((item) => item !== gpu.index)
                            : [...draft.gpu_devices, gpu.index],
                        })
                      }
                    />
                    {gpu.index}: {gpu.name}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Main GPU">
              <select value={draft.main_gpu ?? ""} onChange={(event) => update({ main_gpu: event.target.value === "" ? null : Number(event.target.value) })}>
                <option value="">Auto</option>
                {gpus.data?.map((gpu) => (
                  <option key={gpu.index} value={gpu.index}>
                    {gpu.index}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tensor split">
              <input value={draft.tensor_split} onChange={(event) => update({ tensor_split: event.target.value })} placeholder="24,24" />
            </Field>
            <Field label="Matrix key">
              <input value={draft.matrix_key} onChange={(event) => update({ matrix_key: event.target.value })} />
            </Field>
            <Field label="Matrix behavior">
              <select value={draft.matrix_behavior} onChange={(event) => update({ matrix_behavior: event.target.value as MatrixBehavior })}>
                {matrixBehaviors.map((behavior) => (
                  <option key={behavior} value={behavior}>
                    {behavior}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Evict cost">
              <input type="number" value={draft.evict_cost ?? ""} onChange={(event) => update({ evict_cost: event.target.value === "" ? null : Number(event.target.value) })} />
            </Field>
            <Field label="Startup preload">
              <span className="toggle-row">
                <input type="checkbox" checked={draft.startup_preload} onChange={(event) => update({ startup_preload: event.target.checked })} />
                Include in hooks.on_startup.preload
              </span>
            </Field>
            <Field label="Custom matrix expression">
              <input value={draft.matrix_expression} onChange={(event) => update({ matrix_expression: event.target.value })} />
            </Field>
          </div>

          <FlagEditor model={draft} onChange={update} />

          <Field label="Raw command override" hint="Warning: raw overrides may bypass structured validation">
            <textarea value={draft.raw_cmd_override} onChange={(event) => update({ raw_cmd_override: event.target.value })} />
          </Field>

          <CodeBlock label="Generated command" value={command} minRows={4} />
          {save.error ? <p className="form-error">{save.error.message}</p> : null}
          {save.isSuccess ? <p className="form-success">Model saved. Regenerate config preview before applying.</p> : null}
        </div>
      </section>
    </div>
  );
}

function FlagEditor({ model, onChange }: { model: ManagedModel; onChange: (patch: Partial<ManagedModel>) => void }) {
  const flags = model.llama_flags ?? {};
  const setFlag = (key: string, value: string | number | boolean) => onChange({ llama_flags: { ...flags, [key]: value } });
  return (
    <section className="subsection">
      <h3>llama-server Flags</h3>
      <div className="form-grid">
        <Field label="ctx-size">
          <input type="number" value={String(flags.ctx_size ?? "")} onChange={(event) => setFlag("ctx_size", Number(event.target.value))} />
        </Field>
        <Field label="cache-type-k">
          <input value={String(flags.cache_type_k ?? "")} onChange={(event) => setFlag("cache_type_k", event.target.value)} />
        </Field>
        <Field label="cache-type-v">
          <input value={String(flags.cache_type_v ?? "")} onChange={(event) => setFlag("cache_type_v", event.target.value)} />
        </Field>
        <Field label="n-gpu-layers">
          <input value={String(flags.n_gpu_layers ?? "")} onChange={(event) => setFlag("n_gpu_layers", event.target.value)} />
        </Field>
        <Field label="parallel">
          <input value={String(flags.parallel ?? "")} onChange={(event) => setFlag("parallel", event.target.value)} />
        </Field>
        <Field label="batch-size">
          <input value={String(flags.batch_size ?? "")} onChange={(event) => setFlag("batch_size", event.target.value)} />
        </Field>
        <Field label="ubatch-size">
          <input value={String(flags.ubatch_size ?? "")} onChange={(event) => setFlag("ubatch_size", event.target.value)} />
        </Field>
        <Field label="temp">
          <input value={String(flags.temp ?? "")} onChange={(event) => setFlag("temp", event.target.value)} />
        </Field>
        <Field label="top-p">
          <input value={String(flags.top_p ?? "")} onChange={(event) => setFlag("top_p", event.target.value)} />
        </Field>
        <Field label="top-k">
          <input value={String(flags.top_k ?? "")} onChange={(event) => setFlag("top_k", event.target.value)} />
        </Field>
        <Field label="min-p">
          <input value={String(flags.min_p ?? "")} onChange={(event) => setFlag("min_p", event.target.value)} />
        </Field>
        <Field label="presence-penalty">
          <input value={String(flags.presence_penalty ?? "")} onChange={(event) => setFlag("presence_penalty", event.target.value)} />
        </Field>
        <Field label="repeat-penalty">
          <input value={String(flags.repeat_penalty ?? "")} onChange={(event) => setFlag("repeat_penalty", event.target.value)} />
        </Field>
        <Field label="keep">
          <input value={String(flags.keep ?? "")} onChange={(event) => setFlag("keep", event.target.value)} />
        </Field>
        <Field label="n-predict">
          <input value={String(flags.n_predict ?? "")} onChange={(event) => setFlag("n_predict", event.target.value)} />
        </Field>
        <Field label="Booleans">
          <div className="check-cluster">
            <label className="check-chip">
              <input type="checkbox" checked={Boolean(flags.jinja)} onChange={(event) => setFlag("jinja", event.target.checked)} />
              jinja
            </label>
            <label className="check-chip">
              <input type="checkbox" checked={Boolean(flags.no_mmap)} onChange={(event) => setFlag("no_mmap", event.target.checked)} />
              no-mmap
            </label>
            <label className="check-chip">
              <input type="checkbox" checked={Boolean(flags.context_shift)} onChange={(event) => setFlag("context_shift", event.target.checked)} />
              context-shift
            </label>
          </div>
        </Field>
      </div>
    </section>
  );
}

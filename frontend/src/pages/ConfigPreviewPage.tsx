import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, FileWarning, RefreshCw } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { CodeBlock } from "../components/CodeBlock";
import { PageHeader } from "../components/PageHeader";
import { StatusPill } from "../components/StatusPill";
import { queryKeys } from "../queryKeys";

export function ConfigPreviewPage() {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const models = useQuery({ queryKey: queryKeys.models, queryFn: api.models });
  const preview = useQuery({
    queryKey: [...queryKeys.preview, selectedIds],
    queryFn: () => api.previewConfig(selectedIds),
  });
  const apply = useMutation({
    mutationFn: () => {
      if (!preview.data?.stage_id) throw new Error("Regenerate a valid preview before applying.");
      return api.applyConfig(preview.data.stage_id);
    },
  });

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
            <button className="button" onClick={() => apply.mutate()} disabled={!preview.data?.valid || !preview.data.stage_id || apply.isPending} type="button">
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

      <section className="split-code">
        <CodeBlock label="Generated YAML" value={preview.data?.yaml ?? ""} minRows={22} />
        <CodeBlock label="Diff" value={preview.data?.diff ?? ""} minRows={22} />
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
      {apply.error ? <p className="form-error">{apply.error.message}</p> : null}
    </div>
  );
}

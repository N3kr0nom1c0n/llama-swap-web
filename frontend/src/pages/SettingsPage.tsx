import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { Field } from "../components/Field";
import { PageHeader } from "../components/PageHeader";
import { StatusPill } from "../components/StatusPill";
import { queryKeys } from "../queryKeys";
import type { ManagerSettings } from "../types";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: api.settings });
  const [draft, setDraft] = useState<ManagerSettings | null>(null);

  useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: api.saveSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.settings, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.state });
      void queryClient.invalidateQueries({ queryKey: queryKeys.preview });
    },
  });

  if (!draft) {
    return (
      <div className="page">
        <PageHeader title="Settings" description="Loading manager settings." />
      </div>
    );
  }

  const update = (patch: Partial<ManagerSettings>) => setDraft((current) => (current ? { ...current, ...patch } : current));
  const updateRoleDir = (key: keyof ManagerSettings["role_directories"], value: string) =>
    update({ role_directories: { ...draft.role_directories, [key]: value } });
  const updateDefault = (key: keyof ManagerSettings["defaults"], value: string | number | boolean) =>
    update({ defaults: { ...draft.defaults, [key]: value } });

  return (
    <div className="page">
      <PageHeader
        title="Settings"
        description="Persist mount paths, config paths, Hugging Face defaults, and llama-server command defaults."
        actions={
          <button className="button" type="button" onClick={() => save.mutate(draft)} disabled={save.isPending}>
            <Save size={16} aria-hidden="true" />
            Save Settings
          </button>
        }
      />

      <section className="panel">
        <div className="panel-header">
          <h2>Runtime</h2>
          <StatusPill tone={draft.hf_token_configured ? "ok" : "warn"}>{draft.hf_token_configured ? "HF_TOKEN from env" : "HF_TOKEN not configured"}</StatusPill>
        </div>
        <div className="form-grid">
          <Field label="App host">
            <input value={draft.app_host} onChange={(event) => update({ app_host: event.target.value })} />
          </Field>
          <Field label="App port">
            <input type="number" value={draft.app_port} onChange={(event) => update({ app_port: Number(event.target.value) })} />
          </Field>
          <Field label="Default HF revision">
            <input value={draft.default_revision} onChange={(event) => update({ default_revision: event.target.value })} />
          </Field>
          <Field label="Max parallel downloads">
            <input type="number" value={draft.max_parallel_downloads} onChange={(event) => update({ max_parallel_downloads: Number(event.target.value) })} />
          </Field>
          <Field label="Disk safety GB">
            <input type="number" value={draft.disk_safety_gb} onChange={(event) => update({ disk_safety_gb: Number(event.target.value) })} />
          </Field>
          <Field label="llama-server command">
            <input value={draft.llama_server_cmd} onChange={(event) => update({ llama_server_cmd: event.target.value })} />
          </Field>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Paths</h2>
        </div>
        <div className="form-grid">
          <Field label="Manager model root">
            <input value={draft.manager_model_root} onChange={(event) => update({ manager_model_root: event.target.value })} />
          </Field>
          <Field label="Llama-swap model root">
            <input value={draft.llama_swap_model_root} onChange={(event) => update({ llama_swap_model_root: event.target.value })} />
          </Field>
          <Field label="Config path">
            <input value={draft.llama_swap_config_path} onChange={(event) => update({ llama_swap_config_path: event.target.value })} />
          </Field>
          <Field label="Backups dir">
            <input value={draft.backups_dir} onChange={(event) => update({ backups_dir: event.target.value })} />
          </Field>
          <Field label="Download temp dir">
            <input value={draft.download_temp_dir} onChange={(event) => update({ download_temp_dir: event.target.value })} />
          </Field>
          <Field label="Data dir">
            <input value={draft.data_dir} onChange={(event) => update({ data_dir: event.target.value })} />
          </Field>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Role Directories</h2>
        </div>
        <div className="form-grid">
          {Object.entries(draft.role_directories).map(([key, value]) => (
            <Field key={key} label={key}>
              <input value={value} onChange={(event) => updateRoleDir(key as keyof ManagerSettings["role_directories"], event.target.value)} />
            </Field>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Default Presets</h2>
        </div>
        <div className="form-grid">
          <Field label="TTL reasoning">
            <input type="number" value={draft.defaults.ttl_reasoning} onChange={(event) => updateDefault("ttl_reasoning", Number(event.target.value))} />
          </Field>
          <Field label="TTL chat">
            <input type="number" value={draft.defaults.ttl_chat} onChange={(event) => updateDefault("ttl_chat", Number(event.target.value))} />
          </Field>
          <Field label="TTL vision">
            <input type="number" value={draft.defaults.ttl_vision} onChange={(event) => updateDefault("ttl_vision", Number(event.target.value))} />
          </Field>
          <Field label="TTL aux">
            <input type="number" value={draft.defaults.ttl_aux} onChange={(event) => updateDefault("ttl_aux", Number(event.target.value))} />
          </Field>
          <Field label="ctx-size">
            <input type="number" value={draft.defaults.ctx_size} onChange={(event) => updateDefault("ctx_size", Number(event.target.value))} />
          </Field>
          <Field label="cache-type-k">
            <input value={draft.defaults.cache_type_k} onChange={(event) => updateDefault("cache_type_k", event.target.value)} />
          </Field>
          <Field label="cache-type-v">
            <input value={draft.defaults.cache_type_v} onChange={(event) => updateDefault("cache_type_v", event.target.value)} />
          </Field>
          <Field label="flash-attn">
            <input value={draft.defaults.flash_attn} onChange={(event) => updateDefault("flash_attn", event.target.value)} />
          </Field>
          <Field label="Boolean defaults">
            <div className="check-cluster">
              <label className="check-chip">
                <input type="checkbox" checked={draft.defaults.jinja} onChange={(event) => updateDefault("jinja", event.target.checked)} />
                jinja
              </label>
              <label className="check-chip">
                <input type="checkbox" checked={draft.defaults.no_mmap} onChange={(event) => updateDefault("no_mmap", event.target.checked)} />
                no-mmap
              </label>
            </div>
          </Field>
        </div>
        <p className="field-hint">Hugging Face token value is never rendered. This page only shows whether the environment token is configured.</p>
        {save.error ? <p className="form-error">{save.error.message}</p> : null}
        {save.isSuccess ? <p className="form-success">Settings saved.</p> : null}
      </section>
    </div>
  );
}

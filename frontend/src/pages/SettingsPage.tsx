import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Network, Power, Save, ShieldAlert, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { Field } from "../components/Field";
import { PageHeader } from "../components/PageHeader";
import { StatusPill } from "../components/StatusPill";
import { queryKeys } from "../queryKeys";
import { useTargetRig } from "../targetRigContext";
import type { ManagerSettings, TargetRig } from "../types";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { targetRigId, setTargetRigId } = useTargetRig();
  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: api.settings });
  const targetRigs = useQuery({ queryKey: queryKeys.targetRigs, queryFn: api.targetRigs });
  const [draft, setDraft] = useState<ManagerSettings | null>(null);
  const [rigDraft, setRigDraft] = useState<TargetRig | null>(null);
  const [hfToken, setHfToken] = useState("");

  useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);

  useEffect(() => {
    const selected = targetRigs.data?.find((rig) => rig.id === targetRigId) ?? targetRigs.data?.[0] ?? null;
    if (selected) setRigDraft(selected);
  }, [targetRigId, targetRigs.data]);

  const save = useMutation({
    mutationFn: api.saveSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.settings, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.state });
      void queryClient.invalidateQueries({ queryKey: queryKeys.preview });
    },
  });
  const saveToken = useMutation({
    mutationFn: api.saveHfToken,
    onSuccess: (data) => {
      setHfToken("");
      setDraft(data);
      queryClient.setQueryData(queryKeys.settings, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.state });
    },
  });
  const clearToken = useMutation({
    mutationFn: api.clearHfToken,
    onSuccess: (data) => {
      setHfToken("");
      setDraft(data);
      queryClient.setQueryData(queryKeys.settings, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.state });
    },
  });
  const saveRig = useMutation({
    mutationFn: api.saveTargetRig,
    onSuccess: (data) => {
      setTargetRigId(data.id);
      setRigDraft(data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.targetRigs });
      void queryClient.invalidateQueries({ queryKey: queryKeys.state });
    },
  });
  const health = useQuery({
    queryKey: rigDraft ? queryKeys.targetRigHealth(rigDraft.id) : ["target-rigs", "health", "none"],
    queryFn: () => api.targetRigHealth(rigDraft?.id ?? "default"),
    enabled: false,
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
  const updateRig = (patch: Partial<TargetRig>) => setRigDraft((current) => (current ? { ...current, ...patch } : current));
  const selectedRigMode = rigDraft?.mode ?? "local";

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
          <h2>Target Rigs</h2>
          <StatusPill tone={selectedRigMode === "ssh" ? "ok" : "idle"}>{selectedRigMode === "ssh" ? "SSH remote" : "local target"}</StatusPill>
        </div>
        <div className="callout">
          <div>
            <strong>
              <Network size={16} aria-hidden="true" />
              llama-swap operations run against the selected target rig
            </strong>
            <p>HF downloads, model scans, config apply/restore, GPU detection, and restart commands use these settings. Use SSH for a separate AI rig.</p>
          </div>
        </div>
        <div className="form-grid">
          <Field label="Edit rig">
            <select
              value={rigDraft?.id ?? ""}
              onChange={(event) => {
                const next = targetRigs.data?.find((rig) => rig.id === event.target.value);
                if (next) {
                  setRigDraft(next);
                  setTargetRigId(next.id);
                }
              }}
            >
              {targetRigs.data?.map((rig) => (
                <option key={rig.id} value={rig.id}>
                  {rig.name} ({rig.mode})
                </option>
              ))}
            </select>
          </Field>
          <Field label="New rig">
            <button className="button secondary" type="button" onClick={() => setRigDraft(newSshRig(draft, targetRigs.data ?? []))}>
              <Network size={16} aria-hidden="true" />
              New SSH Rig
            </button>
          </Field>
        </div>
        {rigDraft ? (
          <>
            <div className="form-grid">
              <Field label="Rig ID">
                <input value={rigDraft.id} onChange={(event) => updateRig({ id: event.target.value })} />
              </Field>
              <Field label="Name">
                <input value={rigDraft.name} onChange={(event) => updateRig({ name: event.target.value })} />
              </Field>
              <Field label="Mode">
                <select value={rigDraft.mode} onChange={(event) => updateRig({ mode: event.target.value as TargetRig["mode"] })}>
                  <option value="ssh">SSH remote</option>
                  <option value="local">Local manager host</option>
                </select>
              </Field>
              <Field label="Enabled">
                <label className="check-chip">
                  <input type="checkbox" checked={rigDraft.enabled} onChange={(event) => updateRig({ enabled: event.target.checked })} />
                  Active target
                </label>
              </Field>
              <Field label="Host">
                <input value={rigDraft.host} onChange={(event) => updateRig({ host: event.target.value })} placeholder="192.168.42.40" />
              </Field>
              <Field label="SSH port">
                <input type="number" value={rigDraft.port} onChange={(event) => updateRig({ port: Number(event.target.value) })} />
              </Field>
              <Field label="Username">
                <input value={rigDraft.username} onChange={(event) => updateRig({ username: event.target.value })} placeholder="n3kr0" />
              </Field>
              <Field label="SSH key path">
                <input value={rigDraft.ssh_key_path} onChange={(event) => updateRig({ ssh_key_path: event.target.value })} placeholder="/data/ssh/id_ed25519" />
              </Field>
            </div>
            <div className="form-grid">
              <Field label="Target model root">
                <input value={rigDraft.model_root} onChange={(event) => updateRig({ model_root: event.target.value })} />
              </Field>
              <Field label="llama-swap model root">
                <input value={rigDraft.llama_swap_model_root} onChange={(event) => updateRig({ llama_swap_model_root: event.target.value })} />
              </Field>
              <Field label="Target config path">
                <input value={rigDraft.config_path} onChange={(event) => updateRig({ config_path: event.target.value })} />
              </Field>
              <Field label="Target backups dir">
                <input value={rigDraft.backups_dir} onChange={(event) => updateRig({ backups_dir: event.target.value })} />
              </Field>
              <Field label="Target temp dir">
                <input value={rigDraft.download_temp_dir} onChange={(event) => updateRig({ download_temp_dir: event.target.value })} />
              </Field>
              <Field label="Restart command">
                <input value={rigDraft.restart_command} onChange={(event) => updateRig({ restart_command: event.target.value })} />
              </Field>
              <Field label="Health check command">
                <input value={rigDraft.health_check_command} onChange={(event) => updateRig({ health_check_command: event.target.value })} />
              </Field>
            </div>
            <div className="inline-actions">
              <button className="button" type="button" onClick={() => saveRig.mutate(rigDraft)} disabled={saveRig.isPending || !rigDraft.id}>
                <Save size={16} aria-hidden="true" />
                Save Target Rig
              </button>
              <button className="button secondary" type="button" onClick={() => health.refetch()} disabled={health.isFetching || !rigDraft.id}>
                Check Target Health
              </button>
            </div>
            {saveRig.error ? <p className="form-error">{saveRig.error.message}</p> : null}
            {saveRig.isSuccess ? <p className="form-success">Target rig saved.</p> : null}
            {health.error ? <p className="form-error">{health.error.message}</p> : null}
            {health.data ? <pre className="health-output">{JSON.stringify(health.data, null, 2)}</pre> : null}
          </>
        ) : (
          <p className="muted">No target rigs loaded yet.</p>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Runtime</h2>
          <StatusPill tone={draft.hf_token_configured ? "ok" : "warn"}>{draft.hf_token_configured ? "HF token configured" : "HF token not configured"}</StatusPill>
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
          <h2>llama-swap Restart Control</h2>
          <StatusPill tone={draft.llama_swap_restart_enabled ? "warn" : "idle"}>{draft.llama_swap_restart_enabled ? "enabled" : "disabled"}</StatusPill>
        </div>
        <div className="callout warn">
          <div>
            <strong>
              <ShieldAlert size={16} aria-hidden="true" />
              Docker socket access is powerful
            </strong>
            <p>
              Enabling this lets the manager restart the configured llama-swap container through the mounted Docker socket. Keep this LAN-only and mount
              only the real Docker socket you intend to use.
            </p>
          </div>
        </div>
        <div className="form-grid">
          <div className="field">
            <span className="field-label">Restart opt-in</span>
            <label className="check-chip">
              <input
                type="checkbox"
                checked={draft.llama_swap_restart_enabled}
                onChange={(event) => update({ llama_swap_restart_enabled: event.target.checked })}
              />
              Enable llama-swap restart control
            </label>
          </div>
          <Field label="llama-swap container name">
            <input
              value={draft.llama_swap_container_name}
              onChange={(event) => update({ llama_swap_container_name: event.target.value })}
            />
          </Field>
          <Field label="Docker socket path">
            <input value={draft.docker_socket_path} onChange={(event) => update({ docker_socket_path: event.target.value })} />
          </Field>
          <Field label="Restart timeout seconds">
            <input
              type="number"
              min={1}
              max={300}
              value={draft.llama_swap_restart_timeout}
              onChange={(event) => update({ llama_swap_restart_timeout: Number(event.target.value) })}
            />
          </Field>
          <Field label="Manual action">
            <div className="static-field">
              <Power size={16} aria-hidden="true" />
              Restart button appears on Config Preview after this is enabled and the socket is reachable.
            </div>
          </Field>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Hugging Face</h2>
          <StatusPill tone={draft.hf_token_configured ? "ok" : "warn"}>{draft.hf_token_configured ? "Configured" : "Public only"}</StatusPill>
        </div>
        <div className="form-grid wide">
          <Field label="HF API token">
            <input
              type="password"
              value={hfToken}
              placeholder={draft.hf_token_configured ? "Configured; paste a new token to replace" : "hf_..."}
              autoComplete="off"
              onChange={(event) => setHfToken(event.target.value)}
            />
          </Field>
          <Field label="Token source">
            <input value={draft.hf_token_source || "not configured"} readOnly disabled />
          </Field>
        </div>
        <div className="inline-actions">
          <button className="button" type="button" onClick={() => saveToken.mutate(hfToken)} disabled={saveToken.isPending || !hfToken.trim()}>
            <KeyRound size={16} aria-hidden="true" />
            Save Token
          </button>
          <button className="button secondary" type="button" onClick={() => clearToken.mutate()} disabled={clearToken.isPending || !draft.hf_token_configured}>
            <Trash2 size={16} aria-hidden="true" />
            Clear Token
          </button>
        </div>
        <p className="field-hint">The token is saved to the manager env file and is never returned by the API.</p>
        {saveToken.error ? <p className="form-error">{saveToken.error.message}</p> : null}
        {clearToken.error ? <p className="form-error">{clearToken.error.message}</p> : null}
        {saveToken.isSuccess ? <p className="form-success">HF token saved.</p> : null}
        {clearToken.isSuccess ? <p className="form-success">HF token cleared.</p> : null}
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
          <Field label="Backup retention count" hint="0 keeps every config backup">
            <input type="number" value={draft.backup_retention_count} onChange={(event) => update({ backup_retention_count: Number(event.target.value) })} />
          </Field>
          <Field label="Backup retention days" hint="0 disables age-based cleanup">
            <input type="number" value={draft.backup_retention_days} onChange={(event) => update({ backup_retention_days: Number(event.target.value) })} />
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
        {save.error ? <p className="form-error">{save.error.message}</p> : null}
        {save.isSuccess ? <p className="form-success">Settings saved.</p> : null}
      </section>
    </div>
  );
}

function newSshRig(settings: ManagerSettings, existing: TargetRig[]): TargetRig {
  const used = new Set(existing.map((rig) => rig.id));
  let index = 1;
  let id = "rig-ssh";
  while (used.has(id)) {
    index += 1;
    id = `rig-ssh-${index}`;
  }
  return {
    id,
    name: "Remote llama-swap rig",
    mode: "ssh",
    host: "",
    port: 22,
    username: "n3kr0",
    ssh_key_path: "",
    model_root: settings.manager_model_root || "/models",
    llama_swap_model_root: settings.llama_swap_model_root || "/models",
    config_path: settings.llama_swap_config_path || "/app/config.yaml",
    backups_dir: settings.backups_dir || "/backups",
    download_temp_dir: "/tmp",
    restart_command: "docker restart llama-swap",
    health_check_command: "docker ps --filter name=llama-swap --format '{{.Names}} {{.Status}}'",
    enabled: true,
    is_default: false,
  };
}

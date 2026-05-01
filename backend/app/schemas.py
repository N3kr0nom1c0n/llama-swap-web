from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from .settings import ManagerSettings

ModelRole = Literal["reasoning", "chat", "vision", "coding", "aux"]
MatrixBehavior = Literal["runs_alone", "with_support", "support", "custom"]
SourceType = Literal["hf", "upload", "manual"]
JobStatus = Literal["queued", "running", "completed", "failed", "cancelled"]
ModelFileKind = Literal["gguf", "gguf_part", "mmproj", "chat_template", "tokenizer", "other"]
DestructiveChangeKind = Literal["model_removed", "matrix_removed", "hook_removed", "global_removed", "alias_removed"]
TargetRigMode = Literal["local", "ssh"]


DEFAULT_TARGET_RIG_ID = "default"


class TargetRig(BaseModel):
    id: str = DEFAULT_TARGET_RIG_ID
    name: str = "Local Manager Host"
    mode: TargetRigMode = "local"
    host: str = ""
    port: int = Field(default=22, ge=1, le=65535)
    username: str = ""
    ssh_key_path: str = ""
    model_root: str = "/models"
    llama_swap_model_root: str = "/models"
    config_path: str = "/app/config.yaml"
    backups_dir: str = "/backups"
    download_temp_dir: str = "/data/tmp"
    restart_command: str = "docker restart llama-swap"
    health_check_command: str = "true"
    enabled: bool = True
    is_default: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None


class GpuDevice(BaseModel):
    index: int
    name: str
    vram_gb: int
    role: str = ""
    notes: str = ""
    target_rig_id: str = DEFAULT_TARGET_RIG_ID


class GpuRecommendationRequest(BaseModel):
    target_rig_id: str = DEFAULT_TARGET_RIG_ID
    cuda_devices: list[int] = Field(default_factory=list)


class ManagedModel(BaseModel):
    id: str
    display_name: str
    target_rig_id: str = DEFAULT_TARGET_RIG_ID
    role: ModelRole = "chat"
    source_type: SourceType = "manual"
    hf_url: str = ""
    hf_revision: str = "main"
    manager_files: list[str] = Field(default_factory=list)
    container_files: list[str] = Field(default_factory=list)
    primary_model_file: str = ""
    mmproj_file: str = ""
    chat_template_file: str = ""
    tokenizer_files: list[str] = Field(default_factory=list)
    aliases: list[str] = Field(default_factory=list)
    ttl: int = 0
    gpu_devices: list[int] = Field(default_factory=list)
    main_gpu: int | None = None
    tensor_split: str = ""
    llama_flags: dict[str, Any] = Field(default_factory=dict)
    raw_cmd_override: str = ""
    matrix_key: str = ""
    matrix_behavior: MatrixBehavior = "with_support"
    matrix_expression: str = ""
    evict_cost: int | None = None
    startup_preload: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None


class HfResolveRequest(BaseModel):
    url: str
    revision: str = "main"


class HfTokenRequest(BaseModel):
    token: str


class HfFile(BaseModel):
    path: str
    kind: ModelFileKind
    selected: bool = False
    group: str = ""


class HfResolveResponse(BaseModel):
    repo_id: str
    revision: str
    direct_file: str = ""
    files: list[HfFile]


class ImportDraftRequest(BaseModel):
    target_rig_id: str = DEFAULT_TARGET_RIG_ID
    role: ModelRole
    source_type: SourceType
    hf_url: str = ""
    hf_revision: str = "main"
    selected_files: list[str] = Field(default_factory=list)
    desired_name: str = ""
    gpu_devices: list[int] = Field(default_factory=list)


class DownloadRequest(BaseModel):
    target_rig_id: str = DEFAULT_TARGET_RIG_ID
    repo_id: str
    revision: str = "main"
    files: list[str]
    destination_dir: str
    model_id: str = ""


class DownloadJob(BaseModel):
    id: str
    target_rig_id: str = DEFAULT_TARGET_RIG_ID
    status: JobStatus = "queued"
    repo_id: str = ""
    revision: str = "main"
    files: list[str] = Field(default_factory=list)
    destination_dir: str = ""
    container_dir: str = ""
    written_files: list[str] = Field(default_factory=list)
    container_files: list[str] = Field(default_factory=list)
    progress: float = 0
    bytes_downloaded: int = 0
    bytes_total: int = 0
    active_file: str = ""
    logs: list[str] = Field(default_factory=list)
    error: str = ""
    created_at: datetime | None = None
    updated_at: datetime | None = None


class CreateModelFromDownloadRequest(BaseModel):
    target_rig_id: str = DEFAULT_TARGET_RIG_ID
    id: str = ""
    display_name: str = ""
    role: ModelRole | None = None
    aliases: list[str] = Field(default_factory=list)
    ttl: int | None = None
    gpu_devices: list[int] = Field(default_factory=list)
    main_gpu: int | None = None
    tensor_split: str = ""
    matrix_key: str = ""
    matrix_behavior: MatrixBehavior = "with_support"
    matrix_expression: str = ""
    evict_cost: int | None = None
    startup_preload: bool = False


class FileInventoryItem(BaseModel):
    manager_path: str
    container_path: str
    relative_path: str
    kind: ModelFileKind
    size: int


class ConfigPreviewRequest(BaseModel):
    target_rig_id: str = DEFAULT_TARGET_RIG_ID
    model_ids: list[str] = Field(default_factory=list)


class DestructiveChange(BaseModel):
    kind: DestructiveChangeKind
    path: str
    before: str


class ConfigPreviewResponse(BaseModel):
    valid: bool
    stage_id: str = ""
    yaml: str
    diff: str
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    destructive_changes: list[DestructiveChange] = Field(default_factory=list)


class ConfigApplyRequest(BaseModel):
    target_rig_id: str = DEFAULT_TARGET_RIG_ID
    stage_id: str
    confirm_destructive: bool = False


class ConfigBackupMetadata(BaseModel):
    name: str
    path: str
    size: int
    modified: datetime


class ConfigRestoreRequest(BaseModel):
    target_rig_id: str = DEFAULT_TARGET_RIG_ID
    backup_name: str


class ConfigImportCandidate(BaseModel):
    id: str
    model: ManagedModel
    warnings: list[str] = Field(default_factory=list)


class ConfigImportRequest(BaseModel):
    target_rig_id: str = DEFAULT_TARGET_RIG_ID
    candidate_ids: list[str] = Field(default_factory=list)


class StateResponse(BaseModel):
    settings: dict
    target_rigs: list[TargetRig] = Field(default_factory=list)
    gpus: list[GpuDevice]
    model_count: int
    job_count: int
    config_status: dict


class SettingsResponse(BaseModel):
    settings: ManagerSettings
    hf_token_configured: bool

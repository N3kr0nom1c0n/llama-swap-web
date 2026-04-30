from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from .settings import ManagerSettings

ModelRole = Literal["reasoning", "chat", "vision", "coding", "aux"]
MatrixBehavior = Literal["runs_alone", "with_support", "support", "custom"]
SourceType = Literal["hf", "upload", "manual"]
JobStatus = Literal["queued", "running", "completed", "failed", "cancelled"]


class GpuDevice(BaseModel):
    index: int
    name: str
    vram_gb: int
    role: str = ""
    notes: str = ""


class ManagedModel(BaseModel):
    id: str
    display_name: str
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


class HfFile(BaseModel):
    path: str
    kind: Literal["gguf", "gguf_part", "mmproj", "chat_template", "tokenizer", "other"]
    selected: bool = False
    group: str = ""


class HfResolveResponse(BaseModel):
    repo_id: str
    revision: str
    direct_file: str = ""
    files: list[HfFile]


class ImportDraftRequest(BaseModel):
    role: ModelRole
    source_type: SourceType
    hf_url: str = ""
    hf_revision: str = "main"
    selected_files: list[str] = Field(default_factory=list)
    desired_name: str = ""
    gpu_devices: list[int] = Field(default_factory=list)


class DownloadRequest(BaseModel):
    repo_id: str
    revision: str = "main"
    files: list[str]
    destination_dir: str
    model_id: str = ""


class DownloadJob(BaseModel):
    id: str
    status: JobStatus = "queued"
    repo_id: str = ""
    revision: str = "main"
    files: list[str] = Field(default_factory=list)
    destination_dir: str = ""
    container_dir: str = ""
    written_files: list[str] = Field(default_factory=list)
    container_files: list[str] = Field(default_factory=list)
    progress: float = 0
    logs: list[str] = Field(default_factory=list)
    error: str = ""
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ConfigPreviewRequest(BaseModel):
    model_ids: list[str] = Field(default_factory=list)


class ConfigPreviewResponse(BaseModel):
    valid: bool
    stage_id: str = ""
    yaml: str
    diff: str
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class ConfigApplyRequest(BaseModel):
    stage_id: str


class StateResponse(BaseModel):
    settings: dict
    gpus: list[GpuDevice]
    model_count: int
    job_count: int
    config_status: dict


class SettingsResponse(BaseModel):
    settings: ManagerSettings
    hf_token_configured: bool

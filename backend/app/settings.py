from __future__ import annotations

import os
from pathlib import Path

from pydantic import BaseModel, Field


class RoleDirectories(BaseModel):
    reasoning: str = "/models/reasoning"
    chat: str = "/models/chat"
    vision: str = "/models/vision"
    coding: str = "/models/coding"
    aux: str = "/models/aux"


class Defaults(BaseModel):
    ttl_reasoning: int = 600
    ttl_chat: int = 0
    ttl_vision: int = 300
    ttl_aux: int = 0
    ctx_size: int = 65536
    cache_type_k: str = "q4_0"
    cache_type_v: str = "q4_0"
    flash_attn: str = "on"
    jinja: bool = True
    no_mmap: bool = True


class ManagerSettings(BaseModel):
    app_host: str = "0.0.0.0"
    app_port: int = 8081
    manager_model_root: str = "/models"
    llama_swap_model_root: str = "/models"
    llama_swap_config_path: str = "/app/config.yaml"
    backups_dir: str = "/backups"
    download_temp_dir: str = "/tmp"
    data_dir: str = "/data"
    default_revision: str = "main"
    max_parallel_downloads: int = 1
    disk_safety_gb: int = 20
    llama_server_cmd: str = "/app/llama-server"
    role_directories: RoleDirectories = Field(default_factory=RoleDirectories)
    defaults: Defaults = Field(default_factory=Defaults)

    @property
    def hf_token_configured(self) -> bool:
        return bool(os.getenv("HF_TOKEN"))

    def public_dict(self) -> dict:
        payload = self.model_dump()
        payload["hf_token_configured"] = self.hf_token_configured
        payload["hf_token"] = "***" if self.hf_token_configured else ""
        return payload


def settings_from_env() -> ManagerSettings:
    data_dir = os.getenv("DATA_DIR", "/data")
    return ManagerSettings(
        app_host=os.getenv("APP_HOST", "0.0.0.0"),
        app_port=int(os.getenv("APP_PORT", "8081")),
        manager_model_root=os.getenv("MANAGER_MODEL_ROOT", "/models"),
        llama_swap_model_root=os.getenv("LLAMA_SWAP_MODEL_ROOT", "/models"),
        llama_swap_config_path=os.getenv("LLAMA_SWAP_CONFIG_PATH", "/app/config.yaml"),
        backups_dir=os.getenv("BACKUPS_DIR", "/backups"),
        download_temp_dir=os.getenv("DOWNLOAD_TEMP_DIR", "/tmp"),
        data_dir=data_dir,
        max_parallel_downloads=int(os.getenv("MAX_PARALLEL_DOWNLOADS", "1")),
        disk_safety_gb=int(os.getenv("DISK_SAFETY_GB", "20")),
        llama_server_cmd=os.getenv("LLAMA_SERVER_CMD", "/app/llama-server"),
    )


def default_db_path(settings: ManagerSettings | None = None) -> Path:
    settings = settings or settings_from_env()
    configured = os.getenv("MANAGER_DB_PATH")
    if configured:
        return Path(configured)
    data_dir = Path(settings.data_dir)
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
        probe = data_dir / ".write-test"
        probe.write_text("", encoding="utf-8")
        probe.unlink(missing_ok=True)
    except OSError:
        data_dir = Path.cwd() / "data"
    return data_dir / "manager.db"

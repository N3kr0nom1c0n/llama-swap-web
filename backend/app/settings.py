from __future__ import annotations

import os
from pathlib import Path

from pydantic import BaseModel, Field


HF_TOKEN_KEY = "HF_TOKEN"


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
        return bool(get_hf_token(self))

    def public_dict(self) -> dict:
        payload = self.model_dump()
        payload["hf_token_configured"] = self.hf_token_configured
        payload["hf_token"] = "***" if self.hf_token_configured else ""
        payload["hf_token_source"] = hf_token_source(self)
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


def hf_token_env_file(settings: ManagerSettings | None = None) -> Path:
    configured = os.getenv("MANAGER_ENV_FILE") or os.getenv("HF_TOKEN_FILE")
    if configured:
        return Path(configured)
    app_env = Path("/app/.env")
    if app_env.exists() or app_env.parent.exists():
        return app_env
    settings = settings or settings_from_env()
    return Path(settings.data_dir) / ".env"


def get_hf_token(settings: ManagerSettings | None = None) -> str:
    file_token = _read_env_token(hf_token_env_file(settings))
    if file_token:
        return file_token
    return os.getenv(HF_TOKEN_KEY, "")


def hf_token_source(settings: ManagerSettings | None = None) -> str:
    file_path = hf_token_env_file(settings)
    if _read_env_token(file_path):
        return str(file_path)
    if os.getenv(HF_TOKEN_KEY):
        return "environment"
    return ""


def save_hf_token(token: str, settings: ManagerSettings | None = None) -> Path:
    token = token.strip()
    if not token:
        raise ValueError("HF token cannot be empty")
    if "\n" in token or "\r" in token:
        raise ValueError("HF token cannot contain newlines")
    path = hf_token_env_file(settings)
    _write_env_token(path, token)
    os.environ[HF_TOKEN_KEY] = token
    return path


def clear_hf_token(settings: ManagerSettings | None = None) -> Path:
    path = hf_token_env_file(settings)
    _write_env_token(path, "")
    os.environ.pop(HF_TOKEN_KEY, None)
    return path


def _read_env_token(path: Path) -> str:
    if not path.exists():
        return ""
    token = ""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return ""
    for line in lines:
        key, value = _parse_env_line(line)
        if key == HF_TOKEN_KEY:
            token = value
    return token


def _write_env_token(path: Path, token: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True) if path.exists() else []
    next_lines: list[str] = []
    replaced = False
    for line in lines:
        key, _value = _parse_env_line(line)
        if key == HF_TOKEN_KEY:
            replaced = True
            if token:
                next_lines.append(f"{HF_TOKEN_KEY}={token}\n")
            continue
        next_lines.append(line)
    if token and not replaced:
        if next_lines and not next_lines[-1].endswith("\n"):
            next_lines[-1] += "\n"
        next_lines.append(f"{HF_TOKEN_KEY}={token}\n")
    path.write_text("".join(next_lines), encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass


def _parse_env_line(line: str) -> tuple[str, str]:
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return "", ""
    if stripped.startswith("export "):
        stripped = stripped[7:].strip()
    if "=" not in stripped:
        return "", ""
    key, value = stripped.split("=", 1)
    key = key.strip()
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        value = value[1:-1]
    return key, value

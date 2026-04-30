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
    backup_retention_count: int = Field(default=0, ge=0)
    backup_retention_days: int = Field(default=0, ge=0)
    download_temp_dir: str = "/data/tmp"
    data_dir: str = "/data"
    default_revision: str = "main"
    max_parallel_downloads: int = 1
    max_upload_bytes: int = 50 * 1024 * 1024 * 1024
    allowed_upload_extensions: list[str] = Field(
        default_factory=lambda: [
            ".gguf",
            ".safetensors",
            ".json",
            ".jinja",
            ".jinja2",
            ".model",
            ".tiktoken",
        ]
    )
    cors_allowed_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:8081",
            "http://127.0.0.1:8081",
        ]
    )
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
        backup_retention_count=int(os.getenv("BACKUP_RETENTION_COUNT", "0")),
        backup_retention_days=int(os.getenv("BACKUP_RETENTION_DAYS", "0")),
        download_temp_dir=os.getenv("DOWNLOAD_TEMP_DIR", "/data/tmp"),
        data_dir=data_dir,
        max_parallel_downloads=int(os.getenv("MAX_PARALLEL_DOWNLOADS", "1")),
        max_upload_bytes=int(os.getenv("MAX_UPLOAD_BYTES", str(50 * 1024 * 1024 * 1024))),
        allowed_upload_extensions=_csv_env(
            "ALLOWED_UPLOAD_EXTENSIONS",
            [".gguf", ".safetensors", ".json", ".jinja", ".jinja2", ".model", ".tiktoken"],
        ),
        cors_allowed_origins=_csv_env(
            "CORS_ALLOWED_ORIGINS",
            ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8081", "http://127.0.0.1:8081"],
        ),
        disk_safety_gb=int(os.getenv("DISK_SAFETY_GB", "20")),
        llama_server_cmd=os.getenv("LLAMA_SERVER_CMD", "/app/llama-server"),
    )


def _csv_env(name: str, default: list[str]) -> list[str]:
    raw = os.getenv(name)
    if raw is None:
        return default
    return [item.strip() for item in raw.split(",") if item.strip()]


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
    file_has_key, file_token = _read_env_token_state(hf_token_env_file(settings))
    if file_has_key:
        return file_token
    return os.getenv(HF_TOKEN_KEY, "")


def hf_token_source(settings: ManagerSettings | None = None) -> str:
    file_path = hf_token_env_file(settings)
    file_has_key, file_token = _read_env_token_state(file_path)
    if file_token:
        return str(file_path)
    if file_has_key:
        return ""
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
    return path


def clear_hf_token(settings: ManagerSettings | None = None) -> Path:
    path = hf_token_env_file(settings)
    _write_env_token(path, "", keep_empty=True)
    return path


def _read_env_token(path: Path) -> str:
    return _read_env_token_state(path)[1]


def _read_env_token_state(path: Path) -> tuple[bool, str]:
    if not path.exists():
        return False, ""
    token = ""
    found = False
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return False, ""
    for line in lines:
        key, value = _parse_env_line(line)
        if key == HF_TOKEN_KEY:
            found = True
            token = value
    return found, token


def _write_env_token(path: Path, token: str, keep_empty: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True) if path.exists() else []
    next_lines: list[str] = []
    replaced = False
    for line in lines:
        key, _value = _parse_env_line(line)
        if key == HF_TOKEN_KEY:
            replaced = True
            if token or keep_empty:
                next_lines.append(f"{HF_TOKEN_KEY}={token}\n")
            continue
        next_lines.append(line)
    if (token or keep_empty) and not replaced:
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

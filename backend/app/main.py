from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime
from hashlib import sha256
from json import dumps, loads
from pathlib import Path

from fastapi import FastAPI, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from ruamel.yaml import YAML

from .config_service import backup_and_apply_config, manager_to_llama_path, preview_config, safe_join
from .database import Database
from .downloads import DownloadManager
from .hf_service import resolve_hf_url
from .schemas import (
    ConfigApplyRequest,
    ConfigPreviewRequest,
    CreateModelFromDownloadRequest,
    DownloadRequest,
    FileInventoryItem,
    GpuDevice,
    HfResolveRequest,
    HfTokenRequest,
    ImportDraftRequest,
    ManagedModel,
    StateResponse,
)
from .model_inventory import model_from_download, scan_model_files
from .settings import ManagerSettings, clear_hf_token, default_db_path, get_hf_token, save_hf_token

UPLOAD_CHUNK_SIZE = 1024 * 1024
STAGED_CONFIG_TTL_SECONDS = 15 * 60


def create_app(db_path: str | Path | None = None) -> FastAPI:
    db = Database(Path(db_path) if db_path else default_db_path())
    db.init()
    settings = db.get_settings()
    app = FastAPI(title="Llama-Swap Manager", version="0.1.0")
    app.state.db = db
    app.state.download_manager = DownloadManager(db, settings)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allowed_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/state", response_model=StateResponse)
    def state() -> StateResponse:
        settings = db.get_settings()
        config_path = Path(settings.llama_swap_config_path)
        return StateResponse(
            settings=settings.public_dict(),
            gpus=db.list_gpus(),
            model_count=len(db.list_models()),
            job_count=len(db.list_jobs()),
            config_status={
                "path": settings.llama_swap_config_path,
                "exists": config_path.exists(),
                "writable": os.access(config_path.parent if not config_path.exists() else config_path, os.W_OK),
            },
        )

    @app.get("/api/settings")
    def get_settings() -> dict:
        return db.get_settings().public_dict()

    @app.put("/api/settings")
    def put_settings(settings: ManagerSettings) -> dict:
        saved = db.save_settings(settings)
        app.state.download_manager.settings = saved
        return saved.public_dict()

    @app.put("/api/settings/hf-token")
    def put_hf_token(payload: HfTokenRequest) -> dict:
        token = payload.token
        try:
            save_hf_token(token, db.get_settings())
        except (OSError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return db.get_settings().public_dict()

    @app.delete("/api/settings/hf-token")
    def delete_hf_token() -> dict:
        try:
            clear_hf_token(db.get_settings())
        except OSError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return db.get_settings().public_dict()

    @app.get("/api/gpus", response_model=list[GpuDevice])
    def get_gpus() -> list[GpuDevice]:
        return db.list_gpus()

    @app.put("/api/gpus", response_model=list[GpuDevice])
    def put_gpus(gpus: list[GpuDevice]) -> list[GpuDevice]:
        return db.save_gpus(gpus)

    @app.post("/api/hf/resolve")
    def hf_resolve(payload: HfResolveRequest) -> dict:
        settings = db.get_settings()
        revision = payload.revision or settings.default_revision
        try:
            return resolve_hf_url(payload.url, revision=revision, token=get_hf_token(settings) or False).model_dump()
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/imports")
    def create_import(payload: ImportDraftRequest) -> dict:
        settings = db.get_settings()
        container_dir = getattr(settings.role_directories, payload.role)
        try:
            manager_dir = safe_join(settings.manager_model_root, Path(container_dir).relative_to(settings.llama_swap_model_root))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {
            "role": payload.role,
            "destination_dir": str(manager_dir),
            "container_dir": container_dir,
            "selected_files": payload.selected_files,
            "desired_name": payload.desired_name,
            "gpu_devices": payload.gpu_devices,
        }

    @app.post("/api/downloads")
    def start_download(payload: DownloadRequest) -> dict:
        return app.state.download_manager.start(payload).model_dump(mode="json")

    @app.get("/api/downloads")
    def list_downloads() -> list[dict]:
        return [job.model_dump(mode="json") for job in app.state.download_manager.list()]

    @app.get("/api/downloads/{job_id}")
    def get_download(job_id: str) -> dict:
        job = db.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="download job not found")
        return job.model_dump(mode="json")

    @app.post("/api/downloads/{job_id}/cancel")
    def cancel_download(job_id: str) -> dict:
        try:
            return app.state.download_manager.cancel(job_id).model_dump(mode="json")
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="download job not found") from exc

    @app.post("/api/downloads/{job_id}/retry")
    def retry_download(job_id: str) -> dict:
        try:
            return app.state.download_manager.retry(job_id).model_dump(mode="json")
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="download job not found") from exc

    @app.get("/api/models")
    def list_models() -> list[dict]:
        return [model.model_dump(mode="json") for model in db.list_models()]

    @app.get("/api/models/scan", response_model=list[FileInventoryItem])
    def scan_models() -> list[FileInventoryItem]:
        return scan_model_files(db.get_settings())

    @app.post("/api/models/from-download/{job_id}")
    def create_model_from_download(job_id: str, payload: CreateModelFromDownloadRequest) -> dict:
        job = db.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="download job not found")
        try:
            existing_ids = {model.id for model in db.list_models()}
            model = model_from_download(job, payload, db.get_settings(), existing_ids)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return db.save_model(model).model_dump(mode="json")

    @app.post("/api/models")
    def save_model(model: ManagedModel) -> dict:
        settings = db.get_settings()
        if model.manager_files and not model.container_files:
            try:
                model.container_files = [manager_to_llama_path(path, settings) for path in model.manager_files]
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
        if model.container_files and not model.primary_model_file:
            model.primary_model_file = model.container_files[0]
        return db.save_model(model).model_dump(mode="json")

    @app.post("/api/config/preview")
    def config_preview(payload: ConfigPreviewRequest | None = None) -> dict:
        payload = payload or ConfigPreviewRequest()
        settings = db.get_settings()
        all_models = db.list_models()
        models = _select_models_for_preview(all_models, payload.model_ids)
        current = _read_current_config(settings.llama_swap_config_path)
        preview = preview_config(current, models, settings)
        if preview.valid:
            preview.stage_id = str(uuid.uuid4())
            db.save_staged_config(
                preview.stage_id,
                preview.yaml,
                preview.diff,
                fingerprint=_stage_fingerprint(current, models, settings),
                model_ids=[model.id for model in models],
                ttl_seconds=STAGED_CONFIG_TTL_SECONDS,
            )
        return preview.model_dump()

    @app.post("/api/config/apply")
    def config_apply(payload: ConfigApplyRequest) -> dict:
        staged = db.get_staged_config(payload.stage_id)
        if not staged:
            raise HTTPException(status_code=404, detail="staged config not found; regenerate preview before applying")
        settings = db.get_settings()
        _validate_staged_config_for_apply(db, staged, settings)
        if not db.claim_staged_config(payload.stage_id):
            raise HTTPException(status_code=409, detail="staged config was already applied; regenerate preview")
        try:
            backup = backup_and_apply_config(settings.llama_swap_config_path, settings.backups_dir, staged["yaml"])
        except (OSError, ValueError) as exc:
            raise HTTPException(status_code=409, detail=f"could not apply staged config: {exc}") from exc
        return {
            "applied": True,
            "backup": str(backup),
            "restart_required": True,
            "restart_note": "Config applied. Restart llama-swap manually: docker compose restart llama-swap",
        }

    @app.post("/api/uploads")
    async def upload_file(role: str, file: UploadFile, model_name: str = "") -> dict:
        settings = db.get_settings()
        if role not in type(settings.role_directories).model_fields:
            raise HTTPException(status_code=400, detail="invalid role")
        role_dir = getattr(settings.role_directories, role)
        try:
            role_root = safe_join(settings.manager_model_root, Path(role_dir).relative_to(settings.llama_swap_model_root))
            destination = _safe_upload_destination(
                role_root,
                file.filename or "",
                model_name,
                settings.allowed_upload_extensions,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        destination.parent.mkdir(parents=True, exist_ok=True)
        temp_destination = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.uploading")
        bytes_written = 0
        try:
            with temp_destination.open("wb") as output:
                while chunk := await file.read(UPLOAD_CHUNK_SIZE):
                    bytes_written += len(chunk)
                    if bytes_written > settings.max_upload_bytes:
                        raise HTTPException(status_code=413, detail="upload exceeds max_upload_bytes")
                    output.write(chunk)
            os.replace(temp_destination, destination)
        except HTTPException:
            temp_destination.unlink(missing_ok=True)
            raise
        except OSError as exc:
            temp_destination.unlink(missing_ok=True)
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"manager_path": str(destination), "container_path": manager_to_llama_path(str(destination), settings)}

    @app.get("/api/health")
    def health(response: Response) -> dict:
        settings = db.get_settings()
        payload = {
            "app": {"status": "ok", "version": app.version},
            "db": _path_status(db.path),
            "config": _path_status(Path(settings.llama_swap_config_path)),
            "model_root": _path_status(Path(settings.manager_model_root)),
            "backups": _path_status(Path(settings.backups_dir)),
        }
        healthy = (
            payload["db"]["writable"]
            and payload["config"]["exists"]
            and not payload["config"]["is_dir"]
            and payload["config"]["writable"]
            and payload["model_root"]["exists"]
            and payload["model_root"]["is_dir"]
            and payload["model_root"]["writable"]
            and payload["backups"]["exists"]
            and payload["backups"]["is_dir"]
            and payload["backups"]["writable"]
        )
        payload["status"] = "ok" if healthy else "degraded"
        if not healthy:
            response.status_code = 503
        return payload

    @app.get("/api/events")
    async def events() -> StreamingResponse:
        async def stream():
            yield "event: ready\ndata: {}\n\n"

        return StreamingResponse(stream(), media_type="text/event-stream")

    static_dir = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    if static_dir.exists():
        assets_dir = static_dir / "assets"
        if assets_dir.exists():
            app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        def frontend(full_path: str) -> FileResponse:
            if full_path == "api" or full_path.startswith("api/"):
                raise HTTPException(status_code=404, detail="Not Found")
            requested = static_dir / full_path
            if full_path and requested.exists() and requested.is_file():
                return FileResponse(requested)
            return FileResponse(static_dir / "index.html")

    return app


app = create_app()


def _safe_upload_destination(role_root: Path, filename: str, model_name: str, allowed_extensions: list[str]) -> Path:
    raw_name = filename.strip()
    if not raw_name:
        raise ValueError("upload filename is required")
    candidate_name = Path(_safe_path_component(raw_name, "upload filename"))
    allowed = {extension.lower() for extension in allowed_extensions}
    if candidate_name.suffix.lower() not in allowed:
        raise ValueError("unsupported upload extension")
    model_dir = _safe_path_component(model_name.strip() or candidate_name.stem, "model directory")
    destination = safe_join(role_root, model_dir, raw_name)
    if destination.is_symlink():
        raise ValueError("upload destination cannot be a symlink")
    if destination.exists() and not destination.is_file():
        raise ValueError("upload destination is not a file")
    return destination


def _safe_path_component(value: str, label: str) -> str:
    if not value:
        raise ValueError(f"{label} is required")
    candidate = Path(value)
    if candidate.is_absolute() or candidate.name != value or "\\" in value or value in {".", ".."}:
        raise ValueError(f"{label} must be a safe basename")
    if ".." in candidate.parts:
        raise ValueError(f"{label} cannot contain traversal")
    return value


def _path_status(path: Path) -> dict:
    target = path if path.exists() else path.parent
    return {
        "path": str(path),
        "exists": path.exists(),
        "is_dir": path.is_dir(),
        "readable": os.access(path, os.R_OK) if path.exists() else False,
        "writable": os.access(target, os.W_OK),
    }


def _select_models_for_preview(models: list[ManagedModel], model_ids: list[str]) -> list[ManagedModel]:
    if not model_ids:
        return models
    by_id = {model.id: model for model in models}
    missing = sorted(set(model_ids) - set(by_id))
    if missing:
        raise HTTPException(status_code=400, detail=f"unknown model id(s): {', '.join(missing)}")
    requested = set(model_ids)
    return [model for model in models if model.id in requested]


def _read_current_config(config_path: str) -> str:
    path = Path(config_path)
    if not path.exists():
        return ""
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        raise HTTPException(status_code=400, detail=f"could not read current config: {exc}") from exc


def _validate_staged_config_for_apply(db: Database, staged: dict, settings: ManagerSettings) -> None:
    if staged.get("applied_at"):
        raise HTTPException(status_code=409, detail="staged config was already applied; regenerate preview")
    try:
        current = _read_current_config(settings.llama_swap_config_path)
    except HTTPException as exc:
        if exc.status_code == 400:
            raise HTTPException(status_code=409, detail=f"could not validate current config: {exc.detail}") from exc
        raise
    staged_yaml = str(staged.get("yaml") or "")
    if _model_keys(current) and not _model_keys(staged_yaml):
        raise HTTPException(status_code=409, detail="destructive empty models config blocked; regenerate preview")
    if not staged.get("expires_at") or not staged.get("fingerprint"):
        raise HTTPException(status_code=409, detail="staged config is missing freshness metadata; regenerate preview")
    expires_at = _parse_timestamp(staged.get("expires_at"))
    if expires_at and expires_at <= datetime.now(UTC):
        raise HTTPException(status_code=409, detail="staged config expired; regenerate preview")
    fingerprint = str(staged.get("fingerprint") or "")
    if fingerprint:
        models = _models_for_stage(db, staged)
        current_fingerprint = _stage_fingerprint(current, models, settings)
        if current_fingerprint != fingerprint:
            raise HTTPException(status_code=409, detail="staged config is stale; regenerate preview")


def _models_for_stage(db: Database, staged: dict) -> list[ManagedModel]:
    try:
        raw_model_ids = loads(staged.get("model_ids") or "[]")
        if not isinstance(raw_model_ids, list):
            raise ValueError("model_ids must be a list")
        model_ids = [str(model_id) for model_id in raw_model_ids]
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=409, detail="staged config metadata is invalid; regenerate preview") from exc
    models = db.list_models()
    if not model_ids:
        return []
    by_id = {model.id: model for model in models}
    missing = sorted(set(model_ids) - set(by_id))
    if missing:
        raise HTTPException(status_code=409, detail=f"staged config references missing model(s): {', '.join(missing)}")
    requested = set(model_ids)
    return [model for model in models if model.id in requested]


def _stage_fingerprint(current_yaml: str, models: list[ManagedModel], settings: ManagerSettings) -> str:
    payload = {
        "current_yaml_sha256": sha256(current_yaml.encode("utf-8")).hexdigest(),
        "models": [model.model_dump(mode="json") for model in sorted(models, key=lambda item: item.id)],
        "settings": settings.model_dump(mode="json"),
    }
    return sha256(dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def _model_keys(yaml_text: str) -> set[str]:
    if not yaml_text.strip():
        return set()
    try:
        document = YAML().load(yaml_text) or {}
    except Exception:
        return set()
    models = document.get("models") if isinstance(document, dict) else {}
    return {str(key) for key in models.keys()} if isinstance(models, dict) else set()


def _parse_timestamp(value: object) -> datetime | None:
    if not value:
        return None
    try:
        timestamp = datetime.fromisoformat(str(value))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=409, detail="staged config metadata is invalid; regenerate preview") from exc
    return timestamp if timestamp.tzinfo else timestamp.replace(tzinfo=UTC)

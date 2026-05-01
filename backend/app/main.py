from __future__ import annotations

import os
import posixpath
import re
import tempfile
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

from .config_service import (
    backup_and_apply_config,
    detect_destructive_changes,
    manager_to_llama_path,
    preview_config,
    safe_join,
)
from .config_import import import_candidates_from_config
from .database import Database
from .downloads import DownloadManager
from .gpu_service import detect_gpus, gpu_status, recommend_tensor_split, validate_gpu_plan
from .hf_service import resolve_hf_url
from .schemas import (
    ConfigApplyRequest,
    ConfigImportRequest,
    ConfigPreviewRequest,
    ConfigRestoreRequest,
    CreateModelFromDownloadRequest,
    DEFAULT_TARGET_RIG_ID,
    DownloadRequest,
    FileInventoryItem,
    GpuDevice,
    GpuRecommendationRequest,
    HfResolveRequest,
    HfTokenRequest,
    ImportDraftRequest,
    ManagedModel,
    StateResponse,
    TargetRig,
)
from .model_inventory import model_from_download
from .restart_service import LlamaSwapRestartError, get_llama_swap_status, restart_llama_swap
from .settings import ManagerSettings, clear_hf_token, default_db_path, get_hf_token, save_hf_token
from .target_rig_service import TargetRigError, container_path_for_target_path, create_target_client, effective_settings_for_rig, target_path_for_container_path

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
    def state(target_rig_id: str = DEFAULT_TARGET_RIG_ID) -> StateResponse:
        settings = db.get_settings()
        rig = _target_rig_or_404(db, target_rig_id)
        client = create_target_client(rig, settings)
        config_status = client.path_status(rig.config_path)
        return StateResponse(
            settings=settings.public_dict(),
            target_rigs=db.list_target_rigs(),
            gpus=db.list_gpus(rig.id),
            model_count=len(db.list_models(rig.id)),
            job_count=len(db.list_jobs(rig.id)),
            config_status=config_status,
        )

    @app.get("/api/target-rigs")
    def list_target_rigs() -> list[dict]:
        return [rig.model_dump(mode="json") for rig in db.list_target_rigs()]

    @app.post("/api/target-rigs")
    def save_target_rig(rig: TargetRig) -> dict:
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}", rig.id):
            raise HTTPException(status_code=400, detail="target rig id must be a safe slug")
        if rig.mode == "ssh" and (not rig.host or not rig.username):
            raise HTTPException(status_code=400, detail="SSH target rigs require host and username")
        return db.save_target_rig(rig).model_dump(mode="json")

    @app.get("/api/target-rigs/{target_rig_id}/health")
    def target_rig_health(target_rig_id: str) -> dict:
        settings = db.get_settings()
        rig = _target_rig_or_404(db, target_rig_id)
        client = create_target_client(rig, settings)
        return {
            "rig": rig.model_dump(mode="json"),
            "model_root": client.path_status(rig.model_root),
            "config": client.path_status(rig.config_path),
            "backups": client.path_status(rig.backups_dir),
            "runtime": client.runtime_status(),
        }

    @app.get("/api/settings")
    def get_settings() -> dict:
        return db.get_settings().public_dict()

    @app.put("/api/settings")
    def put_settings(settings: ManagerSettings) -> dict:
        saved = db.save_settings(settings)
        app.state.download_manager.update_settings(saved)
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

    @app.get("/api/llama-swap/status")
    def llama_swap_status(target_rig_id: str = DEFAULT_TARGET_RIG_ID) -> dict:
        settings = db.get_settings()
        rig = _target_rig_or_404(db, target_rig_id)
        if rig.mode == "ssh":
            return create_target_client(rig, settings).runtime_status()
        return get_llama_swap_status(settings)

    @app.post("/api/llama-swap/restart")
    def llama_swap_restart(target_rig_id: str = DEFAULT_TARGET_RIG_ID) -> dict:
        try:
            settings = db.get_settings()
            rig = _target_rig_or_404(db, target_rig_id)
            if rig.mode == "ssh":
                return create_target_client(rig, settings).restart()
            return restart_llama_swap(settings)
        except (LlamaSwapRestartError, TargetRigError) as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.get("/api/gpus", response_model=list[GpuDevice])
    def get_gpus(target_rig_id: str = DEFAULT_TARGET_RIG_ID) -> list[GpuDevice]:
        return db.list_gpus(target_rig_id)

    @app.put("/api/gpus", response_model=list[GpuDevice])
    def put_gpus(gpus: list[GpuDevice], target_rig_id: str = DEFAULT_TARGET_RIG_ID) -> list[GpuDevice]:
        return db.save_gpus(gpus, target_rig_id)

    @app.get("/api/gpus/detect")
    def detect_cuda_gpus(target_rig_id: str = DEFAULT_TARGET_RIG_ID) -> dict:
        settings = db.get_settings()
        rig = _target_rig_or_404(db, target_rig_id)
        detected = create_target_client(rig, settings).detect_gpus() if rig.mode == "ssh" else detect_gpus()
        if not detected.get("available"):
            return detected
        saved = {gpu.index: gpu for gpu in db.list_gpus(rig.id)}
        merged = []
        for gpu in detected["gpus"]:
            saved_gpu = saved.get(int(gpu["index"]))
            merged.append(
                {
                    **gpu,
                    "role": saved_gpu.role if saved_gpu else "",
                    "notes": saved_gpu.notes if saved_gpu else "",
                }
            )
        return {**detected, "gpus": merged}

    @app.get("/api/gpus/status")
    def cuda_gpu_status(target_rig_id: str = DEFAULT_TARGET_RIG_ID) -> dict:
        settings = db.get_settings()
        rig = _target_rig_or_404(db, target_rig_id)
        return create_target_client(rig, settings).gpu_status() if rig.mode == "ssh" else gpu_status()

    @app.post("/api/gpus/recommend")
    def recommend_cuda_plan(payload: GpuRecommendationRequest) -> dict:
        settings = db.get_settings()
        rig = _target_rig_or_404(db, payload.target_rig_id)
        detected = create_target_client(rig, settings).detect_gpus() if rig.mode == "ssh" else detect_gpus()
        selected = payload.cuda_devices
        if not detected.get("available"):
            return {
                "available": False,
                "reason": detected.get("reason", "GPU detection unavailable"),
                "recommendation": {
                    "cuda_devices": selected,
                    "main_gpu": selected[0] if selected else None,
                    "tensor_split": "",
                    "warnings": [detected.get("reason", "GPU detection unavailable")],
                },
            }
        recommendation = recommend_tensor_split(detected["gpus"], selected)
        recommendation["warnings"] = [
            *recommendation.get("warnings", []),
            *validate_gpu_plan(recommendation["cuda_devices"], recommendation["main_gpu"], recommendation["tensor_split"]),
        ]
        return {"available": True, "reason": "", "recommendation": recommendation}

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
        rig = _target_rig_or_404(db, payload.target_rig_id)
        rig_settings = effective_settings_for_rig(settings, rig)
        container_dir = getattr(rig_settings.role_directories, payload.role)
        try:
            model_dir = _import_model_directory(payload)
            manager_dir = target_path_for_container_path(rig, str(Path(container_dir) / model_dir).replace("\\", "/"))
            llama_dir = str(Path(container_dir) / model_dir).replace("\\", "/")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {
            "target_rig_id": rig.id,
            "role": payload.role,
            "destination_dir": str(manager_dir),
            "container_dir": llama_dir,
            "selected_files": payload.selected_files,
            "desired_name": payload.desired_name,
            "gpu_devices": payload.gpu_devices,
        }

    @app.post("/api/downloads")
    def start_download(payload: DownloadRequest) -> dict:
        return app.state.download_manager.start(payload).model_dump(mode="json")

    @app.get("/api/downloads")
    def list_downloads(target_rig_id: str | None = None) -> list[dict]:
        return [job.model_dump(mode="json") for job in db.list_jobs(target_rig_id)]

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

    @app.delete("/api/downloads/terminal")
    def cleanup_terminal_downloads(target_rig_id: str | None = None) -> dict:
        return {"removed": app.state.download_manager.cleanup_terminal_jobs(target_rig_id)}

    @app.get("/api/models")
    def list_models(target_rig_id: str = DEFAULT_TARGET_RIG_ID) -> list[dict]:
        return [model.model_dump(mode="json") for model in db.list_models(target_rig_id)]

    @app.get("/api/models/scan", response_model=list[FileInventoryItem])
    def scan_models(target_rig_id: str = DEFAULT_TARGET_RIG_ID) -> list[FileInventoryItem]:
        settings = db.get_settings()
        rig = _target_rig_or_404(db, target_rig_id)
        return create_target_client(rig, settings).scan_model_files()

    @app.post("/api/models/from-download/{job_id}")
    def create_model_from_download(job_id: str, payload: CreateModelFromDownloadRequest) -> dict:
        job = db.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="download job not found")
        try:
            settings = db.get_settings()
            rig = _target_rig_or_404(db, job.target_rig_id)
            client = create_target_client(rig, settings)
            existing_ids = {model.id for model in db.list_models(job.target_rig_id)}
            model = model_from_download(job, payload, effective_settings_for_rig(settings, rig), existing_ids, file_exists=client.is_file)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return db.save_model(model).model_dump(mode="json")

    @app.post("/api/models")
    def save_model(model: ManagedModel) -> dict:
        settings = db.get_settings()
        rig = _target_rig_or_404(db, model.target_rig_id)
        effective_settings = effective_settings_for_rig(settings, rig)
        if model.manager_files and not model.container_files:
            try:
                model.container_files = [manager_to_llama_path(path, effective_settings) for path in model.manager_files]
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
        if model.container_files and not model.primary_model_file:
            model.primary_model_file = model.container_files[0]
        return db.save_model(model).model_dump(mode="json")

    @app.post("/api/config/preview")
    def config_preview(payload: ConfigPreviewRequest | None = None) -> dict:
        payload = payload or ConfigPreviewRequest()
        settings = db.get_settings()
        rig = _target_rig_or_404(db, payload.target_rig_id)
        client = create_target_client(rig, settings)
        effective_settings = effective_settings_for_rig(settings, rig)
        all_models = db.list_models(rig.id)
        models = _select_models_for_preview(all_models, payload.model_ids)
        current = _read_current_config_from_target(client, rig.config_path)
        preview = preview_config(current, models, effective_settings, validate_local_paths=rig.mode == "local")
        if rig.mode == "ssh":
            preview.errors.extend(_target_runtime_path_errors(client, rig, effective_settings))
            preview.valid = not preview.errors
        if preview.valid:
            preview.stage_id = str(uuid.uuid4())
            db.save_staged_config(
                preview.stage_id,
                preview.yaml,
                preview.diff,
                fingerprint=_stage_fingerprint(current, models, effective_settings),
                model_ids=[model.id for model in models],
                target_rig_id=rig.id,
                ttl_seconds=STAGED_CONFIG_TTL_SECONDS,
            )
        return preview.model_dump()

    @app.post("/api/config/apply")
    def config_apply(payload: ConfigApplyRequest) -> dict:
        staged = db.get_staged_config(payload.stage_id)
        if not staged:
            raise HTTPException(status_code=404, detail="staged config not found; regenerate preview before applying")
        settings = db.get_settings()
        rig = _target_rig_or_404(db, str(staged.get("target_rig_id") or payload.target_rig_id or DEFAULT_TARGET_RIG_ID))
        client = create_target_client(rig, settings)
        effective_settings = effective_settings_for_rig(settings, rig)
        _validate_staged_config_for_apply(db, staged, effective_settings, client, rig.config_path, confirm_destructive=payload.confirm_destructive)
        if not db.claim_staged_config(payload.stage_id):
            raise HTTPException(status_code=409, detail="staged config was already applied; regenerate preview")
        try:
            if rig.mode == "local":
                backup = backup_and_apply_config(
                    rig.config_path,
                    rig.backups_dir,
                    staged["yaml"],
                    retention_count=effective_settings.backup_retention_count,
                    retention_days=effective_settings.backup_retention_days,
                )
            else:
                backup = client.apply_config(
                    staged["yaml"],
                    retention_count=effective_settings.backup_retention_count,
                    retention_days=effective_settings.backup_retention_days,
                )
        except (OSError, ValueError, TargetRigError) as exc:
            raise HTTPException(status_code=409, detail=f"could not apply staged config: {exc}") from exc
        return {
            "applied": True,
            "backup": str(backup),
            "restart_required": True,
            "restart_note": "Config applied. Restart llama-swap manually: docker compose restart llama-swap",
        }

    @app.get("/api/config/backups")
    def config_backups(target_rig_id: str = DEFAULT_TARGET_RIG_ID) -> list[dict]:
        try:
            settings = db.get_settings()
            rig = _target_rig_or_404(db, target_rig_id)
            return [backup.model_dump(mode="json") for backup in create_target_client(rig, settings).list_backups()]
        except (OSError, ValueError, TargetRigError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/config/restore")
    def config_restore(payload: ConfigRestoreRequest) -> dict:
        settings = db.get_settings()
        rig = _target_rig_or_404(db, payload.target_rig_id)
        client = create_target_client(rig, settings)
        try:
            current_backup = client.restore_config(payload.backup_name)
        except (OSError, ValueError, TargetRigError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {
            "restored": True,
            "source_backup": payload.backup_name,
            "current_backup": str(current_backup),
            "restart_required": True,
            "restart_note": "Config restored. Restart llama-swap manually: docker compose restart llama-swap",
        }

    @app.get("/api/config/import-candidates")
    def config_import_candidates(target_rig_id: str = DEFAULT_TARGET_RIG_ID) -> list[dict]:
        settings = db.get_settings()
        rig = _target_rig_or_404(db, target_rig_id)
        effective_settings = effective_settings_for_rig(settings, rig)
        current = _read_current_config_from_target(create_target_client(rig, settings), rig.config_path)
        candidates = import_candidates_from_config(current, effective_settings)
        return [candidate.model_dump(mode="json") for candidate in candidates]

    @app.post("/api/config/import-candidates")
    def config_import_selected(payload: ConfigImportRequest) -> list[dict]:
        settings = db.get_settings()
        rig = _target_rig_or_404(db, payload.target_rig_id)
        effective_settings = effective_settings_for_rig(settings, rig)
        current = _read_current_config_from_target(create_target_client(rig, settings), rig.config_path)
        candidates = import_candidates_from_config(current, effective_settings)
        selected_ids = set(payload.candidate_ids)
        selected = [candidate for candidate in candidates if not selected_ids or candidate.id in selected_ids]
        imported = []
        existing_ids = {model.id for model in db.list_models(rig.id)}
        for candidate in selected:
            model = candidate.model
            model.id = _unique_import_id(model.id, existing_ids)
            model.target_rig_id = rig.id
            imported.append(db.save_model(model).model_dump(mode="json"))
            existing_ids.add(model.id)
        return imported

    @app.post("/api/uploads")
    async def upload_file(role: str, file: UploadFile, model_name: str = "", target_rig_id: str = DEFAULT_TARGET_RIG_ID) -> dict:
        settings = db.get_settings()
        rig = _target_rig_or_404(db, target_rig_id)
        effective_settings = effective_settings_for_rig(settings, rig)
        client = create_target_client(rig, settings)
        if role not in type(settings.role_directories).model_fields:
            raise HTTPException(status_code=400, detail="invalid role")
        role_dir = getattr(effective_settings.role_directories, role)
        try:
            target_role_root = target_path_for_container_path(rig, role_dir)
            if rig.mode == "local":
                destination = _safe_upload_destination(
                    Path(target_role_root),
                    file.filename or "",
                    model_name,
                    settings.allowed_upload_extensions,
                )
            else:
                destination = _safe_remote_upload_destination(
                    target_role_root,
                    file.filename or "",
                    model_name,
                    settings.allowed_upload_extensions,
                )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        temp_root = Path(rig.download_temp_dir if rig.mode == "local" else settings.download_temp_dir)
        try:
            temp_root.mkdir(parents=True, exist_ok=True)
        except OSError:
            temp_root = Path(tempfile.gettempdir()) / "llama-swap-manager-uploads"
            temp_root.mkdir(parents=True, exist_ok=True)
        temp_destination = temp_root / f"{uuid.uuid4().hex}-{Path(str(destination)).name}.uploading"
        bytes_written = 0
        try:
            with temp_destination.open("wb") as output:
                while chunk := await file.read(UPLOAD_CHUNK_SIZE):
                    bytes_written += len(chunk)
                    if bytes_written > settings.max_upload_bytes:
                        raise HTTPException(status_code=413, detail="upload exceeds max_upload_bytes")
                    output.write(chunk)
            written_path = client.upload_file(temp_destination, str(destination))
        except HTTPException:
            temp_destination.unlink(missing_ok=True)
            raise
        except (OSError, TargetRigError) as exc:
            temp_destination.unlink(missing_ok=True)
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        finally:
            temp_destination.unlink(missing_ok=True)
        return {"manager_path": written_path, "container_path": container_path_for_target_path(rig, written_path)}

    @app.get("/api/health")
    def health(response: Response, target_rig_id: str = DEFAULT_TARGET_RIG_ID) -> dict:
        settings = db.get_settings()
        rig = _target_rig_or_404(db, target_rig_id)
        client = create_target_client(rig, settings)
        payload = {
            "app": {"status": "ok", "version": app.version},
            "db": _path_status(db.path),
            "target_rig": rig.model_dump(mode="json"),
            "config": client.path_status(rig.config_path),
            "model_root": client.path_status(rig.model_root),
            "backups": client.path_status(rig.backups_dir),
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


def _safe_remote_upload_destination(role_root: str, filename: str, model_name: str, allowed_extensions: list[str]) -> str:
    raw_name = filename.strip()
    if not raw_name:
        raise ValueError("upload filename is required")
    candidate_name = Path(_safe_path_component(raw_name, "upload filename"))
    allowed = {extension.lower() for extension in allowed_extensions}
    if candidate_name.suffix.lower() not in allowed:
        raise ValueError("unsupported upload extension")
    model_dir = _safe_path_component(model_name.strip() or candidate_name.stem, "model directory")
    root = posixpath.normpath(role_root)
    if not root.startswith("/"):
        raise ValueError("remote upload root must be absolute")
    destination = posixpath.normpath(posixpath.join(root, model_dir, raw_name))
    root_prefix = root.rstrip("/") + "/"
    if destination != root and not destination.startswith(root_prefix):
        raise ValueError(f"path escapes allowed root: {destination}")
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


def _import_model_directory(payload: ImportDraftRequest) -> str:
    raw_name = payload.desired_name.strip()
    if not raw_name and payload.hf_url:
        raw_name = payload.hf_url.rstrip("/").split("/")[-1]
    if not raw_name and payload.selected_files:
        raw_name = Path(payload.selected_files[0]).stem
    slug = re.sub(r"-+", "-", re.sub(r"[^a-zA-Z0-9._-]+", "-", raw_name or "model")).strip("-._")
    return _safe_path_component(slug or "model", "model directory")


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


def _unique_import_id(base_id: str, existing_ids: set[str]) -> str:
    candidate = base_id or "imported-model"
    if candidate not in existing_ids:
        return candidate
    counter = 2
    while f"{candidate}-{counter}" in existing_ids:
        counter += 1
    return f"{candidate}-{counter}"


def _read_current_config(config_path: str) -> str:
    path = Path(config_path)
    if not path.exists():
        return ""
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        raise HTTPException(status_code=400, detail=f"could not read current config: {exc}") from exc


def _target_rig_or_404(db: Database, target_rig_id: str | None) -> TargetRig:
    rig = db.get_target_rig(target_rig_id or DEFAULT_TARGET_RIG_ID)
    if not rig:
        raise HTTPException(status_code=404, detail=f"target rig not found: {target_rig_id or DEFAULT_TARGET_RIG_ID}")
    if not rig.enabled:
        raise HTTPException(status_code=409, detail=f"target rig is disabled: {rig.id}")
    return rig


def _read_current_config_from_target(client, config_path: str) -> str:
    try:
        return client.read_text(config_path)
    except (OSError, TargetRigError) as exc:
        raise HTTPException(status_code=400, detail=f"could not read current config: {exc}") from exc


def _target_runtime_path_errors(client, rig: TargetRig, settings: ManagerSettings) -> list[str]:
    errors: list[str] = []

    def status(path: str) -> dict:
        return client.path_status(path)

    try:
        model_root = status(rig.model_root)
        if not model_root.get("exists"):
            errors.append(f"manager model root does not exist on target rig: {rig.model_root}")
        elif not model_root.get("is_dir"):
            errors.append(f"manager model root is not a directory on target rig: {rig.model_root}")
        elif not model_root.get("writable"):
            errors.append(f"manager model root is not writable on target rig: {rig.model_root}")
        else:
            free_gb = client.disk_free_bytes(rig.model_root) / (1024**3)
            if free_gb < settings.disk_safety_gb:
                errors.append(f"manager model root free space {free_gb:.1f}GB is below safety floor {settings.disk_safety_gb}GB")

        for label, path in [("backup directory", rig.backups_dir), ("download temp directory", rig.download_temp_dir)]:
            path_status = status(path)
            if path_status.get("exists") and not path_status.get("is_dir"):
                errors.append(f"{label} is not a directory on target rig: {path}")
            elif path_status.get("exists") and not path_status.get("writable"):
                errors.append(f"{label} is not writable on target rig: {path}")
            elif not path_status.get("exists") and not path_status.get("writable"):
                errors.append(f"{label} parent directory is not writable on target rig: {posixpath.dirname(path)}")

        config_status = status(rig.config_path)
        if config_status.get("exists") and config_status.get("is_dir"):
            errors.append(f"config path is a directory on target rig: {rig.config_path}")
        elif config_status.get("exists") and not config_status.get("writable"):
            errors.append(f"config file is not writable on target rig: {rig.config_path}")
        elif not config_status.get("exists") and not config_status.get("writable"):
            errors.append(f"config parent directory is not writable on target rig: {posixpath.dirname(rig.config_path)}")
    except (OSError, ValueError, TargetRigError) as exc:
        errors.append(f"target rig path validation failed: {exc}")
    return errors


def _validate_staged_config_for_apply(
    db: Database,
    staged: dict,
    settings: ManagerSettings,
    client,
    config_path: str,
    confirm_destructive: bool = False,
) -> None:
    if staged.get("applied_at"):
        raise HTTPException(status_code=409, detail="staged config was already applied; regenerate preview")
    try:
        current = _read_current_config_from_target(client, config_path)
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
    if not confirm_destructive:
        try:
            destructive_changes = detect_destructive_changes(current, staged_yaml)
        except Exception as exc:
            raise HTTPException(status_code=409, detail=f"could not validate destructive config diff: {exc}") from exc
        if destructive_changes:
            raise HTTPException(
                status_code=409,
                detail=f"destructive config changes blocked; confirm destructive apply to continue ({len(destructive_changes)} change(s))",
            )


def _models_for_stage(db: Database, staged: dict) -> list[ManagedModel]:
    try:
        raw_model_ids = loads(staged.get("model_ids") or "[]")
        if not isinstance(raw_model_ids, list):
            raise ValueError("model_ids must be a list")
        model_ids = [str(model_id) for model_id in raw_model_ids]
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=409, detail="staged config metadata is invalid; regenerate preview") from exc
    models = db.list_models(str(staged.get("target_rig_id") or DEFAULT_TARGET_RIG_ID))
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

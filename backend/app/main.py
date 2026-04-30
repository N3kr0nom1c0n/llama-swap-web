from __future__ import annotations

import os
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .config_service import backup_and_apply_config, manager_to_llama_path, preview_config, safe_join
from .database import Database
from .downloads import DownloadManager
from .hf_service import resolve_hf_url
from .schemas import (
    ConfigApplyRequest,
    ConfigPreviewRequest,
    DownloadRequest,
    GpuDevice,
    ImportDraftRequest,
    ManagedModel,
    StateResponse,
)
from .settings import ManagerSettings, clear_hf_token, default_db_path, get_hf_token, save_hf_token


def create_app(db_path: str | Path | None = None) -> FastAPI:
    db = Database(Path(db_path) if db_path else default_db_path())
    db.init()
    app = FastAPI(title="Llama-Swap Manager", version="0.1.0")
    app.state.db = db
    app.state.download_manager = DownloadManager(db, db.get_settings())
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
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
    def put_hf_token(payload: dict) -> dict:
        token = str(payload.get("token", ""))
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
    def hf_resolve(payload: dict) -> dict:
        settings = db.get_settings()
        url = payload.get("url", "")
        revision = payload.get("revision") or settings.default_revision
        try:
            return resolve_hf_url(url, revision=revision, token=get_hf_token(settings) or None).model_dump()
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
        settings = db.get_settings()
        models = db.list_models()
        current = Path(settings.llama_swap_config_path).read_text(encoding="utf-8") if Path(settings.llama_swap_config_path).exists() else ""
        preview = preview_config(current, models, settings)
        if preview.valid:
            preview.stage_id = str(uuid.uuid4())
            db.save_staged_config(preview.stage_id, preview.yaml, preview.diff)
        return preview.model_dump()

    @app.post("/api/config/apply")
    def config_apply(payload: ConfigApplyRequest) -> dict:
        staged = db.get_staged_config(payload.stage_id)
        if not staged:
            raise HTTPException(status_code=404, detail="staged config not found; regenerate preview before applying")
        settings = db.get_settings()
        backup = backup_and_apply_config(settings.llama_swap_config_path, settings.backups_dir, staged["yaml"])
        return {
            "applied": True,
            "backup": str(backup),
            "restart_required": True,
            "restart_note": "Config applied. Restart llama-swap manually: docker compose restart llama-swap",
        }

    @app.post("/api/uploads")
    async def upload_file(role: str, file: UploadFile) -> dict:
        settings = db.get_settings()
        if role not in settings.role_directories.model_fields:
            raise HTTPException(status_code=400, detail="invalid role")
        role_dir = getattr(settings.role_directories, role)
        destination_dir = safe_join(settings.manager_model_root, Path(role_dir).relative_to(settings.llama_swap_model_root))
        destination = safe_join(destination_dir, file.filename or "upload.gguf")
        destination.write_bytes(await file.read())
        return {"manager_path": str(destination), "container_path": manager_to_llama_path(str(destination), settings)}

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

from __future__ import annotations

import os
import threading
import uuid
from pathlib import Path

from .database import Database
from .hf_service import download_selected_files
from .schemas import DownloadJob, DownloadRequest
from .settings import ManagerSettings


class DownloadManager:
    def __init__(self, db: Database, settings: ManagerSettings):
        self.db = db
        self.settings = settings
        self._threads: dict[str, threading.Thread] = {}
        self._cancelled: set[str] = set()
        self._semaphore = threading.Semaphore(max(1, settings.max_parallel_downloads))

    def start(self, request: DownloadRequest) -> DownloadJob:
        job = DownloadJob(
            id=str(uuid.uuid4()),
            status="queued",
            repo_id=request.repo_id,
            revision=request.revision,
            files=request.files,
            destination_dir=request.destination_dir,
            logs=["queued download job"],
        )
        self.db.save_job(job)
        thread = threading.Thread(target=self._run, args=(job.id,), daemon=True)
        self._threads[job.id] = thread
        thread.start()
        return job

    def list(self) -> list[DownloadJob]:
        return self.db.list_jobs()

    def cancel(self, job_id: str) -> DownloadJob:
        job = self.db.get_job(job_id)
        if not job:
            raise KeyError(job_id)
        if job.status in {"completed", "failed", "cancelled"}:
            return job
        self._cancelled.add(job_id)
        job.status = "cancelled"
        job.logs.append("cancel requested")
        return self.db.save_job(job)

    def retry(self, job_id: str) -> DownloadJob:
        job = self.db.get_job(job_id)
        if not job:
            raise KeyError(job_id)
        return self.start(
            DownloadRequest(
                repo_id=job.repo_id,
                revision=job.revision,
                files=job.files,
                destination_dir=job.destination_dir,
                model_id="",
            )
        )

    def _run(self, job_id: str) -> None:
        job = self.db.get_job(job_id)
        if not job:
            return
        if job_id in self._cancelled:
            job.status = "cancelled"
            job.logs.append("cancelled before start")
            self.db.save_job(job)
            return
        acquired = self._semaphore.acquire(timeout=0)
        if not acquired:
            self._semaphore.acquire()
        job = self.db.get_job(job_id)
        if not job:
            self._semaphore.release()
            return
        try:
            if job_id in self._cancelled or job.status == "cancelled":
                job.status = "cancelled"
                job.logs.append("cancelled before download")
                self.db.save_job(job)
                return
            job.status = "running"
            job.logs.append(f"downloading {len(job.files)} file(s) from {job.repo_id}")
            job.progress = 5
            self.db.save_job(job)
            destination = str(Path(job.destination_dir))
            written = download_selected_files(
                repo_id=job.repo_id,
                revision=job.revision,
                files=job.files,
                destination_dir=destination,
                model_root=self.settings.manager_model_root,
                token=os.getenv("HF_TOKEN") or None,
            )
            if job_id in self._cancelled:
                job.status = "cancelled"
                job.logs.append("cancelled after transfer returned; downloaded files were not attached to job")
                return
            job.status = "completed"
            job.progress = 100
            job.written_files = written
            job.container_files = [
                str(Path(self.settings.llama_swap_model_root) / Path(path).resolve().relative_to(Path(self.settings.manager_model_root).resolve()))
                .replace("\\", "/")
                for path in written
            ]
            job.logs.append(f"downloaded {len(written)} file(s)")
        except Exception as exc:
            if job_id in self._cancelled:
                job.status = "cancelled"
                job.logs.append("cancelled")
            else:
                job.status = "failed"
                job.error = str(exc)
                job.logs.append(f"failed: {exc}")
        finally:
            self.db.save_job(job)
            self._semaphore.release()

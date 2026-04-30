from __future__ import annotations

import multiprocessing
import queue
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from .database import Database
from .hf_service import HfFileInfo, download_selected_files, get_hf_file_info
from .schemas import DownloadJob, DownloadRequest
from .settings import ManagerSettings, get_hf_token


class DownloadCancelled(Exception):
    pass


def _download_worker(result_queue: multiprocessing.Queue, kwargs: dict[str, Any]) -> None:
    try:
        written = download_selected_files(**kwargs)
        result_queue.put({"ok": True, "written": written})
    except Exception as exc:
        result_queue.put({"ok": False, "error": str(exc)})


class DownloadManager:
    def __init__(self, db: Database, settings: ManagerSettings, run_in_process: bool = True):
        self.db = db
        self.settings = settings
        self.run_in_process = run_in_process
        self._threads: dict[str, threading.Thread] = {}
        self._processes: dict[str, multiprocessing.Process] = {}
        self._cancelled: set[str] = set()
        self._semaphore = threading.Semaphore(max(1, settings.max_parallel_downloads))
        self._lock = threading.Lock()
        self._recover_jobs()

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
        self._start_thread(job.id)
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
        with self._lock:
            process = self._processes.get(job_id)
        if process and process.is_alive():
            self._terminate_process(process)
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

    def _recover_jobs(self) -> None:
        for job in self.db.list_jobs():
            if job.status == "queued":
                job.logs.append("resumed queued job after manager startup")
                self.db.save_job(job)
                self._start_thread(job.id)
            elif job.status == "running":
                job.status = "failed"
                job.error = "manager restarted before download completed; retry the job"
                job.logs.append(job.error)
                self.db.save_job(job)

    def _start_thread(self, job_id: str) -> None:
        thread = threading.Thread(target=self._run, args=(job_id,), daemon=True)
        self._threads[job_id] = thread
        thread.start()

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
            token = get_hf_token(self.settings) or None
            kwargs = {
                "repo_id": job.repo_id,
                "revision": job.revision,
                "files": job.files,
                "destination_dir": destination,
                "model_root": self.settings.manager_model_root,
                "token": token,
            }
            file_info = self._file_info(job, token) if self.run_in_process else []
            if file_info:
                job.bytes_total = sum(item.size for item in file_info)
                job.bytes_downloaded = 0
                job.active_file = file_info[0].path
                self.db.save_job(job)
            written = self._download(job_id, kwargs, file_info)
            if job_id in self._cancelled:
                job.status = "cancelled"
                job.logs.append("cancelled after transfer returned; downloaded files were not attached to job")
                return
            job.status = "completed"
            job.progress = 100
            job.bytes_downloaded = job.bytes_total
            job.active_file = ""
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
            elif isinstance(exc, DownloadCancelled):
                job.status = "cancelled"
                job.logs.append(str(exc))
            else:
                job.status = "failed"
                job.error = str(exc)
                job.logs.append(f"failed: {exc}")
        finally:
            self.db.save_job(job)
            self._semaphore.release()

    def _file_info(self, job: DownloadJob, token: str | None) -> list[HfFileInfo]:
        try:
            return get_hf_file_info(job.repo_id, job.revision, job.files, token=token)
        except Exception as exc:
            job.logs.append(f"could not estimate download size: {exc}")
            self.db.save_job(job)
            return []

    def _download(self, job_id: str, kwargs: dict[str, Any], file_info: list[HfFileInfo] | None = None) -> list[str]:
        if not self.run_in_process:
            return download_selected_files(**kwargs)
        context = multiprocessing.get_context("spawn")
        result_queue = context.Queue()
        process = context.Process(target=_download_worker, args=(result_queue, kwargs), daemon=True)
        with self._lock:
            self._processes[job_id] = process
        process.start()
        try:
            last_progress_update = 0.0
            while process.is_alive():
                if job_id in self._cancelled:
                    self._terminate_process(process)
                    raise DownloadCancelled("download process terminated after cancel request")
                if file_info and time.monotonic() - last_progress_update >= 1:
                    self._update_progress_from_cache(job_id, file_info)
                    last_progress_update = time.monotonic()
                time.sleep(0.25)
            if file_info:
                self._update_progress_from_cache(job_id, file_info)
            process.join(timeout=1)
            try:
                result = result_queue.get(timeout=2)
            except queue.Empty as exc:
                if process.exitcode == 0:
                    raise RuntimeError("download process exited without returning a result") from exc
                raise RuntimeError(f"download process exited with code {process.exitcode}") from exc
            if result.get("ok"):
                return list(result.get("written", []))
            raise RuntimeError(str(result.get("error") or "download failed"))
        finally:
            with self._lock:
                self._processes.pop(job_id, None)
            result_queue.close()

    def _update_progress_from_cache(self, job_id: str, file_info: list[HfFileInfo]) -> None:
        job = self.db.get_job(job_id)
        if not job or job.status != "running":
            return
        downloaded = 0
        active_file = ""
        for item in file_info:
            if item.cache_path.exists():
                downloaded += item.size
                continue
            incomplete_size = item.incomplete_path.stat().st_size if item.incomplete_path.exists() else 0
            if incomplete_size and not active_file:
                active_file = item.path
            downloaded += min(item.size, incomplete_size)
        total = sum(item.size for item in file_info)
        if total <= 0:
            return
        job.bytes_total = total
        job.bytes_downloaded = downloaded
        job.active_file = active_file
        job.progress = round(min(99, max(0, (downloaded / total) * 100)), 1)
        self.db.save_job(job)

    def _terminate_process(self, process: multiprocessing.Process) -> None:
        process.terminate()
        process.join(timeout=5)
        if process.is_alive():
            process.kill()
            process.join(timeout=2)

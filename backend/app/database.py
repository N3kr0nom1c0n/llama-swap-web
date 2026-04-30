from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Iterator

from .migrations import initialize_schema
from .schemas import DownloadJob, GpuDevice, ManagedModel
from .settings import ManagerSettings, settings_from_env


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


class Database:
    def __init__(self, path: Path | str):
        self.path = Path(path)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def init(self) -> None:
        with self.connect() as conn:
            initialize_schema(conn)
            if not conn.execute("select 1 from settings where key = 'settings'").fetchone():
                settings = settings_from_env()
                conn.execute(
                    "insert into settings(key, value) values(?, ?)",
                    ("settings", settings.model_dump_json()),
                )
            if not conn.execute("select 1 from gpus limit 1").fetchone():
                for gpu in [
                    GpuDevice(index=0, name="3090", vram_gb=24, role="large/reasoning/chat"),
                    GpuDevice(index=1, name="3090", vram_gb=24, role="large/reasoning/chat"),
                ]:
                    conn.execute(
                        "insert into gpus(idx, payload) values(?, ?)",
                        (gpu.index, gpu.model_dump_json()),
                    )

    def get_settings(self) -> ManagerSettings:
        with self.connect() as conn:
            row = conn.execute("select value from settings where key = 'settings'").fetchone()
            if not row:
                return settings_from_env()
            return ManagerSettings.model_validate_json(row["value"])

    def save_settings(self, settings: ManagerSettings) -> ManagerSettings:
        with self.connect() as conn:
            conn.execute(
                "insert or replace into settings(key, value) values(?, ?)",
                ("settings", settings.model_dump_json()),
            )
        return settings

    def list_gpus(self) -> list[GpuDevice]:
        with self.connect() as conn:
            rows = conn.execute("select payload from gpus order by idx").fetchall()
            return [GpuDevice.model_validate_json(row["payload"]) for row in rows]

    def save_gpus(self, gpus: list[GpuDevice]) -> list[GpuDevice]:
        with self.connect() as conn:
            conn.execute("delete from gpus")
            for gpu in gpus:
                conn.execute(
                    "insert into gpus(idx, payload) values(?, ?)",
                    (gpu.index, gpu.model_dump_json()),
                )
        return gpus

    def list_models(self) -> list[ManagedModel]:
        with self.connect() as conn:
            rows = conn.execute("select payload from models order by id").fetchall()
            return [ManagedModel.model_validate_json(row["payload"]) for row in rows]

    def get_model(self, model_id: str) -> ManagedModel | None:
        with self.connect() as conn:
            row = conn.execute("select payload from models where id = ?", (model_id,)).fetchone()
            return ManagedModel.model_validate_json(row["payload"]) if row else None

    def save_model(self, model: ManagedModel) -> ManagedModel:
        now = utc_now()
        existing = self.get_model(model.id)
        model.created_at = existing.created_at if existing and existing.created_at else datetime.fromisoformat(now)
        model.updated_at = datetime.fromisoformat(now)
        with self.connect() as conn:
            conn.execute(
                """
                insert or replace into models(id, payload, created_at, updated_at)
                values(?, ?, ?, ?)
                """,
                (model.id, model.model_dump_json(), model.created_at.isoformat(), model.updated_at.isoformat()),
            )
        return model

    def list_jobs(self) -> list[DownloadJob]:
        with self.connect() as conn:
            rows = conn.execute("select payload from download_jobs order by created_at desc").fetchall()
            return [DownloadJob.model_validate_json(row["payload"]) for row in rows]

    def get_job(self, job_id: str) -> DownloadJob | None:
        with self.connect() as conn:
            row = conn.execute("select payload from download_jobs where id = ?", (job_id,)).fetchone()
            return DownloadJob.model_validate_json(row["payload"]) if row else None

    def save_job(self, job: DownloadJob) -> DownloadJob:
        now = utc_now()
        if job.created_at is None:
            job.created_at = datetime.fromisoformat(now)
        job.updated_at = datetime.fromisoformat(now)
        with self.connect() as conn:
            conn.execute(
                """
                insert or replace into download_jobs(id, payload, created_at, updated_at)
                values(?, ?, ?, ?)
                """,
                (job.id, job.model_dump_json(), job.created_at.isoformat(), job.updated_at.isoformat()),
            )
        return job

    def save_staged_config(
        self,
        stage_id: str,
        yaml_text: str,
        diff: str,
        fingerprint: str = "",
        model_ids: list[str] | None = None,
        ttl_seconds: int = 900,
    ) -> None:
        created_at = utc_now()
        expires_at = (datetime.fromisoformat(created_at) + timedelta(seconds=ttl_seconds)).isoformat()
        with self.connect() as conn:
            conn.execute(
                """
                insert or replace into staged_configs(id, yaml, diff, created_at, expires_at, fingerprint, model_ids, applied_at)
                values(?, ?, ?, ?, ?, ?, ?, null)
                """,
                (stage_id, yaml_text, diff, created_at, expires_at, fingerprint, json.dumps(model_ids or [])),
            )

    def get_staged_config(self, stage_id: str) -> dict | None:
        with self.connect() as conn:
            row = conn.execute(
                "select id, yaml, diff, created_at, expires_at, fingerprint, model_ids, applied_at from staged_configs where id = ?",
                (stage_id,),
            ).fetchone()
            return dict(row) if row else None

    def mark_staged_config_applied(self, stage_id: str) -> None:
        with self.connect() as conn:
            conn.execute("update staged_configs set applied_at = ? where id = ?", (utc_now(), stage_id))

    def claim_staged_config(self, stage_id: str) -> bool:
        with self.connect() as conn:
            cursor = conn.execute(
                "update staged_configs set applied_at = ? where id = ? and applied_at is null",
                (utc_now(), stage_id),
            )
            return cursor.rowcount == 1


def redact_secrets(payload: dict) -> dict:
    redacted = json.loads(json.dumps(payload))
    for key in list(redacted):
        if "token" in key.lower() or "secret" in key.lower():
            redacted[key] = "***" if redacted[key] else ""
    return redacted

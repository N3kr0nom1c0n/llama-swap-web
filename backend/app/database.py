from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Iterator

from .migrations import initialize_schema
from .schemas import DEFAULT_TARGET_RIG_ID, DownloadJob, GpuDevice, ManagedModel, TargetRig
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
            else:
                settings = self.get_settings()
            if not conn.execute("select 1 from target_rigs limit 1").fetchone():
                self._seed_default_target_rig(conn, settings)
            if not conn.execute("select 1 from gpus limit 1").fetchone():
                for gpu in [
                    GpuDevice(index=0, name="3090", vram_gb=24, role="large/reasoning/chat"),
                    GpuDevice(index=1, name="3090", vram_gb=24, role="large/reasoning/chat"),
                ]:
                    conn.execute(
                        "insert into gpus(idx, payload) values(?, ?)",
                        (gpu.index, gpu.model_dump_json()),
                    )
            if not conn.execute("select 1 from rig_gpus where target_rig_id = ? limit 1", (DEFAULT_TARGET_RIG_ID,)).fetchone():
                rows = conn.execute("select idx, payload from gpus order by idx").fetchall()
                if rows:
                    for row in rows:
                        gpu = GpuDevice.model_validate_json(row["payload"])
                        gpu.target_rig_id = DEFAULT_TARGET_RIG_ID
                        conn.execute(
                            "insert or replace into rig_gpus(target_rig_id, idx, payload) values(?, ?, ?)",
                            (DEFAULT_TARGET_RIG_ID, gpu.index, gpu.model_dump_json()),
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

    def _seed_default_target_rig(self, conn: sqlite3.Connection, settings: ManagerSettings) -> None:
        now = utc_now()
        rig = TargetRig(
            id=DEFAULT_TARGET_RIG_ID,
            name="Local Manager Host",
            mode="local",
            model_root=settings.manager_model_root,
            llama_swap_model_root=settings.llama_swap_model_root,
            config_path=settings.llama_swap_config_path,
            backups_dir=settings.backups_dir,
            download_temp_dir=settings.download_temp_dir,
            restart_command=f"docker restart {settings.llama_swap_container_name}",
            is_default=True,
        )
        rig.created_at = datetime.fromisoformat(now)
        rig.updated_at = datetime.fromisoformat(now)
        conn.execute(
            "insert into target_rigs(id, payload, created_at, updated_at) values(?, ?, ?, ?)",
            (rig.id, rig.model_dump_json(), now, now),
        )

    def list_target_rigs(self) -> list[TargetRig]:
        with self.connect() as conn:
            rows = conn.execute("select payload from target_rigs order by id").fetchall()
            rigs = [TargetRig.model_validate_json(row["payload"]) for row in rows]
        return sorted(rigs, key=lambda rig: (not rig.is_default, rig.name.lower(), rig.id))

    def get_target_rig(self, target_rig_id: str | None = None) -> TargetRig | None:
        rig_id = target_rig_id or DEFAULT_TARGET_RIG_ID
        with self.connect() as conn:
            row = conn.execute("select payload from target_rigs where id = ?", (rig_id,)).fetchone()
            if row:
                return TargetRig.model_validate_json(row["payload"])
            if rig_id == DEFAULT_TARGET_RIG_ID:
                row = conn.execute("select payload from target_rigs order by id limit 1").fetchone()
                return TargetRig.model_validate_json(row["payload"]) if row else None
        return None

    def save_target_rig(self, rig: TargetRig) -> TargetRig:
        now = utc_now()
        existing = self.get_target_rig(rig.id)
        rig.created_at = existing.created_at if existing and existing.created_at else datetime.fromisoformat(now)
        rig.updated_at = datetime.fromisoformat(now)
        with self.connect() as conn:
            if rig.is_default:
                rows = conn.execute("select payload from target_rigs").fetchall()
                for row in rows:
                    existing_rig = TargetRig.model_validate_json(row["payload"])
                    if existing_rig.id == rig.id:
                        continue
                    existing_rig.is_default = False
                    conn.execute(
                        "update target_rigs set payload = ?, updated_at = ? where id = ?",
                        (existing_rig.model_dump_json(), now, existing_rig.id),
                    )
            conn.execute(
                """
                insert or replace into target_rigs(id, payload, created_at, updated_at)
                values(?, ?, ?, ?)
                """,
                (rig.id, rig.model_dump_json(), rig.created_at.isoformat(), rig.updated_at.isoformat()),
            )
        return rig

    def list_gpus(self, target_rig_id: str | None = None) -> list[GpuDevice]:
        rig_id = target_rig_id or DEFAULT_TARGET_RIG_ID
        with self.connect() as conn:
            rows = conn.execute("select payload from rig_gpus where target_rig_id = ? order by idx", (rig_id,)).fetchall()
            if not rows and rig_id == DEFAULT_TARGET_RIG_ID:
                rows = conn.execute("select payload from gpus order by idx").fetchall()
            return [GpuDevice.model_validate_json(row["payload"]) for row in rows]

    def save_gpus(self, gpus: list[GpuDevice], target_rig_id: str | None = None) -> list[GpuDevice]:
        rig_id = target_rig_id or (gpus[0].target_rig_id if gpus else DEFAULT_TARGET_RIG_ID)
        with self.connect() as conn:
            conn.execute("delete from rig_gpus where target_rig_id = ?", (rig_id,))
            for gpu in gpus:
                gpu.target_rig_id = rig_id
                conn.execute(
                    "insert into rig_gpus(target_rig_id, idx, payload) values(?, ?, ?)",
                    (rig_id, gpu.index, gpu.model_dump_json()),
                )
        return gpus

    def list_models(self, target_rig_id: str | None = None) -> list[ManagedModel]:
        with self.connect() as conn:
            rows = conn.execute("select id, payload, updated_at from models order by id").fetchall()
            keyed: dict[tuple[str, str], tuple[ManagedModel, str]] = {}
            for row in rows:
                model = ManagedModel.model_validate_json(row["payload"])
                if target_rig_id is not None and model.target_rig_id != target_rig_id:
                    continue
                key = (model.target_rig_id, model.id)
                existing = keyed.get(key)
                row_updated_at = str(row["updated_at"])
                if existing is None or row_updated_at > existing[1]:
                    keyed[key] = (model, row_updated_at)
            return [item[0] for item in sorted(keyed.values(), key=lambda item: (item[0].target_rig_id, item[0].id))]

    def get_model(self, model_id: str, target_rig_id: str | None = DEFAULT_TARGET_RIG_ID) -> ManagedModel | None:
        with self.connect() as conn:
            row = self._find_model_row(conn, model_id, target_rig_id)
            return ManagedModel.model_validate_json(row["payload"]) if row else None

    def save_model(self, model: ManagedModel) -> ManagedModel:
        now = utc_now()
        model.target_rig_id = model.target_rig_id or DEFAULT_TARGET_RIG_ID
        storage_id = self._model_storage_id(model.id, model.target_rig_id)
        with self.connect() as conn:
            existing_row = self._find_model_row(conn, model.id, model.target_rig_id)
            existing = ManagedModel.model_validate_json(existing_row["payload"]) if existing_row else None
            model.created_at = existing.created_at if existing and existing.created_at else datetime.fromisoformat(now)
            model.updated_at = datetime.fromisoformat(now)
            if existing_row and existing_row["id"] != storage_id:
                conn.execute("delete from models where id = ?", (existing_row["id"],))
            conn.execute(
                """
                insert or replace into models(id, payload, created_at, updated_at)
                values(?, ?, ?, ?)
                """,
                (storage_id, model.model_dump_json(), model.created_at.isoformat(), model.updated_at.isoformat()),
            )
        return model

    def _find_model_row(self, conn: sqlite3.Connection, model_id: str, target_rig_id: str | None = DEFAULT_TARGET_RIG_ID) -> sqlite3.Row | None:
        rig_id = target_rig_id or DEFAULT_TARGET_RIG_ID
        storage_id = self._model_storage_id(model_id, rig_id)
        row = conn.execute("select id, payload from models where id = ?", (storage_id,)).fetchone()
        if row:
            return row
        if rig_id == DEFAULT_TARGET_RIG_ID:
            row = conn.execute("select id, payload from models where id = ?", (model_id,)).fetchone()
            if row:
                model = ManagedModel.model_validate_json(row["payload"])
                if model.id == model_id and model.target_rig_id == rig_id:
                    return row
        rows = conn.execute("select id, payload from models").fetchall()
        for candidate in rows:
            model = ManagedModel.model_validate_json(candidate["payload"])
            if model.id == model_id and model.target_rig_id == rig_id:
                return candidate
        return None

    @staticmethod
    def _model_storage_id(model_id: str, target_rig_id: str | None = DEFAULT_TARGET_RIG_ID) -> str:
        rig_id = target_rig_id or DEFAULT_TARGET_RIG_ID
        if rig_id == DEFAULT_TARGET_RIG_ID:
            return model_id
        return f"{rig_id}\x1f{model_id}"

    def list_jobs(self, target_rig_id: str | None = None) -> list[DownloadJob]:
        with self.connect() as conn:
            rows = conn.execute("select payload from download_jobs order by created_at desc").fetchall()
            jobs = [DownloadJob.model_validate_json(row["payload"]) for row in rows]
            return [job for job in jobs if target_rig_id is None or job.target_rig_id == target_rig_id]

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
        target_rig_id: str = DEFAULT_TARGET_RIG_ID,
        ttl_seconds: int = 900,
    ) -> None:
        created_at = utc_now()
        expires_at = (datetime.fromisoformat(created_at) + timedelta(seconds=ttl_seconds)).isoformat()
        with self.connect() as conn:
            conn.execute(
                """
                insert or replace into staged_configs(id, yaml, diff, created_at, expires_at, fingerprint, model_ids, applied_at, target_rig_id)
                values(?, ?, ?, ?, ?, ?, ?, null, ?)
                """,
                (stage_id, yaml_text, diff, created_at, expires_at, fingerprint, json.dumps(model_ids or []), target_rig_id),
            )

    def get_staged_config(self, stage_id: str) -> dict | None:
        with self.connect() as conn:
            row = conn.execute(
                "select id, yaml, diff, created_at, expires_at, fingerprint, model_ids, applied_at, target_rig_id from staged_configs where id = ?",
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

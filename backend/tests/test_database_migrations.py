from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from app.database import Database
from app.migrations import CURRENT_SCHEMA_VERSION
from app.schemas import DownloadJob, GpuDevice, ManagedModel
from app.settings import ManagerSettings


def _create_old_style_db(path: Path) -> None:
    settings_payload = ManagerSettings(
        app_host="127.0.0.1",
        backups_dir="/old/backups",
        manager_model_root="/old/models",
        llama_swap_model_root="/models",
    ).model_dump()
    settings_payload.pop("backup_retention_count", None)
    settings_payload.pop("backup_retention_days", None)
    gpu = GpuDevice(index=3, name="A6000", vram_gb=48, role="chat")
    model = ManagedModel(id="old-chat", display_name="Old Chat", primary_model_file="/models/chat/old.gguf")
    job = DownloadJob(
        id="old-job",
        status="completed",
        repo_id="org/old",
        files=["old.gguf"],
        destination_dir="/old/models/chat",
        written_files=["/old/models/chat/old.gguf"],
        container_files=["/models/chat/old.gguf"],
    )
    with sqlite3.connect(path) as conn:
        conn.executescript(
            """
            create table settings (
              key text primary key,
              value text not null
            );
            create table gpus (
              idx integer primary key,
              payload text not null
            );
            create table models (
              id text primary key,
              payload text not null,
              created_at text not null,
              updated_at text not null
            );
            create table model_files (
              id integer primary key autoincrement,
              model_id text not null,
              manager_path text not null,
              container_path text not null,
              kind text not null
            );
            create table download_jobs (
              id text primary key,
              payload text not null,
              created_at text not null,
              updated_at text not null
            );
            create table staged_configs (
              id text primary key,
              yaml text not null,
              diff text not null,
              created_at text not null
            );
            """
        )
        conn.execute("insert into settings(key, value) values(?, ?)", ("settings", json.dumps(settings_payload)))
        conn.execute("insert into gpus(idx, payload) values(?, ?)", (gpu.index, gpu.model_dump_json()))
        conn.execute(
            "insert into models(id, payload, created_at, updated_at) values(?, ?, ?, ?)",
            ("old-chat", model.model_dump_json(), "2026-04-01T00:00:00+00:00", "2026-04-02T00:00:00+00:00"),
        )
        conn.execute(
            "insert into model_files(model_id, manager_path, container_path, kind) values(?, ?, ?, ?)",
            ("old-chat", "/old/models/chat/old.gguf", "/models/chat/old.gguf", "gguf"),
        )
        conn.execute(
            "insert into download_jobs(id, payload, created_at, updated_at) values(?, ?, ?, ?)",
            ("old-job", job.model_dump_json(), "2026-04-03T00:00:00+00:00", "2026-04-04T00:00:00+00:00"),
        )
        conn.execute(
            "insert into staged_configs(id, yaml, diff, created_at) values(?, ?, ?, ?)",
            ("old-stage", "models: {}\n", "--- old\n+++ new\n", "2026-04-05T00:00:00+00:00"),
        )


def test_init_migrates_old_style_db_without_losing_rows(tmp_path: Path) -> None:
    db_path = tmp_path / "manager.db"
    _create_old_style_db(db_path)
    db = Database(db_path)

    db.init()

    settings = db.get_settings()
    assert settings.app_host == "127.0.0.1"
    assert settings.backups_dir == "/old/backups"
    assert settings.backup_retention_count == 0
    assert settings.backup_retention_days == 0
    assert [gpu.index for gpu in db.list_gpus()] == [3]
    assert db.get_model("old-chat") is not None
    assert db.get_job("old-job") is not None
    staged = db.get_staged_config("old-stage")
    assert staged is not None
    assert staged["yaml"] == "models: {}\n"
    assert staged["diff"] == "--- old\n+++ new\n"
    assert staged["expires_at"] is None
    assert staged["fingerprint"] == ""
    assert staged["model_ids"] == "[]"
    assert staged["applied_at"] is None
    with sqlite3.connect(db_path) as conn:
        version = conn.execute("select max(version) from schema_version").fetchone()[0]
        model_file_count = conn.execute("select count(*) from model_files").fetchone()[0]
    assert version == CURRENT_SCHEMA_VERSION
    assert model_file_count == 1


def test_init_creates_versioned_schema_for_new_db(tmp_path: Path) -> None:
    db_path = tmp_path / "manager.db"
    db = Database(db_path)

    db.init()

    with sqlite3.connect(db_path) as conn:
        version = conn.execute("select max(version) from schema_version").fetchone()[0]
        settings_count = conn.execute("select count(*) from settings").fetchone()[0]
        gpu_count = conn.execute("select count(*) from gpus").fetchone()[0]
    assert version == CURRENT_SCHEMA_VERSION
    assert settings_count == 1
    assert gpu_count == 2

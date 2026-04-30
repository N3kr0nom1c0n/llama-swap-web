from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient
from starlette.datastructures import UploadFile as StarletteUploadFile

from app.main import create_app


def test_state_initializes_db_and_redacts_hf_token(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("HF_TOKEN", "secret-token")
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)

    response = client.get("/api/state")

    assert response.status_code == 200
    payload = response.json()
    assert payload["settings"]["hf_token_configured"] is True
    assert payload["settings"]["hf_token"] == "***"
    assert payload["model_count"] == 0
    assert len(payload["gpus"]) == 2
    assert "secret-token" not in response.text


def test_hf_token_can_be_saved_and_cleared_without_echo(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("HF_TOKEN", raising=False)
    env_file = tmp_path / ".env"
    monkeypatch.setenv("MANAGER_ENV_FILE", str(env_file))
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)

    saved = client.put("/api/settings/hf-token", json={"token": "hf_secret_token"})
    settings = client.get("/api/settings")

    assert saved.status_code == 200
    assert saved.json()["hf_token_configured"] is True
    assert saved.json()["hf_token"] == "***"
    assert saved.json()["hf_token_source"] == str(env_file)
    assert "hf_secret_token" not in saved.text
    assert "hf_secret_token" not in settings.text
    assert "HF_TOKEN=hf_secret_token" in env_file.read_text(encoding="utf-8")
    assert "HF_TOKEN" not in os.environ
    cleared = client.delete("/api/settings/hf-token")
    assert cleared.status_code == 200
    assert cleared.json()["hf_token_configured"] is False
    assert "hf_secret_token" not in env_file.read_text(encoding="utf-8")


def test_hf_token_clear_overrides_startup_environment_token(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("HF_TOKEN", "hf_startup_secret")
    env_file = tmp_path / ".env"
    env_file.write_text("HF_TOKEN=hf_file_secret\n", encoding="utf-8")
    monkeypatch.setenv("MANAGER_ENV_FILE", str(env_file))
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)

    configured = client.get("/api/settings")
    cleared = client.delete("/api/settings/hf-token")
    reloaded = client.get("/api/settings")

    assert configured.json()["hf_token_configured"] is True
    assert configured.json()["hf_token_source"] == str(env_file)
    assert cleared.status_code == 200
    assert cleared.json()["hf_token_configured"] is False
    assert reloaded.json()["hf_token_configured"] is False
    assert env_file.read_text(encoding="utf-8") == "HF_TOKEN=\n"
    assert "hf_startup_secret" not in cleared.text
    assert "hf_file_secret" not in cleared.text


def test_create_model_maps_manager_files_to_container_paths(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(tmp_path / "models"))
    monkeypatch.setenv("LLAMA_SWAP_MODEL_ROOT", "/models")
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)
    manager_model = tmp_path / "models" / "chat" / "tiny.gguf"
    manager_model.parent.mkdir(parents=True)
    manager_model.write_text("fake", encoding="utf-8")

    response = client.post(
        "/api/models",
        json={
            "id": "tiny-chat",
            "display_name": "Tiny Chat",
            "role": "chat",
            "manager_files": [str(manager_model)],
            "gpu_devices": [0],
            "matrix_key": "tc",
            "matrix_behavior": "runs_alone",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["container_files"] == ["/models/chat/tiny.gguf"]
    assert payload["primary_model_file"] == "/models/chat/tiny.gguf"


def test_create_model_rejects_manager_file_outside_root(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(tmp_path / "models"))
    monkeypatch.setenv("LLAMA_SWAP_MODEL_ROOT", "/models")
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)

    response = client.post(
        "/api/models",
        json={
            "id": "bad",
            "display_name": "Bad",
            "role": "chat",
            "manager_files": [str(tmp_path / "outside.gguf")],
        },
    )

    assert response.status_code == 400
    assert "outside manager root" in response.json()["detail"]


def test_import_returns_manager_destination_and_container_destination(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(tmp_path / "host-models"))
    monkeypatch.setenv("LLAMA_SWAP_MODEL_ROOT", "/models")
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)

    response = client.post(
        "/api/imports",
        json={"role": "chat", "source_type": "hf", "selected_files": ["tiny.gguf"]},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["destination_dir"] == str(tmp_path / "host-models" / "chat")
    assert payload["container_dir"] == "/models/chat"


def test_config_apply_requires_reviewed_stage_id(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("LLAMA_SWAP_CONFIG_PATH", str(tmp_path / "config.yaml"))
    monkeypatch.setenv("BACKUPS_DIR", str(tmp_path / "backups"))
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(tmp_path / "models"))
    monkeypatch.setenv("LLAMA_SWAP_MODEL_ROOT", "/models")
    monkeypatch.setenv("DOWNLOAD_TEMP_DIR", str(tmp_path / "tmp"))
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)
    manager_model = tmp_path / "models" / "chat" / "tiny.gguf"
    manager_model.parent.mkdir(parents=True)
    manager_model.write_text("fake", encoding="utf-8")
    client.post(
        "/api/models",
        json={
            "id": "tiny-chat",
            "display_name": "Tiny Chat",
            "role": "chat",
            "manager_files": [str(manager_model)],
            "matrix_key": "tc",
            "matrix_behavior": "runs_alone",
        },
    )

    missing = client.post("/api/config/apply", json={"stage_id": "missing"})
    preview = client.post("/api/config/preview", json={"model_ids": []})
    applied = client.post("/api/config/apply", json={"stage_id": preview.json()["stage_id"]})

    assert missing.status_code == 404
    assert preview.status_code == 200
    assert preview.json()["stage_id"]
    assert applied.status_code == 200
    assert (tmp_path / "backups").exists()


def test_config_preview_honors_requested_model_ids(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("LLAMA_SWAP_CONFIG_PATH", str(tmp_path / "config.yaml"))
    monkeypatch.setenv("BACKUPS_DIR", str(tmp_path / "backups"))
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(tmp_path / "models"))
    monkeypatch.setenv("LLAMA_SWAP_MODEL_ROOT", "/models")
    monkeypatch.setenv("DOWNLOAD_TEMP_DIR", str(tmp_path / "tmp"))
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)
    for model_id in ["one", "two"]:
        manager_model = tmp_path / "models" / "chat" / f"{model_id}.gguf"
        manager_model.parent.mkdir(parents=True, exist_ok=True)
        manager_model.write_text("fake", encoding="utf-8")
        client.post(
            "/api/models",
            json={
                "id": model_id,
                "display_name": model_id.title(),
                "role": "chat",
                "manager_files": [str(manager_model)],
                "matrix_key": model_id[:1],
                "matrix_behavior": "runs_alone",
            },
        )

    scoped = client.post("/api/config/preview", json={"model_ids": ["one"]})
    unknown = client.post("/api/config/preview", json={"model_ids": ["missing"]})

    assert scoped.status_code == 200
    assert scoped.json()["valid"] is True
    assert "one:" in scoped.json()["yaml"]
    assert "two:" not in scoped.json()["yaml"]
    assert unknown.status_code == 400


def test_config_apply_rejects_replay_expired_and_stale_stage(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("LLAMA_SWAP_CONFIG_PATH", str(tmp_path / "config.yaml"))
    monkeypatch.setenv("BACKUPS_DIR", str(tmp_path / "backups"))
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(tmp_path / "models"))
    monkeypatch.setenv("LLAMA_SWAP_MODEL_ROOT", "/models")
    monkeypatch.setenv("DOWNLOAD_TEMP_DIR", str(tmp_path / "tmp"))
    (tmp_path / "config.yaml").write_text("models: {}\n", encoding="utf-8")
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)
    manager_model = tmp_path / "models" / "chat" / "tiny.gguf"
    manager_model.parent.mkdir(parents=True)
    manager_model.write_text("fake", encoding="utf-8")
    client.post(
        "/api/models",
        json={
            "id": "tiny-chat",
            "display_name": "Tiny Chat",
            "role": "chat",
            "manager_files": [str(manager_model)],
            "matrix_key": "tc",
            "matrix_behavior": "runs_alone",
        },
    )
    replay_preview = client.post("/api/config/preview", json={"model_ids": ["tiny-chat"]})
    replay_stage = replay_preview.json()["stage_id"]
    first_apply = client.post("/api/config/apply", json={"stage_id": replay_stage})
    replay_apply = client.post("/api/config/apply", json={"stage_id": replay_stage})

    expired_preview = client.post("/api/config/preview", json={"model_ids": ["tiny-chat"]})
    expired_stage = expired_preview.json()["stage_id"]
    with sqlite3.connect(tmp_path / "manager.db") as conn:
        conn.execute("update staged_configs set expires_at = '2000-01-01T00:00:00+00:00' where id = ?", (expired_stage,))
    expired_apply = client.post("/api/config/apply", json={"stage_id": expired_stage})

    stale_preview = client.post("/api/config/preview", json={"model_ids": ["tiny-chat"]})
    stale_stage = stale_preview.json()["stage_id"]
    (tmp_path / "config.yaml").write_text("healthCheckTimeout: 120\nmodels: {}\n", encoding="utf-8")
    stale_apply = client.post("/api/config/apply", json={"stage_id": stale_stage})

    assert first_apply.status_code == 200
    assert replay_apply.status_code == 409
    assert "already applied" in replay_apply.json()["detail"]
    assert expired_apply.status_code == 409
    assert "expired" in expired_apply.json()["detail"]
    assert stale_apply.status_code == 409
    assert "stale" in stale_apply.json()["detail"]


def test_config_apply_rejects_legacy_stage_without_freshness_metadata(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("LLAMA_SWAP_CONFIG_PATH", str(tmp_path / "config.yaml"))
    monkeypatch.setenv("BACKUPS_DIR", str(tmp_path / "backups"))
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(tmp_path / "models"))
    monkeypatch.setenv("LLAMA_SWAP_MODEL_ROOT", "/models")
    monkeypatch.setenv("DOWNLOAD_TEMP_DIR", str(tmp_path / "tmp"))
    (tmp_path / "config.yaml").write_text("models: {}\n", encoding="utf-8")
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)
    with sqlite3.connect(tmp_path / "manager.db") as conn:
        conn.execute(
            "insert into staged_configs(id, yaml, diff, created_at) values(?, ?, ?, ?)",
            ("legacy-stage", "models:\n  legacy: {}\n", "", "2026-04-30T00:00:00+00:00"),
        )

    response = client.post("/api/config/apply", json={"stage_id": "legacy-stage"})

    assert response.status_code == 409
    assert "freshness metadata" in response.json()["detail"]


def test_config_apply_rejects_claimed_stage(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("LLAMA_SWAP_CONFIG_PATH", str(tmp_path / "config.yaml"))
    monkeypatch.setenv("BACKUPS_DIR", str(tmp_path / "backups"))
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(tmp_path / "models"))
    monkeypatch.setenv("LLAMA_SWAP_MODEL_ROOT", "/models")
    monkeypatch.setenv("DOWNLOAD_TEMP_DIR", str(tmp_path / "tmp"))
    (tmp_path / "config.yaml").write_text("models: {}\n", encoding="utf-8")
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)
    manager_model = tmp_path / "models" / "chat" / "tiny.gguf"
    manager_model.parent.mkdir(parents=True)
    manager_model.write_text("fake", encoding="utf-8")
    client.post(
        "/api/models",
        json={
            "id": "tiny-chat",
            "display_name": "Tiny Chat",
            "role": "chat",
            "manager_files": [str(manager_model)],
            "matrix_key": "tc",
            "matrix_behavior": "runs_alone",
        },
    )
    preview = client.post("/api/config/preview", json={"model_ids": ["tiny-chat"]})
    stage_id = preview.json()["stage_id"]
    assert app.state.db.claim_staged_config(stage_id)

    response = client.post("/api/config/apply", json={"stage_id": stage_id})

    assert response.status_code == 409
    assert "already applied" in response.json()["detail"]


def test_config_apply_returns_controlled_error_for_apply_time_filesystem_failure(tmp_path: Path, monkeypatch) -> None:
    config = tmp_path / "config.yaml"
    config.write_text("models: {}\n", encoding="utf-8")
    monkeypatch.setenv("LLAMA_SWAP_CONFIG_PATH", str(config))
    monkeypatch.setenv("BACKUPS_DIR", str(tmp_path / "backups"))
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(tmp_path / "models"))
    monkeypatch.setenv("LLAMA_SWAP_MODEL_ROOT", "/models")
    monkeypatch.setenv("DOWNLOAD_TEMP_DIR", str(tmp_path / "tmp"))
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)
    manager_model = tmp_path / "models" / "chat" / "tiny.gguf"
    manager_model.parent.mkdir(parents=True)
    manager_model.write_text("fake", encoding="utf-8")
    client.post(
        "/api/models",
        json={
            "id": "tiny-chat",
            "display_name": "Tiny Chat",
            "role": "chat",
            "manager_files": [str(manager_model)],
            "matrix_key": "tc",
            "matrix_behavior": "runs_alone",
        },
    )
    preview = client.post("/api/config/preview", json={"model_ids": ["tiny-chat"]})
    stage_id = preview.json()["stage_id"]

    def fail_apply(*_args, **_kwargs):
        raise ValueError("config parent directory does not exist")

    monkeypatch.setattr("app.main.backup_and_apply_config", fail_apply)

    response = client.post("/api/config/apply", json={"stage_id": stage_id})

    assert response.status_code == 409
    assert "could not apply" in response.json()["detail"]


def test_config_apply_returns_409_for_apply_time_config_read_failure(tmp_path: Path, monkeypatch) -> None:
    config = tmp_path / "config.yaml"
    config.write_text("models: {}\n", encoding="utf-8")
    monkeypatch.setenv("LLAMA_SWAP_CONFIG_PATH", str(config))
    monkeypatch.setenv("BACKUPS_DIR", str(tmp_path / "backups"))
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(tmp_path / "models"))
    monkeypatch.setenv("LLAMA_SWAP_MODEL_ROOT", "/models")
    monkeypatch.setenv("DOWNLOAD_TEMP_DIR", str(tmp_path / "tmp"))
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)
    manager_model = tmp_path / "models" / "chat" / "tiny.gguf"
    manager_model.parent.mkdir(parents=True)
    manager_model.write_text("fake", encoding="utf-8")
    client.post(
        "/api/models",
        json={
            "id": "tiny-chat",
            "display_name": "Tiny Chat",
            "role": "chat",
            "manager_files": [str(manager_model)],
            "matrix_key": "tc",
            "matrix_behavior": "runs_alone",
        },
    )
    preview = client.post("/api/config/preview", json={"model_ids": ["tiny-chat"]})
    stage_id = preview.json()["stage_id"]

    def fail_read(*_args, **_kwargs):
        raise OSError("permission denied")

    monkeypatch.setattr(Path, "read_text", fail_read)

    response = client.post("/api/config/apply", json={"stage_id": stage_id})

    assert response.status_code == 409
    assert "could not validate current config" in response.json()["detail"]


def test_config_apply_rejects_malformed_staged_metadata(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("LLAMA_SWAP_CONFIG_PATH", str(tmp_path / "config.yaml"))
    monkeypatch.setenv("BACKUPS_DIR", str(tmp_path / "backups"))
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(tmp_path / "models"))
    monkeypatch.setenv("LLAMA_SWAP_MODEL_ROOT", "/models")
    monkeypatch.setenv("DOWNLOAD_TEMP_DIR", str(tmp_path / "tmp"))
    (tmp_path / "config.yaml").write_text("models: {}\n", encoding="utf-8")
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)
    app.state.db.save_staged_config("bad-time", "models:\n  bad: {}\n", "", fingerprint="present")
    app.state.db.save_staged_config("bad-models", "models:\n  bad: {}\n", "", fingerprint="present")
    with sqlite3.connect(tmp_path / "manager.db") as conn:
        conn.execute("update staged_configs set expires_at = 'not-a-time' where id = 'bad-time'")
        conn.execute("update staged_configs set model_ids = 'null' where id = 'bad-models'")

    bad_time = client.post("/api/config/apply", json={"stage_id": "bad-time"})
    bad_models = client.post("/api/config/apply", json={"stage_id": "bad-models"})

    assert bad_time.status_code == 409
    assert "metadata" in bad_time.json()["detail"]
    assert bad_models.status_code == 409
    assert "metadata" in bad_models.json()["detail"]


def test_config_apply_blocks_destructive_empty_models_stage(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("LLAMA_SWAP_CONFIG_PATH", str(tmp_path / "config.yaml"))
    monkeypatch.setenv("BACKUPS_DIR", str(tmp_path / "backups"))
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(tmp_path / "models"))
    monkeypatch.setenv("LLAMA_SWAP_MODEL_ROOT", "/models")
    monkeypatch.setenv("DOWNLOAD_TEMP_DIR", str(tmp_path / "tmp"))
    config = tmp_path / "config.yaml"
    config.write_text(
        "models:\n  existing:\n    cmd: /app/llama-server --port ${PORT} -m /models/existing.gguf\n",
        encoding="utf-8",
    )
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)
    stage_id = "empty-stage"
    app.state.db.save_staged_config(stage_id, "models: {}\n", "", fingerprint="")

    response = client.post("/api/config/apply", json={"stage_id": stage_id})

    assert response.status_code == 409
    assert "destructive" in response.json()["detail"]
    assert "existing" in config.read_text(encoding="utf-8")


def test_settings_persist_upload_cors_and_tmp_defaults(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(tmp_path / "models"))
    monkeypatch.setenv("LLAMA_SWAP_MODEL_ROOT", "/models")
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)

    initial = client.get("/api/settings").json()
    assert initial["download_temp_dir"] == "/data/tmp"
    initial["max_upload_bytes"] = 1234
    initial["allowed_upload_extensions"] = [".gguf", ".safetensors"]
    initial["cors_allowed_origins"] = ["http://localhost:5173"]

    saved = client.put("/api/settings", json=initial)
    reloaded = client.get("/api/settings")

    assert saved.status_code == 200
    assert reloaded.json()["max_upload_bytes"] == 1234
    assert reloaded.json()["allowed_upload_extensions"] == [".gguf", ".safetensors"]
    assert reloaded.json()["cors_allowed_origins"] == ["http://localhost:5173"]


def test_cors_uses_configured_origins(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173")
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)

    allowed = client.options(
        "/api/state",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    unknown = client.options(
        "/api/state",
        headers={
            "Origin": "http://evil.example",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "access-control-allow-origin" not in unknown.headers


def test_health_reports_app_db_config_models_and_backups(tmp_path: Path, monkeypatch) -> None:
    config_path = tmp_path / "config.yaml"
    backups_dir = tmp_path / "backups"
    models_dir = tmp_path / "models"
    config_path.write_text("models: {}\n", encoding="utf-8")
    backups_dir.mkdir()
    models_dir.mkdir()
    monkeypatch.setenv("LLAMA_SWAP_CONFIG_PATH", str(config_path))
    monkeypatch.setenv("BACKUPS_DIR", str(backups_dir))
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(models_dir))
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)

    response = client.get("/api/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["app"]["status"] == "ok"
    assert payload["db"]["exists"] is True
    assert payload["config"]["path"] == str(config_path)
    assert payload["config"]["exists"] is True
    assert payload["model_root"]["path"] == str(models_dir)
    assert payload["model_root"]["exists"] is True
    assert payload["backups"]["path"] == str(backups_dir)
    assert payload["backups"]["exists"] is True


def test_health_returns_503_when_required_paths_are_unwritable(tmp_path: Path, monkeypatch) -> None:
    config_path = tmp_path / "missing" / "config.yaml"
    backups_dir = tmp_path / "missing" / "backups"
    models_dir = tmp_path / "missing" / "models"
    monkeypatch.setenv("LLAMA_SWAP_CONFIG_PATH", str(config_path))
    monkeypatch.setenv("BACKUPS_DIR", str(backups_dir))
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(models_dir))
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)

    response = client.get("/api/health")

    assert response.status_code == 503
    assert response.json()["status"] == "degraded"


def test_upload_streams_file_in_chunks(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(tmp_path / "models"))
    monkeypatch.setenv("LLAMA_SWAP_MODEL_ROOT", "/models")
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)
    read_sizes: list[int] = []
    original_read = StarletteUploadFile.read

    async def read_spy(self: StarletteUploadFile, size: int = -1) -> bytes:
        read_sizes.append(size)
        if size in (-1, None):
            raise AssertionError("upload handler must read with a bounded chunk size")
        return await original_read(self, size)

    monkeypatch.setattr(StarletteUploadFile, "read", read_spy)

    response = client.post(
        "/api/uploads?role=chat",
        files={"file": ("tiny.gguf", b"abc" * 1024, "application/octet-stream")},
    )

    assert response.status_code == 200
    assert read_sizes
    assert all(size > 0 for size in read_sizes)
    assert (tmp_path / "models" / "chat" / "tiny" / "tiny.gguf").read_bytes() == b"abc" * 1024
    assert response.json()["container_path"] == "/models/chat/tiny/tiny.gguf"


def test_upload_rejects_unsafe_paths_extensions_and_symlink_escapes(tmp_path: Path, monkeypatch) -> None:
    models_dir = tmp_path / "models"
    outside_dir = tmp_path / "outside"
    chat_dir = models_dir / "chat"
    outside_dir.mkdir()
    chat_dir.mkdir(parents=True)
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(models_dir))
    monkeypatch.setenv("LLAMA_SWAP_MODEL_ROOT", "/models")
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)

    traversal = client.post(
        "/api/uploads?role=chat",
        files={"file": ("../escape.gguf", b"bad", "application/octet-stream")},
    )
    absolute = client.post(
        "/api/uploads?role=chat",
        files={"file": ("/tmp/escape.gguf", b"bad", "application/octet-stream")},
    )
    nested = client.post(
        "/api/uploads?role=chat",
        files={"file": ("nested/escape.gguf", b"bad", "application/octet-stream")},
    )
    extension = client.post(
        "/api/uploads?role=chat",
        files={"file": ("tiny.txt", b"bad", "text/plain")},
    )
    link_dir = chat_dir / "link"
    link_dir.mkdir()
    os.symlink(outside_dir / "escape.gguf", link_dir / "link.gguf")
    symlink = client.post(
        "/api/uploads?role=chat",
        files={"file": ("link.gguf", b"bad", "application/octet-stream")},
    )

    assert traversal.status_code == 400
    assert absolute.status_code == 400
    assert nested.status_code == 400
    assert extension.status_code == 400
    assert symlink.status_code == 400
    assert not (tmp_path / "escape.gguf").exists()
    assert not (outside_dir / "escape.gguf").exists()


def test_upload_oversize_returns_413_and_removes_partial_file(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(tmp_path / "models"))
    monkeypatch.setenv("LLAMA_SWAP_MODEL_ROOT", "/models")
    monkeypatch.setenv("MAX_UPLOAD_BYTES", "4")
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)

    response = client.post(
        "/api/uploads?role=chat",
        files={"file": ("too-big.gguf", b"12345", "application/octet-stream")},
    )

    assert response.status_code == 413
    assert not (tmp_path / "models" / "chat" / "too-big" / "too-big.gguf").exists()


def test_upload_oversize_preserves_existing_file(tmp_path: Path, monkeypatch) -> None:
    existing = tmp_path / "models" / "chat" / "too-big" / "too-big.gguf"
    existing.parent.mkdir(parents=True)
    existing.write_bytes(b"existing-model")
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(tmp_path / "models"))
    monkeypatch.setenv("LLAMA_SWAP_MODEL_ROOT", "/models")
    monkeypatch.setenv("MAX_UPLOAD_BYTES", "4")
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)

    response = client.post(
        "/api/uploads?role=chat",
        files={"file": ("too-big.gguf", b"12345", "application/octet-stream")},
    )

    assert response.status_code == 413
    assert existing.read_bytes() == b"existing-model"

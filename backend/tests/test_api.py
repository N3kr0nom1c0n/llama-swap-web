from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

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

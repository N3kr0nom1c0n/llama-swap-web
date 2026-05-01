from __future__ import annotations

import os
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.datastructures import UploadFile as StarletteUploadFile

from app import settings as settings_module
from app.main import create_app
from app.schemas import DownloadJob, TargetRig


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


def test_hf_token_save_preserves_existing_non_token_env_lines(tmp_path: Path, monkeypatch) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text("OTHER=value\nHF_TOKEN=hf_existing_secret\nNO_NEWLINE=kept", encoding="utf-8")
    monkeypatch.setenv("MANAGER_ENV_FILE", str(env_file))

    settings_module.save_hf_token("hf_new_secret")

    assert env_file.read_text(encoding="utf-8") == "OTHER=value\nHF_TOKEN=hf_new_secret\nNO_NEWLINE=kept"


def test_llama_swap_restart_is_disabled_by_default(tmp_path: Path) -> None:
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)

    status = client.get("/api/llama-swap/status")
    restart = client.post("/api/llama-swap/restart")

    assert status.status_code == 200
    assert status.json()["enabled"] is False
    assert status.json()["available"] is False
    assert status.json()["container_name"] == "llama-swap"
    assert restart.status_code == 409
    assert "disabled" in restart.json()["detail"]


def test_llama_swap_restart_uses_configured_docker_socket(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("LLAMA_SWAP_RESTART_ENABLED", "true")
    monkeypatch.setenv("LLAMA_SWAP_CONTAINER_NAME", "llama-swap")
    monkeypatch.setenv("DOCKER_SOCKET_PATH", str(tmp_path / "docker.sock"))
    calls: list[tuple[str, str, int]] = []

    def fake_status(settings):
        return {
            "enabled": settings.llama_swap_restart_enabled,
            "available": True,
            "container_name": settings.llama_swap_container_name,
            "socket_path": settings.docker_socket_path,
            "status": "running",
            "running": True,
            "error": "",
            "warning": "Docker socket access can control this host.",
        }

    def fake_restart(settings):
        calls.append((settings.docker_socket_path, settings.llama_swap_container_name, settings.llama_swap_restart_timeout))
        return {
            "restarted": True,
            "message": "Restarted llama-swap.",
            "status": fake_status(settings),
        }

    monkeypatch.setattr("app.main.get_llama_swap_status", fake_status)
    monkeypatch.setattr("app.main.restart_llama_swap", fake_restart)
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)

    status = client.get("/api/llama-swap/status")
    restarted = client.post("/api/llama-swap/restart")

    assert status.status_code == 200
    assert status.json()["enabled"] is True
    assert restarted.status_code == 200
    assert restarted.json()["restarted"] is True
    assert restarted.json()["status"]["running"] is True
    assert calls == [(str(tmp_path / "docker.sock"), "llama-swap", 30)]


def test_ssh_llama_swap_restart_failure_returns_controlled_error(tmp_path: Path, monkeypatch) -> None:
    from app.target_rig_service import TargetRigError

    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)
    ssh_rig = TargetRig(
        id="rig-40",
        name="Rig 40",
        mode="ssh",
        host="192.168.42.40",
        username="n3kr0",
        model_root="/remote/models",
        config_path="/remote/config.yaml",
        backups_dir="/remote/backups",
        download_temp_dir="/remote/tmp",
    )
    assert client.post("/api/target-rigs", json=ssh_rig.model_dump(mode="json")).status_code == 200

    class BrokenClient:
        def restart(self) -> dict:
            raise TargetRigError("ssh restart failed")

    monkeypatch.setattr("app.main.create_target_client", lambda *_args, **_kwargs: BrokenClient())

    response = client.post("/api/llama-swap/restart?target_rig_id=rig-40")

    assert response.status_code == 409
    assert "ssh restart failed" in response.json()["detail"]


def test_target_rig_health_returns_path_errors_without_500(tmp_path: Path, monkeypatch) -> None:
    from app.target_rig_service import TargetRigError

    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)
    ssh_rig = TargetRig(
        id="rig-40",
        name="Rig 40",
        mode="ssh",
        host="192.168.42.40",
        username="n3kr0",
        model_root="/remote/models",
        config_path="/remote/config.yaml",
        backups_dir="/remote/backups",
        download_temp_dir="/remote/tmp",
    )
    assert client.post("/api/target-rigs", json=ssh_rig.model_dump(mode="json")).status_code == 200

    class BrokenHealthClient:
        def path_status(self, path: str) -> dict:
            raise TargetRigError("ssh key not readable")

        def runtime_status(self) -> dict:
            return {
                "enabled": True,
                "available": False,
                "container_name": "Rig 40",
                "socket_path": "ssh",
                "container_id": "",
                "status": "unreachable",
                "running": False,
                "error": "ssh key not readable",
                "warning": "",
            }

    monkeypatch.setattr("app.main.create_target_client", lambda *_args, **_kwargs: BrokenHealthClient())

    response = client.get("/api/target-rigs/rig-40/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["model_root"]["error"] == "ssh key not readable"
    assert payload["model_root"]["writable"] is False
    assert payload["runtime"]["available"] is False


def test_hf_token_write_preserves_env_file_when_replace_fails(tmp_path: Path, monkeypatch) -> None:
    env_file = tmp_path / ".env"
    original = "OTHER=value\nHF_TOKEN=hf_existing_secret\nTRAILING=kept\n"
    env_file.write_text(original, encoding="utf-8")
    monkeypatch.setenv("MANAGER_ENV_FILE", str(env_file))

    def fail_replace(src: str | bytes | os.PathLike[str] | os.PathLike[bytes], dst: str | bytes | os.PathLike[str] | os.PathLike[bytes]) -> None:
        raise OSError("injected replace failure")

    monkeypatch.setattr(settings_module.os, "replace", fail_replace)

    with pytest.raises(OSError, match="injected replace failure"):
        settings_module.save_hf_token("hf_new_secret")

    assert env_file.read_text(encoding="utf-8") == original


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


def test_models_with_same_id_are_scoped_by_target_rig(tmp_path: Path) -> None:
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)
    assert client.post("/api/target-rigs", json=TargetRig(id="rig-a", name="Rig A").model_dump(mode="json")).status_code == 200
    assert client.post("/api/target-rigs", json=TargetRig(id="rig-b", name="Rig B").model_dump(mode="json")).status_code == 200

    first = {
        "id": "qwen",
        "display_name": "Qwen On A",
        "target_rig_id": "rig-a",
        "role": "chat",
        "container_files": ["/models/chat/a.gguf"],
        "primary_model_file": "/models/chat/a.gguf",
        "matrix_key": "qa",
        "matrix_behavior": "runs_alone",
    }
    second = {
        "id": "qwen",
        "display_name": "Qwen On B",
        "target_rig_id": "rig-b",
        "role": "chat",
        "container_files": ["/models/chat/b.gguf"],
        "primary_model_file": "/models/chat/b.gguf",
        "matrix_key": "qb",
        "matrix_behavior": "runs_alone",
    }

    assert client.post("/api/models", json=first).status_code == 200
    assert client.post("/api/models", json=second).status_code == 200

    rig_a_models = client.get("/api/models?target_rig_id=rig-a").json()
    rig_b_models = client.get("/api/models?target_rig_id=rig-b").json()
    assert [(model["id"], model["display_name"]) for model in rig_a_models] == [("qwen", "Qwen On A")]
    assert [(model["id"], model["display_name"]) for model in rig_b_models] == [("qwen", "Qwen On B")]
    assert client.get("/api/models").json() == []


def test_create_model_from_completed_download_infers_installed_files(tmp_path: Path, monkeypatch) -> None:
    models_dir = tmp_path / "models"
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(models_dir))
    monkeypatch.setenv("LLAMA_SWAP_MODEL_ROOT", "/models")
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)
    installed_dir = models_dir / "vision" / "qwen"
    files = {
        "model": installed_dir / "qwen-00001-of-00002.gguf",
        "part2": installed_dir / "qwen-00002-of-00002.gguf",
        "mmproj": installed_dir / "mmproj-F16.gguf",
        "template": installed_dir / "chat_template.jinja",
        "tokenizer": installed_dir / "tokenizer.json",
    }
    for path in files.values():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("fake", encoding="utf-8")
    written_files = [str(path) for path in files.values()]
    container_files = [f"/models/vision/qwen/{path.name}" for path in files.values()]
    app.state.db.save_job(
        DownloadJob(
            id="downloaded-qwen",
            status="completed",
            repo_id="org/qwen",
            revision="main",
            files=[path.name for path in files.values()],
            destination_dir=str(installed_dir),
            container_dir="/models/vision/qwen",
            written_files=written_files,
            container_files=container_files,
        )
    )

    response = client.post(
        "/api/models/from-download/downloaded-qwen",
        json={
            "id": "qwen-vision",
            "display_name": "Qwen Vision",
            "role": "vision",
            "gpu_devices": [0, 1],
            "matrix_behavior": "runs_alone",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == "qwen-vision"
    assert payload["display_name"] == "Qwen Vision"
    assert payload["source_type"] == "hf"
    assert payload["hf_url"] == "https://huggingface.co/org/qwen"
    assert payload["hf_revision"] == "main"
    assert payload["role"] == "vision"
    assert payload["ttl"] == 300
    assert payload["gpu_devices"] == [0, 1]
    assert payload["manager_files"] == written_files
    assert payload["container_files"] == container_files
    assert payload["primary_model_file"] == "/models/vision/qwen/qwen-00001-of-00002.gguf"
    assert payload["mmproj_file"] == "/models/vision/qwen/mmproj-F16.gguf"
    assert payload["chat_template_file"] == "/models/vision/qwen/chat_template.jinja"
    assert payload["tokenizer_files"] == ["/models/vision/qwen/tokenizer.json"]
    listed = client.get("/api/models").json()
    assert [model["id"] for model in listed] == ["qwen-vision"]


def test_create_model_from_download_rejects_incomplete_or_missing_files(tmp_path: Path, monkeypatch) -> None:
    models_dir = tmp_path / "models"
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(models_dir))
    monkeypatch.setenv("LLAMA_SWAP_MODEL_ROOT", "/models")
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)
    app.state.db.save_job(
        DownloadJob(
            id="running-download",
            status="running",
            repo_id="org/repo",
            files=["model.gguf"],
            destination_dir=str(models_dir / "chat" / "repo"),
        )
    )
    app.state.db.save_job(
        DownloadJob(
            id="missing-file",
            status="completed",
            repo_id="org/repo",
            files=["model.gguf"],
            destination_dir=str(models_dir / "chat" / "repo"),
            written_files=[str(models_dir / "chat" / "repo" / "model.gguf")],
            container_files=["/models/chat/repo/model.gguf"],
        )
    )

    running = client.post("/api/models/from-download/running-download", json={"role": "chat"})
    missing = client.post("/api/models/from-download/missing-file", json={"role": "chat"})

    assert running.status_code == 409
    assert "completed" in running.json()["detail"]
    assert missing.status_code == 409
    assert "missing" in missing.json()["detail"]


def test_create_model_from_download_rejects_incomplete_multipart_job(tmp_path: Path, monkeypatch) -> None:
    models_dir = tmp_path / "models"
    first_part = models_dir / "chat" / "repo" / "model-00001-of-00002.gguf"
    first_part.parent.mkdir(parents=True)
    first_part.write_text("fake", encoding="utf-8")
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(models_dir))
    monkeypatch.setenv("LLAMA_SWAP_MODEL_ROOT", "/models")
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)
    app.state.db.save_job(
        DownloadJob(
            id="partial-multipart",
            status="completed",
            repo_id="org/repo",
            files=["model-00001-of-00002.gguf", "model-00002-of-00002.gguf"],
            destination_dir=str(first_part.parent),
            written_files=[str(first_part)],
            container_files=["/models/chat/repo/model-00001-of-00002.gguf"],
        )
    )

    response = client.post("/api/models/from-download/partial-multipart", json={"role": "chat"})

    assert response.status_code == 409
    assert "incomplete" in response.json()["detail"]


def test_create_model_from_download_rejects_single_selected_multipart_part(tmp_path: Path, monkeypatch) -> None:
    models_dir = tmp_path / "models"
    first_part = models_dir / "chat" / "repo" / "model-00001-of-00002.gguf"
    first_part.parent.mkdir(parents=True)
    first_part.write_text("fake", encoding="utf-8")
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(models_dir))
    monkeypatch.setenv("LLAMA_SWAP_MODEL_ROOT", "/models")
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)
    app.state.db.save_job(
        DownloadJob(
            id="selected-first-only",
            status="completed",
            repo_id="org/repo",
            files=["model-00001-of-00002.gguf"],
            destination_dir=str(first_part.parent),
            written_files=[str(first_part)],
            container_files=["/models/chat/repo/model-00001-of-00002.gguf"],
        )
    )

    response = client.post("/api/models/from-download/selected-first-only", json={"role": "chat"})

    assert response.status_code == 409
    assert "incomplete" in response.json()["detail"]


def test_create_model_from_download_infers_role_from_destination_when_omitted(tmp_path: Path, monkeypatch) -> None:
    models_dir = tmp_path / "models"
    model_file = models_dir / "vision" / "repo" / "model.gguf"
    model_file.parent.mkdir(parents=True)
    model_file.write_text("fake", encoding="utf-8")
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(models_dir))
    monkeypatch.setenv("LLAMA_SWAP_MODEL_ROOT", "/models")
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)
    app.state.db.save_job(
        DownloadJob(
            id="vision-download",
            status="completed",
            repo_id="org/repo",
            files=["model.gguf"],
            destination_dir=str(model_file.parent),
            container_dir="/models/vision/repo",
            written_files=[str(model_file)],
            container_files=["/models/vision/repo/model.gguf"],
        )
    )

    response = client.post("/api/models/from-download/vision-download", json={})

    assert response.status_code == 200
    assert response.json()["role"] == "vision"
    assert response.json()["ttl"] == 300


def test_create_model_from_download_rejects_existing_requested_id(tmp_path: Path, monkeypatch) -> None:
    models_dir = tmp_path / "models"
    model_file = models_dir / "chat" / "repo" / "model.gguf"
    model_file.parent.mkdir(parents=True)
    model_file.write_text("fake", encoding="utf-8")
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(models_dir))
    monkeypatch.setenv("LLAMA_SWAP_MODEL_ROOT", "/models")
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)
    client.post(
        "/api/models",
        json={
            "id": "repo",
            "display_name": "Existing Repo",
            "role": "chat",
            "manager_files": [str(model_file)],
        },
    )
    app.state.db.save_job(
        DownloadJob(
            id="duplicate-download",
            status="completed",
            repo_id="org/repo",
            files=["model.gguf"],
            destination_dir=str(model_file.parent),
            written_files=[str(model_file)],
            container_files=["/models/chat/repo/model.gguf"],
        )
    )

    response = client.post("/api/models/from-download/duplicate-download", json={"id": "repo"})

    assert response.status_code == 409
    assert "already exists" in response.json()["detail"]


def test_model_scan_discovers_supported_files_without_following_external_symlinks(tmp_path: Path, monkeypatch) -> None:
    models_dir = tmp_path / "models"
    inside = models_dir / "chat" / "tiny" / "tiny.gguf"
    template = models_dir / "chat" / "tiny" / "chat_template.jinja"
    outside = tmp_path / "outside.gguf"
    inside.parent.mkdir(parents=True)
    inside.write_text("fake", encoding="utf-8")
    template.write_text("fake", encoding="utf-8")
    outside.write_text("outside", encoding="utf-8")
    os.symlink(outside, models_dir / "chat" / "tiny" / "escape.gguf")
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(models_dir))
    monkeypatch.setenv("LLAMA_SWAP_MODEL_ROOT", "/models")
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)

    response = client.get("/api/models/scan")

    assert response.status_code == 200
    by_container_path = {item["container_path"]: item for item in response.json()}
    assert by_container_path["/models/chat/tiny/tiny.gguf"]["kind"] == "gguf"
    assert by_container_path["/models/chat/tiny/chat_template.jinja"]["kind"] == "chat_template"
    assert "/models/chat/tiny/escape.gguf" not in by_container_path


def test_gpu_detection_endpoint_merges_saved_labels(tmp_path: Path, monkeypatch) -> None:
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)
    client.put("/api/gpus", json=[{"index": 0, "name": "old", "vram_gb": 24, "role": "reasoning", "notes": "primary"}])
    monkeypatch.setattr(
        "app.main.detect_gpus",
        lambda: {
            "available": True,
            "reason": "",
            "gpus": [
                {
                    "index": 0,
                    "name": "NVIDIA GeForce RTX 3090",
                    "vram_gb": 24,
                    "memory_total_mb": 24576,
                    "memory_used_mb": 1024,
                    "memory_free_mb": 23552,
                }
            ],
        },
    )

    response = client.get("/api/gpus/detect")

    assert response.status_code == 200
    payload = response.json()
    assert payload["available"] is True
    assert payload["gpus"][0]["name"] == "NVIDIA GeForce RTX 3090"
    assert payload["gpus"][0]["role"] == "reasoning"
    assert payload["gpus"][0]["notes"] == "primary"


def test_gpu_detection_endpoint_reports_unavailable(tmp_path: Path, monkeypatch) -> None:
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)
    monkeypatch.setattr("app.main.detect_gpus", lambda: {"available": False, "reason": "nvidia-smi unavailable", "gpus": []})

    response = client.get("/api/gpus/detect")

    assert response.status_code == 200
    assert response.json() == {"available": False, "reason": "nvidia-smi unavailable", "gpus": []}


def test_gpu_recommend_endpoint_returns_split(tmp_path: Path, monkeypatch) -> None:
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)
    monkeypatch.setattr(
        "app.main.detect_gpus",
        lambda: {
            "available": True,
            "reason": "",
            "gpus": [
                {"index": 0, "memory_total_mb": 24576, "memory_free_mb": 24576},
                {"index": 1, "memory_total_mb": 16384, "memory_free_mb": 16384},
            ],
        },
    )

    response = client.post("/api/gpus/recommend", json={"cuda_devices": [0, 1]})

    assert response.status_code == 200
    assert response.json()["recommendation"]["main_gpu"] == 0
    assert response.json()["recommendation"]["tensor_split"] == "3,2"


def test_gpu_recommend_rejects_malformed_device_values(tmp_path: Path, monkeypatch) -> None:
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)
    monkeypatch.setattr("app.main.detect_gpus", lambda: {"available": True, "reason": "", "gpus": []})

    response = client.post("/api/gpus/recommend", json={"cuda_devices": ["gpu0"]})

    assert response.status_code == 422


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
    assert payload["destination_dir"] == str(tmp_path / "host-models" / "chat" / "tiny")
    assert payload["container_dir"] == "/models/chat/tiny"


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


def test_ssh_config_preview_validates_target_paths_not_manager_paths(tmp_path: Path, monkeypatch) -> None:
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)
    ssh_rig = TargetRig(
        id="rig-40",
        name="Rig 40",
        mode="ssh",
        host="192.168.42.40",
        username="n3kr0",
        model_root="/remote/models",
        llama_swap_model_root="/models",
        config_path="/remote/llama-swap/config.yaml",
        backups_dir="/remote/backups",
        download_temp_dir="/remote/tmp",
    )
    assert client.post("/api/target-rigs", json=ssh_rig.model_dump(mode="json")).status_code == 200
    client.post(
        "/api/models",
        json={
            "id": "remote-chat",
            "display_name": "Remote Chat",
            "target_rig_id": "rig-40",
            "role": "chat",
            "container_files": ["/models/chat/remote.gguf"],
            "primary_model_file": "/models/chat/remote.gguf",
            "matrix_key": "rc",
            "matrix_behavior": "runs_alone",
        },
    )

    class HealthyRemoteClient:
        def __init__(self, rig, _settings):
            self.rig = rig

        def read_text(self, _path: str) -> str:
            return "models: {}\n"

        def path_status(self, path: str) -> dict:
            return {
                "path": path,
                "exists": True,
                "is_dir": path != self.rig.config_path,
                "readable": True,
                "writable": True,
            }

        def disk_free_bytes(self, _path: str) -> int:
            return 100 * 1024**3

    monkeypatch.setattr("app.main.create_target_client", lambda rig, settings: HealthyRemoteClient(rig, settings))

    response = client.post("/api/config/preview", json={"target_rig_id": "rig-40", "model_ids": ["remote-chat"]})

    assert response.status_code == 200
    payload = response.json()
    assert payload["valid"] is True
    assert payload["errors"] == []
    assert "remote-chat:" in payload["yaml"]
    assert "/remote/" not in payload["yaml"]


def test_config_apply_blocks_destructive_stage_until_confirmed(tmp_path: Path, monkeypatch) -> None:
    config = tmp_path / "config.yaml"
    config.write_text(
        """
models:
  tiny-chat:
    aliases:
      - old-alias
    cmd: /app/llama-server --port ${PORT} -m /models/chat/old.gguf
matrix:
  vars:
    old: tiny-chat
  sets:
    old_set: old
hooks:
  on_startup:
    preload:
      - tiny-chat
""",
        encoding="utf-8",
    )
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
    blocked = client.post("/api/config/apply", json={"stage_id": stage_id})
    confirmed = client.post("/api/config/apply", json={"stage_id": stage_id, "confirm_destructive": True})

    assert preview.status_code == 200
    assert preview.json()["destructive_changes"]
    assert blocked.status_code == 409
    assert "destructive" in blocked.json()["detail"]
    assert confirmed.status_code == 200
    assert "old-alias" not in config.read_text(encoding="utf-8")


def test_config_import_candidates_can_be_reviewed_and_saved(tmp_path: Path, monkeypatch) -> None:
    config = tmp_path / "config.yaml"
    config.write_text(
        """
models:
  Existing Chat:
    cmd: |
      /app/llama-server --port ${PORT} -m /models/chat/existing/model.gguf \\
        --ctx-size 4096 \\
        --main-gpu 0
    ttl: 0
    env:
      - CUDA_VISIBLE_DEVICES=0
matrix:
  vars:
    ec: Existing Chat
  sets:
    ec_set: ec
""",
        encoding="utf-8",
    )
    monkeypatch.setenv("LLAMA_SWAP_CONFIG_PATH", str(config))
    monkeypatch.setenv("BACKUPS_DIR", str(tmp_path / "backups"))
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(tmp_path / "models"))
    monkeypatch.setenv("LLAMA_SWAP_MODEL_ROOT", "/models")
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)

    candidates = client.get("/api/config/import-candidates")
    imported = client.post("/api/config/import-candidates", json={"candidate_ids": ["existing-chat"]})

    assert candidates.status_code == 200
    assert candidates.json()[0]["id"] == "existing-chat"
    assert candidates.json()[0]["model"]["primary_model_file"] == "/models/chat/existing/model.gguf"
    assert imported.status_code == 200
    assert imported.json()[0]["id"] == "existing-chat"
    assert client.get("/api/models").json()[0]["id"] == "existing-chat"


def test_config_import_generates_unique_ids_for_colliding_slugs(tmp_path: Path, monkeypatch) -> None:
    config = tmp_path / "config.yaml"
    config.write_text(
        """
models:
  Existing Chat:
    cmd: /app/llama-server --port ${PORT} -m /models/chat/one.gguf
  Existing-Chat:
    cmd: /app/llama-server --port ${PORT} -m /models/chat/two.gguf
groups:
  legacy:
    members:
      - Existing Chat
""",
        encoding="utf-8",
    )
    monkeypatch.setenv("LLAMA_SWAP_CONFIG_PATH", str(config))
    monkeypatch.setenv("BACKUPS_DIR", str(tmp_path / "backups"))
    monkeypatch.setenv("MANAGER_MODEL_ROOT", str(tmp_path / "models"))
    monkeypatch.setenv("LLAMA_SWAP_MODEL_ROOT", "/models")
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)

    candidates = client.get("/api/config/import-candidates")
    imported = client.post("/api/config/import-candidates", json={"candidate_ids": []})

    assert candidates.status_code == 200
    assert [candidate["id"] for candidate in candidates.json()] == ["existing-chat", "existing-chat-2"]
    assert all(any("legacy groups" in warning for warning in candidate["warnings"]) for candidate in candidates.json())
    assert imported.status_code == 200
    assert [model["id"] for model in imported.json()] == ["existing-chat", "existing-chat-2"]


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
    confirmed = client.post("/api/config/apply", json={"stage_id": stage_id, "confirm_destructive": True})

    assert response.status_code == 409
    assert confirmed.status_code == 409
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


def test_config_backup_routes_list_and_restore_selected_backup(tmp_path: Path, monkeypatch) -> None:
    config_path = tmp_path / "config.yaml"
    backups_dir = tmp_path / "backups"
    backups_dir.mkdir()
    config_path.write_text("models:\n  current: {}\n", encoding="utf-8")
    selected = backups_dir / "config-20260430-120000-000000.yaml"
    selected.write_text("models:\n  restored: {}\n", encoding="utf-8")
    monkeypatch.setenv("LLAMA_SWAP_CONFIG_PATH", str(config_path))
    monkeypatch.setenv("BACKUPS_DIR", str(backups_dir))
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)

    listed = client.get("/api/config/backups")
    restored = client.post("/api/config/restore", json={"backup_name": selected.name})

    assert listed.status_code == 200
    assert [item["name"] for item in listed.json()] == [selected.name]
    assert restored.status_code == 200
    payload = restored.json()
    assert payload["restored"] is True
    assert payload["source_backup"] == selected.name
    assert payload["restart_required"] is True
    assert Path(payload["current_backup"]).exists()
    assert config_path.read_text(encoding="utf-8") == "models:\n  restored: {}\n"


def test_config_restore_route_rejects_backup_traversal(tmp_path: Path, monkeypatch) -> None:
    config_path = tmp_path / "config.yaml"
    backups_dir = tmp_path / "backups"
    backups_dir.mkdir()
    config_path.write_text("models: {}\n", encoding="utf-8")
    monkeypatch.setenv("LLAMA_SWAP_CONFIG_PATH", str(config_path))
    monkeypatch.setenv("BACKUPS_DIR", str(backups_dir))
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)

    response = client.post("/api/config/restore", json={"backup_name": "../config.yaml"})

    assert response.status_code == 400
    assert config_path.read_text(encoding="utf-8") == "models: {}\n"


def test_download_cleanup_route_removes_terminal_jobs_only(tmp_path: Path) -> None:
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)
    app.state.db.save_job(DownloadJob(id="complete", status="completed", repo_id="org/repo"))
    app.state.db.save_job(DownloadJob(id="failed", status="failed", repo_id="org/repo"))
    app.state.db.save_job(DownloadJob(id="running", status="running", repo_id="org/repo"))

    response = client.delete("/api/downloads/terminal")

    assert response.status_code == 200
    assert response.json() == {"removed": 2}
    remaining = {job["id"] for job in client.get("/api/downloads").json()}
    assert remaining == {"running"}


def test_download_cleanup_route_can_be_scoped_to_target_rig(tmp_path: Path) -> None:
    app = create_app(tmp_path / "manager.db")
    client = TestClient(app)
    app.state.db.save_target_rig(TargetRig(id="rig-a", name="Rig A"))
    app.state.db.save_target_rig(TargetRig(id="rig-b", name="Rig B"))
    app.state.db.save_job(DownloadJob(id="a-done", status="completed", repo_id="org/repo", target_rig_id="rig-a"))
    app.state.db.save_job(DownloadJob(id="b-done", status="completed", repo_id="org/repo", target_rig_id="rig-b"))
    app.state.db.save_job(DownloadJob(id="a-running", status="running", repo_id="org/repo", target_rig_id="rig-a"))

    response = client.delete("/api/downloads/terminal?target_rig_id=rig-a")

    assert response.status_code == 200
    assert response.json() == {"removed": 1}
    remaining = {job["id"] for job in client.get("/api/downloads").json()}
    assert remaining == {"b-done", "a-running"}

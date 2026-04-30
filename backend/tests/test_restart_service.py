from __future__ import annotations

from json import dumps
from pathlib import Path

from fastapi.testclient import TestClient

from app import restart_service
from app.database import Database
from app.main import create_app
from app.settings import ManagerSettings


def test_restart_uses_socket_timeout_longer_than_docker_restart_timeout(monkeypatch) -> None:
    settings = ManagerSettings(
        llama_swap_restart_enabled=True,
        llama_swap_restart_timeout=40,
        docker_socket_path="/var/run/docker.sock",
    )
    calls: list[tuple[str, str, float | None]] = []

    def fake_status(_settings: ManagerSettings) -> dict:
        return {"available": True, "running": True, "error": ""}

    def fake_request(
        _settings: ManagerSettings,
        method: str,
        path: str,
        expect_json: bool = True,
        timeout: float | None = None,
    ) -> dict:
        calls.append((method, path, timeout))
        return {}

    monkeypatch.setattr(restart_service, "get_llama_swap_status", fake_status)
    monkeypatch.setattr(restart_service, "_docker_request", fake_request)

    restart_service.restart_llama_swap(settings)

    assert calls == [("POST", "/containers/llama-swap/restart?t=40", 45)]


def test_status_reports_relative_socket_path_as_invalid() -> None:
    settings = ManagerSettings().model_copy(update={"llama_swap_restart_enabled": True, "docker_socket_path": "docker.sock"})

    status = restart_service.get_llama_swap_status(settings)

    assert status["enabled"] is True
    assert status["available"] is False
    assert "absolute" in status["error"]


def test_restart_settings_persist_across_app_recreate(tmp_path: Path) -> None:
    db_path = tmp_path / "manager.db"
    app = create_app(db_path)
    client = TestClient(app)
    settings = client.get("/api/settings").json()
    settings.update(
        {
            "llama_swap_restart_enabled": True,
            "llama_swap_container_name": "llama-swap",
            "docker_socket_path": str(tmp_path / "docker.sock"),
            "llama_swap_restart_timeout": 45,
        }
    )

    saved = client.put("/api/settings", json=settings)
    reloaded = TestClient(create_app(db_path)).get("/api/settings")
    status = TestClient(create_app(db_path)).get("/api/llama-swap/status")

    assert saved.status_code == 200
    assert reloaded.json()["llama_swap_restart_enabled"] is True
    assert reloaded.json()["llama_swap_restart_timeout"] == 45
    assert status.json()["enabled"] is True
    assert status.json()["container_name"] == "llama-swap"


def test_old_settings_payload_gets_restart_defaults(tmp_path: Path) -> None:
    db = Database(tmp_path / "manager.db")
    db.init()
    settings = ManagerSettings().model_dump()
    for key in ["llama_swap_restart_enabled", "llama_swap_container_name", "docker_socket_path", "llama_swap_restart_timeout"]:
        settings.pop(key)
    with db.connect() as conn:
        conn.execute("update settings set value = ? where key = 'settings'", (dumps(settings),))

    loaded = db.get_settings()

    assert loaded.llama_swap_restart_enabled is False
    assert loaded.llama_swap_container_name == "llama-swap"
    assert loaded.docker_socket_path == "/var/run/docker.sock"
    assert loaded.llama_swap_restart_timeout == 30

from __future__ import annotations

import http.client
import json
import os
import socket
import stat
from pathlib import Path
from urllib.parse import quote

from .settings import ManagerSettings


DOCKER_SOCKET_WARNING = "Docker socket access can control this host. Enable this only on a trusted LAN manager container."
RESTART_HTTP_TIMEOUT_BUFFER_SECONDS = 5


class LlamaSwapRestartError(RuntimeError):
    pass


class UnixSocketHTTPConnection(http.client.HTTPConnection):
    def __init__(self, socket_path: str, timeout: float = 5.0):
        super().__init__("localhost", timeout=timeout)
        self.socket_path = socket_path

    def connect(self) -> None:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(self.timeout)
        sock.connect(self.socket_path)
        self.sock = sock


def get_llama_swap_status(settings: ManagerSettings) -> dict:
    base = _base_status(settings)
    if not settings.llama_swap_restart_enabled:
        return {
            **base,
            "error": "Restart control is disabled.",
        }
    socket_error = _socket_error(settings.docker_socket_path)
    if socket_error:
        return {
            **base,
            "enabled": True,
            "error": socket_error,
        }
    try:
        inspect = _docker_request(settings, "GET", _container_path(settings.llama_swap_container_name, "json"))
    except LlamaSwapRestartError as exc:
        return {
            **base,
            "enabled": True,
            "error": str(exc),
        }
    state = inspect.get("State") if isinstance(inspect, dict) else {}
    return {
        **base,
        "enabled": True,
        "available": True,
        "container_id": str(inspect.get("Id", "")) if isinstance(inspect, dict) else "",
        "container_name": str(inspect.get("Name", "")).lstrip("/") if isinstance(inspect, dict) else settings.llama_swap_container_name,
        "status": str(state.get("Status", "")) if isinstance(state, dict) else "",
        "running": bool(state.get("Running", False)) if isinstance(state, dict) else False,
        "error": "",
    }


def restart_llama_swap(settings: ManagerSettings) -> dict:
    if not settings.llama_swap_restart_enabled:
        raise LlamaSwapRestartError("llama-swap restart control is disabled")
    status = get_llama_swap_status(settings)
    if not status.get("available"):
        raise LlamaSwapRestartError(str(status.get("error") or "llama-swap container is unavailable"))
    path = _container_path(settings.llama_swap_container_name, f"restart?t={settings.llama_swap_restart_timeout}")
    _docker_request(
        settings,
        "POST",
        path,
        expect_json=False,
        timeout=settings.llama_swap_restart_timeout + RESTART_HTTP_TIMEOUT_BUFFER_SECONDS,
    )
    next_status = get_llama_swap_status(settings)
    return {
        "restarted": True,
        "message": f"Restarted {settings.llama_swap_container_name}.",
        "status": next_status,
    }


def _base_status(settings: ManagerSettings) -> dict:
    return {
        "enabled": False,
        "available": False,
        "container_name": settings.llama_swap_container_name,
        "socket_path": settings.docker_socket_path,
        "container_id": "",
        "status": "",
        "running": False,
        "error": "",
        "warning": DOCKER_SOCKET_WARNING,
    }


def _socket_error(socket_path: str) -> str:
    path = Path(socket_path)
    if not path.is_absolute():
        return f"Docker socket path must be absolute: {socket_path}"
    try:
        mode = path.stat().st_mode
    except FileNotFoundError:
        return f"Docker socket not found at {socket_path}"
    except OSError as exc:
        return f"Docker socket is not accessible: {exc}"
    if not stat.S_ISSOCK(mode):
        return f"Docker socket path is not a socket: {socket_path}"
    if not os.access(path, os.R_OK | os.W_OK):
        return f"Docker socket is not readable and writable: {socket_path}"
    return ""


def _container_path(container_name: str, action: str) -> str:
    name = container_name.strip()
    if not name:
        raise LlamaSwapRestartError("llama-swap container name is required")
    return f"/containers/{quote(name, safe='')}/{action}"


def _docker_request(settings: ManagerSettings, method: str, path: str, expect_json: bool = True, timeout: float | None = None) -> dict:
    conn = UnixSocketHTTPConnection(settings.docker_socket_path, timeout=timeout or 10)
    try:
        conn.request(method, path, headers={"Host": "localhost"})
        response = conn.getresponse()
        body = response.read()
    except OSError as exc:
        raise LlamaSwapRestartError(f"Docker API request failed: {exc}") from exc
    finally:
        conn.close()
    if response.status >= 400:
        message = _docker_error_message(body) or response.reason
        raise LlamaSwapRestartError(f"Docker API returned {response.status}: {message}")
    if not expect_json:
        return {}
    if not body:
        return {}
    try:
        payload = json.loads(body.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise LlamaSwapRestartError("Docker API returned invalid JSON") from exc
    return payload if isinstance(payload, dict) else {}


def _docker_error_message(body: bytes) -> str:
    if not body:
        return ""
    try:
        payload = json.loads(body.decode("utf-8"))
    except json.JSONDecodeError:
        return body.decode("utf-8", errors="replace")
    if isinstance(payload, dict):
        return str(payload.get("message") or payload.get("error") or "")
    return str(payload)

from __future__ import annotations

import subprocess
import signal
from pathlib import Path

from app.schemas import TargetRig
from app.settings import ManagerSettings
from app.target_rig_service import SshTargetRigClient, container_path_for_target_path, target_path_for_container_path, terminate_process_tree


def test_ssh_gpu_detection_failure_returns_unavailable_shape() -> None:
    rig = TargetRig(id="rig-40", mode="ssh", host="192.168.42.40", username="n3kr0")

    def runner(args: list[str], input_data: str | bytes | None = None, timeout: int = 60) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(args=args, returncode=255, stdout="", stderr="ssh connection failed")

    client = SshTargetRigClient(rig, ManagerSettings(), runner=runner)

    detected = client.detect_gpus()
    status = client.gpu_status()

    assert detected == {"available": False, "reason": "ssh connection failed", "gpus": []}
    assert status == {"available": False, "reason": "ssh connection failed", "gpus": [], "processes": []}


def test_ssh_path_mapping_keeps_target_and_container_roots_separate() -> None:
    rig = TargetRig(
        id="rig-40",
        mode="ssh",
        host="192.168.42.40",
        username="n3kr0",
        model_root="/mnt/ai/models",
        llama_swap_model_root="/models",
    )

    target_path = target_path_for_container_path(rig, "/models/chat/Celeste/model.gguf")
    container_path = container_path_for_target_path(rig, "/mnt/ai/models/chat/Celeste/model.gguf")

    assert target_path == "/mnt/ai/models/chat/Celeste/model.gguf"
    assert container_path == "/models/chat/Celeste/model.gguf"


def test_ssh_upload_streams_bytes_to_remote_target(tmp_path: Path) -> None:
    local_file = tmp_path / "tiny.gguf"
    local_file.write_bytes(b"model-bytes")
    rig = TargetRig(id="rig-40", mode="ssh", host="192.168.42.40", username="n3kr0", model_root="/remote/models")
    calls: list[tuple[list[str], str | bytes | None, int]] = []
    file_calls: list[tuple[list[str], Path, int]] = []

    def runner(args: list[str], input_data: str | bytes | None = None, timeout: int = 60) -> subprocess.CompletedProcess[str]:
        calls.append((args, input_data, timeout))
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="", stderr="")

    def file_runner(args: list[str], input_path: Path, timeout: int = 60) -> subprocess.CompletedProcess[str]:
        file_calls.append((args, input_path, timeout))
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="", stderr="")

    client = SshTargetRigClient(rig, ManagerSettings(), runner=runner, file_runner=file_runner)

    written = client.upload_file(local_file, "/remote/models/chat/tiny/tiny.gguf")

    assert written == "/remote/models/chat/tiny/tiny.gguf"
    assert calls[0][1] is not None
    assert len(file_calls) == 1
    assert file_calls[0][1:] == (local_file, 3600)
    assert file_calls[0][0][:2] == ["ssh", "-p"]


def test_ssh_hf_download_does_not_put_raw_token_in_curl_argv() -> None:
    rig = TargetRig(id="rig-40", mode="ssh", host="192.168.42.40", username="n3kr0", model_root="/remote/models")
    scripts: list[str | bytes | None] = []

    def runner(args: list[str], input_data: str | bytes | None = None, timeout: int = 60) -> subprocess.CompletedProcess[str]:
        scripts.append(input_data)
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="", stderr="")

    client = SshTargetRigClient(rig, ManagerSettings(), runner=runner)

    written = client.download_hf_files(
        repo_id="org/private",
        revision="main",
        files=["model.gguf"],
        destination_dir="/remote/models/chat/private",
        token="hf_secret_should_not_be_in_argv",
    )

    script = "\n".join(str(item) for item in scripts)
    assert written == ["/remote/models/chat/private/model.gguf"]
    assert "Authorization: Bearer hf_secret_should_not_be_in_argv" not in script
    assert 'curl_auth=(--config "$auth_config")' in script
    assert 'curl -fL --retry 3 --connect-timeout 20 "${curl_auth[@]}"' in script


def test_terminate_process_tree_signals_process_group(monkeypatch) -> None:
    signals: list[tuple[int, int]] = []

    class FakeProcess:
        pid = 4242

        def __init__(self) -> None:
            self.alive = True
            self.terminated = False
            self.killed = False

        def is_alive(self) -> bool:
            return self.alive

        def terminate(self) -> None:
            self.terminated = True

        def kill(self) -> None:
            self.killed = True
            self.alive = False

        def join(self, timeout: int | None = None) -> None:
            if self.killed:
                self.alive = False

    monkeypatch.setattr("app.target_rig_service.os.killpg", lambda pid, sig: signals.append((pid, sig)))
    process = FakeProcess()

    terminate_process_tree(process)

    assert process.terminated is True
    assert process.killed is True
    assert signals[0] == (4242, signal.SIGTERM)
    assert signals[1] == (4242, signal.SIGKILL)

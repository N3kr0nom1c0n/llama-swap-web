from __future__ import annotations

import os
import base64
import signal
import posixpath
import shlex
import shutil
import subprocess
from collections.abc import Callable
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import quote

from .config_service import backup_and_apply_config, list_config_backups, manager_to_llama_path, restore_config_backup, safe_join
from .hf_service import _safe_hf_relative_parts, classify_file, download_selected_files
from .schemas import ConfigBackupMetadata, FileInventoryItem, TargetRig
from .settings import ManagerSettings


class TargetRigError(RuntimeError):
    pass


CommandRunner = Callable[[list[str], str | bytes | None, int], subprocess.CompletedProcess[str]]
FileRunner = Callable[[list[str], Path, int], subprocess.CompletedProcess[str]]


def default_command_runner(args: list[str], input_data: str | bytes | None = None, timeout: int = 60) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        input=input_data,
        capture_output=True,
        text=isinstance(input_data, str) or input_data is None,
        timeout=timeout,
        start_new_session=True,
    )


def default_file_runner(args: list[str], input_path: Path, timeout: int = 60) -> subprocess.CompletedProcess[str]:
    with input_path.open("rb") as source:
        return subprocess.run(
            args,
            stdin=source,
            capture_output=True,
            text=True,
            timeout=timeout,
            start_new_session=True,
        )


def terminate_process_tree(process: Any, timeout: int = 5) -> None:
    if not process.is_alive():
        return
    pid = getattr(process, "pid", None)
    process.terminate()
    if pid:
        try:
            os.killpg(int(pid), signal.SIGTERM)
        except (OSError, ProcessLookupError):
            pass
    process.join(timeout=timeout)
    if process.is_alive():
        process.kill()
        if pid:
            try:
                os.killpg(int(pid), signal.SIGKILL)
            except (OSError, ProcessLookupError):
                pass
        process.join(timeout=2)


def effective_settings_for_rig(settings: ManagerSettings, rig: TargetRig) -> ManagerSettings:
    return settings.model_copy(
        update={
            "manager_model_root": rig.model_root,
            "llama_swap_model_root": rig.llama_swap_model_root,
            "llama_swap_config_path": rig.config_path,
            "backups_dir": rig.backups_dir,
            "download_temp_dir": rig.download_temp_dir,
        }
    )


def target_path_for_container_path(rig: TargetRig, container_path: str) -> str:
    relative = _container_relative_path(container_path, rig.llama_swap_model_root)
    return _remote_safe_join(rig.model_root, relative)


def container_path_for_target_path(rig: TargetRig, target_path: str) -> str:
    relative = _remote_relative_path(target_path, rig.model_root)
    return _remote_safe_join(rig.llama_swap_model_root, relative)


def _container_relative_path(container_path: str, container_root: str) -> str:
    return _remote_relative_path(container_path, container_root)


def _remote_relative_path(path: str, root: str) -> str:
    candidate = PurePosixPath(posixpath.normpath(path))
    root_path = PurePosixPath(posixpath.normpath(root))
    if not candidate.is_absolute() or not root_path.is_absolute():
        raise ValueError("target paths must be absolute POSIX paths")
    if candidate != root_path and root_path not in candidate.parents:
        raise ValueError(f"path escapes configured root: {path}")
    return candidate.relative_to(root_path).as_posix()


def _remote_safe_join(root: str, *parts: str) -> str:
    root_path = PurePosixPath(posixpath.normpath(root))
    if not root_path.is_absolute():
        raise ValueError(f"target root must be absolute: {root}")
    candidate = PurePosixPath(posixpath.normpath(posixpath.join(root_path.as_posix(), *[str(part) for part in parts if str(part)])))
    if candidate != root_path and root_path not in candidate.parents:
        raise ValueError(f"path escapes configured root: {candidate}")
    return candidate.as_posix()


def _backup_name(path: str) -> str:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    return f"{Path(path).stem or 'config'}-{stamp}.yaml"


class TargetRigClient:
    def __init__(self, rig: TargetRig, settings: ManagerSettings):
        self.rig = rig
        self.settings = effective_settings_for_rig(settings, rig)

    def path_status(self, path: str) -> dict:
        raise NotImplementedError

    def read_text(self, path: str) -> str:
        raise NotImplementedError

    def apply_config(self, rendered_yaml: str, retention_count: int = 0, retention_days: int = 0) -> str:
        raise NotImplementedError

    def restore_config(self, backup_name: str) -> str:
        raise NotImplementedError

    def list_backups(self) -> list[ConfigBackupMetadata]:
        raise NotImplementedError

    def scan_model_files(self) -> list[FileInventoryItem]:
        raise NotImplementedError

    def is_file(self, path: str) -> bool:
        raise NotImplementedError

    def disk_free_bytes(self, path: str) -> int:
        raise NotImplementedError

    def download_hf_files(
        self,
        repo_id: str,
        revision: str,
        files: list[str],
        destination_dir: str,
        token: str | bool | None = None,
        on_file_complete: Callable[[str, int], None] | None = None,
    ) -> list[str]:
        raise NotImplementedError

    def upload_file(self, local_path: Path, destination_path: str) -> str:
        raise NotImplementedError

    def detect_gpus(self) -> dict:
        raise NotImplementedError

    def gpu_status(self) -> dict:
        raise NotImplementedError

    def runtime_status(self) -> dict:
        raise NotImplementedError

    def restart(self) -> dict:
        raise NotImplementedError


class LocalTargetRigClient(TargetRigClient):
    def path_status(self, path: str) -> dict:
        path_obj = Path(path)
        target = path_obj if path_obj.exists() else path_obj.parent
        return {
            "path": str(path_obj),
            "exists": path_obj.exists(),
            "is_dir": path_obj.is_dir(),
            "readable": os.access(path_obj, os.R_OK) if path_obj.exists() else False,
            "writable": os.access(target, os.W_OK),
        }

    def read_text(self, path: str) -> str:
        path_obj = Path(path)
        if not path_obj.exists():
            return ""
        return path_obj.read_text(encoding="utf-8")

    def apply_config(self, rendered_yaml: str, retention_count: int = 0, retention_days: int = 0) -> str:
        backup = backup_and_apply_config(
            self.rig.config_path,
            self.rig.backups_dir,
            rendered_yaml,
            retention_count=retention_count,
            retention_days=retention_days,
        )
        return str(backup)

    def restore_config(self, backup_name: str) -> str:
        return str(restore_config_backup(self.rig.config_path, self.rig.backups_dir, backup_name))

    def list_backups(self) -> list[ConfigBackupMetadata]:
        return list_config_backups(self.rig.backups_dir)

    def scan_model_files(self) -> list[FileInventoryItem]:
        root = Path(self.rig.model_root).resolve()
        if not root.exists():
            return []
        items: list[FileInventoryItem] = []
        for path in sorted(root.rglob("*")):
            if path.is_symlink() or not path.is_file():
                continue
            try:
                resolved = path.resolve()
                if resolved != root and root not in resolved.parents:
                    continue
                relative_path = resolved.relative_to(root).as_posix()
                container_path = manager_to_llama_path(str(resolved), self.settings)
                kind = classify_file(relative_path).kind
                if kind == "other":
                    continue
                items.append(
                    FileInventoryItem(
                        manager_path=str(resolved),
                        container_path=container_path,
                        relative_path=relative_path,
                        kind=kind,
                        size=resolved.stat().st_size,
                    )
                )
            except (OSError, ValueError):
                continue
        return items

    def is_file(self, path: str) -> bool:
        return Path(path).is_file()

    def disk_free_bytes(self, path: str) -> int:
        candidate = Path(path)
        while not candidate.exists() and candidate != candidate.parent:
            candidate = candidate.parent
        usage = shutil.disk_usage(candidate)
        return int(usage.free if hasattr(usage, "free") else usage[2])

    def download_hf_files(
        self,
        repo_id: str,
        revision: str,
        files: list[str],
        destination_dir: str,
        token: str | bool | None = None,
        on_file_complete: Callable[[str, int], None] | None = None,
    ) -> list[str]:
        written = download_selected_files(
            repo_id=repo_id,
            revision=revision,
            files=files,
            destination_dir=destination_dir,
            model_root=self.rig.model_root,
            token=token,
        )
        for index, path in enumerate(written, start=1):
            if on_file_complete:
                on_file_complete(path, index)
        return written

    def upload_file(self, local_path: Path, destination_path: str) -> str:
        target = safe_join(self.rig.model_root, _remote_relative_path(destination_path, self.rig.model_root))
        if target.exists():
            raise FileExistsError(f"target file already exists: {target}")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(local_path, target)
        return str(target)

    def detect_gpus(self) -> dict:
        from .gpu_service import detect_gpus

        return detect_gpus()

    def gpu_status(self) -> dict:
        from .gpu_service import gpu_status

        return gpu_status()

    def runtime_status(self) -> dict:
        from .restart_service import get_llama_swap_status

        return get_llama_swap_status(self.settings)

    def restart(self) -> dict:
        from .restart_service import restart_llama_swap

        return restart_llama_swap(self.settings)


class SshTargetRigClient(TargetRigClient):
    def __init__(
        self,
        rig: TargetRig,
        settings: ManagerSettings,
        runner: CommandRunner = default_command_runner,
        file_runner: FileRunner | None = None,
    ):
        super().__init__(rig, settings)
        self.runner = runner
        self.file_runner = file_runner or default_file_runner

    def path_status(self, path: str) -> dict:
        script = f"""
set -e
p={shlex.quote(path)}
if [ -e "$p" ]; then exists=1; else exists=0; fi
if [ -d "$p" ]; then is_dir=1; else is_dir=0; fi
if [ -r "$p" ]; then readable=1; else readable=0; fi
if [ -e "$p" ]; then target="$p"; else target="$(dirname "$p")"; fi
if [ -w "$target" ]; then writable=1; else writable=0; fi
printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$exists" "$is_dir" "$readable" "$writable" "$p"
"""
        output = self._run(script).strip().split("\t")
        return {
            "path": output[4] if len(output) > 4 else path,
            "exists": output[0] == "1" if output else False,
            "is_dir": output[1] == "1" if len(output) > 1 else False,
            "readable": output[2] == "1" if len(output) > 2 else False,
            "writable": output[3] == "1" if len(output) > 3 else False,
        }

    def read_text(self, path: str) -> str:
        return self._run(f"p={shlex.quote(path)}\nif [ -f \"$p\" ]; then cat \"$p\"; fi")

    def apply_config(self, rendered_yaml: str, retention_count: int = 0, retention_days: int = 0) -> str:
        backup = _remote_safe_join(self.rig.backups_dir, _backup_name(self.rig.config_path))
        config = shlex.quote(self.rig.config_path)
        backup_q = shlex.quote(backup)
        backups_q = shlex.quote(self.rig.backups_dir)
        encoded = base64.b64encode(rendered_yaml.encode("utf-8")).decode("ascii")
        script = f"""
set -euo pipefail
mkdir -p {backups_q}
if [ -e {config} ]; then cp -p {config} {backup_q}; else : > {backup_q}; fi
tmp="$(mktemp {shlex.quote(posixpath.dirname(self.rig.config_path) + '/.config.XXXXXX')})"
printf '%s' {shlex.quote(encoded)} | base64 -d > "$tmp"
mv "$tmp" {config}
printf '%s\\n' {backup_q}
"""
        return self._run(script).strip()

    def restore_config(self, backup_name: str) -> str:
        if PurePosixPath(backup_name).name != backup_name or "/" in backup_name or "\\" in backup_name:
            raise ValueError("backup name must be a file name")
        backup = _remote_safe_join(self.rig.backups_dir, backup_name)
        current_backup = _remote_safe_join(self.rig.backups_dir, _backup_name(self.rig.config_path))
        script = f"""
set -euo pipefail
test -f {shlex.quote(backup)}
mkdir -p {shlex.quote(self.rig.backups_dir)}
if [ -e {shlex.quote(self.rig.config_path)} ]; then cp -p {shlex.quote(self.rig.config_path)} {shlex.quote(current_backup)}; else : > {shlex.quote(current_backup)}; fi
cp -p {shlex.quote(backup)} {shlex.quote(self.rig.config_path)}
printf '%s\\n' {shlex.quote(current_backup)}
"""
        return self._run(script).strip()

    def list_backups(self) -> list[ConfigBackupMetadata]:
        script = f"""
set -e
dir={shlex.quote(self.rig.backups_dir)}
if [ ! -d "$dir" ]; then exit 0; fi
find "$dir" -maxdepth 1 -type f -name 'config*.yaml' -printf '%f\\t%p\\t%s\\t%T@\\n' | sort -r -k4
"""
        backups: list[ConfigBackupMetadata] = []
        for line in self._run(script).splitlines():
            parts = line.split("\t")
            if len(parts) != 4:
                continue
            try:
                modified = datetime.fromtimestamp(float(parts[3]))
            except ValueError:
                continue
            backups.append(ConfigBackupMetadata(name=parts[0], path=parts[1], size=int(parts[2]), modified=modified))
        return backups

    def scan_model_files(self) -> list[FileInventoryItem]:
        root = shlex.quote(self.rig.model_root)
        script = f"""
set -e
if [ ! -d {root} ]; then exit 0; fi
find {root} -type f -printf '%p\\t%s\\n'
"""
        items: list[FileInventoryItem] = []
        for line in self._run(script, timeout=120).splitlines():
            raw_path, _, raw_size = line.partition("\t")
            if not raw_path or not raw_size:
                continue
            try:
                relative_path = _remote_relative_path(raw_path, self.rig.model_root)
                kind = classify_file(relative_path).kind
                if kind == "other":
                    continue
                items.append(
                    FileInventoryItem(
                        manager_path=raw_path,
                        container_path=container_path_for_target_path(self.rig, raw_path),
                        relative_path=relative_path,
                        kind=kind,
                        size=int(raw_size),
                    )
                )
            except (ValueError, OSError):
                continue
        return items

    def is_file(self, path: str) -> bool:
        return self._run(f"test -f {shlex.quote(path)} && printf yes || true").strip() == "yes"

    def disk_free_bytes(self, path: str) -> int:
        script = f"""
set -e
p={shlex.quote(path)}
while [ ! -e "$p" ] && [ "$p" != "/" ]; do p="$(dirname "$p")"; done
df -Pk "$p" | awk 'NR==2 {{print $4 * 1024}}'
"""
        output = self._run(script).strip()
        return int(float(output or "0"))

    def download_hf_files(
        self,
        repo_id: str,
        revision: str,
        files: list[str],
        destination_dir: str,
        token: str | bool | None = None,
        on_file_complete: Callable[[str, int], None] | None = None,
    ) -> list[str]:
        destination = _remote_safe_join(self.rig.model_root, _remote_relative_path(destination_dir, self.rig.model_root))
        written: list[str] = []
        for index, filename in enumerate(files, start=1):
            parts = _safe_hf_relative_parts(filename)
            target = _remote_safe_join(destination, *parts)
            url = _hf_resolve_url(repo_id, revision, filename)
            script = _remote_curl_script(target, url, token)
            self._run(script, timeout=3600)
            written.append(target)
            if on_file_complete:
                on_file_complete(target, index)
        return written

    def upload_file(self, local_path: Path, destination_path: str) -> str:
        destination = _remote_safe_join(self.rig.model_root, _remote_relative_path(destination_path, self.rig.model_root))
        temp = f"{destination}.uploading"
        self._run(f"mkdir -p {shlex.quote(posixpath.dirname(destination))}\ntest ! -e {shlex.quote(destination)}")
        remote_command = f"set -euo pipefail; cat > {shlex.quote(temp)}; mv {shlex.quote(temp)} {shlex.quote(destination)}"
        result = self.file_runner(self._base_ssh_args() + [remote_command], local_path, 3600)
        if result.returncode != 0:
            raise TargetRigError(_clean_error(result.stderr or result.stdout or "upload failed"))
        return destination

    def detect_gpus(self) -> dict:
        from .gpu_service import detect_gpus

        return detect_gpus(lambda args: self._run("nvidia-smi " + " ".join(shlex.quote(arg) for arg in args), timeout=15))

    def gpu_status(self) -> dict:
        from .gpu_service import gpu_status

        return gpu_status(lambda args: self._run("nvidia-smi " + " ".join(shlex.quote(arg) for arg in args), timeout=15))

    def runtime_status(self) -> dict:
        try:
            self._run(self.rig.health_check_command or "true", timeout=15)
            return {
                "enabled": True,
                "available": True,
                "container_name": self.rig.name,
                "socket_path": "ssh",
                "container_id": "",
                "status": "reachable",
                "running": True,
                "error": "",
                "warning": "Restart runs over SSH on the selected target rig.",
            }
        except TargetRigError as exc:
            return {
                "enabled": True,
                "available": False,
                "container_name": self.rig.name,
                "socket_path": "ssh",
                "container_id": "",
                "status": "",
                "running": False,
                "error": str(exc),
                "warning": "Restart runs over SSH on the selected target rig.",
            }

    def restart(self) -> dict:
        self._run(self.rig.restart_command, timeout=300)
        return {"restarted": True, "message": f"Restarted llama-swap on {self.rig.name}.", "status": self.runtime_status()}

    def _base_ssh_args(self) -> list[str]:
        if not self.rig.host or not self.rig.username:
            raise TargetRigError("SSH target rig requires host and username")
        args = [
            "ssh",
            "-p",
            str(self.rig.port),
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=accept-new",
        ]
        if self.rig.ssh_key_path:
            args.extend(["-i", self.rig.ssh_key_path])
        args.append(f"{self.rig.username}@{self.rig.host}")
        return args

    def _run(self, script: str, timeout: int = 60) -> str:
        full_script = script if script.startswith("set ") else f"set -euo pipefail\n{script}\n"
        result = self.runner(self._base_ssh_args() + ["bash", "-s"], full_script, timeout)
        if result.returncode != 0:
            raise TargetRigError(_clean_error(result.stderr or result.stdout or "remote command failed"))
        return result.stdout


def create_target_client(rig: TargetRig, settings: ManagerSettings, runner: CommandRunner = default_command_runner) -> TargetRigClient:
    if rig.mode == "ssh":
        return SshTargetRigClient(rig, settings, runner=runner)
    return LocalTargetRigClient(rig, settings)


def _hf_resolve_url(repo_id: str, revision: str, filename: str) -> str:
    encoded_repo = "/".join(quote(part, safe="") for part in repo_id.split("/"))
    encoded_revision = quote(revision, safe="")
    encoded_file = "/".join(quote(part, safe="") for part in filename.split("/"))
    return f"https://huggingface.co/{encoded_repo}/resolve/{encoded_revision}/{encoded_file}"


def _remote_curl_script(target: str, url: str, token: str | bool | None) -> str:
    auth_line = "curl_auth=()"
    if token and isinstance(token, str):
        header = "Authorization: Bearer " + token
        escaped_header = header.replace("\\", "\\\\").replace('"', '\\"')
        encoded_header = base64.b64encode(f'header = "{escaped_header}"\n'.encode("utf-8")).decode("ascii")
        auth_line = f"""
auth_config="${{tmp}}.curlconfig"
printf '%s' {shlex.quote(encoded_header)} | base64 -d > "$auth_config"
chmod 600 "$auth_config"
curl_auth=(--config "$auth_config")
"""
    return f"""
set -euo pipefail
target={shlex.quote(target)}
url={shlex.quote(url)}
auth_config=""
mkdir -p "$(dirname "$target")"
test ! -e "$target"
tmp="${{target}}.partial.$$"
{auth_line}
trap 'rm -f "$tmp" ${{auth_config:+"$auth_config"}}' EXIT
curl -fL --retry 3 --connect-timeout 20 "${{curl_auth[@]}}" -o "$tmp" "$url"
mv "$tmp" "$target"
trap - EXIT
rm -f ${{auth_config:+"$auth_config"}}
"""


def _clean_error(message: str) -> str:
    if isinstance(message, bytes):
        message = message.decode("utf-8", errors="replace")
    return message.strip().replace("\n", "; ")[:500]

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from typing import Callable


GpuRunner = Callable[[list[str]], str]


@dataclass(frozen=True)
class DetectedGpu:
    index: int
    name: str
    vram_gb: int
    memory_total_mb: int
    memory_used_mb: int
    memory_free_mb: int

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "name": self.name,
            "vram_gb": self.vram_gb,
            "memory_total_mb": self.memory_total_mb,
            "memory_used_mb": self.memory_used_mb,
            "memory_free_mb": self.memory_free_mb,
        }


@dataclass(frozen=True)
class GpuProcess:
    gpu_uuid: str
    pid: int
    process_name: str
    used_memory_mb: int

    def to_dict(self) -> dict:
        return {
            "gpu_uuid": self.gpu_uuid,
            "pid": self.pid,
            "process_name": self.process_name,
            "used_memory_mb": self.used_memory_mb,
        }


def nvidia_smi_runner(args: list[str]) -> str:
    result = subprocess.run(
        ["nvidia-smi", *args],
        check=True,
        capture_output=True,
        text=True,
        timeout=5,
    )
    return result.stdout


def detect_gpus(runner: GpuRunner = nvidia_smi_runner) -> dict:
    try:
        output = runner(
            [
                "--query-gpu=index,name,memory.total,memory.used,memory.free",
                "--format=csv,noheader,nounits",
            ]
        )
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as exc:
        return {"available": False, "reason": _unavailable_reason(exc), "gpus": []}

    try:
        gpus = [_parse_gpu_line(line) for line in output.splitlines() if line.strip()]
    except ValueError as exc:
        return {"available": False, "reason": str(exc), "gpus": []}
    return {"available": True, "reason": "", "gpus": [gpu.to_dict() for gpu in gpus]}


def gpu_status(runner: GpuRunner = nvidia_smi_runner) -> dict:
    detection = detect_gpus(runner)
    if not detection["available"]:
        return {**detection, "processes": []}
    try:
        output = runner(
            [
                "--query-compute-apps=gpu_uuid,pid,process_name,used_memory",
                "--format=csv,noheader,nounits",
            ]
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        return {**detection, "processes": []}
    processes = []
    for line in output.splitlines():
        if not line.strip() or "No running processes found" in line:
            continue
        try:
            processes.append(_parse_process_line(line).to_dict())
        except ValueError:
            continue
    return {**detection, "processes": processes}


def recommend_tensor_split(gpus: list[dict], selected_indices: list[int]) -> dict:
    selected = [gpu for gpu in gpus if int(gpu.get("index", -1)) in selected_indices]
    available_indices = {int(gpu.get("index", -1)) for gpu in gpus}
    missing_indices = [index for index in selected_indices if index not in available_indices]
    if not selected:
        warnings = ["select at least one GPU"]
        if missing_indices:
            warnings.append(f"selected GPU(s) not detected: {', '.join(str(index) for index in missing_indices)}")
        return {"cuda_devices": [], "main_gpu": None, "tensor_split": "", "warnings": warnings}
    free_values = [max(0, int(gpu.get("memory_free_mb", 0))) for gpu in selected]
    if not any(free_values):
        free_values = [max(0, int(gpu.get("memory_total_mb", 0))) for gpu in selected]
    if not any(free_values):
        return {
            "cuda_devices": selected_indices,
            "main_gpu": selected_indices[0],
            "tensor_split": ",".join("1" for _ in selected),
            "warnings": [
                *([f"selected GPU(s) not detected: {', '.join(str(index) for index in missing_indices)}"] if missing_indices else []),
                "GPU memory totals are unavailable; using equal split",
            ],
        }
    divisor = _gcd_many(free_values)
    split_values = [max(1, value // divisor) for value in free_values]
    return {
        "cuda_devices": [int(gpu["index"]) for gpu in selected],
        "main_gpu": int(selected[0]["index"]),
        "tensor_split": ",".join(str(value) for value in split_values),
        "warnings": [f"selected GPU(s) not detected: {', '.join(str(index) for index in missing_indices)}"] if missing_indices else [],
    }


def validate_gpu_plan(cuda_devices: list[int], main_gpu: int | None, tensor_split: str) -> list[str]:
    warnings: list[str] = []
    if main_gpu is not None and main_gpu not in cuda_devices:
        warnings.append("main GPU is not included in CUDA_VISIBLE_DEVICES")
    split_parts = [part.strip() for part in tensor_split.split(",") if part.strip()]
    if tensor_split and len(split_parts) != len(cuda_devices):
        warnings.append("tensor split length does not match selected CUDA devices")
    for part in split_parts:
        try:
            if float(part) <= 0:
                warnings.append("tensor split values must be greater than zero")
                break
        except ValueError:
            warnings.append("tensor split values must be numeric")
            break
    return warnings


def _parse_gpu_line(line: str) -> DetectedGpu:
    parts = [part.strip() for part in line.split(",")]
    if len(parts) != 5:
        raise ValueError(f"unexpected nvidia-smi GPU row: {line}")
    index = _parse_int(parts[0], "GPU index")
    total = _parse_int(parts[2], "GPU total memory")
    used = _parse_int(parts[3], "GPU used memory")
    free = _parse_int(parts[4], "GPU free memory")
    return DetectedGpu(
        index=index,
        name=parts[1],
        vram_gb=round(total / 1024),
        memory_total_mb=total,
        memory_used_mb=used,
        memory_free_mb=free,
    )


def _parse_process_line(line: str) -> GpuProcess:
    parts = [part.strip() for part in line.split(",")]
    if len(parts) != 4:
        raise ValueError(f"unexpected nvidia-smi process row: {line}")
    return GpuProcess(
        gpu_uuid=parts[0],
        pid=_parse_int(parts[1], "process id"),
        process_name=parts[2],
        used_memory_mb=_parse_int(parts[3], "process used memory"),
    )


def _parse_int(value: str, label: str) -> int:
    try:
        return int(value)
    except ValueError as exc:
        raise ValueError(f"invalid {label}: {value}") from exc


def _unavailable_reason(exc: BaseException) -> str:
    if isinstance(exc, FileNotFoundError):
        return "nvidia-smi is not installed or not available in this container"
    if isinstance(exc, subprocess.TimeoutExpired):
        return "nvidia-smi timed out"
    if isinstance(exc, subprocess.CalledProcessError):
        detail = (exc.stderr or exc.stdout or "").strip()
        return detail or f"nvidia-smi exited with code {exc.returncode}"
    return str(exc)


def _gcd_many(values: list[int]) -> int:
    def gcd(left: int, right: int) -> int:
        while right:
            left, right = right, left % right
        return abs(left)

    current = values[0]
    for value in values[1:]:
        current = gcd(current, value)
    return max(1, current)

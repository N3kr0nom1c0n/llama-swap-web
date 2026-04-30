from __future__ import annotations

import subprocess

from app.gpu_service import detect_gpus, gpu_status, recommend_tensor_split, validate_gpu_plan


def test_detect_gpus_parses_nvidia_smi_csv() -> None:
    def runner(_args: list[str]) -> str:
        return "0, NVIDIA GeForce RTX 3090, 24576, 2048, 22528\n1, NVIDIA GeForce RTX 4080, 16384, 1000, 15384\n"

    result = detect_gpus(runner)

    assert result["available"] is True
    assert result["gpus"] == [
        {
            "index": 0,
            "name": "NVIDIA GeForce RTX 3090",
            "vram_gb": 24,
            "memory_total_mb": 24576,
            "memory_used_mb": 2048,
            "memory_free_mb": 22528,
        },
        {
            "index": 1,
            "name": "NVIDIA GeForce RTX 4080",
            "vram_gb": 16,
            "memory_total_mb": 16384,
            "memory_used_mb": 1000,
            "memory_free_mb": 15384,
        },
    ]


def test_detect_gpus_reports_unavailable_without_fake_defaults() -> None:
    def runner(_args: list[str]) -> str:
        raise FileNotFoundError("nvidia-smi")

    result = detect_gpus(runner)

    assert result["available"] is False
    assert result["gpus"] == []
    assert "nvidia-smi" in result["reason"]


def test_gpu_status_includes_processes_when_available() -> None:
    calls: list[list[str]] = []

    def runner(args: list[str]) -> str:
        calls.append(args)
        if "query-gpu" in args[0]:
            return "0, NVIDIA GeForce RTX 3090, 24576, 2048, 22528\n"
        return "GPU-123, 4242, llama-server, 8192\n"

    result = gpu_status(runner)

    assert result["available"] is True
    assert result["processes"] == [
        {"gpu_uuid": "GPU-123", "pid": 4242, "process_name": "llama-server", "used_memory_mb": 8192}
    ]
    assert len(calls) == 2


def test_gpu_status_keeps_detection_when_process_query_fails() -> None:
    def runner(args: list[str]) -> str:
        if "query-gpu" in args[0]:
            return "0, NVIDIA GeForce RTX 3090, 24576, 2048, 22528\n"
        raise subprocess.CalledProcessError(1, "nvidia-smi")

    result = gpu_status(runner)

    assert result["available"] is True
    assert result["processes"] == []


def test_recommend_tensor_split_uses_free_memory_ratio() -> None:
    result = recommend_tensor_split(
        [
            {"index": 0, "memory_total_mb": 24576, "memory_free_mb": 24576},
            {"index": 1, "memory_total_mb": 16384, "memory_free_mb": 16384},
        ],
        [0, 1],
    )

    assert result["cuda_devices"] == [0, 1]
    assert result["main_gpu"] == 0
    assert result["tensor_split"] == "3,2"
    assert result["warnings"] == []


def test_validate_gpu_plan_warns_for_main_gpu_and_tensor_split_mismatch() -> None:
    warnings = validate_gpu_plan([0, 1], main_gpu=2, tensor_split="1,1,1")

    assert "main GPU is not included in CUDA_VISIBLE_DEVICES" in warnings
    assert "tensor split length does not match selected CUDA devices" in warnings

from __future__ import annotations

from pathlib import Path

import pytest

from app.config_service import (
    backup_and_apply_config,
    manager_to_llama_path,
    preview_config,
    safe_join,
)
from app.schemas import ManagedModel
from app.settings import ManagerSettings


def test_manager_to_llama_path_rewrites_model_root() -> None:
    settings = ManagerSettings(manager_model_root="/host/models", llama_swap_model_root="/models")

    mapped = manager_to_llama_path("/host/models/chat/tiny.gguf", settings)

    assert mapped == "/models/chat/tiny.gguf"


def test_safe_join_rejects_path_traversal(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        safe_join(tmp_path, "../outside.gguf")


def test_preview_generates_matrix_and_no_groups(tmp_path: Path) -> None:
    settings = ManagerSettings(
        manager_model_root=str(tmp_path / "models"),
        llama_swap_model_root="/models",
        backups_dir=str(tmp_path / "backups"),
        llama_swap_config_path=str(tmp_path / "config.yaml"),
    )
    (tmp_path / "models").mkdir()
    models = [
        ManagedModel(
            id="embed",
            display_name="Embedding",
            role="aux",
            primary_model_file="/models/aux/embed.gguf",
            gpu_devices=[1],
            matrix_key="e",
            matrix_behavior="support",
            startup_preload=True,
            evict_cost=100,
        ),
        ManagedModel(
            id="chat",
            display_name="Chat",
            role="chat",
            primary_model_file="/models/chat/chat.gguf",
            gpu_devices=[0],
            main_gpu=0,
            matrix_key="c",
            matrix_behavior="with_support",
        ),
    ]

    result = preview_config("healthCheckTimeout: 180\nmodels: {}\n", models, settings)

    assert result.valid
    assert "groups:" not in result.yaml
    assert "matrix:" in result.yaml
    assert "support: e" in result.yaml
    assert "c_set: c & +support" in result.yaml
    assert 'CUDA_VISIBLE_DEVICES=0' in result.yaml
    assert "${PORT}" in result.yaml


def test_preview_rejects_legacy_groups() -> None:
    settings = ManagerSettings(manager_model_root="/models", llama_swap_model_root="/models")
    model = ManagedModel(id="chat", display_name="Chat", primary_model_file="/models/chat/chat.gguf")

    result = preview_config("models: {}\ngroups: {}\n", [model], settings)

    assert not result.valid
    assert any("groups" in error for error in result.errors)


def test_preview_preserves_existing_matrix_entries(tmp_path: Path) -> None:
    settings = ManagerSettings(
        manager_model_root=str(tmp_path / "models"),
        llama_swap_model_root="/models",
        backups_dir=str(tmp_path / "backups"),
        llama_swap_config_path=str(tmp_path / "config.yaml"),
    )
    (tmp_path / "models").mkdir()
    model = ManagedModel(
        id="chat",
        display_name="Chat",
        primary_model_file="/models/chat/chat.gguf",
        matrix_key="c",
        matrix_behavior="runs_alone",
    )
    current = """
models:
  existing:
    cmd: |
      /app/llama-server --port ${PORT} -m /models/existing.gguf
matrix:
  vars:
    old: existing
  sets:
    old_set: old
"""

    result = preview_config(current, [model], settings)

    assert result.valid
    assert "old: existing" in result.yaml
    assert "old_set: old" in result.yaml
    assert "c: chat" in result.yaml
    assert "c_set: c" in result.yaml


def test_preview_updates_existing_managed_matrix_entry_idempotently(tmp_path: Path) -> None:
    settings = ManagerSettings(
        manager_model_root=str(tmp_path / "models"),
        llama_swap_model_root="/models",
        backups_dir=str(tmp_path / "backups"),
        llama_swap_config_path=str(tmp_path / "config.yaml"),
    )
    (tmp_path / "models").mkdir()
    model = ManagedModel(
        id="chat",
        display_name="Chat",
        primary_model_file="/models/chat/chat.gguf",
        matrix_key="c",
        matrix_behavior="runs_alone",
    )
    current = """
models:
  chat:
    cmd: |
      /app/llama-server --port ${PORT} -m /models/chat/old.gguf
matrix:
  vars:
    c: chat
  sets:
    c_set: c
"""

    result = preview_config(current, [model], settings)

    assert result.valid
    assert result.yaml.count("c: chat") == 1
    assert result.yaml.count("c_set: c") == 1


def test_preview_rejects_host_paths_in_command() -> None:
    settings = ManagerSettings(manager_model_root="/host/models", llama_swap_model_root="/models")
    model = ManagedModel(
        id="chat",
        display_name="Chat",
        primary_model_file="/host/models/chat/chat.gguf",
    )

    result = preview_config("models: {}\n", [model], settings)

    assert not result.valid
    assert any("file path must use /models" in error for error in result.errors)


def test_command_builder_accepts_ui_underscore_flag_names(tmp_path: Path) -> None:
    settings = ManagerSettings(
        manager_model_root=str(tmp_path / "models"),
        llama_swap_model_root="/models",
        backups_dir=str(tmp_path / "backups"),
        llama_swap_config_path=str(tmp_path / "config.yaml"),
    )
    (tmp_path / "models").mkdir()
    model = ManagedModel(
        id="chat",
        display_name="Chat",
        primary_model_file="/models/chat/chat.gguf",
        llama_flags={"ctx_size": 4096, "cache_type_k": "q8_0", "flash_attn": "on"},
    )

    result = preview_config("models: {}\n", [model], settings)

    assert result.valid
    assert "--ctx-size 4096" in result.yaml
    assert "--cache-type-k q8_0" in result.yaml
    assert "--flash-attn on" in result.yaml


def test_backup_and_apply_writes_backup_first(tmp_path: Path) -> None:
    config = tmp_path / "config.yaml"
    backups = tmp_path / "backups"
    config.write_text("models: {}\n", encoding="utf-8")

    backup = backup_and_apply_config(str(config), str(backups), "models:\n  chat: {}\n")

    assert backup.exists()
    assert backup.read_text(encoding="utf-8") == "models: {}\n"
    assert "chat" in config.read_text(encoding="utf-8")

import errno
import os
import shlex
import time
from pathlib import Path

import pytest

from app.config_service import (
    backup_and_apply_config,
    build_llama_command,
    detect_destructive_changes,
    list_config_backups,
    manager_to_llama_path,
    preview_config,
    restore_config_backup,
    safe_join,
)
from app.schemas import ManagedModel
from app.settings import ManagerSettings


def make_settings(tmp_path: Path, **overrides: object) -> ManagerSettings:
    data = {
        "manager_model_root": str(tmp_path / "models"),
        "llama_swap_model_root": "/models",
        "backups_dir": str(tmp_path / "backups"),
        "llama_swap_config_path": str(tmp_path / "config.yaml"),
        "download_temp_dir": str(tmp_path / "tmp"),
    }
    data.update(overrides)
    return ManagerSettings(**data)


def test_manager_to_llama_path_rewrites_model_root() -> None:
    settings = ManagerSettings(manager_model_root="/host/models", llama_swap_model_root="/models")

    mapped = manager_to_llama_path("/host/models/chat/tiny.gguf", settings)

    assert mapped == "/models/chat/tiny.gguf"


def test_safe_join_rejects_path_traversal(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        safe_join(tmp_path, "../outside.gguf")


def test_preview_generates_matrix_and_no_groups(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
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


def test_preview_does_not_create_missing_validation_directories(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    model = ManagedModel(id="chat", display_name="Chat", primary_model_file="/models/chat/chat.gguf")

    result = preview_config("models: {}\n", [model], settings)

    assert result.valid
    assert not (tmp_path / "models").exists()
    assert not (tmp_path / "backups").exists()
    assert not (tmp_path / "tmp").exists()


def test_preview_allows_writable_bind_mounted_config_file_with_unwritable_parent(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    settings = make_settings(tmp_path)
    config = Path(settings.llama_swap_config_path)
    config.write_text("models: {}\n", encoding="utf-8")
    model = ManagedModel(id="chat", display_name="Chat", primary_model_file="/models/chat/chat.gguf")
    original_access = os.access

    def fake_access(path: str | os.PathLike[str], mode: int) -> bool:
        target = Path(path)
        if target == config.parent and mode == os.W_OK:
            return False
        if target == config and mode == os.W_OK:
            return True
        return original_access(path, mode)

    monkeypatch.setattr("app.config_service.os.access", fake_access)

    result = preview_config("models: {}\n", [model], settings)

    assert result.valid
    assert "config parent directory is not writable" not in result.errors


def test_preview_rejects_legacy_groups() -> None:
    settings = ManagerSettings(manager_model_root="/models", llama_swap_model_root="/models")
    model = ManagedModel(id="chat", display_name="Chat", primary_model_file="/models/chat/chat.gguf")

    result = preview_config("models: {}\ngroups: {}\n", [model], settings)

    assert not result.valid
    assert any("groups" in error for error in result.errors)


def test_preview_preserves_existing_matrix_entries(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
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
    settings = make_settings(tmp_path)
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
  external:
    cmd: |
      /app/llama-server --port ${PORT} -m /models/chat/external.gguf
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


def test_preview_removes_stale_matrix_sets_when_managed_key_changes(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    (tmp_path / "models").mkdir()
    model = ManagedModel(
        id="chat",
        display_name="Chat",
        primary_model_file="/models/chat/chat.gguf",
        matrix_key="new",
        matrix_behavior="runs_alone",
    )
    current = """
models:
  chat:
    cmd: |
      /app/llama-server --port ${PORT} -m /models/chat/old.gguf
  external:
    cmd: |
      /app/llama-server --port ${PORT} -m /models/chat/external.gguf
matrix:
  vars:
    old: chat
    ext: external
  sets:
    old_set: old
    combo: old & +ext
    ext_set: ext
"""

    result = preview_config(current, [model], settings)

    assert result.valid
    assert "old: chat" not in result.yaml
    assert "old_set: old" not in result.yaml
    assert "combo: old & +ext" not in result.yaml
    assert "ext: external" in result.yaml
    assert "ext_set: ext" in result.yaml
    assert "new: chat" in result.yaml
    assert "new_set: new" in result.yaml


def test_preview_preserves_custom_hooks_when_updating_preload(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    model = ManagedModel(
        id="chat",
        display_name="Chat",
        primary_model_file="/models/chat/chat.gguf",
        startup_preload=True,
    )
    current = """
models:
  external-support:
    cmd: /app/llama-server --port ${PORT} -m /models/aux/support.gguf
hooks:
  on_startup:
    shell: echo custom
    preload:
      - chat
      - external-support
  on_model_load:
    shell: echo load
"""

    first = preview_config(current, [model], settings)
    second = preview_config(first.yaml, [model], settings)

    assert first.valid
    assert "shell: echo custom" in first.yaml
    assert "on_model_load:" in first.yaml
    assert "shell: echo load" in first.yaml
    assert first.yaml.count("preload:") == 1
    assert first.yaml.count("- chat") == 1
    assert "- external-support" in first.yaml
    assert second.yaml == first.yaml


def test_scoped_preview_preserves_existing_preload_when_scope_has_no_preload(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    model = ManagedModel(
        id="chat",
        display_name="Chat",
        primary_model_file="/models/chat/chat.gguf",
        startup_preload=False,
    )
    current = """
models:
  existing-support:
    cmd: /app/llama-server --port ${PORT} -m /models/aux/support.gguf
hooks:
  on_startup:
    preload:
      - chat
      - existing-support
    shell: echo custom
"""

    result = preview_config(current, [model], settings)

    assert result.valid
    assert "- existing-support" in result.yaml
    assert "- chat" not in result.yaml
    assert "shell: echo custom" in result.yaml


def test_preview_reports_structured_destructive_changes(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    model = ManagedModel(
        id="chat",
        display_name="Chat",
        primary_model_file="/models/chat/chat.gguf",
        matrix_key="new",
        matrix_behavior="runs_alone",
        startup_preload=False,
    )
    current = """
models:
  chat:
    aliases:
      - old-chat
    cmd: /app/llama-server --port ${PORT} -m /models/chat/old.gguf
  external-support:
    cmd: /app/llama-server --port ${PORT} -m /models/aux/support.gguf
matrix:
  vars:
    old: chat
  sets:
    old_set: old
hooks:
  on_startup:
    preload:
      - chat
      - external-support
"""

    result = preview_config(current, [model], settings)

    changes = [change.model_dump() for change in result.destructive_changes]
    assert result.valid
    assert {
        "kind": "alias_removed",
        "path": "models.chat.aliases[old-chat]",
        "before": "old-chat",
    } in changes
    assert {
        "kind": "matrix_removed",
        "path": "matrix.vars.old",
        "before": "chat",
    } in changes
    assert {
        "kind": "hook_removed",
        "path": "hooks.on_startup.preload[chat]",
        "before": "chat",
    } in changes
    assert any("destructive change" in warning for warning in result.warnings)


def test_detect_destructive_changes_finds_removed_models_matrix_sets_hooks_and_globals() -> None:
    current = """
healthCheckTimeout: 180
logLevel: debug
sendLoadingState: true
includeAliasesInList: false
models:
  removed:
    aliases:
      - gone
    cmd: /app/llama-server --port ${PORT} -m /models/removed.gguf
matrix:
  vars:
    r: removed
  sets:
    removed_set: r
hooks:
  on_startup:
    shell: echo boot
    preload:
      - removed
  on_model_load:
    shell: echo load
"""
    staged = "models: {}\nmatrix:\n  vars: {}\n  sets: {}\nhooks:\n  on_startup: {}\n"

    changes = [change.model_dump() for change in detect_destructive_changes(current, staged)]

    assert {
        "kind": "model_removed",
        "path": "models.removed",
        "before": "removed",
    } in changes
    assert {
        "kind": "matrix_removed",
        "path": "matrix.sets.removed_set",
        "before": "r",
    } in changes
    assert {
        "kind": "hook_removed",
        "path": "hooks.on_model_load",
        "before": "shell: echo load",
    } in changes
    assert {
        "kind": "global_removed",
        "path": "healthCheckTimeout",
        "before": "180",
    } in changes


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


def test_preview_rejects_sibling_container_root_prefix() -> None:
    settings = ManagerSettings(manager_model_root="/models", llama_swap_model_root="/models")
    model = ManagedModel(
        id="chat",
        display_name="Chat",
        primary_model_file="/models_evil/chat.gguf",
    )

    result = preview_config("models: {}\n", [model], settings)

    assert not result.valid
    assert any("file path must use /models" in error for error in result.errors)


def test_preview_rejects_container_path_with_parent_escape() -> None:
    settings = ManagerSettings(manager_model_root="/models", llama_swap_model_root="/models")
    model = ManagedModel(
        id="chat",
        display_name="Chat",
        primary_model_file="/models/../host/chat.gguf",
    )

    result = preview_config("models: {}\n", [model], settings)

    assert not result.valid
    assert any("file path must use /models" in error for error in result.errors)


def test_preview_rejects_raw_override_host_model_path(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    model = ManagedModel(
        id="chat",
        display_name="Chat",
        primary_model_file="/models/chat/chat.gguf",
        raw_cmd_override="/app/llama-server --port ${PORT} -m /Users/n3kr0/models/chat.gguf",
    )

    result = preview_config("models: {}\n", [model], settings)

    assert not result.valid
    assert any("raw command path must use /models" in error for error in result.errors)


def test_preview_rejects_raw_override_equals_style_host_model_path(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    model = ManagedModel(
        id="chat",
        display_name="Chat",
        primary_model_file="/models/chat/chat.gguf",
        raw_cmd_override="/app/llama-server --port ${PORT} --model=/Users/n3kr0/models/chat.gguf",
    )

    result = preview_config("models: {}\n", [model], settings)

    assert not result.valid
    assert any("raw command path must use /models" in error for error in result.errors)


def test_preview_rejects_raw_override_parent_escape_model_path(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    model = ManagedModel(
        id="chat",
        display_name="Chat",
        primary_model_file="/models/chat/chat.gguf",
        raw_cmd_override="/app/llama-server --port ${PORT} --model=/models/../host/chat.gguf",
    )

    result = preview_config("models: {}\n", [model], settings)

    assert not result.valid
    assert any("raw command path must use /models" in error for error in result.errors)


def test_preview_rejects_raw_override_unknown_absolute_flag_path(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    model = ManagedModel(
        id="chat",
        display_name="Chat",
        primary_model_file="/models/chat/chat.gguf",
        raw_cmd_override="/app/llama-server --port ${PORT} --flag=/host/model.gguf",
    )

    result = preview_config("models: {}\n", [model], settings)

    assert not result.valid
    assert any("raw command path must use /models" in error for error in result.errors)


def test_preview_rejects_raw_override_unknown_flag_parent_escape(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    model = ManagedModel(
        id="chat",
        display_name="Chat",
        primary_model_file="/models/chat/chat.gguf",
        raw_cmd_override="/app/llama-server --port ${PORT} --flag=/models/../host/model.gguf",
    )

    result = preview_config("models: {}\n", [model], settings)

    assert not result.valid
    assert any("raw command path must use /models" in error for error in result.errors)


def test_command_builder_accepts_ui_underscore_flag_names(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
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


def test_command_builder_quotes_shell_sensitive_args_and_preserves_port(tmp_path: Path) -> None:
    settings = make_settings(tmp_path, llama_server_cmd="/opt/llama bin/llama-server")
    model = ManagedModel(
        id="chat",
        display_name="Chat",
        primary_model_file="/models/chat/model with spaces.gguf",
        mmproj_file="/models/vision/mmproj's file.gguf",
        chat_template_file="/models/chat/template (copy).jinja",
        llama_flags={"tensor_split": "3, 2", "rope-scaling": "linear&safe"},
    )

    cmd = build_llama_command(model, settings)
    args = shlex.split(cmd.replace("\\\n", " "))

    assert args[:5] == [
        "/opt/llama bin/llama-server",
        "--port",
        "${PORT}",
        "-m",
        "/models/chat/model with spaces.gguf",
    ]
    assert "${PORT}" in cmd
    assert "'${PORT}'" not in cmd
    assert args[args.index("--mmproj") + 1] == "/models/vision/mmproj's file.gguf"
    assert args[args.index("--chat-template-file") + 1] == "/models/chat/template (copy).jinja"
    assert args[args.index("--tensor-split") + 1] == "3, 2"
    assert args[args.index("--rope-scaling") + 1] == "linear&safe"


def test_backup_and_apply_writes_backup_first(tmp_path: Path) -> None:
    config = tmp_path / "config.yaml"
    backups = tmp_path / "backups"
    config.write_text("models: {}\n", encoding="utf-8")

    backup = backup_and_apply_config(str(config), str(backups), "models:\n  chat: {}\n")

    assert backup.exists()
    assert backup.read_text(encoding="utf-8") == "models: {}\n"
    assert "chat" in config.read_text(encoding="utf-8")


def test_backup_and_apply_creates_distinct_backups_in_same_second(tmp_path: Path) -> None:
    config = tmp_path / "config.yaml"
    backups = tmp_path / "backups"
    config.write_text("models: {}\n", encoding="utf-8")

    first = backup_and_apply_config(str(config), str(backups), "models:\n  first: {}\n")
    second = backup_and_apply_config(str(config), str(backups), "models:\n  second: {}\n")

    assert first != second
    assert first.read_text(encoding="utf-8") == "models: {}\n"
    assert second.read_text(encoding="utf-8") == "models:\n  first: {}\n"
    assert config.read_text(encoding="utf-8") == "models:\n  second: {}\n"


def test_backup_and_apply_uses_same_dir_temp_and_atomic_replace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = tmp_path / "config.yaml"
    backups = tmp_path / "backups"
    config.write_text("models: {}\n", encoding="utf-8")
    calls: list[tuple[Path, Path]] = []

    def record_replace(src: str | Path, dst: str | Path) -> None:
        source = Path(src)
        target = Path(dst)
        calls.append((source, target))
        assert source.parent == config.parent
        assert source.name.startswith(f".{config.name}.")
        assert source.read_text(encoding="utf-8") == "models:\n  chat: {}\n"
        original_replace(source, target)

    original_replace = os.replace
    monkeypatch.setattr("app.config_service.os.replace", record_replace)

    backup = backup_and_apply_config(str(config), str(backups), "models:\n  chat: {}\n")

    assert calls == [(calls[0][0], config)]
    assert backup.read_text(encoding="utf-8") == "models: {}\n"
    assert config.read_text(encoding="utf-8") == "models:\n  chat: {}\n"
    assert not calls[0][0].exists()


def test_backup_and_apply_falls_back_for_bind_mounted_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = tmp_path / "config.yaml"
    backups = tmp_path / "backups"
    config.write_text("models: {}\n", encoding="utf-8")
    replace_calls: list[tuple[Path, Path]] = []

    def busy_replace(src: str | Path, dst: str | Path) -> None:
        replace_calls.append((Path(src), Path(dst)))
        raise OSError(errno.EBUSY, "Device or resource busy")

    monkeypatch.setattr("app.config_service.os.replace", busy_replace)

    backup = backup_and_apply_config(str(config), str(backups), "models:\n  chat: {}\n")

    assert backup.read_text(encoding="utf-8") == "models: {}\n"
    assert config.read_text(encoding="utf-8") == "models:\n  chat: {}\n"
    assert replace_calls and replace_calls[0][1] == config
    assert not replace_calls[0][0].exists()


def test_backup_and_apply_overwrites_existing_config_when_parent_is_unwritable(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = tmp_path / "config.yaml"
    backups = tmp_path / "backups"
    config.write_text("models: {}\n", encoding="utf-8")
    original_access = os.access

    def fake_access(path: str | os.PathLike[str], mode: int) -> bool:
        target = Path(path)
        if target == config.parent and mode == os.W_OK:
            return False
        if target == config and mode == os.W_OK:
            return True
        return original_access(path, mode)

    monkeypatch.setattr("app.config_service.os.access", fake_access)

    backup = backup_and_apply_config(str(config), str(backups), "models:\n  chat: {}\n")

    assert backup.read_text(encoding="utf-8") == "models: {}\n"
    assert config.read_text(encoding="utf-8") == "models:\n  chat: {}\n"
    assert not list(backups.glob(".config.yaml.*.tmp"))


def test_backup_and_apply_rejects_missing_config_parent(tmp_path: Path) -> None:
    config = tmp_path / "missing" / "config.yaml"
    backups = tmp_path / "backups"

    with pytest.raises(ValueError, match="config parent directory does not exist"):
        backup_and_apply_config(str(config), str(backups), "models: {}\n")


def test_backup_and_apply_preserves_config_symlink(tmp_path: Path) -> None:
    real_config = tmp_path / "actual" / "config.yaml"
    real_config.parent.mkdir()
    real_config.write_text("models: {}\n", encoding="utf-8")
    link_config = tmp_path / "config.yaml"
    link_config.symlink_to(real_config)
    backups = tmp_path / "backups"

    backup = backup_and_apply_config(str(link_config), str(backups), "models:\n  chat: {}\n")

    assert link_config.is_symlink()
    assert backup.read_text(encoding="utf-8") == "models: {}\n"
    assert real_config.read_text(encoding="utf-8") == "models:\n  chat: {}\n"


def test_backup_and_apply_prunes_backups_by_count_and_age(tmp_path: Path) -> None:
    config = tmp_path / "config.yaml"
    backups = tmp_path / "backups"
    backups.mkdir()
    config.write_text("models: {}\n", encoding="utf-8")
    old = backups / "config-20000101-000000-000000.yaml"
    recent = backups / "config-20990101-000000-000000.yaml"
    unrelated = backups / "notes.txt"
    old.write_text("old", encoding="utf-8")
    recent.write_text("recent", encoding="utf-8")
    unrelated.write_text("notes", encoding="utf-8")
    os.utime(old, (time.time() - 3 * 24 * 60 * 60, time.time() - 3 * 24 * 60 * 60))

    backup_and_apply_config(
        str(config),
        str(backups),
        "models:\n  chat: {}\n",
        retention_count=2,
        retention_days=1,
    )

    config_backups = sorted(path.name for path in backups.glob("config*.yaml"))
    assert len(config_backups) == 2
    assert recent.name in config_backups
    assert not old.exists()
    assert unrelated.exists()


def test_list_config_backups_returns_safe_config_backups_newest_first(tmp_path: Path) -> None:
    backups = tmp_path / "backups"
    backups.mkdir()
    older = backups / "config-20260430-010000-000000.yaml"
    newer = backups / "config-20260430-020000-000000.yaml"
    initial = backups / "config-initial-20260430-000000-000000.yaml"
    unrelated = backups / "notes.yaml"
    directory = backups / "config-dir.yaml"
    older.write_text("older", encoding="utf-8")
    newer.write_text("newer", encoding="utf-8")
    initial.write_text("", encoding="utf-8")
    unrelated.write_text("notes", encoding="utf-8")
    directory.mkdir()
    os.utime(older, (100, 100))
    os.utime(newer, (200, 200))
    os.utime(initial, (50, 50))

    result = list_config_backups(str(backups))

    assert [item.name for item in result] == [newer.name, older.name, initial.name]
    assert result[0].path == str(newer)
    assert result[0].size == len("newer")
    assert result[0].modified.timestamp() == 200


def test_restore_config_backup_backs_up_current_config_and_restores_selected_backup(tmp_path: Path) -> None:
    config = tmp_path / "config.yaml"
    backups = tmp_path / "backups"
    backups.mkdir()
    config.write_text("models:\n  current: {}\n", encoding="utf-8")
    selected = backups / "config-20260430-010000-000000.yaml"
    selected.write_text("models:\n  restored: {}\n", encoding="utf-8")

    current_backup = restore_config_backup(str(config), str(backups), selected.name)

    assert current_backup.exists()
    assert current_backup.name.startswith("config-")
    assert current_backup.name != selected.name
    assert current_backup.read_text(encoding="utf-8") == "models:\n  current: {}\n"
    assert config.read_text(encoding="utf-8") == "models:\n  restored: {}\n"


@pytest.mark.parametrize(
    ("backup_name", "match"),
    [
        ("../config-escape.yaml", "backup name must be a file name"),
        ("/tmp/config.yaml", "backup name must be a file name"),
        ("missing.yaml", "backup does not exist"),
    ],
)
def test_restore_config_backup_rejects_unsafe_or_missing_names(
    tmp_path: Path,
    backup_name: str,
    match: str,
) -> None:
    config = tmp_path / "config.yaml"
    backups = tmp_path / "backups"
    backups.mkdir()
    config.write_text("models: {}\n", encoding="utf-8")

    with pytest.raises(ValueError, match=match):
        restore_config_backup(str(config), str(backups), backup_name)


def test_restore_config_backup_rejects_directory_backup(tmp_path: Path) -> None:
    config = tmp_path / "config.yaml"
    backups = tmp_path / "backups"
    selected = backups / "config-20260430-010000-000000.yaml"
    selected.mkdir(parents=True)
    config.write_text("models: {}\n", encoding="utf-8")

    with pytest.raises(ValueError, match="backup is not a file"):
        restore_config_backup(str(config), str(backups), selected.name)


def test_restore_config_backup_rejects_symlink_escape(tmp_path: Path) -> None:
    config = tmp_path / "config.yaml"
    backups = tmp_path / "backups"
    outside = tmp_path / "outside.yaml"
    backups.mkdir()
    config.write_text("models: {}\n", encoding="utf-8")
    outside.write_text("models:\n  outside: {}\n", encoding="utf-8")
    selected = backups / "config-20260430-010000-000000.yaml"
    selected.symlink_to(outside)

    with pytest.raises(ValueError, match="backup escapes backup directory"):
        restore_config_backup(str(config), str(backups), selected.name)


def test_restore_config_backup_preserves_config_symlink(tmp_path: Path) -> None:
    real_config = tmp_path / "actual" / "config.yaml"
    real_config.parent.mkdir()
    real_config.write_text("models:\n  current: {}\n", encoding="utf-8")
    link_config = tmp_path / "config.yaml"
    link_config.symlink_to(real_config)
    backups = tmp_path / "backups"
    backups.mkdir()
    selected = backups / "config-20260430-010000-000000.yaml"
    selected.write_text("models:\n  restored: {}\n", encoding="utf-8")

    backup = restore_config_backup(str(link_config), str(backups), selected.name)

    assert link_config.is_symlink()
    assert backup.read_text(encoding="utf-8") == "models:\n  current: {}\n"
    assert real_config.read_text(encoding="utf-8") == "models:\n  restored: {}\n"

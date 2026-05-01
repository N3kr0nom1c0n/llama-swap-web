from __future__ import annotations

import difflib
import errno
import os
import re
import shlex
import shutil
import tempfile
from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta
from io import StringIO
from pathlib import Path, PurePosixPath
from typing import Any

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap
from ruamel.yaml.scalarstring import LiteralScalarString

from .schemas import ConfigBackupMetadata, ConfigPreviewResponse, DestructiveChange, ManagedModel
from .settings import ManagerSettings


SAFE_MATRIX_KEY = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,7}$")
MATRIX_REF_TOKEN = re.compile(r"\+?([A-Za-z][A-Za-z0-9_]{0,7})")
RAW_COMMAND_PATH_FLAGS = {"-m", "--model", "--mmproj", "--chat-template-file"}
RAW_COMMAND_NON_PATH_FLAGS = {"--port"}
DESTRUCTIVE_GLOBAL_KEYS = ("healthCheckTimeout", "logLevel", "sendLoadingState", "includeAliasesInList")
CONFIG_BACKUP_NAME = re.compile(r"^config(?:-initial)?-\d{8}-\d{6}-\d{6}(?:-\d+)?\.yaml$")


def safe_join(root: str | Path, *parts: str) -> Path:
    root_path = Path(root).resolve()
    candidate = root_path.joinpath(*parts).resolve()
    if candidate != root_path and root_path not in candidate.parents:
        raise ValueError(f"path escapes allowed root: {candidate}")
    return candidate


def manager_to_llama_path(manager_path: str, settings: ManagerSettings) -> str:
    manager_root = Path(settings.manager_model_root).resolve()
    candidate = Path(manager_path).resolve()
    if candidate != manager_root and manager_root not in candidate.parents:
        raise ValueError(f"model path is outside manager root: {manager_path}")
    relative = candidate.relative_to(manager_root)
    return str(Path(settings.llama_swap_model_root) / relative).replace("\\", "/")


def default_matrix_key(model_id: str, used: set[str]) -> str:
    base = re.sub(r"[^A-Za-z0-9]", "", model_id)
    if not base:
        base = "m"
    key = base[:8]
    if not key[0].isalpha():
        key = f"m{key}"[:8]
    candidate = key
    counter = 1
    while candidate in used:
        suffix = str(counter)
        candidate = f"{key[: 8 - len(suffix)]}{suffix}"
        counter += 1
    used.add(candidate)
    return candidate


def _flag_name(name: str) -> str:
    normalized = name.replace("_", "-")
    return normalized if normalized.startswith("--") or normalized.startswith("-") else f"--{normalized}"


def _canonical_flag_key(name: str) -> str:
    return name.lstrip("-").replace("_", "-")


def _has_flag(flags: dict[str, Any], canonical_name: str) -> bool:
    return any(_canonical_flag_key(name) == canonical_name for name in flags)


def _quote_command_arg(value: Any) -> str:
    text = str(value)
    if text == "${PORT}":
        return text
    return shlex.quote(text)


def _is_container_path(path: str, root: str) -> bool:
    try:
        path_obj = _normalize_posix_path(path)
        root_obj = _normalize_posix_path(root)
    except TypeError:
        return False
    if not path_obj.is_absolute() or not root_obj.is_absolute():
        return False
    return path_obj == root_obj or root_obj in path_obj.parents


def _normalize_posix_path(path: str) -> PurePosixPath:
    path_obj = PurePosixPath(path)
    parts: list[str] = []
    for part in path_obj.parts:
        if part in {"", "."} or part == "/":
            continue
        if part == "..":
            if parts:
                parts.pop()
            else:
                parts.append(part)
            continue
        parts.append(part)
    return PurePosixPath("/", *parts) if path_obj.is_absolute() else PurePosixPath(*parts)


def _format_flag(name: str, value: Any) -> str | None:
    flag = _flag_name(name)
    if value is None or value is False or value == "":
        return None
    if value is True:
        return flag
    return f"{flag} {_quote_command_arg(value)}"


def build_llama_command(model: ManagedModel, settings: ManagerSettings) -> str:
    if model.raw_cmd_override.strip():
        return model.raw_cmd_override.strip()
    model_file = model.primary_model_file or (model.container_files[0] if model.container_files else "")
    if not model_file:
        raise ValueError(f"{model.id} has no primary model file")
    segments: list[str] = [
        _quote_command_arg(settings.llama_server_cmd),
        "--port ${PORT}",
        f"-m {_quote_command_arg(model_file)}",
    ]
    if model.mmproj_file:
        segments.append(f"--mmproj {_quote_command_arg(model.mmproj_file)}")
    if model.chat_template_file:
        segments.append(f"--chat-template-file {_quote_command_arg(model.chat_template_file)}")
    flags = dict(model.llama_flags)
    if not _has_flag(flags, "ctx-size"):
        flags["ctx-size"] = settings.defaults.ctx_size
    if not _has_flag(flags, "cache-type-k"):
        flags["cache-type-k"] = settings.defaults.cache_type_k
    if not _has_flag(flags, "cache-type-v"):
        flags["cache-type-v"] = settings.defaults.cache_type_v
    if settings.defaults.no_mmap and not _has_flag(flags, "no-mmap"):
        flags["no-mmap"] = True
    if settings.defaults.jinja and not _has_flag(flags, "jinja"):
        flags["jinja"] = True
    if settings.defaults.flash_attn and not _has_flag(flags, "flash-attn"):
        flags["flash-attn"] = settings.defaults.flash_attn
    if model.main_gpu is not None and not _has_flag(flags, "main-gpu"):
        flags["main-gpu"] = model.main_gpu
    if model.tensor_split and not _has_flag(flags, "tensor-split"):
        flags["tensor-split"] = model.tensor_split
    for name, value in flags.items():
        formatted = _format_flag(name, value)
        if formatted:
            segments.append(formatted)
    lines: list[str] = []
    for idx, segment in enumerate(segments):
        suffix = " \\" if idx < len(segments) - 1 else ""
        prefix = "" if idx == 0 else "  "
        lines.append(f"{prefix}{segment}{suffix}")
    return "\n".join(lines)


def model_to_config_entry(model: ManagedModel, settings: ManagerSettings) -> CommentedMap:
    entry = CommentedMap()
    entry["cmd"] = LiteralScalarString(build_llama_command(model, settings))
    entry["ttl"] = model.ttl
    if model.aliases:
        entry["aliases"] = model.aliases
    if model.gpu_devices:
        visible = ",".join(str(device) for device in model.gpu_devices)
        entry["env"] = [f"CUDA_VISIBLE_DEVICES={visible}"]
    return entry


def build_matrix(models: list[ManagedModel], existing: CommentedMap | None = None) -> CommentedMap | None:
    matrix_models = [model for model in models if model.matrix_behavior]
    existing = existing if isinstance(existing, CommentedMap) else CommentedMap()
    vars_map = CommentedMap(existing.get("vars") or {})
    managed_ids = {model.id for model in matrix_models}
    removed_keys: set[str] = set()
    for existing_key, existing_model_id in list(vars_map.items()):
        if existing_model_id in managed_ids:
            removed_keys.add(str(existing_key))
            del vars_map[existing_key]
    used: set[str] = set(vars_map.keys())
    support_keys: list[str] = []
    evict_costs = CommentedMap(existing.get("evict_costs") or {})
    sets = CommentedMap(existing.get("sets") or {})
    for set_key, expression in list(sets.items()):
        if _matrix_expression_refs_removed_key(expression, removed_keys):
            del sets[set_key]
    model_keys: dict[str, str] = {}
    for model in matrix_models:
        key = model.matrix_key or default_matrix_key(model.id, used)
        if key in used and model.matrix_key:
            raise ValueError(f"duplicate matrix key: {key}")
        if model.matrix_key:
            if not SAFE_MATRIX_KEY.match(key):
                raise ValueError(f"invalid matrix key '{key}' for {model.id}")
            used.add(key)
        vars_map[key] = model.id
        model_keys[model.id] = key
        if model.evict_cost is not None:
            evict_costs[key] = model.evict_cost
        if model.matrix_behavior == "support" or model.startup_preload:
            support_keys.append(key)
    if support_keys:
        existing_support = [term.strip() for term in str(sets.get("support", "")).split("&") if term.strip()]
        support_keys = [*existing_support, *[key for key in support_keys if key not in existing_support]]
        sets["support"] = " & ".join(support_keys)
    for model in matrix_models:
        key = model_keys[model.id]
        if model.matrix_behavior == "support":
            continue
        set_name = f"{key}_set"
        if model.matrix_behavior == "custom" and model.matrix_expression:
            sets[set_name] = model.matrix_expression
        elif model.matrix_behavior == "runs_alone" or not support_keys:
            sets[set_name] = key
        else:
            sets[set_name] = f"{key} & +support"
    matrix = CommentedMap()
    matrix["vars"] = vars_map
    if evict_costs:
        matrix["evict_costs"] = evict_costs
    matrix["sets"] = sets
    return matrix if matrix["vars"] or matrix["sets"] else None


def build_hooks(models: list[ManagedModel], existing: CommentedMap | None = None) -> CommentedMap | None:
    hooks = CommentedMap(existing or {})
    existing_on_startup = hooks.get("on_startup")
    if isinstance(existing_on_startup, CommentedMap):
        on_startup = CommentedMap(existing_on_startup)
    elif isinstance(existing_on_startup, dict):
        on_startup = CommentedMap(existing_on_startup)
    else:
        on_startup = CommentedMap()
    current_model_ids = {model.id for model in models}
    existing_preload = list(on_startup.get("preload") or [])
    preserved_preload = [model_id for model_id in existing_preload if model_id not in current_model_ids]
    preload = [model.id for model in models if model.startup_preload]
    if preload:
        on_startup["preload"] = [*preserved_preload, *[model_id for model_id in preload if model_id not in preserved_preload]]
        hooks["on_startup"] = on_startup
    elif preserved_preload:
        on_startup["preload"] = preserved_preload
        hooks["on_startup"] = on_startup
    elif "preload" in on_startup:
        del on_startup["preload"]
        hooks["on_startup"] = on_startup
    return hooks if hooks else None


def _raw_command_path_errors(model: ManagedModel, settings: ManagerSettings, cmd: str) -> list[str]:
    if not model.raw_cmd_override.strip():
        return []
    try:
        args = shlex.split(cmd.replace("\\\n", " "))
    except ValueError as exc:
        return [f"{model.id} raw command cannot be parsed: {exc}"]
    errors: list[str] = []
    for index, arg in enumerate(args):
        if index == 0:
            continue
        flag, separator, value = arg.partition("=")
        if separator and value.startswith("/") and not _is_container_path(value, settings.llama_swap_model_root):
            errors.append(f"{model.id} raw command path must use {settings.llama_swap_model_root}: {value}")
    for index, arg in enumerate(args[:-1]):
        next_arg = args[index + 1]
        if arg.startswith("-") and arg not in RAW_COMMAND_NON_PATH_FLAGS and next_arg.startswith("/") and not _is_container_path(
            next_arg, settings.llama_swap_model_root
        ):
            errors.append(f"{model.id} raw command path must use {settings.llama_swap_model_root}: {next_arg}")
    return errors


def _load_config_mapping(yaml_text: str) -> Mapping[Any, Any]:
    if not yaml_text.strip():
        return {}
    document = YAML().load(yaml_text) or {}
    return document if isinstance(document, Mapping) else {}


def _as_mapping(value: Any) -> Mapping[Any, Any]:
    return value if isinstance(value, Mapping) else {}


def _as_string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray)):
        return [str(item) for item in value]
    return [str(value)]


def _stringify_removed_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (str, int, float)):
        return str(value)
    output = StringIO()
    yaml = YAML()
    yaml.dump(value, output)
    return output.getvalue().strip()


def _add_removed_alias_changes(
    changes: list[DestructiveChange],
    current_models: Mapping[Any, Any],
    staged_models: Mapping[Any, Any],
) -> None:
    for model_id, current_model in current_models.items():
        if model_id not in staged_models:
            continue
        current_aliases = _as_string_list(_as_mapping(current_model).get("aliases"))
        staged_aliases = set(_as_string_list(_as_mapping(staged_models[model_id]).get("aliases")))
        for alias in current_aliases:
            if alias not in staged_aliases:
                changes.append(
                    DestructiveChange(
                        kind="alias_removed",
                        path=f"models.{model_id}.aliases[{alias}]",
                        before=alias,
                    )
                )


def _add_removed_matrix_changes(
    changes: list[DestructiveChange],
    current_matrix: Mapping[Any, Any],
    staged_matrix: Mapping[Any, Any],
) -> None:
    for section in ("vars", "sets"):
        current_items = _as_mapping(current_matrix.get(section))
        staged_items = _as_mapping(staged_matrix.get(section))
        for key, value in current_items.items():
            if key not in staged_items:
                changes.append(
                    DestructiveChange(
                        kind="matrix_removed",
                        path=f"matrix.{section}.{key}",
                        before=_stringify_removed_value(value),
                    )
                )


def _add_removed_preload_changes(
    changes: list[DestructiveChange],
    current_value: Any,
    staged_value: Any,
    path: str,
) -> None:
    staged_entries = set(_as_string_list(staged_value))
    for model_id in _as_string_list(current_value):
        if model_id not in staged_entries:
            changes.append(DestructiveChange(kind="hook_removed", path=f"{path}[{model_id}]", before=model_id))


def _add_removed_hook_changes(
    changes: list[DestructiveChange],
    current_hooks: Mapping[Any, Any],
    staged_hooks: Mapping[Any, Any],
    path: str = "hooks",
) -> None:
    for key, value in current_hooks.items():
        child_path = f"{path}.{key}"
        if key not in staged_hooks:
            if child_path == "hooks.on_startup.preload":
                _add_removed_preload_changes(changes, value, [], child_path)
            else:
                changes.append(
                    DestructiveChange(
                        kind="hook_removed",
                        path=child_path,
                        before=_stringify_removed_value(value),
                    )
                )
            continue
        staged_value = staged_hooks[key]
        if child_path == "hooks.on_startup.preload":
            _add_removed_preload_changes(changes, value, staged_value, child_path)
        elif isinstance(value, Mapping):
            _add_removed_hook_changes(changes, value, _as_mapping(staged_value), child_path)


def detect_destructive_changes(current_yaml: str, staged_yaml: str) -> list[DestructiveChange]:
    current = _load_config_mapping(current_yaml)
    staged = _load_config_mapping(staged_yaml)
    changes: list[DestructiveChange] = []

    current_models = _as_mapping(current.get("models"))
    staged_models = _as_mapping(staged.get("models"))
    for model_id in current_models:
        if model_id not in staged_models:
            changes.append(
                DestructiveChange(kind="model_removed", path=f"models.{model_id}", before=str(model_id))
            )
    _add_removed_alias_changes(changes, current_models, staged_models)

    _add_removed_matrix_changes(changes, _as_mapping(current.get("matrix")), _as_mapping(staged.get("matrix")))
    _add_removed_hook_changes(changes, _as_mapping(current.get("hooks")), _as_mapping(staged.get("hooks")))

    for key in DESTRUCTIVE_GLOBAL_KEYS:
        if key in current and key not in staged:
            changes.append(
                DestructiveChange(kind="global_removed", path=key, before=_stringify_removed_value(current[key]))
            )

    return changes


def _destructive_warning(change: DestructiveChange) -> str:
    return f"destructive change: {change.kind} at {change.path} removes {change.before}"


def validate_config_document(document: dict, models: list[ManagedModel], settings: ManagerSettings, validate_local_paths: bool = True) -> list[str]:
    errors: list[str] = []
    if "groups" in document:
        errors.append("legacy groups cannot be used when matrix is enabled")
    if "models" not in document:
        errors.append("top-level models section is required")
    seen_aliases: set[str] = set()
    existing_model_ids = set((document.get("models") or {}).keys())
    model_ids = {model.id for model in models} | existing_model_ids
    matrix_refs: set[str] = set()
    matrix = document.get("matrix") or {}
    for model in models:
        try:
            cmd = build_llama_command(model, settings)
        except ValueError as exc:
            errors.append(str(exc))
            continue
        if "${PORT}" not in cmd:
            errors.append(f"{model.id} command must include ${{PORT}}")
        if settings.manager_model_root != settings.llama_swap_model_root and settings.manager_model_root in cmd:
            errors.append(f"{model.id} command contains manager/host model root")
        errors.extend(_raw_command_path_errors(model, settings, cmd))
        for path in [model.primary_model_file, model.mmproj_file, model.chat_template_file, *model.container_files]:
            if path and not _is_container_path(path, settings.llama_swap_model_root):
                errors.append(f"{model.id} file path must use {settings.llama_swap_model_root}: {path}")
        for alias in model.aliases:
            if alias in seen_aliases or alias in model_ids:
                errors.append(f"alias is not globally unique: {alias}")
            seen_aliases.add(alias)
    for real_id in (matrix.get("vars") or {}).values():
        matrix_refs.add(real_id)
    for real_id in matrix_refs:
        if real_id not in model_ids:
            errors.append(f"matrix references unknown model: {real_id}")
    matrix_vars = set((matrix.get("vars") or {}).keys())
    matrix_sets = set((matrix.get("sets") or {}).keys())
    allowed_matrix_refs = {str(item) for item in matrix_vars | matrix_sets}
    for set_name, expression in (matrix.get("sets") or {}).items():
        for ref in _matrix_expression_refs(expression):
            if ref not in allowed_matrix_refs:
                errors.append(f"matrix set {set_name} references unknown key: {ref}")
    for model_id in ((document.get("hooks") or {}).get("on_startup") or {}).get("preload", []):
        if model_id not in model_ids:
            errors.append(f"startup preload references unknown model: {model_id}")
    if validate_local_paths:
        errors.extend(validate_local_runtime_paths(settings))
    return errors


def validate_local_runtime_paths(settings: ManagerSettings) -> list[str]:
    errors: list[str] = []
    for label, path in [
        ("manager model root", settings.manager_model_root),
        ("backup directory", settings.backups_dir),
        ("download temp directory", settings.download_temp_dir),
    ]:
        path_obj = Path(path)
        if not path_obj.exists():
            continue
        if not path_obj.is_dir():
            errors.append(f"{label} is not a directory: {path}")
            continue
        if not os.access(path_obj, os.W_OK):
            errors.append(f"{label} is not writable: {path}")
        try:
            free_gb = shutil.disk_usage(path_obj).free / (1024**3)
        except OSError as exc:
            errors.append(f"{label} disk usage cannot be checked: {exc}")
            continue
        if free_gb < settings.disk_safety_gb:
            errors.append(f"{label} free space {free_gb:.1f}GB is below safety floor {settings.disk_safety_gb}GB")
    config_file = Path(settings.llama_swap_config_path)
    config_parent = config_file.parent
    if config_file.exists():
        if not os.access(config_file, os.W_OK):
            errors.append(f"config file is not writable: {config_file}")
    else:
        if not config_parent.exists():
            errors.append(f"config parent directory does not exist: {config_parent}")
        elif not os.access(config_parent, os.W_OK):
            errors.append(f"config parent directory is not writable: {config_parent}")
    return errors


def render_config(current_yaml: str, models: list[ManagedModel], settings: ManagerSettings) -> str:
    yaml = YAML()
    yaml.preserve_quotes = True
    document = yaml.load(current_yaml) if current_yaml.strip() else CommentedMap()
    if document is None:
        document = CommentedMap()
    if not isinstance(document, CommentedMap):
        raise ValueError("config root must be a mapping")
    if "groups" in document:
        raise ValueError("legacy groups cannot be used with matrix")
    model_map = document.setdefault("models", CommentedMap())
    if not isinstance(model_map, CommentedMap):
        raise ValueError("models must be a mapping")
    for model in models:
        model_map[model.id] = model_to_config_entry(model, settings)
    matrix = build_matrix(models, document.get("matrix"))
    if matrix:
        document["matrix"] = matrix
    hooks = build_hooks(models, document.get("hooks"))
    if hooks:
        document["hooks"] = hooks
    elif "hooks" in document:
        del document["hooks"]
    from io import StringIO

    output = StringIO()
    yaml.dump(document, output)
    return output.getvalue()


def preview_config(current_yaml: str, models: list[ManagedModel], settings: ManagerSettings, validate_local_paths: bool = True) -> ConfigPreviewResponse:
    warnings: list[str] = []
    errors: list[str] = []
    destructive_changes: list[DestructiveChange] = []
    try:
        rendered = render_config(current_yaml, models, settings)
        yaml = YAML()
        document = yaml.load(rendered) or {}
        errors.extend(validate_config_document(document, models, settings, validate_local_paths=validate_local_paths))
        destructive_changes = detect_destructive_changes(current_yaml, rendered)
        warnings.extend(_destructive_warning(change) for change in destructive_changes)
    except Exception as exc:
        rendered = current_yaml
        errors.append(str(exc))
    diff = "\n".join(
        difflib.unified_diff(
            current_yaml.splitlines(),
            rendered.splitlines(),
            fromfile="current config.yaml",
            tofile="staged config.yaml",
            lineterm="",
        )
    )
    return ConfigPreviewResponse(
        valid=not errors,
        yaml=rendered,
        diff=diff,
        errors=errors,
        warnings=warnings,
        destructive_changes=destructive_changes,
    )


def _unique_backup_path(backup_root: Path, prefix: str) -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    candidate = backup_root / f"{prefix}-{stamp}.yaml"
    counter = 1
    while candidate.exists():
        candidate = backup_root / f"{prefix}-{stamp}-{counter}.yaml"
        counter += 1
    return candidate


def _is_config_backup_name(name: str) -> bool:
    return bool(CONFIG_BACKUP_NAME.fullmatch(name))


def _safe_backup_file(backups_dir: str | Path, backup_name: str) -> Path:
    name_path = Path(backup_name)
    if name_path.is_absolute() or name_path.name != backup_name:
        raise ValueError("backup name must be a file name")
    backup_root = Path(backups_dir).resolve()
    candidate = backup_root / backup_name
    if not candidate.exists():
        raise ValueError(f"backup does not exist: {backup_name}")
    if not _is_config_backup_name(backup_name):
        raise ValueError(f"backup is not a config backup: {backup_name}")
    resolved = candidate.resolve()
    if resolved != backup_root and backup_root not in resolved.parents:
        raise ValueError("backup escapes backup directory")
    if not candidate.is_file():
        raise ValueError(f"backup is not a file: {backup_name}")
    return candidate


def list_config_backups(backups_dir: str) -> list[ConfigBackupMetadata]:
    backup_root = Path(backups_dir)
    if not backup_root.exists():
        return []
    if not backup_root.is_dir():
        raise ValueError(f"backup directory is not a directory: {backups_dir}")
    root_resolved = backup_root.resolve()
    backups: list[ConfigBackupMetadata] = []
    for candidate in backup_root.glob("config*.yaml"):
        if not _is_config_backup_name(candidate.name):
            continue
        try:
            resolved = candidate.resolve()
        except OSError:
            continue
        if resolved != root_resolved and root_resolved not in resolved.parents:
            continue
        if not candidate.is_file():
            continue
        stat = candidate.stat()
        backups.append(
            ConfigBackupMetadata(
                name=candidate.name,
                path=str(candidate),
                size=stat.st_size,
                modified=datetime.fromtimestamp(stat.st_mtime),
            )
        )
    return sorted(backups, key=lambda backup: backup.modified, reverse=True)


def _overwrite_config_in_place(source: Path, target: Path) -> None:
    with source.open("rb") as input_file, target.open("wb") as output_file:
        shutil.copyfileobj(input_file, output_file)
        output_file.flush()
        os.fsync(output_file.fileno())


def backup_and_apply_config(
    config_path: str,
    backups_dir: str,
    rendered_yaml: str,
    retention_count: int = 0,
    retention_days: int = 0,
) -> Path:
    requested_config = Path(config_path)
    config = requested_config.resolve() if requested_config.is_symlink() else requested_config
    backup_root = Path(backups_dir)
    if not config.parent.exists():
        raise ValueError(f"config parent directory does not exist: {config.parent}")
    backup_root.mkdir(parents=True, exist_ok=True)
    if config.exists():
        backup = _unique_backup_path(backup_root, "config")
        shutil.copy2(config, backup)
    else:
        backup = _unique_backup_path(backup_root, "config-initial")
        backup.write_text("", encoding="utf-8")
    temp_path: Path | None = None
    try:
        temp_dir = backup_root if config.exists() and os.access(config, os.W_OK) and not os.access(config.parent, os.W_OK) else config.parent
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=temp_dir,
            prefix=f".{config.name}.",
            suffix=".tmp",
            delete=False,
        ) as temp_file:
            temp_file.write(rendered_yaml)
            temp_file.flush()
            os.fsync(temp_file.fileno())
            temp_path = Path(temp_file.name)
        if temp_path.parent == config.parent:
            try:
                os.replace(temp_path, config)
            except OSError as exc:
                if exc.errno != errno.EBUSY:
                    raise
                _overwrite_config_in_place(temp_path, config)
        else:
            _overwrite_config_in_place(temp_path, config)
        _prune_config_backups(backup_root, retention_count=retention_count, retention_days=retention_days)
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink()
    return backup


def restore_config_backup(config_path: str, backups_dir: str, backup_name: str) -> Path:
    backup = _safe_backup_file(backups_dir, backup_name)
    rendered_yaml = backup.read_text(encoding="utf-8")
    return backup_and_apply_config(config_path, backups_dir, rendered_yaml)


def _matrix_expression_refs_removed_key(expression: Any, removed_keys: set[str]) -> bool:
    if not removed_keys:
        return False
    return any(ref in removed_keys for ref in _matrix_expression_refs(expression))


def _matrix_expression_refs(expression: Any) -> set[str]:
    return {match.group(1) for match in MATRIX_REF_TOKEN.finditer(str(expression or ""))}


def _prune_config_backups(backup_root: Path, retention_count: int = 0, retention_days: int = 0) -> None:
    backups = sorted(backup_root.glob("config*.yaml"), key=lambda path: path.stat().st_mtime, reverse=True)
    to_remove: set[Path] = set()
    if retention_days > 0:
        cutoff = datetime.now().timestamp() - timedelta(days=retention_days).total_seconds()
        to_remove.update(path for path in backups if path.stat().st_mtime < cutoff)
    if retention_count > 0:
        retained = [path for path in backups if path not in to_remove]
        to_remove.update(retained[retention_count:])
    for path in to_remove:
        try:
            path.unlink()
        except FileNotFoundError:
            pass

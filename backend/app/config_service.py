from __future__ import annotations

import difflib
import os
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap
from ruamel.yaml.scalarstring import LiteralScalarString

from .schemas import ConfigPreviewResponse, ManagedModel
from .settings import ManagerSettings


SAFE_MATRIX_KEY = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,7}$")


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


def _format_flag(name: str, value: Any) -> str | None:
    flag = _flag_name(name)
    if value is None or value is False or value == "":
        return None
    if value is True:
        return flag
    return f"{flag} {value}"


def build_llama_command(model: ManagedModel, settings: ManagerSettings) -> str:
    if model.raw_cmd_override.strip():
        return model.raw_cmd_override.strip()
    model_file = model.primary_model_file or (model.container_files[0] if model.container_files else "")
    if not model_file:
        raise ValueError(f"{model.id} has no primary model file")
    segments: list[str] = [
        settings.llama_server_cmd,
        "--port ${PORT}",
        f"-m {model_file}",
    ]
    if model.mmproj_file:
        segments.append(f"--mmproj {model.mmproj_file}")
    if model.chat_template_file:
        segments.append(f"--chat-template-file {model.chat_template_file}")
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
    for existing_key, existing_model_id in list(vars_map.items()):
        if existing_model_id in managed_ids:
            del vars_map[existing_key]
    used: set[str] = set(vars_map.keys())
    support_keys: list[str] = []
    evict_costs = CommentedMap(existing.get("evict_costs") or {})
    sets = CommentedMap(existing.get("sets") or {})
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


def build_hooks(models: list[ManagedModel]) -> CommentedMap | None:
    preload = [model.id for model in models if model.startup_preload]
    if not preload:
        return None
    hooks = CommentedMap()
    hooks["on_startup"] = CommentedMap({"preload": preload})
    return hooks


def validate_config_document(document: dict, models: list[ManagedModel], settings: ManagerSettings) -> list[str]:
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
        for path in [model.primary_model_file, model.mmproj_file, model.chat_template_file, *model.container_files]:
            if path and not path.startswith(settings.llama_swap_model_root):
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
    for model_id in ((document.get("hooks") or {}).get("on_startup") or {}).get("preload", []):
        if model_id not in model_ids:
            errors.append(f"startup preload references unknown model: {model_id}")
    for label, path in [
        ("manager model root", settings.manager_model_root),
        ("backup directory", settings.backups_dir),
        ("download temp directory", settings.download_temp_dir),
    ]:
        path_obj = Path(path)
        try:
            path_obj.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            errors.append(f"{label} is not writable: {exc}")
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
    config_parent = Path(settings.llama_swap_config_path).parent
    if not config_parent.exists():
        errors.append(f"config parent directory does not exist: {config_parent}")
    elif not os.access(config_parent, os.W_OK):
        errors.append(f"config parent directory is not writable: {config_parent}")
    config_file = Path(settings.llama_swap_config_path)
    if config_file.exists() and not os.access(config_file, os.W_OK):
        errors.append(f"config file is not writable: {config_file}")
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
    hooks = build_hooks(models)
    if hooks:
        document["hooks"] = hooks
    from io import StringIO

    output = StringIO()
    yaml.dump(document, output)
    return output.getvalue()


def preview_config(current_yaml: str, models: list[ManagedModel], settings: ManagerSettings) -> ConfigPreviewResponse:
    warnings: list[str] = []
    errors: list[str] = []
    try:
        rendered = render_config(current_yaml, models, settings)
        yaml = YAML()
        document = yaml.load(rendered) or {}
        errors.extend(validate_config_document(document, models, settings))
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
    return ConfigPreviewResponse(valid=not errors, yaml=rendered, diff=diff, errors=errors, warnings=warnings)


def backup_and_apply_config(config_path: str, backups_dir: str, rendered_yaml: str) -> Path:
    config = Path(config_path)
    backup_root = Path(backups_dir)
    backup_root.mkdir(parents=True, exist_ok=True)
    if config.exists():
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = backup_root / f"config-{stamp}.yaml"
        shutil.copy2(config, backup)
    else:
        backup = backup_root / "config-initial.yaml"
        backup.write_text("", encoding="utf-8")
    config.parent.mkdir(parents=True, exist_ok=True)
    config.write_text(rendered_yaml, encoding="utf-8")
    return backup

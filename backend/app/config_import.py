from __future__ import annotations

import shlex
from pathlib import PurePosixPath
from typing import Any

from ruamel.yaml import YAML

from .config_service import default_matrix_key
from .hf_service import classify_file
from .schemas import ConfigImportCandidate, ManagedModel, ModelRole
from .settings import ManagerSettings


VALUELESS_FLAGS = {"--jinja", "--no-mmap", "--embeddings", "--reranking", "--context-shift", "--cont-batching", "--swa-full"}
IGNORED_FLAGS = {"--port"}
PATH_FLAGS = {"-m", "--model", "--mmproj", "--chat-template-file"}
MODEL_ROLES: tuple[ModelRole, ...] = ("reasoning", "chat", "vision", "coding", "aux")


def import_candidates_from_config(config_yaml: str, settings: ManagerSettings) -> list[ConfigImportCandidate]:
    document = YAML().load(config_yaml) or {}
    if not isinstance(document, dict):
        return []
    models = document.get("models") or {}
    if not isinstance(models, dict):
        return []
    matrix_lookup = _matrix_lookup(document.get("matrix") or {})
    has_legacy_groups = "groups" in document
    candidates: list[ConfigImportCandidate] = []
    used_matrix_keys: set[str] = set()
    used_ids: set[str] = set()
    for model_id, entry in models.items():
        if not isinstance(entry, dict):
            continue
        candidate = _candidate_from_entry(str(model_id), entry, matrix_lookup, used_matrix_keys, used_ids, settings)
        if has_legacy_groups:
            candidate.warnings.append("legacy groups are not imported; generated output will use matrix")
        candidates.append(candidate)
    return candidates


def _candidate_from_entry(
    model_id: str,
    entry: dict[str, Any],
    matrix_lookup: dict[str, str],
    used_matrix_keys: set[str],
    used_ids: set[str],
    settings: ManagerSettings,
) -> ConfigImportCandidate:
    warnings: list[str] = []
    cmd = str(entry.get("cmd") or "").strip()
    candidate_id = _unique_id(_slugify(model_id), used_ids)
    model = ManagedModel(
        id=candidate_id,
        display_name=model_id,
        source_type="manual",
        ttl=_int_or_default(entry.get("ttl"), 0),
        aliases=[str(alias) for alias in entry.get("aliases") or []],
        matrix_key=matrix_lookup.get(model_id) or default_matrix_key(model_id, used_matrix_keys),
        matrix_behavior="with_support",
    )
    try:
        args = shlex.split(cmd.replace("\\\n", " "))
    except ValueError as exc:
        model.raw_cmd_override = cmd
        warnings.append(f"could not parse command safely: {exc}")
        return ConfigImportCandidate(id=model.id, model=model, warnings=warnings)
    paths, flags, unknown = _parse_llama_args(args)
    model.primary_model_file = paths.get("-m") or paths.get("--model") or ""
    model.mmproj_file = paths.get("--mmproj") or ""
    model.chat_template_file = paths.get("--chat-template-file") or ""
    model.container_files = [path for path in [model.primary_model_file, model.mmproj_file, model.chat_template_file] if path]
    model.tokenizer_files = [path for path in model.container_files if classify_file(path).kind == "tokenizer"]
    model.llama_flags = flags
    model.gpu_devices = _cuda_devices(entry.get("env") or [])
    model.main_gpu = _int_or_none(flags.get("main_gpu"))
    model.tensor_split = str(flags.get("tensor_split") or "")
    model.role = _infer_role(model.primary_model_file, settings)
    if unknown:
        model.raw_cmd_override = cmd
        warnings.append(f"raw command preserved because unsupported args were found: {', '.join(unknown)}")
    if not model.primary_model_file:
        model.raw_cmd_override = cmd
        warnings.append("no primary model file was found in the command")
    return ConfigImportCandidate(id=model.id, model=model, warnings=warnings)


def _parse_llama_args(args: list[str]) -> tuple[dict[str, str], dict[str, Any], list[str]]:
    paths: dict[str, str] = {}
    flags: dict[str, Any] = {}
    unknown: list[str] = []
    index = 0
    while index < len(args):
        token = args[index]
        if not token.startswith("-"):
            index += 1
            continue
        value = ""
        if index + 1 < len(args) and not args[index + 1].startswith("-"):
            value = args[index + 1]
        if token in PATH_FLAGS:
            if value:
                paths[token] = value
                index += 2
                continue
            unknown.append(token)
            index += 1
            continue
        if token in IGNORED_FLAGS:
            index += 2 if value else 1
            continue
        key = token.lstrip("-").replace("-", "_")
        if token in VALUELESS_FLAGS or not value:
            flags[key] = True
            index += 1
        else:
            flags[key] = _coerce_arg_value(value)
            index += 2
    return paths, flags, unknown


def _coerce_arg_value(value: str) -> Any:
    lowered = value.lower()
    if lowered in {"true", "false"}:
        return lowered == "true"
    try:
        return int(value)
    except ValueError:
        try:
            return float(value)
        except ValueError:
            return value


def _matrix_lookup(matrix: Any) -> dict[str, str]:
    if not isinstance(matrix, dict):
        return {}
    vars_map = matrix.get("vars") or {}
    if not isinstance(vars_map, dict):
        return {}
    return {str(model_id): str(key) for key, model_id in vars_map.items()}


def _cuda_devices(env: list[Any]) -> list[int]:
    for raw in env:
        text = str(raw)
        if not text.startswith("CUDA_VISIBLE_DEVICES="):
            continue
        values = text.split("=", 1)[1]
        devices: list[int] = []
        for value in values.split(","):
            try:
                devices.append(int(value.strip()))
            except ValueError:
                continue
        return devices
    return []


def _infer_role(model_path: str, settings: ManagerSettings) -> ModelRole:
    for role in MODEL_ROLES:
        role_dir = getattr(settings.role_directories, role)
        if _is_posix_path_inside(model_path, role_dir):
            return role
    return "chat"


def _is_posix_path_inside(path: str, root: str) -> bool:
    try:
        candidate = PurePosixPath(path)
        root_path = PurePosixPath(root)
    except TypeError:
        return False
    return candidate == root_path or root_path in candidate.parents


def _int_or_default(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _int_or_none(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _slugify(value: str) -> str:
    candidate = "".join(character.lower() if character.isalnum() else "-" for character in value).strip("-")
    while "--" in candidate:
        candidate = candidate.replace("--", "-")
    return candidate or "imported-model"


def _unique_id(base_id: str, used_ids: set[str]) -> str:
    if base_id not in used_ids:
        used_ids.add(base_id)
        return base_id
    counter = 2
    while f"{base_id}-{counter}" in used_ids:
        counter += 1
    candidate = f"{base_id}-{counter}"
    used_ids.add(candidate)
    return candidate

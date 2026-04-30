from __future__ import annotations

import re
from pathlib import Path, PurePosixPath

from .config_service import default_matrix_key, manager_to_llama_path
from .hf_service import classify_file
from .schemas import CreateModelFromDownloadRequest, DownloadJob, FileInventoryItem, ManagedModel, ModelFileKind, ModelRole
from .settings import ManagerSettings

MODEL_ROLES: tuple[ModelRole, ...] = ("reasoning", "chat", "vision", "coding", "aux")
MULTIPART_NAME_RE = re.compile(r"(.+)-(\d{5})-of-(\d{5})\.gguf$", re.IGNORECASE)


def scan_model_files(settings: ManagerSettings) -> list[FileInventoryItem]:
    root = Path(settings.manager_model_root).resolve()
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
            container_path = manager_to_llama_path(str(resolved), settings)
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


def model_from_download(
    job: DownloadJob,
    request: CreateModelFromDownloadRequest,
    settings: ManagerSettings,
    existing_model_ids: set[str],
) -> ManagedModel:
    if job.status != "completed":
        raise ValueError("download job must be completed before it can create a model")
    if not job.written_files:
        raise ValueError("download job has no written files")

    manager_files: list[str] = []
    container_files: list[str] = []
    written_basenames = {Path(raw_path).name for raw_path in job.written_files}
    expected_basenames = {Path(raw_path).name for raw_path in job.files}
    expected_basenames |= _multipart_required_basenames(written_basenames | expected_basenames)
    missing_expected = expected_basenames - written_basenames
    if missing_expected:
        raise ValueError(f"incomplete download job is missing file(s): {', '.join(sorted(missing_expected))}")
    for raw_path in job.written_files:
        path = Path(raw_path)
        if not path.exists():
            raise ValueError(f"downloaded file is missing: {raw_path}")
        if not path.is_file():
            raise ValueError(f"downloaded path is not a file: {raw_path}")
        manager_files.append(str(path.resolve()))
        container_files.append(manager_to_llama_path(str(path), settings))

    display_name = request.display_name.strip() or Path(job.destination_dir).name or job.repo_id.split("/")[-1] or "model"
    requested_id = request.id.strip()
    model_id = _slugify(requested_id or display_name)
    if not model_id:
        raise ValueError("model id is required")
    if requested_id and model_id in existing_model_ids:
        raise ValueError(f"model id already exists: {model_id}")
    if not requested_id:
        model_id = _unique_id(model_id, existing_model_ids)

    primary_model_file, mmproj_file, chat_template_file, tokenizer_files = _infer_model_files(container_files)
    if not primary_model_file:
        raise ValueError("downloaded files do not include a GGUF model file")

    used_matrix_keys = set()
    matrix_key = request.matrix_key.strip() or default_matrix_key(model_id, used_matrix_keys)
    role = request.role or _infer_role_from_download(job, settings)
    ttl = request.ttl if request.ttl is not None else _default_ttl(settings, role)

    return ManagedModel(
        id=model_id,
        display_name=display_name,
        role=role,
        source_type="hf",
        hf_url=f"https://huggingface.co/{job.repo_id}" if job.repo_id else "",
        hf_revision=job.revision,
        manager_files=manager_files,
        container_files=container_files,
        primary_model_file=primary_model_file,
        mmproj_file=mmproj_file,
        chat_template_file=chat_template_file,
        tokenizer_files=tokenizer_files,
        aliases=request.aliases,
        ttl=ttl,
        gpu_devices=request.gpu_devices,
        main_gpu=request.main_gpu,
        tensor_split=request.tensor_split,
        matrix_key=matrix_key,
        matrix_behavior=request.matrix_behavior,
        matrix_expression=request.matrix_expression,
        evict_cost=request.evict_cost,
        startup_preload=request.startup_preload,
    )


def _infer_model_files(container_files: list[str]) -> tuple[str, str, str, list[str]]:
    primary = ""
    fallback_model = ""
    mmproj = ""
    chat_template = ""
    tokenizers: list[str] = []
    for container_file in container_files:
        classified = classify_file(container_file)
        kind: ModelFileKind = classified.kind
        if kind in {"gguf", "gguf_part"}:
            fallback_model = fallback_model or container_file
            if not primary and classified.selected:
                primary = container_file
        elif kind == "mmproj":
            mmproj = mmproj or container_file
        elif kind == "chat_template":
            chat_template = chat_template or container_file
        elif kind == "tokenizer":
            tokenizers.append(container_file)
    return primary or fallback_model, mmproj, chat_template, tokenizers


def _multipart_required_basenames(filenames: set[str]) -> set[str]:
    required: set[str] = set()
    for filename in filenames:
        match = MULTIPART_NAME_RE.match(filename)
        if not match:
            continue
        prefix = match.group(1)
        total = int(match.group(3))
        required.update(f"{prefix}-{index:05d}-of-{total:05d}.gguf" for index in range(1, total + 1))
    return required


def _default_ttl(settings: ManagerSettings, role: ModelRole) -> int:
    if role == "reasoning":
        return settings.defaults.ttl_reasoning
    if role == "vision":
        return settings.defaults.ttl_vision
    if role == "aux":
        return settings.defaults.ttl_aux
    return settings.defaults.ttl_chat


def _infer_role_from_download(job: DownloadJob, settings: ManagerSettings) -> ModelRole:
    container_dir = job.container_dir
    if not container_dir and job.destination_dir:
        try:
            container_dir = manager_to_llama_path(job.destination_dir, settings)
        except ValueError:
            container_dir = ""
    for role in MODEL_ROLES:
        role_dir = getattr(settings.role_directories, role)
        if _is_posix_path_inside(container_dir, role_dir):
            return role
    return "chat"


def _is_posix_path_inside(path: str, root: str) -> bool:
    try:
        candidate = PurePosixPath(path)
        root_path = PurePosixPath(root)
    except TypeError:
        return False
    if not candidate.is_absolute() or not root_path.is_absolute():
        return False
    return candidate == root_path or root_path in candidate.parents


def _slugify(value: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", value.lower())).strip("-")


def _unique_id(model_id: str, existing_ids: set[str]) -> str:
    if model_id not in existing_ids:
        return model_id
    counter = 2
    while f"{model_id}-{counter}" in existing_ids:
        counter += 1
    return f"{model_id}-{counter}"

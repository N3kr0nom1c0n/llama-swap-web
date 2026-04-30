from __future__ import annotations

import re
import shutil
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse

from huggingface_hub import HfApi, constants, hf_hub_download
from huggingface_hub.file_download import repo_folder_name

from .config_service import safe_join
from .schemas import HfFile, HfResolveResponse

MULTIPART_RE = re.compile(r"(.+)-(\d{5})-of-(\d{5})\.gguf$", re.IGNORECASE)
WINDOWS_DRIVE_RE = re.compile(r"^[A-Za-z]:")


@dataclass(frozen=True)
class HfReference:
    repo_id: str
    revision: str = "main"
    filename: str = ""


@dataclass(frozen=True)
class HfFileInfo:
    path: str
    size: int
    cache_path: Path
    incomplete_path: Path


def parse_hf_url(url: str, default_revision: str = "main") -> HfReference:
    parsed = urlparse(url.strip())
    if parsed.netloc not in {"huggingface.co", "www.huggingface.co"}:
        raise ValueError("URL must be from huggingface.co")
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) < 2:
        raise ValueError("Hugging Face URL must include namespace and repo")
    repo_id = f"{parts[0]}/{parts[1]}"
    revision = default_revision
    filename = ""
    if len(parts) >= 4 and parts[2] in {"blob", "resolve", "raw", "tree"}:
        revision = parts[3]
        if len(parts) > 4 and parts[2] != "tree":
            filename = "/".join(parts[4:])
    return HfReference(repo_id=repo_id, revision=revision, filename=filename)


def classify_file(path: str) -> HfFile:
    lower = path.lower()
    selected = False
    group = ""
    kind = "other"
    match = MULTIPART_RE.match(path)
    if match:
        kind = "gguf_part"
        selected = match.group(2) == "00001"
        group = match.group(1)
    elif lower.endswith(".gguf"):
        kind = "mmproj" if "mmproj" in lower else "gguf"
        selected = kind == "gguf"
    elif lower.endswith(".jinja") or "chat_template" in lower:
        kind = "chat_template"
        selected = True
    elif any(lower.endswith(ext) for ext in [".json", ".model", ".txt"]) and (
        "tokenizer" in lower or "vocab" in lower or "special_tokens" in lower
    ):
        kind = "tokenizer"
    return HfFile(path=path, kind=kind, selected=selected, group=group)


def classify_files(paths: list[str]) -> list[HfFile]:
    return [classify_file(path) for path in sorted(paths)]


def resolve_hf_url(url: str, revision: str = "main", token: str | bool | None = None, api: HfApi | None = None) -> HfResolveResponse:
    reference = parse_hf_url(url, revision)
    api = api or HfApi()
    files = api.list_repo_files(reference.repo_id, revision=reference.revision, token=token)
    classified = classify_files(files)
    if reference.filename:
        for item in classified:
            item.selected = item.path == reference.filename or item.selected
    return HfResolveResponse(
        repo_id=reference.repo_id,
        revision=reference.revision,
        direct_file=reference.filename,
        files=classified,
    )


def get_hf_file_info(
    repo_id: str,
    revision: str,
    files: list[str],
    token: str | bool | None = None,
    api: HfApi | None = None,
) -> list[HfFileInfo]:
    api = api or HfApi()
    remote_info = api.get_paths_info(
        repo_id,
        files,
        revision=revision,
        expand=True,
        token=token,
    )
    repo_cache = Path(constants.HF_HUB_CACHE) / repo_folder_name(repo_id=repo_id, repo_type="model") / "blobs"
    result: list[HfFileInfo] = []
    for item in remote_info:
        blob_id = getattr(item, "blob_id", "") or ""
        if not blob_id:
            continue
        cache_path = repo_cache / blob_id
        result.append(
            HfFileInfo(
                path=getattr(item, "path", ""),
                size=int(getattr(item, "size", 0) or 0),
                cache_path=cache_path,
                incomplete_path=cache_path.with_name(f"{cache_path.name}.incomplete"),
            )
        )
    return result


def _resolve_destination(destination_dir: str, model_root: str) -> Path:
    if "\\" in destination_dir or WINDOWS_DRIVE_RE.match(destination_dir):
        raise ValueError(f"unsafe destination directory: {destination_dir}")
    model_root_path = Path(model_root).resolve()
    destination_path = Path(destination_dir)
    if destination_path.is_absolute():
        relative = destination_path.resolve().relative_to(model_root_path)
        return safe_join(model_root_path, str(relative))
    return safe_join(model_root_path, destination_dir)


def _safe_hf_relative_parts(filename: str) -> tuple[str, ...]:
    if "\\" in filename:
        raise ValueError(f"unsafe Hugging Face filename: {filename}")
    path = PurePosixPath(filename)
    parts = tuple(filename.split("/"))
    if path.is_absolute() or not parts or any(part in {"", ".", ".."} for part in parts) or WINDOWS_DRIVE_RE.match(parts[0]):
        raise ValueError(f"unsafe Hugging Face filename: {filename}")
    return parts


def _preflight_target_path(destination: Path, target: Path, parts: tuple[str, ...]) -> None:
    raw_target = destination.joinpath(*parts)
    if raw_target.is_symlink():
        raise FileExistsError(f"target file already exists: {raw_target}")
    current = destination
    for part in parts[:-1]:
        current = current / part
        if current.is_symlink() or current.is_file():
            raise FileExistsError(f"target parent blocks download: {current}")
    if target.exists():
        raise FileExistsError(f"target file already exists: {target}")


def download_selected_files(
    repo_id: str,
    revision: str,
    files: list[str],
    destination_dir: str,
    model_root: str,
    token: str | bool | None = None,
) -> list[str]:
    destination = _resolve_destination(destination_dir, model_root)
    destination.mkdir(parents=True, exist_ok=True)
    targets: list[tuple[str, Path]] = []
    seen_targets: set[Path] = set()
    for filename in files:
        parts = _safe_hf_relative_parts(filename)
        raw_target = destination.joinpath(*parts)
        if raw_target.is_symlink():
            raise FileExistsError(f"target file already exists: {raw_target}")
        target = safe_join(destination, *parts)
        if target in seen_targets:
            raise FileExistsError(f"duplicate download target: {target}")
        _preflight_target_path(destination, target, parts)
        targets.append((filename, target))
        seen_targets.add(target)
    written: list[str] = []
    for filename, target in targets:
        cached = hf_hub_download(
            repo_id=repo_id,
            filename=filename,
            revision=revision,
            token=token,
        )
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(cached, target)
        written.append(str(target))
    return written

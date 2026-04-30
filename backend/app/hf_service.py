from __future__ import annotations

import os
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from huggingface_hub import HfApi, hf_hub_download

from .config_service import safe_join
from .schemas import HfFile, HfResolveResponse

MULTIPART_RE = re.compile(r"(.+)-(\d{5})-of-(\d{5})\.gguf$", re.IGNORECASE)


@dataclass(frozen=True)
class HfReference:
    repo_id: str
    revision: str = "main"
    filename: str = ""


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


def resolve_hf_url(url: str, revision: str = "main", token: str | None = None, api: HfApi | None = None) -> HfResolveResponse:
    reference = parse_hf_url(url, revision)
    api = api or HfApi()
    files = api.list_repo_files(reference.repo_id, revision=reference.revision, token=token or os.getenv("HF_TOKEN") or None)
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


def download_selected_files(
    repo_id: str,
    revision: str,
    files: list[str],
    destination_dir: str,
    model_root: str,
    token: str | None = None,
) -> list[str]:
    destination = safe_join(model_root, str(Path(destination_dir).relative_to(model_root)) if Path(destination_dir).is_absolute() else destination_dir)
    destination.mkdir(parents=True, exist_ok=True)
    written: list[str] = []
    for filename in files:
        cached = hf_hub_download(
            repo_id=repo_id,
            filename=filename,
            revision=revision,
            token=token or os.getenv("HF_TOKEN") or None,
        )
        target = safe_join(destination, Path(filename).name)
        shutil.copy2(cached, target)
        written.append(str(target))
    return written


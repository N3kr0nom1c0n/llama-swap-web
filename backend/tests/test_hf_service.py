from __future__ import annotations

import pytest

from app.hf_service import classify_file, classify_files, parse_hf_url
from app.downloads import DownloadManager
from app.database import Database
from app.schemas import DownloadRequest
from app.settings import ManagerSettings


def test_parse_hf_repo_url() -> None:
    reference = parse_hf_url("https://huggingface.co/unsloth/Qwen3-30B-A3B-GGUF")

    assert reference.repo_id == "unsloth/Qwen3-30B-A3B-GGUF"
    assert reference.revision == "main"
    assert reference.filename == ""


def test_parse_hf_direct_file_url() -> None:
    reference = parse_hf_url(
        "https://huggingface.co/unsloth/Qwen3-30B-A3B-GGUF/blob/main/Qwen3-30B-A3B-Q4_K_M.gguf"
    )

    assert reference.repo_id == "unsloth/Qwen3-30B-A3B-GGUF"
    assert reference.revision == "main"
    assert reference.filename == "Qwen3-30B-A3B-Q4_K_M.gguf"


def test_parse_hf_rejects_non_hf_url() -> None:
    with pytest.raises(ValueError):
        parse_hf_url("https://example.com/model.gguf")


def test_classifies_multipart_gguf_and_mmproj() -> None:
    files = classify_files(
        [
            "model-00001-of-00003.gguf",
            "model-00002-of-00003.gguf",
            "mmproj-F16.gguf",
            "chat_template.jinja",
            "tokenizer.json",
            "README.md",
        ]
    )

    by_path = {file.path: file for file in files}
    assert by_path["model-00001-of-00003.gguf"].kind == "gguf_part"
    assert by_path["model-00001-of-00003.gguf"].selected
    assert by_path["model-00002-of-00003.gguf"].kind == "gguf_part"
    assert not by_path["model-00002-of-00003.gguf"].selected
    assert by_path["mmproj-F16.gguf"].kind == "mmproj"
    assert by_path["chat_template.jinja"].kind == "chat_template"
    assert by_path["tokenizer.json"].kind == "tokenizer"


def test_classifies_single_gguf_selected() -> None:
    classified = classify_file("Qwen3-Coder-Q4_K_M.gguf")

    assert classified.kind == "gguf"
    assert classified.selected


def test_download_job_records_written_and_container_files(tmp_path, monkeypatch) -> None:
    db = Database(tmp_path / "manager.db")
    db.init()
    settings = ManagerSettings(manager_model_root=str(tmp_path / "models"), llama_swap_model_root="/models")

    def fake_download_selected_files(**kwargs):
        target = tmp_path / "models" / "chat" / "tiny.gguf"
        target.parent.mkdir(parents=True)
        target.write_text("fake", encoding="utf-8")
        return [str(target)]

    monkeypatch.setattr("app.downloads.download_selected_files", fake_download_selected_files)
    manager = DownloadManager(db, settings)
    job = manager.start(
        DownloadRequest(repo_id="org/repo", files=["tiny.gguf"], destination_dir=str(tmp_path / "models" / "chat"))
    )
    manager._threads[job.id].join(timeout=5)

    completed = db.get_job(job.id)
    assert completed is not None
    assert completed.status == "completed"
    assert completed.written_files == [str(tmp_path / "models" / "chat" / "tiny.gguf")]
    assert completed.container_files == ["/models/chat/tiny.gguf"]


def test_cancelled_download_does_not_become_completed_after_transfer(tmp_path, monkeypatch) -> None:
    db = Database(tmp_path / "manager.db")
    db.init()
    settings = ManagerSettings(manager_model_root=str(tmp_path / "models"), llama_swap_model_root="/models")
    manager = DownloadManager(db, settings)

    def fake_download_selected_files(**kwargs):
        manager._cancelled.add(job_id)
        target = tmp_path / "models" / "chat" / "tiny.gguf"
        target.parent.mkdir(parents=True)
        target.write_text("fake", encoding="utf-8")
        return [str(target)]

    monkeypatch.setattr("app.downloads.download_selected_files", fake_download_selected_files)
    job = manager.start(
        DownloadRequest(repo_id="org/repo", files=["tiny.gguf"], destination_dir=str(tmp_path / "models" / "chat"))
    )
    job_id = job.id
    manager._threads[job.id].join(timeout=5)

    completed = db.get_job(job.id)
    assert completed is not None
    assert completed.status == "cancelled"
    assert completed.written_files == []
    assert completed.container_files == []

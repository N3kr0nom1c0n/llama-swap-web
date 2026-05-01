from __future__ import annotations

import threading
import queue

import pytest

from app.hf_service import HfFileInfo, classify_file, classify_files, download_selected_files, get_hf_file_info, parse_hf_url, resolve_hf_url
from app import downloads as downloads_module
from app.downloads import DownloadCancelled, DownloadManager
from app.database import Database
from app.schemas import DownloadJob, DownloadRequest, TargetRig
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


def test_hf_calls_do_not_fall_back_to_process_env_token(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("HF_TOKEN", "hf_startup_secret")
    calls: dict[str, object] = {}

    class FakeApi:
        def list_repo_files(self, repo_id, revision, token):
            calls["resolve_token"] = token
            return ["model.gguf"]

        def get_paths_info(self, repo_id, files, revision, expand, token):
            calls["info_token"] = token
            item = type("Item", (), {})()
            item.path = "model.gguf"
            item.size = 1
            item.blob_id = "abc"
            return [item]

    def fake_download(**kwargs):
        calls["download_token"] = kwargs["token"]
        cached = tmp_path / "cached.gguf"
        cached.write_text("fake", encoding="utf-8")
        return str(cached)

    monkeypatch.setattr("app.hf_service.hf_hub_download", fake_download)

    resolve_hf_url("https://huggingface.co/org/repo", token=False, api=FakeApi())
    get_hf_file_info("org/repo", "main", ["model.gguf"], token=False, api=FakeApi())
    download_selected_files("org/repo", "main", ["model.gguf"], str(tmp_path / "models"), str(tmp_path / "models"), token=False)

    assert calls["resolve_token"] is False
    assert calls["info_token"] is False
    assert calls["download_token"] is False


def test_download_selected_files_preserves_nested_paths_and_basename_collisions(tmp_path, monkeypatch) -> None:
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()

    def fake_download(**kwargs):
        cached = cache_dir / kwargs["filename"].replace("/", "__")
        cached.write_text(kwargs["filename"], encoding="utf-8")
        return str(cached)

    monkeypatch.setattr("app.hf_service.hf_hub_download", fake_download)

    written = download_selected_files(
        "org/repo",
        "main",
        ["shards/model.gguf", "alt/model.gguf"],
        str(tmp_path / "models" / "chat"),
        str(tmp_path / "models"),
        token=False,
    )

    assert written == [
        str(tmp_path / "models" / "chat" / "shards" / "model.gguf"),
        str(tmp_path / "models" / "chat" / "alt" / "model.gguf"),
    ]
    assert (tmp_path / "models" / "chat" / "shards" / "model.gguf").read_text(encoding="utf-8") == "shards/model.gguf"
    assert (tmp_path / "models" / "chat" / "alt" / "model.gguf").read_text(encoding="utf-8") == "alt/model.gguf"


@pytest.mark.parametrize(
    "filename",
    ["../escape.gguf", "/escape.gguf", "dir\\escape.gguf", "dir//escape.gguf", "C:/escape.gguf", "C:escape.gguf", "C:.gguf"],
)
def test_download_selected_files_rejects_unsafe_paths(tmp_path, monkeypatch, filename) -> None:
    def fake_download(**kwargs):
        raise AssertionError("unsafe filenames should be rejected before download")

    monkeypatch.setattr("app.hf_service.hf_hub_download", fake_download)

    with pytest.raises(ValueError):
        download_selected_files(
            "org/repo",
            "main",
            [filename],
            str(tmp_path / "models" / "chat"),
            str(tmp_path / "models"),
            token=False,
        )


@pytest.mark.parametrize("destination", ["C:/models/repo", "C:models/repo", "C:\\models\\repo"])
def test_download_selected_files_rejects_windows_drive_destinations(tmp_path, monkeypatch, destination) -> None:
    def fake_download(**kwargs):
        raise AssertionError("unsafe destination should be rejected before download")

    monkeypatch.setattr("app.hf_service.hf_hub_download", fake_download)

    with pytest.raises(ValueError):
        download_selected_files(
            "org/repo",
            "main",
            ["model.gguf"],
            destination,
            str(tmp_path / "models"),
            token=False,
        )


def test_download_selected_files_refuses_to_overwrite_existing_target(tmp_path, monkeypatch) -> None:
    destination = tmp_path / "models" / "chat"
    existing = destination / "shards" / "model.gguf"
    existing.parent.mkdir(parents=True)
    existing.write_text("existing", encoding="utf-8")
    cached = tmp_path / "cached.gguf"
    cached.write_text("new", encoding="utf-8")

    def fake_download(**kwargs):
        return str(cached)

    monkeypatch.setattr("app.hf_service.hf_hub_download", fake_download)

    with pytest.raises(FileExistsError):
        download_selected_files(
            "org/repo",
            "main",
            ["shards/model.gguf"],
            str(destination),
            str(tmp_path / "models"),
            token=False,
        )
    assert existing.read_text(encoding="utf-8") == "existing"


def test_download_selected_files_preflights_all_targets_before_copying(tmp_path, monkeypatch) -> None:
    destination = tmp_path / "models" / "chat"
    existing = destination / "second.gguf"
    existing.parent.mkdir(parents=True)
    existing.write_text("existing", encoding="utf-8")
    cached = tmp_path / "cached.gguf"
    cached.write_text("new", encoding="utf-8")
    calls: list[str] = []

    def fake_download(**kwargs):
        calls.append(kwargs["filename"])
        return str(cached)

    monkeypatch.setattr("app.hf_service.hf_hub_download", fake_download)

    with pytest.raises(FileExistsError):
        download_selected_files(
            "org/repo",
            "main",
            ["first.gguf", "second.gguf"],
            str(destination),
            str(tmp_path / "models"),
            token=False,
        )
    assert calls == []
    assert not (destination / "first.gguf").exists()
    assert existing.read_text(encoding="utf-8") == "existing"


def test_download_selected_files_preflights_parent_file_collisions(tmp_path, monkeypatch) -> None:
    destination = tmp_path / "models" / "chat"
    destination.mkdir(parents=True)
    (destination / "blocked").write_text("regular-file", encoding="utf-8")
    cached = tmp_path / "cached.gguf"
    cached.write_text("new", encoding="utf-8")
    calls: list[str] = []

    def fake_download(**kwargs):
        calls.append(kwargs["filename"])
        return str(cached)

    monkeypatch.setattr("app.hf_service.hf_hub_download", fake_download)

    with pytest.raises(FileExistsError):
        download_selected_files(
            "org/repo",
            "main",
            ["first.gguf", "blocked/model.gguf"],
            str(destination),
            str(tmp_path / "models"),
            token=False,
        )
    assert calls == []
    assert not (destination / "first.gguf").exists()


def test_download_selected_files_refuses_broken_symlink_target(tmp_path, monkeypatch) -> None:
    destination = tmp_path / "models" / "chat"
    destination.mkdir(parents=True)
    (destination / "model.gguf").symlink_to(tmp_path / "missing-target.gguf")

    def fake_download(**kwargs):
        raise AssertionError("symlink targets should be rejected before download")

    monkeypatch.setattr("app.hf_service.hf_hub_download", fake_download)

    with pytest.raises(FileExistsError):
        download_selected_files(
            "org/repo",
            "main",
            ["model.gguf"],
            str(destination),
            str(tmp_path / "models"),
            token=False,
        )


def test_download_job_records_container_dir_and_nested_container_files(tmp_path, monkeypatch) -> None:
    db = Database(tmp_path / "manager.db")
    db.init()
    settings = ManagerSettings(manager_model_root=str(tmp_path / "models"), llama_swap_model_root="/models")
    release_download = threading.Event()

    def fake_download_selected_files(**kwargs):
        release_download.wait(timeout=5)
        target = tmp_path / "models" / "chat" / "shards" / "tiny.gguf"
        target.parent.mkdir(parents=True)
        target.write_text("fake", encoding="utf-8")
        return [str(target)]

    monkeypatch.setattr("app.downloads.download_selected_files", fake_download_selected_files)
    manager = DownloadManager(db, settings, run_in_process=False)
    job = manager.start(
        DownloadRequest(repo_id="org/repo", files=["shards/tiny.gguf"], destination_dir=str(tmp_path / "models" / "chat"))
    )
    assert job.container_dir == "/models/chat"
    thread = manager._threads[job.id]
    release_download.set()
    thread.join(timeout=5)

    completed = db.get_job(job.id)
    assert completed is not None
    assert completed.status == "completed"
    assert completed.written_files == [str(tmp_path / "models" / "chat" / "shards" / "tiny.gguf")]
    assert completed.container_files == ["/models/chat/shards/tiny.gguf"]
    assert job.id not in manager._threads


def test_cancelled_download_does_not_become_completed_after_transfer(tmp_path, monkeypatch) -> None:
    db = Database(tmp_path / "manager.db")
    db.init()
    settings = ManagerSettings(manager_model_root=str(tmp_path / "models"), llama_swap_model_root="/models")
    manager = DownloadManager(db, settings, run_in_process=False)

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


def test_cancelled_ssh_download_terminates_worker_process(tmp_path, monkeypatch) -> None:
    db = Database(tmp_path / "manager.db")
    db.init()
    settings = ManagerSettings()
    manager = DownloadManager(db, settings, run_in_process=False)
    manager._cancelled.add("ssh-job")
    terminated: list[bool] = []

    class FakeQueue:
        def get_nowait(self):
            raise queue.Empty

        def get(self, timeout: int = 0):
            raise queue.Empty

        def close(self) -> None:
            pass

    class FakeProcess:
        def __init__(self, *args, **kwargs):
            self.exitcode = None
            self.alive = True
            self.pid = None

        def start(self) -> None:
            pass

        def is_alive(self) -> bool:
            return self.alive

        def terminate(self) -> None:
            terminated.append(True)
            self.exitcode = -15
            self.alive = False

        def join(self, timeout: int | None = None) -> None:
            pass

    class FakeContext:
        def Queue(self):
            return FakeQueue()

        def Process(self, *args, **kwargs):
            return FakeProcess()

    monkeypatch.setattr(downloads_module.multiprocessing, "get_context", lambda _name: FakeContext())
    rig = TargetRig(id="rig-40", mode="ssh", host="192.168.42.40", username="n3kr0")

    with pytest.raises(DownloadCancelled, match="remote ssh download process terminated"):
        manager._download_ssh_process(
            "ssh-job",
            {"repo_id": "org/repo", "revision": "main", "files": ["model.gguf"], "destination_dir": "/models/chat", "token": False},
            rig,
        )

    assert terminated == [True]


def test_queued_jobs_resume_after_manager_startup(tmp_path, monkeypatch) -> None:
    db = Database(tmp_path / "manager.db")
    db.init()
    settings = ManagerSettings(manager_model_root=str(tmp_path / "models"), llama_swap_model_root="/models")
    queued = DownloadJob(
        id="queued-job",
        status="queued",
        repo_id="org/repo",
        files=["tiny.gguf"],
        destination_dir=str(tmp_path / "models" / "chat"),
        logs=["queued download job"],
    )
    db.save_job(queued)

    def fake_download_selected_files(**kwargs):
        target = tmp_path / "models" / "chat" / "tiny.gguf"
        target.parent.mkdir(parents=True)
        target.write_text("fake", encoding="utf-8")
        return [str(target)]

    monkeypatch.setattr("app.downloads.download_selected_files", fake_download_selected_files)
    manager = DownloadManager(db, settings, run_in_process=False)
    manager._threads["queued-job"].join(timeout=5)

    completed = db.get_job("queued-job")
    assert completed is not None
    assert completed.status == "completed"
    assert "resumed queued job after manager startup" in completed.logs


def test_running_jobs_are_marked_failed_after_manager_startup(tmp_path) -> None:
    db = Database(tmp_path / "manager.db")
    db.init()
    settings = ManagerSettings(manager_model_root=str(tmp_path / "models"), llama_swap_model_root="/models")
    db.save_job(
        DownloadJob(
            id="running-job",
            status="running",
            repo_id="org/repo",
            files=["tiny.gguf"],
            destination_dir=str(tmp_path / "models" / "chat"),
            logs=["downloading 1 file(s)"],
        )
    )

    DownloadManager(db, settings, run_in_process=False)

    failed = db.get_job("running-job")
    assert failed is not None
    assert failed.status == "failed"
    assert failed.error == "manager restarted before download completed; retry the job"


def test_download_progress_uses_hf_cache_bytes(tmp_path) -> None:
    db = Database(tmp_path / "manager.db")
    db.init()
    settings = ManagerSettings(manager_model_root=str(tmp_path / "models"), llama_swap_model_root="/models")
    manager = DownloadManager(db, settings, run_in_process=False)
    job = DownloadJob(
        id="progress-job",
        status="running",
        repo_id="org/repo",
        files=["model.gguf"],
        destination_dir=str(tmp_path / "models" / "chat"),
        progress=5,
    )
    db.save_job(job)
    incomplete = tmp_path / "model.gguf.incomplete"
    incomplete.write_bytes(b"x" * 40)

    manager._update_progress_from_cache(
        "progress-job",
        [HfFileInfo(path="model.gguf", size=100, cache_path=tmp_path / "model.gguf", incomplete_path=incomplete)],
    )

    updated = db.get_job("progress-job")
    assert updated is not None
    assert updated.bytes_downloaded == 40
    assert updated.bytes_total == 100
    assert updated.active_file == "model.gguf"
    assert updated.progress == 40


def test_cleanup_terminal_jobs_removes_records_and_stale_tracking(tmp_path) -> None:
    db = Database(tmp_path / "manager.db")
    db.init()
    settings = ManagerSettings(manager_model_root=str(tmp_path / "models"), llama_swap_model_root="/models")
    manager = DownloadManager(db, settings, run_in_process=False)
    for status in ["completed", "failed", "cancelled", "queued", "running"]:
        db.save_job(
            DownloadJob(
                id=f"{status}-job",
                status=status,
                repo_id="org/repo",
                files=["tiny.gguf"],
                destination_dir=str(tmp_path / "models" / "chat"),
            )
        )
    manager._threads["completed-job"] = threading.Thread()
    manager._threads["running-job"] = threading.Thread()
    manager._processes["failed-job"] = object()  # type: ignore[assignment]
    manager._cancelled.update({"cancelled-job", "running-job"})

    removed = manager.cleanup_terminal_jobs()

    assert removed == 3
    assert db.get_job("completed-job") is None
    assert db.get_job("failed-job") is None
    assert db.get_job("cancelled-job") is None
    assert db.get_job("queued-job") is not None
    assert db.get_job("running-job") is not None
    assert "completed-job" not in manager._threads
    assert "failed-job" not in manager._processes
    assert "cancelled-job" not in manager._cancelled
    assert "running-job" in manager._threads
    assert "running-job" in manager._cancelled


def test_low_disk_preflight_blocks_before_download_starts(tmp_path, monkeypatch) -> None:
    db = Database(tmp_path / "manager.db")
    db.init()
    settings = ManagerSettings(
        manager_model_root=str(tmp_path / "models"),
        llama_swap_model_root="/models",
        disk_safety_gb=1,
    )
    manager = DownloadManager(db, settings, run_in_process=False)
    calls: list[str] = []

    monkeypatch.setattr(
        manager,
        "_file_info",
        lambda job, token: [
            HfFileInfo(
                path="tiny.gguf",
                size=10 * 1024**3,
                cache_path=tmp_path / "cache" / "tiny.gguf",
                incomplete_path=tmp_path / "cache" / "tiny.gguf.incomplete",
            )
        ],
    )
    monkeypatch.setattr("app.downloads.shutil.disk_usage", lambda path: (100 * 1024**3, 95 * 1024**3, 5 * 1024**3))

    def fake_download_selected_files(**kwargs):
        calls.append(kwargs["repo_id"])
        return []

    monkeypatch.setattr("app.downloads.download_selected_files", fake_download_selected_files)
    job = manager.start(DownloadRequest(repo_id="org/repo", files=["tiny.gguf"], destination_dir=str(tmp_path / "models" / "chat")))
    manager._threads[job.id].join(timeout=5)

    failed = db.get_job(job.id)
    assert failed is not None
    assert failed.status == "failed"
    assert "not enough free disk space" in failed.error
    assert "low disk space preflight failed" in failed.logs
    assert calls == []
    assert job.id not in manager._threads


def test_unknown_download_size_does_not_block_disk_preflight(tmp_path, monkeypatch) -> None:
    db = Database(tmp_path / "manager.db")
    db.init()
    settings = ManagerSettings(
        manager_model_root=str(tmp_path / "models"),
        llama_swap_model_root="/models",
        disk_safety_gb=1,
    )
    manager = DownloadManager(db, settings, run_in_process=False)

    monkeypatch.setattr(manager, "_file_info", lambda job, token: [])
    monkeypatch.setattr("app.downloads.shutil.disk_usage", lambda path: (100 * 1024**3, 100 * 1024**3, 0))

    def fake_download_selected_files(**kwargs):
        target = tmp_path / "models" / "chat" / "tiny.gguf"
        target.parent.mkdir(parents=True)
        target.write_text("fake", encoding="utf-8")
        return [str(target)]

    monkeypatch.setattr("app.downloads.download_selected_files", fake_download_selected_files)
    job = manager.start(DownloadRequest(repo_id="org/repo", files=["tiny.gguf"], destination_dir=str(tmp_path / "models" / "chat")))
    manager._threads[job.id].join(timeout=5)

    completed = db.get_job(job.id)
    assert completed is not None
    assert completed.status == "completed"


def test_update_settings_increases_download_concurrency_at_runtime(tmp_path, monkeypatch) -> None:
    db = Database(tmp_path / "manager.db")
    db.init()
    settings = ManagerSettings(
        manager_model_root=str(tmp_path / "models"),
        llama_swap_model_root="/models",
        max_parallel_downloads=1,
    )
    manager = DownloadManager(db, settings, run_in_process=False)
    started: list[str] = []
    release_download = threading.Event()
    both_started = threading.Event()

    def fake_download_selected_files(**kwargs):
        started.append(kwargs["repo_id"])
        if len(started) == 2:
            both_started.set()
        release_download.wait(timeout=5)
        target = tmp_path / "models" / kwargs["repo_id"].split("/")[-1] / "tiny.gguf"
        target.parent.mkdir(parents=True)
        target.write_text("fake", encoding="utf-8")
        return [str(target)]

    monkeypatch.setattr("app.downloads.download_selected_files", fake_download_selected_files)
    first = manager.start(DownloadRequest(repo_id="org/one", files=["tiny.gguf"], destination_dir=str(tmp_path / "models" / "one")))
    second = manager.start(DownloadRequest(repo_id="org/two", files=["tiny.gguf"], destination_dir=str(tmp_path / "models" / "two")))

    while not started:
        pass
    assert started == ["org/one"]

    manager.update_settings(settings.model_copy(update={"max_parallel_downloads": 2}))

    assert both_started.wait(timeout=5)
    first_thread = manager._threads[first.id]
    second_thread = manager._threads[second.id]
    release_download.set()
    first_thread.join(timeout=5)
    second_thread.join(timeout=5)

    assert db.get_job(first.id).status == "completed"  # type: ignore[union-attr]
    assert db.get_job(second.id).status == "completed"  # type: ignore[union-attr]

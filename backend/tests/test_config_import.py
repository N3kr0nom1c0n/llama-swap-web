from __future__ import annotations

from app.config_import import import_candidates_from_config
from app.settings import ManagerSettings


def test_import_candidates_parse_llama_swap_models() -> None:
    config = """
models:
  "Qwen Vision":
    cmd: |
      /app/llama-server --port ${PORT} -m /models/vision/qwen/qwen.gguf \\
        --mmproj /models/vision/qwen/mmproj-F16.gguf \\
        --chat-template-file /models/vision/qwen/chat_template.jinja \\
        --ctx-size 131072 \\
        --cache-type-k q4_0 \\
        --cache-type-v q4_0 \\
        --main-gpu 1 \\
        --tensor-split 1,1 \\
        --jinja
    ttl: 300
    aliases:
      - Jarvis
    env:
      - CUDA_VISIBLE_DEVICES=0,1
matrix:
  vars:
    qv: Qwen Vision
  sets:
    qv_set: qv
"""

    candidates = import_candidates_from_config(config, ManagerSettings())

    assert len(candidates) == 1
    candidate = candidates[0]
    model = candidate.model
    assert candidate.id == "qwen-vision"
    assert model.display_name == "Qwen Vision"
    assert model.role == "vision"
    assert model.ttl == 300
    assert model.aliases == ["Jarvis"]
    assert model.primary_model_file == "/models/vision/qwen/qwen.gguf"
    assert model.mmproj_file == "/models/vision/qwen/mmproj-F16.gguf"
    assert model.chat_template_file == "/models/vision/qwen/chat_template.jinja"
    assert model.llama_flags["ctx_size"] == 131072
    assert model.llama_flags["cache_type_k"] == "q4_0"
    assert model.main_gpu == 1
    assert model.tensor_split == "1,1"
    assert model.gpu_devices == [0, 1]
    assert model.matrix_key == "qv"


def test_import_candidates_preserve_raw_command_when_no_model_file() -> None:
    config = """
models:
  broken:
    cmd: /app/llama-server --port ${PORT} --ctx-size 2048
"""

    candidates = import_candidates_from_config(config, ManagerSettings())

    assert candidates[0].model.raw_cmd_override
    assert "no primary model file" in candidates[0].warnings[0]

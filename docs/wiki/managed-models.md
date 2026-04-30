# Managed Models

Managed Models are the manager-owned llama-swap model entries. Raw files on disk do not become usable in llama-swap until a managed entry points to them and config is applied.

## Identity

- Model ID: stable llama-swap key.
- Display name: human label shown in the manager.
- Role: reasoning, chat, vision, coding, or aux. Role affects default ttl and default directory.
- Aliases: optional alternate names exposed by llama-swap.

## Files

- Primary model file: the GGUF passed to `-m`.
- Container files: files as llama-swap sees them, usually `/models/...`.
- Manager files: files as the manager writes them, usually the same in Docker and host paths in native mode.
- MMProj file: vision projection file for multimodal models.
- Chat template file: custom Jinja template when needed.
- Tokenizer files: tokenizer companion files if needed by the model.

Generated llama-swap commands must use container paths, not host paths.

## Runtime Flags

Common llama.cpp flags:

- `ctx-size`: context window. Higher values increase KV cache memory.
- `cache-type-k` and `cache-type-v`: KV quantization. Lower precision can reduce VRAM.
- `n-gpu-layers`: number of layers offloaded to GPU. `999` usually means "as many as possible".
- `main-gpu`: preferred primary GPU.
- `tensor-split`: split ratio across visible GPUs.
- `flash-attn`: can reduce memory and improve speed when supported.
- `no-mmap`: loads through normal file IO instead of memory mapping.
- `batch-size` and `ubatch-size`: throughput and memory tuning.
- `parallel`: request slots. More slots use more memory.

## Matrix Behavior

Matrix controls which models can be loaded together.

- `runs_alone`: model should run by itself.
- `with_support`: model can run with support models.
- `support`: model stays available for other models, often embeddings or rerankers.
- `custom`: advanced matrix expression.

The manager emits `matrix`, not legacy `groups`.

## Advanced Raw Command

Raw command override exists for unusual setups. It can bypass structured validation, so use it only when the structured fields cannot express the needed llama-server command.

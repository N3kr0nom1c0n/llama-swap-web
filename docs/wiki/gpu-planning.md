# GPU Planning

GPU Planner helps map models to CUDA devices and llama.cpp placement flags.

## CUDA Devices

CUDA indexes should match `nvidia-smi` ordering inside the llama-swap runtime. If Docker remaps devices, verify from inside the container.

## Main GPU

`main-gpu` selects the primary GPU for llama.cpp. It should be one of the devices visible to the model's `CUDA_VISIBLE_DEVICES` environment.

## Tensor Split

`tensor-split` distributes model tensors across visible GPUs. Same-size GPUs often use equal ratios. Mixed VRAM rigs usually need proportional ratios so small cards do not fill first.

Examples:

```text
2x 24GB: 1,1
24GB + 16GB: 24,16
4x mixed cards: 24,24,16,16
```

## VRAM Fit

Model fit is affected by:

- GGUF file size and quant.
- `ctx-size`.
- KV cache types.
- `parallel`.
- `batch-size` and `ubatch-size`.
- Vision settings such as mmproj and image token budget.
- Other models loaded at the same time through matrix behavior.

If a model fails with out-of-memory errors, lower context first, then tune KV cache, ubatch, tensor split, and selected devices.

## Support Models

Auxiliary models such as embeddings and rerankers often belong on a smaller card and in matrix support sets. Keep them persistent only if they are used constantly and the VRAM tradeoff is worth it.

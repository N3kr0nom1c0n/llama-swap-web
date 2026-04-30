import { describe, expect, it } from "vitest";
import { emptyModel } from "./types";
import { modelCommand, redactToken, safeMatrixKey } from "./utils";

describe("modelCommand", () => {
  it("includes llama-server flags and PORT placeholder", () => {
    const model = {
      ...emptyModel(),
      id: "tiny-chat",
      primary_model_file: "/models/chat/tiny.gguf",
      main_gpu: 0,
      tensor_split: "24,24",
      mmproj_file: "/models/chat/mmproj.gguf",
      llama_flags: {
        ctx_size: 4096,
        cache_type_k: "q4_0",
        cache_type_v: "q4_0",
        flash_attn: "on",
        jinja: true,
        no_mmap: true,
      },
    };

    expect(modelCommand(model, undefined)).toContain("--port ${PORT}");
    expect(modelCommand(model, undefined)).toContain("-m /models/chat/tiny.gguf");
    expect(modelCommand(model, undefined)).toContain("--tensor-split 24,24");
    expect(modelCommand(model, undefined)).toContain("--mmproj /models/chat/mmproj.gguf");
  });

  it("redacts Hugging Face token strings", () => {
    expect(redactToken("token=hf_secretValue123")).toBe("token=hf_***");
  });

  it("creates short llama-swap matrix identifiers", () => {
    expect(safeMatrixKey("Qwen3-Coder-Next")).toBe("Qwen3Cod");
    expect(safeMatrixKey("120B-model")).toBe("m120Bmod");
  });
});

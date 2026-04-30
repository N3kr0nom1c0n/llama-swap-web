# Model Import Workflows

The app supports four model sources: Hugging Face repo URLs, direct Hugging Face file URLs, browser uploads, and existing files already under `/models`.

## Hugging Face Repo URL

Paste a repository URL such as:

```text
https://huggingface.co/org/model-repo
```

The resolver lists files and classifies them as GGUF, multipart GGUF shard, mmproj, chat template, tokenizer, or other. For quantized repos, choose the quant family you actually want. Do not download every quant in a large repo unless that is deliberate.

## Direct Hugging Face File URL

Paste a direct file URL when you already know the exact quant:

```text
https://huggingface.co/org/model-repo/blob/main/model-Q4_K_M.gguf
```

Direct file URLs should select that file and obvious companion files only. This avoids accidentally selecting every GGUF in the repo.

## Multipart GGUF

Multipart models use names like:

```text
model-00001-of-00003.gguf
model-00002-of-00003.gguf
model-00003-of-00003.gguf
```

All shards are required. The first shard is the command path, but the remaining shards must exist next to it. The manager validates incomplete multipart sets before creating a managed model.

## Vision Models

Vision models often need an `mmproj` file and sometimes a chat template. Keep those files in the same per-model folder unless the model documentation says otherwise. Managed Models exposes explicit fields for primary GGUF, mmproj, chat template, and tokenizer files.

## Uploads

Uploads are for local files already on your browser machine. The manager streams uploads in chunks and enforces an extension allowlist and max upload size. Upload into the role that matches the intended use: chat, reasoning, vision, coding, or aux.

## Existing Files

Use the model scanner when GGUF files already exist under `/models`. The scanner ignores unsafe symlinks and only returns supported model/companion file types.

## Completed But Unconfigured Downloads

A completed download is not useful until a managed model entry references it. Use the install/create action from the download queue so the manager can infer files, role, ttl, and defaults. This is the bridge the app is meant to automate.

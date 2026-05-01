# Model Import Workflows

The app supports four model sources: Hugging Face repo URLs, direct Hugging Face file URLs, browser uploads, and existing files already under the selected target rig's model root.

## Hugging Face Repo URL

Paste a repository URL such as:

```text
https://huggingface.co/org/model-repo
```

The resolver lists files and classifies them as GGUF, multipart GGUF shard, mmproj, chat template, tokenizer, or other. For quantized repos, choose the quant family you actually want. Do not download every quant in a large repo unless that is deliberate.

`Preview Destination` shows the selected target rig install directory before the download starts. In SSH mode that path is on the remote rig, not the manager host. New imports use a per-model layout under `/models/<role>/<model-id>/` as seen by llama-swap so support files such as `mmproj-F16.gguf` and `chat_template.jinja` do not collide across models.

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

Use the model scanner when GGUF files already exist under the selected target rig's model root. The scanner ignores unsafe symlinks and only returns supported model/companion file types.

After scanning, use `Create model` on the primary GGUF. The manager fills the managed model entry from that path so you do not need to copy the file into the Models form manually.

## Completed But Unconfigured Downloads

A completed download is not useful until a managed model entry references it. `Ready Downloads` shows completed jobs that are not configured yet. Use `Create Managed Model` so the manager can infer files, role, ttl, and defaults. This is the bridge the app is meant to automate.

Dashboard only shows the action state: active downloads, failed downloads, completed-but-unconfigured downloads, and config blockers. The detailed queue lives on Import Model, where `Clear Finished` removes completed, failed, and cancelled job history without deleting model files.

# Backlog

## Next

- Persist Hugging Face cache outside the container so interrupted downloads can resume across container recreates.
- Add a queue cleanup action for completed, failed, and cancelled jobs.
- Add disk-space checks before starting a download and show the estimate in the import flow.
- Add validation that selected multipart GGUF shards include every required shard.

## Done

- Add byte-level Hugging Face download progress instead of only job-stage progress.
- Add a per-job progress bar to the Download Queue.

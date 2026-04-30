# Backlog

## Next

- High priority: remove the manual gap between downloading a model and managing it. A completed download should immediately offer or create a guided managed-model setup with inferred name, role, primary GGUF, companion mmproj/template files, GPU defaults, command defaults, and config preview readiness. The user should not have to look up paths or manually copy downloaded file paths into Models.
- Move the full Download Queue off Dashboard. Dashboard should only show active download summaries, failures, or warnings; the detailed queue/history belongs on Import Model or a dedicated Downloads page.
- Make completed downloads clearly become usable model assets. Show the saved file paths for completed jobs, add a "Create model from download" action, and/or auto-fill a managed model draft after download completion so users can see where the model was installed.
- Persist Hugging Face cache outside the container so interrupted downloads can resume across container recreates.
- Add a queue cleanup action for completed, failed, and cancelled jobs.
- Add disk-space checks before starting a download and show the estimate in the import flow.
- Add validation that selected multipart GGUF shards include every required shard.

## Done

- Add byte-level Hugging Face download progress instead of only job-stage progress.
- Add a per-job progress bar to the Download Queue.

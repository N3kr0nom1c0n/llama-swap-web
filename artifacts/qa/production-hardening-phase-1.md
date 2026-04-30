# Production Hardening Phase 1 Evidence

Date: 2026-04-30

Branch: `codex/production-hardening`

Scope:

- Atomic HF token file writes and token redaction checks.
- Safe Hugging Face nested download paths, collision checks, symlink/path traversal rejection, job cleanup, disk preflight, and live `max_parallel_downloads` updates.
- Config backup listing and restore API/UI.
- Managed Models editor fixes for list textareas, numeric flags, and `--n-gpu-layers` command preview.
- README, in-app Help, and docs/wiki updates for production operation, backup/restore, settings, and workflows.
- Container smoke coverage for config backups after apply.

Commands:

```bash
./.venv/bin/pytest backend/tests -q
```

Result: `119 passed in 1.80s`

```bash
npm test
```

Result: `8 passed`, `15 passed`

```bash
npm run build
```

Result: Vite production build passed.

```bash
bash scripts/secret-scan.sh
```

Result: passed with no secret findings.

```bash
git diff --check
```

Result: passed.

```bash
docker compose -f compose.example.yml config
```

Result: passed.

```bash
docker build -t llama-swap-web:production-phase1 .
```

Result: passed.

```bash
BASE_URL=http://127.0.0.1:8092 QA_ARTIFACT_DIR=artifacts/qa SMOKE_BACKUPS_DIR=/tmp/lsm-prod2-backups SMOKE_CONTAINER=llama-swap-web-prod1 bash scripts/container-smoke.sh
```

Result: passed.

```bash
ALLOW_E2E_MUTATIONS=1 BASE_URL=http://127.0.0.1:8092 npm run e2e -- --project=chromium
```

Result: `7 passed`

Notes:

- The first Playwright run found a strict locator issue in the config preview smoke test because the seeded model ID correctly appeared in the scope list, generated YAML, and diff. The test now targets the model-scope checkbox by accessible name and the rerun passed.
- Docker and Playwright commands were run outside the Codex sandbox because Docker Desktop socket access and Chromium launch are blocked by the local sandbox.

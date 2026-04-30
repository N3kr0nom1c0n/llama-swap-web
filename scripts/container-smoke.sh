#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8081}"
QA_ARTIFACT_DIR="${QA_ARTIFACT_DIR:-artifacts/qa}"
SMOKE_BACKUPS_DIR="${SMOKE_BACKUPS_DIR:-}"
SMOKE_CONTAINER="${SMOKE_CONTAINER:-}"

mkdir -p "${QA_ARTIFACT_DIR}"

for attempt in {1..30}; do
  if curl -fsS "${BASE_URL}/api/health" > "${QA_ARTIFACT_DIR}/health.json"; then
    break
  fi
  if [ "${attempt}" -eq 30 ]; then
    if [ -n "${SMOKE_CONTAINER}" ] && command -v docker >/dev/null 2>&1; then
      docker logs "${SMOKE_CONTAINER}" --tail 200 > "${QA_ARTIFACT_DIR}/docker.log" 2>&1 || true
    fi
    exit 1
  fi
  sleep 2
done

curl -fsS "${BASE_URL}/api/state" > "${QA_ARTIFACT_DIR}/state.json"
curl -fsS "${BASE_URL}/api/gpus/detect" > "${QA_ARTIFACT_DIR}/gpus-detect.json"
curl -fsS "${BASE_URL}/api/config/import-candidates" > "${QA_ARTIFACT_DIR}/config-import-candidates.json"
curl -fsS -o "${QA_ARTIFACT_DIR}/settings.html" "${BASE_URL}/settings"

curl -fsS -X POST "${BASE_URL}/api/models" \
  -H "Content-Type: application/json" \
  -d '{"id":"qa-ci-smoke","display_name":"QA CI Smoke","role":"chat","source_type":"manual","hf_url":"","hf_revision":"main","manager_files":[],"container_files":["/models/chat/smoke/smoke.gguf"],"primary_model_file":"/models/chat/smoke/smoke.gguf","mmproj_file":"","chat_template_file":"","tokenizer_files":[],"aliases":[],"ttl":300,"gpu_devices":[0],"main_gpu":0,"tensor_split":"1","llama_flags":{"ctx_size":2048,"cache_type_k":"q4_0","cache_type_v":"q4_0","flash_attn":"on","jinja":true,"no_mmap":true},"raw_cmd_override":"","matrix_key":"qcismoke","matrix_behavior":"with_support","matrix_expression":"","evict_cost":null,"startup_preload":false}' \
  > "${QA_ARTIFACT_DIR}/seed-model.json"

curl -fsS -X POST "${BASE_URL}/api/config/preview" \
  -H "Content-Type: application/json" \
  -d '{}' \
  > "${QA_ARTIFACT_DIR}/config-preview.json"

stage_id="$(python3 - "${QA_ARTIFACT_DIR}/config-preview.json" "${QA_ARTIFACT_DIR}/generated-config.yaml" <<'PY'
import json
import sys
from pathlib import Path

preview = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
if not preview.get("valid"):
    raise SystemExit(f"config preview was invalid: {preview.get('errors')}")
yaml_text = preview.get("yaml") or ""
if "/models/chat/smoke/smoke.gguf" not in yaml_text:
    raise SystemExit("generated config does not reference the smoke model under /models")
if "groups:" in yaml_text:
    raise SystemExit("generated config emitted legacy groups")
Path(sys.argv[2]).write_text(yaml_text, encoding="utf-8")
print(preview["stage_id"])
PY
)"

curl -fsS -X POST "${BASE_URL}/api/config/apply" \
  -H "Content-Type: application/json" \
  -d "{\"stage_id\":\"${stage_id}\",\"confirm_destructive\":false}" \
  > "${QA_ARTIFACT_DIR}/config-apply.json"

if [ -n "${SMOKE_BACKUPS_DIR}" ]; then
  find "${SMOKE_BACKUPS_DIR}" -maxdepth 1 -type f -name 'config*.yaml' -print | sort > "${QA_ARTIFACT_DIR}/backup-list.txt"
  test -s "${QA_ARTIFACT_DIR}/backup-list.txt"
fi

if [ -n "${SMOKE_CONTAINER}" ] && command -v docker >/dev/null 2>&1; then
  docker exec "${SMOKE_CONTAINER}" id -u > "${QA_ARTIFACT_DIR}/container-uid.txt"
  test "$(cat "${QA_ARTIFACT_DIR}/container-uid.txt")" = "10001"
  docker logs "${SMOKE_CONTAINER}" --tail 200 > "${QA_ARTIFACT_DIR}/docker.log" 2>&1 || true
fi

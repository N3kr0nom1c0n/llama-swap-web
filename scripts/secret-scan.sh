#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

REAL_HF_TOKEN='hf_[A-Za-z0-9]{30,}'
TOKEN_ASSIGNMENT='HF_TOKEN=[[:space:]]*hf_[A-Za-z0-9]{30,}'

paths=()
for candidate in README.md docs backend frontend scripts Dockerfile compose.example.yml .github; do
  if [[ -e "$candidate" ]]; then
    paths+=("$candidate")
  fi
done

files=()
if [[ ${#paths[@]} -gt 0 ]]; then
  while IFS= read -r file; do
    case "$file" in
      backend/tests/*|frontend/e2e/*|frontend/src/*.test.*|*/__tests__/*)
        continue
        ;;
    esac
    files+=("$file")
  done < <(git ls-files --cached --others --exclude-standard -- "${paths[@]}")
fi

if [[ ${#files[@]} -eq 0 ]]; then
  exit 0
fi

matches="$(grep -InE "$REAL_HF_TOKEN|$TOKEN_ASSIGNMENT" "${files[@]}" || true)"

if [[ -n "$matches" ]]; then
  printf 'Real-looking Hugging Face token detected outside allowed test fixtures:\n%s\n' "$matches" >&2
  exit 1
fi

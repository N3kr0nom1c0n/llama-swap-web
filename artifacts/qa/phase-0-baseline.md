# Phase 0 Baseline

Date: 2026-04-30

Branch: `codex/production-hardening`

Commit: `1dd9774`

Runtime versions:

- Docker Server: `29.2.1`
- Node: `v25.8.1`
- npm: `11.11.0`
- Python: `3.14.4`

Baseline commands:

```bash
./.venv/bin/pytest backend/tests -q
```

Result: `102 passed in 1.54s`

```bash
npm test
```

Result: `6 passed`, `12 passed`

```bash
npm run build
```

Result: Vite production build passed.

Docker availability:

```bash
docker version --format '{{.Server.Version}}'
```

Result: `29.2.1`

Notes:

- Docker socket access requires elevated execution from the Codex sandbox on this machine.
- Release checklist still has path-safety and secret-safety marked partial at this baseline.

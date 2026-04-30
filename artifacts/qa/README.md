# QA Artifacts

This directory is the collection point for local and CI release QA outputs.

- `artifacts/qa/playwright/html/` contains the Playwright HTML report.
- `artifacts/qa/playwright/junit.xml` contains the Playwright JUnit report for CI.
- `artifacts/qa/playwright/test-results/` contains Playwright screenshots, videos, and traces retained on failure.
- `scripts/container-smoke.sh` writes endpoint and apply evidence such as `health.json`, `state.json`, `gpus-detect.json`, `config-preview.json`, `generated-config.yaml`, `config-apply.json`, `backup-list.txt`, `container-uid.txt`, and `docker.log`.

Run browser smoke tests against a running app or container:

```sh
ALLOW_E2E_MUTATIONS=1 BASE_URL=http://127.0.0.1:8081 npm run e2e -- --project=chromium
```

Only set `ALLOW_E2E_MUTATIONS=1` against a disposable test target because the smoke suite creates a QA model entry.

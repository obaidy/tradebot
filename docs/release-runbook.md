# Release Runbook

## Cadence
- Target deployment window: Tuesdays at 14:00 UTC.
- Freeze window: changes merged after Monday 18:00 UTC roll into the following release.
- Hotfixes may use this workflow with an explicit `release_tag` noted as `hotfix-YYYYMMDD`.

## Pipeline Overview
1. Trigger **Release Pipeline** (`.github/workflows/release.yml`) via GitHub `Workflow dispatch`.
2. Provide `release_tag` (e.g., `v0.7.0`) and choose whether to auto-promote to live.
3. Monitor the jobs:
   - *Lint / Test / Build* — installs dependencies, runs lint, unit tests, and a production build against a Postgres service.
   - *Walk-Forward Regression* — executes every strategy config under `configs/walkforward/` and stores JSON summaries in `reports/releases/<release>/walkforward/`.
   - *Paper Canary Deploy* — runs `npm run deploy:paper` in paper mode. Results are recorded in `reports/releases/<release>/paper-canary.json` and uploaded as an artefact.
   - *Promote Live* (optional) — requires manual environment approval. The job reads the canary summary and runs `npm run deploy:live` only if the canary succeeded.

## Automated Gates
- The live promotion always checks `paper-canary.json` for `status: "passed"` before running.
- The Production environment in GitHub Actions must have at least one approver configured.
- Timeouts (`CANARY_TIMEOUT_MS`, `LIVE_DEPLOY_TIMEOUT_MS`) default to 10 minutes and can be overridden if a longer soak is required.

## Release Checklist
1. Confirm all priority issues for the milestone are closed or deferred.
2. Run `npx tsc --noEmit`, `npm test`, and `npm run walkforward` locally when feasible.
3. Trigger the Release Pipeline with the planned `release_tag`.
4. Validate walk-forward artefacts (download from workflow run) and capture key metrics for the release notes.
5. Review paper canary logs for anomalies (latency spikes, guard rejections, etc.).
6. Approve the production environment when ready for live promotion.
7. After live promotion completes, verify `live-deploy.json` and production telemetry dashboards.
8. Publish release notes to clients (see template below) and archive the workflow artefact URLs.

## Release Notes Template
Create a markdown file in `docs/release-notes/` named `<release_tag>.md` using the template in `docs/release-notes-template.md`, then share it with clients via the customer portal or email list.

## Artefact Storage
- Generated reports live under `reports/releases/<release>/` during the workflow run. A GitHub Actions artefact is uploaded for each stage so the history remains accessible even though the directory is git-ignored.
- Copy summaries (`paper-canary.json`, `live-deploy.json`, walk-forward reports) into the client portal if long-term retention outside GitHub is required.

## Rollback Guidance
- If the paper canary fails, resolve the root cause before re-running the workflow. Do **not** override the gate.
- If the live deploy fails after running, the job status and `live-deploy.json` capture the error message. Fix the issue, re-run from the `Promote Live` job, and document the incident in the next release notes.

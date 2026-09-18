# Installation and User Runbook

## First-time setup

1. Install the approved tool versions listed in `docs/14_FREE_LOCAL_SETUP.md`.
2. Open Auto3Dvideo and select a project workspace.
3. Run the dependency health check.
4. Choose `mock` or `local` execution profile.
5. Import the example workflow and run a dry run.
6. Run the fixture before importing personal media or enabling cloud providers.

## Daily workflow

```text
open project
  → inspect blocked jobs and health
  → create episode/video
  → fill brief and style bible
  → prepare references and rights records
  → create/approve shot plan
  → dry run
  → enqueue approved local/cloud jobs
  → review outputs
  → compose and validate delivery
  → export/archive
```

## Recovery shortcuts

| Symptom | Action |
|---|---|
| App opens but tool unavailable | Open health screen, verify configured path/version |
| Job stuck running | Inspect lease/process/log, reconcile before retry |
| ComfyUI unavailable | Start local service, run health check, keep job blocked until ready |
| Blender render failed | Read stderr, inspect output directory and retry only after input/tool fix |
| FFmpeg output invalid | Re-run probe, inspect codec/profile and preserve failed evidence |
| Disk low | Pause queue, archive/delete only approved disposable cache |
| Budget exceeded | Stop paid jobs and review reservations before changing cap |
| Rights unknown | Mark asset blocked; do not publish or retry generation as a workaround |

## Project backup

Use the app's backup operation before large changes. A backup should be restorable into a new workspace and should include metadata, contracts, workflow versions and evidence. Generated media inclusion is an explicit choice.

## Upgrade policy

Upgrade one dependency at a time in a branch or copied project. Run the fixture workflow, contract tests, process tests and a visual smoke test before updating the project lock or default tool version.

## Uninstall

Uninstalling the app must not delete project workspaces by default. A separate purge workflow requires confirmation and states exactly which media, cache, logs and credentials references will be affected.

# Observability and Recovery Policy

## Observability goals

A user should understand what the automation is doing, why it is waiting or blocked, what it cost, what output it produced and how to recover after a crash. Logs are for diagnosis; the event log is the source for state history.

## Correlation fields

```text
project_id
episode_id
shot_id
run_id
job_id
attempt_id
workflow_id
workflow_version
provider
model
stage
status
started_at
finished_at
duration_ms
estimated_cost_usd
actual_cost_usd
error_code
```

## Event types

| Event | Meaning |
|---|---|
| `job_created` | Logical job entered the graph |
| `job_queued` | Dependencies and policy are ready |
| `job_started` | Worker acquired a lease and began execution |
| `job_progress` | Bounded progress update |
| `job_output_detected` | Worker found output candidate |
| `job_succeeded` | Output passed validation |
| `job_failed` | Job failed with normalized reason |
| `job_reconciled` | Unknown external state was resolved |
| `approval_requested` | Human decision is needed |
| `approval_recorded` | Decision was stored |
| `delivery_created` | Delivery package was assembled |

## Health checks

The health screen checks Blender path/version, FFmpeg path/version, ComfyUI loopback endpoint, SQLite writeability, project disk space, GPU visibility and configured provider capabilities. A missing tool is shown as `BLOCKED` with a repair suggestion.

## Recovery procedure

```text
stop new jobs
  → inspect active leases
  → inspect child processes
  → query provider status if applicable
  → validate existing outputs
  → mark recovered/safe-to-retry/blocked
  → resume only after policy check
```

Never delete a project or clear a queue to hide a failure. Recovery actions produce audit events. A stale lease has an expiry and an owner; reassigning it is explicit.

## Retention

Project owners configure retention for logs, intermediate outputs, previews and delivery evidence. Rights, approval and cost evidence must be retained as long as the delivery decision depends on them. A purge records scope and completion.

## Telemetry privacy

Telemetry is local-only by default. If optional diagnostics are enabled, the UI lists fields before sending and excludes paths, prompts, filenames, voice content, image content, tokens and personal data unless separately consented.

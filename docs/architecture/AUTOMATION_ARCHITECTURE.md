# Automation Architecture

## System role

Auto3Dvideo is a desktop control plane for a durable, inspectable media job graph. The user submits a versioned workflow definition; the runner expands it into jobs; workers execute only allowlisted capabilities; the UI observes state and presents approval points.

```text
Brief
  → Planning jobs
  → Reference/asset jobs
  → Generation jobs
  → 3D/render jobs
  → Media processing jobs
  → QA jobs
  → Approval gate
  → Delivery jobs
```

## Execution boundaries

| Boundary | Owns | Must not own |
|---|---|---|
| UI | Commands, forms, previews, status and approvals | Long-running generation, direct secrets or arbitrary shell |
| Rust core | Domain state, job graph, process supervision and filesystem policy | Creative judgment or unvalidated provider output |
| Local runner | ComfyUI/Blender/FFmpeg invocation, logs and artifacts | User-facing business decisions |
| Provider adapter | Provider request/response normalization | Global project state or unbounded retries |
| External tool | Specialized generation, 3D or media transformation | Auto3Dvideo rights, budgets or approval policy |
| Reviewer | Creative, rights, safety and publish decisions | Hidden changes outside evidence |

## Job lifecycle

```text
DRAFT
  → READY
  → WAITING_APPROVAL
  → QUEUED
  → RUNNING
  → SUCCEEDED
  → INGESTING
  → REVIEW_REQUIRED
  → APPROVED
  → DELIVERED
```

Terminal failure states are `FAILED`, `CANCELLED`, `BLOCKED`, `EXPIRED` and `SKIPPED`. A job may retry only when its retry policy allows it and the operation is idempotent or has a unique attempt key.

## Job state invariants

| Invariant | Rule |
|---|---|
| Identity | `job_id` is stable; each attempt has an `attempt_id` |
| Ownership | A job belongs to one project, episode and optional shot |
| Dependencies | A job cannot run until declared dependencies succeed or are explicitly skipped |
| Idempotency | Re-running the same logical input does not duplicate accepted output |
| Cancellation | Cancellation is requested cooperatively and recorded even if a process needs termination |
| Retry | Backoff and maximum attempts are explicit; no infinite retry |
| Output | Success requires output existence, type, size and integrity checks |
| Evidence | Prompt, workflow version, tool/model version and timestamps are persisted |
| Budget | Paid jobs cannot enter RUNNING without an approved budget decision |
| Approval | Publish/delivery cannot proceed while required review is pending |

## Trigger modes

| Trigger | MVP behavior |
|---|---|
| Manual command | Run one workflow from a project folder |
| Desktop button | Create a run and place it into the local queue |
| Folder drop | Optional watcher creates a draft project, never publishes automatically |
| Schedule | Post-MVP; local scheduler with a visible enable/disable state |
| Webhook | Post-MVP; requires verified provider support and authenticated endpoint |
| Agent command | Preview and approval first; writes are scoped to the selected project |

## Concurrency model

The runner has separate concurrency budgets for CPU processes, GPU jobs, network requests, filesystem transforms and paid provider calls. A default local profile should run one GPU-heavy job at a time, a small number of CPU transforms, and a bounded number of network requests. Concurrency values are configuration, not hard-coded assumptions.

## Queue algorithm

Jobs are selected by dependency readiness, explicit priority, resource availability and age. The runner writes a lease with heartbeat and expiry. On restart, expired leases become recoverable candidates; a job is not automatically retried if its external side effect is unknown without an idempotency key or output reconciliation.

## Dry run

Every workflow supports a dry run that resolves inputs, validates dependencies, estimates cost and prints the planned graph without starting paid generation, Blender, ComfyUI or publish operations. Dry run is the default for agent-generated workflow edits.

## Process supervision

External processes are started through a structured command specification:

```json
{
  "executable": "blender",
  "args": ["--background", "scene.blend", "--python", "render.py"],
  "cwd": "project/jobs/SHOT-001",
  "timeout_seconds": 3600,
  "stdout_log": "logs/SHOT-001.stdout.log",
  "stderr_log": "logs/SHOT-001.stderr.log"
}
```

The runner resolves the executable from an allowlist, rejects shell metacharacters, normalizes paths, limits environment variables, captures logs and validates output files. The UI must show the exact safe command summary without exposing secrets.

## Recovery

Recovery is explicit and evidence-based. The runner checks the job lease, process state, output files, checksums and external provider status before deciding whether to resume, reconcile, retry or block. A restart must not duplicate a paid request or overwrite an approved output silently.

## Observability

Each run emits structured events with `run_id`, `job_id`, `attempt_id`, `stage`, `status`, duration, bytes, provider/model, cost estimate/actual, error code and redacted message. Logs must never contain API keys, bearer tokens, raw sensitive prompts or unredacted personal data.

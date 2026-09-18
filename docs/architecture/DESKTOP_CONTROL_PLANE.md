# Desktop Control Plane Design

## Responsibility

The desktop app is the operator console and local coordination boundary. It creates/opens project workspaces, displays job state, provides previews, configures tools, requests approvals, and starts safe runner commands. It does not run heavy generation on the UI thread and does not treat an editor's internal project file as the canonical production database.

## UI surfaces

| Surface | Purpose |
|---|---|
| Home | Recent projects, health status, active jobs and blocked actions |
| Project | Episodes, videos, progress, delivery status and project settings |
| Brief | Audience, objective, language, duration, platform and policy flags |
| Style/References | Style bible, character/object/environment references and rights status |
| Shot board | Ordered shots, prompt versions, outputs, review state and retries |
| Job monitor | Queue, active processes, logs, resource use, cost and recovery actions |
| Asset browser | Search/filter, preview, metadata, hash, provenance and versions |
| Timeline | Internal timeline, markers, captions, audio and export variants |
| Review | Side-by-side preview, checklist, comments, approve/reject/block |
| Delivery | Output manifest, checksums, subtitles, thumbnails and handoff |
| Settings | Tool paths, GPU profile, provider credentials handles, budgets and feature flags |

## UI state rules

A long-running action returns a job ID immediately. The UI observes events and can close/reopen without losing state. Buttons are disabled when the state machine disallows an operation. A failed job exposes retry/reconcile options instead of hiding the error. The P0 Jobs surface can inspect persisted attempt metadata, while process start, lease claiming and reconciliation remain disabled until the native worker is verified.

## Tauri command boundary

Commands are typed and narrow:

```text
project_create
project_open
project_backup
job_preview
job_enqueue
job_cancel
job_retry
job_reconcile
asset_import
asset_reveal
tool_health_check
approval_record
delivery_validate
```

The current P0 Tauri command names are intentionally explicit and include `enqueue_pending_job`, `prepare_pending_attempt`, `start_mock_attempt`, `list_job_attempts`, `list_attempt_outputs`, `list_audit_events`, `list_tool_readiness`, `save_tool_config`, `preview_process`, `retry_job` and `cancel_job`. `enqueue_pending_job` validates the project and recipe, then persists a `queued` job without starting a worker. `prepare_pending_attempt` persists only a `pending` attempt plus validated expected-output metadata; it does not claim a lease, spawn a process or change a job to `running`. `start_mock_attempt` is the first supervised vertical slice: it claims a lease, writes heartbeats and runs a deterministic in-process task, while explicitly keeping `processStarted=false` and never resolving or spawning an external executable. The architectural `job_reconcile` command remains future work until the external worker boundary is enabled.

A command receives validated IDs and structured arguments. It never receives an arbitrary shell command or a raw path intended to bypass project-root checks. `list_audit_events` is read-only, bounded to 100 rows, and exposes event metadata without returning payload JSON or credential values. `list_tool_readiness`, `save_tool_config`, `worker_preflight` and `preview_worker_launch` handle only allowlisted tool IDs and path/name references; readiness checks file/PATH metadata, preflight returns blockers/checks, and the launch preview resolves attempt metadata without claiming a lease or starting a process. The deterministic mock command is separate from this external-tool gate and exists only to test durable state transitions and cancellation evidence.

## Native capability policy

Filesystem access, shell process execution, credential access and network requests are separate capabilities. The default app has the minimum capability set. A feature requiring more access declares why, which code owns it, how it is tested and how it can be disabled.

## Responsive behavior

The UI should remain usable during generation and render. Preview thumbnails are lazy-loaded. Large asset folders are virtualized or paged. Logs stream with backpressure. The app should surface disk and GPU pressure before the machine becomes unresponsive.

## Accessibility and localization

The app uses semantic theme tokens and supports light/dark/system mode. All actions have keyboard access and visible focus. User-facing messages use stable translation keys; backend/job errors expose stable codes with localized presentation in the UI.

## Boundary with editors

The app can reveal an output in Explorer or open it with a configured editor. It does not rely on simulated clicks or an editor being open to complete deterministic operations.

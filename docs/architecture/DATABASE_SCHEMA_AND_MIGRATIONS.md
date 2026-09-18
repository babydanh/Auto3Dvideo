# Database Schema and Migrations

## Purpose

SQLite is the durable local source of truth for project metadata, job state, approvals, rights evidence, costs and audit events. Media binaries remain files; the database stores paths, hashes, metadata and relationships.

## Initial logical tables

| Table | Responsibility | Stable identifier |
|---|---|---|
| `projects` | Project settings, policy profile and workspace root | `project_id` |
| `episodes` | Optional grouping of videos | `episode_id` |
| `videos` | A requested output and delivery profile | `video_id` |
| `shots` | Ordered creative units and versions | `shot_id` |
| `assets` | Source, generated, 3D and media assets | `asset_id` |
| `jobs` | Durable unit of work and state transition metadata | `job_id` |
| `job_attempts` | Retry and provider/process evidence | `attempt_id` |
| `timelines` | Frame-based edit representation | `timeline_id` |
| `timeline_items` | Clips, audio, captions and markers | `timeline_item_id` |
| `deliveries` | Candidate output variants and validation results | `delivery_id` |
| `rights_records` | Ownership, license, permission and review status | `rights_record_id` |
| `cost_events` | Estimate, reservation, receipt and reconciliation | `cost_event_id` |
| `audit_events` | Append-only operational and approval history | `audit_event_id` |

## Migration rules

Migrations are append-only, numbered and transactionally applied. A migration must be idempotent at the runner level, but its SQL should be applied once and recorded in a `schema_migrations` table. Destructive changes require a backup, a reversible plan or a versioned export and explicit approval.

The current implementation adds `0002_execution_attempts.sql`. It creates `job_attempts` for attempt number, lease/heartbeat timestamps, cancellation and termination evidence, bounded log counters, redacted error state and the `external_side_effect_unknown` flag. It also creates `job_outputs` for relative output paths, hashes, sizes and validation state. The migration is registered in the native initializer and covered by the Python SQLite smoke test; live worker writes remain disabled until native compilation passes.

## Compatibility

The app records schema version, contract version and workflow version separately. A project must be opened in read-only mode when the app cannot safely migrate it. Unknown fields should be preserved when possible; unknown enum states must block execution rather than being silently coerced.

## Concurrency

SQLite access is serialized behind one application repository boundary. Long-running media work never holds a transaction open. Job claiming uses a short transaction, lease expiry and reconciliation after restart. WAL mode may be enabled after testing backup and network-folder behavior on Windows.

## Attempt lifecycle invariants

An attempt is unique by `(job_id, attempt_number)`. The attempt record must be created before a worker starts, must not exceed the parent job's maximum attempts, and must retain cancellation or expiry evidence even when termination is incomplete. A `reconciliation_required` state is used when an application restart leaves external side effects uncertain; it is not an automatic success or retry.

## Backup and recovery

A project backup includes SQLite database, workflow/config snapshots, rights evidence, audit export and a manifest of media paths/hashes. Cache and regenerable previews are excluded unless requested. Restore is a new workspace operation first; in-place overwrite requires explicit user confirmation.

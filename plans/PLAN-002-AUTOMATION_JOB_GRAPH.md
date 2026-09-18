# PLAN-002 — Automation Job Graph

## Objective

Define a durable, inspectable graph that turns a video brief into independent jobs with explicit inputs, outputs, dependencies, resource requirements, retry policy, cost policy and approval state.

## Canonical stages

| Stage | Input | Output | Default execution |
|---|---|---|---|
| `brief.normalize` | User brief | Normalized brief JSON | Local deterministic |
| `script.draft` | Brief, source notes | Script draft | Local LLM or approved provider |
| `style.define` | Brief, references | Style bible | Human/LLM-assisted |
| `shots.plan` | Script, style bible | Shot list | Local deterministic + review |
| `references.prepare` | Assets, prompts | Reference bundle | Local image/asset processing |
| `ai.generate` | Shot + references | Raw clip/image | ComfyUI or cloud adapter |
| `asset.ingest` | Raw output | Versioned asset | Local deterministic |
| `scene.build` | Asset set, scene spec | `.blend`/GLB scene | Blender worker |
| `render.preview` | Scene spec | Preview frames/video | Blender worker |
| `media.compose` | Approved clips/audio | Draft MP4 | FFmpeg |
| `caption.generate` | Script/audio | SRT/VTT | Local ASR/LLM or human |
| `delivery.package` | Approved media/evidence | Delivery folder/manifest | FFmpeg + filesystem |
| `publish.prepare` | Delivery package | Platform-ready package | Local deterministic |
| `publish` | Approved package | External post | Manual first; API later |

## Graph rules

A job declares `job_type`, `schema_version`, `input_refs`, `dependency_ids`, `resource_class`, `priority`, `idempotency_key`, `timeout_seconds`, `retry_policy`, `approval_policy`, `cost_policy` and `output_contract`.

A graph is valid only when every input is resolvable, every dependency is acyclic, every output path is inside the project workspace, every external process is allowlisted, and every paid job has a budget decision.

## Idempotency

The idempotency key is derived from project ID, stage, semantic input hashes, workflow version and relevant configuration. A retry reuses the same logical key but receives a new attempt ID. The runner reconciles existing outputs before issuing an external request again.

## Retry classes

| Class | Example | Policy |
|---|---|---|
| `safe-local` | JSON validation, thumbnail, metadata | Retry up to 2 times |
| `process-transient` | Blender/FFmpeg process crash | Retry once after log review |
| `network-transient` | Provider timeout/429 | Exponential backoff, bounded attempts |
| `paid-unknown` | Request sent but response lost | Reconcile by provider job ID before retry |
| `human-decision` | Rights, safety or quality issue | Never auto-retry; block for review |
| `deterministic-invalid` | Schema/path/contract error | Fail fast until input changes |

## Resource scheduling

The runner maintains resource pools for `gpu`, `cpu_heavy`, `io_heavy`, `network`, `paid_api` and `interactive`. A local GPU default is one heavy job at a time. Resource limits can be changed per hardware profile but must be visible in settings and evidence.

## Approval points

Approval is required before paid generation when the budget policy says so, before importing unknown custom nodes, before applying destructive filesystem changes, before using third-party likeness/voice and before publishing externally. A preview is not an approval; the approval event records actor, timestamp, decision, scope and evidence.

## Implementation sequence

1. Build the state machine and schema validation with a mock executor.
2. Persist jobs and events in SQLite.
3. Add process executor with a fake binary fixture.
4. Add FFmpeg deterministic worker.
5. Add Blender worker.
6. Add ComfyUI local adapter.
7. Add cloud provider adapters one at a time.
8. Add UI and agent preview/approval commands.

## Exit criteria

The graph runner can restart after interruption, avoid duplicate outputs on retry, show a useful failure reason, respect a budget guard, execute the local fixture end-to-end and export a complete evidence record.

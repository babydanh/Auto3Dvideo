# PLAN-001 — Local-First AI 3D Video Studio MVP

## Outcome

Deliver a Windows desktop application that can create a project, accept a structured video brief, maintain a shot list and asset library, run a local or mocked generation workflow, process media through deterministic jobs, and produce a reviewable delivery package. The MVP is a reliable production coordinator, not a complete 3D modeling suite.

## Product boundary

The MVP owns project metadata, workflow state, prompt/reference versions, job orchestration, logs, cost estimates, rights records, approval states and delivery manifests. It delegates image/video generation to provider adapters, true 3D tasks to Blender, media processing to FFmpeg, and final manual polish to Kdenlive or DaVinci Resolve.

The MVP does not own a full mesh modeling kernel, sculpting system, character rigging suite, physics engine, compositing replacement, cloud collaboration service or automatic platform publishing.

## User journey

```text
Create project
  → define episode/video
  → enter brief
  → generate or edit script
  → define style bible and references
  → create shot list
  → run local/mock workflow
  → inspect previews and logs
  → approve or retry shots
  → compose delivery variants
  → review rights/disclosure evidence
  → export package
```

## MVP acceptance criteria

| Area | Acceptance criterion |
|---|---|
| Project | A project can be created, reopened and backed up from a local folder |
| Brief | A brief has audience, objective, language, duration, aspect ratio and safety notes |
| Shot list | Each shot has prompt, duration, references, status, output and review notes |
| Assets | Assets have stable IDs, provenance, file hash, type, dimensions and rights status |
| Jobs | Jobs are persisted, resumable, cancellable, idempotent and bounded by timeout/retry |
| Local path | A fixture workflow runs without a paid provider using mock/ComfyUI/Blender/FFmpeg adapters |
| 3D | A GLB/GLTF asset can be previewed and a Blender job can be queued or mocked |
| Delivery | The app exports MP4, thumbnail, subtitle, metadata, rights record and manifest |
| Safety | Secrets are excluded from logs and arbitrary shell commands are rejected |
| Review | Publish/export is blocked when required evidence or approval is missing |

## Milestones

### M0 — Contracts and fixture

Create JSON schemas, example workflow, safe defaults, sample media references and validator fixtures. No provider credentials are required.

### M1 — Desktop shell

Create the Tauri shell, React UI, routing, theme, project picker, settings and local workspace initialization. Add a health screen for installed dependencies.

### M2 — Project and job state

Implement SQLite migrations, project/episode/shot/asset/job repositories, state transitions, event log, queue monitor and recovery on restart.

### M3 — Local AI graph

Connect to ComfyUI through a local-only adapter. Import/export API workflow JSON, inject approved parameters, submit jobs, poll status and ingest outputs. Provide a mock adapter for CI.

### M4 — Blender and media

Run allowlisted Blender background jobs and Python scripts. Validate output paths and logs. Use FFmpeg for deterministic concat, audio mux, subtitle and platform variant generation.

### M5 — Review and delivery

Add preview-first approval, rights/provenance ledger, cost ledger, disclosure record, delivery manifest, archive and recovery actions.

## Non-functional targets

| Concern | MVP target |
|---|---|
| Startup | The UI opens without blocking on model discovery or large asset scans |
| Responsiveness | Long jobs never run on the UI thread |
| Reliability | Restarting the app preserves job state and never silently marks a running job successful |
| Security | Only allowlisted local processes and configured provider hosts can be called |
| Reproducibility | Every output records workflow version, prompt version, model/provider, inputs and timestamps |
| Accessibility | Keyboard navigation, focus visibility, contrast and reduced motion are tested |
| Cost | Paid provider calls require an estimate and configurable budget guard |
| Portability | Project folder can be copied and restored without hidden absolute-path assumptions |

## Exit decision

The MVP is ready for pilot when the example 3D product explainer completes from brief to delivery package twice: once through the mock/local path and once through the real local tools available on the user's machine. Cloud provider integration remains optional until rights, cost, API reliability and account access are verified.

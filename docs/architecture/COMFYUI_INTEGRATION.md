# ComfyUI Integration

## Role

ComfyUI is a local graph executor for AI image/video workflows. Auto3Dvideo owns the project, shot, asset, budget, rights, approval and evidence model. ComfyUI owns graph execution and model-specific nodes.

## Connection policy

The initial integration supports a local loopback endpoint only, such as `http://127.0.0.1:<port>`. The app must not accept arbitrary remote ComfyUI URLs without an explicit authenticated remote mode. The native Settings surface now has a bounded `GET /system_stats` health check for loopback endpoints; it performs no workflow submission, prompt upload or custom-node installation. A future submit path must health-check the endpoint before a job is submitted.

## Workflow registry

Each graph has:

```text
workflow_id
workflow_version
source_path
sha256
required_nodes
required_models
input_bindings
output_bindings
license_notes
last_validated_at
```

The registry rejects a graph when required nodes/models are unknown, the file hash changes without version update, or the output binding cannot be validated.

## Parameter binding

Use explicit namespaced bindings rather than positional edits:

```json
{
  "prompt": "nodes.12.inputs.text",
  "negative_prompt": "nodes.13.inputs.text",
  "seed": "nodes.22.inputs.seed",
  "width": "nodes.22.inputs.width",
  "height": "nodes.22.inputs.height",
  "frames": "nodes.22.inputs.frames",
  "fps": "nodes.22.inputs.fps",
  "input_image": "nodes.08.inputs.image"
}
```

The binding layer validates type, range and path before submitting. User-provided prompt text is data, never executable code.

## Job flow

```text
loopback health check
  → load graph
  → validate required models/nodes
  → apply typed bindings
  → compute graph hash
  → submit prompt/job
  → persist provider job ID
  → poll queue/status
  → collect outputs
  → validate media
  → ingest asset
```

## Implemented image-reference path

The current PLAN-023 slice implements the image leg without opening a general
remote provider channel. `run_comfyui_image_generation` writes a typed
`comfyui-image-job` into the project run directory and supervises
`scripts/comfyui_image_worker.py` through the Rust allowlist. The worker clones
an API-format graph once per shot, applies only the approved prompt/negative
prompt/seed/width/height bindings, submits to the loopback `/prompt` endpoint,
polls `/history/<prompt_id>`, collects the first declared image output and writes
`comfyui-image-report.json` with graph hash, provider job ID, output hash and
task errors.

The UI invokes this path after the Blender semantic storyboard. Each successful
image is imported as a project asset with `comfyui_reference` provenance and
`rights=pending`; it is not treated as final video and is not uploaded to Google
Flow automatically. The Browser Flow handoff can then prefer one ComfyUI image
per shot, while upload/Generate/Download remains a separate capability and human
approval gate.

The supported starter graph is
`configs/comfyui-image-workflow-api.example.json`. A project must provide its
own copied API-format workflow and installed checkpoint; missing workflow,
missing node binding, missing model, timeout or missing output is `BLOCKED`.

## Output ingestion

The adapter accepts only outputs declared by the graph contract. Each output is copied or moved into a project-scoped directory with a stable asset ID, file hash, media metadata and generation evidence. A preview is generated separately; source outputs are never overwritten silently.

## Queue and cancellation

ComfyUI has its own queue. Auto3Dvideo keeps a parent job and reconciles the local state with the ComfyUI prompt/job ID. Cancellation is best effort and must be recorded. If the local process or connection disappears after submission, the runner first attempts status reconciliation before retrying.

## Custom node policy

Custom nodes are untrusted software. Installation requires explicit user approval, source/license record, version pin and a rollback path. The app must not install a node from a prompt URL or arbitrary repository without review. A workflow that references missing nodes is `BLOCKED`, not auto-fixed silently.

## Resource policy

Before submission, the app checks configured resolution, frame count, estimated memory profile, available disk and GPU policy. Local generation is one GPU-heavy job by default. The user can change concurrency only through visible settings.

## References

[1]: https://github.com/Comfy-Org/ComfyUI "ComfyUI official repository"
[2]: https://github.com/VelornLabs/velorn "Velorn ComfyUI integration case study"

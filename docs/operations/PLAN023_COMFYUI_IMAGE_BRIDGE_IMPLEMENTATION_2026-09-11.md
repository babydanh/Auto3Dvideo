# PLAN-023 — ComfyUI image reference bridge

## Status

`NEEDS_HUMAN_REVIEW`

This slice connects the existing project/session/shot workflow to a local ComfyUI
API-format image graph. It is the asset-generation leg of the intended pipeline:

```text
one prompt → shot plan → Blender semantic 3D preview
          → ComfyUI reference image per shot
          → Asset Library + hash/provenance/rights pending
          → Google Flow/Omni handoff (human-controlled provider step)
```

Blender remains the source of camera, scale, action direction, frame range and
continuity. ComfyUI does not replace Blender and does not render the final video;
it creates clean visual references that are attached to the matching shot.

## What changed

- Added `contracts/comfyui-image-job.schema.json` and
  `contracts/comfyui-image-report.schema.json` for typed image tasks, graph
  bindings, output hashes, task status and rights state.
- Added `scripts/comfyui_image_worker.py`. It is loopback-only, uses the ComfyUI
  HTTP API, submits one cloned graph per shot, polls `/history`, collects the
  first validated image output and writes a project-relative report.
- Added `scripts/test_comfyui_image_worker.py` and a Python syntax check.
- Added native command `run_comfyui_image_generation` behind the existing Rust
  external-process supervisor. The command validates project containment, task
  IDs, dimensions, roles, rights state, workflow path and loopback endpoint,
  then imports successful images into the Asset Library with SHA-256 provenance.
- Added a visible `Tạo asset ảnh ComfyUI local` action after Blender preview. The
  action is explicit and writes live activity; generated assets remain
  `rights=pending` and are not silently bound as final media.
- Added `configs/comfyui-image-workflow-api.example.json` as a safe API-format
  starter graph. It contains a placeholder checkpoint name that the user must
  replace with an installed ComfyUI checkpoint.
- Browser Flow/Omni handoff now prefers the generated ComfyUI still for each shot,
  then Gemini stills, then the Blender semantic board. It also labels the asset
  role as `comfyui_reference` in the durable Browser Flow workflow.

## Local setup

1. Start ComfyUI on `http://127.0.0.1:8188`.
2. Export an API-format workflow from ComfyUI and copy it into the active project
   at `.auto3dvideo/config/comfyui-image-workflow-api.json`.
3. Start from `configs/comfyui-image-workflow-api.example.json`, replace
   `REPLACE_WITH_CHECKPOINT.safetensors` with an installed checkpoint, and keep
   the standard node IDs or configure the five allowed bindings through the
   provider settings contract.
4. In the app, generate the shot plan, run `Dựng semantic storyboard`, review the
   Blender boards, then click `Tạo asset ảnh ComfyUI local`.
5. Review each imported image in Asset Library. Only after the rights/quality
   gate should the user prepare the Google Flow/Omni handoff.

The default path can be changed with `AUTO3DVIDEO_IMAGE_WORKFLOW_PATH` in the
bounded local environment configuration. The endpoint remains loopback-only by
policy; remote ComfyUI URLs are rejected.

## Safety and failure behavior

- The worker never invokes a shell, installs nodes, downloads models or accepts a
  remote URL.
- A missing ComfyUI process, missing checkpoint, invalid API graph, timeout or
  missing image output is reported as `blocked`/failed task evidence. It is never
  converted to a successful asset.
- Retries are bounded by the existing supervisor timeout. The generated report is
  retained under `.auto3dvideo/runs/<runId>/comfyui-images/`.
- Imported assets preserve the requested rights state and are explicitly marked
  for human review. No provider upload or paid video generation is started by this
  slice.
- Google Flow remains a browser handoff. The current BrowserMCP capability must
  expose the required tab/refs before any upload, Generate or Download action;
  the app must stop at a user gate when it does not.

## Validation evidence

- `python scripts/test_comfyui_image_worker.py`
- `python -m py_compile scripts/comfyui_image_worker.py`
- `cargo fmt --all -- --check`
- Rust check, frontend build and repository validator are required before release
  of this slice.

## Cost, rights and release status

ComfyUI local inference has no provider API charge, but it consumes local compute
and storage. Cloud/browser generation cost is not estimated or approved here.
Generated images are not publishable or monetizable by this implementation alone;
human review is still required for model/checkpoint license, prompt/output rights,
continuity quality, accessibility, platform policy and final release.

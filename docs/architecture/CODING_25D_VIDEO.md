# Coding 2.5D Video Architecture

## User intent and scope

Create prompt-driven 2.5D instructional videos inside Auto3Dvideo for LeetCode-style algorithm explanations and system design. Expand the input into a technically meaningful lesson, not generic cinematic filler. Repository implementation continues with Astra 6 at the user's request; runtime planning remains local-first and optionally uses the existing configured LLM gateway. No promise of universally best visuals, error-free generation, or legal clearance.

## Decision

Extend the existing script → reviewed render → FFmpeg/FFprobe delivery boundary with `visualMode: coding-25d`. Reuse installed Pillow and FFmpeg rather than installing multiple animation engines. Research Manim Community and Motion Canvas (MIT) and Remotion (conditional commercial license); they remain evaluated alternatives, not bundled dependencies. Original procedural graphics only; no scraped LeetCode statements, logos, third-party video/music, or executable model-generated code.

The local planner supports original lessons for Two Sum, binary search, sliding window, BFS, cache-aside, token-bucket rate limiting, queues and URL shortening. Parse supported input parameters and reject unsupported explicit parameters instead of substituting unrelated examples. A configured existing gateway may generate additional typed lessons; missing gateway, malformed or unsupported model output is a failure, not a successful fallback. All model-generated technical claims remain `needs_review`.

## Data flow and states

`prompt → bounded request → coding lesson + state snapshots → pending review → explicit render approval → validated frame sequence → MP4 → FFprobe + SHA-256 → succeeded_needs_review`.

On any input, path, render, process, cancellation, timeout or output validation failure, preserve evidence and fail. Do not publish or mark claims/rights approved automatically. Existing shot approval and process supervisor are retained.

## Script contract

Existing `video-script.schema.json` fields remain. Add:

- `visualMode: coding-25d`.
- `audioMode?: narrated | caption-only`. Existing videos default to narrated. Coding lessons default to caption-only, explicitly disclosed in UI and manifest; do not synthesize silence or claim audio exists.
- `codingLesson`: object containing `schemaVersion: 1.0.0`, `track: algorithm | system-design`, `topicKey`, `learningObjectives` (1..8 strings), `assumptions` (1..8 strings), `complexity` (string), `checks` (1..12 strings), `sources` (0..8 HTTPS source strings), `planner: local-catalog | configured-gateway`, `promptVersion: coding-25d-v1`.
- Every coding segment has `teachingScene`. Scene contains `kind: array | architecture | code | summary`, `code` (0..14 lines, each <=120 chars), `nodes` (0..12 objects `{id,label,column,row}`; columns 0..3, rows 0..2), `edges` (0..24 objects `{from,to,label}`), `states` (1..16 snapshots), `note` (<=400 chars).
- Each snapshot contains `label` (<=180 chars), `values` (0..16 integers bounded +/-1e9 or single-character strings for text windows), `activeIndices` (0..16 valid array indices), `variables` (0..6 `{name,value}` text pairs), `activeLine` (null or valid zero-based code line), `activeNodes` (0..12 existing node IDs), `activeEdges` (0..24 existing zero-based edge indices).

Unknown fields, non-finite timing, invalid indices, duplicate identities or dangling graph references fail. Code is displayed as text, never executed. Snapshot order is semantic; no RNG.

## Python interfaces

`scripts/coding_lesson.py` owns `is_coding_request(request: dict) -> bool`, `build_local_script(request: dict) -> dict`, `validate_coding_script(script: dict) -> list[dict]`, `gateway_messages(request: dict) -> list[dict]`, and `normalize_gateway_script(request: dict, payload: dict) -> dict`.

`scripts/local_script_worker.py` routes coding requests before legacy generic planning. Parent owns this change and the shared helper. Native runner deploys the helper beside both embedded workers.

`scripts/local_coding_25d_worker.py` owns `render_frame(width, height, segment, frame_index, frame_count) -> PIL.Image`, `run(workspace: Path, script_relative: str, output_relative: str, width: int, height: int) -> int`, and CLI arguments identical to `local_space_25d_worker.py`. Use `validate_coding_script` before creating any output. Emit `scenes[]` with `relativePath`, `framePattern`, `frameRate:30`, `frameCount`, `durationSeconds`, `width`, `height`, `animationMode:procedural-2.5d-coding`, `rightsStatus:generated-local`, `reviewState:needs_review`. Top-level `networkCallsMade:false`, `externalAssetsUsed:false`, `visualMode:coding-25d`.

## Visual requirements

1280×720 default for readable code; optionally accept 1920×1080 and 720×1280 through the worker. Native coding output is 1280×720/30fps. Keep text stable/readable. Layered background, contact shadows, extruded array/architecture nodes, eased pointer changes, code-line highlighting, and packet flow visualize actual snapshots. Array highlights move according to the trace, not decoration. Architecture packets traverse existing directed edges. Show narrative/caption, state label and key variables; avoid text clipping. Colors belong in a central semantic palette, not inline scattered literals. Cap at 12 segments, 30 seconds/segment, 180 seconds/video and 5400 frames. Cache fonts/backgrounds across frames.

## Execution safety

Rust embeds known Python workers/helper and launches only the existing configured Python/FFmpeg/FFprobe binaries through `run_external_process`. Structured arguments, bounded timeout, captured logs and cancellation remain mandatory. Input/output paths are canonicalized within workspace, including symlink containment. Never overwrite existing render outputs. Caption-only rendering skips TTS and records absent audio truthfully; narrated rendering uses existing OmniVoice validation. FFprobe verifies expected dimensions, frame rate, duration and streams for each mode. Record SHA-256 and review state. No new network provider, dependency install, paid generation or publish action.

## Acceptance

1. Two Sum with duplicates never reuses the same index; binary search terminates and represents not-found; sliding window maintains unique-window invariant; BFS marks on enqueue and visits each node once.
2. Cache-aside shows miss → store → cache-fill → hit, with stale/invalidation caveat; rate limiter never grants a request without a token; queue teaches at-least-once/idempotency; URL-shortener covers collisions/redirects and scope assumptions.
3. User prompt, objective, requested timing and input examples influence the script; unsupported explicit constraints fail or require gateway rather than silently drifting.
4. Invalid scene data/path/oversized output fails before successful artifact publication.
5. UI has coding presets and scene review; rendered output actually visualizes algorithm and architecture data. Existing Space/Flow paths remain unchanged.
6. Produce and inspect two real MP4 examples, algorithm and system design, with manifests/probes, and run Python contract/regression tests, Rust tests, frontend build and project validator. Narrated smoke is limited by local OmniVoice availability; do not claim it exercised.

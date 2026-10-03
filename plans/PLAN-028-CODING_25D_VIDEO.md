# Coding 2.5D Video Implementation Plan

> **For agentic workers:** Use subagent-driven-development for isolated renderer and native/UI slices, with the integration owner implementing the shared planner/contract. Skip build/lint/tests/formatters mid-flight; integration verification runs once after all slices are complete.

**Goal:** Create real prompt-driven educational algorithm and system-design 2.5D MP4s in Auto3Dvideo.

**Architecture:** Extend the existing local video pipeline with a typed, data-only teaching-scene contract. Local lessons use real traces; additional lessons use the existing configured gateway with strict validation. Original Pillow graphics and the Rust process supervisor retain local execution and human review gates.

**Tech Stack:** Python 3.12+, installed Pillow, Rust/Tauri, React/TypeScript, FFmpeg/FFprobe. No additional runtime dependencies.

**Spec:** `docs/architecture/CODING_25D_VIDEO.md`

## Global Constraints

- `visualMode: coding-25d`; `audioMode: narrated | caption-only` with coding default caption-only, no fake audio.
- Native coding output 1280×720/30fps; worker also accepts 1920×1080 and 720×1280.
- 2..12 segments, 1..30 seconds/segment, total <=180 seconds and <=5400 frames.
- No external assets, new provider, paid call, arbitrary code execution, installation or publishing.
- Workspace-contained canonical paths, no silent overwrite, bounded supervised process execution and truthful manifests.
- Claims, creative quality, rights and delivery remain human-reviewed.
- Integration owner owns shared contract/helper, docs, examples and MANIFEST.json. Renderer and native/UI edits have distinct file ownership.

## Review Focus

- Duplicate array values must not reuse one index in Two Sum; test duplicate and no-solution traces.
- Unsupported user-specified datasets/constraints must not be replaced silently; test invalid and unsupported inputs.
- Dangling graph edges, bad code lines and invalid active indices must fail before frame output; test each boundary.
- Symlink/path escape and existing output must be rejected; test containment and overwrite failure.
- Caption-only output must have real visual frames and no claimed/synthesized audio; probe a real algorithm and architecture MP4.

## Task 1: Shared lesson planner and contract (integration owner)

**Files:** create `scripts/coding_lesson.py`, `scripts/test_coding_lesson.py`; modify `scripts/local_script_worker.py`, `contracts/video-script.schema.json`; create `contracts/coding-lesson.schema.json`, `configs/prompt-templates.coding-25d.json`.

**Interfaces:** Python and JSON signatures are exactly those in the spec. Existing script worker recognizes coding topics or coding profile/mode before generic planning. Renderer consumes validated snapshots; native runner embeds the helper.

- [x] Specify consumer-visible tests for trace correctness, input parameter precedence, timing, unsupported topic, gateway rejection and scene boundaries.
- [x] Implement original Two Sum, binary search, sliding window, BFS and four system-design lesson traces.
- [x] Route coding requests; preserve requested timing/hash/objective and approval pending. Known supported prompts remain no-network. Unsupported prompts use a configured allowlisted gateway or fail clearly. Do not read .env in the coding branch.
- [x] Add bounded data-only scene schema and reusable standard prompt with objectives, invariants, trace, edge cases, trade-offs and human review.

## Task 2: Deterministic 2.5D renderer

**Files:** create `scripts/local_coding_25d_worker.py`, `scripts/test_local_coding_25d_worker.py`.

**Consumes:** `coding_lesson.validate_coding_script` and the spec's `teachingScene` data. **Produces:** the existing scene-manifest/PNG frame sequence interface, with coding animation metadata.

- [x] Implement readable layered geometry, extrusion/shadows, semantic palette, cached fonts/backgrounds, state progression, pointers/highlights and moving architecture packets.
- [x] Guard path containment, existing outputs, size, duration/frame bounds and malformed snapshots before writing.
- [x] Add tests for semantic state selection, pointer/packet transitions and invalid scenes/paths. Integration owner runs them after implementation.

## Task 3: Native and desktop integration

**Files:** modify `desktop/src-tauri/src/local_video.rs`, `desktop/src/features/shared/scriptTypes.ts`, `desktop/src/features/topic/TopicWorkflowPanel.tsx` and necessary related topic types/styles; new focused helper files only if needed in these feature boundaries.

**Consumes:** embedded planner helper/renderer and canonical script contract. **Produces:** reviewed coding pipeline controls and real supervised MP4 export/manifest.

- [x] Deploy shared helper beside Python workers. Extend existing native allowlists and route coding scenes in active and legacy callers without changing existing Space/Flow behavior.
- [x] Implement truthful caption-only export through existing lifecycle/supervisor, avoiding OmniVoice prerequisite. Keep narrated existing path available; validate coding dimensions/streams/duration using FFprobe.
- [x] Add selectable coding presets, default local engine for coding, algorithm/system-design example prompts, typed scene review and audio-mode selection. Never overwrite coding-25d with space-25d on export.
- [x] Add behavioral native checks for rejected malformed scene/mode and caption-only stream validation. No incidental wording/source-string tests.

## Task 4: Integration verification and delivery

**Files:** original examples under `examples/coding-25d/`, workflow `workflows/example-coding-25d.yaml`, research `research/RESEARCH_CODING_ANIMATION_REPOS_2026-10-02.md`; update README, media architecture, CHANGELOG, MANIFEST and plan completion marks after smoke.

- [ ] Run Python tests for new components and local pipeline regressions; run native tests/build and frontend build.
- [ ] Exercise actual worker/FFmpeg path with algorithm and system design inputs. Inspect frames and FFprobe results, manifests/hashes, and failure refusal.
- [ ] Inspect actual frontend surface without simulating successful native commands; report native launch limits if unavailable.
- [ ] Run `python scripts/validate_project.py --project .` and record only observed results. Remove throwaway scripts, retain original examples/output evidence, and document OmniVoice limitation and rights/cost status.

## Execution decisions

The user requested action in this repository. Proceed with the conservative local-first design; do not ask for tool/repository-provided information or install animation/model dependencies. Research alternatives without importing their entire source trees. This preserves the requested coding-video behavior while avoiding license/toolchain bloat.

## Delivery record — 2026-10-03

- Planner: `python -m unittest discover -s scripts -p test_coding_lesson.py` -> 17 tests OK.
- Renderer: `python -m unittest discover -s scripts -p test_local_coding_25d_worker.py` -> 16 tests OK.
- Native: `cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib` -> 157 passed, 0 failed, 5 ignored, including the coding contract tests and the cancellation-token regression.
- Frontend: `pnpm run build` (`tsc && vite build`) passed; the existing >500 kB chunk warning is unchanged.
- Inventory: `python scripts/validate_project.py --project .` passed (557 physical files, 104 JSON, 18 YAML).
- Rendered evidence: `outputs/coding-25d/{two-sum,cache-aside}/scenes/` hold 960 and 1200 PNG frames at 1280x720, muxed to `master.mp4`, and the opt-in native smoke re-probes the supervisor output independently.
- Known pre-existing failures, unchanged by this work and confirmed by re-running the suite with the worker restored to HEAD: five errors in `test_local_pipeline_workers` from an undefined `cinematic_skill` in the generic gateway branch, and one failure in `test_flow_cinematic_directives_are_recorded_and_grounded`.
- Not exercised: narrated coding export (requires OmniVoice) and the Tauri window itself (requires a native launch).
- Defect found by running the real pipeline, not by inspection: the scene worker budget was a flat 180s, so a valid 960-frame lesson was killed mid-render (`Tạo scene chưa thành công: mã thoát Some(1)`) even though the worker itself finished in 185.4s with exit 0. `scene_timeout_seconds` now scales with the validated frame count (180s base, +1s per 4 frames, capped at 1800s) and `scene_process_request` takes that budget; the cancellation fix at the same call site is covered by `scene_process_request_carries_the_live_cancellation_token`.
- After the fix, `coding_25d_caption_only_render_native_smoke` passes end to end (152.91s) and the full Rust suite is 158 passed / 0 failed / 5 ignored.
- Rendered artifacts: `outputs/coding-25d/two-sum/master.mp4` (340,439 bytes, 32.000000s) and `outputs/coding-25d/cache-aside/master.mp4` (512,891 bytes, 40.000000s), both h264 1280x720, `r_frame_rate 30/1`, one video stream and no audio stream, matching the authored segment durations.

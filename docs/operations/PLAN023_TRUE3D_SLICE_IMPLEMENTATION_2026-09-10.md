# PLAN-023 True 3D Slice 0/1 — Implementation Evidence

Date: 2026-09-10  
Status: `NEEDS_HUMAN_REVIEW`

## Scope

This record covers the first bounded true-3D slice only:

- strict contracts for run, world, character, asset binding, scene manifest and shot production;
- a typed, deterministic Blender worker for one procedural tiger-vs-T-Rex shot;
- Rust external-process supervision and a Settings UI entry point;
- preview frames, full frame sequence, MP4 encode and quality evidence.

It does not claim a finished multi-shot hero-asset pipeline, provider image generation, voice alignment, or publishable output.

## Validation

All commands were run from `D:\Duancanhan\Auto3Dvideo` unless noted:

| Check | Result |
|---|---|
| `python scripts/test_true3d_scene_worker.py` | PASS — `TRUE3D_SCENE_WORKER_STATIC_VALID` |
| `python -m py_compile scripts/true3d_scene_worker.py` | PASS |
| `cargo check --manifest-path desktop/src-tauri/Cargo.toml --no-default-features` | PASS |
| `cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib` | PASS — 66 passed, 0 failed, 4 ignored |
| `pnpm build` in `desktop` | PASS |
| `python scripts/validate_project.py --project .` | PASS |
| Blender 5.2.1 preview fixture | PASS — 3 preview frames, scene `.blend`, manifest and quality report |
| Blender 5.2.1 full frame fixture | PASS — 120 frames at 30 FPS |
| FFmpeg 8.1.2 local encode | PASS — 4-second 512×288 H.264 MP4 |
| FFprobe media validation | PASS — H.264, 512×288, 30/1 FPS, 4.000000 seconds, 57,255 bytes |

## External smoke evidence

The fixed fixture output is outside the repository at:

`D:\Auto3DvideoTools\plan023-true3d-smoke\run-video\`

Observed evidence:

- `scene.blend` created successfully;
- `scene-manifest.json` reports Blender 5.2.1 LTS, `BLENDER_EEVEE`, 55 scene objects, 10 materials and frame range 1–120;
- assertions passed for camera, animated tiger, animated camera, T-Rex, mesh inventory, material inventory and frame range;
- `quality-report.json` is `passed_needs_review`;
- `true3d-preview.mp4` was encoded from the 120 rendered PNG frames;
- fixture declares no external assets and no network calls.

The worker also handles Blender installations that expose `BLENDER_EEVEE` instead of `BLENDER_EEVEE_NEXT`, and creates a world datablock when factory startup leaves `scene.world` empty.

## Review boundary

The result is deterministic procedural geometry used to prove the execution boundary. Human review is still required for silhouette quality, scale readability, motion, continuity, lighting, final resolution, creative suitability, rights and delivery policy. The current render is not marked publishable or monetizable.

## Next action

Open the running desktop app, go to Settings, run `Dựng shot true 3D preview`, inspect the three previews, then run `Render video true 3D local` if the preview is accepted. The next implementation slice is multi-shot continuity and asset binding, not an unrestricted prompt-to-Blender shell.

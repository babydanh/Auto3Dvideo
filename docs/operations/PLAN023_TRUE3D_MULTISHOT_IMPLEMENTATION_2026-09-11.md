# PLAN-023 Slice 2 — Multi-shot True 3D Continuity Evidence

Date: 2026-09-11  
Status: `NEEDS_HUMAN_REVIEW`

## Scope

Slice 2 adds a bounded eight-shot continuity fixture for the prehistoric giant tiger versus T-Rex topic. It uses one shared world bible, two shared procedural character assets, stable asset SHA-256 values, per-shot camera/action specs, per-shot manifests and a continuity report. It supports a selected-shot rerun with an optional baseline asset library comparison.

This is still a deterministic local fixture. It does not claim hero-quality modeling, provider-generated assets, voice/alignment, final MP4 composition or publishability.

## Implementation

- `contracts/multi-shot-continuity.schema.json` defines the strict continuity report.
- `examples/plan023-true3d/multishot-spec.json` defines the eight ordered shots.
- `scripts/true3d_multishot_worker.py` imports the versioned one-shot primitives, builds one shared Blender scene, renders preview frames per shot, writes asset library/bindings, shot manifests, scene manifest, quality report and drift report.
- Rust command `run_true3d_multishot_fixture` runs through the existing no-shell supervisor and validates expected outputs, shot count, drift findings and unchanged asset hashes.
- Settings now exposes `Dựng continuity 8 shot`, a shot ID field and `Chạy lại shot + kiểm asset hash`.

## Validation

| Check | Result |
|---|---|
| `python scripts/test_true3d_multishot_worker.py` | PASS — `TRUE3D_MULTISHOT_WORKER_STATIC_VALID` |
| `python -m py_compile scripts/true3d_multishot_worker.py` | PASS |
| Blender 5.2.1 all-shot fixture | PASS — 8 shots, 24 preview frames, 0 drift findings |
| Blender 5.2.1 rerun fixture | PASS — only `SHOT-004` rendered |
| Asset library comparison | PASS — asset hashes equal between all-shot and rerun outputs |
| Shot input comparison | PASS — `SHOT-004` input hash unchanged |
| Rust check | PASS |
| Frontend build | PASS |

External smoke output:

- all shots: `D:\Auto3DvideoTools\plan023-multishot-smoke\run-all-v2\`;
- rerun: `D:\Auto3DvideoTools\plan023-multishot-smoke\run-rerun-shot-004-v2\`;
- all-shot continuity report: `driftFindings=0`, `assetHashesUnchanged=true`;
- rerun continuity report: `renderedShotIds=["SHOT-004"]`, `assetHashesUnchanged=true`;
- all-shot output contains eight separate `shots/SHOT-xxx/scene.blend` files; rerun output contains one such file for `SHOT-004`.

## Safety and review boundary

The worker accepts typed JSON values only. Prompt strings are never executed as Python, PowerShell or shell commands. No network, credentials or external assets are used. Each run uses a new versioned output directory, so accepted outputs are not overwritten.

The rendered previews still require human review for composition, scale readability, character silhouette, camera grammar, animation quality, continuity, rights and delivery policy. The report remains `needs_review`.

## Next action

Run the new continuity button from Settings in the native app and inspect the eight shot previews. After that, Slice 3 can connect the real Asset Library quality/rights/normalize path; it must keep the distinction between sketch/reference image, 3D model, texture and render output.

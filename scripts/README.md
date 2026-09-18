# Automation Scripts Contract

The `scripts/` directory will contain deterministic developer and fixture utilities. Production execution belongs in the Rust runner after the desktop shell is initialized; Python scripts may support validation, fixture generation and Blender/FFmpeg helpers.

## Available commands

```powershell
python scripts/run_workflow.py --workflow workflows/example-local-free-pipeline.yaml --dry-run
python scripts/validate_project.py --project .
python scripts/validate_markdown_links.py --project .
python scripts/estimate_cost.py --seconds 5 --usd-per-second 0.00 --attempts 1 --shots 3
python scripts/test_migration.py --project .
python scripts/validate_recipe.py --recipe examples/minimal-3d-video/recipe.json
python scripts/test_job_state_machine.py
python scripts/test_process_spec.py
python scripts/test_media_plan.py
python scripts/test_tool_readiness.py
python scripts/validate_execution_attempt.py --attempt examples/minimal-3d-video/execution-attempt.json
python scripts/test_execution_attempt.py
python scripts/compile_worker_plan.py --workflow workflows/example-local-free-pipeline.yaml --output outputs/worker-plan.json
python scripts/validate_worker_plan.py --plan outputs/worker-plan.json
python scripts/test_compile_worker_plan.py
python scripts/test_antigravity_catalog.py
python scripts/validate_narrative_visual_plan.py --plan examples/minimal-3d-video/narrative-visual-plan.json --project .
python scripts/test_narrative_visual_plan.py
python scripts/test_frame_locked_caption_worker.py
python scripts/validate_asset_pack.py --pack examples/plan024-asset-pack/asset-pack.json --items examples/plan024-asset-pack/asset-items.json --report examples/plan024-asset-pack/asset-generation-report.json
python scripts/test_asset_pack_state.py
python scripts/test_validate_asset_pack.py
python scripts/asset_pack_planner.py --plan examples/plan024-asset-pack/muse-asset-plan.json --output-dir outputs/plan024-asset-pack
python scripts/test_asset_pack_planner.py
python scripts/test_asset_pack_mcp_worker.py
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check_windows_native.ps1
python scripts/test_mock_delivery.py
python scripts/validate_media_plan.py --plan examples/minimal-3d-video/media-plan.json
python scripts/report_tool_readiness.py --config configs/tool-paths.example.yaml
python scripts/validate_delivery.py --manifest outputs/mock-delivery/manifest.json
python scripts/build_mock_delivery.py --recipe examples/minimal-3d-video/recipe.json --output-dir outputs/mock-delivery

# Desktop UI preview
cd desktop
pnpm install
pnpm dev
```

## Script rules

Scripts must use explicit argument parsing, project-root containment, structured subprocess calls, bounded timeouts, non-zero exit codes on failure and redacted logs. They must not read `.env`, print credentials, run arbitrary command strings or download and execute untrusted artifacts.

## Script responsibilities

| Script | Responsibility |
|---|---|
| `run_workflow.py` | Development fixture runner and dry-run graph inspection; not the final production queue |
| `validate_project.py` | Validate project files, contracts, references, paths and delivery metadata |
| `estimate_cost.py` | Calculate a transparent estimate from caller-supplied rate and retry assumptions; it does not assert provider pricing |
| `test_migration.py` | Smoke-test the SQLite migration and foreign-key relationships using Python's in-memory SQLite |
| `validate_recipe.py` | Validate normalized recipe dimensions, timing, supported kind and P0 policy flags without starting workers |
| `test_job_state_machine.py` | Check happy-path, retry, cancellation and forbidden job transitions |
| `test_process_spec.py` | Check process executable allowlist, workspace-relative paths, timeout bounds, secret boundary and no-spawn invariant |
| `validate_media_plan.py` | Validate typed FFmpeg/FFprobe operation mapping, inputs/outputs, target media settings and P0 policy locks |
| `test_media_plan.py` | Check media operation mapping, path safety, raw-filter boundary, timeout and policy locks |
| `report_tool_readiness.py` | Report configured local tool availability without executing binaries or probing network endpoints |
| `test_tool_readiness.py` | Check required-tool detection and no-side-effect readiness reporting |
| `validate_execution_attempt.py` | Validate attempt state semantics, leases, cancellation/termination evidence, output hashes and secret-safe messages |
| `test_execution_attempt.py` | Check pending/running/succeeded lifecycle, reconciliation guard, cancellation evidence and output path safety |
| `compile_worker_plan.py` | Compile a workflow fixture into pending stage/attempt evidence without shell commands or process/network side effects |
| `validate_worker_plan.py` | Validate worker-plan stage mappings, dependency graph, pending attempts and side-effect locks |
| `test_compile_worker_plan.py` | Check workflow mapping, dependency cycles, publish/raw-command rejection, malformed stage IDs and compiled-plan round trip |
| `check_windows_native.ps1` | Read-only Windows native prerequisite diagnostic for Cargo/Rustup, MSVC/link.exe, C:/D: space and optional local tools; never installs or executes workers |
| `test_antigravity_catalog.py` | Check the Antigravity task catalog locale, locked side-effect defaults and command shape without executing commands |
| `validate_narrative_visual_plan.py` | Validate ordered narration spans, contiguous frame timing, entity identity anchors, visual-proof/prompt grounding, safe output paths and paid/publish/network locks without generating media |
| `test_narrative_visual_plan.py` | Check valid visual-plan fixture plus sequence, coverage, continuity, grounding, path, raw-command and policy rejection cases |
| `build_mock_delivery.py` | Build metadata/checklist/manifest evidence only; refuses overwrite and never creates media or starts workers |
| `test_mock_delivery.py` | Check manifest hashes, blocked policy state, overwrite protection and output path containment |
| `validate_delivery.py` | Verify manifest schema fields, file hashes, package containment and rights/disclosure status gates |
| `frame_locked_caption_worker.py` | Convert aligned segment/word ranges into an integer-frame caption plan and derived SRT; refuses overlap, unsafe paths and overwrite |
| `test_frame_locked_caption_worker.py` | Check frame timing, word containment, overlap rejection, path safety and overwrite protection |
| `validate_asset_pack.py` | Validate asset-pack/item/report schemas, identity anchors, scale references, prompt secret boundary, rights/review gates and count consistency without provider execution |
| `asset_pack_state.py` | Pure Asset Pack state-transition table used by validation and future native orchestration |
| `test_asset_pack_state.py` | Check Asset Pack happy path, failure path, immutable IDs and forbidden transitions |
| `test_validate_asset_pack.py` | Check a reviewable asset pack plus identity, secret-prompt and premature-approval rejection cases |
| `asset_pack_planner.py` | Compile structured Muse bible/asset intent into per-item prompts and a review-gated Asset Pack without provider execution |
| `test_asset_pack_planner.py` | Check deterministic per-item prompt grounding, duplicate item rejection and scale-reference rejection |
| `asset_pack_mcp_worker.py` | Run Asset Pack image tasks through the allowlisted Nano Banana MCP server in dependency order, with bounded retry and output hashing |
| `test_asset_pack_mcp_worker.py` | Fake-MCP loopback test for dependency order, retry evidence, output dimensions/hash and cycle rejection |

| `desktop/src-tauri/src/lib.rs` | Native command boundary, local mock/durable fixture state, typed no-spawn process preview and deterministic NarrativeVisualPlan preview; general production media execution remains gated |
| `desktop/src-tauri/src/process_executor.rs` | Validate structured process specs and return metadata-only dry-run plans; never spawns a process in P0 |

## Mechanism Explainer

`mechanism_explainer_worker.py` nhận một `mechanism-explainer.schema.json` event graph local-only, kiểm tra dependency/frame timing/policy rồi render frame sequence procedural gồm 2D motion, 2.5D parallax và pseudo-3D minh họa. Worker tạo `scene-manifest.json` và `captions.srt`; nó không tải social media, không gọi provider và không thay thế Blender true 3D.

```powershell
python scripts/mechanism_explainer_worker.py --plan outputs/cement-mechanism-demo/mechanism-plan.json --output-dir outputs/cement-mechanism-demo/render
python scripts/test_mechanism_explainer_worker.py
```

## Moon story true-3D pilot

`true3d_moon_story_worker.py` tạo scene Blender procedural local-only cho pilot Mặt Trăng, gồm persistent Earth/Moon/satellite entities, camera animation, orbit helpers, six still previews và scene manifest. `render_moon_story_animation.py` chỉ nhận scene `.blend` và output directory relative tới workspace, sau đó render PNG sequence 540×960 ở 30 fps; tách bước PNG khỏi MP4 vì Blender 5.2.1 có hành vi không ổn định khi gán FFMPEG output sau khi load blend. `inspect_moon_scene.py` và `inspect_blender_render_api.py` là helper inspect/diagnostic bounded, không phải arbitrary script executor. `run_moon_story_subtitle_encode.cmd` là wrapper project-specific cho FFmpeg burn subtitle vào narration-composed MP4, không phải generic media-plan executor.

```powershell
python scripts/test_true3d_moon_story_worker.py
```

Test trên chỉ kiểm tra path containment và argument parsing, không cần Blender và không render 30 giây. Live render phải chạy qua executable Blender đã được user cấu hình/cho phép trên Windows; output final vẫn cần FFprobe và human review.

## Blender Quality Toolkit

`blender_quality_toolkit.py` is a bounded Blender-side quality toolkit. It supports `inspect`, `setup_lookdev`, `setup_camera` and one-frame `preview`. It reads only the versioned preset file `configs/blender-quality-presets.json`, checks workspace containment, records object/material/scale issues and writes `blender-quality-report.json` plus a versioned `.blend` for toolkit operations. It does not download assets, open network sockets or execute arbitrary prompt Python.

```powershell
python scripts/test_blender_quality_toolkit.py
blender.exe --background --python scripts/blender_quality_toolkit.py -- --operation preview --workspace D:\Duancanhan\Auto3Dvideo --scene outputs\<scene>\input.blend --output-dir outputs\<shot>\quality-preview --preset space_editorial_cinematic
```

`export_blender_reference_package.py` writes a local previs package containing scene/preview hashes, camera/motion intent, continuity notes and explicit analysis-only rights defaults. It is the only package that may later be handed to a browser/web generation flow, and upload remains a separate human approval.

```powershell
python scripts/test_export_blender_reference_package.py
python scripts/export_blender_reference_package.py --workspace D:\Duancanhan\Auto3Dvideo --scene outputs\shot\scene.blend --preview outputs\shot\preview.png --output-dir outputs\shot\reference-package --shot-id S01 --frame-start 1 --frame-end 30 --camera-intent "slow push-in" --motion-intent "hero reveal" --continuity-notes "keep asset identity and cyan rim"
```

The toolkit improves lighting, camera and validation discipline; it does not manufacture high-detail hero geometry. Detailed assets still require approved source/model generation, topology/UV cleanup, material review and multi-angle human approval.

## BrowserMCP Web Handoff

`browser_handoff_worker.py` tạo handoff pack local cho repo `browsermcp/mcp`: hash shot MP4/keyframe, ghi `handoff.json` và `prompt.txt` dưới workspace. Worker không kết nối Chrome, không đọc cookie, không upload, không bấm Generate và không gọi network. BrowserMCP server/Chrome extension là phần cài riêng theo tài liệu chính thức.

```powershell
python scripts/test_browser_handoff_worker.py
```

Native Tauri command `prepare_browser_handoff` gọi worker qua supervisor Python với path containment, timeout và output validation. UI Browser Handoff dừng trước upload/Generate để user tự kiểm tra và xác nhận.

## Implementation boundary

The first scripts may be Python for fast iteration. Once job leases, process trees, cancellation and native Windows integration are required, the production runner moves into Rust/Tokio. Python remains an approved helper for Blender scripts and deterministic media utilities.

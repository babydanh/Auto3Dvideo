# Blender Quality Toolkit Implementation — 2026-08-27

## Status: NEEDS_HUMAN_REVIEW

## Mục tiêu

Triển khai bộ skill/worker Blender bounded để Auto3Dvideo không còn dựng scene bằng primitive ngẫu nhiên בלבד. Toolkit mới cung cấp quality inspection, preset lookdev versioned, lighting rig, camera setup, preview render và local previs reference package cho từng shot.

## Files changed

| File | Vai trò |
|---|---|
| `scripts/blender_quality_toolkit.py` | Bounded Blender toolkit với `inspect`, `setup_lookdev`, `setup_camera` và `preview`. |
| `scripts/test_blender_quality_toolkit.py` | Host-side deterministic tests, không import Blender và không launch process. |
| `scripts/export_blender_reference_package.py` | Tạo package local gồm scene/preview hash, camera/motion intent, continuity notes và rights gate. |
| `scripts/test_export_blender_reference_package.py` | Tests containment, hash và upload/reuse gate. |
| `configs/blender-quality-presets.json` | Preset `space_editorial_cinematic` và `studio_asset_validation`. |
| `docs/operations/BLENDER_QUALITY_SKILL_STACK.md` | Skill chain và MCP-safe macro surface. |
| `MANIFEST.json` | Inventory cho toolkit, config, tests và documentation. |

## Implemented capabilities

`asset_quality_check` hiện đo object inventory, vertex/polygon count, dimensions, transform scale, material presence, Principled node presence, roughness và metallic. Toolkit đánh dấu `MISSING_MATERIAL`, `NON_UNIFORM_SCALE` và `ZERO_DIMENSION` thay vì tự coi scene là đạt.

`pbr_material_lookdev`, `lighting_rig_setup` và `camera_language_setup` được gom vào preset-driven toolkit. Preset editorial đặt profile dọc 1080×1920/30 fps, AgX contrast, cyan key, blue fill, red rim, lens 52 mm, depth of field và camera safe-area metadata. Preset validation dùng profile vuông nhẹ hơn cho asset review.

`export_blender_reference_package.py` tạo package cho Blender previs trước khi đưa sang BrowserMCP/Google web. Package chứa SHA-256 của scene và preview, frame range, camera intent, motion intent, continuity notes và các khóa `analysisOnly=true`, `reuseOriginalMedia=false`, `uploadApproved=false`, `derivativeUseApproved=false`.

## Validation

Đã chạy thành công:

```text
python scripts/test_blender_quality_toolkit.py
BLENDER_QUALITY_TOOLKIT_TESTS_PASS=3

python scripts/test_export_blender_reference_package.py
BLENDER_REFERENCE_PACKAGE_TESTS_PASS=2

python -m py_compile scripts/blender_quality_toolkit.py scripts/export_blender_reference_package.py scripts/test_blender_quality_toolkit.py scripts/test_export_blender_reference_package.py

python scripts/validate_project.py --project .
AUTO3DVIDEO_PROJECT_VALID
```

Blender 5.2.1 LTS đã chạy integration preview thật trên `moon-story-pilot.blend` bằng preset `space_editorial_cinematic`, tạo `outputs/blender-quality-smoke-final/preview.png` 1080×1920 và `blender-quality-report.json`. Preview xác nhận lighting/camera/output profile hoạt động; visual review vẫn ghi nhận source Moon geometry còn đơn giản.

## Outputs

- `outputs/blender-quality-smoke-final/preview.png`
- `outputs/blender-quality-smoke-final/toolkit-scene.blend`
- `outputs/blender-quality-smoke-final/blender-quality-report.json`
- `outputs/blender-quality-smoke-final/visual-review.md`

Đây là technical smoke evidence, không phải social master hoặc publishable video.

## Cost and network

Không gọi cloud generation, không dùng BrowserMCP, không upload và không cài thêm model/repository. Blender chạy local; chi phí cloud là `not_called`. Preset và exporter không mở network socket.

## Rights and policy

Toolkit không tải asset tự động và không nhận arbitrary Python/shell từ prompt. External asset phải có provenance/license trong Asset Registry. Reference package mặc định chỉ là analysis-only; upload/generation web vẫn cần approval thủ công. Không clone creator voice/likeness, không reuse TikTok media và không tự động publish.

## Known limitations

Toolkit hiện là quality foundation, chưa phải full asset-generation system. Nó chưa tự tạo hero topology cao cấp, sculpt, retopology, UV unwrap hoàn chỉnh, texture baking, facial rig hoặc semantic vision review. Scene đẹp vẫn phụ thuộc model/texture được duyệt. MCP chưa được kết nối thực tế và Google web generation chưa được gọi.

Preview integration có cảnh báo deprecation của Blender về `World.use_nodes` và `Material.use_nodes` dự kiến thay đổi ở Blender 6.0; không phải lỗi runtime trên Blender 5.2.1.

## Next action

Bước tiếp theo là xây `asset_quality_check` thành worker Rust-bound hoặc command typed, sau đó thêm asset import/normalize có license record, multi-view preview, hero-asset lookdev và shot builder. Chỉ sau khi preview contact sheet đạt human review mới mở BrowserMCP handoff cho từng shot; không render video dài mù.

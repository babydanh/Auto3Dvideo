# Blender Quality Skill Stack

## Mục tiêu

Auto3Dvideo không dùng một prompt tự do để yêu cầu Blender tạo toàn bộ video. Agent phải đi qua các skill có output typed, preview và assertion. Blender là nguồn sự thật cho geometry, asset identity, camera layout và continuity; các model video web chỉ là lớp beauty/motion tùy chọn sau này.

## Skill chain

```text
brief_to_visual_spec
  -> asset_select_or_generate
  -> asset_quality_check
  -> topology_uv_scale_normalize
  -> pbr_material_lookdev
  -> lighting_rig_setup
  -> camera_language_setup
  -> shot_blockout
  -> animation_continuity
  -> preview_render
  -> deterministic_scene_assertions
  -> final_render
```

## Skill contracts

| Skill | Input | Required evidence | Failure state |
|---|---|---|---|
| `asset_quality_check` | Approved asset path + asset metadata | Polygon count, dimensions, scale, normals, material count, UV status, texture paths and provenance | `FAILED_ASSET_QUALITY` |
| `topology_uv_scale_normalize` | Immutable asset copy | Normalized scale, applied transforms, non-manifold report, UV report and new hash | `FAILED_NORMALIZE` |
| `pbr_material_lookdev` | Asset + versioned preset | Material names, node summary, roughness/metallic range and preview path | `FAILED_LOOKDEV` |
| `lighting_rig_setup` | Style Bible + shot intent | Key/fill/rim/world settings, contrast target and light inventory | `FAILED_LIGHTING` |
| `camera_language_setup` | Shot Graph + camera intent | Lens, framing, focus target, safe area and start/end transforms | `FAILED_CAMERA` |
| `shot_blockout` | Event Graph + approved assets | Scene path, object IDs, frame range and blockout thumbnail | `FAILED_BLOCKOUT` |
| `animation_continuity` | Ordered shots | Entity identity, direction, scale, color and frame handoff checks | `FAILED_CONTINUITY` |
| `preview_render` | Typed Blender Job | Exit code, expected files, dimensions, frame sequence and thumbnail contact sheet | `FAILED_OUTPUT_VALIDATION` |
| `deterministic_scene_assertions` | Scene + assertions | Actual measured scene state; vision is advisory only | `FAILED_ASSERTION` |

## Quality-first defaults

The default editorial preset uses Blender Eevee, a 9:16 working profile, AgX high contrast, a cyan key, blue fill and red rim, a 52 mm camera, depth of field and explicit caption safe areas. The preset is stored in `configs/blender-quality-presets.json`; changing it requires a versioned edit and preview review.

For hero assets, the agent should prefer approved high-quality assets or multi-view generated assets over primitive-only geometry. A generated asset must be cleaned, normalized, assigned materials, checked from multiple camera angles and recorded with source/model/prompt/license metadata before it can enter a shot.

## MCP-safe exposure

The future MCP surface should expose macro operations only:

- `inspect_scene_quality`
- `configure_lookdev_preset`
- `normalize_approved_asset`
- `build_shot_blockout`
- `render_preview`
- `assert_scene_quality`
- `export_reference_package`

Raw `execute_python`, arbitrary shell, arbitrary download and unrestricted external URL access must remain disabled in the Auto3Dvideo surface. The official Blender MCP documentation warns that generated code may execute without guards, so any experimental MCP connection must run in a disposable Blender workspace with no sensitive files.

## Definition of done for a beautiful shot

A shot is not complete because Blender produced a `.blend`. It needs an approved asset, valid topology/UV/material state, intentional lighting, camera/lens and focus, event-specific animation, continuity with adjacent shots, preview evidence and human review. A final render may then be passed to an optional Google Omni/Veo handoff as a reference package; generated web video remains a separate, approval-gated output and is never assumed to preserve Blender geometry exactly.

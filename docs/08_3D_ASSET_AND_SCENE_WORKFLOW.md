# 3D Asset and Scene Workflow

## Objective

Create predictable, reusable 3D assets and scenes for AI-assisted videos. The workflow uses AI for concept/reference acceleration and Blender for geometry, layout, camera and deterministic render when consistency matters.

## Asset intake

Every asset enters through an intake record containing source, owner, license, commercial use, derivative use, territory, platforms, hash, format, scale, dimensions and review status. Unknown rights block publish use.

## Normalization checklist

```text
stable asset ID
project-relative path
known file format
verified file hash
unit scale
origin and axes
naming convention
material/texture paths
polygon/vertex budget
LOD policy
license/provenance record
preview thumbnail
```

## Scene spec

A scene declares frame rate, resolution, color management, active camera, frame range, render engine, lighting profile, asset versions, environment and output pattern. It must be rebuildable from the scene file plus versioned scripts/configuration.

## AI integration

AI-generated images/videos are references or media assets unless explicitly converted into a true 3D asset and reviewed. Do not assume a generated image provides a clean mesh, correct topology, valid UVs or commercial rights. The asset record distinguishes `reference`, `generated_media`, `model3d`, `scene` and `render_output`.

## Continuity controls

Use a style bible and character/object bible. Freeze approved references for a shot batch. Record changes to palette, lens, lighting, wardrobe, geometry and camera. A continuity review must compare adjacent shots, not only individual clips.

## Scene build modes

| Mode | Description |
|---|---|
| Reference-only | AI video output with no Blender scene |
| Hybrid insert | AI clip is composited with deterministic text/UI/graphics |
| Blender scene | True 3D assets and camera rendered through Blender |
| Mixed episode | Some shots are AI clips, some are Blender renders, all normalized in FFmpeg |

## Exit criteria

A scene is ready for render when asset paths resolve, rights status is approved or explicitly scoped, active camera/frame range exist, output paths stay inside the project, and a preview has been reviewed.

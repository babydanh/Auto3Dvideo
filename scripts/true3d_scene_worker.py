"""Deterministic true-3D Blender worker for the first PLAN-023 slice.

The worker accepts a validated, project-relative scene spec and creates a real
Blender scene with mesh objects, materials, lights, camera animation and a
small preview image sequence. It is deliberately self-contained: no network,
credentials, external assets or arbitrary prompt-generated Python are used.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

import bpy
from mathutils import Vector


TOOL_VERSION = "true3d-scene-worker-1.0.0"
FPS = 30
FRAME_START = 1
FRAME_END = 120
WIDTH = 512
HEIGHT = 288


def safe_relative(raw: str) -> Path:
    value = raw.strip().replace("\\", "/")
    path = Path(value)
    if not value or path.is_absolute() or "://" in value or (len(value) > 1 and value[1] == ":"):
        raise ValueError("đường dẫn phải là relative path")
    if any(part in {"", ".", ".."} for part in value.split("/")):
        raise ValueError("đường dẫn không được chứa traversal hoặc empty segment")
    return path


def inside(root: Path, candidate: Path) -> Path:
    resolved_root = root.resolve()
    resolved = candidate.resolve()
    if resolved != resolved_root and resolved_root not in resolved.parents:
        raise ValueError("đường dẫn vượt project workspace")
    return resolved


def load_spec(workspace: Path, spec_arg: str) -> dict[str, Any]:
    spec_path = inside(workspace, workspace / safe_relative(spec_arg))
    payload = json.loads(spec_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("scene spec phải là JSON object")
    if payload.get("schemaVersion") != "1.0.0":
        raise ValueError("scene spec sai schemaVersion")
    if payload.get("jobType") != "scene.build":
        raise ValueError("scene spec phải có jobType=scene.build")
    if int(payload.get("fps", FPS)) != FPS:
        raise ValueError("fixture yêu cầu 30 FPS")
    return payload


def make_material(name: str, color: tuple[float, float, float, float], roughness: float = 0.55, metallic: float = 0.0) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    if principled is not None:
        principled.inputs["Base Color"].default_value = color
        principled.inputs["Roughness"].default_value = roughness
        principled.inputs["Metallic"].default_value = metallic
    return material


def assign(obj: bpy.types.Object, material: bpy.types.Material) -> bpy.types.Object:
    if hasattr(obj.data, "materials"):
        obj.data.materials.append(material)
    return obj


def smooth(obj: bpy.types.Object) -> bpy.types.Object:
    if hasattr(obj.data, "polygons"):
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    return obj


def parent(obj: bpy.types.Object, root: bpy.types.Object) -> bpy.types.Object:
    obj.parent = root
    return obj


def sphere(name: str, location: tuple[float, float, float], scale: tuple[float, float, float], material: bpy.types.Material, root: bpy.types.Object | None = None) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    assign(obj, material)
    smooth(obj)
    if root is not None:
        parent(obj, root)
    return obj


def cube(name: str, location: tuple[float, float, float], scale: tuple[float, float, float], material: bpy.types.Material, root: bpy.types.Object | None = None, bevel: float = 0.0) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    assign(obj, material)
    if bevel > 0:
        modifier = obj.modifiers.new("Soft bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 3
    if root is not None:
        parent(obj, root)
    return obj


def cylinder_between(name: str, start: Vector, end: Vector, radius: float, material: bpy.types.Material, root: bpy.types.Object | None = None) -> bpy.types.Object:
    direction = end - start
    if direction.length <= 0.001:
        raise ValueError(f"cylinder {name} có chiều dài rỗng")
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=radius, depth=direction.length, location=(start + end) / 2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    assign(obj, material)
    smooth(obj)
    if root is not None:
        parent(obj, root)
    return obj


def cone(name: str, location: tuple[float, float, float], radius: float, depth: float, material: bpy.types.Material, root: bpy.types.Object | None = None) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=radius, radius2=0.0, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    assign(obj, material)
    if root is not None:
        parent(obj, root)
    return obj


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_tiger(materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    root = bpy.data.objects.new("TIGER_ROOT", None)
    bpy.context.collection.objects.link(root)
    root["entity_id"] = "tiger-giant"
    root["height_meters"] = 8.0
    root["identity_anchor"] = "orange-black stripes, broad shoulders, white muzzle, amber eyes"
    body = sphere("TIGER_BODY", (0.0, -1.5, 2.75), (2.35, 1.15, 1.25), materials["tiger"], root)
    sphere("TIGER_CHEST", (1.6, -1.4, 3.0), (1.1, 1.0, 1.35), materials["tiger"], root)
    sphere("TIGER_HEAD", (2.65, -1.45, 4.1), (1.25, 0.95, 1.05), materials["tiger"], root)
    sphere("TIGER_MUZZLE", (3.62, -1.45, 3.9), (0.72, 0.62, 0.48), materials["white"], root)
    sphere("TIGER_NOSE", (4.15, -1.45, 4.0), (0.22, 0.28, 0.18), materials["dark"], root)
    sphere("TIGER_EYE_L", (3.28, -2.18, 4.35), (0.12, 0.08, 0.12), materials["eye"], root)
    sphere("TIGER_EYE_R", (3.28, -0.72, 4.35), (0.12, 0.08, 0.12), materials["eye"], root)
    cone("TIGER_EAR_L", (2.55, -2.05, 5.0), 0.38, 0.72, materials["tiger"], root)
    cone("TIGER_EAR_R", (2.55, -0.85, 5.0), 0.38, 0.72, materials["tiger"], root)
    for index, x in enumerate((-1.35, 1.2), start=1):
        for side, y in (("L", -2.15), ("R", -0.85)):
            cylinder_between(f"TIGER_LEG_{index}_{side}", Vector((x, y, 2.1)), Vector((x - 0.18, y, 0.65)), 0.34, materials["tiger"], root)
            sphere(f"TIGER_PAW_{index}_{side}", (x - 0.2, y, 0.48), (0.48, 0.34, 0.20), materials["dark"], root)
    tail_points = [Vector((-2.0, -1.45, 3.1)), Vector((-3.2, -1.4, 3.65)), Vector((-4.3, -1.05, 3.25)), Vector((-4.8, -0.7, 2.55))]
    for index in range(len(tail_points) - 1):
        cylinder_between(f"TIGER_TAIL_{index + 1}", tail_points[index], tail_points[index + 1], 0.22 - index * 0.035, materials["tiger"], root)
    for index, x in enumerate((1.0, 1.75, 2.4), start=1):
        stripe = cube(f"TIGER_STRIPE_{index}", (x, -2.58, 3.1 + 0.25 * index), (0.15, 0.05, 0.62), materials["stripe"], root, 0.03)
        stripe.rotation_euler[1] = math.radians(18 * index)
    root.location = (-4.0, 0.0, 0.0)
    root.keyframe_insert(data_path="location", frame=FRAME_START)
    root.location = (0.3, 0.0, 0.0)
    root.keyframe_insert(data_path="location", frame=75)
    root.location = (1.1, 0.0, 0.0)
    root.keyframe_insert(data_path="location", frame=FRAME_END)
    root.rotation_euler[2] = math.radians(-3)
    root.keyframe_insert(data_path="rotation_euler", frame=FRAME_START)
    root.rotation_euler[2] = math.radians(4)
    root.keyframe_insert(data_path="rotation_euler", frame=FRAME_END)
    return root


def add_trex(materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    root = bpy.data.objects.new("TREX_ROOT", None)
    bpy.context.collection.objects.link(root)
    root["entity_id"] = "trex"
    root["height_meters"] = 12.0
    root["identity_anchor"] = "dark red-brown scales, massive head, two-finger arms, heavy tail"
    sphere("TREX_BODY", (0.0, 2.0, 5.0), (3.3, 1.35, 3.4), materials["trex"], root)
    sphere("TREX_NECK", (2.0, 2.0, 7.3), (1.15, 1.0, 2.8), materials["trex"], root)
    sphere("TREX_HEAD", (3.0, 2.0, 9.5), (2.0, 1.25, 1.55), materials["trex"], root)
    cube("TREX_SNOUT", (4.6, 2.0, 9.15), (1.9, 1.1, 0.68), materials["trex"], root, 0.22)
    sphere("TREX_EYE", (3.85, 0.88, 9.85), (0.18, 0.12, 0.18), materials["eye"], root)
    for index, x in enumerate((-1.25, 1.1), start=1):
        cylinder_between(f"TREX_LEG_{index}", Vector((x, 2.0, 3.1)), Vector((x - 0.3, 2.0, 0.55)), 0.62, materials["trex"], root)
        sphere(f"TREX_FOOT_{index}", (x - 0.45, 1.75, 0.38), (0.95, 0.72, 0.36), materials["trex"], root)
    cylinder_between("TREX_TAIL_1", Vector((-2.0, 2.0, 4.5)), Vector((-5.2, 2.1, 3.1)), 1.0, materials["trex"], root)
    cylinder_between("TREX_TAIL_2", Vector((-5.1, 2.1, 3.1)), Vector((-8.4, 2.25, 2.1)), 0.62, materials["trex"], root)
    for side in (-1, 1):
        cylinder_between(f"TREX_ARM_{side}", Vector((2.2, 2.0 + side * 0.8, 7.0)), Vector((3.15, 2.0 + side * 0.9, 6.25)), 0.2, materials["trex"], root)
    root.location = (5.0, 0.0, 0.0)
    root.rotation_euler[2] = math.radians(180)
    root.keyframe_insert(data_path="rotation_euler", frame=FRAME_START)
    root.rotation_euler[2] = math.radians(176)
    root.keyframe_insert(data_path="rotation_euler", frame=FRAME_END)
    return root


def add_environment(materials: dict[str, bpy.types.Material]) -> None:
    cube("GROUND", (0.0, 0.0, -0.25), (22.0, 18.0, 0.25), materials["ground"], bevel=0.15)
    for index, location in enumerate(((-6, -3, 0.9), (-2, 5, 0.7), (7, 4, 1.1), (10, -3, 0.8)), start=1):
        sphere(f"ROCK_{index}", location, (1.4, 1.0, 0.9), materials["rock"])
    for index, (x, y, scale) in enumerate(((-8, 5, 1.5), (-5, 7, 1.2), (8, 7, 1.7), (11, 5, 1.3), (-10, -4, 1.8)), start=1):
        cylinder_between(f"TREE_TRUNK_{index}", Vector((x, y, 0.0)), Vector((x, y, 3.6 * scale)), 0.28 * scale, materials["trunk"])
        cone(f"TREE_CROWN_{index}", (x, y, 5.0 * scale), 1.5 * scale, 3.2 * scale, materials["foliage"])


def build_scene(workspace: Path, output_dir: Path, spec: dict[str, Any], render_video: bool) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    preview_dir = output_dir / "preview"
    preview_dir.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = "PLAN023_True3D_GiantTiger"
    scene.frame_start = FRAME_START
    scene.frame_end = FRAME_END
    scene.render.fps = FPS
    available_engines = {item.identifier for item in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
    for engine_id in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
        if engine_id in available_engines:
            scene.render.engine = engine_id
            break
    else:
        raise RuntimeError(f"No supported render engine available: {sorted(available_engines)}")
    scene.render.resolution_x = WIDTH
    scene.render.resolution_y = HEIGHT
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new("PLAN023_World")
    scene.world.color = (0.008, 0.016, 0.035)

    materials = {
        "tiger": make_material("MAT_TIGER_ORANGE", (0.72, 0.19, 0.035, 1), 0.68),
        "stripe": make_material("MAT_TIGER_STRIPE", (0.018, 0.008, 0.004, 1), 0.82),
        "white": make_material("MAT_TIGER_MUZZLE", (0.7, 0.52, 0.32, 1), 0.78),
        "dark": make_material("MAT_DARK", (0.012, 0.008, 0.006, 1), 0.5),
        "eye": make_material("MAT_EYE_AMBER", (1.0, 0.28, 0.015, 1), 0.2, 0.1),
        "trex": make_material("MAT_TREX_RED_BROWN", (0.18, 0.035, 0.018, 1), 0.86),
        "ground": make_material("MAT_GROUND", (0.035, 0.075, 0.025, 1), 0.95),
        "rock": make_material("MAT_ROCK", (0.09, 0.08, 0.065, 1), 0.98),
        "trunk": make_material("MAT_TREE_TRUNK", (0.12, 0.045, 0.018, 1), 0.92),
        "foliage": make_material("MAT_FOLIAGE", (0.015, 0.16, 0.045, 1), 0.88),
    }
    add_environment(materials)
    tiger = add_tiger(materials)
    trex = add_trex(materials)
    bpy.ops.object.camera_add(location=(17.0, -28.0, 11.5))
    camera = bpy.context.object
    camera.name = "CAMERA_MAIN"
    camera.data.lens = 48
    camera.data.sensor_width = 36
    look_at(camera, Vector((1.0, 0.0, 4.3)))
    camera.keyframe_insert(data_path="location", frame=FRAME_START)
    camera.keyframe_insert(data_path="rotation_euler", frame=FRAME_START)
    camera.location = (13.5, -23.0, 9.0)
    look_at(camera, Vector((1.5, 0.0, 4.2)))
    camera.keyframe_insert(data_path="location", frame=FRAME_END)
    camera.keyframe_insert(data_path="rotation_euler", frame=FRAME_END)
    scene.camera = camera

    bpy.ops.object.light_add(type="AREA", location=(2.0, -8.0, 15.0))
    key = bpy.context.object
    key.name = "LIGHT_KEY"
    key.data.energy = 2200
    key.data.shape = "DISK"
    key.data.size = 8
    look_at(key, Vector((1.0, 0.0, 3.0)))
    bpy.ops.object.light_add(type="AREA", location=(-10.0, 6.0, 9.0))
    fill = bpy.context.object
    fill.name = "LIGHT_FILL"
    fill.data.energy = 1000
    fill.data.color = (0.12, 0.32, 1.0)
    fill.data.size = 10
    look_at(fill, Vector((0.0, 0.0, 4.0)))
    bpy.ops.object.light_add(type="AREA", location=(12.0, 6.0, 8.0))
    rim = bpy.context.object
    rim.name = "LIGHT_RIM"
    rim.data.energy = 1300
    rim.data.color = (1.0, 0.19, 0.04)
    rim.data.size = 6
    look_at(rim, Vector((3.0, 0.0, 5.0)))

    assertions = [
        {"name": "camera_exists", "passed": scene.camera is camera, "message": "CAMERA_MAIN được gán làm camera render"},
        {"name": "animated_subject", "passed": tiger.animation_data is not None, "message": "TIGER_ROOT có animation keyframe"},
        {"name": "animated_camera", "passed": camera.animation_data is not None, "message": "CAMERA_MAIN có animation keyframe"},
        {"name": "trex_exists", "passed": trex.name == "TREX_ROOT", "message": "TREX_ROOT tồn tại"},
        {"name": "mesh_inventory", "passed": len([obj for obj in bpy.data.objects if obj.type == "MESH"]) >= 20, "message": "Scene có mesh inventory true 3D"},
        {"name": "material_inventory", "passed": len(bpy.data.materials) >= 8, "message": "Scene có material inventory"},
        {"name": "frame_range", "passed": scene.frame_end - scene.frame_start + 1 == FRAME_END, "message": "Frame range 1–120 ở 30 FPS"},
    ]
    if not all(item["passed"] for item in assertions):
        failed = ", ".join(item["name"] for item in assertions if not item["passed"])
        raise RuntimeError(f"deterministic scene assertions failed: {failed}")

    scene_path = output_dir / "scene.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(scene_path))
    preview_paths: list[Path] = []
    for frame in (FRAME_START, 60, FRAME_END):
        scene.frame_set(frame)
        path = preview_dir / f"frame-{frame:04d}.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        preview_paths.append(path)
    video_frame_dir = output_dir / "frames"
    if render_video:
        video_frame_dir.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(video_frame_dir / "frame_")
        bpy.ops.render.render(animation=True)

    relative = lambda path: path.relative_to(workspace).as_posix()
    manifest = {
        "schemaVersion": "1.0.0",
        "sceneId": "plan023-giant-tiger-vs-trex",
        "scenePath": relative(scene_path),
        "blenderVersion": bpy.app.version_string,
        "engine": scene.render.engine,
        "fps": scene.render.fps,
        "frameStart": scene.frame_start,
        "frameEnd": scene.frame_end,
        "cameraObject": camera.name,
        "objectInventory": sorted(obj.name for obj in bpy.data.objects if obj.type in {"MESH", "CAMERA", "LIGHT"}),
        "materialInventory": sorted(material.name for material in bpy.data.materials),
        "assetHashes": {},
        "assertions": assertions,
        "previewOutputs": [relative(path) for path in preview_paths],
        "reviewState": "needs_review",
        "fixture": {
            "projectId": spec.get("projectId"),
            "tigerHeightMeters": 8.0,
            "trexHeightMeters": 12.0,
            "externalAssetsUsed": False,
            "networkCallsMade": False,
        },
    }
    manifest_path = output_dir / "scene-manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    quality = {
        "schemaVersion": "1.0.0",
        "sceneId": manifest["sceneId"],
        "status": "passed_needs_review",
        "assertions": assertions,
        "previewOutputs": [relative(path) for path in preview_paths],
        "finalRenderAvailable": render_video,
        "message": "True 3D scene đã tạo mesh/material/camera/animation và render preview; cần review continuity/chất lượng.",
    }
    quality_path = output_dir / "quality-report.json"
    quality_path.write_text(json.dumps(quality, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {
        "status": "succeeded_needs_review",
        "scenePath": relative(scene_path),
        "manifestPath": relative(manifest_path),
        "qualityPath": relative(quality_path),
        "previewPaths": [relative(path) for path in preview_paths],
        "frameDirectory": relative(video_frame_dir) if render_video else None,
        "shotId": "SHOT-001",
        "frameRange": [scene.frame_start, scene.frame_end],
        "fps": scene.render.fps,
        "objectCount": len(manifest["objectInventory"]),
        "message": "Đã dựng một shot true 3D bằng Blender; output cần human review trước final delivery.",
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Auto3Dvideo deterministic true-3D scene worker")
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--spec", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--render-video", default="false")
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    parsed = parser.parse_args(argv)
    parsed.render_video = parsed.render_video.lower() == "true"
    return parsed


def main() -> int:
    try:
        args = parse_args()
        workspace = Path(args.workspace).resolve()
        output_dir = inside(workspace, workspace / safe_relative(args.output_dir))
        spec = load_spec(workspace, args.spec)
        result = build_scene(workspace, output_dir, spec, args.render_video)
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")), flush=True)
        return 0
    except Exception as error:
        print(json.dumps({"status": "failed", "message": f"{type(error).__name__}: {str(error)[:500]}"}, ensure_ascii=False), flush=True)
        return 2


if __name__ == "__main__":
    sys.exit(main())

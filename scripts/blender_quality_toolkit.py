"""Bounded Blender quality toolkit for Auto3Dvideo.

Run only from Blender background mode with a versioned job contract. This file
never downloads assets, opens sockets, or executes user-provided Python.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path
from typing import Any

try:
    import bpy  # type: ignore
except ImportError:  # pragma: no cover - normal host Python cannot import bpy
    bpy = None

TOOLKIT_VERSION = "1.0.0"
ALLOWED_OPERATIONS = {"inspect", "setup_lookdev", "setup_camera", "preview"}
ALLOWED_ENGINES = {"BLENDER_EEVEE", "BLENDER_CYCLES", "BLENDER_WORKBENCH"}
DEFAULT_PRESET = "space_editorial_cinematic"


def load_preset(workspace: str, name: str) -> dict[str, Any]:
    preset_path = workspace_path(workspace, "configs/blender-quality-presets.json", must_exist=True)
    presets = json.loads(preset_path.read_text(encoding="utf-8")).get("presets", {})
    if name not in presets:
        raise ValueError(f"unknown lookdev preset: {name}")
    return presets[name]


def workspace_path(workspace: str, candidate: str, *, must_exist: bool = False) -> Path:
    root = Path(workspace).resolve()
    path = (root / candidate).resolve() if not Path(candidate).is_absolute() else Path(candidate).resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise ValueError("path escapes project workspace") from exc
    if must_exist and not path.exists():
        raise FileNotFoundError(str(path))
    return path


def validate_args(args: argparse.Namespace) -> None:
    if args.operation not in ALLOWED_OPERATIONS:
        raise ValueError(f"unsupported operation: {args.operation}")
    if args.engine not in ALLOWED_ENGINES:
        raise ValueError(f"unsupported engine: {args.engine}")
    if args.frame_start < 1 or args.frame_end < args.frame_start:
        raise ValueError("invalid frame range")
    workspace_path(args.workspace, args.scene, must_exist=args.operation != "setup_camera")
    workspace_path(args.workspace, args.output_dir)
    if args.output_dir == "." or args.output_dir == "":
        raise ValueError("output_dir must be an explicit project-relative directory")


def material_signature(material: Any) -> dict[str, Any]:
    nodes = getattr(material, "node_tree", None)
    principled = None
    if nodes:
        principled = next((n for n in nodes.nodes if n.type == "BSDF_PRINCIPLED"), None)
    return {
        "name": material.name,
        "use_nodes": bool(material.use_nodes),
        "principled": bool(principled),
        "base_color": list(principled.inputs["Base Color"].default_value) if principled else None,
        "roughness": float(principled.inputs["Roughness"].default_value) if principled else None,
        "metallic": float(principled.inputs["Metallic"].default_value) if principled else None,
    }


def inspect_scene() -> dict[str, Any]:
    objects = []
    issues = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        dimensions = [float(v) for v in obj.dimensions]
        non_uniform = max(obj.scale) - min(obj.scale) > 1e-4
        materials = [material_signature(m) for m in obj.data.materials if m]
        if not materials:
            issues.append({"object": obj.name, "code": "MISSING_MATERIAL"})
        if non_uniform:
            issues.append({"object": obj.name, "code": "NON_UNIFORM_SCALE"})
        if any(v <= 1e-6 for v in dimensions):
            issues.append({"object": obj.name, "code": "ZERO_DIMENSION"})
        objects.append({
            "name": obj.name,
            "vertices": len(obj.data.vertices),
            "polygons": len(obj.data.polygons),
            "dimensions": dimensions,
            "location": [float(v) for v in obj.location],
            "scale": [float(v) for v in obj.scale],
            "materials": materials,
        })
    scene = bpy.context.scene
    return {
        "toolkitVersion": TOOLKIT_VERSION,
        "scene": scene.name,
        "engine": scene.render.engine,
        "resolution": [scene.render.resolution_x, scene.render.resolution_y],
        "fps": scene.render.fps,
        "frameRange": [scene.frame_start, scene.frame_end],
        "objects": objects,
        "issues": issues,
        "qualityState": "needs_review" if issues else "pass",
    }


def ensure_principled(name: str, base: tuple[float, float, float, float], roughness: float,
                      metallic: float = 0.0, emission: tuple[float, float, float, float] | None = None,
                      emission_strength: float = 0.0) -> Any:
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    principled = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
    if principled is None:
        principled = nodes.new("ShaderNodeBsdfPrincipled")
    principled.inputs["Base Color"].default_value = base
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["Metallic"].default_value = metallic
    if emission is not None and "Emission Color" in principled.inputs:
        principled.inputs["Emission Color"].default_value = emission
        principled.inputs["Emission Strength"].default_value = emission_strength
    output = next((n for n in nodes if n.type == "OUTPUT_MATERIAL"), None) or nodes.new("ShaderNodeOutputMaterial")
    links = material.node_tree.links
    if not any(link.to_node == output and link.from_node == principled for link in links):
        links.new(principled.outputs["BSDF"], output.inputs["Surface"])
    return material


def setup_lookdev(preset: dict[str, Any]) -> None:
    scene = bpy.context.scene
    scene.render.engine = preset.get("engine", "BLENDER_EEVEE")
    scene.render.resolution_x, scene.render.resolution_y = preset.get("resolution", [540, 960])
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.fps = preset.get("fps", 30)
    scene.render.film_transparent = False
    world = scene.world or bpy.data.worlds.new("WLD-editorial")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    world_cfg = preset.get("world", {})
    if bg:
        bg.inputs["Color"].default_value = tuple(world_cfg.get("color", [0.002, 0.004, 0.012, 1.0]))
        bg.inputs["Strength"].default_value = world_cfg.get("strength", 0.12)
    requested_look = preset.get("look")
    if requested_look:
        try:
            scene.view_settings.look = requested_look
        except (TypeError, ValueError):
            scene["requested_view_look"] = requested_look
    for obj in list(scene.objects):
        if obj.type == "LIGHT" and obj.name.startswith("LGT-"):
            bpy.data.objects.remove(obj, do_unlink=True)
    def area(name: str, loc: tuple[float, float, float], energy: float, color: tuple[float, float, float], size: float) -> None:
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.color = color
        data.shape = "DISK"
        data.size = size
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.location = loc
        obj.rotation_euler = (math.radians(35), 0.0, math.radians(35))
    for light_cfg in preset.get("lights", []):
        area(light_cfg["name"], tuple(light_cfg.get("location", [0.0, 0.0, 4.0])), light_cfg.get("energy", 500), tuple(light_cfg.get("color", [1.0, 1.0, 1.0])), light_cfg.get("size", 4.0))
    scene.render.use_file_extension = True


def setup_camera(preset: dict[str, Any]) -> None:
    scene = bpy.context.scene
    cam = bpy.data.objects.get("CAM-editorial")
    if cam is None:
        data = bpy.data.cameras.new("CAM-editorial")
        cam = bpy.data.objects.new("CAM-editorial", data)
        scene.collection.objects.link(cam)
    scene.camera = cam
    cam.location = (0.0, -8.0, 1.2)
    camera_cfg = preset.get("camera", {})
    cam.data.lens = camera_cfg.get("lens", 52)
    cam.data.sensor_width = camera_cfg.get("sensorWidth", 36)
    cam.data.dof.use_dof = bool(camera_cfg.get("dof", True))
    safe_area = camera_cfg.get("safeArea", {})
    for key, value in safe_area.items():
        cam["safe_area_" + key] = value
    target = bpy.data.objects.get("FOCUS-subject")
    if target is None:
        target = bpy.data.objects.new("FOCUS-subject", None)
        scene.collection.objects.link(target)
    target.location = (0.0, 0.0, 1.0)
    constraint = next((c for c in cam.constraints if c.type == "TRACK_TO"), None)
    if constraint is None:
        constraint = cam.constraints.new(type="TRACK_TO")
    constraint.target = target
    constraint.track_axis = "TRACK_NEGATIVE_Z"
    constraint.up_axis = "UP_Y"


def run(args: argparse.Namespace) -> dict[str, Any]:
    validate_args(args)
    if bpy is None:
        raise RuntimeError("must run inside Blender")
    scene_path = workspace_path(args.workspace, args.scene, must_exist=args.operation != "setup_camera")
    output_dir = workspace_path(args.workspace, args.output_dir)
    preset = load_preset(args.workspace, args.preset)
    output_dir.mkdir(parents=True, exist_ok=True)
    if args.operation != "setup_camera":
        bpy.ops.wm.open_mainfile(filepath=str(scene_path))
    if args.operation == "setup_lookdev":
        setup_lookdev(preset)
    elif args.operation == "setup_camera":
        setup_camera(preset)
    elif args.operation == "preview":
        setup_lookdev(preset)
        setup_camera(preset)
        bpy.context.scene.frame_start = args.frame_start
        bpy.context.scene.frame_end = args.frame_end
        bpy.context.scene.render.filepath = str(output_dir / "preview.png")
        bpy.context.scene.frame_set(args.frame_start)
        bpy.ops.render.render(write_still=True)
    report = inspect_scene()
    report["operation"] = args.operation
    report["preset"] = args.preset
    report["outputDirectory"] = str(output_dir)
    if args.operation in {"setup_lookdev", "setup_camera", "preview"}:
        save_path = output_dir / "toolkit-scene.blend"
        bpy.ops.wm.save_as_mainfile(filepath=str(save_path))
        report["sceneOutput"] = str(save_path)
    report_path = output_dir / "blender-quality-report.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Bounded Auto3Dvideo Blender quality toolkit")
    parser.add_argument("--operation", required=True, choices=sorted(ALLOWED_OPERATIONS))
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--scene", default="scenes/input.blend")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--engine", default="BLENDER_EEVEE", choices=sorted(ALLOWED_ENGINES))
    parser.add_argument("--preset", default=DEFAULT_PRESET)
    parser.add_argument("--frame-start", type=int, default=1)
    parser.add_argument("--frame-end", type=int, default=1)
    return parser


if __name__ == "__main__":
    if bpy is None:
        raise SystemExit("This worker must be invoked by Blender, not host Python")
    try:
        result = run(build_parser().parse_args(sys.argv[sys.argv.index("--") + 1:])) if "--" in sys.argv else run(build_parser().parse_args())
        print(json.dumps(result, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"error": type(exc).__name__, "message": str(exc)}))
        raise

"""Build an original editorial space explainer scene.

This worker is intentionally self-contained: Blender primitives only, no network,
no reference media reuse, no arbitrary shell execution. It creates a 9:16 scene
with a dark/cyan/white visual grammar inspired by space-editorial moodboards,
not a shot-for-shot reproduction of any creator.
"""
from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector

WIDTH, HEIGHT, FPS, FRAME_END = 540, 960, 30, 900


def safe_relative(raw: str) -> Path:
    value = raw.strip().replace("\\", "/")
    path = Path(value)
    if not value or path.is_absolute() or "://" in value or (len(value) > 1 and value[1] == ":"):
        raise ValueError("output phải là relative workspace path")
    if any(part in {"", ".", ".."} for part in value.split("/")):
        raise ValueError("output path không an toàn")
    return path


def parse_output() -> Path:
    if "--" not in sys.argv:
        raise ValueError("Thiếu output directory sau --")
    args = sys.argv[sys.argv.index("--") + 1 :]
    if len(args) != 1:
        raise ValueError("Cần đúng một output directory")
    return safe_relative(args[0])


def mat(name, color, emission=None, strength=2.0, roughness=0.45):
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    if principled:
        principled.inputs["Base Color"].default_value = color
        principled.inputs["Roughness"].default_value = roughness
        if emission:
            principled.inputs["Emission Color"].default_value = emission
            principled.inputs["Emission Strength"].default_value = strength
    return material


def apply(obj, material):
    obj.data.materials.append(material)
    if hasattr(obj.data, "polygons"):
        for poly in obj.data.polygons:
            poly.use_smooth = True
    return obj


def sphere(name, location, radius, material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=40, ring_count=24, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    return apply(obj, material)


def torus(name, location, major, minor, material, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=64, minor_segments=12, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    return apply(obj, material)


def cylinder_between(name, start, end, radius, material):
    start, end = Vector(start), Vector(end)
    direction = end - start
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=radius, depth=direction.length, location=(start + end) / 2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    return apply(obj, material)


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def text(body, location, size, material, name, hide_from=0, hide_to=FRAME_END + 1):
    bpy.ops.object.text_add(location=location, rotation=(math.pi / 2, 0, 0))
    obj = bpy.context.object
    obj.name = name
    obj.data.body = body
    obj.data.align_x = "CENTER"
    obj.data.size = size
    obj.data.extrude = 0.006
    apply(obj, material)
    obj.hide_render = hide_from > 0
    obj.keyframe_insert(data_path="hide_render", frame=1)
    obj.keyframe_insert(data_path="hide_render", frame=max(1, hide_from - 1))
    obj.hide_render = False
    obj.keyframe_insert(data_path="hide_render", frame=hide_from)
    obj.keyframe_insert(data_path="hide_render", frame=hide_to)
    obj.hide_render = True
    obj.keyframe_insert(data_path="hide_render", frame=min(FRAME_END, hide_to + 1))
    return obj


def build(output_dir: Path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = "EditorialSpacePulseOriginal"
    scene.frame_start, scene.frame_end, scene.render.fps = 1, FRAME_END, FPS
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = WIDTH, HEIGHT
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.filepath = os.fspath(output_dir / "frames" / "frame-")
    scene.view_settings.look = "AgX - Medium High Contrast"

    world = bpy.data.worlds.new("EditorialSpaceWorld")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.001, 0.004, 0.018, 1)
        bg.inputs["Strength"].default_value = 0.08

    dark = mat("DeepSpace", (0.003, 0.008, 0.025, 1), roughness=0.7)
    cyan = mat("EditorialCyan", (0.005, 0.38, 0.75, 1), emission=(0.0, 0.38, 1.0, 1), strength=5.0, roughness=0.22)
    white = mat("EditorialWhite", (0.72, 0.9, 1.0, 1), emission=(0.25, 0.55, 1.0, 1), strength=3.5, roughness=0.3)
    red = mat("EditorialRed", (0.72, 0.015, 0.02, 1), emission=(0.5, 0.005, 0.0, 1), strength=2.4, roughness=0.3)
    core_mat = mat("CoreGlass", (0.02, 0.12, 0.22, 1), emission=(0.0, 0.15, 0.35, 1), strength=2.5, roughness=0.16)

    core = sphere("SignalCore", (0, 0, 0), 1.35, core_mat)
    inner = sphere("SignalCoreInner", (0, -0.06, 0), 0.72, cyan)
    for i, radius in enumerate((1.8, 2.35, 2.95)):
        ring = torus(f"EnergyRing_{i:02d}", (0, 0, 0), radius, 0.026 + i * 0.008, cyan, rotation=(math.radians(70 + i * 20), math.radians(i * 18), math.radians(i * 32)))
        ring.rotation_euler[2] = 0
        ring.keyframe_insert(data_path="rotation_euler", frame=1)
        ring.rotation_euler[2] = math.tau * (1.2 if i != 1 else -0.8)
        ring.keyframe_insert(data_path="rotation_euler", frame=FRAME_END)

    # Original star streak field: deterministic, abstract, not reference media.
    for i in range(80):
        angle = math.tau * ((i * 29) % 80) / 80
        z = ((i * 17) % 23) - 11
        radius = 4.2 + ((i * 13) % 18) * 0.34
        start = (math.cos(angle) * radius, math.sin(angle) * radius, z)
        end = (start[0] * 1.18, start[1] * 1.18, z * 1.02)
        cylinder_between(f"StarStreak_{i:03d}", start, end, 0.008 + (i % 3) * 0.004, white if i % 5 else cyan)

    # A red/white signal arc gives an editorial focal contrast.
    for i in range(18):
        theta = math.radians(-55 + i * 6)
        start = (3.4 * math.cos(theta), 3.4 * math.sin(theta), 0.15 * math.sin(theta * 2))
        end = (3.8 * math.cos(theta), 3.8 * math.sin(theta), 0.15 * math.sin(theta * 2))
        cylinder_between(f"SignalArc_{i:02d}", start, end, 0.018, red if i % 4 == 0 else white)

    title = text("VŨ TRỤ KHÔNG ĐỨNG YÊN", (0, -1.2, 5.9), 0.34, white, "Title", 1, FRAME_END)
    text("MỖI TÍN HIỆU ĐỀU CÓ MỘT CÂU CHUYỆN", (0, -1.15, 5.25), 0.17, cyan, "Hook", 1, 175)
    text("NHÌN THẤY NHỊP ĐỘNG", (0, -1.15, 5.25), 0.22, red, "Beat02", 176, 355)
    text("ĐỪNG CHỈ NHÌN — HÃY THEO DÕI", (0, -1.15, 5.25), 0.18, white, "Beat03", 356, 585)
    text("MỘT CHUYỂN ĐỘNG TẠO RA Ý NGHĨA", (0, -1.15, 5.25), 0.16, cyan, "Beat04", 586, 900)

    bpy.ops.object.camera_add(location=(0, -18, 1.2))
    camera = bpy.context.object
    camera.name = "EditorialCamera"
    camera.data.lens = 48
    camera.data.sensor_width = 32
    scene.camera = camera
    camera_keys = ((1, (0, -20, 1.4), (0, 0, 0)), (180, (0.5, -13, 1.7), (0, 0, 0)), (360, (-2.5, -10, 2.5), (0, 0, 0)), (585, (3.8, -12, 3.2), (0, 0, 0)), (760, (0, -9, 4.5), (0, 0, 0)), (900, (0, -15, 2.0), (0, 0, 0)))
    for frame, location, target in camera_keys:
        camera.location = location
        look_at(camera, target)
        camera.keyframe_insert(data_path="location", frame=frame)
        camera.keyframe_insert(data_path="rotation_euler", frame=frame)

    bpy.ops.object.light_add(type="AREA", location=(-5, -8, 7))
    key = bpy.context.object
    key.data.energy, key.data.shape, key.data.size = 900, "DISK", 5
    key.data.color = (0.05, 0.28, 1.0)
    look_at(key, (0, 0, 0))
    bpy.ops.object.light_add(type="AREA", location=(5, -3, 4))
    fill = bpy.context.object
    fill.data.energy, fill.data.size = 500, 4
    fill.data.color = (1.0, 0.03, 0.01)
    look_at(fill, (0, 0, 0))

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "frames").mkdir(parents=True, exist_ok=True)
    scene_manifest = {
        "scene": "EditorialSpacePulseOriginal",
        "status": "built",
        "originality": "original_scene_inspired_by_space_editorial_grammar",
        "referenceMediaReused": False,
        "networkCallsMade": False,
        "format": {"width": WIDTH, "height": HEIGHT, "fps": FPS, "frameEnd": FRAME_END},
        "events": ["hook", "signal_rhythm", "camera_dive", "contrast_arc", "core_reveal", "memory_hook"],
        "outputDirectory": output_dir.as_posix(),
    }
    (output_dir / "scene-manifest.json").write_text(json.dumps(scene_manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    bpy.ops.wm.save_as_mainfile(filepath=os.fspath(output_dir / "editorial-space-pulse.blend"))
    print(json.dumps(scene_manifest, ensure_ascii=False, separators=(",", ":")), flush=True)


def main():
    output_relative = parse_output()
    workspace = Path.cwd().resolve()
    output_dir = (workspace / output_relative).resolve()
    if workspace not in output_dir.parents:
        raise ValueError("output vượt project workspace")
    build(output_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())

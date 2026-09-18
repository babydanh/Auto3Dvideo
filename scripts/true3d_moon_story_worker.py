"""Build a procedural true-3D Moon storytelling scene in Blender.

The worker is intentionally self-contained and uses only Blender primitives. It creates
an app-owned .blend plus six representative preview stills. It does not access the
network, credentials, user media, external assets, or arbitrary shell commands.
"""

from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path
from typing import Iterable

import bpy
from mathutils import Vector


WIDTH = 540
HEIGHT = 960
FPS = 30
FRAME_END = 900
SHOT_FRAMES = (60, 195, 345, 510, 600, 840)
SHOT_NAMES = (
    "hook",
    "orbit",
    "synchronous_rotation",
    "tidal_lock",
    "far_side_reveal",
    "conclusion",
)


def safe_relative_path(raw: str, suffix: str | None = None) -> Path:
    value = raw.strip().replace("\\", "/")
    path = Path(value)
    if not value or path.is_absolute() or "://" in value or len(value) > 1 and value[1] == ":":
        raise ValueError("output phải là đường dẫn tương đối an toàn")
    if any(part in {"", ".", ".."} for part in value.split("/")):
        raise ValueError("output không được chứa traversal/empty segment")
    if suffix and path.suffix.lower() != suffix.lower():
        raise ValueError(f"output phải kết thúc bằng {suffix}")
    return path


def parse_output_dir() -> Path:
    if "--" not in sys.argv:
        raise ValueError("Thiếu output directory sau --")
    index = sys.argv.index("--") + 1
    if index >= len(sys.argv):
        raise ValueError("Thiếu output directory")
    workspace = Path.cwd().resolve()
    relative = safe_relative_path(sys.argv[index])
    output_dir = (workspace / relative).resolve()
    if workspace not in output_dir.parents:
        raise ValueError("output vượt project workspace")
    return output_dir


def smooth(obj: bpy.types.Object) -> bpy.types.Object:
    if hasattr(obj.data, "polygons"):
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    return obj


def material(name: str, color: tuple[float, float, float, float], metallic: float = 0.0, roughness: float = 0.45, emission: tuple[float, float, float, float] | None = None) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    principled = nodes.get("Principled BSDF")
    if principled is not None:
        principled.inputs["Base Color"].default_value = color
        principled.inputs["Metallic"].default_value = metallic
        principled.inputs["Roughness"].default_value = roughness
        if emission is not None:
            principled.inputs["Emission Color"].default_value = emission
            principled.inputs["Emission Strength"].default_value = 3.0
    return mat


def assign(obj: bpy.types.Object, mat: bpy.types.Material) -> bpy.types.Object:
    obj.data.materials.append(mat)
    return obj


def add_uv_sphere(name: str, location: tuple[float, float, float], radius: float, mat: bpy.types.Material, segments: int = 48, rings: int = 24) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    assign(obj, mat)
    return smooth(obj)


def add_ico_sphere(name: str, location: tuple[float, float, float], radius: float, mat: bpy.types.Material, subdivisions: int = 2) -> bpy.types.Object:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    assign(obj, mat)
    return smooth(obj)


def add_cylinder_between(name: str, start: Vector, end: Vector, radius: float, mat: bpy.types.Material) -> bpy.types.Object:
    direction = end - start
    length = direction.length
    midpoint = (start + end) / 2
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=radius, depth=length, location=midpoint)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    assign(obj, mat)
    return smooth(obj)


def add_arrow(name: str, start: Vector, end: Vector, mat: bpy.types.Material, radius: float = 0.05) -> list[bpy.types.Object]:
    direction = end - start
    unit = direction.normalized()
    shaft_end = end - unit * 0.28
    shaft = add_cylinder_between(f"{name}_shaft", start, shaft_end, radius, mat)
    bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=radius * 3.0, radius2=0.0, depth=0.55, location=end - unit * 0.02)
    head = bpy.context.object
    head.name = f"{name}_head"
    head.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    assign(head, mat)
    return [shaft, head]


def look_at(camera: bpy.types.Object, target: Vector) -> None:
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def keyframe_linear(obj: bpy.types.Object) -> None:
    if not obj.animation_data or not obj.animation_data.action:
        return
    action = obj.animation_data.action
    # Blender 5.2 may expose layered Actions without the legacy fcurves property.
    # The default interpolation remains valid, so skip this optional polish in that API.
    fcurves = getattr(action, "fcurves", None)
    if fcurves is None:
        return
    for fcurve in fcurves:
        for point in fcurve.keyframe_points:
            point.interpolation = "LINEAR"


def add_text_label(body: str, location: tuple[float, float, float], size: float, mat: bpy.types.Material, rotation: tuple[float, float, float] = (math.pi / 2, 0.0, 0.0)) -> bpy.types.Object:
    bpy.ops.object.text_add(location=location, rotation=rotation)
    text = bpy.context.object
    text.name = f"Label_{body}"
    text.data.body = body
    text.data.align_x = "CENTER"
    text.data.size = size
    text.data.extrude = 0.008
    assign(text, mat)
    return text


def build_scene(output_dir: Path) -> dict[str, object]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = "MoonStoryPilot"
    scene.frame_start = 1
    scene.frame_end = FRAME_END
    scene.render.fps = FPS
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = WIDTH
    scene.render.resolution_y = HEIGHT
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.filepath = os.fspath(output_dir / "stills" / "shot-01-hook.png")
    scene.view_settings.look = "AgX - Medium High Contrast"

    world = bpy.data.worlds.new("MoonStoryWorld")
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background is not None:
        background.inputs["Color"].default_value = (0.002, 0.006, 0.025, 1.0)
        background.inputs["Strength"].default_value = 0.12

    earth_mat = material("Earth_Ocean", (0.015, 0.10, 0.32, 1), metallic=0.05, roughness=0.35)
    land_mat = material("Earth_Land", (0.04, 0.28, 0.13, 1), roughness=0.62)
    cloud_mat = material("Earth_Cloud", (0.72, 0.87, 1.0, 1), roughness=0.3)
    moon_mat = material("Moon_Regolith", (0.30, 0.34, 0.42, 1), roughness=0.82)
    crater_mat = material("Moon_Craters", (0.10, 0.12, 0.17, 1), roughness=0.95)
    accent_mat = material("Story_Accent", (1.0, 0.48, 0.08, 1), metallic=0.1, roughness=0.28, emission=(1.0, 0.18, 0.02, 1))
    cyan_mat = material("Orbit_Cyan", (0.02, 0.55, 1.0, 1), metallic=0.1, roughness=0.25, emission=(0.01, 0.25, 1.0, 1))
    satellite_mat = material("Satellite_Body", (0.18, 0.20, 0.24, 1), metallic=0.75, roughness=0.25)
    panel_mat = material("Satellite_Panels", (0.02, 0.08, 0.15, 1), metallic=0.55, roughness=0.25, emission=(0.0, 0.04, 0.12, 1))
    white_mat = material("Label_White", (0.8, 0.9, 1.0, 1), roughness=0.4, emission=(0.25, 0.35, 0.5, 1))
    sun_mat = material("Sun_Emission", (1.0, 0.34, 0.04, 1), roughness=0.3, emission=(1.0, 0.1, 0.01, 1))

    earth = add_uv_sphere("Earth_Persistent", (0, 0, 0), 2.0, earth_mat)
    earth.rotation_euler = (math.radians(18), 0, math.radians(-12))
    earth.rotation_euler[2] = math.radians(-12)
    earth.keyframe_insert(data_path="rotation_euler", frame=1)
    earth.rotation_euler[2] = math.radians(348)
    earth.keyframe_insert(data_path="rotation_euler", frame=FRAME_END)
    keyframe_linear(earth)

    # Procedural land masses and cloud bands keep Earth visually readable without external textures.
    land_specs = [
        ((-0.9, -1.55, 0.95), (0.8, 0.22, 0.12)),
        ((0.85, -1.22, -0.75), (0.6, 0.18, 0.14)),
        ((-1.25, 0.25, -1.20), (0.5, 0.16, 0.12)),
        ((1.20, 0.75, 0.7), (0.7, 0.16, 0.12)),
        ((0.05, 1.7, 0.55), (0.55, 0.18, 0.1)),
    ]
    for index, (location, scale) in enumerate(land_specs, start=1):
        patch = add_ico_sphere(f"Earth_Land_{index:02d}", location, 0.72, land_mat, subdivisions=2)
        patch.scale = scale
        patch.parent = earth
    for index, z in enumerate((-0.35, 0.20, 0.68), start=1):
        cloud = add_uv_sphere(f"Earth_Cloud_{index:02d}", (0, 0, z), 2.025, cloud_mat, segments=32, rings=16)
        cloud.scale = (1.0, 0.22, 0.11)
        cloud.rotation_euler[2] = math.radians(22 * index)
        cloud.parent = earth

    moon = add_uv_sphere("Moon_Persistent", (5.5, 0, 0), 0.78, moon_mat, segments=48, rings=24)
    crater_specs = [
        ((-0.58, -0.18, 0.28), (0.16, 0.04, 0.12)),
        ((-0.55, 0.25, -0.18), (0.11, 0.035, 0.09)),
        ((-0.48, -0.22, -0.35), (0.10, 0.03, 0.08)),
        ((-0.61, 0.06, 0.02), (0.07, 0.025, 0.06)),
        ((-0.42, 0.30, 0.40), (0.06, 0.02, 0.05)),
    ]
    for index, (location, scale) in enumerate(crater_specs, start=1):
        crater = add_ico_sphere(f"Moon_Crater_{index:02d}", location, 0.22, crater_mat, subdivisions=2)
        crater.scale = scale
        crater.parent = moon
    near_marker = add_uv_sphere("Moon_NearSide_Marker", (-0.72, 0, 0), 0.10, accent_mat, segments=24, rings=12)
    near_marker.scale = (0.28, 0.07, 0.28)
    near_marker.parent = moon
    far_marker = add_uv_sphere("Moon_FarSide_Marker", (0.72, 0, 0), 0.11, cyan_mat, segments=24, rings=12)
    far_marker.scale = (0.42, 0.09, 0.42)
    far_marker.parent = moon

    orbit_curve = bpy.data.curves.new("Earth_Moon_Orbit", type="CURVE")
    orbit_curve.dimensions = "3D"
    orbit_curve.bevel_depth = 0.018
    orbit_curve.bevel_resolution = 3
    orbit_spline = orbit_curve.splines.new("POLY")
    orbit_spline.points.add(64)
    for index, point in enumerate(orbit_spline.points):
        theta = math.tau * index / 64
        point.co = (5.5 * math.cos(theta), 5.5 * math.sin(theta), 0, 1)
    orbit_obj = bpy.data.objects.new("Orbit_Ring", orbit_curve)
    bpy.context.collection.objects.link(orbit_obj)
    assign(orbit_obj, cyan_mat)

    angles = (0.0, math.radians(36), math.radians(108), math.radians(180), math.radians(270), math.radians(324), math.tau)
    angle_frames = (1, 120, 270, 420, 600, 780, 900)
    for frame, theta in zip(angle_frames, angles):
        moon.location = (5.5 * math.cos(theta), 5.5 * math.sin(theta), 0)
        moon.rotation_euler = (0, 0, theta)
        moon.keyframe_insert(data_path="location", frame=frame)
        moon.keyframe_insert(data_path="rotation_euler", frame=frame)
    keyframe_linear(moon)

    # A compact stylized tidal visualization is enabled only in shot 04.
    tidal_members: list[bpy.types.Object] = []
    tidal_members.extend(add_arrow("Tidal_Torque", Vector((-1.6, -2.6, 1.1)), Vector((1.0, -2.6, 1.1)), accent_mat, radius=0.045))
    tidal_members.extend(add_arrow("Tidal_Pull", Vector((1.0, -2.3, 0.7)), Vector((4.2, -1.1, 0.7)), cyan_mat, radius=0.035))
    for member in tidal_members:
        member.hide_render = True
        member.keyframe_insert(data_path="hide_render", frame=1)
        member.keyframe_insert(data_path="hide_render", frame=419)
        member.hide_render = False
        member.keyframe_insert(data_path="hide_render", frame=420)
        member.keyframe_insert(data_path="hide_render", frame=599)
        member.hide_render = True
        member.keyframe_insert(data_path="hide_render", frame=600)

    satellite = bpy.data.objects.new("Observer_Satellite", None)
    bpy.context.collection.objects.link(satellite)
    bpy.ops.mesh.primitive_cube_add(size=0.35, location=(0, 0, 0))
    sat_body = bpy.context.object
    sat_body.name = "Satellite_Body"
    assign(sat_body, satellite_mat)
    sat_body.parent = satellite
    for side in (-1, 1):
        bpy.ops.mesh.primitive_cube_add(size=0.28, location=(side * 0.62, 0, 0))
        panel = bpy.context.object
        panel.name = f"Satellite_Panel_{side}"
        panel.scale = (1.2, 0.08, 0.55)
        assign(panel, panel_mat)
        panel.parent = satellite
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=10, radius=0.11, location=(0, -0.28, 0))
    lens = bpy.context.object
    lens.name = "Satellite_Lens"
    assign(lens, accent_mat)
    lens.parent = satellite
    sat_positions = ((-4, 3, 5), (1, 3, 4), (5, 0, 3), (3, -3, 2), (-3, 3, 3), (-2, -2, 4), (-4, 3, 5))
    for frame, location in zip(angle_frames, sat_positions):
        satellite.location = location
        satellite.rotation_euler = (0.15 * frame / FRAME_END, 0.25, 0.7 + frame / FRAME_END)
        satellite.keyframe_insert(data_path="location", frame=frame)
        satellite.keyframe_insert(data_path="rotation_euler", frame=frame)
    keyframe_linear(satellite)

    sun = add_uv_sphere("Sun_Key_Light", (-12, -8, 9), 1.3, sun_mat, segments=32, rings=16)
    sun.hide_render = True
    bpy.ops.object.light_add(type="AREA", location=(-8, -10, 10))
    key = bpy.context.object
    key.name = "Sun_Key_Area"
    key.data.energy = 1400
    key.data.shape = "DISK"
    key.data.size = 7
    look_at(key, Vector((0, 0, 0)))
    bpy.ops.object.light_add(type="AREA", location=(6, 3, 6))
    rim = bpy.context.object
    rim.name = "Blue_Rim_Area"
    rim.data.energy = 620
    rim.data.color = (0.08, 0.28, 1.0)
    rim.data.size = 5
    look_at(rim, Vector((0, 0, 0)))

    # Deterministic star field.
    for index in range(90):
        x = ((index * 37) % 31) - 15
        y = ((index * 71) % 37) - 18
        z = ((index * 53) % 22) - 5
        star = add_ico_sphere(f"Star_{index:03d}", (x, y, z), 0.018 + (index % 3) * 0.008, white_mat, subdivisions=1)
        star.hide_select = True

    bpy.ops.object.camera_add(location=(10, -18, 7))
    camera = bpy.context.object
    camera.name = "Story_Camera"
    camera.data.lens = 52
    camera.data.sensor_width = 32
    scene.camera = camera
    camera_keys = (
        (1, (13, -22, 7.5), Vector((2.0, 0, 0))),
        (120, (13, -22, 7.5), Vector((2.0, 0, 0))),
        (270, (9, -16, 4.5), Vector((2.0, 0, 0))),
        (420, (6, -12, 3.5), Vector((2.2, -1.8, 0))),
        (600, (2, -20, 4.2), Vector((0, -5.0, 0))),
        (780, (5, -17, 4.5), Vector((1.0, -2.0, 0))),
        (900, (13, -22, 7.5), Vector((2.0, 0, 0))),
    )
    for frame, location, target in camera_keys:
        camera.location = location
        look_at(camera, target)
        camera.keyframe_insert(data_path="location", frame=frame)
        camera.keyframe_insert(data_path="rotation_euler", frame=frame)
    keyframe_linear(camera)

    scene["auto3dvideo_pilot"] = "true_3d_moon_story"
    scene["rights_status"] = "generated-local"
    scene["visual_mode"] = "cinematic-3d"
    scene["voice_clone_enabled"] = False
    blend_path = output_dir / "moon-story-pilot.blend"
    bpy.ops.wm.save_as_mainfile(filepath=os.fspath(blend_path))

    still_dir = output_dir / "stills"
    still_dir.mkdir(parents=True, exist_ok=True)
    still_records: list[dict[str, object]] = []
    for index, (frame, name) in enumerate(zip(SHOT_FRAMES, SHOT_NAMES), start=1):
        scene.frame_set(frame)
        still_path = still_dir / f"shot-{index:02d}-{name}.png"
        scene.render.filepath = os.fspath(still_path)
        bpy.ops.render.render(write_still=True)
        still_records.append({
            "shotId": f"shot-{index:02d}",
            "name": name,
            "frame": frame,
            "relativePath": still_path.relative_to(output_dir.parent).as_posix(),
            "visualMode": "true-3d-cinematic",
            "reviewState": "needs_review",
        })

    manifest = {
        "schemaVersion": "1.0.0",
        "pilotId": "moon-story-pilot-v1",
        "title": "Vì sao chúng ta luôn thấy một mặt của Mặt Trăng?",
        "width": WIDTH,
        "height": HEIGHT,
        "fps": FPS,
        "frameEnd": FRAME_END,
        "scenePath": blend_path.relative_to(output_dir.parent).as_posix(),
        "shots": still_records,
        "entities": ["Earth_Persistent", "Moon_Persistent", "Observer_Satellite"],
        "networkCallsMade": False,
        "externalAssetsUsed": False,
        "rightsStatus": "generated-local",
        "voiceCloneEnabled": False,
        "message": "Procedural true-3D Blender scene; stills are representative frames and require human continuity/quality review.",
    }
    manifest_path = output_dir / "scene-manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {
        "status": "succeeded",
        "scenePath": manifest["scenePath"],
        "sceneManifestPath": manifest_path.relative_to(output_dir.parent).as_posix(),
        "shotCount": len(still_records),
        "networkCallsMade": False,
        "externalAssetsUsed": False,
        "message": "Đã dựng và render 6 still preview true 3D bằng Blender; chưa tạo voice, chưa ghép final và cần review continuity.",
    }


def main() -> int:
    try:
        output_dir = parse_output_dir()
        result = build_scene(output_dir)
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")), flush=True)
        return 0
    except Exception as error:
        print(json.dumps({"status": "failed", "networkCallsMade": False, "message": f"{type(error).__name__}: {str(error)[:400]}"}, ensure_ascii=False), flush=True)
        return 2


if __name__ == "__main__":
    sys.exit(main())

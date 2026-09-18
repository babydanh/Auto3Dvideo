"""Bounded Blender multi-shot builder.

Runs inside Blender. It does not download assets, open sockets, or execute
arbitrary user code. It creates shot collections, per-shot cameras, timing
markers, prompt-grounded procedural characters/environments, camera motion and
editorial metadata for reviewable previs.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

try:
    import bpy  # type: ignore
except ImportError:  # pragma: no cover
    bpy = None

TOOL_VERSION = "1.6.0"
MAX_SHOTS = 24


def workspace_path(workspace: str, candidate: str, must_exist: bool = False) -> Path:
    root = Path(workspace).resolve()
    path = (root / candidate).resolve() if not Path(candidate).is_absolute() else Path(candidate).resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise ValueError("path escapes project workspace") from exc
    if must_exist and not path.exists():
        raise FileNotFoundError(str(path))
    return path


def load_spec(workspace: str, spec_path: str) -> dict[str, Any]:
    path = workspace_path(workspace, spec_path, True)
    spec = json.loads(path.read_text(encoding="utf-8"))
    shots = spec.get("shots")
    if not isinstance(shots, list) or not shots or len(shots) > MAX_SHOTS:
        raise ValueError(f"shots must contain 1..{MAX_SHOTS} entries")
    previous_end = 0
    for index, shot in enumerate(shots, 1):
        if not isinstance(shot, dict):
            raise ValueError(f"shot {index} is not an object")
        for key in ("shotId", "startFrame", "endFrame"):
            if key not in shot:
                raise ValueError(f"shot {index} missing {key}")
        start, end = int(shot["startFrame"]), int(shot["endFrame"])
        if start < 1 or end < start or start < previous_end:
            raise ValueError(f"shot {index} has invalid or overlapping frame range")
        previous_end = end
    return spec


def get_or_create_collection(name: str) -> Any:
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(col)
    return col


def link_only(obj: Any, collection: Any) -> None:
    for col in list(obj.users_collection):
        col.objects.unlink(obj)
    collection.objects.link(obj)


def make_material(name: str, color: tuple[float, float, float, float], roughness: float = 0.55, emission_strength: float = 0.0) -> Any:
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    # Workbench previews use the viewport diffuse color when color_type is
    # MATERIAL; node color alone would make every blockout object look grey.
    material.diffuse_color = color
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    if principled is not None:
        principled.inputs["Base Color"].default_value = color
        principled.inputs["Roughness"].default_value = roughness
        if "Emission Color" in principled.inputs:
            principled.inputs["Emission Color"].default_value = color
            principled.inputs["Emission Strength"].default_value = emission_strength
    return material


def mark_asset(obj: Any, asset_id: str, role: str = "hero") -> Any:
    obj["asset_id"] = asset_id
    obj["asset_role"] = role
    obj["proxy_mode"] = True
    return obj


def add_uv(name: str, location: tuple[float, float, float], scale: tuple[float, float, float], material: Any, collection: Any, segments: int = 32) -> Any:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=max(12, segments // 2), radius=1.0, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    obj.data.materials.append(material)
    link_only(obj, collection)
    return obj


def add_cube(name: str, location: tuple[float, float, float], dimensions: tuple[float, float, float], material: Any, collection: Any, bevel: float = 0.0) -> Any:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        modifier = obj.modifiers.new("soft_edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 3
    obj.data.materials.append(material)
    link_only(obj, collection)
    return obj


def add_cylinder(name: str, location: tuple[float, float, float], radius: float, depth: float, material: Any, collection: Any, rotation: tuple[float, float, float] = (0.0, 0.0, 0.0)) -> Any:
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    link_only(obj, collection)
    return obj


def add_dinosaur_proxy(name: str, location: tuple[float, float, float], collection: Any) -> Any:
    """Build a recognizable low-poly dinosaur proxy for prehistoric previs.

    This is still a review-only proxy, but it must read as the requested
    subject in Blender. A cyan ellipse is useful as a semantic token for an
    external provider, not as a useful dinosaur preview for the user.
    """
    body_material = make_material("SB-dinosaur-body", (0.18, 0.34, 0.12, 1.0), 0.82)
    belly_material = make_material("SB-dinosaur-belly", (0.52, 0.34, 0.12, 1.0), 0.88)
    eye_material = make_material("SB-dinosaur-eye", (0.01, 0.006, 0.002, 1.0), 0.28, 0.2)
    tooth_material = make_material("SB-dinosaur-tooth", (0.92, 0.78, 0.48, 1.0), 0.7)
    root = bpy.data.objects.new(name, None)
    collection.objects.link(root)
    root.location = location

    def attach(obj: Any, local_location: tuple[float, float, float]) -> Any:
        obj.parent = root
        obj.location = local_location
        return obj

    attach(add_uv(f"{name}-body", (0.0, 0.0, 0.0), (1.65, 0.62, 0.78), body_material, collection, 24), (0.0, 0.0, 1.28))
    attach(add_uv(f"{name}-chest", (0.0, 0.0, 0.0), (0.82, 0.58, 0.88), body_material, collection, 20), (0.0, -0.72, 1.38))
    attach(add_uv(f"{name}-belly", (0.0, 0.0, 0.0), (1.25, 0.5, 0.48), belly_material, collection, 20), (0.0, -0.18, 1.02))
    attach(add_cylinder(f"{name}-neck", (0.0, 0.0, 0.0), 0.34, 1.18, body_material, collection, rotation=(math.radians(90), 0.0, 0.0)), (0.0, -1.18, 1.72))
    attach(add_uv(f"{name}-head", (0.0, 0.0, 0.0), (0.62, 0.72, 0.52), body_material, collection, 24), (0.0, -1.72, 2.18))
    attach(add_uv(f"{name}-snout", (0.0, 0.0, 0.0), (0.52, 0.5, 0.27), body_material, collection, 20), (0.0, -2.15, 2.04))
    attach(add_uv(f"{name}-eye-left", (0.0, 0.0, 0.0), (0.085, 0.06, 0.085), eye_material, collection, 12), (-0.34, -2.02, 2.38))
    attach(add_uv(f"{name}-eye-right", (0.0, 0.0, 0.0), (0.085, 0.06, 0.085), eye_material, collection, 12), (0.34, -2.02, 2.38))

    for index, (x, y, z) in enumerate(((-0.72, -0.36, 0.58), (0.72, -0.36, 0.58), (-0.72, 0.42, 0.55), (0.72, 0.42, 0.55)), 1):
        leg = add_cylinder(f"{name}-leg-{index:02d}", (0.0, 0.0, 0.0), 0.18, 1.05, body_material, collection)
        attach(leg, (x, y, z))
        foot = add_uv(f"{name}-foot-{index:02d}", (0.0, 0.0, 0.0), (0.28, 0.42, 0.16), belly_material, collection, 16)
        attach(foot, (x, y - 0.13, 0.08))

    for index, (x, y, z) in enumerate(((-0.68, -0.92, 1.58), (0.68, -0.92, 1.58)), 1):
        arm = add_cylinder(f"{name}-arm-{index:02d}", (0.0, 0.0, 0.0), 0.09, 0.62, belly_material, collection, rotation=(math.radians(28), math.radians(22 if x < 0 else -22), 0.0))
        attach(arm, (x, y, z))

    for index, (y, z, radius) in enumerate(((0.8, 1.36, 0.5), (1.65, 1.5, 0.34), (2.35, 1.62, 0.18)), 1):
        tail = add_cylinder(f"{name}-tail-{index:02d}", (0.0, 0.0, 0.0), radius, 0.9, body_material, collection, rotation=(math.radians(90), 0.0, 0.0))
        attach(tail, (0.0, y, z))

    for index, x in enumerate((-0.23, 0.23), 1):
        bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.11, radius2=0.0, depth=0.25, location=(0.0, 0.0, 0.0))
        tooth = bpy.context.object
        tooth.name = f"{name}-tooth-{index:02d}"
        tooth.data.materials.append(tooth_material)
        link_only(tooth, collection)
        attach(tooth, (x, -2.48, 1.91))
        tooth.rotation_euler.x = math.radians(180)

    mark_asset(root, "prehistoric-dinosaur-hero", "hero_subject")
    root["subject_shape"] = "recognizable_low_poly_dinosaur_proxy"
    return root


def _parent_at(obj: Any, parent: Any, location: tuple[float, float, float]) -> Any:
    obj.parent = parent
    obj.location = location
    return obj


def annotate_grounded(obj: Any, *, role: str, label: str, prompt: str = "") -> Any:
    """Attach the prompt-grounded contract to a renderable procedural asset."""
    obj["storyboard_mode"] = "prompt_grounded_previs"
    obj["semantic_role"] = role
    obj["semantic_label"] = label
    obj["shot_id"] = ""
    obj["beat_id"] = ""
    obj["prompt_excerpt"] = prompt[:1600]
    obj["is_final_asset"] = False
    obj["procedural_asset"] = True
    obj["provider_instruction"] = "Keep this identity, scale and action; replace only when a reviewed production model is bound."
    return obj


def grounded_prompt_data(spec: dict[str, Any], scene_mode: str) -> dict[str, Any]:
    raw = spec.get("promptGrounding")
    if isinstance(raw, dict):
        return raw
    if scene_mode == "prehistoric_dinosaur":
        return {
            "worldBible": {
                "environment": "Wet Cretaceous jungle with giant ferns, muddy river flats and volcanic haze.",
                "palette": "orange tiger, red-brown T-Rex, deep jungle green, amber key and cool blue rim",
                "lighting": "wet atmospheric dusk with volumetric mist",
                "cameraLanguage": "wide scale shots and controlled close details",
                "continuity": "preserve screen direction, identity and weight",
            },
            "characterBibles": [
                {"characterId": "tiger-giant", "lengthMeters": 4.6, "shoulderHeightMeters": 1.7, "massKg": 500.0, "scaleMultiplier": 1.6},
                {"characterId": "trex", "heightMeters": 12.0, "lengthMeters": 13.0},
            ],
            "constraints": ["Keep Hắc Vân as one stable giant Bengal tiger.", "Keep the T-Rex as one separate red-brown opponent."],
            "subjectSummary": "Giant Bengal tiger Hắc Vân versus a red-brown T-Rex in a wet Cretaceous jungle.",
        }
    return {"worldBible": {}, "characterBibles": [], "constraints": [], "subjectSummary": "Prompt-grounded hero subject"}


def _character_bible(data: dict[str, Any], character_id: str) -> dict[str, Any]:
    for item in data.get("characterBibles", []) if isinstance(data.get("characterBibles"), list) else []:
        if isinstance(item, dict) and str(item.get("characterId", "")) == character_id:
            return item
    return {}


def _float_value(data: dict[str, Any], key: str, default: float) -> float:
    try:
        value = float(data.get(key, default))
        return value if math.isfinite(value) and value > 0 else default
    except (TypeError, ValueError):
        return default


def add_tiger_procedural(name: str, location: tuple[float, float, float], collection: Any, bible: dict[str, Any], prompt: str) -> Any:
    coat = make_material("MAT-tiger-orange-coat", (0.82, 0.23, 0.045, 1.0), 0.68)
    belly = make_material("MAT-tiger-cream-belly", (0.62, 0.38, 0.17, 1.0), 0.82)
    stripes = make_material("MAT-tiger-black-stripes", (0.025, 0.009, 0.004, 1.0), 0.58)
    eye = make_material("MAT-tiger-gold-eyes", (0.95, 0.52, 0.06, 1.0), 0.18, 2.5)
    scar = make_material("MAT-tiger-scar", (0.30, 0.015, 0.01, 1.0), 0.72)
    root = bpy.data.objects.new(name, None)
    collection.objects.link(root)
    root.location = location
    length = _float_value(bible, "lengthMeters", 4.6)
    shoulder = _float_value(bible, "shoulderHeightMeters", 1.7)
    root.scale = (shoulder / 1.7, length / 4.6, shoulder / 1.7)
    root["asset_id"] = "tiger-giant-procedural"
    root["asset_role"] = "hero_subject"
    root["procedural_asset"] = True
    root["character_id"] = "tiger-giant"
    root["identity_anchors"] = ["orange coat", "black stripes", "gold eyes", "right-eye scar", "powerful shoulder"]
    root["dimensions_m"] = {"length": length, "shoulderHeight": shoulder, "massKg": _float_value(bible, "massKg", 500.0)}

    def attach(obj: Any, local: tuple[float, float, float]) -> Any:
        return _parent_at(obj, root, local)

    attach(add_uv(f"{name}-body", (0.0, 0.0, 0.0), (0.78, 1.05, 0.62), coat, collection, 36), (0.0, 0.28, 1.10))
    attach(add_uv(f"{name}-chest", (0.0, 0.0, 0.0), (0.68, 0.56, 0.75), coat, collection, 32), (0.0, -0.58, 1.22))
    attach(add_uv(f"{name}-belly", (0.0, 0.0, 0.0), (0.65, 0.73, 0.34), belly, collection, 28), (0.0, 0.08, 0.83))
    attach(add_cylinder(f"{name}-neck", (0.0, 0.0, 0.0), 0.39, 0.88, coat, collection, rotation=(math.radians(-22), 0.0, 0.0)), (0.0, -0.92, 1.53))
    attach(add_uv(f"{name}-head", (0.0, 0.0, 0.0), (0.52, 0.58, 0.46), coat, collection, 36), (0.0, -1.32, 1.86))
    attach(add_uv(f"{name}-muzzle", (0.0, 0.0, 0.0), (0.39, 0.40, 0.25), belly, collection, 28), (0.0, -1.69, 1.70))
    attach(add_uv(f"{name}-nose", (0.0, 0.0, 0.0), (0.16, 0.10, 0.10), stripes, collection, 20), (0.0, -1.98, 1.78))
    for side in (-1.0, 1.0):
        bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=0.22, radius2=0.03, depth=0.38, location=(0.0, 0.0, 0.0))
        ear = bpy.context.object
        ear.name = f"{name}-ear-{('L' if side < 0 else 'R')}"
        ear.data.materials.append(coat)
        link_only(ear, collection)
        ear.rotation_euler.x = math.radians(-12)
        attach(ear, (side * 0.33, -1.30, 2.26))
        attach(add_uv(f"{name}-eye-{('L' if side < 0 else 'R')}", (0.0, 0.0, 0.0), (0.075, 0.045, 0.075), eye, collection, 20), (side * 0.34, -1.67, 1.96))
    for index, (x, y) in enumerate(((-0.53, -0.42), (0.53, -0.42), (-0.55, 0.58), (0.55, 0.58)), 1):
        attach(add_cylinder(f"{name}-leg-{index:02d}", (0.0, 0.0, 0.0), 0.17, 0.82, coat, collection), (x, y, 0.44))
        attach(add_uv(f"{name}-paw-{index:02d}", (0.0, 0.0, 0.0), (0.25, 0.34, 0.13), belly, collection, 20), (x, y - 0.12, 0.08))
    for index, y in enumerate((0.62, 0.93, 1.22, 1.47), 1):
        radius = 0.26 - index * 0.035
        tail = add_cylinder(f"{name}-tail-{index:02d}", (0.0, 0.0, 0.0), radius, 0.52, coat, collection, rotation=(math.radians(90), 0.0, 0.0))
        attach(tail, (0.0, y, 1.18 + index * 0.03))
    for index, y in enumerate((-0.05, 0.30, 0.65, 0.98), 1):
        for side in (-1.0, 1.0):
            stripe = add_cube(f"{name}-stripe-{index:02d}-{('L' if side < 0 else 'R')}", (0.0, 0.0, 0.0), (0.07, 0.22, 0.44), stripes, collection, 0.025)
            stripe.rotation_euler.y = math.radians(-18 if side < 0 else 18)
            attach(stripe, (side * 0.75, y, 1.18))
    scar_obj = add_cube(f"{name}-right-eye-scar", (0.0, 0.0, 0.0), (0.025, 0.18, 0.06), scar, collection, 0.01)
    scar_obj.rotation_euler.y = math.radians(-25)
    attach(scar_obj, (0.30, -1.67, 2.06))
    annotate_grounded(root, role="subject", label="procedural giant Bengal tiger Hắc Vân", prompt=prompt)
    return root


def add_trex_procedural(name: str, location: tuple[float, float, float], collection: Any, bible: dict[str, Any], prompt: str) -> Any:
    hide = make_material("MAT-trex-red-brown-hide", (0.28, 0.075, 0.035, 1.0), 0.84)
    belly = make_material("MAT-trex-ochre-belly", (0.48, 0.22, 0.08, 1.0), 0.88)
    mouth = make_material("MAT-trex-mouth", (0.22, 0.012, 0.008, 1.0), 0.9)
    tooth = make_material("MAT-trex-teeth", (0.92, 0.76, 0.42, 1.0), 0.64)
    eye = make_material("MAT-trex-eye", (0.96, 0.12, 0.025, 1.0), 0.16, 3.0)
    root = bpy.data.objects.new(name, None)
    collection.objects.link(root)
    root.location = location
    height = _float_value(bible, "heightMeters", 12.0)
    length = _float_value(bible, "lengthMeters", 13.0)
    root.scale = (height / 12.0, length / 13.0, height / 12.0)
    root["asset_id"] = "trex-procedural"
    root["asset_role"] = "opponent"
    root["procedural_asset"] = True
    root["character_id"] = "trex"
    root["identity_anchors"] = ["red-brown hide", "large jaw", "visible teeth", "small forearms", "heavy tail"]
    root["dimensions_m"] = {"height": height, "length": length}

    def attach(obj: Any, local: tuple[float, float, float]) -> Any:
        return _parent_at(obj, root, local)

    attach(add_uv(f"{name}-body", (0.0, 0.0, 0.0), (1.22, 1.62, 1.55), hide, collection, 36), (0.0, 0.42, 5.25))
    attach(add_uv(f"{name}-chest", (0.0, 0.0, 0.0), (1.0, 1.05, 1.35), hide, collection, 32), (0.0, -0.94, 5.55))
    attach(add_cylinder(f"{name}-neck", (0.0, 0.0, 0.0), 0.67, 2.85, hide, collection, rotation=(math.radians(-24), 0.0, 0.0)), (0.0, -1.72, 6.55))
    attach(add_uv(f"{name}-head", (0.0, 0.0, 0.0), (1.18, 1.28, 0.95), hide, collection, 36), (0.0, -3.20, 8.04))
    attach(add_cube(f"{name}-upper-jaw", (0.0, 0.0, 0.0), (1.72, 1.75, 0.72), hide, collection, 0.20), (0.0, -4.15, 7.74))
    attach(add_cube(f"{name}-lower-jaw", (0.0, 0.0, 0.0), (1.48, 1.45, 0.36), mouth, collection, 0.12), (0.0, -4.05, 7.10))
    for side in (-1.0, 1.0):
        attach(add_uv(f"{name}-eye-{('L' if side < 0 else 'R')}", (0.0, 0.0, 0.0), (0.13, 0.08, 0.13), eye, collection, 20), (side * 0.72, -3.82, 8.45))
    for index, x in enumerate((-0.78, -0.39, 0.0, 0.39, 0.78), 1):
        tooth_obj = add_cube(f"{name}-tooth-{index:02d}", (0.0, 0.0, 0.0), (0.12, 0.22, 0.48), tooth, collection, 0.035)
        tooth_obj.rotation_euler.y = math.radians(180)
        attach(tooth_obj, (x, -4.72, 7.42))
    for index, (x, y) in enumerate(((-0.78, -0.15), (0.78, -0.15)), 1):
        attach(add_cylinder(f"{name}-leg-{index:02d}", (0.0, 0.0, 0.0), 0.38, 4.7, hide, collection, rotation=(math.radians(-8 if x < 0 else 8), 0.0, 0.0)), (x, y, 2.45))
        attach(add_uv(f"{name}-foot-{index:02d}", (0.0, 0.0, 0.0), (0.58, 0.92, 0.28), belly, collection, 24), (x, y - 0.38, 0.16))
    for index, (y, z, radius) in enumerate(((1.7, 4.65, 0.92), (3.0, 4.35, 0.70), (4.25, 4.05, 0.48), (5.35, 3.82, 0.25)), 1):
        tail = add_cylinder(f"{name}-tail-{index:02d}", (0.0, 0.0, 0.0), radius, 1.55, hide, collection, rotation=(math.radians(90), 0.0, 0.0))
        attach(tail, (0.0, y, z))
    for side in (-1.0, 1.0):
        arm = add_cylinder(f"{name}-arm-{('L' if side < 0 else 'R')}", (0.0, 0.0, 0.0), 0.13, 0.92, hide, collection, rotation=(math.radians(-30), math.radians(side * 18), 0.0))
        attach(arm, (side * 0.86, -1.72, 5.36))
    annotate_grounded(root, role="opponent", label="procedural red-brown Tyrannosaurus rex", prompt=prompt)
    return root


def add_time_rift(name: str, location: tuple[float, float, float], collection: Any, prompt: str) -> Any:
    edge = make_material("MAT-time-rift-edge", (0.10, 0.42, 1.0, 1.0), 0.24, 5.0)
    core = make_material("MAT-time-rift-core", (0.32, 0.02, 0.95, 1.0), 0.18, 8.0)
    ring = add_torus(name, location, 2.2, 0.12, edge, collection, rotation=(math.radians(90), 0.0, 0.0))
    ring.scale = (1.0, 1.0, 1.45)
    annotate_grounded(ring, role="time_rift", label="causal time-rift portal", prompt=prompt)
    core_obj = add_uv(f"{name}-core", location, (1.8, 0.08, 2.4), core, collection, 32)
    annotate_grounded(core_obj, role="time_rift", label="glowing rift interior", prompt=prompt)
    for index, x in enumerate((-1.4, -0.7, 0.0, 0.7, 1.4), 1):
        crack = add_cube(f"{name}-ground-crack-{index:02d}", (location[0] + x, location[1] + 0.55, 0.03), (0.08, 1.3, 0.05), core, collection, 0.02)
        crack.rotation_euler.z = math.radians((index - 3) * 9)
        annotate_grounded(crack, role="time_rift", label="rift energy crack", prompt=prompt)
    return ring


def add_grounded_environment(collection: Any, prompt: str) -> list[Any]:
    ground = make_material("MAT-cretaceous-wet-ground", (0.035, 0.075, 0.04, 1.0), 0.94)
    river = make_material("MAT-muddy-river", (0.025, 0.12, 0.13, 1.0), 0.30)
    rock = make_material("MAT-volcanic-basalt", (0.055, 0.04, 0.035, 1.0), 0.92)
    fern = make_material("MAT-giant-fern", (0.035, 0.22, 0.055, 1.0), 0.78)
    add_cube("ENV-cretaceous-ground", (0.0, 4.0, -0.28), (34.0, 34.0, 0.5), ground, collection, 0.14)
    add_cube("ENV-muddy-river", (0.0, 7.2, -0.015), (10.0, 22.0, 0.07), river, collection, 0.04)
    objects: list[Any] = []
    for index, (x, y, z, size) in enumerate(((-7.0, 2.0, 0.4, 1.8), (7.0, 4.5, 0.6, 2.2), (-5.5, 10.0, 0.3, 1.5), (5.4, 11.0, 0.5, 2.0), (-8.0, 15.0, 0.2, 1.2), (8.0, 16.0, 0.4, 1.5)), 1):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=size, location=(x, y, z))
        stone = bpy.context.object
        stone.name = f"ENV-basalt-rock-{index:02d}"
        stone.scale = (1.25, 0.8, 0.72)
        stone.data.materials.append(rock)
        link_only(stone, collection)
        annotate_grounded(stone, role="environment", label="volcanic basalt rock", prompt=prompt)
        objects.append(stone)
    for index, (x, y, scale) in enumerate(((-6.0, -0.5, 1.0), (-4.5, 4.0, 1.2), (5.0, 1.5, 1.15), (6.2, 8.0, 1.3), (-7.0, 9.0, 0.9), (7.0, 14.0, 1.0)), 1):
        stem = add_cylinder(f"ENV-fern-stem-{index:02d}", (x, y, 1.1 * scale), 0.08 * scale, 2.2 * scale, fern, collection)
        annotate_grounded(stem, role="environment", label="giant fern stem", prompt=prompt)
        for leaf_index in range(4):
            leaf = add_uv(f"ENV-fern-leaf-{index:02d}-{leaf_index:02d}", (x, y, 1.4 * scale + leaf_index * 0.3), (0.22 * scale, 0.78 * scale, 0.055 * scale), fern, collection, 16)
            leaf.rotation_euler.z = math.radians(-42 + leaf_index * 28)
            leaf.rotation_euler.y = math.radians(-10 + leaf_index * 7)
            annotate_grounded(leaf, role="environment", label="giant fern leaf", prompt=prompt)
    return objects


def grounded_lighting(collection: Any, world_description: str) -> list[Any]:
    lights: list[Any] = []
    for name, kind, location, energy, color, size in (
        ("LIGHT-amber-key", "AREA", (-8.0, -8.0, 13.0), 1700.0, (1.0, 0.34, 0.10), 8.0),
        ("LIGHT-blue-rim", "AREA", (8.0, 5.0, 10.0), 2200.0, (0.08, 0.24, 1.0), 7.0),
        ("LIGHT-soft-fill", "AREA", (0.0, 4.0, 14.0), 900.0, (0.32, 0.48, 0.62), 10.0),
    ):
        bpy.ops.object.light_add(type=kind, location=location)
        light = bpy.context.object
        light.name = name
        light.data.energy = energy
        light.data.color = color
        light.data.shape = "DISK"
        light.data.size = size
        link_only(light, collection)
        lights.append(light)
    if bpy.context.scene.world is None:
        bpy.context.scene.world = bpy.data.worlds.new("World")
    world = bpy.context.scene.world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background is not None:
        background.inputs["Color"].default_value = (0.004, 0.008, 0.025, 1.0)
        background.inputs["Strength"].default_value = 0.22
    return lights


def add_torus(name: str, location: tuple[float, float, float], major_radius: float, minor_radius: float, material: Any, collection: Any, rotation: tuple[float, float, float] = (0.0, 0.0, 0.0)) -> Any:
    bpy.ops.mesh.primitive_torus_add(major_radius=major_radius, minor_radius=minor_radius, major_segments=64, minor_segments=12, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    link_only(obj, collection)
    return obj


def infer_scene_mode(spec: dict[str, Any]) -> str:
    explicit = str(spec.get("sceneMode", "")).strip().lower()
    text_parts: list[str] = []
    # The saved shot plan can contain an old sceneMode from a previous
    # project.  Subject/topic text is the source of truth for the local
    # blockout, so include the document-level brief as well and let a strong
    # subject signal override stale metadata.
    text_parts.extend(
        str(spec.get(key, ""))
        for key in ("title", "hook", "topic", "brief", "prompt", "projectName")
    )
    for shot in spec.get("shots", []):
        grammar = shot.get("visualGrammar", {}) if isinstance(shot, dict) else {}
        text_parts.extend(str(grammar.get(key, "")) for key in ("prompt", "subject", "action"))
    text = " ".join(text_parts).casefold()
    if any(token in text for token in (
        "khủng long", "dinosaur", "t-rex", "trex", "tyrannosaurus",
        "kỷ jura", "kỷ phấn trắng", "tiền sử", "prehistoric", "hổ khổng lồ",
        "hổ thời tiền sử", "tiger", "sabre-tooth", "saber-tooth", "smilodon",
    )):
        return "prehistoric_dinosaur"
    if explicit:
        return explicit
    if any(token in text for token in ("mariana", "đáy biển", "đại dương", "tàu ngầm", "submarine", "underwater", "bioluminescent")):
        return "ocean_submersible"
    if any(token in text for token in ("giza", "kim tự tháp", "pyramid", "ai cập", "egypt")):
        return "ancient_architecture"
    if any(token in text for token in ("cyberpunk", "thành phố nổi", "ô tô bay", "futuristic city", "neon city")):
        return "cyberpunk_city"
    if any(token in text for token in ("cơ thể", "bộ não", "tế bào", "vi mô", "microscopic", "cell")):
        return "biomedical_macro"
    if any(token in text for token in ("hành tinh", "ngân hà", "vũ trụ", "black hole", "space", "galaxy")):
        return "space_cinematic"
    return "generic_cinematic"


def build_ocean_submersible(focus: Any, assets: Any) -> tuple[Any, dict[str, str]]:
    steel = make_material("MAT-submersible-titanium", (0.16, 0.22, 0.27, 1.0), 0.36)
    dark_steel = make_material("MAT-submersible-dark", (0.035, 0.06, 0.08, 1.0), 0.5)
    cyan = make_material("MAT-submersible-cyan", (0.02, 0.65, 0.85, 1.0), 0.2, 5.0)
    trench = make_material("MAT-trench-rock", (0.025, 0.045, 0.08, 1.0), 0.9)
    trench_lit = make_material("MAT-trench-rim", (0.02, 0.14, 0.2, 1.0), 0.7, 1.8)
    hero = add_uv("ASSET-submersible-hero-PROXY", tuple(focus.location), (2.25, 0.85, 0.72), steel, assets, 40)
    mark_asset(hero, "submersible-hero", "hero_subject")
    add_uv("ASSET-submersible-observation-window", (0.0, -0.78, 0.92), (0.38, 0.12, 0.38), cyan, assets, 32)
    add_cylinder("ASSET-submersible-conning-tower", (0.0, 0.05, 1.28), 0.32, 0.52, dark_steel, assets)
    add_cube("ASSET-submersible-left-fin", (-1.55, 0.15, 0.35), (1.5, 0.34, 0.10), dark_steel, assets, 0.04)
    add_cube("ASSET-submersible-right-fin", (1.55, 0.15, 0.35), (1.5, 0.34, 0.10), dark_steel, assets, 0.04)
    add_cylinder("ASSET-submersible-tail-shaft", (0.0, 1.15, 0.48), 0.12, 0.7, dark_steel, assets, rotation=(math.radians(90), 0.0, 0.0))
    add_torus("ASSET-submersible-propeller-guard", (0.0, 1.55, 0.48), 0.36, 0.055, dark_steel, assets, rotation=(math.radians(90), 0.0, 0.0))
    for index, x in enumerate((-0.55, 0.0, 0.55), 1):
        add_uv(f"FX-submersible-lamp-{index:02d}", (x, -0.79, 0.46), (0.09, 0.05, 0.09), cyan, assets, 20)
    add_cube("ENV-ocean-floor", (0.0, 2.2, -1.55), (18.0, 18.0, 0.35), trench, assets)
    add_cube("ENV-trench-wall-left", (-7.0, 4.0, 1.8), (0.55, 18.0, 7.0), trench, assets)
    add_cube("ENV-trench-wall-right", (7.0, 4.0, 1.4), (0.55, 18.0, 6.0), trench, assets)
    for index, (x, y, z, scale) in enumerate(((-4.4, 2.0, -0.7, 1.2), (4.1, 3.5, -0.4, 1.5), (-2.8, 7.0, 0.1, 1.0), (3.0, 8.0, 0.2, 1.15)), 1):
        bpy.ops.mesh.primitive_cone_add(vertices=7, radius1=scale, radius2=scale * 0.35, depth=scale * 3.3, location=(x, y, z))
        rock = bpy.context.object
        rock.name = f"ENV-trench-rock-{index:02d}"
        rock.rotation_euler = (0.1 * index, 0.15 * index, 0.2 * index)
        rock.data.materials.append(trench_lit)
        link_only(rock, assets)
    for index, (x, y, z) in enumerate(((-4.0, 1.2, 1.9), (4.2, 2.2, 2.4), (-3.0, 6.5, 2.0), (3.0, 7.8, 2.7), (0.8, 5.4, -0.6)), 1):
        glow = add_uv(f"FX-bioluminescent-life-{index:02d}", (x, y, z), (0.13, 0.13, 0.13), cyan, assets, 16)
        mark_asset(glow, f"bioluminescent-life-{index:02d}", "environment_fx")
    creature = add_uv("ASSET-bioluminescent-creature-PROXY", (2.8, 7.0, 1.0), (0.7, 0.45, 1.15), trench_lit, assets, 24)
    mark_asset(creature, "bioluminescent-creature", "secondary_subject")
    for index, x in enumerate((2.25, 2.65, 3.05, 3.45), 1):
        add_uv(f"ASSET-creature-tendril-{index:02d}", (x, 7.1, -0.15), (0.07, 0.07, 0.65), cyan, assets, 12)
    for index, (x, z, width) in enumerate(((-0.7, -0.95, 0.18), (0.0, -0.82, 0.25), (0.65, -0.98, 0.16)), 1):
        add_cube(f"ENV-trench-fissure-{index:02d}", (x, 8.9, z), (width, 0.08, 1.0), cyan, assets, 0.02)
    return hero, {"hero": hero.name, "world": "ENV-ocean-floor", "trenchLeft": "ENV-trench-wall-left", "trenchRight": "ENV-trench-wall-right", "creature": creature.name, "fissure": "ENV-trench-fissure-02"}


def build_architecture(focus: Any, assets: Any) -> tuple[Any, dict[str, str]]:
    stone = make_material("MAT-pyramid-stone", (0.52, 0.31, 0.12, 1.0), 0.92)
    shadow = make_material("MAT-pyramid-shadow", (0.06, 0.035, 0.02, 1.0), 0.88)
    base = add_cube("ENV-desert-ground", (0.0, 3.0, -1.35), (18.0, 18.0, 0.4), stone, assets)
    for level in range(5):
        width = 7.0 - level * 1.25
        add_cube(f"ASSET-pyramid-step-{level + 1:02d}", (0.0, 3.0, -1.0 + level * 0.8), (width, width, 1.0), stone, assets, 0.04)
    add_cube("ASSET-pyramid-entrance", (0.0, -0.58, 0.25), (1.2, 0.18, 1.8), shadow, assets, 0.03)
    hero = bpy.data.objects.get("ASSET-pyramid-step-01")
    mark_asset(hero, "pyramid-hero", "hero_subject")
    return hero, {"hero": hero.name, "ground": base.name, "entrance": "ASSET-pyramid-entrance"}


def build_cyberpunk_city(focus: Any, assets: Any) -> tuple[Any, dict[str, str]]:
    graphite = make_material("MAT-city-graphite", (0.035, 0.045, 0.07, 1.0), 0.45)
    neon = make_material("MAT-city-neon", (0.04, 0.6, 0.95, 1.0), 0.25, 4.0)
    add_cube("ENV-city-platform", (0.0, 3.0, -1.4), (18.0, 18.0, 0.4), graphite, assets)
    for index, (x, y, width, height) in enumerate(((-5.0, 4.0, 1.8, 5.0), (-2.5, 6.5, 2.0, 7.0), (3.0, 5.0, 2.2, 6.0), (5.5, 8.0, 1.5, 8.5)), 1):
        add_cube(f"ENV-neon-tower-{index:02d}", (x, y, height / 2 - 1.2), (width, width, height), graphite, assets, 0.08)
        add_cube(f"FX-neon-strip-{index:02d}", (x, y - width / 2 - 0.03, height / 2 - 0.3), (width * 0.8, 0.05, 0.08), neon, assets)
    hero = add_uv("ASSET-flying-vehicle-hero-PROXY", tuple(focus.location), (1.7, 0.65, 0.32), graphite, assets)
    mark_asset(hero, "flying-vehicle-hero", "hero_subject")
    add_torus("FX-flying-vehicle-neon-ring", (0.0, -0.3, 0.0), 0.75, 0.06, neon, assets, rotation=(math.radians(90), 0.0, 0.0))
    return hero, {"hero": hero.name, "cityPlatform": "ENV-city-platform"}


def build_space_scene(focus: Any, assets: Any) -> tuple[Any, dict[str, str]]:
    moon = make_material("MAT-space-subject", (0.18, 0.23, 0.32, 1.0), 0.82)
    blue = make_material("MAT-space-blue", (0.025, 0.12, 0.32, 1.0), 0.62)
    glow = make_material("MAT-space-glow", (0.04, 0.32, 0.95, 1.0), 0.35, 1.8)
    hero = add_uv("ASSET-space-hero-PROXY", tuple(focus.location), (1.65, 1.65, 1.65), moon, assets, 40)
    mark_asset(hero, "space-hero", "hero_subject")
    earth = add_uv("ASSET-earth-hero-PROXY", (3.6, 1.1, 1.55), (0.82, 0.82, 0.82), blue, assets, 32)
    mark_asset(earth, "earth-hero", "scale_reference")
    add_torus("FX-space-orbit-ring", tuple(focus.location), 2.35, 0.018, glow, assets, rotation=(math.radians(67), 0.0, math.radians(18)))
    return hero, {"hero": hero.name, "scaleReference": earth.name, "orbit": "FX-space-orbit-ring"}


def build_generic_scene(focus: Any, assets: Any) -> tuple[Any, dict[str, str]]:
    material = make_material("MAT-generic-hero", (0.16, 0.38, 0.46, 1.0), 0.72)
    hero = add_uv("ASSET-generic-hero-PROXY", tuple(focus.location), (1.65, 1.1, 1.2), material, assets, 32)
    mark_asset(hero, "generic-hero", "hero_subject")
    return hero, {"hero": hero.name}


def build_visual_scene(scene_mode: str, focus: Any) -> tuple[Any, dict[str, str]]:
    assets = get_or_create_collection("CONTINUITY-ASSETS")
    if scene_mode == "ocean_submersible":
        return build_ocean_submersible(focus, assets)
    if scene_mode == "ancient_architecture":
        return build_architecture(focus, assets)
    if scene_mode == "cyberpunk_city":
        return build_cyberpunk_city(focus, assets)
    if scene_mode == "space_cinematic":
        return build_space_scene(focus, assets)
    return build_generic_scene(focus, assets)


def semantic_materials() -> dict[str, Any]:
    """Materials are a visual grammar, not an attempt at final look-dev.

    The colors are deliberately stable across scenes so the attached boards
    communicate roles to the downstream image/video provider:
    cyan=subject, orange=person, violet=prop/clue, blue=environment,
    yellow=camera/action, white=reference frame.
    """
    return {
        "subject": make_material("SB-subject-cyan", (0.02, 0.72, 0.85, 1.0), 0.38, 1.4),
        "person": make_material("SB-person-orange", (0.95, 0.32, 0.06, 1.0), 0.5, 0.9),
        "prop": make_material("SB-prop-violet", (0.53, 0.16, 0.88, 1.0), 0.52, 0.6),
        "environment": make_material("SB-environment-blue", (0.06, 0.22, 0.36, 1.0), 0.84),
        "environment_alt": make_material("SB-environment-teal", (0.05, 0.38, 0.35, 1.0), 0.78),
        "camera": make_material("SB-camera-yellow", (0.95, 0.72, 0.06, 1.0), 0.38, 1.7),
        "action": make_material("SB-action-yellow", (1.0, 0.53, 0.04, 1.0), 0.32, 2.0),
        "reference": make_material("SB-reference-white", (0.72, 0.82, 0.88, 1.0), 0.68),
        "ground": make_material("SB-ground", (0.012, 0.03, 0.06, 1.0), 0.96),
    }


def annotate_semantic(obj: Any, *, role: str, label: str, shot_id: str = "", beat_id: str = "", omni_prompt: str = "") -> Any:
    """Attach machine-readable meaning to every storyboard primitive."""
    obj["storyboard_mode"] = "semantic_blockout"
    obj["semantic_role"] = role
    obj["semantic_label"] = label
    obj["shot_id"] = shot_id
    obj["beat_id"] = beat_id
    obj["omni_prompt"] = omni_prompt
    obj["is_final_asset"] = False
    obj["provider_instruction"] = "Interpret this primitive by semantic_label; replace it with final visual content."
    return obj


def align_z_to_vector(obj: Any, start: tuple[float, float, float], end: tuple[float, float, float]) -> None:
    """Point a Blender primitive whose local Z axis follows start -> end."""
    from mathutils import Vector  # type: ignore

    start_vec = Vector(start)
    direction = Vector(end) - start_vec
    if direction.length <= 0.001:
        return
    obj.location = (start_vec + direction * 0.5).to_tuple()
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    obj.dimensions.z = direction.length
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)


def add_action_arrow(name: str, start: tuple[float, float, float], end: tuple[float, float, float], material: Any, collection: Any, label: str, omni_prompt: str) -> list[Any]:
    """Create a clear action/trajectory arrow for Omni's shot interpretation."""
    from mathutils import Vector  # type: ignore

    direction = Vector(end) - Vector(start)
    length = max(0.1, float(direction.length))
    shaft_end = Vector(end) - direction.normalized() * min(0.42, length * 0.32)
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.055, depth=1.0, location=(0.0, 0.0, 0.0))
    shaft = bpy.context.object
    shaft.name = f"SB-ACTION-SHAFT-{name}"
    shaft.data.materials.append(material)
    link_only(shaft, collection)
    align_z_to_vector(shaft, start, shaft_end.to_tuple())
    annotate_semantic(shaft, role="action", label=label, omni_prompt=omni_prompt)
    bpy.ops.mesh.primitive_cone_add(vertices=12, radius1=0.22, radius2=0.0, depth=0.5, location=end)
    head = bpy.context.object
    head.name = f"SB-ACTION-HEAD-{name}"
    head.data.materials.append(material)
    link_only(head, collection)
    align_z_to_vector(head, shaft_end.to_tuple(), end)
    annotate_semantic(head, role="action", label=label, omni_prompt=omni_prompt)
    return [shaft, head]


def semantic_scene_profile(scene_mode: str) -> dict[str, Any]:
    profiles: dict[str, dict[str, Any]] = {
        "prehistoric_dinosaur": {
            "subject": "prehistoric dinosaur hero with stable identity and readable scale",
            "environment": ["giant fern valley", "volcanic cliff and muddy river", "distant dinosaur herd markers"],
            "props": ["fossil/time portal clue", "footprint trail", "nest or territorial marker"],
        },
        "ocean_submersible": {
            "subject": "deep-sea submersible / main subject",
            "environment": ["trench wall", "ocean floor", "bioluminescent depth markers"],
            "props": ["discovery clue", "sediment ridge", "distant creature marker"],
        },
        "ancient_architecture": {
            "subject": "explorer or pyramid focal subject",
            "environment": ["desert ground", "pyramid mass", "entrance corridor"],
            "props": ["stone clue", "light shaft", "scale marker"],
        },
        "cyberpunk_city": {
            "subject": "flying vehicle or main character",
            "environment": ["city platform", "neon tower", "layered skyline"],
            "props": ["neon sign block", "route marker", "distant vehicle marker"],
        },
        "space_cinematic": {
            "subject": "planet, spacecraft, or cosmic focal subject",
            "environment": ["space stage", "planetary horizon", "orbit field"],
            "props": ["orbit ring", "scale reference", "distant light source"],
        },
    }
    return profiles.get(scene_mode, {
        "subject": "main subject from the user's prompt",
        "environment": ["foreground environment", "midground environment", "background environment"],
        "props": ["story clue", "scale marker", "secondary subject marker"],
    })


def hero_binding_spec(spec: dict[str, Any], scene_mode: str, profile: dict[str, Any]) -> dict[str, Any]:
    """Make the reference-image/model distinction explicit in every previs report."""
    raw = spec.get("heroModel3dPath") or spec.get("heroAssetPath")
    bindings = spec.get("assetBindings")
    if not raw and isinstance(bindings, dict):
        hero = bindings.get("hero")
        raw = hero.get("path") if isinstance(hero, dict) else hero
    path = str(raw).strip() if raw else ""
    grounding = grounded_prompt_data(spec, scene_mode)
    tiger = _character_bible(grounding, "tiger-giant")
    scale_meters = _float_value(tiger, "shoulderHeightMeters", float(spec.get("heroScaleMeters", 8.0 if scene_mode == "prehistoric_dinosaur" else 1.0)))
    return {
        "assetKind": "model3d" if path else ("procedural_model3d" if scene_mode == "prehistoric_dinosaur" else "missing_model3d"),
        "path": path or None,
        "subject": grounding.get("subjectSummary") or profile.get("subject", "main subject"),
        "sceneMode": scene_mode,
        "scaleMeters": scale_meters,
        "lengthMeters": _float_value(tiger, "lengthMeters", 4.6) if scene_mode == "prehistoric_dinosaur" else None,
        "massKg": _float_value(tiger, "massKg", 500.0) if scene_mode == "prehistoric_dinosaur" else None,
        "scaleMultiplier": _float_value(tiger, "scaleMultiplier", 1.6) if scene_mode == "prehistoric_dinosaur" else None,
        "status": "bound" if path else ("procedural_preview_ready_missing_production_model3d" if scene_mode == "prehistoric_dinosaur" else "proxy_previs_missing_hero_model3d"),
        "note": "Procedural Blender model follows the prompt bible; bind a reviewed production model for final asset quality." if not path and scene_mode == "prehistoric_dinosaur" else ("Reference images lock identity/composition; they are not a Blender mesh." if not path else "Model path is metadata only until the allowlisted asset importer validates it."),
    }


def build_semantic_storyboard_scene(spec: dict[str, Any], scene_mode: str, focus: Any, workspace: Path) -> tuple[Any, dict[str, Any]]:
    """Build a semantic 3D storyboard, never a fake final render.

    The scene intentionally uses primitive shapes. Geometry is a visual index
    for an external provider: the provider must replace it with the final
    subject, environment, lighting and motion described by the prompt.
    """
    collection = get_or_create_collection("SEMANTIC-STORYBOARD")
    materials = semantic_materials()
    profile = semantic_scene_profile(scene_mode)
    hero_binding = hero_binding_spec(spec, scene_mode, profile)
    grammar_sources = [shot.get("visualGrammar", {}) for shot in spec.get("shots", []) if isinstance(shot, dict)]
    first_grammar = grammar_sources[0] if grammar_sources else {}
    subject_text = str(first_grammar.get("subject", ""))
    action_text = str(first_grammar.get("action", ""))
    scene_prompt = " ".join([subject_text, action_text]).strip()[:1800]

    ground = add_cube("SB-ENV-GROUND", (0.0, 2.0, -1.35), (18.0, 16.0, 0.25), materials["ground"], collection)
    annotate_semantic(ground, role="environment", label="dark stage = scene ground / coordinate reference", omni_prompt=profile["environment"][0])

    if scene_mode == "prehistoric_dinosaur":
        subject = add_dinosaur_proxy("SB-SUBJECT-DINOSAUR-PROXY", (0.0, 0.0, 0.0), collection)
        annotate_semantic(subject, role="subject", label=f"recognizable low-poly dinosaur proxy = {profile['subject']}", omni_prompt=scene_prompt)
        subject["shape_grammar"] = "recognizable_dinosaur_proxy_means_main_subject"
        subject["hero_asset_kind"] = hero_binding["assetKind"]
        subject["hero_scale_meters"] = hero_binding["scaleMeters"]
        subject["model_binding_status"] = hero_binding["status"]
        subject_shape = "recognizable_dinosaur_proxy"
    else:
        subject = add_uv("SB-SUBJECT-CIRCLE", (0.0, 0.0, 0.75), (1.15, 0.68, 0.68), materials["subject"], collection, 24)
        annotate_semantic(subject, role="subject", label=f"circle/ellipse = {profile['subject']}", omni_prompt=scene_prompt)
        subject["shape_grammar"] = "circle_or_ellipse_means_main_subject"
        subject_shape = "circle_or_ellipse"

    person = add_uv("SB-PERSON-MARKER", (-0.25, -0.15, 0.35), (0.23, 0.23, 0.48), materials["person"], collection, 16)
    annotate_semantic(person, role="person", label="orange capsule = person / scale reference if requested", omni_prompt="If the prompt asks for a person, replace this orange marker with the described person.")

    environment_objects: list[Any] = []
    env_locations = [(-4.8, 3.0, 1.0), (4.8, 4.0, 1.35), (-3.8, 7.0, 0.35), (3.7, 8.0, 0.55)]
    env_sizes = [(1.0, 3.4, 4.8), (1.25, 3.0, 5.8), (2.3, 1.0, 1.2), (2.8, 0.9, 1.8)]
    for index, (location, size) in enumerate(zip(env_locations, env_sizes), 1):
        material = materials["environment"] if index % 2 else materials["environment_alt"]
        block = add_cube(f"SB-ENV-BLOCK-{index:02d}", location, size, material, collection, 0.06)
        label = profile["environment"][min(index - 1, len(profile["environment"]) - 1)]
        annotate_semantic(block, role="environment", label=f"blue block {index} = {label}", omni_prompt=f"Replace block {index} with the {label} described by the prompt.")
        environment_objects.append(block)

    prop_objects: list[Any] = []
    prop_locations = [(-2.0, 1.6, -0.15), (2.15, 2.4, 0.2), (0.9, 6.0, 0.65)]
    for index, location in enumerate(prop_locations, 1):
        if index == 2:
            prop = add_cylinder(f"SB-PROP-MARKER-{index:02d}", location, 0.42, 0.95, materials["prop"], collection)
        else:
            prop = add_cube(f"SB-PROP-MARKER-{index:02d}", location, (0.72, 0.72, 0.72), materials["prop"], collection, 0.1)
        label = profile["props"][min(index - 1, len(profile["props"]) - 1)]
        annotate_semantic(prop, role="prop", label=f"violet marker {index} = {label}", omni_prompt=f"Replace prop marker {index} with the {label} from the prompt.")
        prop_objects.append(prop)

    camera_marker = add_cube("SB-CAMERA-FRAMING", (0.0, -5.0, 2.6), (0.8, 0.18, 0.8), materials["camera"], collection, 0.05)
    annotate_semantic(camera_marker, role="camera", label="yellow block = camera position / lens framing", omni_prompt="Use this marker only for camera placement and lens intent; do not render it in the final shot.")
    action_arrow = add_action_arrow("INITIAL", (-0.3, 0.0, 0.82), (2.2, 2.0, 0.82), materials["action"], collection, "orange arrow = subject motion / action direction", "Follow the arrow as the subject's main action direction.")

    reference_assets = spec.get("referenceAssets", [])
    reference_metadata: list[dict[str, Any]] = []
    for index, raw_path in enumerate(reference_assets if isinstance(reference_assets, list) else [], 1):
        try:
            path = workspace_path(str(workspace), str(raw_path), True)
        except (ValueError, FileNotFoundError):
            continue
        frame = add_cube(f"SB-REFERENCE-FRAME-{index:02d}", (5.2, -0.4 + index * 0.85, 0.2), (1.35, 0.12, 0.95), materials["reference"], collection, 0.02)
        annotate_semantic(frame, role="reference", label=f"white frame {index} = user reference image", omni_prompt="Use the attached user reference as identity/style/composition guidance when generating the final shot.")
        reference_metadata.append({"path": str(path), "objectId": frame.name, "label": frame.get("semantic_label")})

    components = [
        {"objectId": subject.name, "role": "subject", "label": subject.get("semantic_label"), "shape": subject_shape, "prompt": scene_prompt},
        {"objectId": person.name, "role": "person", "label": person.get("semantic_label"), "shape": "orange_capsule", "prompt": "person and scale marker"},
        *[{"objectId": item.name, "role": "environment", "label": item.get("semantic_label"), "shape": "blue_block"} for item in environment_objects],
        *[{"objectId": item.name, "role": "prop", "label": item.get("semantic_label"), "shape": "violet_block_or_cylinder"} for item in prop_objects],
        {"objectId": camera_marker.name, "role": "camera", "label": camera_marker.get("semantic_label"), "shape": "yellow_block"},
        {"objectId": action_arrow[0].name, "role": "action", "label": action_arrow[0].get("semantic_label"), "shape": "orange_arrow"},
    ]
    return subject, {
        "mode": "semantic_blockout",
        "sceneMode": scene_mode,
        "profile": profile,
        "components": components,
        "subject": subject,
        "person": person,
        "environment": environment_objects,
        "props": prop_objects,
        "camera": camera_marker,
        "action": action_arrow,
        "materials": materials,
        "referenceAssets": reference_metadata,
        "heroBinding": hero_binding,
        "omniInstruction": (
            "Interpret the storyboard: the recognizable low-poly dinosaur proxy is the main subject, "
            "the orange capsule is a scale marker, blue blocks are environment, violet markers are "
            "props/clues, the yellow block is camera framing and the orange arrow is action. Replace "
            "the proxy with the final dinosaur model and visuals from the prompt and attached references."
            if scene_mode == "prehistoric_dinosaur"
            else "Interpret the primitive grammar: cyan circle/ellipse=main subject, orange capsule=person/scale, blue blocks=environment, violet markers=props/clues, yellow block=camera, orange arrow=action. Replace all primitives with final visuals from the prompt and attached references."
        ),
    }


def build_prompt_grounded_scene(spec: dict[str, Any], scene_mode: str, focus: Any, workspace: Path) -> tuple[Any, dict[str, Any]]:
    """Build a renderable procedural scene from the prompt grounding contract.

    This is deliberately a bounded procedural fallback: it is much closer to the
    user's requested story than semantic cubes, while still reporting that a
    production-quality external model has not been imported yet.
    """
    collection = get_or_create_collection("PROMPT-GROUNDED-ASSETS")
    grounding = grounded_prompt_data(spec, scene_mode)
    profile = semantic_scene_profile(scene_mode)
    prompt = str(spec.get("prompt") or grounding.get("sourcePrompt") or "")
    environment = add_grounded_environment(collection, prompt)
    tiger_bible = _character_bible(grounding, "tiger-giant")
    trex_bible = _character_bible(grounding, "trex")
    tiger = add_tiger_procedural("CHAR-HAC-VAN", (-3.2, 0.5, 0.0), collection, tiger_bible, prompt)
    trex = add_trex_procedural("CHAR-TREX", (4.0, 4.6, 0.0), collection, trex_bible, prompt)
    rift = add_time_rift("PROP-TIME-RIFT", (-4.0, 2.5, 2.8), collection, prompt)
    grounded_lighting(collection, str(grounding.get("worldBible", {}).get("environment", "")))
    reference_metadata: list[dict[str, Any]] = []
    reference_assets = spec.get("referenceAssets", [])
    for index, raw_path in enumerate(reference_assets if isinstance(reference_assets, list) else [], 1):
        try:
            path = workspace_path(str(workspace), str(raw_path), True)
        except (ValueError, FileNotFoundError):
            continue
        reference_metadata.append({"path": str(path), "objectId": f"REFERENCE-{index:02d}", "label": "identity/style reference"})

    hero_binding = hero_binding_spec(spec, scene_mode, profile)
    components = [
        {"objectId": tiger.name, "role": "subject", "label": "procedural giant Bengal tiger Hắc Vân", "shape": "procedural_tiger", "prompt": prompt[:1800]},
        {"objectId": trex.name, "role": "opponent", "label": "procedural red-brown T-Rex", "shape": "procedural_trex", "prompt": prompt[:1800]},
        {"objectId": rift.name, "role": "time_rift", "label": "causal time-rift portal", "shape": "emissive_portal", "prompt": "Use the rift as the cause of the time displacement."},
        *[{"objectId": item.name, "role": "environment", "label": "Cretaceous environment", "shape": "procedural_environment", "prompt": str(grounding.get("worldBible", {}).get("environment", ""))} for item in environment[:6]],
    ]
    return tiger, {
        "mode": "prompt_grounded_previs",
        "sceneMode": scene_mode,
        "profile": profile,
        "promptGrounding": grounding,
        "components": components,
        "subject": tiger,
        "opponent": trex,
        "environment": environment,
        "props": [rift],
        "camera": None,
        "action": [rift],
        "materials": {},
        "referenceAssets": reference_metadata,
        "heroBinding": hero_binding,
        "omniInstruction": (
            "This preview is prompt-grounded procedural 3D: preserve Hắc Vân's tiger identity, "
            "the T-Rex opponent, the stated metric scale, the wet Cretaceous world, the time-rift "
            "cause and each shot's action/camera/lighting. Replace only the procedural meshes with "
            "reviewed production models; never substitute a generic dinosaur for the tiger."
        ),
    }


def grounded_role(shot: dict[str, Any], shot_index: int) -> str:
    text = " ".join(str(shot.get(key, "")) for key in ("event", "action", "visualGrammar")) .casefold()
    if any(token in text for token in ("đấu", "fight", "attack", "tấn công", "vồ", "cắn", "va chạm")):
        return "action"
    if any(token in text for token in ("vết rách", "rift", "portal", "xuyên", "quá khứ", "reveal")):
        return "reveal"
    if shot_index >= 5:
        return "resolve"
    return "establish" if shot_index == 0 else "action"


def apply_prompt_grounded_pose(grounded: dict[str, Any], role: str, shot_index: int, phase: float = 0.0) -> tuple[float, float, float]:
    tiger = grounded["subject"]
    trex = grounded["opponent"]
    rift = grounded["props"][0]
    positions = {
        "establish": ((-3.4 + phase * 0.25, 0.8 + phase * 0.8, 0.0), (4.8, 5.2 + phase * 0.4, 0.0), (-4.0, 2.8, 2.8)),
        "action": ((-2.2 + phase * 1.35, 1.2 + phase * 1.0, 0.0), (3.0 - phase * 0.8, 4.0 - phase * 0.55, 0.0), (-2.8, 3.8, 2.8)),
        "reveal": ((-1.1 + phase * 0.45, 2.8 + phase * 0.7, 0.0), (2.2, 5.0, 0.0), (-0.3, 4.2, 3.1)),
        "resolve": ((0.2 + phase * 0.3, 4.6 + phase * 0.8, 0.0), (3.4, 6.6, 0.0), (0.5, 5.4, 2.5)),
    }
    tiger_pos, trex_pos, rift_pos = positions.get(role, positions["action"])
    tiger.location = tiger_pos
    trex.location = trex_pos
    rift.location = rift_pos
    tiger.rotation_euler.z = math.radians(-8.0 + phase * 5.0)
    trex.rotation_euler.z = math.radians(8.0 - phase * 4.0)
    rift.rotation_euler.y = math.radians(phase * 7.0)
    return ((tiger_pos[0] + trex_pos[0]) * 0.5, (tiger_pos[1] + trex_pos[1]) * 0.5, 5.0)


def keyframe_prompt_grounded_shot(grounded: dict[str, Any], shot: dict[str, Any], shot_index: int) -> None:
    """Give the Blender MP4 a real per-shot subject/action change."""
    role = grounded_role(shot, shot_index)
    scene = bpy.context.scene
    for frame, phase in ((int(shot["startFrame"]), 0.0), (int(shot["endFrame"]), 1.0)):
        scene.frame_set(frame)
        target = apply_prompt_grounded_pose(grounded, role, shot_index, phase)
        grounded["subject"].keyframe_insert(data_path="location", frame=frame)
        grounded["subject"].keyframe_insert(data_path="rotation_euler", frame=frame)
        grounded["opponent"].keyframe_insert(data_path="location", frame=frame)
        grounded["opponent"].keyframe_insert(data_path="rotation_euler", frame=frame)
        grounded["props"][0].keyframe_insert(data_path="location", frame=frame)
        grounded["props"][0].keyframe_insert(data_path="rotation_euler", frame=frame)
        grounded["props"][0].scale = (1.0 + 0.08 * (1.0 if role == "reveal" else phase), 1.0, 1.0 + 0.08 * (1.0 if role == "reveal" else phase))
        grounded["props"][0].keyframe_insert(data_path="scale", frame=frame)
        grounded["focusTarget"] = target


def update_semantic_beat(semantic: dict[str, Any], shot: dict[str, Any], beat: dict[str, Any], shot_index: int, beat_index: int, beat_count: int) -> dict[str, Any]:
    """Move semantic markers so every beat encodes a different shot event."""
    if semantic.get("mode") == "prompt_grounded_previs":
        role = str(beat.get("imageRole", beat.get("purpose", "action"))).lower()
        target = apply_prompt_grounded_pose(semantic, role, shot_index, float(beat.get("timeFraction", 0.0)))
        semantic["focusTarget"] = target
        for obj, object_role in ((semantic["subject"], "subject"), (semantic["opponent"], "opponent"), (semantic["props"][0], "time_rift")):
            obj["shot_id"] = str(shot.get("shotId", ""))
            obj["beat_id"] = str(beat.get("beatId", f"beat-{beat_index + 1:02d}"))
            obj["shot_role"] = object_role
            obj["beat_action"] = str(beat.get("action", ""))[:1000]
        return {
            "mode": "prompt_grounded_previs",
            "role": role,
            "subjectPosition": list(semantic["subject"].location),
            "opponentPosition": list(semantic["opponent"].location),
            "riftPosition": list(semantic["props"][0].location),
            "cameraInstruction": beat.get("cameraPrompt", ""),
            "action": beat.get("action", ""),
            "prompt": beat.get("prompt", ""),
        }
    from mathutils import Vector  # type: ignore

    subject = semantic["subject"]
    person = semantic["person"]
    role = str(beat.get("imageRole", beat.get("purpose", "action"))).lower()
    role_positions = {
        "establish": ((0.0, 1.0, 0.75), (0.0, 0.3, 0.38), (-0.9, 0.0, 0.0), 0.8),
        "action": ((1.25, 1.8, 0.95), (0.5, 1.15, 0.46), (1.1, 0.8, 0.15), 1.25),
        "reveal": ((-0.75, 3.1, 1.1), (-0.45, 2.65, 0.55), (-1.5, 1.5, 0.35), 1.65),
        "resolve": ((0.45, 4.45, 0.78), (0.1, 3.95, 0.42), (0.6, 2.8, 0.1), 1.05),
    }
    subject_pos, person_pos, arrow_end, arrow_height = role_positions.get(role, role_positions["action"])
    subject.location = subject_pos
    person.location = person_pos
    subject.rotation_euler.z = math.radians((shot_index * 17 + beat_index * 29) % 360)
    if semantic.get("sceneMode") == "prehistoric_dinosaur":
        subject.scale = (1.0 + 0.08 * beat_index, 1.0 + 0.04 * beat_index, 1.0 + 0.06 * beat_index)
    else:
        subject.scale = (1.15 + 0.08 * beat_index, 0.68, 0.68)
    person.scale = (0.23, 0.23, 0.48 + 0.04 * beat_index)
    for index, item in enumerate(semantic["environment"]):
        item.location.z = (-0.1 + index * 0.18) if role != "reveal" else (-0.1 + index * 0.28)
        item.scale.x = 1.0 + (0.12 if role == "establish" else 0.0)
    for index, item in enumerate(semantic["props"]):
        item.hide_render = role == "establish" and index == 2
        item.location.y += (0.2 if role == "action" else 0.0)

    start = Vector(subject.location) + Vector((0.0, 0.0, 0.25))
    end = Vector(arrow_end) + Vector((0.0, 0.0, arrow_height))
    arrow_objects = semantic["action"]
    shaft_end = end - (end - start).normalized() * min(0.42, (end - start).length * 0.32)
    align_z_to_vector(arrow_objects[0], start.to_tuple(), shaft_end.to_tuple())
    align_z_to_vector(arrow_objects[1], shaft_end.to_tuple(), end.to_tuple())
    for item in arrow_objects:
        item.hide_render = role == "resolve"
        item["shot_id"] = str(shot.get("shotId", ""))
        item["beat_id"] = str(beat.get("beatId", f"beat-{beat_index + 1:02d}"))
        item["beat_purpose"] = str(beat.get("purpose", role))
        item["beat_action"] = str(beat.get("action", ""))

    semantic["camera"]["shot_id"] = str(shot.get("shotId", ""))
    semantic["camera"]["beat_id"] = str(beat.get("beatId", f"beat-{beat_index + 1:02d}"))
    semantic["camera"]["camera_instruction"] = str(beat.get("cameraPrompt", ""))
    return {
        "role": role,
        "subjectPosition": list(subject_pos),
        "personPosition": list(person_pos),
        "actionEndpoint": list(arrow_end),
        "cameraInstruction": beat.get("cameraPrompt", ""),
        "action": beat.get("action", ""),
        "prompt": beat.get("prompt", ""),
    }


def camera_for_shot(shot: dict[str, Any], index: int, focus: Any, grounded: bool = False) -> Any:
    shot_id = str(shot["shotId"])
    name = f"CAM-{shot_id}"
    data = bpy.data.cameras.get(name) or bpy.data.cameras.new(name)
    cam = bpy.data.objects.get(name) or bpy.data.objects.new(name, data)
    collection = get_or_create_collection(f"SHOT-{shot_id}")
    if not cam.users_collection:
        collection.objects.link(cam)
    else:
        link_only(cam, collection)
    camera_cfg = shot.get("camera", {})
    cam.data.lens = float(camera_cfg.get("lens", 52))
    cam.data.sensor_width = float(camera_cfg.get("sensorWidth", 36))
    cam.data.dof.use_dof = bool(camera_cfg.get("dof", True))
    cam.data.dof.focus_object = focus
    constraint = next((c for c in cam.constraints if c.type == "TRACK_TO"), None)
    if constraint is None:
        constraint = cam.constraints.new(type="TRACK_TO")
    constraint.target = focus
    constraint.track_axis = "TRACK_NEGATIVE_Z"
    constraint.up_axis = "UP_Y"
    # Blender can save a zero camera rotation before the TRACK_TO constraint
    # evaluates in background mode. Aim explicitly as a deterministic fallback
    # so the render never points at the empty world/background.
    constraint.influence = 0.0
    start = int(shot["startFrame"])
    end = int(shot["endFrame"])
    motion = camera_cfg.get("motion", "locked")
    cam_type = camera_cfg.get("type", "medium")
    if cam_type == "wide":
        dist = 24.0 if grounded else 12.0
        z_off = 5.6 if grounded else 2.5
    elif cam_type == "macro" or cam_type == "detail":
        # Keep close-up intent, but leave enough room for the proxy subject in
        # a previs render. A literal 85mm macro at 3.2m fills the whole frame
        # and looks like a blank grey plate instead of a readable 3D shot.
        dist = 15.0 if grounded else 10.0
        z_off = 4.8 if grounded else 1.2
        cam.data.lens = min(cam.data.lens, 50.0 if grounded else 35.0)
    else:
        dist = 20.0 if grounded else 7.5
        z_off = 4.8 if grounded else 1.1
    x = float(camera_cfg.get("x", (index % 3 - 1) * 1.2))
    y = float(camera_cfg.get("y", -dist))
    z = float(camera_cfg.get("z", z_off))
    cam.location = (x, y, z)
    direction = focus.location - cam.location
    if direction.length > 0:
        cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    cam.keyframe_insert(data_path="location", frame=start)
    cam.keyframe_insert(data_path="rotation_euler", frame=start)
    if motion == "push_in":
        cam.location = (x, y + 1.1, z)
    elif motion == "orbit":
        cam.location = (x + 1.0, y + 0.35, z + 0.15)
    elif motion == "rise":
        cam.location = (x, y, z + 1.0)
    direction = focus.location - cam.location
    if direction.length > 0:
        cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    cam.keyframe_insert(data_path="location", frame=end)
    cam.keyframe_insert(data_path="rotation_euler", frame=end)
    cam["shot_id"] = shot_id
    cam["camera_type"] = camera_cfg.get("type", "medium")
    cam["motion_type"] = motion
    return cam


def copy_camera_pose(source: Any, target: Any, frame: int) -> None:
    """Bake a shot camera's evaluated pose into the single render camera.

    Blender cannot keyframe ``Scene.camera`` reliably in background mode. The
    previs therefore uses one active camera whose transform is keyed at every
    shot boundary. The authored per-shot cameras remain available as metadata
    and for later high-quality render orchestration.
    """
    scene = bpy.context.scene
    scene.frame_set(frame)
    target.location = source.matrix_world.translation.copy()
    target.rotation_euler = source.matrix_world.to_euler()
    target.keyframe_insert(data_path="location", frame=frame)
    target.keyframe_insert(data_path="rotation_euler", frame=frame)
    target.data.lens = source.data.lens
    target.data.keyframe_insert(data_path="lens", frame=frame)


def write_contact_sheet(image_paths: list[Path], output_path: Path, columns: int = 2) -> None:
    """Combine representative shot renders into one review image in Blender."""
    if not image_paths:
        return
    loaded = [bpy.data.images.load(str(path), check_existing=False) for path in image_paths]
    tile_width = max(int(image.size[0]) for image in loaded)
    tile_height = max(int(image.size[1]) for image in loaded)
    rows = math.ceil(len(loaded) / columns)
    sheet = bpy.data.images.new("BLENDER-shot-contact-sheet", width=tile_width * columns, height=tile_height * rows, alpha=False)
    pixels = [0.0] * (sheet.size[0] * sheet.size[1] * 4)
    for index, image in enumerate(loaded):
        source = list(image.pixels)
        column = index % columns
        row = index // columns
        for y in range(tile_height):
            source_start = y * tile_width * 4
            target_start = ((row * tile_height + y) * int(sheet.size[0]) + column * tile_width) * 4
            pixels[target_start:target_start + tile_width * 4] = source[source_start:source_start + tile_width * 4]
    sheet.pixels.foreach_set(pixels)
    sheet.filepath_raw = str(output_path)
    sheet.file_format = "PNG"
    sheet.save()
    for image in loaded:
        bpy.data.images.remove(image)
    bpy.data.images.remove(sheet)


def normalized_beats(shot: dict[str, Any]) -> list[dict[str, Any]]:
    beats = shot.get("beats")
    if isinstance(beats, list) and beats:
        return [beat for beat in beats if isinstance(beat, dict)]
    return [
        {"beatId": "beat-01", "timeFraction": 0.0, "purpose": "establish", "imageRole": "establish", "action": "Establish the shot composition."},
        {"beatId": "beat-02", "timeFraction": 0.33, "purpose": "action", "imageRole": "action", "action": "Advance the visible action."},
        {"beatId": "beat-03", "timeFraction": 0.66, "purpose": "reveal", "imageRole": "reveal", "action": "Reveal a meaningful visual change."},
        {"beatId": "beat-04", "timeFraction": 1.0, "purpose": "resolve", "imageRole": "resolve", "action": "Resolve into a clean transition state."},
    ]


def still_camera_for_beat(shot: dict[str, Any], shot_index: int, beat: dict[str, Any], beat_index: int, beat_count: int, focus: Any, grounded: bool = False) -> Any:
    """Create a disposable camera for a storyboard anchor image."""
    shot_id = str(shot["shotId"])
    beat_id = str(beat.get("beatId", f"beat-{beat_index + 1:02d}"))
    name = f"TEMP-{shot_id}-{beat_id}"
    data = bpy.data.cameras.new(name)
    cam = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(cam)
    camera_cfg = shot.get("camera", {})
    cam_type = str(camera_cfg.get("type", "medium")).lower()
    camera_text = f"{camera_cfg.get('motion', '')} {beat.get('cameraPrompt', '')}".lower()
    if "wide" in camera_text or cam_type == "wide":
        distance, z_offset = ((24.0, 5.6) if grounded else (12.0, 2.5))
    elif cam_type in ("macro", "detail"):
        distance, z_offset = ((15.0, 4.8) if grounded else (7.0, 1.2))
    else:
        distance, z_offset = ((20.0, 4.8) if grounded else (9.0, 1.5))
    base_x = float(camera_cfg.get("x", (shot_index % 3 - 1) * 1.2))
    base_y = float(camera_cfg.get("y", -distance))
    base_z = float(camera_cfg.get("z", z_offset))
    fraction = float(beat.get("timeFraction", beat_index / max(1, beat_count - 1)))
    arc = fraction - 0.5
    role = str(beat.get("imageRole", "action"))
    role_offset = {"establish": (-1.2, 0.5), "action": (0.0, 0.0), "reveal": (1.35, 0.8), "resolve": (0.35, 1.1)}.get(role, (0.0, 0.0))
    cam.location = (base_x + arc * 2.2 + role_offset[0], base_y + fraction * 1.4, base_z + role_offset[1])
    direction = focus.location - cam.location
    if direction.length > 0:
        cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = float(camera_cfg.get("lens", 50))
    if cam_type in ("macro", "detail"):
        cam.data.lens = min(cam.data.lens, 50.0 if grounded else 42.0)
    cam.data.dof.use_dof = True
    cam.data.dof.focus_object = focus
    return cam


def build(args: argparse.Namespace) -> dict[str, Any]:
    if bpy is None:
        raise RuntimeError("must run inside Blender")
    workspace = Path(args.workspace).resolve()
    spec = load_spec(args.workspace, args.spec)
    scene = bpy.context.scene
    # Factory startup is the normal path, but clear the scene-owned objects as
    # well so rerunning the same preview never mixes old geometry into a new run.
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    scene.render.fps = int(spec.get("fps", 30))
    focus = bpy.data.objects.get("FOCUS-subject")
    if focus is None:
        focus = bpy.data.objects.new("FOCUS-subject", None)
        scene.collection.objects.link(focus)
    focus.location = tuple(spec.get("focus", [0.0, 0.0, 1.0]))
    scene_mode = infer_scene_mode(spec)
    storyboard_mode = str(spec.get("storyboardMode", "prompt_grounded_previs")).strip().lower() or "prompt_grounded_previs"
    semantic: dict[str, Any] | None = None
    if storyboard_mode in {"prompt_grounded_previs", "prompt_grounded_3d", "grounded_3d"} and scene_mode == "prehistoric_dinosaur":
        hero, semantic = build_prompt_grounded_scene(spec, scene_mode, focus, workspace)
        visual_assets = {item["role"]: item["objectId"] for item in semantic["components"] if item.get("role") in {"subject", "opponent", "time_rift"}}
    elif storyboard_mode in {"semantic_blockout", "semantic_storyboard", "semantic"}:
        hero, semantic = build_semantic_storyboard_scene(spec, scene_mode, focus, workspace)
        visual_assets = {item["role"]: item["objectId"] for item in semantic["components"] if item.get("role") in {"subject", "person", "camera", "action"}}
    else:
        # Kept only as an explicit compatibility mode for old saved plans.
        hero, visual_assets = build_visual_scene(scene_mode, focus)
    for obj in list(bpy.data.objects):
        if obj.name.startswith("CAM-"):
            bpy.data.objects.remove(obj, do_unlink=True)
    for col in list(bpy.data.collections):
        if col.name.startswith("SHOT-"):
            bpy.data.collections.remove(col)
    manifest = []
    total_end = 1
    render_camera_data = bpy.data.cameras.get("CAM-RENDER") or bpy.data.cameras.new("CAM-RENDER")
    render_camera = bpy.data.objects.get("CAM-RENDER") or bpy.data.objects.new("CAM-RENDER", render_camera_data)
    render_collection = get_or_create_collection("RENDER-CAMERA")
    link_only(render_camera, render_collection)
    render_camera.data.dof.use_dof = True
    render_camera.data.dof.focus_object = focus
    for index, shot in enumerate(spec["shots"], 1):
        shot_id = str(shot["shotId"])
        col = get_or_create_collection(f"SHOT-{shot_id}")
        marker = bpy.data.objects.new(f"MARKER-{shot_id}", None)
        col.objects.link(marker)
        marker.empty_display_type = "CUBE"
        marker.empty_display_size = 0.2
        marker.location = tuple(shot.get("marker", [0.0, 0.0, 1.0]))
        marker["shot_id"] = shot_id
        marker["event"] = shot.get("event", "")
        marker["visual_grammar"] = shot.get("visualGrammar", {})
        if semantic is not None and semantic.get("mode") == "prompt_grounded_previs":
            focus.location = apply_prompt_grounded_pose(semantic, grounded_role(shot, index - 1), index - 1, 0.0)
        cam = camera_for_shot(shot, index, focus, grounded=bool(semantic and semantic.get("mode") == "prompt_grounded_previs"))
        start, end = int(shot["startFrame"]), int(shot["endFrame"])
        if semantic is not None and semantic.get("mode") == "prompt_grounded_previs":
            keyframe_prompt_grounded_shot(semantic, shot, index - 1)
        # Blender 5.2 rejects keyframe_insert on Scene.camera. Bake each
        # authored shot camera into one active render camera so the MP4 really
        # changes composition across the complete timeline.
        copy_camera_pose(cam, render_camera, start)
        copy_camera_pose(cam, render_camera, end)
        scene.timeline_markers.new(shot_id, frame=start)
        scene.timeline_markers.new(f"{shot_id}_END", frame=end)
        manifest.append({
            "shotId": shot_id,
            "startFrame": start,
            "endFrame": end,
            "durationSeconds": round((end - start + 1) / scene.render.fps, 3),
            "event": shot.get("event", ""),
            "cameraObject": cam.name,
            "cameraType": shot.get("camera", {}).get("type", "medium"),
            "motion": shot.get("camera", {}).get("motion", "locked"),
            "continuityAssetIds": shot.get("continuityAssetIds", []),
            "visualAssetObjects": visual_assets,
            "storyboardMode": storyboard_mode,
            "semanticComponents": semantic["components"] if semantic else [],
            "referenceAssets": semantic["referenceAssets"] if semantic else [],
            "omniInstruction": semantic["omniInstruction"] if semantic else "Replace the procedural proxy with final provider visuals.",
            "sceneMode": scene_mode,
            "heroBinding": semantic["heroBinding"] if semantic else {"assetKind": "legacy_proxy"},
            "beats": shot.get("beats", []),
            "beatCount": len(shot.get("beats", [])) or 4,
            "beautyPassEligible": False,
            "approvalRequired": True,
        })
        total_end = max(total_end, end)
    scene.frame_start = 1
    scene.frame_end = total_end
    scene.camera = render_camera
    if semantic is None:
        # Compatibility motion for the old explicit legacy_proxy mode.
        hero_start = hero.location.copy()
        hero_rotation = hero.rotation_euler.copy()
        scene.frame_set(scene.frame_start)
        hero.location = hero_start
        hero.rotation_euler = hero_rotation
        hero.keyframe_insert(data_path="location", frame=scene.frame_start)
        hero.keyframe_insert(data_path="rotation_euler", frame=scene.frame_start)
        scene.frame_set(scene.frame_end)
        hero.location = (hero_start.x, hero_start.y + 0.45, hero_start.z - 0.35)
        hero.rotation_euler = (hero_rotation.x, hero_rotation.y, hero_rotation.z + math.radians(12.0))
        hero.keyframe_insert(data_path="location", frame=scene.frame_end)
        hero.keyframe_insert(data_path="rotation_euler", frame=scene.frame_end)
    if storyboard_mode in {"prompt_grounded_previs", "prompt_grounded_3d", "grounded_3d"} and scene_mode == "prehistoric_dinosaur":
        try:
            scene.render.engine = "BLENDER_EEVEE_NEXT"
        except Exception:
            scene.render.engine = "BLENDER_EEVEE"
    else:
        scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = int(spec.get("previewWidth", 640))
    scene.render.resolution_y = int(spec.get("previewHeight", 360))
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    # Workbench keeps the legacy semantic path fast. Prompt-grounded previews
    # use real Eevee materials/lights created above.
    if scene.render.engine == "BLENDER_WORKBENCH":
        scene.display.shading.light = "STUDIO"
        scene.display.shading.color_type = "MATERIAL"
        scene.display.shading.show_shadows = True
        scene.display.shading.show_cavity = True
        scene.display.shading.cavity_type = "WORLD"
    scene.world.color = (0.002, 0.008, 0.02)
    scene["editorial_pipeline"] = "Auto3Dvideo"
    scene["shot_count"] = len(manifest)
    scene["scene_mode"] = scene_mode
    scene["storyboard_mode"] = storyboard_mode
    scene["blockout_note"] = "Prompt-grounded procedural 3D preview: the scene applies the prompt bible, scale, identity, camera, action and lighting; production model binding remains a review gate." if semantic and semantic.get("mode") == "prompt_grounded_previs" else "Semantic 3D storyboard only: primitives encode subject, environment, prop, camera and action for Omni/provider generation."
    scene["hero_binding_status"] = semantic["heroBinding"]["status"] if semantic else "legacy_proxy"
    scene["hero_asset_kind"] = semantic["heroBinding"]["assetKind"] if semantic else "legacy_proxy"
    scene["omni_instruction"] = semantic["omniInstruction"] if semantic else "Replace procedural proxy with final provider visuals."
    scene["approval_gate"] = "human_required_before_upload"
    out_dir = workspace_path(args.workspace, args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    shot_preview_dir = out_dir / "shots"
    shot_preview_dir.mkdir(parents=True, exist_ok=True)
    preview_path = out_dir / "preview.png"
    beat_dir = out_dir / "beats"
    beat_dir.mkdir(parents=True, exist_ok=True)
    all_beat_paths: list[Path] = []
    shot_preview_paths: list[Path] = []
    edit_shots: list[dict[str, Any]] = []
    for shot in manifest:
        shot_id = str(shot["shotId"])
        shot_beat_dir = beat_dir / shot_id
        shot_beat_dir.mkdir(parents=True, exist_ok=True)
        shot_beat_paths: list[Path] = []
        edit_beats: list[dict[str, Any]] = []
        beats = normalized_beats(shot)
        for beat_index, beat in enumerate(beats):
            fraction = float(beat.get("timeFraction", beat_index / max(1, len(beats) - 1)))
            frame = int(round(int(shot["startFrame"]) + (int(shot["endFrame"]) - int(shot["startFrame"])) * max(0.0, min(1.0, fraction))))
            scene.frame_set(frame)
            semantic_state = None
            if semantic is not None:
                semantic_state = update_semantic_beat(semantic, shot, beat, manifest.index(shot), beat_index, len(beats))
                # Focus the storyboard camera on the moving semantic subject,
                # not on a fixed empty point left over from the legacy proxy.
                if semantic.get("mode") == "prompt_grounded_previs" and semantic.get("focusTarget"):
                    focus.location = tuple(semantic["focusTarget"])
                else:
                    focus.location = semantic["subject"].location.copy()
                    if semantic.get("sceneMode") == "prehistoric_dinosaur":
                        focus.location.z += 1.35
            temp_camera = still_camera_for_beat(shot, manifest.index(shot), beat, beat_index, len(beats), focus, grounded=bool(semantic and semantic.get("mode") == "prompt_grounded_previs"))
            scene.camera = temp_camera
            beat_id = str(beat.get("beatId", f"beat-{beat_index + 1:02d}"))
            beat_path = shot_beat_dir / f"{beat_id}.png"
            scene.render.filepath = str(beat_path)
            bpy.ops.render.render(write_still=True)
            shot_beat_paths.append(beat_path)
            all_beat_paths.append(beat_path)
            edit_beats.append({
                "beatId": beat_id,
                "frame": frame,
                "timeSeconds": round((frame - int(shot["startFrame"])) / scene.render.fps, 3),
                "imageRole": beat.get("imageRole", "action"),
                "purpose": beat.get("purpose", ""),
                "action": beat.get("action", ""),
                "prompt": beat.get("prompt", ""),
                "semanticState": semantic_state,
                "semanticComponents": semantic["components"] if semantic else [],
                "omniInstruction": semantic["omniInstruction"] if semantic else "Replace procedural proxy with final provider visuals.",
                "previewPath": str(beat_path),
            })
            temp_camera_data = temp_camera.data
            bpy.data.objects.remove(temp_camera, do_unlink=True)
            bpy.data.cameras.remove(temp_camera_data)
        scene.camera = render_camera
        shot_preview_path = shot_preview_dir / f"{shot['shotId']}.png"
        write_contact_sheet(shot_beat_paths, shot_preview_path, columns=min(4, max(1, len(shot_beat_paths))))
        shot_preview_paths.append(shot_preview_path)
        edit_shots.append({"shotId": shot_id, "startFrame": shot["startFrame"], "endFrame": shot["endFrame"], "durationSeconds": shot["durationSeconds"], "beats": edit_beats, "semanticComponents": semantic["components"] if semantic else [], "shotPreviewPath": str(shot_preview_path)})
    # The main preview is a complete beat contact sheet. Each shot board is
    # kept separately for the Omni handoff, so the provider receives one
    # compact multi-anchor image per shot instead of a single still.
    write_contact_sheet(all_beat_paths, preview_path, columns=4)
    edit_plan_path = out_dir / "edit-plan.json"
    edit_plan_status = "prompt_grounded_previs_ready_needs_review" if semantic and semantic.get("mode") == "prompt_grounded_previs" else "semantic_storyboard_ready_needs_provider"
    edit_plan_path.write_text(json.dumps({"schemaVersion": "1.2.0", "fps": scene.render.fps, "frameRange": [scene.frame_start, scene.frame_end], "shotCount": len(edit_shots), "beatCount": len(all_beat_paths), "storyboardMode": storyboard_mode, "sceneMode": scene_mode, "promptGrounding": semantic.get("promptGrounding", {}) if semantic else {}, "heroBinding": semantic["heroBinding"] if semantic else {"assetKind": "legacy_proxy"}, "semanticComponents": semantic["components"] if semantic else [], "referenceAssets": semantic["referenceAssets"] if semantic else [], "omniInstruction": semantic["omniInstruction"] if semantic else "Replace procedural proxy with final provider visuals.", "shots": edit_shots, "status": edit_plan_status}, ensure_ascii=False, indent=2), encoding="utf-8")
    video_path = None
    if args.render_video:
        frames_dir = out_dir / "frames"
        frames_dir.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(frames_dir / "frame_")
        bpy.ops.render.render(animation=True)
        # Blender writes numbered PNG frames; the native Rust boundary packages them with FFmpeg.
        video_path = out_dir / "blender-render.mp4"
    scene_path = out_dir / "multishot-previs.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(scene_path))
    result = {
        "schemaVersion": "1.0.0",
        "toolVersion": TOOL_VERSION,
        "projectId": spec.get("projectId"),
        "sceneOutput": str(scene_path),
        "previewOutput": str(preview_path),
        "shotPreviewOutputs": [str(path) for path in shot_preview_paths],
        "editPlanOutput": str(edit_plan_path),
        "videoOutput": str(video_path) if video_path else None,
        "fps": scene.render.fps,
        "frameRange": [scene.frame_start, scene.frame_end],
        "shotCount": len(manifest),
        "sceneMode": scene_mode,
        "heroBinding": semantic["heroBinding"] if semantic else {"assetKind": "legacy_proxy", "status": "legacy_proxy"},
        "storyboardMode": storyboard_mode,
        "semanticComponents": semantic["components"] if semantic else [],
        "referenceAssets": semantic["referenceAssets"] if semantic else [],
        "omniInstruction": semantic["omniInstruction"] if semantic else "Replace procedural proxy with final provider visuals.",
        "blockoutOnly": not (semantic and semantic.get("mode") == "prompt_grounded_previs"),
        "proceduralPreviewOnly": True,
        "shots": manifest,
        "uploadApproved": False,
        "status": "prompt_grounded_previs_needs_review" if semantic and semantic.get("mode") == "prompt_grounded_previs" else "previs_ready_needs_review",
    }
    (out_dir / "shot-manifest.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Bounded Auto3Dvideo multi-shot Blender previs builder")
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--spec", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--render-video", default="false")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    parsed = parser.parse_args(argv)
    parsed.render_video = parsed.render_video.lower() == "true"
    return parsed


if __name__ == "__main__":
    print(json.dumps(build(parse_args()), ensure_ascii=False))

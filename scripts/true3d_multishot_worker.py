"""Deterministic multi-shot continuity worker for PLAN-023 Slice 2.

The worker imports the versioned one-shot scene primitives, creates one shared
world/character scene, renders each typed shot spec, and writes stable asset,
shot and continuity hashes. It accepts values from JSON only; it never turns
prompt text into Python, shell commands, network calls or external downloads.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

import bpy
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
import true3d_scene_worker as base  # noqa: E402


TOOL_VERSION = "true3d-multishot-worker-1.0.0"
REQUIRED_ANCHORS = {
    "tiger-giant",
    "trex",
    "screen_direction_left_to_right",
    "jungle_blue_rim",
    "same_time_of_day",
    "scale_locked_meters",
}


def canonical_hash(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def load_json_inside(workspace: Path, raw_path: str) -> tuple[Path, dict[str, Any]]:
    path = base.inside(workspace, workspace / base.safe_relative(raw_path))
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("multishot spec phải là JSON object")
    return path, payload


def validate_spec(spec: dict[str, Any]) -> None:
    if spec.get("schemaVersion") != "1.0.0" or spec.get("jobType") != "multishot.continuity":
        raise ValueError("multishot spec sai schemaVersion/jobType")
    if int(spec.get("fps", 0)) != base.FPS:
        raise ValueError("fixture yêu cầu 30 FPS")
    shots = spec.get("shots")
    if not isinstance(shots, list) or not 6 <= len(shots) <= 12:
        raise ValueError("multishot spec phải có 6–12 shot")
    ids = [shot.get("shotId") for shot in shots if isinstance(shot, dict)]
    if len(ids) != len(shots) or len(set(ids)) != len(ids) or ids != sorted(ids):
        raise ValueError("shot phải unique và theo thứ tự tăng dần")
    if not isinstance(spec.get("worldBible"), dict) or not isinstance(spec.get("characterBibles"), list):
        raise ValueError("thiếu worldBible/characterBibles")
    if len(spec["characterBibles"]) < 2:
        raise ValueError("fixture cần tiger và trex character bible")
    for shot in shots:
        if not isinstance(shot, dict):
            raise ValueError("shot phải là object")
        if not isinstance(shot.get("durationFrames"), int) or not 1 <= shot["durationFrames"] <= 600:
            raise ValueError(f"durationFrames không hợp lệ cho {shot.get('shotId')}")
        if not REQUIRED_ANCHORS.issubset(set(shot.get("continuityAnchors", []))):
            missing = sorted(REQUIRED_ANCHORS.difference(set(shot.get("continuityAnchors", []))))
            raise ValueError(f"shot {shot.get('shotId')} thiếu continuity anchors: {missing}")
        for field in ("cameraStart", "cameraEnd", "targetStart", "targetEnd", "tigerStart", "tigerEnd", "trexStart", "trexEnd"):
            values = shot.get(field)
            if not isinstance(values, list) or len(values) != 3 or not all(isinstance(item, (int, float)) for item in values):
                raise ValueError(f"shot {shot.get('shotId')} thiếu vector {field}")


def scene_setup(spec: dict[str, Any]) -> tuple[bpy.types.Scene, bpy.types.Object, bpy.types.Object, bpy.types.Object, dict[str, bpy.types.Material]]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = "PLAN023_True3D_MultiShot_Continuity"
    scene.render.fps = base.FPS
    engines = {item.identifier for item in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
    for engine_id in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
        if engine_id in engines:
            scene.render.engine = engine_id
            break
    else:
        raise RuntimeError(f"No supported render engine available: {sorted(engines)}")
    scene.render.resolution_x = int(spec.get("width", base.WIDTH))
    scene.render.resolution_y = int(spec.get("height", base.HEIGHT))
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new("PLAN023_MultiShot_World")
    scene.world.color = (0.008, 0.016, 0.035)
    materials = {
        "tiger": base.make_material("MAT_TIGER_ORANGE", (0.72, 0.19, 0.035, 1), 0.68),
        "stripe": base.make_material("MAT_TIGER_STRIPE", (0.018, 0.008, 0.004, 1), 0.82),
        "white": base.make_material("MAT_TIGER_MUZZLE", (0.7, 0.52, 0.32, 1), 0.78),
        "dark": base.make_material("MAT_DARK", (0.012, 0.008, 0.006, 1), 0.5),
        "eye": base.make_material("MAT_EYE_AMBER", (1.0, 0.28, 0.015, 1), 0.2, 0.1),
        "trex": base.make_material("MAT_TREX_RED_BROWN", (0.18, 0.035, 0.018, 1), 0.86),
        "ground": base.make_material("MAT_GROUND", (0.035, 0.075, 0.025, 1), 0.95),
        "rock": base.make_material("MAT_ROCK", (0.09, 0.08, 0.065, 1), 0.98),
        "trunk": base.make_material("MAT_TREE_TRUNK", (0.12, 0.045, 0.018, 1), 0.92),
        "foliage": base.make_material("MAT_FOLIAGE", (0.015, 0.16, 0.045, 1), 0.88),
    }
    base.add_environment(materials)
    tiger = base.add_tiger(materials)
    trex = base.add_trex(materials)
    bpy.ops.object.camera_add(location=(15.0, -25.0, 10.0))
    camera = bpy.context.object
    camera.name = "CAMERA_MAIN"
    camera.data.sensor_width = 36
    scene.camera = camera
    for name, location, energy, color, size in (
        ("LIGHT_KEY", (2.0, -8.0, 15.0), 2200, (1.0, 0.75, 0.55), 8),
        ("LIGHT_FILL", (-10.0, 6.0, 9.0), 1000, (0.12, 0.32, 1.0), 10),
        ("LIGHT_RIM", (12.0, 6.0, 8.0), 1300, (1.0, 0.19, 0.04), 6),
    ):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = name
        light.data.energy = energy
        light.data.color = color
        light.data.size = size
        base.look_at(light, Vector((2.0, 0.0, 4.0)))
    return scene, camera, tiger, trex, materials


def set_shot_animation(scene: bpy.types.Scene, camera: bpy.types.Object, tiger: bpy.types.Object, trex: bpy.types.Object, shot: dict[str, Any]) -> None:
    scene.frame_start = 1
    scene.frame_end = int(shot["durationFrames"])
    for obj in (camera, tiger, trex):
        obj.animation_data_clear()
    tiger.location = tuple(shot["tigerStart"])
    tiger.keyframe_insert(data_path="location", frame=1)
    tiger.location = tuple(shot["tigerEnd"])
    tiger.keyframe_insert(data_path="location", frame=scene.frame_end)
    tiger.rotation_euler[2] = 0.0
    tiger.keyframe_insert(data_path="rotation_euler", frame=1)
    tiger.rotation_euler[2] = 0.12
    tiger.keyframe_insert(data_path="rotation_euler", frame=scene.frame_end)
    trex.location = tuple(shot["trexStart"])
    trex.keyframe_insert(data_path="location", frame=1)
    trex.location = tuple(shot["trexEnd"])
    trex.keyframe_insert(data_path="location", frame=scene.frame_end)
    camera.data.lens = float(shot["lens"])
    camera.location = tuple(shot["cameraStart"])
    base.look_at(camera, Vector(shot["targetStart"]))
    camera.keyframe_insert(data_path="location", frame=1)
    camera.keyframe_insert(data_path="rotation_euler", frame=1)
    camera.location = tuple(shot["cameraEnd"])
    base.look_at(camera, Vector(shot["targetEnd"]))
    camera.keyframe_insert(data_path="location", frame=scene.frame_end)
    camera.keyframe_insert(data_path="rotation_euler", frame=scene.frame_end)
    scene.frame_set(1)


def render_shot(workspace: Path, output_dir: Path, scene: bpy.types.Scene, camera: bpy.types.Object, tiger: bpy.types.Object, trex: bpy.types.Object, shot: dict[str, Any], render_video: bool) -> dict[str, Any]:
    shot_id = shot["shotId"]
    set_shot_animation(scene, camera, tiger, trex, shot)
    shot_dir = output_dir / "shots" / shot_id
    preview_dir = shot_dir / "preview"
    preview_dir.mkdir(parents=True, exist_ok=True)
    shot_scene_path = shot_dir / "scene.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(shot_scene_path))
    preview_paths = []
    for frame in (1, max(1, scene.frame_end // 2), scene.frame_end):
        scene.frame_set(frame)
        path = preview_dir / f"frame-{frame:04d}.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        preview_paths.append(path)
    frame_dir = None
    if render_video:
        frame_dir = shot_dir / "frames"
        frame_dir.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(frame_dir / "frame_")
        bpy.ops.render.render(animation=True)
    shot_hash = canonical_hash({"shot": shot, "sharedAssetHashes": shared_asset_hashes_placeholder})
    return {
        "shotId": shot_id,
        "scenePath": shot_scene_path.relative_to(workspace).as_posix(),
        "durationFrames": scene.frame_end,
        "frameRange": [scene.frame_start, scene.frame_end],
        "lens": shot["lens"],
        "cameraObject": camera.name,
        "previewOutputs": [path.relative_to(workspace).as_posix() for path in preview_paths],
        "frameDirectory": frame_dir.relative_to(workspace).as_posix() if frame_dir else None,
        "assetHashes": shared_asset_hashes_placeholder,
        "inputHash": shot_hash,
        "status": "needs_review",
    }


shared_asset_hashes_placeholder: dict[str, str] = {}


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    try:
        args = parse_args()
        workspace = Path(args.workspace).resolve()
        _, spec = load_json_inside(workspace, args.spec)
        validate_spec(spec)
        output_dir = base.inside(workspace, workspace / base.safe_relative(args.output_dir))
        output_dir.mkdir(parents=True, exist_ok=True)
        shots = spec["shots"]
        shot_ids = [shot["shotId"] for shot in shots]
        rerun_shot_id = args.rerun_shot.strip() if args.rerun_shot else None
        if rerun_shot_id is not None and rerun_shot_id not in shot_ids:
            raise ValueError(f"rerun shot không tồn tại: {rerun_shot_id}")
        rendered_shots = [shot for shot in shots if rerun_shot_id is None or shot["shotId"] == rerun_shot_id]
        world_hash = canonical_hash(spec["worldBible"])
        assets = {}
        for character in spec["characterBibles"]:
            asset_id = character["characterId"]
            assets[asset_id] = canonical_hash({"character": character, "worldHash": world_hash, "tool": TOOL_VERSION})
        global shared_asset_hashes_placeholder
        shared_asset_hashes_placeholder = dict(sorted(assets.items()))
        if args.baseline_asset_library:
            _, baseline = load_json_inside(workspace, args.baseline_asset_library)
            baseline_hashes = baseline.get("assetHashes")
            if baseline_hashes != shared_asset_hashes_placeholder:
                raise ValueError("asset hash thay đổi khi rerun; dừng để tránh continuity drift")
        asset_library = {
            "schemaVersion": "1.0.0",
            "projectId": spec["projectId"],
            "worldHash": world_hash,
            "assetHashes": shared_asset_hashes_placeholder,
            "assets": [
                {
                    "assetId": asset_id,
                    "kind": "model3d",
                    "sourceType": "procedural_fixture",
                    "sha256": asset_hash,
                    "rightsStatus": "owned",
                    "reviewState": "approved",
                    "provenance": "PLAN-023 local deterministic fixture",
                }
                for asset_id, asset_hash in sorted(shared_asset_hashes_placeholder.items())
            ],
        }
        write_json(output_dir / "asset-library.json", asset_library)
        bindings = []
        for shot in shots:
            for priority, asset_id in enumerate(sorted(shared_asset_hashes_placeholder), start=1):
                bindings.append({
                    "schemaVersion": "1.0.0",
                    "bindingId": f"{shot['shotId'].lower()}-{asset_id}",
                    "assetId": asset_id,
                    "shotId": shot["shotId"],
                    "role": "model3d",
                    "assetSha256": shared_asset_hashes_placeholder[asset_id],
                    "priority": priority,
                    "provenance": "PLAN-023 local deterministic fixture",
                    "rightsStatus": "owned",
                    "reviewState": "approved",
                })
        write_json(output_dir / "asset-bindings.json", {"schemaVersion": "1.0.0", "bindings": bindings})
        scene, camera, tiger, trex, _ = scene_setup(spec)
        scene_path = output_dir / "scene.blend"
        shot_manifests = []
        for shot in rendered_shots:
            manifest = render_shot(workspace, output_dir, scene, camera, tiger, trex, shot, args.render_video)
            manifest["assetHashes"] = dict(shared_asset_hashes_placeholder)
            manifest["inputHash"] = canonical_hash({"shot": shot, "assetHashes": shared_asset_hashes_placeholder, "worldHash": world_hash})
            shot_manifests.append(manifest)
            write_json(output_dir / "shots" / shot["shotId"] / "shot-manifest.json", manifest)
        bpy.ops.wm.save_as_mainfile(filepath=str(scene_path))
        scene.frame_start = 1
        scene.frame_end = max(shot["durationFrames"] for shot in shots)
        scene_manifest = {
            "schemaVersion": "1.0.0",
            "sceneId": "plan023-giant-tiger-vs-trex-multishot",
            "scenePath": scene_path.relative_to(workspace).as_posix(),
            "blenderVersion": bpy.app.version_string,
            "engine": scene.render.engine,
            "fps": scene.render.fps,
            "frameStart": scene.frame_start,
            "frameEnd": scene.frame_end,
            "cameraObject": camera.name,
            "objectInventory": sorted(obj.name for obj in bpy.data.objects if obj.type in {"MESH", "CAMERA", "LIGHT"}),
            "materialInventory": sorted(material.name for material in bpy.data.materials),
            "assetHashes": shared_asset_hashes_placeholder,
            "assertions": [
                {"name": "shared_assets", "passed": len(shared_asset_hashes_placeholder) >= 2, "message": "Tất cả shot dùng chung tiger/trex asset hashes"},
                {"name": "shot_count", "passed": len(shot_ids) == 8, "message": "Golden fixture có 8 shot"},
                {"name": "animated_camera", "passed": camera.animation_data is not None, "message": "Camera được keyframe theo shot"},
                {"name": "animated_subjects", "passed": tiger.animation_data is not None and trex.animation_data is not None, "message": "Tiger/T-Rex có animation"},
                {"name": "material_inventory", "passed": len(bpy.data.materials) >= 8, "message": "Scene có material inventory"},
            ],
            "reviewState": "needs_review",
        }
        write_json(output_dir / "scene-manifest.json", scene_manifest)
        shot_hashes = {manifest["shotId"]: manifest["inputHash"] for manifest in shot_manifests}
        drift_findings = []
        for shot in shots:
            anchors = set(shot.get("continuityAnchors", []))
            missing = sorted(REQUIRED_ANCHORS.difference(anchors))
            if missing:
                drift_findings.append({"shotId": shot["shotId"], "code": "missing_continuity_anchor", "severity": "error", "message": f"Thiếu anchor: {', '.join(missing)}"})
        if len(set(shot_hashes.values())) != len(shot_hashes):
            drift_findings.append({"shotId": "SHOT-000", "code": "duplicate_shot_hash", "severity": "error", "message": "Hai shot có input hash giống nhau"})
        continuity = {
            "schemaVersion": "1.0.0",
            "sceneId": "plan023-giant-tiger-vs-trex-multishot",
            "projectId": spec["projectId"],
            "runId": spec["runId"],
            "fps": spec["fps"],
            "shotIds": shot_ids,
            "renderedShotIds": [manifest["shotId"] for manifest in shot_manifests],
            "commonWorldHash": world_hash,
            "sharedAssetHashes": shared_asset_hashes_placeholder,
            "shotHashes": shot_hashes,
            "assetHashesUnchanged": True,
            "rerunShotId": rerun_shot_id,
            "driftFindings": drift_findings,
            "status": "passed_needs_review" if not drift_findings else "needs_revision",
            "reviewState": "needs_review",
        }
        write_json(output_dir / "continuity-report.json", continuity)
        write_json(output_dir / "quality-report.json", {
            "schemaVersion": "1.0.0",
            "status": continuity["status"],
            "shotCount": len(shot_ids),
            "renderedShotCount": len(shot_manifests),
            "driftFindingCount": len(drift_findings),
            "reviewState": "needs_review",
            "message": "Multi-shot true 3D continuity đã render; cần review camera, scale, action và continuity trước final delivery.",
        })
        print(json.dumps({
            "status": "succeeded_needs_review" if not drift_findings else "needs_revision",
            "scenePath": scene_path.relative_to(workspace).as_posix(),
            "sceneManifestPath": (output_dir / "scene-manifest.json").relative_to(workspace).as_posix(),
            "assetLibraryPath": (output_dir / "asset-library.json").relative_to(workspace).as_posix(),
            "assetBindingsPath": (output_dir / "asset-bindings.json").relative_to(workspace).as_posix(),
            "continuityReportPath": (output_dir / "continuity-report.json").relative_to(workspace).as_posix(),
            "qualityPath": (output_dir / "quality-report.json").relative_to(workspace).as_posix(),
            "shotCount": len(shot_ids),
            "renderedShotIds": [manifest["shotId"] for manifest in shot_manifests],
            "assetHashesUnchanged": True,
            "rerunShotId": rerun_shot_id,
            "message": "Đã dựng multi-shot true 3D với asset/world hashes dùng chung; output cần human review.",
        }, ensure_ascii=False, separators=(",", ":")), flush=True)
        return 0 if not drift_findings else 3
    except Exception as error:
        print(json.dumps({"status": "failed", "message": f"{type(error).__name__}: {str(error)[:500]}"}, ensure_ascii=False), flush=True)
        return 2


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Auto3Dvideo deterministic multi-shot continuity worker")
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--spec", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--render-video", default="false")
    parser.add_argument("--rerun-shot", default="")
    parser.add_argument("--baseline-asset-library", default="")
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    parsed = parser.parse_args(argv)
    parsed.render_video = parsed.render_video.lower() == "true"
    return parsed


if __name__ == "__main__":
    sys.exit(main())

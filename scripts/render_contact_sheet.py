"""Render one representative frame per shot for local visual QA.

Runs inside Blender. It intentionally renders small review frames, not final
video. It does not download, upload or execute arbitrary code.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy


def workspace_path(workspace: str, candidate: str, must_exist: bool = False) -> Path:
    root = Path(workspace).resolve()
    path = (root / candidate).resolve() if not Path(candidate).is_absolute() else Path(candidate).resolve()
    path.relative_to(root)
    if must_exist and not path.exists():
        raise FileNotFoundError(str(path))
    return path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render bounded multi-shot contact sheet frames")
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--scene", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output-dir", required=True)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    return parser.parse_args(argv)


def main(args: argparse.Namespace) -> None:
    workspace = Path(args.workspace).resolve()
    scene_path = workspace_path(args.workspace, args.scene, True)
    manifest_path = workspace_path(args.workspace, args.manifest, True)
    output_dir = workspace_path(args.workspace, args.output_dir)
    frames_dir = output_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=str(scene_path))
    scene = bpy.context.scene
    original_x, original_y, original_percentage = scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage
    scene.render.resolution_x = 270
    scene.render.resolution_y = 480
    scene.render.resolution_percentage = 100
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    samples = []
    for index, shot in enumerate(manifest["shots"], 1):
        start, end = int(shot["startFrame"]), int(shot["endFrame"])
        frame = (start + end) // 2
        scene.frame_set(frame)
        camera_name = shot.get("cameraObject")
        camera = bpy.data.objects.get(camera_name) if camera_name else None
        if camera is None:
            raise ValueError(f"missing camera for shot {shot['shotId']}: {camera_name}")
        scene.camera = camera
        scene.render.filepath = str(frames_dir / f"frame_{index:02d}.png")
        bpy.ops.render.render(write_still=True)
        samples.append({"shotId": shot["shotId"], "frame": frame, "path": f"frames/frame_{index:02d}.png", "camera": camera.name})
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = original_x, original_y, original_percentage
    evidence = {"schemaVersion": "1.0.0", "status": "contact_frames_rendered", "frameCount": len(samples), "samples": samples, "finalRender": False, "humanReviewRequired": True}
    (output_dir / "contact-sheet-evidence.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False))


if __name__ == "__main__":
    main(parse_args())

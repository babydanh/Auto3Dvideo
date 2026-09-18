"""Render the bounded Moon story Blender scene to a PNG frame sequence.

Blender 5.2.1 exposes the FFMPEG enum inconsistently after loading a project blend,
so this worker deliberately renders deterministic PNG frames. FFmpeg composes the
sequence into MP4 in a separate bounded step.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import bpy


def safe_relative(raw: str) -> Path:
    value = raw.strip().replace("\\", "/")
    path = Path(value)
    if not value or path.is_absolute() or "://" in value or (len(value) > 1 and value[1] == ":"):
        raise ValueError("path phải là relative workspace path")
    if any(part in {"", ".", ".."} for part in value.split("/")):
        raise ValueError("path chứa segment không an toàn")
    return path


def parse_args() -> Path:
    if "--" not in sys.argv:
        raise ValueError("Cần source blend và output frames directory sau --")
    args = sys.argv[sys.argv.index("--") + 1 :]
    if len(args) != 2:
        raise ValueError("Cần đúng 2 path")
    source = safe_relative(args[0])
    frames_dir = safe_relative(args[1])
    if source.suffix.lower() != ".blend":
        raise ValueError("source phải là .blend")
    return source, frames_dir


def main() -> int:
    try:
        source_relative, frames_relative = parse_args()
        workspace = Path.cwd().resolve()
        source = (workspace / source_relative).resolve()
        frames_dir = (workspace / frames_relative).resolve()
        if workspace not in source.parents or workspace not in frames_dir.parents:
            raise ValueError("path vượt workspace")
        if not source.is_file():
            raise ValueError("source blend không tồn tại")
        frames_dir.mkdir(parents=True, exist_ok=True)
        if any(frames_dir.iterdir()):
            raise ValueError("frames directory đã có file; không overwrite")
        bpy.ops.wm.open_mainfile(filepath=os.fspath(source))
        scene = bpy.context.scene
        scene.frame_start = 1
        scene.frame_end = 900
        scene.render.fps = 30
        scene.render.resolution_x = 540
        scene.render.resolution_y = 960
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = os.fspath(frames_dir / "frame-")
        bpy.ops.render.render(animation=True)
        result = {
            "status": "succeeded",
            "framesPath": frames_relative.as_posix(),
            "framePattern": f"{frames_relative.as_posix()}/frame-####.png",
            "frameStart": scene.frame_start,
            "frameEnd": scene.frame_end,
            "fps": scene.render.fps,
            "width": scene.render.resolution_x,
            "height": scene.render.resolution_y,
            "audio": "none",
            "networkCallsMade": False,
            "message": "Đã render PNG sequence từ scene true 3D; FFmpeg sẽ compose MP4 ở bước kế tiếp.",
        }
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")), flush=True)
        return 0
    except Exception as error:
        print(json.dumps({"status": "failed", "networkCallsMade": False, "message": f"{type(error).__name__}: {str(error)[:600]}"}, ensure_ascii=False), flush=True)
        return 2


if __name__ == "__main__":
    sys.exit(main())

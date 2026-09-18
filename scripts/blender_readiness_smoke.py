"""Bounded Blender readiness smoke for Auto3Dvideo.

This script is a versioned project fixture. It creates only an app-owned empty blend
file under the project workspace and does not access network, credentials, or user
media.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import bpy


def relative_output() -> Path:
    marker = "--"
    if marker not in sys.argv:
        raise RuntimeError("Thiếu output path sau --")
    index = sys.argv.index(marker) + 1
    if index >= len(sys.argv):
        raise RuntimeError("Thiếu output path")
    raw = sys.argv[index].replace("\\", "/")
    path = Path(raw)
    if path.is_absolute() or "://" in raw or any(part in {"", ".", ".."} for part in raw.split("/")):
        raise RuntimeError("output phải là path tương đối an toàn")
    if path.suffix.lower() != ".blend":
        raise RuntimeError("output phải là .blend")
    return path


def main() -> None:
    workspace = Path.cwd().resolve()
    output = workspace / relative_output()
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 64
    scene.render.resolution_y = 64
    scene.render.resolution_percentage = 25
    scene["auto3dvideo_smoke"] = "blender_readiness"
    bpy.ops.wm.save_as_mainfile(filepath=os.fspath(output))
    print(f"AUTO3DVIDEO_BLENDER_SMOKE_OK output={output.relative_to(workspace).as_posix()}", flush=True)


if __name__ == "__main__":
    main()

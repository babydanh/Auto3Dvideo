"""Inspect only Blender render API names for compatibility; no file writes/network."""
from __future__ import annotations
import json
import sys
from pathlib import Path
import bpy

if "--" in sys.argv and len(sys.argv) > sys.argv.index("--") + 1:
    raw = sys.argv[sys.argv.index("--") + 1].replace("\\", "/")
    source = Path(raw)
    if source.is_absolute() or any(part in {"", ".", ".."} for part in raw.split("/") if part):
        raise RuntimeError("source phải là relative path")
    bpy.ops.wm.open_mainfile(filepath=str((Path.cwd() / source).resolve()))
scene = bpy.context.scene
render = scene.render
assignment = "not_attempted"
try:
    render.image_settings.file_format = "FFMPEG"
    assignment = "ok"
except Exception as error:
    assignment = f"failed:{type(error).__name__}:{str(error)[:180]}"
print(json.dumps({
    "blender": bpy.app.version_string,
    "renderProperties": [name for name in dir(render) if "format" in name.lower() or "movie" in name.lower() or "ffmpeg" in name.lower() or "file" in name.lower()],
    "imageFormatProperties": [name for name in dir(render.image_settings) if "format" in name.lower() or "file" in name.lower()],
    "imageFormatEnum": list(render.image_settings.bl_rna.properties["file_format"].enum_items.keys()),
    "ffmpegAssignment": assignment,
    "isMovieFormat": render.is_movie_format,
    "fileExtension": render.file_extension,
    "ffmpegProperties": [name for name in dir(render.ffmpeg) if not name.startswith("_")],
}, separators=(",", ":")), flush=True)

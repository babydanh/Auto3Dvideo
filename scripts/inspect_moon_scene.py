"""Print bounded transform metadata for the Moon story scene; no writes or network."""
from __future__ import annotations
import json
import sys
from pathlib import Path
import bpy
from bpy_extras.object_utils import world_to_camera_view

if "--" not in sys.argv or len(sys.argv) <= sys.argv.index("--") + 1:
    raise RuntimeError("Thiếu blend path")
raw = sys.argv[sys.argv.index("--") + 1].replace("\\", "/")
path = Path(raw)
if path.is_absolute() or "://" in raw or any(part in {"", ".", ".."} for part in raw.split("/") if part):
    raise RuntimeError("blend path phải tương đối")
bpy.ops.wm.open_mainfile(filepath=str((Path.cwd() / path).resolve()))
scene = bpy.context.scene
moon = bpy.data.objects.get("Moon_Persistent")
earth = bpy.data.objects.get("Earth_Persistent")
camera = bpy.data.objects.get("Story_Camera")
for frame in (60, 195, 345, 510, 600, 690, 840):
    scene.frame_set(frame)
    moon_screen = world_to_camera_view(scene, camera, moon.matrix_world.translation)
    earth_screen = world_to_camera_view(scene, camera, earth.matrix_world.translation)
    print(json.dumps({"frame": frame, "moon": tuple(round(value, 3) for value in moon.matrix_world.translation), "earth": tuple(round(value, 3) for value in earth.matrix_world.translation), "camera": tuple(round(value, 3) for value in camera.matrix_world.translation), "moonScreen": tuple(round(value, 3) for value in moon_screen), "earthScreen": tuple(round(value, 3) for value in earth_screen)}, separators=(",", ":")), flush=True)

"""Static contract/safety regression checks for the PLAN-023 Blender worker."""

from __future__ import annotations

import ast
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONTRACTS = (
    "true-3d-run.schema.json",
    "world-bible.schema.json",
    "character-bible.schema.json",
    "asset-binding.schema.json",
    "scene-manifest.schema.json",
    "shot-production.schema.json",
)


def main() -> None:
    for name in CONTRACTS:
        payload = json.loads((ROOT / "contracts" / name).read_text(encoding="utf-8"))
        assert payload["$schema"].endswith("draft/2020-12/schema"), name
        assert payload["additionalProperties"] is False, name
        assert "required" in payload, name

    source_path = ROOT / "scripts" / "true3d_scene_worker.py"
    source = source_path.read_text(encoding="utf-8")
    ast.parse(source, filename=str(source_path))
    lowered = source.lower()
    for forbidden in ("subprocess", "socket", "requests", "os.system", "eval(", "exec("):
        assert forbidden not in lowered, forbidden
    for required in ("scene.build", "TIGER_ROOT", "TREX_ROOT", "CAMERA_MAIN", "scene-manifest.json", "quality-report.json"):
        assert required in source, required

    print("TRUE3D_SCENE_WORKER_STATIC_VALID")


if __name__ == "__main__":
    main()

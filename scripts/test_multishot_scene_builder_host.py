from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from multishot_scene_builder import load_spec  # noqa: E402


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    spec = load_spec(str(root), "configs/pilot-space-10shot.json")
    assert len(spec["shots"]) == 10
    assert spec["shots"][0]["startFrame"] == 1
    assert spec["shots"][-1]["endFrame"] == 450
    assert all(shot["continuityAssetIds"] for shot in spec["shots"])
    print("MULTISHOT_HOST_TESTS_PASS=4")

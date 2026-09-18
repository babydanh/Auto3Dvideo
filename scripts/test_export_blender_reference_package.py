from __future__ import annotations

import json
import tempfile
from pathlib import Path
from types import SimpleNamespace

from export_blender_reference_package import build_package, contained


def test_package_and_hash():
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        scene = root / "scene.blend"
        preview = root / "preview.png"
        scene.write_bytes(b"scene")
        preview.write_bytes(b"preview")
        args = SimpleNamespace(
            workspace=str(root),
            scene="scene.blend",
            preview="preview.png",
            output_dir="packages",
            shot_id="S01",
            frame_start=1,
            frame_end=30,
            camera_intent="slow push-in",
            motion_intent="subject reveal",
            continuity_notes="keep cyan rim and subject scale",
        )
        result = build_package(args)
        output = root / result["output"]
        data = json.loads(output.read_text(encoding="utf-8"))
        assert data["rights"]["uploadApproved"] is False
        assert data["rights"]["reuseOriginalMedia"] is False
        assert data["files"][0]["sha256"]
        assert data["reviewState"] == "needs_review"


def test_containment_rejects_escape():
    with tempfile.TemporaryDirectory() as temp:
        try:
            contained(Path(temp), "../outside.blend", must_exist=False)
        except ValueError:
            pass
        else:
            raise AssertionError("escape path accepted")


if __name__ == "__main__":
    test_package_and_hash()
    test_containment_rejects_escape()
    print("BLENDER_REFERENCE_PACKAGE_TESTS_PASS=2")

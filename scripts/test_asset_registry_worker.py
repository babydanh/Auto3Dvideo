from __future__ import annotations

import json
import tempfile
from pathlib import Path
from types import SimpleNamespace

from asset_registry_worker import build_record, contained


def test_registers_model_without_approving_rights():
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        asset = root / "hero.blend"
        asset.write_bytes(b"deterministic blend fixture")
        args = SimpleNamespace(
            workspace=str(root),
            asset_path="hero.blend",
            output="registry/hero.json",
            asset_id="hero-moon",
            project_id="moon-project",
            rights_status="unknown",
            source_uri=None,
        )
        record = build_record(args)
        saved = json.loads((root / "registry/hero.json").read_text(encoding="utf-8"))
        assert record == saved
        assert saved["kind"] == "model3d"
        assert saved["status"] == "rights_pending"
        assert saved["rightsStatus"] == "unknown"
        assert len(saved["sha256"]) == 64
        assert saved["qualityReviewState"] == "needs_review"


def test_rejects_unsupported_extension_and_escape():
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        (root / "bad.txt").write_text("x", encoding="utf-8")
        args = SimpleNamespace(workspace=str(root), asset_path="bad.txt", output="out.json", asset_id="bad-asset", project_id="demo-project", rights_status="unknown", source_uri=None)
        try:
            build_record(args)
        except ValueError as exc:
            assert "extension" in str(exc)
        else:
            raise AssertionError("unsupported extension accepted")
        try:
            contained(root, "../escape.blend", must_exist=False)
        except ValueError:
            pass
        else:
            raise AssertionError("escape path accepted")


if __name__ == "__main__":
    test_registers_model_without_approving_rights()
    test_rejects_unsupported_extension_and_escape()
    print("ASSET_REGISTRY_WORKER_TESTS_PASS=2")

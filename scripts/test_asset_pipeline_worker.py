"""Host-side tests for the local asset pipeline workers."""
from __future__ import annotations

import ast
import json
import tempfile
from pathlib import Path
from types import SimpleNamespace

from asset_pipeline_worker import build_report, merge_quality


def png_fixture(path: Path, width: int = 32, height: int = 16) -> None:
    import struct
    import zlib

    raw = b"\x00" + b"\x00\x00\x00\xff" * width
    pixels = raw * height
    def chunk(name: bytes, value: bytes) -> bytes:
        import binascii
        return struct.pack(">I", len(value)) + name + value + struct.pack(">I", binascii.crc32(name + value) & 0xFFFFFFFF)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b""))


def spec_for(root: Path) -> dict:
    return {
        "schemaVersion": "1.0.0",
        "jobType": "asset.ingest",
        "projectId": "asset-test-project",
        "runId": "asset-test-run",
        "assets": [
            {"assetId": "tiger-reference", "title": "Tiger reference", "sourcePath": "input/tiger.png", "declaredKind": "reference_image", "role": "identity", "rightsStatus": "owned", "reviewState": "needs_review", "shotIds": ["SHOT-001"], "provenance": "local fixture"},
            {"assetId": "pending-reference", "title": "Pending reference", "sourcePath": "input/pending.png", "declaredKind": "reference_image", "role": "composition", "rightsStatus": "pending", "reviewState": "needs_review", "shotIds": ["SHOT-001"], "provenance": "unknown source"},
        ],
    }


def test_classifies_hashes_and_quarantines_rights():
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        (root / "input").mkdir()
        png_fixture(root / "input/tiger.png")
        png_fixture(root / "input/pending.png", 8, 8)
        output = root / "run"
        report = build_report(spec_for(root), root, output)
        assert report["status"] == "blocked"
        assert report["assetCounts"] == {"total": 2, "ready": 1, "quarantined": 1, "referenceImages": 2, "models3d": 0, "textures": 0, "renders": 0}
        ready = next(item for item in report["assets"] if item["assetId"] == "tiger-reference")
        blocked = next(item for item in report["assets"] if item["assetId"] == "pending-reference")
        assert ready["kind"] == "image" and ready["width"] == 32 and len(ready["sha256"]) == 64
        assert blocked["status"] == "quarantined" and blocked["quarantineReason"] == "rights_pending"
        assert next(item for item in report["bindings"] if item["assetId"] == "pending-reference")["reviewState"] == "blocked"


def test_rejects_kind_mismatch_and_merges_quality():
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        (root / "input").mkdir()
        png_fixture(root / "input/tiger.png")
        spec = spec_for(root)
        spec["assets"] = [dict(spec["assets"][0], declaredKind="model3d", role="model3d")]
        report = build_report(spec, root, root / "run")
        assert report["assets"][0]["status"] == "quarantined"
        assert "declared_kind_mismatch" in report["assets"][0]["issues"]
        quality = {"qualityChecks": [{"assetId": "tiger-reference", "qualityState": "pass", "normalizationState": "lookdev_applied", "reportPath": "run/q.json", "normalizedRelativePath": "run/normalized.blend", "issues": []}]}
        merged = merge_quality(report, quality, root, root / "run")
        assert merged["status"] == "blocked"


def test_workers_do_not_have_network_or_shell_surface():
    for name in ("asset_pipeline_worker.py", "blender_asset_quality_worker.py"):
        source = (Path(__file__).resolve().parent / name).read_text(encoding="utf-8")
        tree = ast.parse(source)
        imported = {alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names}
        imported.update({alias.name for node in ast.walk(tree) if isinstance(node, ast.ImportFrom) for alias in node.names})
        assert not imported.intersection({"subprocess", "socket", "requests", "urllib"})
        calls = {node.func.id for node in ast.walk(tree) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)}
        assert not calls.intersection({"eval", "exec", "system"})


if __name__ == "__main__":
    test_classifies_hashes_and_quarantines_rights()
    test_rejects_kind_mismatch_and_merges_quality()
    test_workers_do_not_have_network_or_shell_surface()
    print("ASSET_PIPELINE_WORKER_STATIC_VALID")

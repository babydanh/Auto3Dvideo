from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

WORKER = Path(__file__).with_name("browser_handoff_worker.py")


def base_request() -> dict:
    return {
        "schemaVersion": "1.0.0",
        "handoffId": "handoff-demo-001",
        "projectId": "project-demo-001",
        "provider": "browsermcp",
        "operation": "prepare_web_handoff",
        "targetUrl": "https://aistudio.google.com/",
        "allowedHosts": ["aistudio.google.com"],
        "inputPaths": [{"relativePath": "assets/animatic.mp4", "mediaKind": "video"}],
        "prompt": "Refine this Blender animatic. Preserve object identity, event order, camera direction and composition. Keep everything else the same.",
        "outputDirectory": "outputs/browser-handoff/handoff-demo-001",
        "approval": {"upload": False, "generate": False, "import": False},
        "policy": {
            "networkRequired": True,
            "paidGeneration": False,
            "humanReviewRequired": True,
            "externalPublish": False,
            "rightsStatus": "generated_local",
            "termsReviewed": False,
        },
    }


def run_request(root: Path, request: dict) -> subprocess.CompletedProcess[str]:
    request_path = root / ".auto3dvideo" / "requests" / "request.json"
    request_path.parent.mkdir(parents=True, exist_ok=True)
    request_path.write_text(json.dumps(request), encoding="utf-8")
    return subprocess.run(
        [sys.executable, str(WORKER), "--workspace", str(root), "--request", ".auto3dvideo/requests/request.json"],
        text=True,
        capture_output=True,
        check=False,
    )


def test_prepare_hash_and_state() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        asset = root / "assets" / "animatic.mp4"
        asset.parent.mkdir(parents=True)
        asset.write_bytes(b"synthetic blender animatic")
        result = run_request(root, base_request())
        assert result.returncode == 0, result.stderr
        report = json.loads(result.stdout)
        assert report["status"] == "prepared"
        assert report["state"] == "prepared"
        assert report["networkCallsMade"] is False
        expected_hash = hashlib.sha256(asset.read_bytes()).hexdigest()
        assert report["inputAssets"][0]["sha256"] == expected_hash
        handoff = root / report["handoffPath"]
        assert handoff.exists()
        assert json.loads(handoff.read_text(encoding="utf-8"))["approval"]["generate"] is False


def test_rejects_path_traversal_and_unknown_host() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        asset = root / "assets" / "animatic.mp4"
        asset.parent.mkdir(parents=True)
        asset.write_bytes(b"fixture")
        request = base_request()
        request["inputPaths"] = [{"relativePath": "../animatic.mp4", "mediaKind": "video"}]
        assert run_request(root, request).returncode != 0
        request = base_request()
        request["targetUrl"] = "https://example.com/"
        assert run_request(root, request).returncode != 0


def test_rejects_secret_like_prompt_and_approval_bypass() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        asset = root / "assets" / "animatic.mp4"
        asset.parent.mkdir(parents=True)
        asset.write_bytes(b"fixture")
        request = base_request()
        request["prompt"] = "Use api_key=do-not-send"
        assert run_request(root, request).returncode != 0
        request = base_request()
        request["approval"]["generate"] = True
        assert run_request(root, request).returncode != 0


def test_no_overwrite() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        asset = root / "assets" / "animatic.mp4"
        asset.parent.mkdir(parents=True)
        asset.write_bytes(b"fixture")
        first = run_request(root, base_request())
        assert first.returncode == 0, first.stderr
        second = run_request(root, base_request())
        assert second.returncode != 0
        assert "đã tồn tại" in json.loads(second.stderr)["error"]


if __name__ == "__main__":
    tests = [
        test_prepare_hash_and_state,
        test_rejects_path_traversal_and_unknown_host,
        test_rejects_secret_like_prompt_and_approval_bypass,
        test_no_overwrite,
    ]
    for test in tests:
        test()
    print(f"browser_handoff_worker: {len(tests)} tests passed")

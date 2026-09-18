"""Export a local, provenance-first Blender previs package.

This creates metadata for an approved local reference. It never uploads files,
opens network connections, or treats reference media as reusable source.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

TOOL_VERSION = "1.0.0"


def contained(root: Path, candidate: str, *, must_exist: bool = True) -> Path:
    root = root.resolve()
    path = (root / candidate).resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise ValueError("path escapes workspace") from exc
    if must_exist and not path.is_file():
        raise FileNotFoundError(str(path))
    return path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_package(args: argparse.Namespace) -> dict:
    root = Path(args.workspace).resolve()
    scene = contained(root, args.scene)
    preview = contained(root, args.preview)
    output_dir = contained(root, args.output_dir, must_exist=False)
    output_dir.mkdir(parents=True, exist_ok=True)
    package = {
        "schemaVersion": "1.0.0",
        "toolVersion": TOOL_VERSION,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "mode": "blender_previs_reference_only",
        "rights": {
            "sourceType": "local_project_scene",
            "analysisOnly": True,
            "reuseOriginalMedia": False,
            "uploadApproved": False,
            "derivativeUseApproved": False
        },
        "shot": {
            "shotId": args.shot_id,
            "frameStart": args.frame_start,
            "frameEnd": args.frame_end,
            "aspectRatio": "9:16",
            "cameraIntent": args.camera_intent,
            "motionIntent": args.motion_intent,
            "continuityNotes": args.continuity_notes
        },
        "files": [
            {"role": "scene", "relativePath": scene.relative_to(root).as_posix(), "sha256": sha256(scene)},
            {"role": "preview", "relativePath": preview.relative_to(root).as_posix(), "sha256": sha256(preview)}
        ],
        "nextAction": "human_review_before_any_browser_upload",
        "reviewState": "needs_review"
    }
    output = output_dir / f"{args.shot_id.lower()}-reference-package.json"
    output.write_text(json.dumps(package, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"output": output.relative_to(root).as_posix(), "package": package}


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Export bounded Blender previs reference package")
    p.add_argument("--workspace", required=True)
    p.add_argument("--scene", required=True)
    p.add_argument("--preview", required=True)
    p.add_argument("--output-dir", required=True)
    p.add_argument("--shot-id", required=True)
    p.add_argument("--frame-start", type=int, required=True)
    p.add_argument("--frame-end", type=int, required=True)
    p.add_argument("--camera-intent", required=True)
    p.add_argument("--motion-intent", required=True)
    p.add_argument("--continuity-notes", required=True)
    return p


if __name__ == "__main__":
    ns = parser().parse_args()
    if ns.frame_start < 1 or ns.frame_end < ns.frame_start:
        raise SystemExit("invalid frame range")
    result = build_package(ns)
    print(json.dumps(result, ensure_ascii=False))

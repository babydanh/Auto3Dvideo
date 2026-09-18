"""Local-first asset registry worker for approved project files.

The worker records provenance and file facts only. It never downloads, uploads,
executes Blender, or marks rights as approved automatically.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
from datetime import datetime, timezone
from pathlib import Path

TOOL_VERSION = "1.0.0"
ALLOWED_EXTENSIONS = {".blend", ".glb", ".gltf", ".obj", ".fbx", ".abc", ".usd", ".usda", ".usdc", ".png", ".jpg", ".jpeg", ".exr", ".hdr"}


def contained(root: Path, candidate: str, *, must_exist: bool = True) -> Path:
    root = root.resolve()
    path = (root / candidate).resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise ValueError("asset path escapes workspace") from exc
    if must_exist and not path.is_file():
        raise FileNotFoundError(str(path))
    return path


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def build_record(args: argparse.Namespace) -> dict:
    root = Path(args.workspace).resolve()
    asset_path = contained(root, args.asset_path)
    if asset_path.suffix.lower() not in ALLOWED_EXTENSIONS:
        raise ValueError(f"unsupported asset extension: {asset_path.suffix}")
    now = datetime.now(timezone.utc).isoformat()
    kind = "model3d" if asset_path.suffix.lower() in {".blend", ".glb", ".gltf", ".obj", ".fbx", ".abc", ".usd", ".usda", ".usdc"} else "image"
    record = {
        "schemaVersion": "1.0.0",
        "assetId": args.asset_id,
        "projectId": args.project_id,
        "kind": kind,
        "relativePath": asset_path.relative_to(root).as_posix(),
        "sha256": digest(asset_path),
        "mimeType": mimetypes.guess_type(asset_path.name)[0],
        "sizeBytes": asset_path.stat().st_size,
        "width": None,
        "height": None,
        "durationSeconds": None,
        "status": "rights_pending",
        "rightsStatus": args.rights_status,
        "sourceUri": args.source_uri,
        "createdAt": now,
        "updatedAt": now,
        "registryToolVersion": TOOL_VERSION,
        "qualityReviewState": "needs_review",
        "qualityNotes": "File facts and hash recorded; geometry/material/UV quality requires Blender inspection."
    }
    output = contained(root, args.output, must_exist=False)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    return record


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Register an approved local asset without external side effects")
    p.add_argument("--workspace", required=True)
    p.add_argument("--asset-path", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--asset-id", required=True)
    p.add_argument("--project-id", required=True)
    p.add_argument("--rights-status", default="unknown", choices=["unknown", "pending", "personal", "owned", "licensed", "public_domain", "restricted", "rejected"])
    p.add_argument("--source-uri", default=None)
    return p


if __name__ == "__main__":
    args = parser().parse_args()
    print(json.dumps(build_record(args), ensure_ascii=False))

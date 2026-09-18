"""Local scene worker for approved, provenance-backed footage edits.

This worker does not discover or download media. It reads a bounded manifest
created by collect_licensed_footage.py, validates that every selected asset is
inside the workspace and carries rights metadata, then emits a scene manifest
whose video sources are consumed by the native FFmpeg stage.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

MAX_REQUEST_BYTES = 256 * 1024
MAX_FOOTAGE_MANIFEST_BYTES = 1024 * 1024
MAX_ASSET_BYTES = 80 * 1024 * 1024
MAX_SEGMENTS = 12
ALLOWED_SIZES = {(1080, 1920), (720, 1280)}
ALLOWED_EXTENSIONS = {".webm", ".mp4", ".mov", ".m4v"}
ALLOWED_RIGHTS = {"public_domain", "licensed"}


def emit(payload: dict[str, Any]) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)
    return 0 if payload.get("status") == "succeeded" else 1


def safe_relative_path(value: Any, field: str, suffix: str | None = None) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} phải là chuỗi không rỗng")
    raw = value.strip().replace("\\", "/")
    path = Path(raw)
    if path.is_absolute() or "://" in raw or (len(raw) > 1 and raw[1] == ":"):
        raise ValueError(f"{field} phải là đường dẫn tương đối an toàn")
    if any(part in {"", ".", ".."} for part in raw.split("/")):
        raise ValueError(f"{field} chứa đoạn đường dẫn không an toàn")
    if suffix and path.suffix.lower() != suffix.lower():
        raise ValueError(f"{field} phải kết thúc bằng {suffix}")
    return path


def bounded_json(path: Path, limit: int, label: str) -> dict[str, Any]:
    if not path.is_file() or path.stat().st_size > limit:
        raise ValueError(f"{label} không tồn tại hoặc vượt giới hạn")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{label} phải là JSON object")
    return value


def within_workspace(workspace: Path, relative: Path, field: str) -> Path:
    target = (workspace / relative).resolve()
    root = workspace.resolve()
    try:
        target.relative_to(root)
    except ValueError as error:
        raise ValueError(f"{field} vượt workspace") from error
    return target


def validate_asset(asset: Any, index: int, workspace: Path, asset_root: Path) -> dict[str, Any]:
    if not isinstance(asset, dict):
        raise ValueError(f"footage asset {index} phải là object")
    required = [
        "assetId", "relativePath", "sourceUrl", "landingPage", "credit",
        "licenseName", "rightsStatus", "reviewState", "sha256",
    ]
    for key in required:
        if key not in asset:
            raise ValueError(f"footage asset {index} thiếu {key}")
    asset_id = asset["assetId"]
    if not isinstance(asset_id, str) or not (3 <= len(asset_id) <= 96) or not asset_id.replace("-", "").isalnum():
        raise ValueError(f"footage asset {index}.assetId không hợp lệ")
    relative = safe_relative_path(asset["relativePath"], f"footage asset {index}.relativePath")
    if len(relative.parts) < 2 or relative.suffix.lower() not in ALLOWED_EXTENSIONS:
        raise ValueError(f"footage asset {index}.relativePath không phải video được hỗ trợ")
    target = within_workspace(asset_root, relative, f"footage asset {index}.relativePath")
    if not target.is_file() or target.stat().st_size == 0 or target.stat().st_size > MAX_ASSET_BYTES:
        raise ValueError(f"footage asset {index} không tồn tại hoặc vượt giới hạn")
    try:
        workspace_relative = target.relative_to(workspace)
    except ValueError as error:
        raise ValueError(f"footage asset {index} vượt workspace") from error
    digest = hashlib.sha256()
    with target.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    if digest.hexdigest() != str(asset["sha256"]).strip().lower():
        raise ValueError(f"footage asset {index} SHA-256 không khớp manifest")
    if asset["rightsStatus"] not in ALLOWED_RIGHTS:
        raise ValueError(f"footage asset {index}.rightsStatus không được phép")
    if asset["reviewState"] not in {"needs_review", "approved"}:
        raise ValueError(f"footage asset {index}.reviewState không hợp lệ")
    for key in ["sourceUrl", "landingPage", "credit", "licenseName", "sha256"]:
        if not isinstance(asset[key], str) or not asset[key].strip() or len(asset[key]) > 1000:
            raise ValueError(f"footage asset {index}.{key} không hợp lệ")
    return {
        "assetId": asset_id,
        "relativePath": str(workspace_relative).replace("\\", "/"),
        "sourceUrl": asset["sourceUrl"].strip(),
        "landingPage": asset["landingPage"].strip(),
        "credit": asset["credit"].strip(),
        "licenseName": asset["licenseName"].strip(),
        "rightsStatus": asset["rightsStatus"],
        "reviewState": asset["reviewState"],
        "sha256": asset["sha256"].strip(),
        "sizeBytes": int(asset.get("sizeBytes", target.stat().st_size)),
        "notes": str(asset.get("notes", "")).strip()[:1000],
    }


def run(workspace: Path, script_relative: str, output_relative: str, width: int, height: int) -> int:
    try:
        if (width, height) not in ALLOWED_SIZES:
            raise ValueError("kích thước footage chưa được allowlist")
        script_path = within_workspace(workspace, safe_relative_path(script_relative, "scriptPath", ".json"), "scriptPath")
        output_dir = within_workspace(workspace, safe_relative_path(output_relative, "outputDir"), "outputDir")
        script = bounded_json(script_path, MAX_REQUEST_BYTES, "script")
        if script.get("visualMode") != "licensed-footage-space":
            raise ValueError("script.visualMode phải là licensed-footage-space")
        manifest_relative = safe_relative_path(script.get("footageManifestPath"), "footageManifestPath", ".json")
        footage_manifest_path = within_workspace(workspace, manifest_relative, "footageManifestPath")
        footage_manifest = bounded_json(footage_manifest_path, MAX_FOOTAGE_MANIFEST_BYTES, "footage manifest")
        assets_raw = footage_manifest.get("assets")
        if not isinstance(assets_raw, list) or not 1 <= len(assets_raw) <= MAX_SEGMENTS:
            raise ValueError("footage manifest phải có từ 1 đến 12 asset")
        asset_root = footage_manifest_path.parent
        assets = [validate_asset(asset, index + 1, workspace, asset_root) for index, asset in enumerate(assets_raw)]
        by_id = {asset["assetId"]: asset for asset in assets}
        if len(by_id) != len(assets):
            raise ValueError("footage manifest có assetId trùng")
        segments = script.get("segments")
        if not isinstance(segments, list) or not 2 <= len(segments) <= MAX_SEGMENTS:
            raise ValueError("script phải có từ 2 đến 12 đoạn")
        scene_records: list[dict[str, Any]] = []
        for index, segment in enumerate(segments, start=1):
            if not isinstance(segment, dict):
                raise ValueError(f"segment {index} không hợp lệ")
            asset_id = segment.get("assetId")
            if not isinstance(asset_id, str) or asset_id not in by_id:
                raise ValueError(f"segment {index} trỏ tới assetId không có trong manifest")
            duration = segment.get("durationSeconds")
            if not isinstance(duration, (int, float)) or isinstance(duration, bool) or not 1 <= float(duration) <= 30:
                raise ValueError(f"duration segment {index} không hợp lệ")
            if not str(segment.get("onScreenText", "")).strip() or not str(segment.get("narration", "")).strip():
                raise ValueError(f"segment {index} thiếu chữ hoặc lời dẫn")
            asset = by_id[asset_id]
            scene_records.append({
                "sceneId": f"scene-{index:02d}",
                "relativePath": asset["relativePath"],
                "mediaType": "video",
                "assetId": asset["assetId"],
                "durationSeconds": float(duration),
                "width": width,
                "height": height,
                "animationMode": "licensed-footage-edit",
                "visualMode": "licensed-footage-space",
                "rightsStatus": asset["rightsStatus"],
                "sourceUrl": asset["sourceUrl"],
                "landingPage": asset["landingPage"],
                "credit": asset["credit"],
                "licenseName": asset["licenseName"],
                "assetSha256": asset["sha256"],
                "assetReviewState": asset["reviewState"],
                "reviewState": "needs_review",
            })
        output_dir.mkdir(parents=True, exist_ok=True)
        manifest = {
            "schemaVersion": "1.0.0",
            "scriptId": script.get("scriptId"),
            "width": width,
            "height": height,
            "animationMode": "licensed-footage-edit",
            "visualMode": "licensed-footage-space",
            "sourceManifestPath": str(manifest_relative).replace("\\", "/"),
            "scenes": scene_records,
            "networkCallsMade": False,
            "externalAssetsUsed": True,
            "rightsStatus": "needs_review",
            "reviewState": "needs_review",
            "message": "Đã map footage từ manifest có provenance; chưa coi là được phép xuất bản cho đến khi người dùng review quyền và credit.",
        }
        manifest_path = output_dir / "scene-manifest.json"
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return emit({
            "status": "succeeded",
            "sceneManifestPath": str(manifest_path.relative_to(workspace)).replace("\\", "/"),
            "sceneCount": len(scene_records),
            "networkCallsMade": False,
            "externalAssetsUsed": True,
            "reviewState": "needs_review",
        })
    except Exception as error:
        return emit({"status": "failed", "networkCallsMade": False, "externalAssetsUsed": True, "message": f"Không tạo được scene footage: {type(error).__name__}: {str(error)[:240]}"})


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--script")
    parser.add_argument("--output-dir")
    parser.add_argument("--width", type=int, default=720)
    parser.add_argument("--height", type=int, default=1280)
    args = parser.parse_args()
    if not args.script or not args.output_dir:
        return emit({"status": "invalid_request", "message": "Thiếu script hoặc output directory."})
    try:
        return run(Path.cwd().resolve(), args.script, args.output_dir, args.width, args.height)
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
        return emit({"status": "invalid_request", "message": f"Yêu cầu không hợp lệ: {str(error)[:240]}"})


if __name__ == "__main__":
    sys.exit(main())

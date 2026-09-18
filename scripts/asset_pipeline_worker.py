"""Local-only asset ingest, classification, quarantine and binding worker.

This worker receives typed JSON only. It never downloads, uploads, invokes a
provider or executes Blender. Blender quality/normalization is a separate
allowlisted stage and is merged through ``--merge-quality``.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

TOOL_VERSION = "asset-pipeline-worker-1.0.0"
SAFE_RIGHTS = {"personal", "owned", "licensed", "public_domain"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".exr", ".hdr", ".svg"}
MODEL_EXTENSIONS = {".blend", ".glb", ".gltf", ".obj", ".fbx", ".abc", ".usd", ".usda", ".usdc"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".mkv"}
ALLOWED_DECLARED = {"reference_image", "model3d", "texture", "render"}
ALLOWED_ROLES = {"identity", "composition", "pose", "camera", "style", "texture", "start_frame", "end_frame", "environment", "model3d"}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def inside(root: Path, raw: str, *, must_exist: bool = True) -> Path:
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError("asset path phải là chuỗi không rỗng")
    candidate = raw.strip().replace("\\", "/")
    if Path(candidate).is_absolute() or candidate.startswith("/") or candidate.startswith("//") or len(candidate) > 1024 or "://" in candidate:
        raise ValueError("asset path phải là đường dẫn tương đối local")
    path = (root / candidate).resolve()
    try:
        path.relative_to(root.resolve())
    except ValueError as exc:
        raise ValueError("asset path escapes workspace") from exc
    if must_exist and not path.is_file():
        raise FileNotFoundError(str(path))
    return path


def relative(root: Path, path: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def image_dimensions(path: Path, head: bytes) -> tuple[int | None, int | None]:
    if head.startswith(b"\x89PNG\r\n\x1a\n") and len(head) >= 24:
        return int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")
    if head.startswith(b"RIFF") and head[8:12] == b"WEBP" and len(head) >= 30:
        if head[12:16] == b"VP8X":
            width = 1 + int.from_bytes(head[24:27], "little")
            height = 1 + int.from_bytes(head[27:30], "little")
            return width, height
    if head.startswith(b"\xff\xd8"):
        with path.open("rb") as handle:
            handle.read(2)
            while True:
                marker = handle.read(2)
                if len(marker) != 2:
                    break
                if marker[0] != 0xFF:
                    continue
                size_bytes = handle.read(2)
                if len(size_bytes) != 2:
                    break
                size = int.from_bytes(size_bytes, "big")
                if marker[1] in set(range(0xC0, 0xC4)) | set(range(0xC5, 0xC8)) | set(range(0xC9, 0xCC)) | set(range(0xCD, 0xD0)):
                    data = handle.read(size - 2)
                    if len(data) >= 5:
                        return int.from_bytes(data[1:3], "big"), int.from_bytes(data[3:5], "big")
                    break
                handle.seek(max(0, size - 2), 1)
    return None, None


def probe(path: Path) -> dict[str, Any]:
    extension = path.suffix.lower()
    with path.open("rb") as handle:
        head = handle.read(4096)
    mime = mimetypes.guess_type(path.name)[0]
    detected = "unknown"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        detected, mime = "image", "image/png"
    elif head.startswith(b"\xff\xd8"):
        detected, mime = "image", "image/jpeg"
    elif head.startswith(b"RIFF") and head[8:12] == b"WEBP":
        detected, mime = "image", "image/webp"
    elif head.startswith(b"BLENDER"):
        detected, mime = "model3d", "application/x-blend"
    elif head.startswith(b"glTF"):
        detected, mime = "model3d", "model/gltf-binary"
    elif extension == ".gltf" and b"\"asset\"" in head:
        detected, mime = "model3d", "model/gltf+json"
    elif extension in {".obj", ".fbx", ".abc", ".usd", ".usda", ".usdc"}:
        detected, mime = "model3d", mime or "model/unknown"
    elif extension in IMAGE_EXTENSIONS:
        detected = "image"
    elif extension in VIDEO_EXTENSIONS:
        detected = "video"
    elif extension == ".svg" and b"<svg" in head[:2048].lower():
        detected, mime = "image", "image/svg+xml"
    width, height = image_dimensions(path, head) if detected == "image" else (None, None)
    return {"detectedKind": detected, "mimeType": mime, "width": width, "height": height}


def expected_detection(declared: str, detected: str, extension: str) -> bool:
    if declared in {"reference_image", "texture"}:
        return detected == "image"
    if declared == "model3d":
        return detected == "model3d" or extension in MODEL_EXTENSIONS
    if declared == "render":
        return detected in {"image", "video"} or extension in IMAGE_EXTENSIONS | VIDEO_EXTENSIONS
    return False


def normalized_asset_kind(declared: str) -> str:
    return {"reference_image": "image", "model3d": "model3d", "texture": "texture", "render": "render"}[declared]


def validate_spec(spec: dict[str, Any]) -> None:
    if spec.get("schemaVersion") != "1.0.0" or spec.get("jobType") != "asset.ingest":
        raise ValueError("asset ingest spec sai schemaVersion/jobType")
    assets = spec.get("assets")
    if not isinstance(assets, list) or not 1 <= len(assets) <= 256:
        raise ValueError("asset ingest cần 1–256 asset")
    ids: set[str] = set()
    for item in assets:
        if not isinstance(item, dict):
            raise ValueError("asset entry phải là object")
        asset_id = item.get("assetId")
        if not isinstance(asset_id, str) or not asset_id.islower() or asset_id in ids or not 3 <= len(asset_id) <= 64:
            raise ValueError(f"assetId không hợp lệ hoặc trùng: {asset_id}")
        ids.add(asset_id)
        if item.get("declaredKind") not in ALLOWED_DECLARED:
            raise ValueError(f"declaredKind không hợp lệ cho {asset_id}")
        if item.get("role") not in ALLOWED_ROLES:
            raise ValueError(f"role không hợp lệ cho {asset_id}")
        if not isinstance(item.get("shotIds"), list) or any(not isinstance(value, str) for value in item["shotIds"]):
            raise ValueError(f"shotIds không hợp lệ cho {asset_id}")
        if not isinstance(item.get("provenance"), str) or not item["provenance"].strip():
            raise ValueError(f"provenance bắt buộc cho {asset_id}")


def build_report(spec: dict[str, Any], workspace: Path, output_dir: Path) -> dict[str, Any]:
    validate_spec(spec)
    output_dir.mkdir(parents=True, exist_ok=True)
    staged_root = output_dir / "staged-assets"
    quarantine_root = output_dir / "quarantine"
    records: list[dict[str, Any]] = []
    bindings: list[dict[str, Any]] = []
    quarantine: list[dict[str, str]] = []
    timestamp = now()
    for item in spec["assets"]:
        asset_id = item["assetId"]
        source = inside(workspace, item["sourcePath"])
        declared = item["declaredKind"]
        role = item["role"]
        rights = item["rightsStatus"]
        review = item["reviewState"]
        issues: list[str] = []
        facts = probe(source)
        if not expected_detection(declared, facts["detectedKind"], source.suffix.lower()):
            issues.append("declared_kind_mismatch")
        if role == "model3d" and declared != "model3d":
            issues.append("role_requires_model3d")
        if declared == "texture" and role != "texture":
            issues.append("texture_role_required")
        if source.stat().st_size == 0:
            issues.append("empty_file")
        quarantined = rights not in SAFE_RIGHTS or review in {"rejected", "blocked"} or bool(issues)
        target_root = quarantine_root if quarantined else staged_root
        target = target_root / asset_id / f"source{source.suffix.lower()}"
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        target_relative = relative(workspace, target)
        reason = None
        if rights not in SAFE_RIGHTS:
            reason = f"rights_{rights}"
        elif review in {"rejected", "blocked"}:
            reason = f"review_{review}"
        elif issues:
            reason = ",".join(issues)
        quality_state = "not_run" if declared == "model3d" else ("pass" if not issues else "failed")
        normalization_state = "staged" if not quarantined else "not_run"
        record = {
            "assetId": asset_id,
            "projectId": spec["projectId"],
            "title": item["title"],
            "declaredKind": declared,
            "kind": normalized_asset_kind(declared),
            "sourcePath": item["sourcePath"],
            "relativePath": target_relative,
            "normalizedRelativePath": None,
            "sha256": digest(source),
            "mimeType": facts["mimeType"],
            "sizeBytes": source.stat().st_size,
            "width": facts["width"],
            "height": facts["height"],
            "status": "quarantined" if quarantined else "ready",
            "rightsStatus": rights,
            "reviewState": review if not quarantined else ("blocked" if review != "rejected" else "rejected"),
            "qualityState": quality_state,
            "normalizationState": normalization_state,
            "shotIds": list(item["shotIds"]),
            "role": role,
            "provenance": item["provenance"],
            "issues": issues,
            "quarantineReason": reason,
        }
        records.append(record)
        if quarantined:
            quarantine.append({"assetId": asset_id, "relativePath": target_relative, "reason": reason or "validation_failed"})
        for index, shot_id in enumerate(item["shotIds"], start=1):
            binding_review = "blocked" if quarantined else "needs_review"
            bindings.append({
                "schemaVersion": "1.0.0",
                "bindingId": f"{shot_id.lower()}-{asset_id}",
                "assetId": asset_id,
                "shotId": shot_id,
                "role": role,
                "assetSha256": record["sha256"],
                "priority": index,
                "provenance": item["provenance"],
                "rightsStatus": rights,
                "reviewState": binding_review,
            })
    counts = {
        "total": len(records),
        "ready": sum(record["status"] == "ready" for record in records),
        "quarantined": len(quarantine),
        "referenceImages": sum(record["declaredKind"] == "reference_image" for record in records),
        "models3d": sum(record["declaredKind"] == "model3d" for record in records),
        "textures": sum(record["declaredKind"] == "texture" for record in records),
        "renders": sum(record["declaredKind"] == "render" for record in records),
    }
    report = {
        "schemaVersion": "1.0.0",
        "reportId": f"{spec['runId']}-asset-pipeline",
        "jobType": "asset.pipeline",
        "projectId": spec["projectId"],
        "runId": spec["runId"],
        "status": "blocked" if quarantine else "succeeded_needs_review",
        "assetCounts": counts,
        "assets": records,
        "bindings": bindings,
        "qualityChecks": [],
        "quarantine": quarantine,
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }
    write_outputs(report, output_dir)
    return report


def merge_quality(report: dict[str, Any], quality: dict[str, Any], workspace: Path, output_dir: Path) -> dict[str, Any]:
    checks_by_id = {item.get("assetId"): item for item in quality.get("qualityChecks", []) if isinstance(item, dict)}
    report["qualityChecks"] = quality.get("qualityChecks", [])
    for asset in report.get("assets", []):
        check = checks_by_id.get(asset["assetId"])
        if not check:
            continue
        asset["qualityState"] = check.get("qualityState", "needs_review")
        asset["normalizationState"] = check.get("normalizationState", "needs_review")
        asset["normalizedRelativePath"] = check.get("normalizedRelativePath")
        asset["issues"] = sorted(set(asset.get("issues", []) + check.get("issues", [])))
        if asset["qualityState"] == "failed":
            asset["status"] = "quarantined"
            asset["quarantineReason"] = "blender_quality_failed"
            if not any(item.get("assetId") == asset["assetId"] for item in report.get("quarantine", [])):
                report.setdefault("quarantine", []).append({
                    "assetId": asset["assetId"],
                    "relativePath": asset.get("relativePath"),
                    "reason": "blender_quality_failed",
                })
    asset_by_id = {asset["assetId"]: asset for asset in report.get("assets", [])}
    for binding in report.get("bindings", []):
        asset = asset_by_id[binding["assetId"]]
        binding["reviewState"] = "blocked" if asset["status"] != "ready" or asset["qualityState"] == "failed" else "needs_review"
    report["assetCounts"]["ready"] = sum(asset["status"] == "ready" for asset in report["assets"])
    report["assetCounts"]["quarantined"] = sum(asset["status"] == "quarantined" for asset in report["assets"])
    report["status"] = "blocked" if report["assetCounts"]["quarantined"] else "succeeded_needs_review"
    report["updatedAt"] = now()
    write_outputs(report, output_dir)
    return report


def write_outputs(report: dict[str, Any], output_dir: Path) -> None:
    (output_dir / "asset-pipeline-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "asset-bindings.json").write_text(json.dumps({"schemaVersion": "1.0.0", "bindings": report["bindings"]}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "quarantine.json").write_text(json.dumps({"schemaVersion": "1.0.0", "items": report["quarantine"]}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description="Auto3Dvideo local asset pipeline")
    value.add_argument("--workspace", required=True)
    value.add_argument("--spec")
    value.add_argument("--output-dir", required=True)
    value.add_argument("--merge-quality")
    value.add_argument("--report")
    return value


def main() -> int:
    args = parser().parse_args()
    workspace = Path(args.workspace).resolve()
    output_dir = inside(workspace, args.output_dir, must_exist=False)
    if args.merge_quality:
        report_path = inside(workspace, args.report or f"{args.output_dir}/asset-pipeline-report.json")
        quality_path = inside(workspace, args.merge_quality)
        report = json.loads(report_path.read_text(encoding="utf-8"))
        quality = json.loads(quality_path.read_text(encoding="utf-8"))
        result = merge_quality(report, quality, workspace, output_dir)
    else:
        if not args.spec:
            raise ValueError("--spec bắt buộc ở chế độ ingest")
        spec = json.loads(inside(workspace, args.spec).read_text(encoding="utf-8"))
        result = build_report(spec, workspace, output_dir)
    print(json.dumps({"status": result["status"], "reportPath": relative(workspace, output_dir / "asset-pipeline-report.json"), "assetCounts": result["assetCounts"]}, ensure_ascii=False), flush=True)
    return 0 if result["status"] != "failed" else 2


if __name__ == "__main__":
    raise SystemExit(main())

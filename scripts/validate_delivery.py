"""Validate a local delivery manifest without executing tools or publishing anything."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from datetime import datetime
from pathlib import Path
from typing import Any

ALLOWED_STATUS = {"draft", "validated", "approved", "exported", "published_pending", "published", "blocked"}
ALLOWED_PROFILE = {"master", "youtube", "tiktok", "douyin", "instagram", "custom"}
ALLOWED_KINDS = {"video", "audio", "subtitle", "thumbnail", "metadata", "manifest"}
TOP_LEVEL_FIELDS = {"schemaVersion", "deliveryId", "episodeId", "status", "profile", "width", "height", "frameRate", "files", "rightsReview", "aiDisclosure", "createdAt"}
FILE_FIELDS = {"kind", "relativePath", "sha256", "sizeBytes"}
IDENTIFIER_RE = re.compile(r"^[a-z0-9][a-z0-9-]{2,63}$")
SHA256_RE = re.compile(r"^[a-fA-F0-9]{64}$")


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError("manifest root must be an object")
    return value


def is_safe_relative(raw_path: Any) -> bool:
    if not isinstance(raw_path, str) or not raw_path.strip():
        return False
    normalized = raw_path.strip().replace("\\", "/")
    if normalized.startswith("/") or (len(normalized) >= 2 and normalized[1] == ":"):
        return False
    return "\x00" not in normalized and ".." not in normalized.split("/")


def validate_manifest(manifest_path: Path) -> list[str]:
    errors: list[str] = []
    try:
        manifest_file = manifest_path.expanduser().resolve(strict=True)
        manifest = read_json(manifest_file)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        return [f"cannot_read_manifest: {error}"]

    unknown_top_level = sorted(set(manifest) - TOP_LEVEL_FIELDS)
    if unknown_top_level:
        errors.append(f"unknown top-level fields: {', '.join(unknown_top_level)}")
    if manifest.get("schemaVersion") != "1.0.0":
        errors.append("schemaVersion must be 1.0.0")
    for field in ("deliveryId", "episodeId"):
        value = manifest.get(field)
        if not isinstance(value, str) or not IDENTIFIER_RE.fullmatch(value):
            errors.append(f"{field} has invalid identifier")
    if manifest.get("status") not in ALLOWED_STATUS:
        errors.append("status is not supported")
    if manifest.get("profile") not in ALLOWED_PROFILE:
        errors.append("profile is not supported")
    records = manifest.get("files") if isinstance(manifest.get("files"), list) else []
    if not records:
        errors.append("files must be a non-empty array")
    width = manifest.get("width")
    height = manifest.get("height")
    frame_rate = manifest.get("frameRate")
    if width is not None and (isinstance(width, bool) or not isinstance(width, int) or width < 16):
        errors.append("width must be an integer >= 16")
    if height is not None and (isinstance(height, bool) or not isinstance(height, int) or height < 16):
        errors.append("height must be an integer >= 16")
    if frame_rate is not None and (isinstance(frame_rate, bool) or not isinstance(frame_rate, (int, float)) or not math.isfinite(frame_rate) or frame_rate <= 0):
        errors.append("frameRate must be a finite positive number")

    created_at = manifest.get("createdAt")
    if not isinstance(created_at, str):
        errors.append("createdAt is required")
    else:
        try:
            datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        except ValueError:
            errors.append("createdAt is not ISO-8601")

    package_root = manifest_file.parent
    seen_paths: set[str] = set()
    for index, record in enumerate(records):
        prefix = f"files[{index}]"
        if not isinstance(record, dict):
            errors.append(f"{prefix} must be an object")
            continue
        unknown_file_fields = sorted(set(record) - FILE_FIELDS)
        if unknown_file_fields:
            errors.append(f"{prefix} has unknown fields: {', '.join(unknown_file_fields)}")
        relative_path = record.get("relativePath")
        if not is_safe_relative(relative_path):
            errors.append(f"{prefix}.relativePath is unsafe")
            continue
        normalized = relative_path.strip().replace("\\", "/")
        if record.get("kind") not in ALLOWED_KINDS:
            errors.append(f"{prefix}.kind is unsupported")
        expected_hash = record.get("sha256")
        if not isinstance(expected_hash, str) or not SHA256_RE.fullmatch(expected_hash):
            errors.append(f"{prefix}.sha256 is invalid")
        expected_size = record.get("sizeBytes")
        if isinstance(expected_size, bool) or not isinstance(expected_size, int) or expected_size < 0:
            errors.append(f"{prefix}.sizeBytes is invalid")

        file_path = (package_root / Path(normalized)).resolve()
        try:
            canonical_relative = file_path.relative_to(package_root).as_posix()
        except ValueError:
            errors.append(f"{prefix}.relativePath escapes package")
            continue
        if canonical_relative in seen_paths:
            errors.append(f"{prefix}.relativePath is duplicated")
            continue
        seen_paths.add(canonical_relative)
        if not file_path.is_file():
            errors.append(f"{prefix}.file_missing")
            continue
        actual_size = file_path.stat().st_size
        if isinstance(expected_size, int) and actual_size != expected_size:
            errors.append(f"{prefix}.size_mismatch")
        if isinstance(expected_hash, str) and SHA256_RE.fullmatch(expected_hash):
            actual_hash = hashlib.sha256(file_path.read_bytes()).hexdigest()
            if actual_hash.lower() != expected_hash.lower():
                errors.append(f"{prefix}.sha256_mismatch")

    status = manifest.get("status")
    file_kinds = {record.get("kind") for record in records if isinstance(record, dict)}
    if status in {"validated", "approved", "exported"} and "video" not in file_kinds:
        errors.append("validated/approved/exported status requires at least one video file")
    rights_review = manifest.get("rightsReview")
    ai_disclosure = manifest.get("aiDisclosure")
    if rights_review not in {None, "pending", "approved", "blocked"}:
        errors.append("rightsReview is invalid")
    if ai_disclosure not in {None, "not_required", "required_pending", "included", "blocked"}:
        errors.append("aiDisclosure is invalid")
    if status in {"approved", "exported", "published_pending", "published"}:
        if rights_review != "approved":
            errors.append("approved/exported status requires approved rightsReview")
        if ai_disclosure not in {"not_required", "included"}:
            errors.append("approved/exported status requires resolved aiDisclosure")
    if status in {"published_pending", "published"}:
        errors.append("external publishing is disabled in the local-first MVP")

    return errors


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, help="Path to manifest.json")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    errors = validate_manifest(Path(args.manifest))
    if errors:
        print(json.dumps({"valid": False, "errors": errors}, ensure_ascii=False, indent=2))
        return 1
    print("DELIVERY_VALID")
    print(f"manifest={Path(args.manifest).expanduser().resolve()}")
    print("hashes=verified")
    print("paths=contained")
    print("rights_disclosure_gate=verified_for_current_status")
    print("external_publish=blocked")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

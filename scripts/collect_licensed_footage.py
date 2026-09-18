"""Bounded collector for explicitly licensed/public-domain footage.

The collector is intentionally manifest-driven. It never searches, scrapes, logs
in, downloads from social platforms, removes watermarks, or treats an unknown
license as reusable. Each source entry must include a landing page, credit,
license terms, and a rights-review status before a download is attempted.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, urlopen

MAX_MANIFEST_BYTES = 256 * 1024
MAX_ASSET_BYTES = 80 * 1024 * 1024
CHUNK_BYTES = 1024 * 1024
ALLOWED_HOSTS = {"svs.gsfc.nasa.gov", "upload.wikimedia.org", "commons.wikimedia.org"}
ALLOWED_EXTENSIONS = {".webm", ".mp4", ".mov", ".m4v"}
ALLOWED_RIGHTS = {"public_domain", "licensed"}
ALLOWED_REVIEW_STATES = {"needs_review", "approved"}


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


def bounded_json(path: Path, label: str) -> dict[str, Any]:
    if not path.is_file() or path.stat().st_size > MAX_MANIFEST_BYTES:
        raise ValueError(f"{label} không tồn tại hoặc vượt giới hạn")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{label} phải là JSON object")
    return value


def validate_url(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} phải là URL HTTPS không rỗng")
    parsed = urlparse(value.strip())
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
        raise ValueError(f"{field} không thuộc HTTPS host allowlist")
    if parsed.username or parsed.password or parsed.port:
        raise ValueError(f"{field} không được chứa credential hoặc port tùy ý")
    return value.strip()


def validate_entry(entry: Any, index: int) -> dict[str, Any]:
    if not isinstance(entry, dict):
        raise ValueError(f"asset {index} phải là object")
    required = [
        "assetId", "downloadUrl", "landingPage", "filename", "credit",
        "licenseName", "commercialUse", "derivativeUse", "rightsStatus",
        "proofPath", "reviewState",
    ]
    for key in required:
        if key not in entry:
            raise ValueError(f"asset {index} thiếu {key}")
    asset_id = entry["assetId"]
    if not isinstance(asset_id, str) or not (3 <= len(asset_id) <= 96) or not asset_id.replace("-", "").isalnum():
        raise ValueError(f"asset {index}.assetId không hợp lệ")
    download_url = validate_url(entry["downloadUrl"], f"asset {index}.downloadUrl")
    landing_page = validate_url(entry["landingPage"], f"asset {index}.landingPage")
    filename = safe_relative_path(entry["filename"], f"asset {index}.filename")
    if len(filename.parts) != 1 or filename.suffix.lower() not in ALLOWED_EXTENSIONS:
        raise ValueError(f"asset {index}.filename phải là tên footage với extension cho phép")
    for key in ["credit", "licenseName", "proofPath"]:
        if not isinstance(entry[key], str) or not entry[key].strip() or len(entry[key]) > 600:
            raise ValueError(f"asset {index}.{key} không hợp lệ")
    for key in ["commercialUse", "derivativeUse"]:
        if entry[key] not in {True, False, "conditional"}:
            raise ValueError(f"asset {index}.{key} phải là true, false hoặc conditional")
    if entry["rightsStatus"] not in ALLOWED_RIGHTS:
        raise ValueError(f"asset {index}.rightsStatus phải là public_domain hoặc licensed")
    if entry["reviewState"] not in ALLOWED_REVIEW_STATES:
        raise ValueError(f"asset {index}.reviewState không hợp lệ")
    if entry["reviewState"] != "approved":
        raise ValueError(f"asset {index} chưa được review quyền; collector không tự nâng trạng thái")
    return {
        "assetId": asset_id,
        "downloadUrl": download_url,
        "landingPage": landing_page,
        "filename": str(filename).replace("\\", "/"),
        "credit": entry["credit"].strip(),
        "licenseName": entry["licenseName"].strip(),
        "commercialUse": entry["commercialUse"],
        "derivativeUse": entry["derivativeUse"],
        "rightsStatus": entry["rightsStatus"],
        "proofPath": entry["proofPath"].strip(),
        "reviewState": entry["reviewState"],
        "notes": str(entry.get("notes", "")).strip()[:1000],
    }


def file_signature_is_video(path: Path) -> bool:
    with path.open("rb") as handle:
        head = handle.read(32)
    return head.startswith(b"\x1a\x45\xdf\xa3") or (len(head) >= 12 and head[4:8] == b"ftyp")


def download_one(entry: dict[str, Any], output_dir: Path, offline: bool = False) -> dict[str, Any]:
    target = output_dir / entry["filename"]
    target.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    digest = hashlib.sha256()
    if offline:
        if not target.is_file():
            raise ValueError(f"asset offline bị thiếu: {entry['filename']}")
        if target.stat().st_size > MAX_ASSET_BYTES or not file_signature_is_video(target):
            raise ValueError(f"asset offline không hợp lệ: {entry['filename']}")
        with target.open("rb") as handle:
            while True:
                chunk = handle.read(CHUNK_BYTES)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_ASSET_BYTES:
                    raise ValueError(f"asset vượt giới hạn {MAX_ASSET_BYTES} bytes")
                digest.update(chunk)
    else:
        temp = target.with_suffix(target.suffix + ".part")
        request = Request(entry["downloadUrl"], headers={"User-Agent": "Auto3Dvideo-licensed-collector/1.0"})
        try:
            with urlopen(request, timeout=60) as response, temp.open("wb") as handle:
                content_length = response.headers.get("Content-Length")
                if content_length and int(content_length) > MAX_ASSET_BYTES:
                    raise ValueError(f"asset vượt giới hạn {MAX_ASSET_BYTES} bytes")
                while True:
                    chunk = response.read(CHUNK_BYTES)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_ASSET_BYTES:
                        raise ValueError(f"asset vượt giới hạn {MAX_ASSET_BYTES} bytes")
                    digest.update(chunk)
                    handle.write(chunk)
            if total == 0 or not file_signature_is_video(temp):
                raise ValueError("nội dung tải về không có chữ ký video được hỗ trợ")
            temp.replace(target)
        finally:
            if temp.exists():
                temp.unlink()
    return {
        "assetId": entry["assetId"],
        "relativePath": str(target.relative_to(output_dir.parent)).replace("\\", "/"),
        "sourceUrl": entry["downloadUrl"],
        "landingPage": entry["landingPage"],
        "credit": entry["credit"],
        "licenseName": entry["licenseName"],
        "commercialUse": entry["commercialUse"],
        "derivativeUse": entry["derivativeUse"],
        "rightsStatus": entry["rightsStatus"],
        "proofPath": entry["proofPath"],
        "reviewState": "needs_review",
        "retrievedAtUtc": datetime.now(timezone.utc).isoformat(),
        "sizeBytes": total,
        "sha256": digest.hexdigest(),
        "notes": entry["notes"],
    }


def run(manifest_path: Path, output_dir: Path, offline: bool = False) -> int:
    try:
        manifest = bounded_json(manifest_path, "source manifest")
        entries = manifest.get("assets")
        if not isinstance(entries, list) or not 1 <= len(entries) <= 12:
            raise ValueError("source manifest phải có từ 1 đến 12 asset")
        normalized = [validate_entry(entry, index + 1) for index, entry in enumerate(entries)]
        output_dir.mkdir(parents=True, exist_ok=True)
        assets = [download_one(entry, output_dir, offline=offline) for entry in normalized]
        output_manifest = {
            "schemaVersion": "1.0.0",
            "assets": assets,
            "networkCallsMade": not offline,
            "externalAssetsUsed": True,
            "rightsStatus": "needs_review",
            "reviewState": "needs_review",
            "message": "Đã kiểm tra asset từ allowlist; phải kiểm tra provenance và quyền theo từng file trước khi bàn giao.",
        }
        manifest_output = output_dir.parent / "footage-manifest.json"
        manifest_output.write_text(json.dumps(output_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return emit({
            "status": "succeeded",
            "manifestPath": str(manifest_output.relative_to(manifest_path.parent)).replace("\\", "/"),
            "assetCount": len(assets),
            "networkCallsMade": not offline,
            "externalAssetsUsed": True,
            "reviewState": "needs_review",
        })
    except Exception as error:
        return emit({"status": "failed", "networkCallsMade": False, "message": f"Không thu thập được footage: {type(error).__name__}: {str(error)[:240]}"})


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    try:
        manifest_path = safe_relative_path(args.manifest, "manifest", ".json")
        output_dir = safe_relative_path(args.output_dir, "outputDir")
        workspace = Path.cwd().resolve()
        return run(workspace / manifest_path, workspace / output_dir, offline=args.offline)
    except Exception as error:
        return emit({"status": "invalid_request", "message": f"Yêu cầu không hợp lệ: {str(error)[:240]}"})


if __name__ == "__main__":
    sys.exit(main())

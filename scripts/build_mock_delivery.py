"""Build a deterministic, no-media mock delivery package from a recipe."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ALLOWED_PROFILES = {"master", "youtube", "tiktok", "douyin", "instagram", "custom"}
IDENTIFIER_RE = re.compile(r"^[a-z0-9][a-z0-9-]{2,63}$")


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"JSON root must be an object: {path}")
    return value


def get_value(data: dict[str, Any], camel: str, snake: str, default: Any = None) -> Any:
    return data[camel] if camel in data else data.get(snake, default)


def require_identifier(value: Any, field: str) -> str:
    if not isinstance(value, str) or not IDENTIFIER_RE.fullmatch(value):
        raise ValueError(f"{field} must match lowercase identifier pattern")
    return value


def require_boolean(data: dict[str, Any], camel: str, snake: str, default: bool) -> bool:
    value = get_value(data, camel, snake, default)
    if not isinstance(value, bool):
        raise ValueError(f"{camel} must be boolean")
    return value


def require_positive_number(value: Any, field: str) -> int | float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise ValueError(f"{field} must be a finite positive number")
    return value


def resolve_inside(root: Path, raw_path: str) -> Path:
    root_resolved = root.expanduser().resolve()
    candidate = Path(raw_path)
    resolved = (candidate if candidate.is_absolute() else root_resolved / candidate).resolve()
    if resolved == root_resolved:
        raise ValueError("output directory must not be the project root")
    try:
        resolved.relative_to(root_resolved)
    except ValueError as error:
        raise ValueError("output directory must stay inside the project root") from error
    return resolved


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def write_text_new(path: Path, content: str) -> None:
    with path.open("x", encoding="utf-8", newline="\n") as handle:
        handle.write(content)


def file_record(package_dir: Path, relative_path: str, kind: str) -> dict[str, Any]:
    path = package_dir / relative_path
    data = path.read_bytes()
    return {
        "kind": kind,
        "relativePath": relative_path.replace("\\", "/"),
        "sha256": hashlib.sha256(data).hexdigest(),
        "sizeBytes": len(data),
    }


def build_package(
    project_root: Path,
    recipe_path: Path,
    output_dir: Path,
    profile: str = "master",
    episode_id: str | None = None,
) -> Path:
    root = project_root.expanduser().resolve()
    recipe_file = recipe_path.expanduser().resolve()
    try:
        recipe_file.relative_to(root)
    except ValueError as error:
        raise ValueError("recipe must be inside the project root") from error
    recipe = read_json(recipe_file)

    recipe_id = require_identifier(get_value(recipe, "recipeId", "recipe_id"), "recipeId")
    episode = require_identifier(episode_id or recipe_id, "episodeId")
    if profile not in ALLOWED_PROFILES:
        raise ValueError(f"unsupported profile: {profile}")
    recipe_kind = get_value(recipe, "kind", "kind")
    if not isinstance(recipe_kind, str) or not recipe_kind.strip():
        raise ValueError("recipe kind must be a non-empty string")
    width = get_value(recipe, "width", "width")
    height = get_value(recipe, "height", "height")
    fps = get_value(recipe, "fps", "fps")
    duration = get_value(recipe, "durationSeconds", "duration_seconds")
    if isinstance(width, bool) or not isinstance(width, int) or width < 16:
        raise ValueError("recipe width is invalid")
    if isinstance(height, bool) or not isinstance(height, int) or height < 16:
        raise ValueError("recipe height is invalid")
    fps = require_positive_number(fps, "recipe fps")
    duration = require_positive_number(duration, "recipe duration")

    policy = recipe.get("policy", {})
    if not isinstance(policy, dict):
        raise ValueError("recipe policy must be an object")
    paid_generation = require_boolean(policy, "paidGeneration", "paid_generation", False)
    external_publish = require_boolean(policy, "externalPublish", "external_publish", False)
    rights_required = require_boolean(policy, "rightsRequired", "rights_required", True)
    human_review_required = require_boolean(policy, "humanReviewRequired", "human_review_required", True)

    package_dir = resolve_inside(root, str(output_dir))
    if package_dir.exists():
        raise FileExistsError(f"refusing to overwrite existing output directory: {package_dir}")
    package_dir.parent.mkdir(parents=True, exist_ok=True)
    package_dir.mkdir()

    delivery_id = f"{recipe_id[:58].rstrip('-')}-mock"
    created_at = utc_now()
    blockers = [
        "mock package không có media render thật",
        "rights review chưa được reviewer phê duyệt",
        "AI disclosure chưa được quyết định đầy đủ",
    ]
    if paid_generation:
        blockers.append("paidGeneration bị policy chặn")
    if external_publish:
        blockers.append("externalPublish bị policy chặn")

    metadata = {
        "schemaVersion": "1.0.0",
        "deliveryId": delivery_id,
        "episodeId": episode,
        "recipeId": recipe_id,
        "recipeKind": recipe_kind,
        "locale": "vi-VN",
        "profile": profile,
        "videoSpec": {
            "width": width,
            "height": height,
            "frameRate": fps,
            "durationSeconds": duration,
        },
        "execution": {
            "mode": "mock",
            "externalProcessesStarted": False,
            "cloudCallsMade": False,
            "publishAttempted": False,
        },
        "policy": {
            "rightsRequired": rights_required,
            "humanReviewRequired": human_review_required,
            "paidGeneration": paid_generation,
            "externalPublish": external_publish,
            "status": "BLOCKED",
            "blockers": blockers,
        },
        "nextAction": "Gắn output thật sau khi worker local và các gate quyền/chất lượng hoàn tất.",
    }
    metadata_path = package_dir / "metadata.json"
    write_text_new(metadata_path, json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")

    review = f"""# Mock delivery review checklist

- Delivery ID: `{delivery_id}`
- Recipe: `{recipe_id}` (`{recipe_kind}`)
- Profile: `{profile}`
- Trạng thái: **BLOCKED — NEEDS_HUMAN_REVIEW**
- Execution: mock only; không spawn process, không gọi cloud, không publish.

## Checklist bắt buộc trước delivery thật

- [ ] Xác minh nguồn, license và phạm vi sử dụng của mọi asset.
- [ ] Xác minh quyền voice/face/likeness nếu có.
- [ ] Quyết định và ghi AI disclosure cho từng nền tảng.
- [ ] Probe video/audio/subtitle thật: codec, kích thước, FPS, duration và encoding.
- [ ] Review chất lượng hình ảnh, âm thanh, captions và accessibility.
- [ ] Reviewer duyệt output và lưu lý do/quyết định.

Package này chỉ là evidence của planning/validation; không phải video publishable hoặc monetizable.
"""
    review_path = package_dir / "review-checklist.md"
    write_text_new(review_path, review)

    manifest = {
        "schemaVersion": "1.0.0",
        "deliveryId": delivery_id,
        "episodeId": episode,
        "status": "blocked",
        "profile": profile,
        "width": width,
        "height": height,
        "frameRate": fps,
        "files": [
            file_record(package_dir, "metadata.json", "metadata"),
            file_record(package_dir, "review-checklist.md", "metadata"),
        ],
        "rightsReview": "pending",
        "aiDisclosure": "required_pending",
        "createdAt": created_at,
    }
    manifest_path = package_dir / "manifest.json"
    write_text_new(manifest_path, json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    return manifest_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recipe", required=True, help="Recipe JSON inside the project root")
    parser.add_argument("--output-dir", required=True, help="New package directory inside the project root")
    parser.add_argument("--project-root", default=".", help="Project root used for path containment")
    parser.add_argument("--profile", default="master", choices=sorted(ALLOWED_PROFILES))
    parser.add_argument("--episode-id", default=None)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        manifest_path = build_package(
            Path(args.project_root),
            Path(args.recipe),
            Path(args.output_dir),
            args.profile,
            args.episode_id,
        )
    except (FileExistsError, OSError, ValueError, json.JSONDecodeError) as error:
        print(f"MOCK_DELIVERY_BUILD_FAILED: {error}")
        return 1
    print("AUTO3DVIDEO_MOCK_DELIVERY")
    print(f"manifest={manifest_path}")
    print("status=blocked")
    print("external_processes_started=false")
    print("cloud_calls_made=false")
    print("publish_attempted=false")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

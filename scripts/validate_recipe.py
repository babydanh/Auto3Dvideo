"""Validate a normalized Auto3Dvideo recipe without starting workers."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

SUPPORTED_KINDS = {
    "image_slideshow",
    "html_to_video",
    "voiceover_package",
    "screen_demo",
    "hybrid_2d_3d",
    "true_3d",
    "ai_video_shot",
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--recipe", required=True, type=Path)
    args = parser.parse_args()
    path = args.recipe.resolve()
    document = json.loads(path.read_text(encoding="utf-8"))
    errors: list[str] = []
    warnings: list[str] = []

    schema_version = document.get("schemaVersion", document.get("schema_version"))
    recipe_id = document.get("recipeId", document.get("recipe_id"))
    kind = document.get("kind")
    fps = document.get("fps")
    width = document.get("width")
    height = document.get("height")
    duration = document.get("durationSeconds", document.get("duration_seconds"))
    policy = document.get("policy") or {}

    if schema_version != "1.0.0":
        errors.append("schemaVersion must be 1.0.0")
    if not isinstance(recipe_id, str) or not recipe_id.strip():
        errors.append("recipeId is required")
    if kind not in SUPPORTED_KINDS:
        errors.append(f"unsupported recipe kind: {kind}")
    if not isinstance(fps, int) or not 1 <= fps <= 240:
        errors.append("fps must be between 1 and 240")
    if not isinstance(width, int) or not 160 <= width <= 7680:
        errors.append("width must be between 160 and 7680")
    if not isinstance(height, int) or not 160 <= height <= 7680:
        errors.append("height must be between 160 and 7680")
    if not isinstance(duration, (int, float)) or not 0.1 <= duration <= 3600:
        errors.append("durationSeconds must be between 0.1 and 3600")

    external_publish = policy.get("externalPublish", policy.get("external_publish", False))
    paid_generation = policy.get("paidGeneration", policy.get("paid_generation", False))
    rights_required = policy.get("rightsRequired", policy.get("rights_required", False))
    human_review = policy.get("humanReviewRequired", policy.get("human_review_required", False))
    if external_publish:
        errors.append("externalPublish is blocked in P0")
    if paid_generation:
        errors.append("paidGeneration requires approval and is disabled in P0")
    if not rights_required:
        warnings.append("rightsRequired is not true")
    if not human_review:
        warnings.append("humanReviewRequired is not true")

    result = {
        "valid": not errors,
        "recipeId": recipe_id,
        "kind": kind,
        "errors": errors,
        "warnings": warnings,
        "externalSideEffectsBlocked": True,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())

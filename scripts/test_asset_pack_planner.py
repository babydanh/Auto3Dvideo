"""Test deterministic Muse Asset Pack planning and prompt compilation."""
from __future__ import annotations

import copy
import json
import tempfile
from pathlib import Path

from asset_pack_planner import compile_documents, validate_plan
from validate_asset_pack import validate


def fixture() -> dict:
    return {
        "schemaVersion": "1.0.0",
        "packId": "dinosaur-tiger-assets-v2",
        "projectId": "dinosaur-tiger",
        "title": "Giant tiger in the Cretaceous",
        "bibleVersions": {"character": "character-bible-v1", "world": "world-bible-v1", "style": "style-bible-v1"},
        "identityAnchors": [{"anchorId": "tiger-giant-v1", "name": "Eight meter Bengal tiger", "description": "Orange coat, fixed dark stripes, amber eyes and a scar over the right cheek.", "scaleMeters": 8, "prohibitedChanges": ["no stripe changes", "no extra limbs", "no species change"]}],
        "items": [
            {"assetItemId": "tiger-identity-hero-v2", "title": "Tiger identity hero", "role": "identity", "identityAnchorId": "tiger-giant-v1", "storyPurpose": "Lock the hero appearance before Blender and Flow.", "shotIds": ["SHOT-001", "SHOT-004"], "requiredViews": ["hero", "three-quarter"], "world": "Neutral dark studio background with a clean silhouette.", "action": "Neutral standing pose, feet and tail visible.", "camera": "Orthographic full-body camera, centered composition.", "lighting": "Soft neutral key with a subtle cyan rim and readable fur material.", "continuity": ["fixed stripe pattern", "eight meter scale", "same scar"], "negativePrompt": "No text, logo, watermark, contact sheet, split screen or identity drift."},
            {"assetItemId": "cretaceous-world-v2", "title": "Cretaceous valley", "role": "environment", "identityAnchorId": None, "storyPurpose": "Lock the landscape and atmospheric continuity.", "shotIds": ["SHOT-001", "SHOT-004"], "requiredViews": ["establishing"], "world": "Cretaceous valley, fern forest, distant cliffs and a riverbed.", "action": "Wind moves ferns and dust through the valley.", "camera": "Wide 24mm establishing view with a low horizon.", "lighting": "Late afternoon volumetric sunlight, teal shadows and warm highlights.", "continuity": ["same valley landmark", "same time of day"], "negativePrompt": "No modern buildings, text, logo, watermark or random extra animals."},
            {"assetItemId": "tiger-scale-v2", "title": "Tiger scale reference", "role": "scale_reference", "identityAnchorId": "tiger-giant-v1", "storyPurpose": "Make the eight meter height readable against a human and trees.", "shotIds": ["SHOT-001"], "requiredViews": ["scale"], "scaleMeters": 8, "world": "Cretaceous clearing with a human silhouette and ferns for comparison.", "action": "Tiger stands still while the scale markers remain readable.", "camera": "Side profile orthographic comparison frame.", "lighting": "Clear diffuse daylight with ground contact shadows.", "continuity": ["eight meter height", "feet planted on ground"], "negativePrompt": "No distorted proportions, no tiny tiger, no text, logo or watermark."},
        ],
        "policy": {"requiresHumanReview": True, "requiresScaleReference": True, "requiredRoles": ["identity", "environment", "scale_reference"]},
    }


def main() -> int:
    plan = fixture()
    schema_path = Path(__file__).resolve().parent.parent / "contracts" / "asset-pack-plan.schema.json"
    if validate_plan(plan, schema_path):
        raise SystemExit("valid_plan_rejected")
    pack, items = compile_documents(plan)
    with tempfile.TemporaryDirectory(prefix="auto3dvideo-planner-") as directory:
        root = Path(directory)
        pack_path, items_path = root / "asset-pack.json", root / "asset-items.json"
        pack_path.write_text(json.dumps(pack), encoding="utf-8")
        items_path.write_text(json.dumps({"items": items}), encoding="utf-8")
        errors = validate(pack_path, items_path, Path(__file__).resolve().parent.parent / "contracts")
        if errors:
            raise SystemExit("compiled_plan_rejected: " + " | ".join(errors))
        print("compiled_output=PASS")
        if "Identity anchor:" not in items[0]["prompt"] or "Camera/composition:" not in items[0]["prompt"]:
            raise SystemExit("prompt_missing_grounding")
        if items[0]["prompt"] == items[1]["prompt"]:
            raise SystemExit("prompts_not_per_item")
        print("per_item_prompt_grounding=PASS")

    invalid = copy.deepcopy(plan)
    invalid["items"][0]["assetItemId"] = invalid["items"][1]["assetItemId"]
    try:
        compile_documents(invalid)
    except ValueError:
        print("duplicate_asset_item_rejected=PASS")
    else:
        raise SystemExit("duplicate_asset_item_accepted")

    invalid = copy.deepcopy(plan)
    invalid["items"][2]["scaleMeters"] = None
    try:
        compile_documents(invalid)
    except ValueError:
        print("missing_scale_reference_rejected=PASS")
    else:
        raise SystemExit("missing_scale_reference_accepted")

    print("ASSET_PACK_PLANNER_TEST=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Exercise valid and invalid Asset Pack manifests without provider or Blender side effects."""
from __future__ import annotations

import copy
import json
import tempfile
from pathlib import Path

from validate_asset_pack import validate


NOW = "2026-09-11T10:00:00Z"
HASH = "a" * 64


def build_documents() -> tuple[dict, list[dict], dict]:
    item_specs = [
        ("tiger-identity-hero", "tiger-giant-v1", "identity", "Giant Bengal tiger identity hero"),
        ("cretaceous-world-establishing", None, "environment", "Cretaceous valley environment anchor"),
        ("tiger-scale-reference", "tiger-giant-v1", "scale_reference", "Eight meter tiger scale reference"),
    ]
    items: list[dict] = []
    summaries: list[dict] = []
    for index, (item_id, anchor_id, role, title) in enumerate(item_specs, start=1):
        asset_id = f"asset-{index:03d}-{role.replace('_', '-')}"
        item = {
            "schemaVersion": "1.0.0",
            "assetItemId": item_id,
            "packId": "dinosaur-tiger-assets-v1",
            "title": title,
            "identityAnchorId": anchor_id,
            "role": role,
            "prompt": f"Create a cinematic 3D reference image for {title}. Preserve approved identity, scale and continuity anchors.",
            "negativePrompt": "No text, logo, watermark, contact sheet, split screen, duplicate subject or identity drift.",
            "promptVersion": "asset-pack-compiler-v1",
            "referenceAssetIds": [],
            "shotIds": ["SHOT-001", "SHOT-004"],
            "requiredViews": ["hero" if role == "identity" else "establishing"],
            "width": 1536,
            "height": 864,
            "scaleMeters": 8 if role == "scale_reference" else None,
            "continuityAnchors": ["same palette", "same world scale"],
            "provider": {"adapter": "nano_banana_mcp", "model": None, "transport": "cdp"},
            "status": "needs_review",
            "reviewState": "in_review",
            "rightsStatus": "pending",
            "acceptanceChecks": [
                {"checkId": "identity-stable", "description": "Identity and silhouette are stable", "required": True, "status": "pending", "evidence": None},
                {"checkId": "output-readable", "description": "Output can be opened and hashed", "required": True, "status": "pending", "evidence": None},
            ],
            "generationAttempts": [{"attempt": 1, "provider": "nano_banana_mcp", "promptHash": HASH, "status": "succeeded", "createdAt": NOW}],
            "outputAssetIds": [asset_id],
        }
        items.append(item)
        summaries.append({
            "assetItemId": item_id,
            "identityAnchorId": anchor_id,
            "role": role,
            "status": "needs_review",
            "reviewState": "in_review",
            "rightsStatus": "pending",
            "outputAssetIds": [asset_id],
        })

    pack = {
        "schemaVersion": "1.0.0",
        "packId": "dinosaur-tiger-assets-v1",
        "projectId": "dinosaur-tiger",
        "title": "Giant tiger in the Cretaceous asset pack",
        "status": "needs_review",
        "bibleVersions": {"character": "character-bible-v1", "world": "world-bible-v1", "style": "style-bible-v1"},
        "identityAnchors": ["tiger-giant-v1"],
        "assetItems": summaries,
        "acceptancePolicy": {
            "requiresHumanReview": True,
            "requiresApprovedIdentityAnchor": True,
            "requiresApprovedRights": True,
            "requiresScaleReference": True,
            "requiredRoles": ["identity", "environment", "scale_reference"],
        },
        "promptCompilerVersion": "asset-pack-compiler-v1",
        "createdAt": NOW,
        "updatedAt": NOW,
    }
    report = {
        "schemaVersion": "1.0.0",
        "reportId": "asset-run-report-v1",
        "jobType": "asset.pack.generate",
        "projectId": "dinosaur-tiger",
        "packId": "dinosaur-tiger-assets-v1",
        "runId": "asset-run-v1",
        "status": "succeeded_needs_review",
        "itemCounts": {"total": 3, "succeeded": 0, "failed": 0, "blocked": 0, "needsReview": 3},
        "items": [
            {
                "assetItemId": item["assetItemId"],
                "status": "needs_review",
                "requestHash": HASH,
                "provider": {"adapter": "nano_banana_mcp", "serverVersion": None, "targetModel": None},
                "attempts": [{"attempt": 1, "status": "succeeded", "retryable": False, "failureCode": None, "message": None}],
                "outputs": [{"assetId": item["outputAssetIds"][0], "relativePath": f"assets/{item['outputAssetIds'][0]}.png", "sha256": HASH, "width": 1536, "height": 864, "status": "ingested", "providerJobId": None, "error": None}],
                "rightsStatus": "pending",
                "reviewState": "in_review",
                "costObservation": {"mode": "unknown", "creditsUsed": None, "amountUsd": None, "note": "Provider UI credit state must be reviewed by the user."},
                "failureCode": None,
                "message": None,
            }
            for item in items
        ],
        "errors": [],
        "createdAt": NOW,
        "updatedAt": NOW,
    }
    return pack, items, report


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    pack, items, report = build_documents()
    with tempfile.TemporaryDirectory(prefix="auto3dvideo-asset-pack-") as directory:
        root = Path(directory)
        pack_path, items_path, report_path = root / "pack.json", root / "items.json", root / "report.json"
        write_json(pack_path, pack)
        write_json(items_path, {"items": items})
        write_json(report_path, report)
        errors = validate(pack_path, items_path, Path(__file__).resolve().parent.parent / "contracts", report_path)
        if errors:
            raise SystemExit("valid_fixture_rejected: " + " | ".join(errors))
        print("valid_fixture=PASS")

        invalid_cases = []
        invalid_identity = copy.deepcopy(items)
        invalid_identity[0]["identityAnchorId"] = None
        invalid_cases.append(("missing_identity_anchor", invalid_identity, None))

        invalid_prompt = copy.deepcopy(items)
        invalid_prompt[0]["prompt"] += " api_key=should-never-be-here"
        invalid_cases.append(("secret_in_prompt", invalid_prompt, None))

        invalid_pack = copy.deepcopy(pack)
        invalid_pack["status"] = "approved"
        invalid_cases.append(("approved_before_review", items, invalid_pack))

        for name, bad_items, bad_pack in invalid_cases:
            case_pack_path, case_items_path = root / f"{name}-pack.json", root / f"{name}-items.json"
            write_json(case_pack_path, bad_pack or pack)
            write_json(case_items_path, {"items": bad_items})
            if not validate(case_pack_path, case_items_path, Path(__file__).resolve().parent.parent / "contracts"):
                raise SystemExit(f"invalid_fixture_accepted: {name}")
            print(f"{name}=PASS")
    print("ASSET_PACK_VALIDATOR_TEST=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

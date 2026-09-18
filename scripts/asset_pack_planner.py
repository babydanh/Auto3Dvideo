"""Compile a typed Muse asset plan into an Asset Pack and per-item image prompts."""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

from validate_asset_pack import validate


ROLE_LABELS = {
    "identity": "identity reference",
    "composition": "composition reference",
    "pose": "pose reference",
    "camera": "camera reference",
    "style": "style reference",
    "environment": "environment reference",
    "prop": "prop reference",
    "scale_reference": "scale reference",
    "start_frame": "start-frame reference",
    "end_frame": "end-frame reference",
}


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read JSON {path}: {exc}") from exc


def validate_plan(document: Any, schema_path: Path) -> list[str]:
    schema = load_json(schema_path)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    return [
        f"{error.message} at {'/'.join(str(part) for part in error.absolute_path) or '<root>'}"
        for error in sorted(validator.iter_errors(document), key=lambda error: list(error.absolute_path))
    ]


def compile_prompt(item: dict[str, Any], anchor_by_id: dict[str, dict[str, Any]]) -> str:
    anchor = anchor_by_id.get(item.get("identityAnchorId"))
    sections = [
        f"Create a cinematic 3D {ROLE_LABELS[item['role']]} for the project asset pack.",
        f"Asset title: {item['title']}.",
        f"Story purpose: {item['storyPurpose']}.",
    ]
    if anchor:
        sections.append(f"Identity anchor: {anchor['name']}. {anchor['description']}")
        if anchor.get("scaleMeters") is not None:
            sections.append(f"Locked real-world scale: {anchor['scaleMeters']} meters.")
        sections.append("Prohibited identity changes: " + "; ".join(anchor["prohibitedChanges"]) + ".")
    sections.extend([
        f"World/environment: {item['world']}.",
        f"Action or pose: {item.get('action') or 'neutral presentation pose with readable silhouette'}.",
        f"Camera/composition: {item['camera']}.",
        f"Lighting/material/color: {item['lighting']}.",
        "Continuity anchors: " + "; ".join(item["continuity"]) + ".",
        "Required views: " + ", ".join(item["requiredViews"]) + ".",
        f"Output role: {ROLE_LABELS[item['role']]}; do not create a contact sheet or multiple unrelated frames.",
        "Preserve subject count, anatomy, silhouette, scale, palette and screen direction across all views.",
    ])
    return "\n".join(sections)


def compile_documents(plan: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    anchors = plan["identityAnchors"]
    anchor_by_id = {anchor["anchorId"]: anchor for anchor in anchors}
    if len(anchor_by_id) != len(anchors):
        raise ValueError("duplicate identity anchorId")
    items = plan["items"]
    item_ids = [item["assetItemId"] for item in items]
    if len(set(item_ids)) != len(item_ids):
        raise ValueError("duplicate assetItemId")

    errors: list[str] = []
    roles = {item["role"] for item in items}
    for item in items:
        role = item["role"]
        anchor_id = item.get("identityAnchorId")
        if role in {"identity", "scale_reference"} and anchor_id not in anchor_by_id:
            errors.append(f"{item['assetItemId']} requires a known identityAnchorId")
        if role == "scale_reference" and item.get("scaleMeters") is None:
            errors.append(f"{item['assetItemId']} requires scaleMeters")
        if anchor_id is not None and anchor_id not in anchor_by_id:
            errors.append(f"{item['assetItemId']} references unknown identityAnchorId={anchor_id}")
    for anchor_id in anchor_by_id:
        if not any(item["role"] == "identity" and item.get("identityAnchorId") == anchor_id for item in items):
            errors.append(f"identity anchor has no identity item: {anchor_id}")
    for required_role in plan["policy"]["requiredRoles"]:
        if required_role not in roles:
            errors.append(f"required asset role is missing: {required_role}")
    if plan["policy"]["requiresScaleReference"] and "scale_reference" not in roles:
        errors.append("policy requires scale_reference")
    if errors:
        raise ValueError("; ".join(errors))

    compiled_items: list[dict[str, Any]] = []
    summaries: list[dict[str, Any]] = []
    for item in items:
        prompt = compile_prompt(item, anchor_by_id)
        prompt_hash = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
        compiled_items.append({
            "schemaVersion": "1.0.0",
            "assetItemId": item["assetItemId"],
            "packId": plan["packId"],
            "title": item["title"],
            "identityAnchorId": item.get("identityAnchorId"),
            "role": item["role"],
            "prompt": prompt,
            "negativePrompt": item["negativePrompt"],
            "promptVersion": "asset-pack-compiler-v1",
            "referenceAssetIds": item.get("referenceAssetIds", []),
            "shotIds": item["shotIds"],
            "requiredViews": item["requiredViews"],
            "width": item.get("width", 1536),
            "height": item.get("height", 864),
            "scaleMeters": item.get("scaleMeters"),
            "continuityAnchors": item["continuity"],
            "provider": {"adapter": "nano_banana_mcp", "model": None, "transport": "cdp"},
            "status": "planned",
            "reviewState": "not_started",
            "rightsStatus": "pending",
            "acceptanceChecks": [
                {"checkId": "prompt-grounded", "description": "Prompt contains identity/world/camera/lighting grounding", "required": True, "status": "pending", "evidence": None},
                {"checkId": "identity-stable", "description": "Output preserves identity and silhouette anchors", "required": True, "status": "pending", "evidence": None},
                {"checkId": "output-readable", "description": "Output can be opened, hashed and ingested", "required": True, "status": "pending", "evidence": None},
            ],
            "generationAttempts": [],
            "outputAssetIds": [],
            "note": f"Compiled prompt hash: {prompt_hash}; source bible versions are pinned in the pack.",
        })
        summaries.append({
            "assetItemId": item["assetItemId"],
            "identityAnchorId": item.get("identityAnchorId"),
            "role": item["role"],
            "status": "planned",
            "reviewState": "not_started",
            "rightsStatus": "pending",
            "outputAssetIds": [],
        })

    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    pack = {
        "schemaVersion": "1.0.0",
        "packId": plan["packId"],
        "projectId": plan["projectId"],
        "title": plan["title"],
        "status": "planned",
        "bibleVersions": plan["bibleVersions"],
        "identityAnchors": [anchor["anchorId"] for anchor in anchors],
        "assetItems": summaries,
        "acceptancePolicy": {
            "requiresHumanReview": True,
            "requiresApprovedIdentityAnchor": True,
            "requiresApprovedRights": True,
            "requiresScaleReference": plan["policy"]["requiresScaleReference"],
            "requiredRoles": plan["policy"]["requiredRoles"],
        },
        "promptCompilerVersion": "asset-pack-compiler-v1",
        "note": "Planning output only; no provider or Blender execution has started.",
        "createdAt": now,
        "updatedAt": now,
    }
    return pack, compiled_items


def write_new(path: Path, document: Any) -> None:
    if path.exists():
        raise ValueError(f"refusing to overwrite existing file: {path}")
    path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Compile a Muse Asset Pack plan without calling providers")
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parent.parent)
    args = parser.parse_args()
    try:
        project_root = args.project_root.resolve()
        plan = load_json(args.plan.resolve())
        plan_errors = validate_plan(plan, project_root / "contracts" / "asset-pack-plan.schema.json")
        if plan_errors:
            raise ValueError("plan schema invalid: " + " | ".join(plan_errors))
        pack, items = compile_documents(plan)
        output_dir = args.output_dir.resolve()
        if not output_dir.is_relative_to(project_root):
            raise ValueError("output directory must stay inside project root")
        output_dir.mkdir(parents=True, exist_ok=True)
        pack_path, items_path = output_dir / "asset-pack.json", output_dir / "asset-items.json"
        write_new(pack_path, pack)
        write_new(items_path, {"items": items})
        errors = validate(pack_path, items_path, project_root / "contracts")
        if errors:
            raise ValueError("compiled output invalid: " + " | ".join(errors))
    except (OSError, ValueError) as exc:
        print(f"ASSET_PACK_PLAN_INVALID\n{exc}")
        return 1
    print("ASSET_PACK_PLAN_COMPILED")
    print(f"pack={pack_path}")
    print(f"items={len(items)}")
    print("provider_execution=not_started")
    print("blender_execution=not_started")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

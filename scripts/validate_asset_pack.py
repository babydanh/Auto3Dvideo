"""Validate an Asset Pack, item manifest and optional generation report without running providers."""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

from asset_pack_state import can_transition

try:
    from jsonschema import Draft202012Validator, FormatChecker
except ImportError as exc:  # pragma: no cover - environment diagnostic
    raise SystemExit("jsonschema is required to validate asset packs") from exc


SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{2,95}$")
SHOT_ID = re.compile(r"^[A-Z0-9][A-Z0-9_-]{2,63}$")
SECRET_MARKERS = ("api_key=", "apikey=", "secret=", "password=", "bearer ", "sk-")
FORBIDDEN_KEYS = {"command", "rawcommand", "shell", "rawargs", "executable", "upload", "publish"}
UNAPPROVED_RIGHTS = {"unknown", "pending", "restricted", "rejected"}


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read JSON {path}: {exc}") from exc


def load_items(path: Path) -> list[dict[str, Any]]:
    document = load_json(path)
    if isinstance(document, list):
        items = document
    elif isinstance(document, dict) and isinstance(document.get("items"), list):
        items = document["items"]
    else:
        raise ValueError("items document must be an array or an object with an items array")
    if not all(isinstance(item, dict) for item in items):
        raise ValueError("items array must contain objects")
    return items


def schema_errors(document: Any, schema_path: Path, label: str) -> list[str]:
    schema = load_json(schema_path)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    return [f"{label}: {error.message} at {'/'.join(str(part) for part in error.absolute_path) or '<root>'}" for error in sorted(validator.iter_errors(document), key=lambda error: list(error.absolute_path))]


def contains_forbidden(value: Any, path: str = "document") -> str | None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = re.sub(r"[^a-z0-9]", "", str(key).casefold())
            if normalized in {re.sub(r"[^a-z0-9]", "", item) for item in FORBIDDEN_KEYS}:
                return f"{path}.{key} is not allowed"
            found = contains_forbidden(child, f"{path}.{key}")
            if found:
                return found
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found = contains_forbidden(child, f"{path}[{index}]")
            if found:
                return found
    return None


def prompt_has_secret_marker(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    lowered = value.casefold()
    return any(marker in lowered for marker in SECRET_MARKERS)


def semantic_errors(pack: dict[str, Any], items: list[dict[str, Any]], report: Any | None) -> list[str]:
    errors: list[str] = []
    pack_id = pack.get("packId")
    project_id = pack.get("projectId")
    pack_summaries = pack.get("assetItems", [])
    summary_by_id = {item.get("assetItemId"): item for item in pack_summaries if isinstance(item, dict)}
    item_by_id = {item.get("assetItemId"): item for item in items}

    if len(summary_by_id) != len(pack_summaries):
        errors.append("pack.assetItems contains duplicate or invalid assetItemId values")
    if set(summary_by_id) != set(item_by_id):
        errors.append("pack.assetItems IDs must exactly match the item manifest IDs")
    for item_id, item in item_by_id.items():
        prefix = f"items[{item_id}]"
        if item.get("packId") != pack_id:
            errors.append(f"{prefix}.packId must match pack.packId")
        for shot_id in item.get("shotIds", []):
            if not SHOT_ID.fullmatch(shot_id):
                errors.append(f"{prefix}.shotIds contains invalid shot id: {shot_id}")
        if prompt_has_secret_marker(item.get("prompt")) or prompt_has_secret_marker(item.get("negativePrompt")):
            errors.append(f"{prefix} prompt contains a credential marker")
        role = item.get("role")
        anchor = item.get("identityAnchorId")
        if role in {"identity", "scale_reference"} and not isinstance(anchor, str):
            errors.append(f"{prefix} role {role} requires identityAnchorId")
        if role == "scale_reference" and item.get("scaleMeters") is None:
            errors.append(f"{prefix} scale_reference requires scaleMeters")
        required_checks = [check for check in item.get("acceptanceChecks", []) if check.get("required") is True]
        if item.get("status") == "approved":
            if item.get("reviewState") != "approved":
                errors.append(f"{prefix} approved status requires reviewState=approved")
            if item.get("rightsStatus") in UNAPPROVED_RIGHTS:
                errors.append(f"{prefix} approved status cannot use rightsStatus={item.get('rightsStatus')}")
            if not item.get("outputAssetIds"):
                errors.append(f"{prefix} approved status requires outputAssetIds")
            if any(check.get("status") != "pass" for check in required_checks):
                errors.append(f"{prefix} has a required acceptance check that is not pass")

        summary = summary_by_id.get(item_id)
        if summary:
            for field in ("role", "status", "reviewState", "rightsStatus"):
                if summary.get(field) != item.get(field):
                    errors.append(f"pack.assetItems[{item_id}].{field} does not match item manifest")
            if summary.get("identityAnchorId") != item.get("identityAnchorId"):
                errors.append(f"pack.assetItems[{item_id}].identityAnchorId does not match item manifest")
            if summary.get("outputAssetIds") != item.get("outputAssetIds"):
                errors.append(f"pack.assetItems[{item_id}].outputAssetIds does not match item manifest")

    anchors = set(pack.get("identityAnchors", []))
    referenced_anchors = {item.get("identityAnchorId") for item in items if item.get("role") == "identity" and item.get("identityAnchorId")}
    missing_anchor_items = anchors - referenced_anchors
    if missing_anchor_items:
        errors.append(f"identityAnchors missing identity items: {sorted(missing_anchor_items)}")

    policy = pack.get("acceptancePolicy", {})
    roles = {item.get("role") for item in items}
    for required_role in policy.get("requiredRoles", []):
        if required_role not in roles:
            errors.append(f"required asset role is missing: {required_role}")
    if policy.get("requiresScaleReference") and "scale_reference" not in roles:
        errors.append("acceptancePolicy requires a scale_reference item")

    if pack.get("status") == "approved":
        if any(item.get("status") != "approved" for item in items):
            errors.append("approved pack requires every item to be approved")
        if policy.get("requiresApprovedIdentityAnchor") and any(item.get("role") == "identity" and item.get("reviewState") != "approved" for item in items):
            errors.append("approved pack requires all identity items to be reviewed and approved")
        if policy.get("requiresApprovedRights") and any(item.get("rightsStatus") in UNAPPROVED_RIGHTS for item in items):
            errors.append("approved pack contains an item without approved rights")

    if report is not None:
        report_ids = {item.get("assetItemId") for item in report.get("items", [])}
        if report.get("packId") != pack_id or report.get("projectId") != project_id:
            errors.append("generation report packId/projectId does not match pack")
        if report_ids - set(item_by_id):
            errors.append("generation report contains an unknown assetItemId")
        counts = report.get("itemCounts", {})
        if counts.get("total") != len(report.get("items", [])):
            errors.append("generation report itemCounts.total does not match items length")
        observed = {
            "succeeded": sum(item.get("status") == "succeeded" for item in report.get("items", [])),
            "failed": sum(item.get("status") == "failed" for item in report.get("items", [])),
            "blocked": sum(item.get("status") == "blocked" for item in report.get("items", [])),
            "needsReview": sum(item.get("status") == "needs_review" for item in report.get("items", [])),
        }
        for field, value in observed.items():
            if counts.get(field) != value:
                errors.append(f"generation report itemCounts.{field} does not match observed item status")
    return errors


def validate(pack_path: Path, items_path: Path, schema_dir: Path, report_path: Path | None = None) -> list[str]:
    pack = load_json(pack_path)
    items = load_items(items_path)
    errors: list[str] = []
    errors.extend(schema_errors(pack, schema_dir / "asset-pack.schema.json", "pack"))
    for index, item in enumerate(items):
        errors.extend(schema_errors(item, schema_dir / "asset-pack-item.schema.json", f"items[{index}]"))
    report = load_json(report_path) if report_path else None
    if report is not None:
        errors.extend(schema_errors(report, schema_dir / "asset-generation-report.schema.json", "report"))
    if isinstance(pack, dict) and isinstance(pack.get("assetItems"), list) and all(isinstance(item, dict) for item in items):
        errors.extend(semantic_errors(pack, items, report))
    forbidden = contains_forbidden(pack)
    if forbidden:
        errors.append(forbidden)
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate an Auto3Dvideo Asset Pack without generating media")
    parser.add_argument("--pack", required=True, type=Path)
    parser.add_argument("--items", required=True, type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--schema-dir", type=Path, default=Path(__file__).resolve().parent.parent / "contracts")
    args = parser.parse_args()
    try:
        errors = validate(args.pack.resolve(), args.items.resolve(), args.schema_dir.resolve(), args.report.resolve() if args.report else None)
    except ValueError as exc:
        print(f"ASSET_PACK_INVALID\n{exc}")
        return 1
    if errors:
        print("ASSET_PACK_INVALID")
        print("\n".join(f"- {error}" for error in errors))
        return 1
    print("ASSET_PACK_VALID")
    print(f"pack={args.pack.resolve()}")
    print(f"items={len(load_items(args.items.resolve()))}")
    if args.report:
        print(f"report={args.report.resolve()}")
    print("provider_execution=not_started")
    print("blender_execution=not_started")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Test the mock delivery package without creating media or running workers."""
from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path

from build_mock_delivery import build_package
from validate_delivery import validate_manifest


def recipe() -> dict:
    return {
        "schemaVersion": "1.0.0",
        "recipeId": "test-slideshow",
        "kind": "image_slideshow",
        "fps": 30,
        "width": 1080,
        "height": 1920,
        "durationSeconds": 5,
        "policy": {
            "rightsRequired": True,
            "humanReviewRequired": True,
            "externalPublish": False,
            "paidGeneration": False,
        },
    }


def write_recipe(path: Path) -> None:
    path.write_text(json.dumps(recipe()), encoding="utf-8")


def expect_rejected(callable_obj, label: str) -> None:
    try:
        callable_obj()
    except (FileExistsError, ValueError):
        return
    raise SystemExit(f"expected_rejection_missing={label}")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="auto3dvideo-mock-delivery-") as directory:
        root = Path(directory)
        recipe_path = root / "recipe.json"
        write_recipe(recipe_path)
        manifest_path = build_package(root, recipe_path, root / "delivery")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest_errors = validate_manifest(manifest_path)
        if manifest_errors:
            raise SystemExit(f"generated_manifest_invalid={manifest_errors}")
        if manifest["status"] != "blocked":
            raise SystemExit("mock_delivery_must_be_blocked")
        if manifest["rightsReview"] != "pending" or manifest["aiDisclosure"] != "required_pending":
            raise SystemExit("policy_gate_state_mismatch")
        for record in manifest["files"]:
            file_path = manifest_path.parent / record["relativePath"]
            digest = hashlib.sha256(file_path.read_bytes()).hexdigest()
            if digest != record["sha256"] or file_path.stat().st_size != record["sizeBytes"]:
                raise SystemExit(f"manifest_hash_mismatch={record['relativePath']}")

        expect_rejected(
            lambda: build_package(root, recipe_path, root / "delivery"),
            "existing_output_overwrite",
        )
        expect_rejected(
            lambda: build_package(root, recipe_path, root.parent / "outside"),
            "output_escape",
        )

        premature = json.loads(manifest_path.read_text(encoding="utf-8"))
        premature["status"] = "approved"
        premature_path = root / "premature-manifest.json"
        premature_path.write_text(json.dumps(premature), encoding="utf-8")
        if not validate_manifest(premature_path):
            raise SystemExit("premature_approval_not_blocked")

        unknown_field = json.loads(manifest_path.read_text(encoding="utf-8"))
        unknown_field["unexpected"] = "must be rejected"
        unknown_path = root / "unknown-field-manifest.json"
        unknown_path.write_text(json.dumps(unknown_field), encoding="utf-8")
        if not validate_manifest(unknown_path):
            raise SystemExit("unknown_field_not_rejected")

        malformed = json.loads(manifest_path.read_text(encoding="utf-8"))
        malformed["files"] = None
        malformed_path = root / "malformed-files-manifest.json"
        malformed_path.write_text(json.dumps(malformed), encoding="utf-8")
        if not validate_manifest(malformed_path):
            raise SystemExit("malformed_files_not_rejected")

        invalid_dimensions = json.loads(manifest_path.read_text(encoding="utf-8"))
        invalid_dimensions["width"] = True
        invalid_dimensions_path = root / "invalid-dimensions-manifest.json"
        invalid_dimensions_path.write_text(json.dumps(invalid_dimensions), encoding="utf-8")
        if not validate_manifest(invalid_dimensions_path):
            raise SystemExit("invalid_dimensions_not_rejected")

        duplicate = json.loads(manifest_path.read_text(encoding="utf-8"))
        duplicate["files"].append(dict(duplicate["files"][0], relativePath="./metadata.json"))
        duplicate_path = root / "duplicate-manifest.json"
        duplicate_path.write_text(json.dumps(duplicate), encoding="utf-8")
        if not validate_manifest(duplicate_path):
            raise SystemExit("normalized_duplicate_not_rejected")

        nonfinite = json.loads(manifest_path.read_text(encoding="utf-8"))
        nonfinite["frameRate"] = float("nan")
        nonfinite_path = root / "nonfinite-manifest.json"
        nonfinite_path.write_text(json.dumps(nonfinite), encoding="utf-8")
        if not validate_manifest(nonfinite_path):
            raise SystemExit("nonfinite_frame_rate_not_rejected")

        boolean_size = json.loads(manifest_path.read_text(encoding="utf-8"))
        boolean_size["files"][0]["sizeBytes"] = True
        boolean_size_path = root / "boolean-size-manifest.json"
        boolean_size_path.write_text(json.dumps(boolean_size), encoding="utf-8")
        if not validate_manifest(boolean_size_path):
            raise SystemExit("boolean_size_not_rejected")

    print("MOCK_DELIVERY_TEST=PASS")
    print("manifest_hashes=PASS")
    print("manifest_validator=PASS")
    print("blocked_policy=PASS")
    print("overwrite_protection=PASS")
    print("path_containment=PASS")
    print("approval_gate=PASS")
    print("unknown_field_gate=PASS")
    print("malformed_manifest_gate=PASS")
    print("dimension_gate=PASS")
    print("normalized_duplicate_gate=PASS")
    print("finite_number_gate=PASS")
    print("file_size_type_gate=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

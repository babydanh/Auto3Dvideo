"""Bounded Blender quality/lookdev pass for staged model3d assets."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import bpy  # type: ignore

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
import blender_quality_toolkit as toolkit  # noqa: E402


FALLBACK_PRESET = {
    "engine": "BLENDER_EEVEE",
    "resolution": [720, 720],
    "fps": 24,
    "world": {"color": [0.03, 0.03, 0.03, 1.0], "strength": 0.3},
    "lights": [
        {"name": "LGT-key-neutral", "location": [3.0, -4.0, 5.0], "energy": 800, "color": [1.0, 0.92, 0.82], "size": 5.0},
        {"name": "LGT-fill-neutral", "location": [-3.0, 1.0, 3.0], "energy": 300, "color": [0.55, 0.7, 1.0], "size": 6.0},
        {"name": "LGT-rim-neutral", "location": [2.0, 3.0, 4.0], "energy": 500, "color": [1.0, 1.0, 1.0], "size": 3.0},
    ],
    "camera": {"lens": 70, "sensorWidth": 36, "dof": False, "safeArea": {"top": 0.05, "bottom": 0.05, "left": 0.05, "right": 0.05}},
}


def inside(root: Path, raw: str, *, must_exist: bool = True) -> Path:
    candidate = raw.replace("\\", "/")
    if Path(candidate).is_absolute() or candidate.startswith("/") or ".." in Path(candidate).parts:
        raise ValueError("quality path không an toàn")
    path = (root / candidate).resolve()
    path.relative_to(root.resolve())
    if must_exist and not path.exists():
        raise FileNotFoundError(str(path))
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description="Auto3Dvideo Blender asset quality pass")
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--spec", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--preset", default="studio_asset_validation")
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    args = parser.parse_args(argv)
    workspace = Path(args.workspace).resolve()
    spec = json.loads(inside(workspace, args.spec).read_text(encoding="utf-8"))
    output_dir = inside(workspace, args.output_dir, must_exist=False)
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        preset = toolkit.load_preset(str(workspace), args.preset)
    except FileNotFoundError:
        preset = FALLBACK_PRESET
    checks: list[dict[str, Any]] = []
    for asset in spec.get("assets", []):
        asset_id = asset["assetId"]
        source = inside(workspace, asset["relativePath"])
        asset_output = output_dir / asset_id
        asset_output.mkdir(parents=True, exist_ok=True)
        if source.suffix.lower() != ".blend":
            checks.append({"assetId": asset_id, "qualityState": "needs_review", "normalizationState": "needs_review", "reportPath": None, "normalizedRelativePath": None, "issues": ["blender_probe_not_supported_for_format"]})
            continue
        bpy.ops.wm.open_mainfile(filepath=str(source))
        toolkit.setup_lookdev(preset)
        toolkit.setup_camera(preset)
        normalized = asset_output / "normalized.blend"
        bpy.ops.wm.save_as_mainfile(filepath=str(normalized))
        report = toolkit.inspect_scene()
        report["assetId"] = asset_id
        report["sourcePath"] = asset["relativePath"]
        report["normalizedRelativePath"] = normalized.relative_to(workspace).as_posix()
        report["operation"] = "asset.normalize"
        report_path = asset_output / "blender-quality-report.json"
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        issues = [str(issue.get("code", "quality_issue")) for issue in report.get("issues", [])]
        checks.append({
            "assetId": asset_id,
            "qualityState": "pass" if not issues and report.get("objects") else "needs_review",
            "normalizationState": "lookdev_applied" if not issues else "needs_review",
            "reportPath": report_path.relative_to(workspace).as_posix(),
            "normalizedRelativePath": normalized.relative_to(workspace).as_posix(),
            "issues": issues,
        })
    output = {"schemaVersion": "1.0.0", "toolVersion": "blender-asset-quality-worker-1.0.0", "qualityChecks": checks}
    report_path = output_dir / "asset-quality-report.json"
    report_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"qualityReportPath": report_path.relative_to(workspace).as_posix(), "qualityChecks": checks}, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

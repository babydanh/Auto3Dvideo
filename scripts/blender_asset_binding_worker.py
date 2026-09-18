"""Blender-side preview worker for an approved Asset Pack binding.

This worker is intentionally reference-first: generated images are shown as
review boards, while model3d/scene inputs are validated but are not silently
converted into fake geometry. The native app prepares the binding and job,
copies this versioned worker into the run directory, and invokes it only
through the supervised Blender allowlist.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

import bpy


TOOL_VERSION = "blender-asset-binding-worker-1.0.0"


def safe_relative(raw: str) -> str:
    normalized = raw.strip().replace("\\", "/")
    path = Path(normalized)
    if not normalized or path.is_absolute() or "://" in normalized:
        raise ValueError("đường dẫn phải là relative path trong workspace")
    if any(part in {"", ".", ".."} for part in normalized.split("/")):
        raise ValueError("đường dẫn binding không được có segment nguy hiểm")
    return normalized


def inside(workspace: Path, raw: str) -> Path:
    candidate = (workspace / safe_relative(raw)).resolve()
    root = workspace.resolve()
    if not candidate.is_relative_to(root):
        raise ValueError("đường dẫn vượt workspace")
    return candidate


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(64 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_binding(workspace: Path, raw_path: str) -> dict[str, Any]:
    path = inside(workspace, raw_path)
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict) or document.get("schemaVersion") != "1.0.0":
        raise ValueError("binding sai schemaVersion")
    if document.get("status") != "ready_for_blender_review":
        raise ValueError("binding chưa ở trạng thái ready_for_blender_review")
    if document.get("humanReviewRequired") is not True:
        raise ValueError("binding phải giữ humanReviewRequired=true")
    if document.get("blenderExecutionStarted") is not False:
        raise ValueError("binding đã bị đánh dấu đã chạy Blender")
    bindings = document.get("assetBindings")
    if not isinstance(bindings, list) or not bindings:
        raise ValueError("binding thiếu assetBindings")
    return document


def validate_inputs(workspace: Path, binding: dict[str, Any]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    expected_hashes = set(binding.get("approvedReferenceHashes", []))
    for item in binding["assetBindings"]:
        if not isinstance(item, dict):
            raise ValueError("asset binding phải là object")
        if item.get("reviewState") != "approved" or item.get("locked") is not True:
            raise ValueError(f"asset binding chưa approved/locked: {item.get('bindingId')}")
        source = inside(workspace, str(item["sourcePath"]))
        if not source.is_file() or source.stat().st_size == 0:
            raise ValueError(f"source asset không tồn tại/rỗng: {item['sourcePath']}")
        actual_hash = sha256_file(source)
        if actual_hash.lower() != str(item["assetSha256"]).lower():
            raise ValueError(f"hash asset không khớp: {item['assetId']}")
        if actual_hash not in expected_hashes:
            raise ValueError(f"hash asset chưa nằm trong approvedReferenceHashes: {item['assetId']}")
        findings.append({
            "bindingId": item["bindingId"],
            "assetId": item["assetId"],
            "shotId": item["shotId"],
            "sourcePath": item["sourcePath"],
            "referenceKind": item["referenceKind"],
            "sha256": actual_hash,
            "status": "validated",
        })
    return findings


def material_for_image(image: bpy.types.Image, name: str) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    emission.inputs["Strength"].default_value = 1.0
    links.new(texture.outputs["Color"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def add_image_plane(image_path: Path, location: tuple[float, float, float], name: str) -> None:
    image = bpy.data.images.load(str(image_path), check_existing=True)
    bpy.ops.mesh.primitive_plane_add(size=4.0, location=location)
    plane = bpy.context.object
    plane.name = name
    plane.data.materials.append(material_for_image(image, f"MAT_{name}"))


def render_board(workspace: Path, render_root: Path, shot_id: str, items: list[dict[str, Any]]) -> tuple[str, list[str]]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = f"ASSET_PACK_BINDING_{shot_id}"
    scene.render.engine = next(
        (engine for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH")
         if engine in {item.identifier for item in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}),
        scene.render.engine,
    )
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.world.color = (0.008, 0.012, 0.02)
    bpy.ops.object.camera_add(location=(0.0, 0.0, 30.0))
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = max(8.0, 4.5 * max(1, len(items)))
    scene.camera = camera
    image_index = 0
    unsupported: list[str] = []
    for item in items:
        if item["referenceKind"] != "reference_image":
            unsupported.append(item["assetId"])
            continue
        source = inside(workspace, item["sourcePath"])
        try:
            x = (image_index - (len(items) - 1) / 2) * 4.4
            add_image_plane(source, (x, 0.0, 0.0), f"REF_{item['assetId']}")
            image_index += 1
        except Exception as error:  # pragma: no cover - exercised by Blender runtime
            raise ValueError(f"Không nạp được ảnh reference {item['assetId']}: {error}") from error
    output_dir = render_root / shot_id
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "frame-0001.png"
    scene.render.filepath = str(output_path)
    bpy.ops.render.render(write_still=True)
    scene_path = render_root.parent / "scene.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(scene_path))
    return output_path.relative_to(workspace).as_posix(), unsupported


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate and preview an Asset Pack Blender binding")
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--binding", required=True)
    parser.add_argument("--output-dir", required=True)
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    return parser.parse_args(argv)


def main() -> int:
    try:
        args = parse_args()
        workspace = Path(args.workspace).resolve()
        binding = load_binding(workspace, args.binding)
        findings = validate_inputs(workspace, binding)
        render_root = inside(workspace, args.output_dir)
        render_root.mkdir(parents=True, exist_ok=True)
        shot_ids = sorted({item["shotId"] for item in binding["assetBindings"]})
        outputs = []
        unsupported: list[str] = []
        for shot_id in shot_ids:
            shot_items = [item for item in binding["assetBindings"] if item["shotId"] == shot_id]
            output, shot_unsupported = render_board(workspace, render_root, shot_id, shot_items)
            outputs.append(output)
            unsupported.extend(shot_unsupported)
        report = {
            "schemaVersion": "1.0.0",
            "toolVersion": TOOL_VERSION,
            "bindingId": binding["bindingId"],
            "status": "succeeded_needs_review",
            "reviewState": "needs_review",
            "referenceOnly": True,
            "assetFindings": findings,
            "previewOutputs": outputs,
            "unsupportedKinds": sorted(set(unsupported)),
            "message": "Đây là preview board để review binding; reference image không được coi là model 3D hero asset.",
        }
        report_path = render_root.parent / "binding-preview-report.json"
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"status": report["status"], "reportPath": report_path.relative_to(workspace).as_posix(), "previewOutputs": outputs}, ensure_ascii=False), flush=True)
        return 0
    except Exception as error:
        print(json.dumps({"status": "failed", "message": f"{type(error).__name__}: {str(error)[:500]}"}, ensure_ascii=False), flush=True)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

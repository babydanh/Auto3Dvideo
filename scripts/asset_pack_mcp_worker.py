#!/usr/bin/env python3
"""Bounded Nano Banana MCP worker for dependency-ordered Asset Packs."""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

from nanobanana_mcp_worker import (
    StdioMcpClient,
    aspect_for,
    choose_new_image,
    image_snapshot,
    redact,
    relative_to_workspace,
    safe_relative,
    safe_text,
    sha256_file,
    validate_server,
)


MAX_TASKS = 64
MAX_ATTEMPTS = 2
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
ROLE_PRIORITY = {
    "identity": 0,
    "environment": 1,
    "prop": 2,
    "scale_reference": 3,
    "style": 4,
    "camera": 5,
    "composition": 6,
    "pose": 7,
    "start_frame": 8,
    "end_frame": 9,
}
SECRET_MARKERS = ("api_key=", "apikey=", "access_token=", "authorization:", "bearer ", "password=", "secret=", "token=")


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run dependency-ordered Asset Pack image tasks through Nano Banana MCP")
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--spec", required=True, type=Path)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--node", required=True, type=Path)
    parser.add_argument("--schema-dir", type=Path, default=Path(__file__).resolve().parent.parent / "contracts")
    return parser.parse_args()


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read JSON: {exc}") from exc


def load_spec(path: Path, schema_dir: Path) -> dict[str, Any]:
    spec = load_json(path)
    schema = load_json(schema_dir / "asset-pack-mcp-job.schema.json")
    errors = list(Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(spec))
    if errors:
        raise ValueError("asset pack MCP job schema invalid: " + "; ".join(error.message for error in errors[:8]))
    if len(spec["tasks"]) > MAX_TASKS:
        raise ValueError(f"asset pack MCP job has more than {MAX_TASKS} tasks")
    return spec


def order_tasks(tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    original_index: dict[str, int] = {}
    for index, task in enumerate(tasks):
        asset_id = task["assetItemId"]
        if asset_id in by_id:
            raise ValueError(f"duplicate assetItemId: {asset_id}")
        by_id[asset_id] = task
        original_index[asset_id] = index
    indegree = {asset_id: 0 for asset_id in by_id}
    dependents: dict[str, list[str]] = {asset_id: [] for asset_id in by_id}
    for asset_id, task in by_id.items():
        for dependency in task["dependsOn"]:
            if dependency not in by_id:
                raise ValueError(f"{asset_id} depends on unknown assetItemId={dependency}")
            indegree[asset_id] += 1
            dependents[dependency].append(asset_id)
    ready = [asset_id for asset_id, count in indegree.items() if count == 0]
    ordered: list[dict[str, Any]] = []
    while ready:
        ready.sort(key=lambda asset_id: (ROLE_PRIORITY.get(by_id[asset_id]["role"], 99), original_index[asset_id]))
        asset_id = ready.pop(0)
        ordered.append(by_id[asset_id])
        for dependent in dependents[asset_id]:
            indegree[dependent] -= 1
            if indegree[dependent] == 0:
                ready.append(dependent)
    if len(ordered) != len(tasks):
        raise ValueError("asset pack dependency graph contains a cycle")
    return ordered


def image_dimensions(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP" and len(data) >= 30:
        if data[12:16] == b"VP8X":
            return 1 + int.from_bytes(data[24:27], "little"), 1 + int.from_bytes(data[27:30], "little")
    if data.startswith(b"\xff\xd8"):
        index = 2
        while index + 9 < len(data):
            if data[index] != 0xFF:
                index += 1
                continue
            marker = data[index + 1]
            index += 2
            if marker in {0xD8, 0xD9}:
                continue
            if index + 2 > len(data):
                break
            length = int.from_bytes(data[index:index + 2], "big")
            if marker in set(range(0xC0, 0xC4)) | set(range(0xC5, 0xC8)) | set(range(0xC9, 0xCC)) | set(range(0xCD, 0xD0)):
                if index + 7 <= len(data):
                    return int.from_bytes(data[index + 5:index + 7], "big"), int.from_bytes(data[index + 3:index + 5], "big")
            index += max(length, 2)
    raise ValueError("output image dimensions are unreadable")


def numeric_cost(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


def find_cost_violation(value: Any) -> float | None:
    if isinstance(value, dict):
        for key, child in value.items():
            if str(key).casefold() in {"amountusd", "creditsused", "price"}:
                cost = numeric_cost(child)
                if cost is not None and cost > 0:
                    return cost
            violation = find_cost_violation(child)
            if violation is not None:
                return violation
    elif isinstance(value, list):
        for child in value:
            violation = find_cost_violation(child)
            if violation is not None:
                return violation
    return None


def task_arguments(task: dict[str, Any], workspace: Path, generated_refs: list[str]) -> dict[str, Any]:
    prompt = safe_text(task["prompt"], "Prompt", 12000)
    negative = safe_text(task["negativePrompt"], "Negative prompt", 8000)
    if any(marker in prompt.casefold() or marker in negative.casefold() for marker in SECRET_MARKERS):
        raise ValueError("prompt contains a credential marker")
    references: list[str] = []
    for raw_path in [*(task.get("referenceImages") or []), *generated_refs]:
        relative = safe_relative(raw_path, "referenceImages")
        source = (workspace / relative).resolve()
        if source.is_file() and source.is_relative_to(workspace.resolve()) and relative not in references:
            references.append(relative)
    args: dict[str, Any] = {
        "prompt": f"{prompt}\nAvoid: {negative}",
        "size": f"{task['width']}x{task['height']}",
        "aspect": aspect_for(task["width"], task["height"]),
        "count": 1,
    }
    if references:
        args["reference_images"] = [str((workspace / relative).resolve()) for relative in references]
    return args


def is_retryable(message: str) -> bool:
    lowered = message.casefold()
    return not any(marker in lowered for marker in ("credential", "cost", "tool generate_image", "dependency graph", "schema"))


def output_record(target: Path, item: dict[str, Any], workspace: Path) -> dict[str, Any]:
    width, height = image_dimensions(target)
    if target.suffix.lower() not in IMAGE_SUFFIXES or target.stat().st_size <= 0:
        raise ValueError("output is not a non-empty supported image")
    return {
        "assetId": item["assetItemId"],
        "relativePath": relative_to_workspace(target, workspace),
        "sha256": sha256_file(target),
        "width": width,
        "height": height,
        "status": "ingested",
        "providerJobId": None,
        "error": None,
    }


def main() -> int:
    args = parse_args()
    workspace = args.workspace.resolve()
    output_dir = (workspace / safe_relative(args.output_dir, "output-dir")).resolve()
    spec = load_spec(args.spec.resolve(), args.schema_dir.resolve())
    ordered_tasks = order_tasks(spec["tasks"])
    server_entry = Path(spec["serverEntry"]).expanduser().resolve()
    node_path = args.node.resolve()
    validate_server(server_entry, node_path)
    output_dir.mkdir(parents=True, exist_ok=True)
    target_dir = output_dir / "assets"
    target_dir.mkdir(parents=True, exist_ok=True)
    timeout = max(30, min(3600, int(spec.get("timeoutSeconds", 900))))
    report_items: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    generated_paths: dict[str, str] = {}
    server_info: dict[str, Any] | None = None
    client: StdioMcpClient | None = None
    try:
        import os
        env = os.environ.copy()
        env["FLOW_CDP_URL"] = safe_text(spec["flowCdpUrl"], "flowCdpUrl", 200)
        env["FLOW_OUTPUT_DIR"] = str(output_dir)
        env["FLOW_MAX_COST"] = "0"
        client = StdioMcpClient(node_path, server_entry, env, float(timeout))
        initialized = client.request("initialize", {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "Auto3Dvideo Asset Pack", "version": "0.1.0"}})
        server_info = initialized.get("serverInfo") if isinstance(initialized.get("serverInfo"), dict) else None
        client.notify("notifications/initialized")
        tools_result = client.request("tools/list")
        tools = tools_result.get("tools") if isinstance(tools_result.get("tools"), list) else []
        tool_name = spec["toolName"]
        if not any(isinstance(tool, dict) and tool.get("name") == tool_name for tool in tools):
            raise ValueError(f"MCP không có tool {tool_name}")

        for item in ordered_tasks:
            item_id = item["assetItemId"]
            request_hash = __import__("hashlib").sha256(json.dumps({key: item[key] for key in ("prompt", "negativePrompt", "width", "height", "role")}, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
            attempts: list[dict[str, Any]] = []
            output: list[dict[str, Any]] = []
            item_error: str | None = None
            item_failure_code: str | None = None
            for attempt in range(1, min(MAX_ATTEMPTS, int(spec.get("maxAttempts", 2))) + 1):
                try:
                    references = [generated_paths[dependency] for dependency in item["dependsOn"] if dependency in generated_paths]
                    before = image_snapshot(output_dir)
                    result = client.request("tools/call", {"name": tool_name, "arguments": task_arguments(item, workspace, references)})
                    cost = find_cost_violation(result)
                    if cost is not None:
                        raise ValueError(f"COST_POLICY: provider reported non-zero cost {cost}")
                    if result.get("isError") is True:
                        raise ValueError(f"tool trả lỗi: {redact(result)}")
                    generated = choose_new_image(output_dir, before)
                    if generated is None:
                        raise ValueError("MCP trả về nhưng không tìm thấy ảnh mới trong output directory")
                    target = target_dir / f"{item_id}{generated.suffix.lower()}"
                    if generated.resolve() != target.resolve():
                        target.write_bytes(generated.read_bytes())
                    output = [output_record(target, item, workspace)]
                    generated_paths[item_id] = relative_to_workspace(target, workspace)
                    attempts.append({"attempt": attempt, "status": "succeeded", "retryable": False, "failureCode": None, "message": None})
                    break
                except Exception as error:
                    item_error = redact(error)
                    item_failure_code = "COST_POLICY" if "COST_POLICY" in item_error else "ITEM_GENERATION_FAILED"
                    retryable = is_retryable(item_error) and attempt < min(MAX_ATTEMPTS, int(spec.get("maxAttempts", 2)))
                    attempts.append({"attempt": attempt, "status": "failed", "retryable": retryable, "failureCode": item_failure_code, "message": item_error})
                    if not retryable:
                        break
                    time.sleep(0.05)
            if output:
                report_items.append({"assetItemId": item_id, "status": "needs_review", "requestHash": request_hash, "provider": {"adapter": "nano_banana_mcp", "serverVersion": server_info.get("version") if server_info else None, "targetModel": None}, "attempts": attempts, "outputs": output, "rightsStatus": item["rightsStatus"], "reviewState": "in_review", "costObservation": {"mode": "unknown", "creditsUsed": None, "amountUsd": None, "note": "Flow/MCP cost was constrained to zero; user must verify provider UI before approval."}, "failureCode": None, "message": None})
            else:
                report_items.append({"assetItemId": item_id, "status": "failed", "requestHash": request_hash, "provider": {"adapter": "nano_banana_mcp", "serverVersion": server_info.get("version") if server_info else None, "targetModel": None}, "attempts": attempts or [{"attempt": 1, "status": "blocked", "retryable": False, "failureCode": "ITEM_NOT_RUN", "message": "item was not run"}], "outputs": [], "rightsStatus": item["rightsStatus"], "reviewState": "needs_revision", "costObservation": {"mode": "unknown", "creditsUsed": None, "amountUsd": None, "note": None}, "failureCode": item_failure_code or "ITEM_GENERATION_FAILED", "message": item_error or "item generation failed"})
                errors.append({"code": item_failure_code or "ITEM_GENERATION_FAILED", "message": item_error or "item generation failed", "retryable": False, "assetItemId": item_id})
    except Exception as error:
        errors.append({"code": "MCP_PREFLIGHT_FAILED", "message": redact(error), "retryable": False, "assetItemId": None})
    finally:
        if client is not None:
            client.close()

    succeeded = sum(item["status"] == "needs_review" for item in report_items)
    failed = sum(item["status"] == "failed" for item in report_items)
    total = len(report_items)
    status = "succeeded_needs_review" if succeeded == total and total else "blocked" if succeeded else "failed"
    timestamp = now()
    report = {
        "schemaVersion": "1.0.0",
        "reportId": f"{spec['packId']}-{spec['runId']}-report",
        "jobType": "asset.pack.generate",
        "projectId": spec["projectId"],
        "packId": spec["packId"],
        "runId": spec["runId"],
        "status": status,
        "itemCounts": {"total": total, "succeeded": succeeded, "failed": failed, "blocked": 0, "needsReview": succeeded},
        "items": report_items,
        "errors": errors,
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }
    report_path = output_dir / "asset-generation-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(redact(error), file=sys.stderr)
        raise SystemExit(2)

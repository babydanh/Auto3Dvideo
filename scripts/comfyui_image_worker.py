"""Submit typed image tasks to a local ComfyUI API and collect image outputs.

The worker is deliberately loopback-only. It never invokes a shell, installs
custom nodes, downloads a model or accepts a remote provider URL.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import ipaddress
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
DEFAULT_BINDINGS = {
    "positivePrompt": "6.inputs.text",
    "negativePrompt": "7.inputs.text",
    "seed": "3.inputs.seed",
    "width": "5.inputs.width",
    "height": "5.inputs.height",
}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def inside(workspace: Path, value: str, *, must_exist: bool = True) -> Path:
    candidate = Path(value)
    if candidate.is_absolute():
        raise ValueError("absolute path bị từ chối")
    resolved = (workspace / candidate).resolve()
    if workspace not in resolved.parents and resolved != workspace:
        raise ValueError("path vượt workspace")
    if must_exist and not resolved.is_file():
        raise ValueError(f"không tìm thấy file: {value}")
    return resolved


def validate_loopback(endpoint: str) -> str:
    parsed = urllib.parse.urlparse(endpoint)
    if parsed.scheme != "http" or parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise ValueError("ComfyUI chỉ nhận http loopback không path/auth/query")
    host = parsed.hostname or ""
    if host not in {"localhost", "127.0.0.1", "::1"}:
        try:
            if not ipaddress.ip_address(host).is_loopback:
                raise ValueError("endpoint không phải loopback")
        except ValueError as error:
            raise ValueError("endpoint không phải loopback") from error
    if not parsed.port or not 1 <= parsed.port <= 65535:
        raise ValueError("port ComfyUI không hợp lệ")
    return f"http://{host}:{parsed.port}"


def request_json(url: str, method: str = "GET", payload: Any | None = None, timeout: float = 30.0) -> Any:
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read(8 * 1024 * 1024).decode("utf-8"))


def request_bytes(url: str, timeout: float = 30.0) -> bytes:
    request = urllib.request.Request(url, headers={"Accept": "image/*"}, method="GET")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        data = response.read(64 * 1024 * 1024 + 1)
    if len(data) > 64 * 1024 * 1024:
        raise ValueError("output ảnh vượt giới hạn 64 MiB")
    return data


def set_path(graph: dict[str, Any], pointer: str, value: Any) -> None:
    parts = pointer.split(".")
    if len(parts) < 3 or any(not part or part in {"__class__", "__dict__", "__globals__"} for part in parts):
        raise ValueError(f"binding path không hợp lệ: {pointer}")
    node = graph.get(parts[0])
    if not isinstance(node, dict):
        raise ValueError(f"không tìm thấy node trong binding: {parts[0]}")
    cursor: Any = node
    for part in parts[1:-1]:
        if not isinstance(cursor, dict) or part not in cursor:
            raise ValueError(f"không tìm thấy binding path: {pointer}")
        cursor = cursor[part]
    if not isinstance(cursor, dict) or parts[-1] not in cursor:
        raise ValueError(f"không tìm thấy binding input: {pointer}")
    cursor[parts[-1]] = value


def read_history(endpoint: str, prompt_id: str, timeout: float, interval: float) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    url = f"{endpoint}/history/{urllib.parse.quote(prompt_id, safe='')}"
    while time.monotonic() < deadline:
        history = request_json(url, timeout=min(30.0, max(1.0, deadline - time.monotonic())))
        item = history.get(prompt_id) if isinstance(history, dict) else None
        if isinstance(item, dict):
            status = item.get("status") or {}
            if status.get("status_str") == "error" or status.get("completed") is False and status.get("messages"):
                raise RuntimeError("ComfyUI báo workflow lỗi")
            if item.get("outputs"):
                return item
        time.sleep(interval)
    raise TimeoutError(f"ComfyUI timeout khi chờ prompt {prompt_id}")


def first_image_output(history: dict[str, Any]) -> dict[str, str]:
    outputs = history.get("outputs")
    if not isinstance(outputs, dict):
        raise ValueError("ComfyUI không trả outputs")
    for node_output in outputs.values():
        if not isinstance(node_output, dict):
            continue
        images = node_output.get("images")
        if not isinstance(images, list):
            continue
        for image in images:
            if not isinstance(image, dict):
                continue
            filename = str(image.get("filename", ""))
            suffix = Path(filename).suffix.lower()
            if filename and suffix in IMAGE_SUFFIXES and all(token not in filename for token in ("..", "\\", "/")):
                return {
                    "filename": filename,
                    "subfolder": str(image.get("subfolder", "")),
                    "type": str(image.get("type", "output")),
                }
    raise ValueError("ComfyUI không trả image output hợp lệ")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def run(workspace: Path, spec_path: Path, output_dir: Path) -> dict[str, Any]:
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    endpoint = validate_loopback(spec["endpoint"])
    workflow_path = inside(workspace, spec["workflowPath"])
    workflow = json.loads(workflow_path.read_text(encoding="utf-8"))
    if not isinstance(workflow, dict) or not workflow:
        raise ValueError("workflow ComfyUI phải là object API không rỗng")
    bindings = dict(DEFAULT_BINDINGS)
    bindings.update(spec.get("bindings") or {})
    timeout = float(spec.get("timeoutSeconds", 600))
    interval = float(spec.get("pollIntervalSeconds", 1.0))
    output_dir.mkdir(parents=True, exist_ok=True)
    generated_dir = output_dir / "generated"
    outputs: list[dict[str, Any]] = []
    errors: list[str] = []
    for task in spec.get("tasks", []):
        asset_id = task["assetId"]
        record: dict[str, Any] = {
            "assetId": asset_id,
            "shotId": task["shotId"],
            "title": task["title"],
            "relativePath": None,
            "role": task["role"],
            "rightsStatus": task["rightsStatus"],
            "status": "failed",
            "providerJobId": None,
            "sha256": None,
            "error": None,
        }
        try:
            graph = copy.deepcopy(workflow)
            set_path(graph, bindings["positivePrompt"], task["prompt"])
            if task.get("negativePrompt") and bindings.get("negativePrompt"):
                set_path(graph, bindings["negativePrompt"], task["negativePrompt"])
            for key, task_key in (("seed", "seed"), ("width", "width"), ("height", "height")):
                if task.get(task_key) is not None and bindings.get(key):
                    set_path(graph, bindings[key], int(task[task_key]))
            queued = request_json(f"{endpoint}/prompt", method="POST", payload={"prompt": graph, "client_id": f"auto3dvideo-{spec['runId']}"}, timeout=30)
            prompt_id = str(queued.get("prompt_id", ""))
            if not prompt_id:
                raise RuntimeError(str(queued.get("error", "ComfyUI không trả prompt_id"))[:500])
            record["providerJobId"] = prompt_id
            history = read_history(endpoint, prompt_id, timeout, interval)
            image = first_image_output(history)
            query = urllib.parse.urlencode({"filename": image["filename"], "subfolder": image["subfolder"], "type": image["type"]})
            data = request_bytes(f"{endpoint}/view?{query}", timeout=30)
            suffix = Path(image["filename"]).suffix.lower()
            destination = generated_dir / asset_id / f"{asset_id}{suffix}"
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            record["relativePath"] = destination.relative_to(workspace).as_posix()
            record["sha256"] = sha256_bytes(data)
            record["status"] = "ready"
        except (OSError, ValueError, TimeoutError, RuntimeError, urllib.error.URLError, urllib.error.HTTPError) as error:
            record["error"] = str(error)[:700]
            errors.append(f"{asset_id}: {record['error']}")
        outputs.append(record)
    report = {
        "schemaVersion": "1.0.0",
        "jobType": "image.generate",
        "projectId": spec["projectId"],
        "runId": spec["runId"],
        "status": "succeeded_needs_review" if outputs and not errors else "blocked",
        "workflowSha256": hashlib.sha256(workflow_path.read_bytes()).hexdigest(),
        "outputs": outputs,
        "errors": errors,
        "createdAt": now(),
    }
    (output_dir / "comfyui-image-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description="Auto3Dvideo local ComfyUI image worker")
    value.add_argument("--workspace", required=True)
    value.add_argument("--spec", required=True)
    value.add_argument("--output-dir", required=True)
    return value


def main() -> int:
    args = parser().parse_args()
    workspace = Path(args.workspace).resolve()
    output_dir = inside(workspace, args.output_dir, must_exist=False)
    try:
        run(workspace, inside(workspace, args.spec), output_dir)
        return 0
    except Exception as error:
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "comfyui-image-report.json").write_text(json.dumps({"schemaVersion": "1.0.0", "jobType": "image.generate", "status": "blocked", "errors": [str(error)[:700]], "outputs": []}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

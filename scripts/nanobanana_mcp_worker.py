#!/usr/bin/env python3
"""Bounded stdio MCP client for Nano Banana image generation.

The worker talks to a user-installed Nano Banana MCP server. The default
supported mode is the Flow browser server, which uses a signed-in Chrome
profile through loopback CDP and writes image outputs to a project directory.
No API key is read, printed, or stored by this worker.
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any


MAX_TASKS = 32
MAX_PROMPT = 12000
MAX_ERRORS = 32
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
SECRET_MARKERS = ("api_key=", "apikey=", "access_token=", "authorization:", "bearer ", "password=", "secret=", "token=")


def fail(message: str) -> None:
    raise ValueError(message[:900])


def safe_text(value: Any, field: str, limit: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        fail(f"{field} không hợp lệ")
    lowered = value.lower()
    if any(marker in lowered for marker in SECRET_MARKERS) or lowered.startswith(("sk-", "key_")):
        fail(f"{field} có dấu hiệu credential")
    return value.strip()


def safe_relative(value: Any, field: str) -> str:
    text = safe_text(value, field, 1024).replace("\\", "/")
    path = Path(text)
    if path.is_absolute() or any(part == ".." for part in path.parts):
        fail(f"{field} phải là đường dẫn tương đối trong workspace")
    return text


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--spec", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--node", required=True)
    return parser.parse_args()


def load_spec(path: Path) -> dict[str, Any]:
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:
        fail(f"Không đọc được Nano Banana job: {error}")
    if spec.get("schemaVersion") != "1.0.0" or spec.get("jobType") != "image.generate":
        fail("Nano Banana job không đúng schema")
    if spec.get("provider") != "nano_banana_mcp":
        fail("Nano Banana job sai provider")
    tasks = spec.get("tasks")
    if not isinstance(tasks, list) or not 1 <= len(tasks) <= MAX_TASKS:
        fail(f"Nano Banana image job cần từ 1 đến {MAX_TASKS} task")
    return spec


def validate_server(server_entry: Path, node_path: Path) -> None:
    if not server_entry.is_file() or server_entry.suffix.lower() not in {".js", ".mjs", ".cjs"}:
        fail("Nano Banana MCP server entry phải là file JavaScript đã cài")
    if not node_path.is_file() or node_path.name.lower() not in {"node.exe", "node"}:
        fail("Nano Banana MCP chỉ được chạy bằng Node.js đã allowlist")


class StdioMcpClient:
    def __init__(self, node_path: Path, server_entry: Path, env: dict[str, str], timeout: float) -> None:
        self.timeout = timeout
        server_cwd = server_entry.parent.parent if server_entry.parent.name.lower() == "dist" else server_entry.parent
        self.process = subprocess.Popen(
            [str(node_path), str(server_entry)],
            cwd=str(server_cwd),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
        )
        self.responses: queue.Queue[dict[str, Any]] = queue.Queue()
        self.stderr_lines: queue.Queue[str] = queue.Queue(maxsize=64)
        self.next_id = 1
        self.reader = threading.Thread(target=self._read_stdout, daemon=True)
        self.reader.start()
        self.stderr_reader = threading.Thread(target=self._read_stderr, daemon=True)
        self.stderr_reader.start()

    def _read_stdout(self) -> None:
        assert self.process.stdout is not None
        for line in self.process.stdout:
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(message, dict):
                self.responses.put(message)

    def _read_stderr(self) -> None:
        assert self.process.stderr is not None
        for line in self.process.stderr:
            try:
                self.stderr_lines.put_nowait(line.strip()[:400])
            except queue.Full:
                pass

    def request(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        if self.process.poll() is not None:
            fail("Nano Banana MCP server đã dừng")
        request_id = self.next_id
        self.next_id += 1
        request = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}}
        assert self.process.stdin is not None
        self.process.stdin.write(json.dumps(request, ensure_ascii=False) + "\n")
        self.process.stdin.flush()
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            try:
                message = self.responses.get(timeout=min(0.5, max(0.05, deadline - time.monotonic())))
            except queue.Empty:
                continue
            if message.get("id") != request_id:
                continue
            if "error" in message:
                fail(f"Nano Banana MCP {method} lỗi: {redact(message['error'])}")
            result = message.get("result")
            return result if isinstance(result, dict) else {"value": result}
        fail(f"Nano Banana MCP timeout ở {method}")

    def notify(self, method: str, params: dict[str, Any] | None = None) -> None:
        assert self.process.stdin is not None
        self.process.stdin.write(json.dumps({"jsonrpc": "2.0", "method": method, "params": params or {}}, ensure_ascii=False) + "\n")
        self.process.stdin.flush()

    def close(self) -> None:
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=3)


def redact(value: Any) -> str:
    try:
        text = json.dumps(value, ensure_ascii=False)
    except TypeError:
        text = str(value)
    return re.sub(r"(?i)(api[_-]?key|access[_-]?token|authorization|password|secret|token)\s*[:=]\s*[^,\s}]+", r"\1=[redacted]", text)[:900]


def image_snapshot(root: Path) -> dict[str, tuple[int, int]]:
    found: dict[str, tuple[int, int]] = {}
    if not root.exists():
        return found
    for path in root.rglob("*"):
        if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES:
            try:
                stat = path.stat()
                found[str(path.resolve())] = (stat.st_mtime_ns, stat.st_size)
            except OSError:
                pass
    return found


def choose_new_image(root: Path, before: dict[str, tuple[int, int]]) -> Path | None:
    after = image_snapshot(root)
    candidates = [Path(path) for path, fingerprint in after.items() if before.get(path) != fingerprint]
    return max(candidates, key=lambda path: path.stat().st_mtime_ns) if candidates else None


def relative_to_workspace(path: Path, workspace: Path) -> str:
    try:
        return path.resolve().relative_to(workspace.resolve()).as_posix()
    except ValueError:
        fail("Nano Banana output vượt project workspace")


def sha256_file(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def task_arguments(task: dict[str, Any], workspace: Path) -> dict[str, Any]:
    prompt = safe_text(task.get("prompt"), "Prompt", MAX_PROMPT)
    negative = str(task.get("negativePrompt") or "").strip()
    if negative:
        prompt += f"\nAvoid: {safe_text(negative, 'Negative prompt', 8000)}"
    width = int(task.get("width", 1024))
    height = int(task.get("height", 576))
    args: dict[str, Any] = {
        "prompt": prompt,
        "size": f"{width}x{height}",
        "aspect": aspect_for(width, height),
        "count": 1,
    }
    references = []
    for raw_path in task.get("referenceImages") or []:
        relative = safe_relative(raw_path, "referenceImages")
        source = (workspace / relative).resolve()
        if source.is_file() and source.is_relative_to(workspace.resolve()):
            references.append(str(source))
    if references:
        args["reference_images"] = references
    return args


def aspect_for(width: int, height: int) -> str:
    ratio = width / max(height, 1)
    choices = {"16:9": 16 / 9, "4:3": 4 / 3, "1:1": 1, "3:4": 3 / 4, "9:16": 9 / 16}
    return min(choices, key=lambda name: abs(choices[name] - ratio))


def emit_progress(
    path: Path,
    run_id: str,
    stage: str,
    state: str,
    message: str,
    progress: float,
    task_index: int | None = None,
    task_count: int | None = None,
    shot_id: str | None = None,
) -> None:
    """Append a redacted, prompt-free progress event for the local UI terminal."""
    event: dict[str, Any] = {
        "schemaVersion": "1.0.0",
        "runId": run_id,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "stage": stage,
        "state": state,
        "message": message[:900],
        "progress": max(0.0, min(1.0, progress)),
    }
    if task_index is not None:
        event["taskIndex"] = task_index
    if task_count is not None:
        event["taskCount"] = task_count
    if shot_id:
        event["shotId"] = shot_id[:80]
    try:
        with path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(event, ensure_ascii=False) + "\n")
    except OSError:
        # Progress is observability only; never turn a successful generation into
        # a failed generation because the local log cannot be written.
        pass


def main() -> int:
    args = parse_args()
    workspace = Path(args.workspace).resolve()
    output_dir = (workspace / safe_relative(args.output_dir, "output-dir")).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    progress_path = output_dir / "nanobanana-progress.jsonl"
    spec = load_spec(Path(args.spec).resolve())
    run_id = safe_text(spec.get("runId"), "runId", 80)
    task_count = len(spec["tasks"])
    emit_progress(progress_path, run_id, "job.validate", "success", f"Đã đọc job Nano Banana với {task_count} task; prompt không được ghi vào terminal.", 0.02, task_count=task_count)
    server_entry = Path(spec["serverEntry"]).expanduser().resolve()
    node_path = Path(args.node).resolve()
    validate_server(server_entry, node_path)
    emit_progress(progress_path, run_id, "mcp.validate", "success", "Server entry và Node.js đã qua allowlist; chuẩn bị mở MCP subprocess.", 0.06, task_count=task_count)
    cdp_url = safe_text(spec["flowCdpUrl"], "flowCdpUrl", 200)
    if not re.fullmatch(r"http://(127\.0\.0\.1|localhost):[1-9][0-9]{0,4}", cdp_url):
        fail("flowCdpUrl chỉ được là loopback http://127.0.0.1 hoặc localhost")
    timeout = max(30, min(3600, int(spec.get("timeoutSeconds", 900))))
    env = os.environ.copy()
    env["FLOW_CDP_URL"] = cdp_url
    env["FLOW_OUTPUT_DIR"] = str(output_dir)
    env["FLOW_MAX_COST"] = "0"
    emit_progress(progress_path, run_id, "mcp.spawn", "running", "Đang mở Nano Banana MCP qua stdio; chưa coi là đã kết nối Google Flow.", 0.09, task_count=task_count)
    client: StdioMcpClient | None = None
    outputs: list[dict[str, Any]] = []
    errors: list[str] = []
    server_info: dict[str, Any] | None = None
    try:
        # A missing Chrome CDP connection must fail fast during the MCP
        # handshake. Image generation can take longer, but waiting the full
        # job timeout here makes the UI look frozen and encourages duplicate
        # clicks/runs.
        client = StdioMcpClient(node_path, server_entry, env, min(float(timeout), 20.0))
        emit_progress(progress_path, run_id, "mcp.initialize", "running", f"MCP subprocess đã mở; đang gửi initialize qua {cdp_url}.", 0.12, task_count=task_count)
        initialized = client.request("initialize", {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "Auto3Dvideo", "version": "0.1.0"}})
        server_info = initialized.get("serverInfo") if isinstance(initialized.get("serverInfo"), dict) else None
        client.notify("notifications/initialized")
        emit_progress(progress_path, run_id, "mcp.initialize", "success", "MCP initialize thành công; đang hỏi danh sách tool.", 0.16, task_count=task_count)
        tools_result = client.request("tools/list")
        tools = tools_result.get("tools") if isinstance(tools_result.get("tools"), list) else []
        tool_name = str(spec.get("toolName") or "generate_image")
        if not any(isinstance(tool, dict) and tool.get("name") == tool_name for tool in tools):
            fail(f"Nano Banana MCP không có tool {tool_name}; tools hiện có: {[tool.get('name') for tool in tools if isinstance(tool, dict)]}")
        emit_progress(progress_path, run_id, "mcp.tools.list", "success", f"Đã tìm thấy tool {tool_name}; bắt đầu chạy từng shot.", 0.2, task_count=task_count)
        client.timeout = float(timeout)
        for index, task in enumerate(spec["tasks"], start=1):
            asset_id = safe_text(task.get("assetId"), "assetId", 80)
            shot_id = safe_text(task.get("shotId"), "shotId", 80)
            title = safe_text(task.get("title"), "title", 160)
            role = safe_text(task.get("role"), "role", 40)
            rights_status = safe_text(task.get("rightsStatus"), "rightsStatus", 40)
            before = image_snapshot(output_dir)
            try:
                task_progress = 0.2 + ((index - 1) / max(task_count, 1)) * 0.78
                emit_progress(progress_path, run_id, "mcp.task", "running", f"Shot {index}/{task_count} ({shot_id}): gửi generate_image tới Google Flow; đang chờ ảnh trả về.", task_progress, index, task_count, shot_id)
                result = client.request("tools/call", {"name": tool_name, "arguments": task_arguments(task, workspace)})
                if result.get("isError") is True:
                    fail(f"tool trả lỗi: {redact(result)}")
                generated = choose_new_image(output_dir, before)
                if generated is None:
                    fail("MCP trả về nhưng không tìm thấy ảnh mới trong FLOW_OUTPUT_DIR")
                target_dir = output_dir / "assets"
                target_dir.mkdir(parents=True, exist_ok=True)
                target = target_dir / f"{asset_id}{generated.suffix.lower()}"
                if generated.resolve() != target.resolve():
                    shutil.copy2(generated, target)
                outputs.append({"assetId": asset_id, "shotId": shot_id, "title": title, "relativePath": relative_to_workspace(target, workspace), "role": role, "rightsStatus": rights_status, "status": "ready", "providerJobId": None, "sha256": sha256_file(target), "error": None})
                emit_progress(progress_path, run_id, "mcp.task", "success", f"Shot {index}/{task_count} hoàn tất; ảnh đã được chép vào output local để app nhập Asset Library.", 0.2 + (index / max(task_count, 1)) * 0.78, index, task_count, shot_id)
            except Exception as error:
                message = redact(error)
                errors.append(f"{asset_id}: {message}")
                outputs.append({"assetId": asset_id, "shotId": shot_id, "title": title, "relativePath": None, "role": role, "rightsStatus": rights_status, "status": "failed", "providerJobId": None, "sha256": None, "error": message})
                emit_progress(progress_path, run_id, "mcp.task", "blocked", f"Shot {index}/{task_count} thất bại: {message}", task_progress, index, task_count, shot_id)
    except Exception as error:
        message = redact(error)
        errors.append(message)
        emit_progress(progress_path, run_id, "mcp.run", "blocked", f"MCP bị chặn: {message}", 0.2, task_count=task_count)
    finally:
        if client is not None:
            client.close()
    ready = sum(item["status"] == "ready" for item in outputs)
    status = "succeeded_needs_review" if ready == len(spec["tasks"]) else "blocked" if ready else "failed"
    report = {"schemaVersion": "1.0.0", "jobType": "image.generate", "provider": "nano_banana_mcp", "projectId": spec["projectId"], "runId": spec["runId"], "status": status, "toolName": spec.get("toolName", "generate_image"), "serverInfo": server_info, "outputs": outputs, "errors": errors[:MAX_ERRORS], "createdAt": datetime.now(timezone.utc).isoformat()}
    report_path = output_dir / "nanobanana-image-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    emit_progress(progress_path, run_id, "job.complete", "success" if status == "succeeded_needs_review" else "blocked", f"Job kết thúc: {ready}/{task_count} ảnh sẵn sàng; report đã ghi local.", 1.0, task_count=task_count)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(redact(error), file=sys.stderr)
        raise SystemExit(2)

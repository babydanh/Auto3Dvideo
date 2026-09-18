from __future__ import annotations

import ast
import hashlib
import importlib.util
import json
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


WORKER_PATH = Path(__file__).with_name("comfyui_image_worker.py")
MODULE_SPEC = importlib.util.spec_from_file_location("comfyui_image_worker", WORKER_PATH)
assert MODULE_SPEC and MODULE_SPEC.loader
WORKER = importlib.util.module_from_spec(MODULE_SPEC)
MODULE_SPEC.loader.exec_module(WORKER)


ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "scripts" / "comfyui_image_worker.py").read_text(encoding="utf-8")
TREE = ast.parse(SOURCE)


def main() -> int:
    names = {node.name for node in TREE.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
    required = {"validate_loopback", "set_path", "read_history", "first_image_output", "run"}
    assert required.issubset(names)
    assert "subprocess" not in SOURCE and "os.system" not in SOURCE and "shell=True" not in SOURCE
    assert "workflowSha256" in SOURCE
    assert "rightsStatus" in SOURCE
    assert "127.0.0.1" in SOURCE and "localhost" in SOURCE and "is_loopback" in SOURCE
    try:
        WORKER.validate_loopback("http://example.com:8188")
    except ValueError:
        pass
    else:
        raise AssertionError("remote endpoint was accepted")

    image_bytes = b"\x89PNG\r\n\x1a\ncomfyui-test"

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            return

        def send_json(self, payload):
            data = json.dumps(payload).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            assert self.path == "/prompt"
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            assert body["prompt"]["6"]["inputs"]["text"] == "hero tiger"
            assert body["prompt"]["7"]["inputs"]["text"] == "no text"
            assert body["prompt"]["3"]["inputs"]["seed"] == 77
            self.send_json({"prompt_id": "test-prompt-1"})

        def do_GET(self):
            if self.path == "/history/test-prompt-1":
                self.send_json({"test-prompt-1": {"status": {"completed": True}, "outputs": {"9": {"images": [{"filename": "result.png", "subfolder": "", "type": "output"}]}}}})
                return
            if self.path.startswith("/view?"):
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(image_bytes)))
                self.end_headers()
                self.wfile.write(image_bytes)
                return
            self.send_error(404)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server_thread = None
    try:
        import threading

        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            workflow_path = workspace / "workflow.json"
            workflow_path.write_text(json.dumps({
                "3": {"inputs": {"seed": 0}},
                "5": {"inputs": {"width": 64, "height": 64}},
                "6": {"inputs": {"text": "old positive"}},
                "7": {"inputs": {"text": "old negative"}},
            }), encoding="utf-8")
            spec_path = workspace / "job.json"
            spec_path.write_text(json.dumps({
                "schemaVersion": "1.0.0",
                "jobType": "image.generate",
                "projectId": "project-test",
                "runId": "run-test",
                "endpoint": f"http://127.0.0.1:{server.server_port}",
                "workflowPath": "workflow.json",
                "tasks": [{
                    "assetId": "shot-001-reference",
                    "shotId": "SHOT-001",
                    "title": "Test reference",
                    "prompt": "hero tiger",
                    "negativePrompt": "no text",
                    "seed": 77,
                    "width": 512,
                    "height": 288,
                    "role": "composition",
                    "rightsStatus": "pending",
                }],
            }), encoding="utf-8")
            report = WORKER.run(workspace, spec_path, workspace / "output")
            assert report["status"] == "succeeded_needs_review"
            output = workspace / report["outputs"][0]["relativePath"]
            assert output.read_bytes() == image_bytes
            assert report["outputs"][0]["sha256"] == hashlib.sha256(image_bytes).hexdigest()
    finally:
        server.shutdown()
        if server_thread:
            server_thread.join(timeout=2)

    print("COMFYUI_IMAGE_WORKER_STATIC_AND_LOOPBACK_TEST_VALID")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

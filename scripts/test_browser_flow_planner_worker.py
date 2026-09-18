from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "browser_flow_planner_worker_test_target",
    ROOT / "browser_flow_planner_worker.py",
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("cannot load browser_flow_planner_worker.py")
WORKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WORKER)


class BrowserFlowPlannerWorkerTests(unittest.TestCase):
    def test_screenshot_is_attached_as_multimodal_user_content(self):
        request = {
            "model": "ag/gemini-3.8-flash-low",
            "messages": [
                {"role": "system", "content": "Return one JSON action."},
                {"role": "user", "content": "Inspect the current Flow UI."},
            ],
            "maxTokens": 64,
            "zeroDataRetention": True,
            "screenshotPath": ".auto3dvideo/browsermcp/screenshots/current.png",
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            screenshot = root / request["screenshotPath"]
            screenshot.parent.mkdir(parents=True)
            screenshot.write_bytes(b"fake-png")
            previous = Path.cwd()
            try:
                os.chdir(root)
                messages, attached = WORKER.api_messages(request)
            finally:
                os.chdir(previous)

        self.assertTrue(attached)
        content = messages[-1]["content"]
        self.assertIsInstance(content, list)
        self.assertEqual(content[0]["type"], "text")
        self.assertEqual(content[1]["type"], "image_url")
        self.assertTrue(content[1]["image_url"]["url"].startswith("data:image/png;base64,"))

    def test_screenshot_path_cannot_escape_workspace(self):
        request = {
            "model": "ag/gemini-3.8-flash-low",
            "messages": [{"role": "user", "content": "Inspect."}],
            "maxTokens": 64,
            "zeroDataRetention": True,
            "screenshotPath": "../outside.png",
        }
        with self.assertRaises(ValueError):
            WORKER.screenshot_data_url(request)

    def test_emit_is_safe_for_windows_cp1252_stdout(self):
        class Cp1252Stdout(io.StringIO):
            def write(self, value):
                value.encode("cp1252")
                return super().write(value)

        output = Cp1252Stdout()
        with contextlib.redirect_stdout(output):
            status = WORKER.emit({"status": "http_error", "message": "Lỗi planner tiếng Việt"})

        self.assertEqual(status, 1)
        self.assertIn("\\u1ed7i", output.getvalue())

    def test_missing_key_is_reported_without_unbound_local_error(self):
        request = {
            "model": "ag/gemini-3.8-flash-medium",
            "messages": [
                {"role": "system", "content": "Return one JSON action."},
                {"role": "user", "content": "Inspect the current Flow UI."},
            ],
            "maxTokens": 64,
            "zeroDataRetention": True,
        }
        with tempfile.TemporaryDirectory() as directory:
            request_path = Path(directory) / "request.json"
            request_path.write_text(json.dumps(request), encoding="utf-8")
            output = io.StringIO()
            with (
                patch.dict(
                    "os.environ",
                    {
                        "AUTO3DVIDEO_LLM_BASE_URL": "http://127.0.0.1:20128/v1",
                        "AUTO3DVIDEO_LLM_API_KEY": "",
                        "AUTO3DVIDEO_DOTENV_PATH": str(Path(directory) / "missing.env"),
                    },
                    clear=False,
                ),
                patch.object(WORKER, "read_local_router_api_key", return_value=""),
                patch.object(WORKER, "read_dotenv_value", return_value=""),
                contextlib.redirect_stdout(output),
            ):
                status = WORKER.run(request_path)

        self.assertEqual(status, 1)
        payload = json.loads(output.getvalue())
        self.assertEqual(payload["status"], "missing_credential")
        self.assertNotIn("UnboundLocalError", output.getvalue())

    def test_unexpected_main_error_is_returned_as_structured_json(self):
        output = io.StringIO()
        with (
            patch.object(WORKER.sys, "argv", ["worker.py", "--request", ".auto3dvideo/request.json"]),
            patch.object(WORKER, "run", side_effect=RuntimeError("hidden detail")),
            contextlib.redirect_stdout(output),
        ):
            status = WORKER.main()

        self.assertEqual(status, 1)
        payload = json.loads(output.getvalue())
        self.assertEqual(payload["status"], "internal_error")
        self.assertIn("RuntimeError", payload["message"])
        self.assertNotIn("hidden detail", payload["message"])


if __name__ == "__main__":
    unittest.main()
